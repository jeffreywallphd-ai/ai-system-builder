"""Bounded read-only bridge. Secret reachability is not native custody authority."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import inspect
import json
import os
import stat
from pathlib import Path
from threading import Lock

from ..models import ModelSourceIdentityProbeRequest, ModelDownloadManifest
from .local_text_generation import _resolve_huggingface_cache_root
from .model_source_staging import _plain, _identity, _file_facts
from .model_source_task import NAMESPACE, _private_io_path

CAPABILITY = "ensure-model-download.source-identity-v1"
VERSION = "model-source-identity-binding-v1"
DOMAIN = b"aisb:model-source-identity:v1\0"
BODY_LIMIT = 4096
_CAPTURED = object()
_PROBE_SLOT = Lock()
_RETAINED_PROBE = None


def _current(callback):
    value = callback()
    if inspect.iscoroutine(value):
        value.close()
    if value is not True:
        raise ModelSourceIdentityError()
    return True


def _common_file_facts(facts):
    # Windows path stat and descriptor stat expose different ctime meanings.
    # Keep ctime in each API's own full before/after baseline, never equate them.
    return _identity(facts) + (facts.st_nlink, facts.st_size, facts.st_mtime_ns)


class ModelSourceIdentityError(RuntimeError):
    def __init__(self):
        super().__init__("The model receiver identity could not be confirmed.")


@dataclass(frozen=True)
class ModelSourceIdentityScope:
    task_id: str
    acquisition_id: str
    handoff_id: str
    root: Path
    roots: tuple
    manifest: ModelDownloadManifest
    links: int
    current: object
    marker: object


def capture_identity_scope(*, task_id, acquisition_id, handoff_id, root, roots, manifest, links, current):
    # Trusted Task owner only; decoded requests cannot provide callbacks/paths.
    if not callable(current) or type(links) is not int or links not in (1, 2) or type(manifest) is not ModelDownloadManifest:
        raise ModelSourceIdentityError()
    return ModelSourceIdentityScope(task_id, acquisition_id, handoff_id, root, tuple(roots), manifest, links, current, _CAPTURED)


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ModelSourceIdentityError()
        result[key] = value
    return result


async def read_identity_request(request):
    try:
        size = request.headers.get("content-length")
        if size is not None and (not size.isdigit() or len(size) > 10 or int(size) > BODY_LIMIT):
            raise ModelSourceIdentityError()
        body = bytearray()
        async for chunk in request.stream():
            if len(chunk) > BODY_LIMIT - len(body):
                raise ModelSourceIdentityError()
            body.extend(chunk)
        return ModelSourceIdentityProbeRequest.model_validate(json.loads(bytes(body).decode("utf-8"), object_pairs_hook=_unique))
    except Exception:
        raise ModelSourceIdentityError() from None


class _Probe:
    def __init__(self, current):
        self.current = current
        self.unknown_close = False
        self.fd = None
        self.directory = None

    def live(self):
        _current(self.current)

    def plain_directory(self, directory):
        self.live()
        first = directory.lstat(); self.live()
        if not _plain(first, directory=True) or directory.resolve(strict=True) != directory:
            raise ModelSourceIdentityError()
        self.live()
        after = directory.lstat(); self.live()
        if not _plain(after, directory=True) or _identity(first) != _identity(after):
            raise ModelSourceIdentityError()
        return _identity(after)

    def names(self, directory, expected):
        self.live(); found = set(); self.directory = os.scandir(directory)
        try:
            self.live()
            for entry in self.directory:
                self.live()
                if len(found) >= len(expected) or entry.name not in expected or entry.name in found:
                    raise ModelSourceIdentityError()
                found.add(entry.name)
            if found != set(expected):
                raise ModelSourceIdentityError()
        finally:
            try:
                if self.directory.close() is not None:
                    raise ModelSourceIdentityError()
                self.directory = None
            except Exception:
                self.unknown_close = True
                raise
        self.live()

    def read_secret(self, filename):
        self.live(); first = filename.lstat(); self.live()
        if not _plain(first, directory=False) or first.st_size != 32:
            raise ModelSourceIdentityError()
        self.fd = os.open(filename, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0))
        try:
            self.live(); opened = os.fstat(self.fd); self.live()
            if _common_file_facts(first) != _common_file_facts(opened):
                raise ModelSourceIdentityError()
            secret = bytearray()
            while len(secret) < 32:
                self.live(); chunk = os.read(self.fd, 32 - len(secret)); self.live()
                if type(chunk) is not bytes or not chunk or len(chunk) > 32 - len(secret):
                    raise ModelSourceIdentityError()
                secret.extend(chunk)
            self.live(); extra = os.read(self.fd, 1); self.live()
            after = os.fstat(self.fd); self.live()
            closed_name = filename.lstat(); self.live()
            if (extra != b"" or _file_facts(opened) != _file_facts(after) or _file_facts(first) != _file_facts(closed_name) or
                    _common_file_facts(after) != _common_file_facts(closed_name)):
                raise ModelSourceIdentityError()
            return bytes(secret), _file_facts(closed_name)
        finally:
            try:
                if os.close(self.fd) is not None:
                    raise ModelSourceIdentityError()
                self.fd = None
            except Exception:
                self.unknown_close = True
                raise


def inspect_model_source_identity(request, *, runtime_id, worker_started_at, is_current, scope=None):
    global _RETAINED_PROBE
    if not _PROBE_SLOT.acquire(blocking=False):
        raise ModelSourceIdentityError()
    probe = _Probe(is_current)
    try:
        if type(request) is not ModelSourceIdentityProbeRequest or request.runtimeId != runtime_id or request.workerStartedAt != worker_started_at:
            raise ModelSourceIdentityError()
        if request.phase == "snapshot":
            if (type(scope) is not ModelSourceIdentityScope or scope.marker is not _CAPTURED or
                    (scope.task_id, scope.acquisition_id, scope.handoff_id) != (request.taskId, request.acquisitionId, request.handoffId)):
                raise ModelSourceIdentityError()
            def live():
                return _current(is_current) and _current(scope.current)
            probe.current = live
            root = scope.root
        else:
            if scope is not None:
                raise ModelSourceIdentityError()
            configured = _resolve_huggingface_cache_root()
            if configured is None:
                raise ModelSourceIdentityError()
            root = _private_io_path(configured) / NAMESPACE / request.acquisitionId
        if not root.is_absolute() or len(root.parents) > 64 or len(str(root)) > 4096:
            raise ModelSourceIdentityError()
        ancestors = [(parent, probe.plain_directory(parent)) for parent in reversed((root, *root.parents))]
        source, receiver = root / "source", root / "receiver"
        raw_roots = {"acquisition": probe.plain_directory(root), "source": probe.plain_directory(source), "receiver": probe.plain_directory(receiver)}
        if scope is not None and tuple(raw_roots.values()) != scope.roots:
            raise ModelSourceIdentityError()
        probe.names(root, {"source", "receiver"})
        files = []; file_facts = []
        if scope is None:
            probe.names(source, set()); probe.names(receiver, set())
        else:
            directory = receiver
            for segment in (request.handoffId, "models--" + scope.manifest.source.modelId.replace("/", "--"), "snapshots", scope.manifest.source.revision):
                probe.names(directory, {segment}); directory /= segment; probe.plain_directory(directory)
            probe.names(directory, {file.path for file in scope.manifest.source.files})
            for file in scope.manifest.source.files:
                probe.live(); filename = directory / file.path; facts = filename.lstat(); probe.live()
                # Files may legitimately have two links in the paired profile;
                # all native reparse/type checks remain explicit.
                if (not stat.S_ISREG(facts.st_mode) or stat.S_ISLNK(facts.st_mode) or facts.st_ino == 0 or
                        facts.st_nlink != scope.links or facts.st_size != file.sizeBytes or
                        getattr(facts, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)):
                    raise ModelSourceIdentityError()
                file_facts.append((filename, _file_facts(facts)))
                files.append({"path": file.path, "identity": [str(value) for value in _identity(facts)], "nlink": facts.st_nlink,
                    "sizeBytes": facts.st_size, "mtimeNs": str(facts.st_mtime_ns), "ctimeNs": str(facts.st_ctime_ns)})
        proof_path = root.parent / (request.acquisitionId + ".proof")
        secret, proof_facts = probe.read_secret(proof_path)
        for directory, expected in ancestors:
            if probe.plain_directory(directory) != expected:
                raise ModelSourceIdentityError()
        for role, directory in (("acquisition", root), ("source", source), ("receiver", receiver)):
            if probe.plain_directory(directory) != raw_roots[role]:
                raise ModelSourceIdentityError()
        for filename, expected in file_facts + [(proof_path, proof_facts)]:
            probe.live(); actual = filename.lstat(); probe.live()
            if _file_facts(actual) != expected:
                raise ModelSourceIdentityError()
        proof = {"version": VERSION, "phase": request.phase, "taskId": request.taskId, "acquisitionId": request.acquisitionId,
            "handoffId": request.handoffId, "challenge": request.challenge, "runtimeId": runtime_id, "workerStartedAt": worker_started_at,
            "roots": {key: [str(value) for value in facts] for key, facts in raw_roots.items()},
            "manifestDigest": scope.manifest.manifestDigest if scope else None, "files": files}
        canonical = json.dumps(proof, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        if len(canonical) > 60 * 1024:
            raise ModelSourceIdentityError()
        probe.live()
        return {"proof": proof, "mac": hmac.new(secret, DOMAIN + canonical, hashlib.sha256).hexdigest()}
    except Exception:
        raise ModelSourceIdentityError() from None
    finally:
        if probe.unknown_close:
            _RETAINED_PROBE = probe
        else:
            _PROBE_SLOT.release()
