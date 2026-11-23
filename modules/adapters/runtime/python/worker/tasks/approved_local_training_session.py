"""Private original training ownership; no configured native producer by default.

The producer is trusted application composition, never request JSON. It must own
the exact native source/input/output graph, exclusive resource reservation and
permanent IO retirement. This module does not implement or qualify that proof.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
from concurrent.futures import Future
from dataclasses import dataclass
import json
import os
import re
from threading import RLock
from time import monotonic
from typing import Callable
from uuid import UUID

from ..models import TrainModelTaskRequest, TrainModelBaseModelInput, TrainModelDatasetInput
from .train_model import TrainingCancellationRequested, train_model_from_local_files

CAPABILITY = "train-model.original-session-v1"
MAX_BODY_BYTES = 128 * 1024
MAX_SESSIONS = 256


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


class NativeTrainingProducer(ABC):
    @property
    @abstractmethod
    def profile(self) -> NativeTrainingProfile: ...
    @abstractmethod
    def capture(self, definition: dict) -> NativeTrainingResources | None:
        """Synchronous binding only. No IO/acquisition. None proves no effect."""


class OriginalTrainingSession:
    def __init__(self, definition, producer, current: Callable[[], bool], publish, submit, profile=None):
        self.loader = train_model_from_local_files
        self.definition = capture_definition(definition)
        self._sealed_definition = _copy(self.definition)
        # Capture the actual schemas before any producer/profile callback. A
        # typed instance alone, or its replaceable dump method, is not a proof.
        self._request_validator = TrainModelTaskRequest.__pydantic_validator__.validate_python
        self._request_serializer = TrainModelTaskRequest.__pydantic_serializer__.to_python
        self._request_fields = frozenset(TrainModelTaskRequest.model_fields)
        self._model_fields = frozenset(TrainModelBaseModelInput.model_fields)
        self._dataset_fields = frozenset(TrainModelDatasetInput.model_fields)
        self.task_id = self.definition["requestId"]
        self.workspace_id = self.definition["workspaceId"]
        self.producer = producer
        self.profile = profile if profile is not None else producer.profile
        _need(type(self.profile) is NativeTrainingProfile)
        self.current, self.publish, self.submit = current, publish, submit
        self.lock = RLock()
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
        self.capture = producer.capture

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
            _need(isinstance(owner, NativeTrainingResources))
            self.native_prepare, self.native_seal = owner.prepare, owner.seal_inputs
            self.native_borrow, self.native_cancel, self.native_settle = owner.borrow, owner.request_cancel, owner.settle
            self.native = owner  # Original methods/retirement owner BEFORE prepare IO.
            ready = self.native_prepare()
            _need(type(ready) is str and ready in ("ready", "unavailable", "unconfirmed"))
            current = self._current()
            with self.lock:
                self.phase = "prepared" if ready == "ready" and current else "unconfirmed"
            if ready == "unavailable":
                self.known_not_run = True
            return self.phase
        except Exception:
            with self.lock:
                self.phase = "unconfirmed"
            return "unconfirmed"
        finally:
            with self.lock:
                self.operations -= 1

    def seal(self, raw):
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
            payload = self.native_seal(_copy(staged))
            _need(self._current())
            owned = _native_request_data(payload, self._request_fields, self._model_fields, self._dataset_fields)
            payload = self._request_validator(owned)
            _compare_native_payload(expected, self._request_serializer(payload, mode="json"))
            _need(self._current())
            with self.lock:
                _need(self.phase == "sealing" and not self.cancelled and not self.settled)
                self.payload = payload; self.phase = "ready"
            return "ready"
        except Exception:
            with self.lock:
                self.phase = "unconfirmed"
            return "unconfirmed"
        finally:
            with self.lock:
                self.operations -= 1

    def start(self):
        _need(self._current())
        with self.lock:
            _need(self.phase == "ready" and not self.issue_attempted and not self.settled and not self.cancelled)
            self.issue_attempted = True; self.phase = "issuing"; self.operations += 1
        try:
            # submit is the existing executor's trusted original-record binding.
            # A raised submit may have queued this exact owner: never retry it.
            future = self.submit(self)
            _need(isinstance(future, Future))
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
        with self.lock:
            _need(not self.run_entered and not self.settled and self.issue_attempted)
            self.run_entered = True; self.operations += 1; self.started_at = monotonic()
        def progress(value):
            if not self._current() or self.cancelled or monotonic() - self.started_at > self.profile.maximum_duration_seconds:
                raise TrainingCancellationRequested()
            self.publish(progress=_copy(value))
        try:
            progress({"stage": "starting"})
            self.publish(status="running")
            with self.native_borrow():
                progress({"stage": "training"})
                # Fixed safe loader; a request cannot select a callable or score
                # a real validation baseline through this workflow protocol.
                result = self.loader(self.payload.model_copy(deep=True), on_progress=progress,
                                                     compare_validation_baseline=False)
            data = result.model_dump(mode="json", exclude_none=True)
            data["runId"] = self.task_id
            _need(result.status in ("succeeded", "failed", "cancelled"))
            self.publish(status="cancelled" if self.cancelled else result.status, data=None if self.cancelled else data)
        except TrainingCancellationRequested:
            self.publish(status="cancelled", data=None)
        except Exception:
            self.publish(status="failed", data=None, error={"code": "private_training_failed", "message": "The private training task could not finish."})
        finally:
            with self.lock:
                self.run_returned = True; self.operations -= 1
                if self.phase != "settled":
                    self.phase = "terminal"

    def cancel(self):
        with self.lock:
            if self.settled or self.cancel_attempted:
                return self.cancel_result
            self.cancel_attempted = True
            self.operations += 1
            self.cancelled = True
            if not self.issue_attempted:
                self.known_not_run = True
            future = self.future
        try:
            if future is not None and future.cancel():
                with self.lock:
                    self.known_not_run = True
                self.publish(status="cancelled", data=None)
            # Native cancellation is a request, never proof of stopped IO.
            if self.native is not None:
                self.native_cancel()
            self.cancel_result = True
            return True
        except Exception:
            # A lost cancellation acknowledgement cannot repeat the effect.
            return False
        finally:
            with self.lock:
                self.operations -= 1

    def settle(self):
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
