"""Private original training ownership; no configured producer by default.

Trusted boot explicitly selects strict Native or cooperative bounded-local
resources. A request cannot select or downgrade that policy. Native custody and
physical accounting remain separately qualified; local settlement still requires
original parent worker/SDK/Job retirement before cleanup or Save.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from contextlib import AbstractContextManager, contextmanager
from concurrent.futures import Future
from dataclasses import dataclass
import json
import hashlib
import os
import re
import stat
from pathlib import Path
from threading import RLock, get_ident
from time import monotonic
from types import FunctionType, MethodType
from typing import Callable
from uuid import UUID
from weakref import WeakKeyDictionary

from ..models import TrainModelTaskRequest, TrainModelBaseModelInput, TrainModelDatasetInput
from ..native.windows_original_worker_launch import resolve_original_model_view
from ..native import windows_original_worker_launch as native
from .train_model import TrainingCancellationRequested, train_model_from_local_files
from . import original_training_output_delivery as output_delivery

CAPABILITY = "train-model.original-session-v1"
MAX_BODY_BYTES = 128 * 1024
MAX_SESSIONS = 256
_OUTPUT_RECORD = output_delivery._record
_OUTPUT_READ = output_delivery.OriginalTrainingOutputDelivery.read
_OUTPUT_ACK = output_delivery.OriginalTrainingOutputDelivery.acknowledge
_OUTPUT_ABORT = output_delivery.abort_original_output_delivery
_output_sessions = WeakKeyDictionary()
_local_output_sessions = WeakKeyDictionary()
_original_scopes = WeakKeyDictionary()
_MODEL_LEASES = native._model_leases
_MODEL_SOURCES = native._verified_model_receivers
_MODEL_VIEWS = native._model_views
_OUTPUT_FAMILIES = native._training_output_families
_FAMILY_RECORD = native._output_family_record
_SCOPE_TYPES = tuple((cls,type.__getattribute__(cls,"__mro__")) for cls in (
    native.OriginalTrainingOutputFamily,native.OriginalInheritedModelLease,
    native.OriginalModelBootstrapReceiver,native._OriginalModelView))
_SCOPE_API = tuple((base,name,type.__getattribute__(base,"__dict__").get(name))
    for _,bases in _SCOPE_TYPES for base in bases
    for name in ("__getattribute__","__getattr__","__hash__","__eq__"))


class TrainingSessionError(RuntimeError):
    def __init__(self):
        super().__init__("The original private training session is unavailable.")


def _need(value):
    if value is not True:
        raise TrainingSessionError()


def _uuid(value):
    _need(type(value) is str and str(UUID(value)) == value)
    return value


def _text(value, maximum=200):
    _need(type(value) is str and 0 < len(value) <= maximum
          and not any(ord(c) < 32 or ord(c) == 127 for c in value))
    return value


def _record(value, fields):
    _need(type(value) is dict and set(value) == set(fields))
    return value


def _copy(value):
    nodes = 0
    def visit(item, depth=0):
        nonlocal nodes
        nodes += 1
        _need(nodes <= 8192 and depth <= 24)
        if item is None or type(item) in (str, int, bool):
            return item
        if type(item) is float:
            _need(item == item and abs(item) != float("inf"))
            return item
        if type(item) is list:
            _need(len(item) <= 1024)
            return [visit(x, depth + 1) for x in item]
        _need(type(item) is dict and len(item) <= 128)
        return {_text(k, 160): visit(v, depth + 1) for k, v in item.items()}
    result = visit(value)
    _need(len(json.dumps(result, allow_nan=False).encode()) <= MAX_BODY_BYTES)
    return result


def _scope_digest(value):
    return hashlib.sha256(json.dumps(_copy(value),sort_keys=True,allow_nan=False,
        separators=(",", ":")).encode("utf8")).hexdigest()


def capture_definition(raw):
    value = _copy(raw)
    _record(value, ("requestId", "workspaceId", "owner", "request", "modelUpdatedAt", "dataset",
                    "proposalDigest", "inputs", "recipeSizeBytes"))
    _uuid(value["requestId"])
    _text(value["workspaceId"])
    owner = _record(value["owner"], ("organizationId", "principalId", "clientId", "hostIncarnationId"))
    _text(owner["organizationId"]); _text(owner["principalId"], 160)
    _uuid(owner["clientId"]); _uuid(owner["hostIncarnationId"])
    _text(value["modelUpdatedAt"], 64)
    data = _record(value["dataset"], ("datasetId", "versionId", "versionDigest", "recipeDigest"))
    for key in ("datasetId", "versionId"):
        _text(data[key])
    for digest in (value["proposalDigest"], data["versionDigest"], data["recipeDigest"]):
        _need(type(digest) is str and re.fullmatch(r"sha256:[a-f0-9]{64}", digest) is not None)
    request = value["request"]
    _need(type(request) is dict and request.get("workspaceId") == value["workspaceId"]
          and set(request) <= {"workspaceId", "trainingTask", "baseModel", "datasets", "method", "commonParameters",
                               "advancedParameters", "output", "validation"})
    _need(request.get("output", {}).get("destination") == {"local": {"enabled": False}})
    TrainModelTaskRequest.model_validate(request)
    inputs = value["inputs"]
    _need(type(inputs) is list and 1 <= len(inputs) <= 16 and type(request.get("datasets")) is list
          and len(inputs) == len(request["datasets"]))
    total = 0
    for index, item in enumerate(inputs):
        _record(item, ("artifactId", "role", "mediaType", "digest", "sizeBytes"))
        _need(item["artifactId"] == "input-" + str(index) and item["role"] in ("train", "validation"))
        _need(item["artifactId"] == request["datasets"][index].get("artifactId")
              and item["role"] == request["datasets"][index].get("splitRole"))
        _need(type(item["sizeBytes"]) is int and 1 <= item["sizeBytes"] <= 64 * 1024**2)
        _text(item["mediaType"], 128)
        _need(type(item["digest"]) is str and re.fullmatch(r"sha256:[a-f0-9]{64}", item["digest"]) is not None)
        total += item["sizeBytes"]
    _need(any(row["role"] == "train" for row in inputs) and type(value["recipeSizeBytes"]) is int
          and 1 <= value["recipeSizeBytes"] <= 512 * 1024 and total + value["recipeSizeBytes"] <= 256 * 1024**2)
    return value


_MEDIA_FORMATS = {"application/x-ndjson": "jsonl", "application/jsonl": "jsonl", "application/json": "json", "text/json": "json",
                  "text/csv": "csv", "application/csv": "csv", "application/x-parquet": "parquet", "application/vnd.apache.parquet": "parquet"}


def _same(left, right):
    if type(left) is not type(right): return False
    if type(left) is dict:
        return set(left) == set(right) and all(_same(left[k], right[k]) for k in left)
    if type(left) is list:
        return len(left) == len(right) and all(_same(a, b) for a, b in zip(left, right))
    return left == right


def _local_locator(value):
    _need(type(value) is str and 0 < len(value) <= 4096 and os.path.isabs(value)
          and not value.startswith(("\\\\", "//")) and not any(ord(c) < 32 or ord(c) == 127 for c in value))
    normalized = os.path.normpath(value)
    _need(os.path.dirname(normalized) != normalized)
    return value  # Lexical correlation only, never file/byte/native custody.


def _capture_staged(definition, raw):
    value = _copy(raw); _record(value, ("payload", "recipe", "outputDirectory"))
    expected = _copy(definition["request"])
    _need(type(expected["baseModel"]) is dict and set(expected["baseModel"]) <= {
        "modelRecordId", "provider", "modelId", "localPath", "inferenceMode"})
    _local_locator(expected["baseModel"].get("localPath"))
    _need(type(expected["output"]) is dict and set(expected["output"]) <= {"outputModelName", "maxShardSize", "destination"})
    output = _local_locator(value["outputDirectory"])
    _need(type(value["payload"]) is dict and type(value["payload"].get("datasets")) is list
          and len(value["payload"]["datasets"]) == len(expected["datasets"]))
    for original, staged, source in zip(expected["datasets"], value["payload"]["datasets"], definition["inputs"]):
        _need(type(original) is dict and set(original) <= {"artifactId", "splitRole", "format"} and type(staged) is dict)
        fmt = _MEDIA_FORMATS.get(source["mediaType"]); _need(fmt is not None)
        _need("format" not in original or original["format"] == fmt)
        original.update(format=fmt, path=_local_locator(staged.get("path")))
    expected["output"]["outputDirectory"] = output
    _need(_same(value["payload"], expected))
    recipe = _record(value["recipe"], ("path", "digest", "sizeBytes")); _local_locator(recipe["path"])
    _need(_same(recipe["digest"], definition["dataset"]["recipeDigest"])
          and _same(recipe["sizeBytes"], definition["recipeSizeBytes"]))
    return value


def _model_fields(instance, model_type, fields):
    _need(type(instance) is model_type)
    # Do not let an instance dump override or unvalidated construct fabricate
    # the compared data. Read only its closed raw model fields, then revalidate.
    data = object.__getattribute__(instance, "__dict__")
    _need(type(data) is dict and set(data) <= fields)
    extra = object.__getattribute__(instance, "__pydantic_extra__")
    _need(extra is None or type(extra) is dict and not extra)
    return dict(data)


def _native_request_data(instance, request_fields, model_fields, dataset_fields):
    data = _model_fields(instance, TrainModelTaskRequest, request_fields)
    data["baseModel"] = _model_fields(data.get("baseModel"), TrainModelBaseModelInput, model_fields)
    rows = data.get("datasets"); _need(type(rows) is list)
    data["datasets"] = [_model_fields(row, TrainModelDatasetInput, dataset_fields) for row in rows]
    return _copy(data)


def _compare_native_payload(expected, observed):
    expected, observed = _copy(expected), _copy(observed)
    _need(len(observed["datasets"]) == len(expected["datasets"]))
    for before, after in zip(expected["datasets"], observed["datasets"]):
        _local_locator(after.get("path")); before.pop("path", None); after.pop("path", None)
    _local_locator(observed["output"].get("outputDirectory"))
    expected["output"].pop("outputDirectory", None); observed["output"].pop("outputDirectory", None)
    _need(_same(expected, observed))


@dataclass(frozen=True)
class NativeTrainingProfile:
    """Required measured host configuration, not inferred production defaults."""
    profile_id: str
    fingerprint: str
    maximum_duration_seconds: int

    def __post_init__(self):
        _text(self.profile_id, 120)
        _need(type(self.fingerprint) is str and re.fullmatch(r"sha256:[a-f0-9]{64}", self.fingerprint) is not None)
        _need(type(self.maximum_duration_seconds) is int and 1 <= self.maximum_duration_seconds <= 86400)


class NativeTrainingResources(ABC):
    """Original native custody/reservation owner, captured before awaited IO.

    Actual implementations must prove Model/inputs/output identity, installed
    readiness, measured limits, exclusive reservation and retained byte accounting.
    settle is permanent and includes ALL original readers/IO; output accounting
    remains retained for a separately authorized Save/discard owner.
    """
    @abstractmethod
    def prepare(self) -> str: ...
    @abstractmethod
    def seal_inputs(self, staged: dict) -> TrainModelTaskRequest: ...
    @abstractmethod
    def borrow(self) -> AbstractContextManager: ...
    @abstractmethod
    def request_cancel(self) -> None: ...
    @abstractmethod
    def settle(self) -> bool: ...

    def output_delivery(self):
        """Optional original queue. JSON and default resources cannot supply it."""
        return None

    def original_files(self):
        """Optional genuine file owner, not a readiness or settlement boolean."""
        return None


_DEFAULT_OUTPUT_DELIVERY = NativeTrainingResources.output_delivery


def _capture_output_delivery(session, resource):
    # Retain resources before any optional callback; never invoke a property.
    _need(session.native is resource)
    if type(resource) is BoundedLocalTrainingResources:
        queue = resource.output_delivery()
        if queue is not None:
            _need(type(queue) is output_delivery.BoundedLocalTrainingOutputDelivery
                  and queue.belongs_to(resource, session.task_id) and session not in _local_output_sessions)
            _local_output_sessions[session] = (resource, queue, queue.read, queue.acknowledge, queue.abort,
                resource.deliver_outputs, _original_scopes[session])
        return
    selected = None
    bases = type.__getattribute__(type(resource), "__mro__")
    _need(len(bases) <= 8)
    for base in bases:
        value = type.__getattribute__(base, "__dict__").get("output_delivery")
        if value is not None:
            _need(type(value) is FunctionType)
            selected = MethodType(value, resource)
            break
    _need(selected is not None)
    if selected.__func__ is _DEFAULT_OUTPUT_DELIVERY:
        return  # Preserve the existing default path without another observer.
    original_scope = _original_scopes.get(session)
    _need(type(original_scope) is str and _scope_digest(session._sealed_definition)==original_scope)
    queue = selected()
    _need(session.native is resource and session._current())
    if queue is None:return
    record = _OUTPUT_RECORD(queue)
    with record["condition"]:
        _need(record["phase"] == "unbound" and record["family"] is None
              and record["task_id"] == session.task_id == session._sealed_definition["requestId"])
    with session.lock:
        _need(session not in _output_sessions and session.native is resource
              and _scope_digest(session._sealed_definition)==original_scope)
        _output_sessions[session] = {"resource": resource, "queue": queue, "record": record,
            "task_id": session.task_id, "request": None, "uncertain": False,
            "scope_digest": original_scope, "scope_owner": None}
        admitted = not session.cancelled and not session.settled and session.phase == "preparing"
    if not admitted:
        _abort_output(session)
        raise TrainingSessionError()


def _original_output_scope(record, binding):
    """Passive genuine lineage, never a live Native admission/IO proof on HTTP."""
    for cls,bases in _SCOPE_TYPES:
        current = type.__getattribute__(cls,"__mro__")
        _need(len(current)==len(bases) and all(a is b for a,b in zip(current,bases)))
    _need(all(type.__getattribute__(base,"__dict__").get(name) is original
              for base,name,original in _SCOPE_API))
    _need(native._model_leases is _MODEL_LEASES and native._verified_model_receivers is _MODEL_SOURCES
          and native._model_views is _MODEL_VIEWS and native._training_output_families is _OUTPUT_FAMILIES
          and native._output_family_record is _FAMILY_RECORD)
    family,book,view,model_binding = record["family"],record["book"],record["view"],record["binding"]
    _need(type(family) is _SCOPE_TYPES[0][0] and _FAMILY_RECORD(family) is book
          and type(book) is dict and type(model_binding) is tuple and len(model_binding)==3)
    lease = model_binding[0];_need(type(lease) is _SCOPE_TYPES[1][0])
    state = _MODEL_LEASES.get(lease);_need(type(state) is dict)
    source = state["source"];_need(type(source) is _SCOPE_TYPES[2][0])
    original = _MODEL_SOURCES.get(source);_need(type(original) is dict)
    _need(book["view"] is view and type(view) is _SCOPE_TYPES[3][0]
          and book["binding"] is model_binding and book["lease"] is lease and book["lease_state"] is state
          and state.get("output_copy_owner") is family
          and original["bound"] is True and original["lease_issued"] is True
          and original["native_owner"] is state["native_owner"]
          and original["task_id"] == binding["task_id"]
          and _same(book["request"],record["request"]))
    active = _MODEL_VIEWS.get(view)
    if record["phase"] in ("bound","active"):_need(active is model_binding)
    else:_need(active is None or active is model_binding)  # Terminal lineage survives borrow exit.
    definition = original["definition"]
    _need(_scope_digest(definition)==binding["scope_digest"])
    return family,book,view,model_binding,lease,state,source,original,definition


def _output_snapshot(session):
    _need(session._current())  # Do not hold a session/queue lock around callbacks.
    with session.lock:
        binding = _output_sessions.get(session)
        _need(binding is not None and not session.settled and not session.cancelled
              and binding["resource"] is session.native and not binding["uncertain"]
              and binding["task_id"] == session.task_id == session._sealed_definition["requestId"])
        _need(_original_scopes.get(session) is binding["scope_digest"]
              and _scope_digest(session._sealed_definition)==binding["scope_digest"])
    record = _OUTPUT_RECORD(binding["queue"])
    _need(record is binding["record"])
    with record["condition"]:
        _need(record["task_id"] == binding["task_id"])
        if record["request"] is not None:
            _need(binding["request"] is not None and _same(record["request"], binding["request"]))
            scope_owner = _original_output_scope(record,binding)
        else:
            _need(record["phase"] in ("unbound", "failed") and record["pending"] is None)
            scope_owner = None
    with session.lock:
        _need(_output_sessions.get(session) is binding and binding["resource"] is session.native
              and not session.settled and not session.cancelled and not binding["uncertain"])
        previous = binding["scope_owner"]
        if previous is None:
            if scope_owner is not None:binding["scope_owner"] = scope_owner
        else:
            _need(scope_owner is not None and len(previous)==len(scope_owner)
                  and all(a is b for a,b in zip(previous,scope_owner)))
    return binding


def _local_output_snapshot(session):
    _need(session._current())
    original = _local_output_sessions.get(session)
    _need(original is not None and original[0] is session.native and not session.settled and not session.cancelled
          and _original_scopes.get(session) is original[6] and _scope_digest(session._sealed_definition) == original[6]
          and original[1].belongs_to(original[0], session.task_id))
    return original


def _abort_output(session):
    local = _local_output_sessions.get(session)
    if local is not None:
        local[4]()
        return
    binding = _output_sessions.get(session)
    if binding is not None:
        try:_OUTPUT_ABORT(binding["queue"])
        except Exception:
            binding["uncertain"] = True
            raise


class NativeTrainingProducer(ABC):
    @property
    @abstractmethod
    def profile(self) -> NativeTrainingProfile: ...
    @abstractmethod
    def capture(self, definition: dict) -> NativeTrainingResources | None:
        """Synchronous binding only. No IO/acquisition. None proves no effect."""


@dataclass(frozen=True)
class BoundedLocalTrainingProfile:
    """Explicit cooperative profile. Not Native custody or a physical quota."""
    profile_id: str
    fingerprint: str
    maximum_duration_seconds: int
    staging_root: str
    maximum_model_bytes: int
    maximum_output_bytes: int
    minimum_free_bytes: int

    def __post_init__(self):
        NativeTrainingProfile(self.profile_id, self.fingerprint, self.maximum_duration_seconds)
        _need(self.profile_id.startswith("bounded-local-"))
        _local_locator(self.staging_root)
        _need(os.path.normpath(self.staging_root) == self.staging_root)
        for value in (self.maximum_model_bytes, self.maximum_output_bytes, self.minimum_free_bytes):
            _need(type(value) is int and 1 <= value <= 2**53 - 1)


_LOCAL_MODEL_NAMES = frozenset(("config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
    "special_tokens_map.json", "vocab.json", "merges.txt", "tokenizer.model", "model.safetensors"))


class BoundedLocalTrainingResources:
    """Read only Node-owned staging. The original parent owns cleanup and exit.

    There is deliberately no Native inheritance, deletion, recovery, public path
    report or claim that a cooperative SDK has an OS-enforced disk quota.
    """
    def __init__(self, definition, manifest, profile, *, deliver_output=False):
        _need(type(profile) is BoundedLocalTrainingProfile)
        _need(type(deliver_output) is bool)
        self.definition, self.profile = capture_definition(definition), profile
        copied = _copy(manifest)
        _record(copied, ("modelRecordId", "modelUpdatedAt", "directory", "files"))
        _need(copied["modelRecordId"] == self.definition["request"]["baseModel"]["modelRecordId"]
              and copied["modelUpdatedAt"] == self.definition["modelUpdatedAt"])
        self.model_directory = self._location(copied["directory"])
        _need(self.model_directory != self.definition["request"]["baseModel"].get("localPath"))
        rows = copied["files"]
        _need(type(rows) is list and 3 <= len(rows) <= len(_LOCAL_MODEL_NAMES))
        total, names = 0, set()
        for row in rows:
            _record(row, ("name", "sizeBytes", "sha256"))
            _need(type(row["name"]) is str and row["name"] in _LOCAL_MODEL_NAMES and row["name"] not in names)
            _need(type(row["sizeBytes"]) is int and 1 <= row["sizeBytes"] <= profile.maximum_model_bytes - total)
            _need(type(row["sha256"]) is str and re.fullmatch(r"sha256:[a-f0-9]{64}", row["sha256"]) is not None)
            names.add(row["name"]); total += row["sizeBytes"]
        _need({"config.json", "tokenizer.json", "model.safetensors"} <= names)
        self.manifest = copied
        self.lock = RLock()
        self.phase, self.cancelled, self.unknown = "bound", False, False
        self.operations, self.handles, self.directory_handles = 0, set(), set()
        self.started = monotonic()
        self.files, self.directories, self.output = {}, {}, None
        def current(): self._check()
        self.delivery = output_delivery.BoundedLocalTrainingOutputDelivery(self, self.definition["requestId"],
            maximum_files=256, maximum_payload_bytes=profile.maximum_output_bytes,
            deadline=self.started + profile.maximum_duration_seconds, current=current) if deliver_output else None

    def _location(self, value):
        _local_locator(value)
        _need(os.path.normpath(value) == value)
        if os.name == "nt":
            _drive, tail = os.path.splitdrive(value)
            _need(":" not in tail and all(not part.endswith((".", " ")) for part in Path(tail).parts))
        root = self.profile.staging_root
        _need(os.path.commonpath((root, value)) == root and value != root)
        return value

    def _check(self):
        with self.lock:
            _need(not self.cancelled and not self.unknown and self.phase != "settled"
                  and monotonic() - self.started < self.profile.maximum_duration_seconds)

    @staticmethod
    def _identity(info, *, directory=False):
        _need((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
              and not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400
              and info.st_ino > 0 and (directory or info.st_nlink == 1))
        if directory: return (info.st_dev, info.st_ino, info.st_mode)
        identity = (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size, info.st_mtime_ns)
        # Fresh Windows files can report different change times through path
        # and descriptor observations. Bind object/links/size/mtime plus actual
        # approved SHA256 bytes; no ctime field supplies cooperative custody.
        return identity if os.name == "nt" else (*identity, info.st_ctime_ns)

    def _directory(self, value):
        self._check()
        cursor = Path(value)
        for candidate in (cursor, *cursor.parents):
            self._check(); self._identity(os.lstat(candidate), directory=True)
        _need(os.path.realpath(value) == value)
        identity = self._identity(os.lstat(value), directory=True)
        previous = self.directories.get(value)
        _need(previous is None or previous == identity)
        self.directories[value] = identity

    def _entries(self, directory, maximum):
        self._check(); reader = os.scandir(directory); self.directory_handles.add(reader)
        try:
            entries = []
            for entry in reader:
                self._check(); _need(len(entries) < maximum); entries.append(entry.name)
            return entries
        finally:
            try: reader.close()
            except BaseException:
                self.unknown = True
                raise
            else: self.directory_handles.remove(reader)

    def _file(self, value, size, expected_hash):
        self._check(); self._directory(os.path.dirname(value))
        before = self._identity(os.lstat(value)); _need(before[4] == size)
        descriptor = os.open(value, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
        self.handles.add(descriptor)  # Original descriptor retained before any read.
        try:
            _need(self._identity(os.fstat(descriptor)) == before)
            digest, count = hashlib.sha256(), 0
            while True:
                self._check(); block = os.read(descriptor, min(65536, size - count + 1))
                if not block: break
                count += len(block); _need(count <= size); digest.update(block)
            _need(count == size and "sha256:" + digest.hexdigest() == expected_hash
                  and self._identity(os.fstat(descriptor)) == before
                  and self._identity(os.lstat(value)) == before)
            self._check(); self.files[value] = before
        finally:
            try: os.close(descriptor)
            except BaseException:
                self.unknown = True  # No retry or false handle-retirement credit.
                raise
            else: self.handles.remove(descriptor)

    @contextmanager
    def _operation(self, before, during, after):
        with self.lock:
            self._check(); _need(self.phase == before); self.phase = during; self.operations += 1
        try:
            yield
            self._check()
            with self.lock:
                _need(self.phase == during); self.phase = after
        except BaseException:
            # These fixed synchronous calls have returned. Only an unconfirmed
            # original handle close retains unknown IO, separately above.
            with self.lock: self.phase = "failed"
            raise
        finally:
            with self.lock: self.operations -= 1

    def prepare(self):
        try:
            with self._operation("bound", "preparing", "prepared"):
                self._directory(self.profile.staging_root); self._directory(self.model_directory)
                _need(set(self._entries(self.model_directory, len(self.manifest["files"]))) == {row["name"] for row in self.manifest["files"]})
                for row in self.manifest["files"]:
                    self._file(os.path.join(self.model_directory, row["name"]), row["sizeBytes"], row["sha256"])
        except Exception:
            if not self.unknown and not self.handles and not self.directory_handles and not self.operations: return "unavailable"
            raise
        return "ready"

    def seal_inputs(self, staged):
        with self._operation("prepared", "sealing", "sealed"):
            value = _capture_staged(self.definition, staged)
            output = self._location(value["outputDirectory"])
            self._directory(output); self._entries(output, 0)
            _need(os.path.commonpath((output, self.model_directory)) not in (output, self.model_directory))
            used = {self.model_directory, output}
            for row, source in zip(value["payload"]["datasets"], self.definition["inputs"]):
                location = self._location(row["path"]); _need(location not in used); used.add(location)
                _need(os.path.commonpath((output, location)) != output
                      and os.path.commonpath((self.model_directory, location)) != self.model_directory)
                self._file(location, source["sizeBytes"], source["digest"])
            recipe = value["recipe"]; location = self._location(recipe["path"])
            _need(location not in used and os.path.commonpath((output, location)) != output
                  and os.path.commonpath((self.model_directory, location)) != self.model_directory)
            self._file(location, recipe["sizeBytes"], recipe["digest"])
            self.output = output
            value["payload"]["baseModel"]["localPath"] = self.model_directory
            payload = TrainModelTaskRequest.model_validate(value["payload"])
        return payload

    @contextmanager
    def borrow(self):
        with self._operation("sealed", "borrowed", "returned"):
            for directory in tuple(self.directories): self._directory(directory)
            for location, identity in self.files.items():
                self._check(); _need(self._identity(os.lstat(location)) == identity)
            _need(self.output is not None); self._entries(self.output, 0)
            import shutil
            _need(shutil.disk_usage(self.profile.staging_root).free >=
                  self.profile.minimum_free_bytes + self.profile.maximum_output_bytes)
            yield None  # Explicit local loader path; never a forged Native Model view.
            # Cooperative SDK output is retained, never loaded or registered here.
            # This is a postflight limit, not a physical disk reservation.
            self._directory(self.output)
            pending, directories, count, total = [(self.output, 0)], 0, 0, 0
            while pending:
                directory, depth = pending.pop(); self._check()
                directories += 1; _need(directories <= 32 and depth <= 4)
                entries = self._entries(directory, 256)
                for name in entries:
                    self._check(); location = self._location(os.path.join(directory, name)); info = os.lstat(location)
                    if stat.S_ISDIR(info.st_mode):
                        self._identity(info, directory=True); pending.append((location, depth + 1))
                    else:
                        self._identity(info); count += 1; total += info.st_size
                        _need(count <= 256 and total <= self.profile.maximum_output_bytes)

    def request_cancel(self):
        with self.lock: self.cancelled = True
        if self.delivery is not None: self.delivery.abort()

    def settle(self):
        # Local quiescence only. Parent must still retire the original worker,
        # SDK and Job before cleanup, reuse, review or Save.
        with self.lock:
            if self.phase == "settled": return True
            if self.unknown or self.operations or self.handles or self.directory_handles or self.phase == "borrowed": return False
            if self.phase not in ("bound", "prepared", "sealed", "returned", "failed"): return False
            self.phase = "settled"; return True

    def output_delivery(self): return self.delivery

    def _read_output_file(self, location, identity, size):
        self._check(); self._directory(os.path.dirname(location))
        _need(self._identity(os.lstat(location)) == identity)
        descriptor = os.open(location, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
        self.handles.add(descriptor)
        try:
            _need(self._identity(os.fstat(descriptor)) == identity)
            count = 0
            while True:
                self._check(); block = os.read(descriptor, min(8192, size - count + 1))
                _need(type(block) is bytes)
                if not block: break
                count += len(block); _need(count <= size); yield block
            _need(count == size and self._identity(os.fstat(descriptor)) == identity
                  and self._identity(os.lstat(location)) == identity)
            self._check()
        finally:
            try: os.close(descriptor)
            except BaseException:
                self.unknown = True; raise
            else: self.handles.remove(descriptor)

    def deliver_outputs(self):
        _need(self.delivery is not None and self.delivery.belongs_to(self, self.definition["requestId"]))
        with self._operation("returned", "delivering", "returned"):
            _need(self.output is not None); self._directory(self.output)
            names = frozenset(("config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
                "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt", "model.safetensors",
                "adapter_config.json", "adapter_model.safetensors", "serialization_manifest.json", "training-run.json"))
            # Known SDK auxiliary state is retained under the original output
            # limits, never loaded or exported as a safe model candidate.
            auxiliary = frozenset(("training_args.bin", "optimizer.pt", "scheduler.pt", "rng_state.pth", "scaler.pt",
                "trainer_state.json", "tokenizer.model", "README.md", "chat_template.jinja",
                "model_validation_diff.json", "model_validation_report.md"))
            adapter = self.definition["request"]["method"] in ("lora", "qlora")
            required = {"adapter_config.json", "adapter_model.safetensors"} if adapter else {"config.json", "model.safetensors"}
            incompatible_weight = "model.safetensors" if adapter else "adapter_model.safetensors"
            roots = []
            entries = self._entries(self.output, 256)
            if "checkpoints" in entries:
                checkpoints = os.path.join(self.output, "checkpoints"); self._directory(checkpoints)
                children = self._entries(checkpoints, 31)
                _need(all(re.fullmatch(r"checkpoint-[1-9][0-9]{0,11}", name) is not None for name in children))
                for name in sorted(children, key=lambda value: int(value.split("-")[1])):
                    root = os.path.join(checkpoints, name); self._directory(root); roots.append(root)
            roots.append(self.output)
            manifest, sources, total = [], [], 0
            for group, root in enumerate(roots):
                entries = self._entries(root, 256); selected = set()
                for name in sorted(entries):
                    if root == self.output and name == "checkpoints": continue
                    _need(name in names or name in auxiliary)
                    location = os.path.join(root, name); identity = self._identity(os.lstat(location))
                    if name not in names: continue
                    size = identity[4]
                    _need(type(size) is int and 1 <= size <= self.profile.maximum_output_bytes - total and len(manifest) < 256)
                    checksum = hashlib.sha256()
                    for block in self._read_output_file(location, identity, size): checksum.update(block)
                    selected.add(name); total += size
                    sources.append((location, identity, size))
                    manifest.append({"fileIndex": len(manifest), "groupIndex": group, "name": name, "sizeBytes": size,
                        "sha256": "sha256:" + checksum.hexdigest(), "role": "candidate" if root == self.output else "checkpoint"})
                _need(required <= selected and incompatible_weight not in selected)
                if root == self.output: _need("tokenizer.json" in selected)
            def read_file(index):
                _need(type(index) is int and 0 <= index < len(sources))
                return self._read_output_file(*sources[index])
            self.delivery.deliver(self, manifest, read_file)


class BoundedLocalTrainingProducer:
    """Trusted boot-only policy. capture is synchronous binding, never IO."""
    def __init__(self, profile):
        _need(type(profile) is BoundedLocalTrainingProfile)
        self.profile = profile
        self.lock, self.requests, self.directories = RLock(), set(), set()

    def capture(self, definition, manifest, *, deliver_output=False):
        value = capture_definition(definition)
        resource = BoundedLocalTrainingResources(value, manifest, self.profile, deliver_output=deliver_output)
        with self.lock:
            _need(len(self.requests) < MAX_SESSIONS and value["requestId"] not in self.requests
                  and resource.model_directory not in self.directories)
            self.requests.add(value["requestId"]); self.directories.add(resource.model_directory)
        return resource


class OriginalTrainingSession:
    def __init__(self, definition, producer, current: Callable[[], bool], publish, submit, profile=None,
                 *, retirement_protocol="settled-v1", local_model=None, local_output_delivery=False):
        self.loader = train_model_from_local_files
        self.definition = capture_definition(definition)
        self._sealed_definition = _copy(self.definition)
        _original_scopes[self] = _scope_digest(self._sealed_definition)
        _session_exit.initialize(self, retirement_protocol)
        # Capture the actual schemas before any producer/profile callback. A
        # typed instance alone, or its replaceable dump method, is not a proof.
        self._request_validator = TrainModelTaskRequest.__pydantic_validator__.validate_python
        self._request_serializer = TrainModelTaskRequest.__pydantic_serializer__.to_python
        self._request_copy = TrainModelTaskRequest.model_copy
        self._model_view_resolver = resolve_original_model_view
        self._request_fields = frozenset(TrainModelTaskRequest.model_fields)
        self._model_fields = frozenset(TrainModelBaseModelInput.model_fields)
        self._dataset_fields = frozenset(TrainModelDatasetInput.model_fields)
        self.task_id = self.definition["requestId"]
        self.workspace_id = self.definition["workspaceId"]
        self.producer = producer
        self.profile = profile if profile is not None else producer.profile
        self._bounded_local = type(self.profile) is BoundedLocalTrainingProfile
        _need(type(local_output_delivery) is bool and (self._bounded_local or not local_output_delivery))
        _need(type(self.profile) is NativeTrainingProfile or self._bounded_local)
        if self._bounded_local:
            _need(type(producer) is BoundedLocalTrainingProducer and retirement_protocol == "settled-v1")
            _need(producer.profile is self.profile and local_model is not None)
            local_model = _copy(local_model)
        else: _need(local_model is None)
        self.current, self.publish, self.submit = current, publish, submit
        self.lock = RLock()
        _session_exit.capture_controls(self)
        self.phase = "bound"
        self.native = None
        self.payload = None
        self.future = None
        self.operations = 0
        self.issue_attempted = False
        self.run_entered = False
        self.run_returned = False
        self.known_not_run = False
        self.cancelled = False
        self.settled = False
        self.close_attempted = False
        self.cancel_attempted = False
        self.cancel_result = False
        self._worker_retirement_required = False
        self.started_at = None
        # Capture trusted methods and receivers before the first awaited IO.
        original_capture = producer.capture
        self.capture = (lambda definition: original_capture(definition, local_model, deliver_output=local_output_delivery)) if self._bounded_local else original_capture

    @property
    def retains_record(self):
        # No Save/output accounting authority exists in this protocol slice.
        return True

    @property
    def blocks_recovery(self):
        with self.lock:
            # Remote IO retirement never reopens this original worker. The
            # supervisor still owns its process/Job until actual retirement.
            return not self.settled or self._worker_retirement_required

    def _current(self):
        try:
            return self.current() is True
        except Exception:
            return False

    def prepare(self):
        _session_exit.assert_work(self)
        with self.lock:
            if self.phase != "bound":
                return self.phase
            self.phase = "preparing"; self.operations += 1
        try:
            _need(self._current())
            with self.lock:
                self._worker_retirement_required = True  # Before producer handoff.
            owner = self.capture(_copy(self.definition))
            if owner is None:
                with self.lock:
                    self._worker_retirement_required = False  # Positive no-effect only.
                    self.phase = "unavailable"; self.known_not_run = True; self.settled = True
                return "unavailable"
            if _session_exit.enabled(self):
                self.native = owner  # Retain before passive method admission.
                methods = _session_exit.capture_resource(self, owner)
                self.native_prepare, self.native_seal = methods["prepare"], methods["seal_inputs"]
                self.native_borrow, self.native_cancel, self.native_settle = methods["borrow"], methods["request_cancel"], methods["settle"]
            else:
                _need(type(owner) is BoundedLocalTrainingResources if self._bounded_local else isinstance(owner, NativeTrainingResources))
                self.native = owner  # Retain before optional callbacks or preparation IO.
                self.native_prepare, self.native_seal = owner.prepare, owner.seal_inputs
                self.native_borrow, self.native_cancel, self.native_settle = owner.borrow, owner.request_cancel, owner.settle
            _capture_output_delivery(self, owner)
            with self.lock:
                _need(not self.cancelled and not self.settled and self.phase == "preparing")
            _session_exit.assert_work(self)
            ready = self.native_prepare()
            _need(type(ready) is str and ready in ("ready", "unavailable", "unconfirmed"))
            current = self._current()
            with self.lock:
                _need(self.phase == "preparing" and not self.cancelled and not self.settled)
            if ready == "ready" and current:
                _session_exit.capture_files(self)
                if _session_exit.enabled(self):
                    current = self._current()
                    _need(current)
                    _session_exit.assert_work(self)
            with self.lock:
                _need(self.phase == "preparing" and not self.cancelled and not self.settled)
                self.phase = "prepared" if ready == "ready" and current else "unconfirmed"
            if ready == "unavailable":
                self.known_not_run = True
            return self.phase
        except Exception:
            if _session_exit.enabled(self): _session_exit.lost(self)
            with self.lock:
                self.phase = "unconfirmed"
            return "unconfirmed"
        finally:
            with self.lock:
                self.operations -= 1

    def seal(self, raw):
        _session_exit.assert_work(self); _session_exit.assert_thread(self)
        _need(self._current())
        with self.lock:
            _need(self.phase == "prepared" and not self.settled and not self.cancelled)
            self.phase = "sealing"; self.operations += 1
        try:
            staged = _capture_staged(self._sealed_definition, raw)
            expected = _copy(self._request_serializer(self._request_validator(staged["payload"]), mode="json"))
            _need(self._current())
            with self.lock:
                _need(self.phase == "sealing" and not self.cancelled and not self.settled)
            _session_exit.assert_work(self)
            payload = self.native_seal(_copy(staged))
            _need(self._current())
            owned = _native_request_data(payload, self._request_fields, self._model_fields, self._dataset_fields)
            payload = self._request_validator(owned)
            if self._bounded_local:
                _need(type(self.native) is BoundedLocalTrainingResources)
                expected["baseModel"]["localPath"] = self.native.model_directory
            _compare_native_payload(expected, self._request_serializer(payload, mode="json"))
            _session_exit.sealed(self, self._request_serializer(payload, mode="json"))
            _need(self._current())
            with self.lock:
                _need(self.phase == "sealing" and not self.cancelled and not self.settled)
                binding = _output_sessions.get(self)
                if binding is not None:
                    _need(binding["resource"] is self.native and binding["request"] is None)
                    binding["request"] = _copy(self._request_serializer(payload, mode="json"))
                self.payload = payload; self.phase = "ready"
            return "ready"
        except Exception:
            if _session_exit.enabled(self): _session_exit.lost(self)
            with self.lock:
                self.phase = "unconfirmed"
            return "unconfirmed"
        finally:
            with self.lock:
                self.operations -= 1

    def start(self):
        _session_exit.assert_work(self)
        _need(self._current())
        with self.lock:
            _need(self.phase == "ready" and not self.issue_attempted and not self.settled and not self.cancelled)
            _session_exit.dispatch_attempted(self)
            self.issue_attempted = True; self.phase = "issuing"; self.operations += 1
        try:
            # submit is the existing executor's trusted original-record binding.
            # A raised submit may have queued this exact owner: never retry it.
            future = self.submit(self)
            _need(isinstance(future, Future))
            _session_exit.capture_future(self, future)
            with self.lock:
                self.future = future
                if self.phase == "issuing":
                    self.phase = "accepted"
            return {"kind": "accepted", "requestId": self.task_id, "workspaceId": self.workspace_id, "status": "running"}
        except Exception:
            with self.lock:
                if not self.run_returned:
                    self.phase = "unconfirmed"
            return {"kind": "unconfirmed"}
        finally:
            with self.lock:
                self.operations -= 1

    def run(self):
        _session_exit.run_entered(self)
        with self.lock:
            _need(not self.run_entered and not self.settled and self.issue_attempted)
            self.run_entered = True; self.operations += 1; self.started_at = monotonic()
        def progress(value):
            if not self._current() or self.cancelled or monotonic() - self.started_at > self.profile.maximum_duration_seconds:
                raise TrainingCancellationRequested()
            self.publish(progress=_copy(value))
        successful = False
        try:
            progress({"stage": "starting"})
            self.publish(status="running")
            _session_exit.assert_work(self)
            with self.native_borrow() as model_view:
                progress({"stage": "training"})
                owned = _native_request_data(self.payload, self._request_fields, self._model_fields, self._dataset_fields)
                payload = self._request_validator(owned)
                if self._bounded_local:
                    _need(model_view is None and type(self.native) is BoundedLocalTrainingResources
                          and payload.baseModel.localPath == self.native.model_directory)
                else:
                    self._model_view_resolver(model_view, _copy(self._request_serializer(payload, mode="json")))
                # Fixed safe loader; a request cannot select a callable or score
                # a real validation baseline through this workflow protocol.
                result = self.loader(self._request_copy(payload, deep=True), on_progress=progress,
                    compare_validation_baseline=False, _model_view=model_view)
            if result.status == "succeeded" and _local_output_sessions.get(self) is not None:
                local = _local_output_snapshot(self)
                local[5]()
                _need(_local_output_snapshot(self) is local and local[2]()["phase"] == "complete")
            if result.status == "succeeded" and _output_sessions.get(self) is not None:
                binding = _output_snapshot(self)
                _need(_OUTPUT_READ(binding["queue"])["phase"] == "complete")
                _output_snapshot(self)
            data = result.model_dump(mode="json", exclude_none=True)
            data["runId"] = self.task_id
            _need(result.status in ("succeeded", "failed", "cancelled"))
            self.publish(status="cancelled" if self.cancelled else result.status, data=None if self.cancelled else data)
            successful = result.status == "succeeded" and not self.cancelled
        except TrainingCancellationRequested:
            self.publish(status="cancelled", data=None)
        except Exception:
            if self._bounded_local and self.cancelled:
                self.publish(status="cancelled", data=None)
            else:
                self.publish(status="failed", data=None, error={"code": "private_training_failed", "message": "The private training task could not finish."})
        finally:
            if not successful:
                try:_abort_output(self)
                except Exception:pass  # Unknown retains resources and denies settlement.
            with self.lock:
                self.run_returned = True; self.operations -= 1
                if self.phase != "settled":
                    self.phase = "terminal"
            _session_exit.run_returned(self)

    def cancel(self):
        _session_exit.assert_cancel(self)
        with self.lock:
            if self.settled or self.cancel_attempted:
                return self.cancel_result
            _session_exit.cancel_started(self)
            self.cancel_attempted = True
            self.operations += 1
            self.cancelled = True
            if not self.issue_attempted:
                self.known_not_run = True
            not_issued = not self.issue_attempted
            future = self.future
        cancel_succeeded = False
        try:
            if future is not None and future.cancel():
                with self.lock:
                    self.known_not_run = True
                self.publish(status="cancelled", data=None)
            elif not_issued:
                self.publish(status="cancelled", data=None)
            try:
                _abort_output(self)
            finally:
                # Native cancellation still runs if queue abortion is uncertain.
                # Neither operation proves stopped IO or grants resource credit.
                if self.native is not None:
                    result = self.native_cancel()
                    if _session_exit.enabled(self):
                        _need(result is None)  # A pending/invalid reply proves no ACK.
            cancel_succeeded = True
            self.cancel_result = True
            return True
        except Exception:
            # A lost cancellation acknowledgement cannot repeat the effect.
            return False
        finally:
            with self.lock:
                # The resource callback may change public fields or fail after
                # an effect. Only this local normal-return latch is an ACK.
                self.cancel_result = cancel_succeeded
                _session_exit.cancel_returned(self,cancel_succeeded)
                self.operations -= 1

    def settle(self):
        if _session_exit.enabled(self):
            return False  # Local readiness is never global/permanent settlement.
        local = _local_output_sessions.get(self)
        if local is not None:
            try:
                _need(local[0] is self.native and local[1].belongs_to(local[0], self.task_id)
                      and local[2]()["phase"] in ("complete", "failed"))
            except Exception: return False
        binding = _output_sessions.get(self)
        if binding is not None:
            try:
                _need(not binding["uncertain"] and _OUTPUT_RECORD(binding["queue"]) is binding["record"]
                      and _OUTPUT_READ(binding["queue"])["phase"] in ("complete", "failed"))
            except Exception:return False
        with self.lock:
            if self.settled:
                return True
            if self.operations or self.close_attempted or not (self.run_returned or self.known_not_run):
                return False
            self.close_attempted = True
        try:
            _need(self.native is not None and self.native_settle() is True)
            with self.lock:
                self.settled = True; self.phase = "settled"
            return True
        except Exception:
            with self.lock:
                self.phase = "unconfirmed"
            return False

    def read_output(self):
        if self in _local_output_sessions:
            local = _local_output_snapshot(self); result = _copy(local[2]())
            _need(_local_output_snapshot(self) is local); return result
        binding = _output_snapshot(self)
        result = _copy(_OUTPUT_READ(binding["queue"]))
        _need(_output_snapshot(self) is binding)
        return result

    def acknowledge_output(self, sequence):
        _need(type(sequence) is int and 1 <= sequence <= 2**53 - 1)
        if self in _local_output_sessions:
            local = _local_output_snapshot(self); result = local[3](sequence)
            _need(result is True and _local_output_snapshot(self) is local); return True
        binding = _output_snapshot(self)
        result = _OUTPUT_ACK(binding["queue"], sequence)
        _need(result is True and _output_snapshot(self) is binding)
        return True

    def begin_exit_ready(self):
        return _session_exit.begin(self)

    def finish_exit_ready(self):
        return _session_exit.finish(self)

    def mark_exit_ready_lost(self):
        _session_exit.lost(self)


# The fixed helper captures the actual class after its methods exist. It adds
# no producer, executor, model, process or default host activation.
from . import original_training_session_exit as _session_exit


# Load only after the session/exit classes have captured their original APIs.
# This is private composition; it never installs or configures a producer.
from . import original_training_files as _training_files

_FILE_RECORD = _training_files._record
_FILE_SNAPSHOT = _training_files._snapshot
_FILE_BINDINGS = _training_files._bindings
_FILE_LOCKS = _training_files._file_locks
_FILE_TYPE = _training_files.OriginalTrainingFiles
_FILE_PREPARE = _FILE_TYPE.prepare
_FILE_BORROW = _FILE_TYPE.borrow
_FILE_CANCEL = _FILE_TYPE.request_cancel
_file_resources = WeakKeyDictionary()
_file_resource_files = WeakKeyDictionary()


def _file_resource_api(owner):
    _need(type(owner) is OriginalTrainingFileResources)
    bases = type.__getattribute__(OriginalTrainingFileResources, "__mro__")
    _need(len(bases) == len(_FILE_RESOURCE_MRO) and all(a is b for a, b in zip(bases, _FILE_RESOURCE_MRO)))
    _need(all(
        type.__getattribute__(base, "__dict__").get(name) is original
        for base, name, original in _FILE_RESOURCE_API))
    _need(_training_files._record is _FILE_RECORD and _training_files._snapshot is _FILE_SNAPSHOT
          and _training_files._bindings is _FILE_BINDINGS and _training_files._file_locks is _FILE_LOCKS
          and _training_files.OriginalTrainingFiles is _FILE_TYPE
          and _FILE_TYPE.prepare is _FILE_PREPARE and _FILE_TYPE.borrow is _FILE_BORROW
          and _FILE_TYPE.request_cancel is _FILE_CANCEL)


def _file_resource_state(owner):
    _file_resource_api(owner)  # Before any weak-key hash/equality operation.
    book = _file_resources.get(owner)
    _need(type(book) is dict and type(book.get("file")) is _FILE_TYPE
          and type(book.get("thread")) is int and book["thread"] > 0
          and type(book.get("phase")) is str
          and book["phase"] in ("bound", "prepared", "sealing", "sealed", "borrow-issued", "unconfirmed")
          and type(book.get("cancel_attempted")) is bool
          and type(book.get("cancel_acknowledged")) is bool
          and (not book["cancel_acknowledged"] or book["cancel_attempted"]))
    try:
        record = _FILE_RECORD(book["file"])
        _need(record is book["record"])
        # This fixed passive snapshot validates the original record's exact
        # primitive types before we compare or test any of its fields.
        _FILE_SNAPSHOT(book["file"], record)
        _need(_file_resource_files.get(book["file"]) is owner
              and _FILE_BINDINGS.get(book["file"]) is book["binding"]
              and _FILE_LOCKS.get(book["file"]) is book["lock"]
              and record["lock"] is book["lock"]
              and record["thread"] == book["thread"]
              and record["delivery"] is book["delivery"])
    except Exception:
        raise TrainingSessionError() from None
    return book


def _file_resource_bound(book):
    record = book["record"]
    _need(get_ident() == book["thread"] and not book["cancel_attempted"]
          and record["phase"] == "bound" and not record["cancelled"]
          and not record["closed"] and not record["poisoned"])


class OriginalTrainingFileResources(NativeTrainingResources):
    """Fixed local file/session bridge, not a complete readiness producer.

    The outer trusted producer must independently own qualified capacity and
    profile/admission. Local prepare performs passive binding checks only. All
    copy/borrow effects still pass the genuine file owner's existing controls.
    Retained files, charges and global settlement remain separately owned.
    """
    def __init__(self, original_files):
        _file_resource_api(self)
        _need(type(original_files) is _FILE_TYPE)
        try:
            record = _FILE_RECORD(original_files)
            _FILE_SNAPSHOT(original_files, record)
            _need(original_files not in _file_resource_files and self not in _file_resources)
            book = {"file": original_files, "record": record,
                "binding": _FILE_BINDINGS.get(original_files), "lock": _FILE_LOCKS.get(original_files),
                "thread": record["thread"], "delivery": record["delivery"], "phase": "bound",
                "cancel_attempted": False, "cancel_acknowledged": False}
            _need(book["lock"] is record["lock"] and get_ident() == book["thread"])
            _file_resource_bound(book)
            _file_resources[self] = book
            _file_resource_files[original_files] = self
            _file_resource_state(self)
        except Exception:
            raise TrainingSessionError() from None

    def prepare(self):
        book = _file_resource_state(self)
        with book["lock"]:
            _file_resource_bound(book)
            _need(book["phase"] == "bound")
            # No _admitted callback while Files is bound: a caught direct
            # prepare reentry must not consume its original effect attempt.
            book["phase"] = "prepared"
        return "ready"  # Local staging only, not physical resource readiness.

    def seal_inputs(self, staged):
        book = _file_resource_state(self)
        with book["lock"]:
            _file_resource_bound(book)
            _need(book["phase"] == "prepared")
            book["phase"] = "sealing"  # Own the original attempt before effects.
        try:
            payload = _FILE_PREPARE(book["file"], staged)
            _need(_file_resource_state(self) is book)
            with book["lock"]:
                _need(book["phase"] == "sealing" and not book["cancel_attempted"]
                      and book["record"]["phase"] == "prepared" and type(payload) is TrainModelTaskRequest)
                book["phase"] = "sealed"
            return payload
        except BaseException:
            book["phase"] = "unconfirmed"
            raise

    def borrow(self):
        book = _file_resource_state(self)
        with book["lock"]:
            _need(get_ident() == book["thread"] and book["phase"] == "sealed"
                  and not book["cancel_attempted"] and book["record"]["phase"] == "prepared")
            book["phase"] = "borrow-issued"
        # The genuine one-use context owns the joint borrow and output closure.
        # Session.run, not Files.run, remains the only fixed loader invocation.
        return _FILE_BORROW(book["file"])

    def request_cancel(self):
        book = _file_resource_state(self)
        with book["lock"]:
            if book["cancel_attempted"]:
                _need(book["cancel_acknowledged"])
                return
            book["cancel_attempted"] = True
        # Original retained cleanup needs no new business grant or thread handoff.
        _need(_FILE_CANCEL(book["file"]) is None)
        _need(_file_resource_state(self) is book)
        book["cancel_acknowledged"] = True

    def settle(self):
        return False  # File/output IO closure is never SDK/worker/Job settlement.

    def original_files(self):
        return _file_resource_state(self)["file"]

    def output_delivery(self):
        return _file_resource_state(self)["delivery"]


_FILE_RESOURCE_MRO = type.__getattribute__(OriginalTrainingFileResources, "__mro__")
_FILE_RESOURCE_API = tuple((base, name, type.__getattribute__(base, "__dict__").get(name))
    for base in _FILE_RESOURCE_MRO
    for name in ("__getattribute__", "__getattr__", "__hash__", "__eq__", "__dict__", "__init__",
        "prepare", "seal_inputs", "borrow", "request_cancel", "settle", "original_files", "output_delivery"))


_FILE_PRODUCER_RESOURCE_STATE = _file_resource_state
_FILE_PRODUCER_RESOURCE_BOUND = _file_resource_bound
_FILE_PRODUCER_DEFINITION = capture_definition
_FILE_PRODUCER_DIGEST = _scope_digest
_FILE_PRODUCER_PROFILE_TYPE = NativeTrainingProfile
_FILE_PRODUCER_PROFILE_MRO = type.__getattribute__(NativeTrainingProfile, "__mro__")
_FILE_PRODUCER_PROFILE_API = tuple((base, name, type.__getattribute__(base, "__dict__").get(name))
    for base in _FILE_PRODUCER_PROFILE_MRO
    for name in ("__getattribute__", "__getattr__", "__dict__", "__new__", "__init__", "__post_init__",
        "profile_id", "fingerprint", "maximum_duration_seconds"))
_file_producers = WeakKeyDictionary()
_file_producer_resources = WeakKeyDictionary()


def _file_producer_api(owner):
    _need(type(owner) is OriginalTrainingFileProducer)
    bases = type.__getattribute__(OriginalTrainingFileProducer, "__mro__")
    _need(len(bases) == len(_FILE_PRODUCER_MRO) and all(a is b for a, b in zip(bases, _FILE_PRODUCER_MRO)))
    _need(all(type.__getattribute__(base, "__dict__").get(name) is original
              for base, name, original in _FILE_PRODUCER_API))
    _need(_file_resource_state is _FILE_PRODUCER_RESOURCE_STATE
          and _file_resource_bound is _FILE_PRODUCER_RESOURCE_BOUND
          and capture_definition is _FILE_PRODUCER_DEFINITION
          and _scope_digest is _FILE_PRODUCER_DIGEST
          and NativeTrainingProfile is _FILE_PRODUCER_PROFILE_TYPE)
    current = type.__getattribute__(NativeTrainingProfile, "__mro__")
    _need(len(current) == len(_FILE_PRODUCER_PROFILE_MRO)
          and all(a is b for a, b in zip(current, _FILE_PRODUCER_PROFILE_MRO)))
    _need(all(type.__getattribute__(base, "__dict__").get(name) is original
              for base, name, original in _FILE_PRODUCER_PROFILE_API))


def _file_producer_record(owner):
    _file_producer_api(owner)  # Refuse replaced hash/getter APIs before lookup.
    book = _file_producers.get(owner)
    _need(type(book) is dict and type(book.get("phase")) is str
          and book["phase"] in ("bound", "capturing", "captured", "unconfirmed")
          and type(book.get("thread")) is int and book["thread"] > 0
          and type(book.get("definition")) is str
          and re.fullmatch(r"[a-f0-9]{64}", book["definition"]) is not None
          and type(book.get("profile")) is tuple and len(book["profile"]) == 3)
    resource_book = _FILE_PRODUCER_RESOURCE_STATE(book["resource"])
    _need(resource_book is book["resource_book"] and resource_book["binding"] is book["binding"]
          and resource_book["lock"] is book["lock"] and resource_book["thread"] == book["thread"]
          and _file_producer_resources.get(book["resource"]) is owner)
    _need(_FILE_PRODUCER_DIGEST(resource_book["record"]["definition"]) == book["definition"])
    profile_id, fingerprint, duration = book["profile"]
    _text(profile_id, 120)
    _need(type(fingerprint) is str and re.fullmatch(r"sha256:[a-f0-9]{64}", fingerprint) is not None
          and type(duration) is int and 1 <= duration <= 86400)
    return book


class OriginalTrainingFileProducer(NativeTrainingProducer):
    """One exact original file resource; not physical readiness or activation.

    Trusted host composition must still qualify the explicit profile, capacity,
    installed runtime and original controller/worker transport. This local
    producer invokes no authority callback, file IO or loader during capture.
    """
    def __init__(self, resource, profile):
        _file_producer_api(self)
        _need(type(profile) is _FILE_PRODUCER_PROFILE_TYPE)
        values = _copy(object.__getattribute__(profile, "__dict__"))
        _record(values, ("profile_id", "fingerprint", "maximum_duration_seconds"))
        # Validate and copy values, never retain a caller-mutable profile record.
        captured = _FILE_PRODUCER_PROFILE_TYPE(**values)
        resource_book = _FILE_PRODUCER_RESOURCE_STATE(resource)
        with resource_book["lock"]:
            _FILE_PRODUCER_RESOURCE_BOUND(resource_book)
            _need(resource_book["phase"] == "bound" and self not in _file_producers
                  and resource not in _file_producer_resources)
            definition = _FILE_PRODUCER_DEFINITION(resource_book["record"]["definition"])
            book = {"resource": resource, "resource_book": resource_book,
                "binding": resource_book["binding"], "lock": resource_book["lock"],
                "thread": resource_book["thread"], "phase": "bound",
                "definition": _FILE_PRODUCER_DIGEST(definition),
                "profile": (captured.profile_id, captured.fingerprint, captured.maximum_duration_seconds)}
            _file_producers[self] = book
            _file_producer_resources[resource] = self
            _file_producer_record(self)

    @property
    def profile(self):
        book = _file_producer_record(self)
        return _FILE_PRODUCER_PROFILE_TYPE(*book["profile"])

    def capture(self, definition):
        book = _file_producer_record(self)
        _need(get_ident() == book["thread"])
        supplied = _FILE_PRODUCER_DEFINITION(definition)
        _need(_FILE_PRODUCER_DIGEST(supplied) == book["definition"])
        with book["lock"]:
            _need(book["phase"] == "bound")
            book["phase"] = "capturing"  # Consume the exact attempt before binding.
            try:
                _need(_file_producer_record(self) is book)
                _FILE_PRODUCER_RESOURCE_BOUND(book["resource_book"])
                _need(book["resource_book"]["phase"] == "bound")
                book["phase"] = "captured"
                return book["resource"]
            except BaseException:
                book["phase"] = "unconfirmed"
                raise


_FILE_PRODUCER_MRO = type.__getattribute__(OriginalTrainingFileProducer, "__mro__")
_FILE_PRODUCER_API = tuple((base, name, type.__getattribute__(base, "__dict__").get(name))
    for base in _FILE_PRODUCER_MRO
    for name in ("__getattribute__", "__getattr__", "__hash__", "__eq__", "__dict__",
        "__init__", "profile", "capture"))


_FILE_COMPOSITION_CONFIGURATION = native.read_original_training_worker_configuration
_FILE_COMPOSITION_LEASE = native._capture_original_training_file_lease
_FILE_COMPOSITION_FILE_API = _training_files._api
_FILE_COMPOSITION_FILE_INIT = _FILE_TYPE.__init__
_FILE_COMPOSITION_RESOURCE_TYPE = OriginalTrainingFileResources
_FILE_COMPOSITION_RESOURCE_API = _file_resource_api
_FILE_COMPOSITION_RESOURCE_INIT = OriginalTrainingFileResources.__init__
_FILE_COMPOSITION_PRODUCER_TYPE = OriginalTrainingFileProducer
_FILE_COMPOSITION_PRODUCER_API = _file_producer_api
_FILE_COMPOSITION_PRODUCER_INIT = OriginalTrainingFileProducer.__init__


def compose_original_training_file_producer(lease, profile, reservation, admission, *, delivery=None):
    """Bind existing protected components from the original private layout.

    Reservation/admission must already be genuinely owned by trusted composition.
    This passive helper creates no capacity, readiness, activation or IO. The
    existing Files latch retains a partial binding rather than minting a retry.
    """
    try:
        _need(native.read_original_training_worker_configuration is _FILE_COMPOSITION_CONFIGURATION
              and native._capture_original_training_file_lease is _FILE_COMPOSITION_LEASE
              and _training_files.OriginalTrainingFiles is _FILE_TYPE
              and _training_files._api is _FILE_COMPOSITION_FILE_API
              and _FILE_TYPE.__init__ is _FILE_COMPOSITION_FILE_INIT
              and OriginalTrainingFileResources is _FILE_COMPOSITION_RESOURCE_TYPE
              and _file_resource_api is _FILE_COMPOSITION_RESOURCE_API
              and OriginalTrainingFileProducer is _FILE_COMPOSITION_PRODUCER_TYPE
              and _file_producer_api is _FILE_COMPOSITION_PRODUCER_API)
        # Bypass class __new__ hooks; the existing API pins cover each actual
        # initializer and passive lookup before any weak-key record is touched.
        producer = object.__new__(_FILE_COMPOSITION_PRODUCER_TYPE)
        resource = object.__new__(_FILE_COMPOSITION_RESOURCE_TYPE)
        _FILE_COMPOSITION_PRODUCER_API(producer)
        _FILE_COMPOSITION_RESOURCE_API(resource)
        _FILE_COMPOSITION_FILE_API()
        _need(type(profile) is _FILE_PRODUCER_PROFILE_TYPE)
        values = _copy(object.__getattribute__(profile, "__dict__"))
        _record(values, ("profile_id", "fingerprint", "maximum_duration_seconds"))
        captured_profile = _FILE_PRODUCER_PROFILE_TYPE(**values)
        configuration = _FILE_COMPOSITION_CONFIGURATION(lease)
        _need(type(configuration) is dict
              and configuration["profileFingerprint"] == captured_profile.fingerprint)
        state, source_record, source, _ = _FILE_COMPOSITION_LEASE(lease)
        lock = state["lock"]
        _need(lock.acquire(blocking=False))
        try:
            current = _FILE_COMPOSITION_LEASE(lease)
            _need(all(actual is original for actual, original in
                      zip(current[:3], (state, source_record, source))))
            _need(_same(_FILE_COMPOSITION_CONFIGURATION(lease), configuration))
            job = _copy(object.__getattribute__(source, "__dict__")["profile"])
            _need(type(job["maximumDurationMs"]) is int
                  and captured_profile.maximum_duration_seconds * 1000 <= job["maximumDurationMs"])
            original_files = object.__new__(_FILE_TYPE)
            _FILE_COMPOSITION_FILE_INIT(original_files, lease,
                configuration["inputCopy"], configuration["outputFamily"], reservation, admission, delivery=delivery)
            _FILE_COMPOSITION_RESOURCE_INIT(resource, original_files)
            _FILE_COMPOSITION_PRODUCER_INIT(producer, resource, captured_profile)
            # Keep the original lock through final revalidation. A changed or
            # consumed binding cannot return a usable producer or be retried.
            _need(_same(_FILE_COMPOSITION_CONFIGURATION(lease), configuration))
            return producer
        finally:
            lock.release()
    except Exception:
        raise TrainingSessionError() from None
