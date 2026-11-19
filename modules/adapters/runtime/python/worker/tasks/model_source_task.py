"""Private retained task custody. Host authentication is not actor/Model approval."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import inspect
import json
import os
from pathlib import Path
from threading import Lock
from typing import Callable
from uuid import UUID

from ..models import EnsureModelDownloadRequest, ModelSourceAcknowledgement
from .model_source_handoff import ModelSourceHandoff, ModelSourceHandoffReceipt, capture_model_source_recipient
from .model_source_staging import stage_model_source
from .local_text_generation import _resolve_huggingface_cache_root, _require_plain_cache_directory, _parse_huggingface_max_model_bytes

NAMESPACE = ".aisb-model-source-transfers"
CAPABILITY = "ensure-model-download.source-transfer-v1"
ACK_BODY_LIMIT = 4096


class ModelSourceTaskError(RuntimeError):
    error_code = "model_source_task_unconfirmed"
    stage = "generation"
    retryable = False

    def __init__(self, reason="unconfirmed"):
        super().__init__("The model file transfer could not be confirmed.")
        self.reason = reason if reason in {"namespace", "staging", "handoff", "acknowledgement", "selection"} else "unconfirmed"
        self.error_code = "model_source_task_" + self.reason + ("_unconfirmed" if self.reason != "unconfirmed" else "")


def valid_task_id(value: str) -> bool:
    try:
        return type(value) is str and str(UUID(value)) == value
    except Exception:
        return False


def has_source_transfer(value) -> bool:
    return type(value) is dict and "sourceTransfer" in value


def _private_io_path(value: Path) -> Path:
    """Native spelling for an already trusted absolute root, never a caller path."""
    if not isinstance(value, Path) or not value.is_absolute():
        raise ModelSourceTaskError("namespace")
    if os.name != "nt":
        return value
    text = str(value)
    prefix = "\\\\?\\"
    if not text.startswith(prefix):
        text = prefix + ("UNC\\" + text[2:] if text.startswith("\\\\") else text)
    return Path(text)


def captured_selection(value) -> EnsureModelDownloadRequest | None:
    if not has_source_transfer(value):
        return None
    try:
        # Decode before queue acceptance; only copied supported fields survive.
        selected = EnsureModelDownloadRequest.model_validate(value)
        if selected.sourceTransfer is None or selected.sourceManifest is None:
            raise ModelSourceTaskError()
        return EnsureModelDownloadRequest.model_validate(selected.model_dump(mode="json", exclude_none=True))
    except Exception:
        raise ModelSourceTaskError("selection") from None


def _strict(callback, *args):
    allowed = callback(*args)
    if inspect.iscoroutine(allowed):
        allowed.close()
    if allowed is not True:
        raise ModelSourceTaskError()


def _unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ModelSourceTaskError()
        result[name] = value
    return result


async def read_acknowledgement(request) -> ModelSourceAcknowledgement:
    """Stop buffering at4097bytes; content length is only an early rejection."""
    try:
        size = request.headers.get("content-length")
        if size is not None and (not size.isdigit() or len(size) > 10 or int(size) > ACK_BODY_LIMIT):
            raise ModelSourceTaskError()
        body = bytearray()
        async for chunk in request.stream():
            if len(chunk) > ACK_BODY_LIMIT - len(body):
                raise ModelSourceTaskError()
            body.extend(chunk)
        raw = json.loads(bytes(body).decode("utf-8"), object_pairs_hook=_unique_object)
        return ModelSourceAcknowledgement.model_validate(raw)
    except Exception:
        raise ModelSourceTaskError() from None


@dataclass(frozen=True)
class _State:
    phase: str
    retain_record: bool
    cleanup_pending: bool
    receipt: ModelSourceHandoffReceipt | None = None
    error_code: str | None = None


class ModelSourceTaskOwner:
    """One original record owns context and ACK; no parallel holding registry."""
    def __init__(self, task_id: str, selection: EnsureModelDownloadRequest, *, record_current: Callable[[], bool]):
        if not valid_task_id(task_id) or selection.sourceTransfer is None or selection.sourceManifest is None:
            raise ModelSourceTaskError()
        self.task_id = task_id
        self.selection = EnsureModelDownloadRequest.model_validate(selection.model_dump(mode="json", exclude_none=True))
        self._record_current = record_current
        self._control = Lock()
        self._state = _State("prepared", True, False)
        self._context = None
        self._context_entered = False
        self._context_finished = False
        self._custodian = None
        self._handoff = None
        self._observation_key = None
        self._receiver_observed = False
        self._prepared = None
        self._start_ack_unconfirmed = False

    @property
    def retains_record(self) -> bool:
        # Immutable pointer snapshot: never call IO/policy while registry holds its lock.
        return self._state.retain_record

    def _current(self, *, business=False):
        _strict(self._record_current)
        state = self._state
        if business and state.phase != "running" or not business and state.phase not in {
                "running", "awaiting-receiver", "acknowledging"}:
            raise ModelSourceTaskError()
        return True

    def _capture_custodian(self, value):
        self._current(business=True)
        if self._custodian is not None:
            raise ModelSourceTaskError()
        self._custodian = value
        # Bind the captured stage ancestors to the original pre-queue facts,
        # rather than accepting a replacement root between checks and creation.
        paths = self._prepared
        original = {record.path: record.identity for record in value.ancestors}
        for directory, expected in ((paths[0], self.selection.sourceTransfer.roots.acquisition),
                                    (paths[1], self.selection.sourceTransfer.roots.source)):
            identity = original.get(directory)
            if identity is None or str(identity[0]) != expected.device or str(identity[1]) != expected.inode:
                raise ModelSourceTaskError()
        self._verify_root(paths[2], self.selection.sourceTransfer.roots.receiver)

    def _verify_root(self, directory, expected):
        _require_plain_cache_directory(directory)
        facts = directory.lstat()
        if (directory.resolve(strict=True) != directory or str(facts.st_dev) != expected.device or
                str(facts.st_ino) != expected.inode):
            raise ModelSourceTaskError()

    def _prepared_namespace(self):
        self._current(business=True)
        cache = _resolve_huggingface_cache_root()
        if cache is None:
            raise ModelSourceTaskError()
        cache = _private_io_path(cache)
        _require_plain_cache_directory(cache)
        cache = cache.resolve(strict=True)
        transfer = self.selection.sourceTransfer
        root = cache / NAMESPACE / transfer.acquisitionId
        source, receiver = root / "source", root / "receiver"
        for directory in (cache, cache / NAMESPACE, root, source, receiver):
            self._current(business=True)
            _require_plain_cache_directory(directory)
            if directory.resolve(strict=True) != directory:
                raise ModelSourceTaskError()
        for directory, expected in ((root, transfer.roots.acquisition),
                                    (source, transfer.roots.source), (receiver, transfer.roots.receiver)):
            self._verify_root(directory, expected)
        names = set()
        with os.scandir(root) as entries:
            for entry in entries:
                if len(names) >= 2 or entry.name not in {"source", "receiver"}:
                    raise ModelSourceTaskError()
                names.add(entry.name)
            if names != {"source", "receiver"}:
                raise ModelSourceTaskError()
        for directory in (source, receiver):
            with os.scandir(directory) as entries:
                if next(entries, None) is not None:
                    raise ModelSourceTaskError()
        if self.selection.sourceManifest.source.totalBytes > _parse_huggingface_max_model_bytes():
            raise ModelSourceTaskError()
        self._current(business=True)
        self._prepared = (root, source, receiver)
        return source, receiver

    def _finish_context(self):
        if self._context is not None and self._context_entered and not self._context_finished:
            self._context_finished = True
            self._context.__exit__(None, None, None)

    def execute(self) -> dict:
        with self._control:
            if self._state.phase != "prepared":
                raise ModelSourceTaskError()
            self._state = _State("running", True, True)
        stage = "namespace"
        try:
            source, receiver = self._prepared_namespace()
            transfer = self.selection.sourceTransfer
            stage = "staging"
            self._context = stage_model_source(self.selection.sourceManifest, prepared_root=source,
                maximum_payload_bytes=self.selection.sourceManifest.source.totalBytes,
                maximum_duration_seconds=transfer.maximumDurationSeconds, allowed_origins=transfer.allowedOrigins,
                is_current=lambda: self._current(business=True), capture_custodian=self._capture_custodian)
            staged = self._context.__enter__()
            self._context_entered = True
            stage = "handoff"
            recipient = capture_model_source_recipient(receiver, task_id=self.task_id, handoff_id=transfer.handoffId,
                is_current=lambda: self._current(), observe_acknowledgement=self._observe_receiver)
            identity = next((facts for path, facts in recipient.ancestors if path == receiver), None)
            if (identity is None or str(identity[0]) != transfer.roots.receiver.device or
                    str(identity[1]) != transfer.roots.receiver.inode):
                raise ModelSourceTaskError()
            self._handoff = ModelSourceHandoff(staged, recipient)
            receipt = ModelSourceHandoffReceipt(**asdict(self._handoff.receipt))
            self._current(business=True)
            self._state = _State("awaiting-receiver", True, True, receipt)
            return self.generic_result()
        except Exception:
            try:
                self._finish_context()
            except Exception:
                pass
            confirmed = self._custodian is None or self._custodian.cleanup_confirmed is True
            error = ModelSourceTaskError(stage)
            self._state = _State("failed" if confirmed else "uncertain", not confirmed, not confirmed, error_code=error.error_code)
            raise error from None

    def _observe_receiver(self, receipt):
        self._current()
        current = self._state
        return (current.phase == "acknowledging" and self._receiver_observed is True and current.receipt == receipt)

    def generic_result(self):
        state = self._state
        return {"kind": "model-source-staged", "provider": "transformers", "modelId": self.selection.modelId,
            "revision": self.selection.revision, "verifiedManifestDigest": self.selection.sourceManifest.manifestDigest,
            "fileCount": len(self.selection.sourceManifest.source.files), "totalBytes": self.selection.sourceManifest.source.totalBytes,
            "cleanupPending": state.cleanup_pending}

    def _status_snapshot(self, state=None):
        state = state or self._state
        return {"requestId": self.task_id, "phase": state.phase, "cleanupPending": state.cleanup_pending,
            "receiverSettlementPending": state.phase == "acknowledged",
            "startAcknowledgementUnconfirmed": self._start_ack_unconfirmed,
            **({"errorCode": state.error_code} if state.error_code else {}),
            **({"receipt": asdict(state.receipt)} if state.receipt is not None else {})}

    def status(self):
        _strict(self._record_current)
        value = self._status_snapshot(self._state)
        _strict(self._record_current)
        return value

    def acknowledge(self, incoming: ModelSourceAcknowledgement):
        try:
            copied = ModelSourceAcknowledgement.model_validate(incoming.model_dump(mode="json"))
            _strict(self._record_current)
            perform = False
            with self._control:
                state = self._state
                transfer = self.selection.sourceTransfer
                receipt = state.receipt
                if (receipt is None or copied.acquisitionId != transfer.acquisitionId or copied.handoffId != transfer.handoffId or
                        copied.receiptDigest != receipt.receipt_digest or copied.recipientWitness != receipt.recipient_witness):
                    raise ModelSourceTaskError()
                key = (copied.acquisitionId, copied.handoffId, copied.receiptDigest, copied.recipientWitness)
                if copied.phase == "receiver-settled":
                    if self._observation_key != key or state.phase not in {"acknowledged", "released"}:
                        raise ModelSourceTaskError()
                    self._state = _State("released", False, False, receipt)
                elif self._observation_key is not None:
                    if self._observation_key != key:
                        raise ModelSourceTaskError()
                else:
                    if state.phase != "awaiting-receiver":
                        raise ModelSourceTaskError()
                    self._observation_key = key
                    self._receiver_observed = True
                    self._state = _State("acknowledging", True, True, receipt)
                    perform = True
            if perform:
                try:
                    self._handoff.acknowledge()
                    self._finish_context()
                    if self._custodian is None or self._custodian.cleanup_confirmed is not True:
                        raise ModelSourceTaskError()
                    self._state = _State("acknowledged", True, False, receipt)
                except Exception:
                    self._state = _State("uncertain", True, True, receipt, ModelSourceTaskError("acknowledgement").error_code)
            # Even pure replay/settlement must recheck the original record after
            # waiting for control, outside its lock and before/after disclosure.
            return self.status()
        except Exception:
            raise ModelSourceTaskError() from None

    def cancel_before_start(self):
        with self._control:
            if self._state.phase == "cancelled":
                return
            if self._state.phase != "prepared":
                raise ModelSourceTaskError()
            self._state = _State("cancelled", False, False)

    def identity_probe_scope(self):
        from .model_source_identity import capture_identity_scope
        _strict(self._record_current)
        state = self._state
        if (state.phase not in {"awaiting-receiver", "acknowledged"} or state.receipt is None or
                self._prepared is None or self._custodian is None or self._handoff is None):
            raise ModelSourceTaskError()
        transfer = self.selection.sourceTransfer
        manifest = self.selection.sourceManifest
        ancestors = {record.path: record.identity for record in self._custodian.ancestors}
        receiver = self._handoff._receiver
        roots = (ancestors[self._prepared[0]], ancestors[self._prepared[1]], receiver.ancestors[-1][1])
        def current():
            return (self._record_current() is True and self._state is state and
                self.selection.sourceTransfer is transfer and self.selection.sourceManifest is manifest)
        scope = capture_identity_scope(task_id=self.task_id, acquisition_id=transfer.acquisitionId,
            handoff_id=transfer.handoffId, root=self._prepared[0], roots=roots, manifest=manifest,
            links=2 if state.phase == "awaiting-receiver" else 1, current=current)
        _strict(current)
        return scope

    def issue_unconfirmed(self):
        with self._control:
            # A raised submit can have queued the exact original job. Preserve
            # its causal state/owner; no new issue or inferred cleanup is allowed.
            self._start_ack_unconfirmed = True
