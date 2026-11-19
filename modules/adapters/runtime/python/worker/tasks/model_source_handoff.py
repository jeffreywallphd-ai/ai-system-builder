"""Private same-volume paired links; no task ACK channel or Model publication."""
from __future__ import annotations

from dataclasses import dataclass, field, fields
import hashlib
import inspect
import json
import os
from pathlib import Path
import stat
from threading import Lock
from typing import Callable
from uuid import UUID

from .model_download_manifest import verify_snapshot
from .model_source_staging import StagedModelSource, _Staging, _Directory, _plain, _identity, _file_facts

_CAPTURED_RECIPIENT = object()


class ModelSourceHandoffError(RuntimeError):
    error_code = "model_download_handoff_not_confirmed"
    stage = "generation"
    retryable = False

    def __init__(self):
        super().__init__("The selected model files could not be handed to storage safely.")


def _digest(value) -> str:
    return "sha256:" + hashlib.sha256(json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def _uuid(value):
    if type(value) is not str or str(UUID(value)) != value:
        raise ModelSourceHandoffError()
    return value


def _strict(callback, *args):
    result = callback(*args)
    if inspect.iscoroutine(result):
        result.close()
    if result is not True:
        raise ModelSourceHandoffError()


@dataclass(frozen=True)
class ModelSourceHandoffReceipt:
    task_id: str
    handoff_id: str
    model_id: str
    revision: str
    manifest_digest: str
    recipient_witness: str
    file_count: int
    size_bytes: int
    receipt_digest: str


@dataclass(frozen=True)
class ModelSourceRecipient:
    """Trusted host-captured observation callbacks, never a decoded caller DTO."""
    task_id: str
    handoff_id: str
    root: Path = field(repr=False)
    ancestors: tuple = field(repr=False)
    is_current: Callable[[], bool] = field(repr=False, compare=False)
    observe_acknowledgement: Callable[[ModelSourceHandoffReceipt], bool] = field(repr=False, compare=False)
    _capture: object = field(default=None, repr=False, compare=False)


def capture_model_source_recipient(root: Path, *, task_id: str, handoff_id: str, is_current: Callable[[], bool],
                                   observe_acknowledgement: Callable[[ModelSourceHandoffReceipt], bool]) -> ModelSourceRecipient:
    """Capture an already prepared empty private namespace; no creation or adoption."""
    try:
        _uuid(task_id); _uuid(handoff_id)
        if not callable(is_current) or not callable(observe_acknowledgement):
            raise ModelSourceHandoffError()
        _strict(is_current)
        if (not isinstance(root, Path) or not root.is_absolute() or len(str(root)) > 4096 or
                len(root.parents) > 64 or root.resolve(strict=True) != root):
            raise ModelSourceHandoffError()
        ancestors = []
        for path in reversed((root, *root.parents)):
            _strict(is_current)
            facts = path.lstat()
            if not _plain(facts, directory=True):
                raise ModelSourceHandoffError()
            ancestors.append((path, _identity(facts)))
        with os.scandir(root) as entries:
            if next(entries, None) is not None:
                raise ModelSourceHandoffError()
        _strict(is_current)
        return ModelSourceRecipient(task_id, handoff_id, root, tuple(ancestors), is_current, observe_acknowledgement, _CAPTURED_RECIPIENT)
    except Exception:
        raise ModelSourceHandoffError() from None


@dataclass
class _Pair:
    record: object
    target: Path
    original: os.stat_result
    linked: bool = False
    source_removed: bool = False
    source_facts: tuple | None = None
    target_facts: tuple | None = None


def _paired_file(facts, original, links):
    return (stat.S_ISREG(facts.st_mode) and not stat.S_ISLNK(facts.st_mode) and
        not getattr(facts, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400) and
        _identity(facts) == _identity(original) and facts.st_nlink == links and
        facts.st_size == original.st_size and facts.st_mtime_ns == original.st_mtime_ns)


class ModelSourceHandoff:
    """One private staged-file handoff. Receipt production is not receiver ACK."""
    def __init__(self, staged: StagedModelSource, recipient: ModelSourceRecipient):
        self.acknowledged = False
        self.failed = False
        self.recipient_effects_started = False
        self.preparation_settled = False
        self.receipt: ModelSourceHandoffReceipt | None = None
        self._receipt_values = None
        self._ack_attempted = False
        self._ack_reservation = Lock()
        self._pairs: list[_Pair] = []
        self._directories: list[_Directory] = []
        self._original_recipient = recipient
        self._owner = getattr(staged, "_custodian", None)
        try:
            if (type(staged) is not StagedModelSource or type(recipient) is not ModelSourceRecipient or
                    recipient._capture is not _CAPTURED_RECIPIENT or
                    not isinstance(self._owner, _Staging) or not self._owner.consumer_active or self._owner.handoff is not None or
                    staged.cache_root != self._owner.stage_root or staged.snapshot_path != self._owner.snapshot or
                    staged.manifest_digest != self._owner.manifest.manifestDigest or
                    staged.size_bytes != self._owner.written or staged.file_count != len(self._owner.files)):
                raise ModelSourceHandoffError()
            if not self._owner.handoff_reservation.acquire(blocking=False):
                raise ModelSourceHandoffError()
            # Reserve the exact owner before callbacks, metadata or recipient
            # effects. It is one-use even if preparation is refused.
            self._owner.handoff = self
            self._receiver = ModelSourceRecipient(recipient.task_id, recipient.handoff_id, recipient.root,
                tuple(recipient.ancestors), recipient.is_current, recipient.observe_acknowledgement, _CAPTURED_RECIPIENT)
            _uuid(self._receiver.task_id); _uuid(self._receiver.handoff_id)
            self._leaf = self._receiver.root / self._receiver.handoff_id
            self._snapshot = self._leaf / ("models--" + self._owner.manifest.source.modelId.replace("/", "--")) / "snapshots" / self._owner.manifest.source.revision
            if (self._owner.stage_root.is_relative_to(self._receiver.root) or self._receiver.root.is_relative_to(self._owner.stage_root) or
                    self._receiver.root.lstat().st_dev != self._owner.stage_root.lstat().st_dev):
                raise ModelSourceHandoffError()
            self._fence()
            with os.scandir(self._receiver.root) as entries:
                if next(entries, None) is not None:
                    raise ModelSourceHandoffError()
            for record in self._owner.files:
                self._owner.check_file(record)
            verify_snapshot(self._owner.manifest, str(self._owner.snapshot), private_cache_root=self._owner.stage_root, fence=self._fence)
            self._fence()
            self._create_directories()
            for record in tuple(self._owner.files):
                self._fence(); self._owner.check_file(record)
                original = record.path.lstat()
                pair = _Pair(record, self._snapshot / record.path.name, original)
                self._pairs.append(pair)
                self._effect_fence()
                os.link(record.path, pair.target, follow_symlinks=False)
                source, target = record.path.lstat(), pair.target.lstat()
                if not _paired_file(source, original, 2) or not _paired_file(target, original, 2):
                    raise ModelSourceHandoffError()
                pair.linked = True
                pair.source_facts, pair.target_facts = _file_facts(source), _file_facts(target)
                self._check_pairs()
            self._verify_complete(cleanup=False)
            witness = _digest({"task": self._receiver.task_id, "handoff": self._receiver.handoff_id,
                "root": [str(value) for value in self._receiver.ancestors[-1][1]]})
            facts = {"task": self._receiver.task_id, "handoff": self._receiver.handoff_id,
                "manifest": self._owner.manifest.manifestDigest, "recipient": witness,
                "files": [{"path": p.record.path.name, "device": str(p.original.st_dev), "inode": str(p.original.st_ino),
                    "size": p.original.st_size} for p in self._pairs]}
            self._effect_fence()
            source = self._owner.manifest.source
            self.receipt = ModelSourceHandoffReceipt(self._receiver.task_id, self._receiver.handoff_id,
                source.modelId, source.revision, self._owner.manifest.manifestDigest, witness,
                len(self._pairs), source.totalBytes, _digest(facts))
            self._receipt_values = tuple(getattr(self.receipt, key.name) for key in fields(ModelSourceHandoffReceipt))
        except Exception:
            self.failed = True
            if isinstance(self._owner, _Staging) and self._owner.handoff is self and self.recipient_effects_started:
                self._owner.uncertain = True
            raise ModelSourceHandoffError() from None
        finally:
            self.preparation_settled = True

    def _receiver_current(self):
        original, receiver = self._original_recipient, self._receiver
        if (original.task_id != receiver.task_id or original.handoff_id != receiver.handoff_id or
                original.root != receiver.root or original.ancestors != receiver.ancestors or
                original.is_current is not receiver.is_current or
                original.observe_acknowledgement is not receiver.observe_acknowledgement):
            raise ModelSourceHandoffError()
        if original._capture is not _CAPTURED_RECIPIENT:
            raise ModelSourceHandoffError()
        _strict(receiver.is_current)
        if (original.task_id != receiver.task_id or original.handoff_id != receiver.handoff_id or
                original.root != receiver.root or original.ancestors != receiver.ancestors or
                original.is_current is not receiver.is_current or
                original.observe_acknowledgement is not receiver.observe_acknowledgement):
            raise ModelSourceHandoffError()

    def _receipt_current(self):
        if self._receipt_values is not None:
            if type(self.receipt) is not ModelSourceHandoffReceipt:
                raise ModelSourceHandoffError()
            actual = tuple(getattr(self.receipt, key.name) for key in fields(ModelSourceHandoffReceipt))
            if any(type(a) is not type(b) or a != b for a, b in zip(actual, self._receipt_values)):
                raise ModelSourceHandoffError()

    def _directories_current(self):
        self._owner.check_directories()
        for path, expected in self._receiver.ancestors:
            facts = path.lstat()
            if not _plain(facts, directory=True) or _identity(facts) != expected:
                raise ModelSourceHandoffError()
        for record in self._directories:
            facts = record.path.lstat()
            if record.identity is None or not _plain(facts, directory=True) or _identity(facts) != record.identity:
                raise ModelSourceHandoffError()
        if self._receiver.root.resolve(strict=True) != self._receiver.root:
            raise ModelSourceHandoffError()

    def _effect_fence(self, *, cleanup=False):
        if self.failed or not self._owner.consumer_active:
            raise ModelSourceHandoffError()
        self._receiver_current()
        self._receipt_current()
        if not cleanup:
            self._owner.session.assert_current()
        if self.failed or not self._owner.consumer_active:
            raise ModelSourceHandoffError()
        self._receipt_current()

    def _fence(self, *, cleanup=False):
        self._effect_fence(cleanup=cleanup)
        self._directories_current()
        self._effect_fence(cleanup=cleanup)

    def _create_directories(self):
        current = self._receiver.root
        for segment in self._snapshot.relative_to(current).parts:
            self._fence()
            current /= segment
            record = _Directory(current)
            self._directories.append(record)
            self._effect_fence()
            self.recipient_effects_started = True
            os.mkdir(current, 0o700)
            facts = current.lstat()
            if not _plain(facts, directory=True):
                raise ModelSourceHandoffError()
            record.identity = _identity(facts)
            self._fence()

    def _check_pairs(self):
        self._directories_current()
        for pair in self._pairs:
            if not pair.linked or pair.target_facts is None:
                raise ModelSourceHandoffError()
            target = pair.target.lstat()
            if not _paired_file(target, pair.original, 1 if pair.source_removed else 2) or _file_facts(target) != pair.target_facts:
                raise ModelSourceHandoffError()
            if pair.source_removed:
                if os.path.lexists(pair.record.path):
                    raise ModelSourceHandoffError()
            else:
                source = pair.record.path.lstat()
                if not _paired_file(source, pair.original, 2) or _file_facts(source) != pair.source_facts:
                    raise ModelSourceHandoffError()
        allowed = {p.target for p in self._pairs if p.linked} | {d.path for d in self._directories}
        for root in (self._receiver.root, *(d.path for d in self._directories)):
            with os.scandir(root) as entries:
                for entry in entries:
                    if root / entry.name not in allowed:
                        raise ModelSourceHandoffError()
        source_allowed = {record.path for record in self._owner.files} | {d.path for d in self._owner.directories}
        for directory in self._owner.directories:
            with os.scandir(directory.path) as entries:
                for entry in entries:
                    if directory.path / entry.name not in source_allowed:
                        raise ModelSourceHandoffError()

    def _verify_complete(self, *, cleanup):
        if len(self._pairs) != len(self._owner.manifest.source.files):
            raise ModelSourceHandoffError()
        self._fence(cleanup=cleanup); self._check_pairs()
        verify_snapshot(self._owner.manifest, str(self._snapshot), private_cache_root=self._leaf,
            fence=lambda: self._fence(cleanup=cleanup))
        self._check_pairs(); self._effect_fence(cleanup=cleanup)

    def acknowledge(self) -> None:
        """Observe the trusted receiver exactly once; no receipt echo grants ACK."""
        if (self._ack_attempted or self.receipt is None or self.failed or self.acknowledged or
                not self._ack_reservation.acquire(blocking=False)):
            raise ModelSourceHandoffError()
        self._ack_attempted = True
        try:
            self._fence(cleanup=True)
            _strict(self._receiver.observe_acknowledgement, self.receipt)
            self._verify_complete(cleanup=True)
            for pair in self._pairs:
                self._fence(cleanup=True); self._check_pairs()
                self._effect_fence(cleanup=True)
                os.unlink(pair.record.path)
                # A thrown unlink may have taken effect: never infer/retry it.
                target = pair.target.lstat()
                if not _paired_file(target, pair.original, 1) or os.path.lexists(pair.record.path):
                    raise ModelSourceHandoffError()
                pair.source_removed = True
                pair.target_facts = _file_facts(target)
                self._owner.files.remove(pair.record)
                self._check_pairs()
            self._verify_complete(cleanup=True)
            self.acknowledged = True
        except Exception:
            self.failed = True
            self._owner.uncertain = True
            raise ModelSourceHandoffError() from None
