"""Private temporary Model custody. No cache publication, registry or native authority."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import stat
import tempfile
from threading import Lock
from typing import Callable, Iterator

from .model_download_manifest import capture_manifest, verify_snapshot
from .model_source_transport import CHUNK_BYTES, ModelSourceTransferError, ModelSourceTransferSession
from ..models import MAX_MODEL_DOWNLOAD_SOURCE_BYTES, ModelDownloadManifest

_STAGING_SLOT = Lock()
_RETAINED_STAGING = None
_CAPACITY_RESERVE = 128 * 1024 * 1024


class ModelSourceStagingError(RuntimeError):
    error_code = "model_download_staging_not_confirmed"
    retryable = False
    stage = "generation"

    def __init__(self):
        super().__init__("The selected model files could not be staged safely.")


def _plain(facts: os.stat_result, *, directory: bool) -> bool:
    kind = stat.S_ISDIR(facts.st_mode) if directory else stat.S_ISREG(facts.st_mode)
    return (kind and facts.st_ino != 0 and not stat.S_ISLNK(facts.st_mode) and
            not getattr(facts, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400) and
            (directory or facts.st_nlink == 1))


def _identity(facts: os.stat_result) -> tuple[int, ...]:
    # Directory mtime/nlink legitimately change as our own children are created.
    return (facts.st_dev, facts.st_ino, facts.st_mode, getattr(facts, "st_file_attributes", 0),
            getattr(facts, "st_reparse_tag", 0))


def _file_facts(facts: os.stat_result) -> tuple[int, ...]:
    return _identity(facts) + (facts.st_nlink, facts.st_size, facts.st_mtime_ns, facts.st_ctime_ns)


@dataclass
class _Directory:
    path: Path
    identity: tuple[int, ...] | None = None


@dataclass
class _File:
    path: Path
    descriptor: int | None = None
    identity: tuple[int, ...] | None = None
    size: int = 0
    path_facts: tuple[int, ...] | None = None
    close_uncertain: bool = False


@dataclass(frozen=True)
class StagedModelSource:
    """Read-only, context-scoped path. It is not a persistent Model reference."""
    cache_root: Path
    snapshot_path: Path
    manifest_digest: str
    size_bytes: int
    file_count: int


class _Staging:
    def __init__(self, manifest: ModelDownloadManifest, prepared_root: Path, maximum_payload_bytes: int,
                 maximum_duration_seconds: int, allowed_origins: tuple[str, ...], is_current: Callable[[], bool]):
        if (not isinstance(manifest, ModelDownloadManifest) or type(maximum_payload_bytes) is not int or
                not 1 <= maximum_payload_bytes <= MAX_MODEL_DOWNLOAD_SOURCE_BYTES or
                not isinstance(prepared_root, Path) or not prepared_root.is_absolute()):
            raise ModelSourceStagingError()
        self.manifest = capture_manifest(manifest, manifest.source.modelId, manifest.source.revision)
        if self.manifest.source.totalBytes > maximum_payload_bytes:
            raise ModelSourceStagingError()
        self.session = ModelSourceTransferSession(self.manifest, maximum_duration_seconds=maximum_duration_seconds,
            allowed_origins=allowed_origins, is_current=is_current)
        self.session.assert_current()
        if prepared_root.resolve(strict=True) != prepared_root:
            raise ModelSourceStagingError()
        self.root = prepared_root
        self.ancestors: list[_Directory] = []
        self.directories: list[_Directory] = []
        self.files: list[_File] = []
        self.uncertain = False
        self.written = 0
        self.stage_root: Path | None = None
        self.snapshot: Path | None = None
        for path in reversed((prepared_root, *prepared_root.parents)):
            self.session.assert_current()
            facts = path.lstat()
            if not _plain(facts, directory=True):
                raise ModelSourceStagingError()
            self.ancestors.append(_Directory(path, _identity(facts)))
        self.live()

    def check_directories(self):
        for record in (*self.ancestors, *self.directories):
            facts = record.path.lstat()
            if record.identity is None or not _plain(facts, directory=True) or _identity(facts) != record.identity:
                raise ModelSourceStagingError()
        if self.root.resolve(strict=True) != self.root:
            raise ModelSourceStagingError()

    def live(self):
        self.session.assert_current()
        self.check_directories()
        self.session.assert_current()

    def create_directory(self, path: Path):
        self.live()
        record = _Directory(path)
        self.directories.append(record)  # Record the exact prospective path before the effect.
        self.session.assert_current()
        os.mkdir(path, 0o700)
        facts = path.lstat()
        if not _plain(facts, directory=True):
            raise ModelSourceStagingError()
        record.identity = _identity(facts)
        self.live()

    def prepare(self):
        self.live()
        if shutil.disk_usage(self.root).free < self.manifest.source.totalBytes * 2 + _CAPACITY_RESERVE:
            raise ModelSourceStagingError()
        self.live()
        self.session.assert_current()
        self.uncertain = True
        self.stage_root = Path(tempfile.mkdtemp(prefix=".model-source-", dir=self.root))
        record = _Directory(self.stage_root)
        self.directories.append(record)
        facts = self.stage_root.lstat()
        if not _plain(facts, directory=True):
            raise ModelSourceStagingError()
        record.identity = _identity(facts)
        self.uncertain = False
        self.live()
        repository = self.stage_root / ("models--" + self.manifest.source.modelId.replace("/", "--"))
        self.create_directory(repository)
        self.create_directory(repository / "snapshots")
        self.snapshot = repository / "snapshots" / self.manifest.source.revision
        self.create_directory(self.snapshot)

    def check_file(self, record: _File):
        self.check_directories()
        visible = record.path.lstat()
        if (record.identity is None or not _plain(visible, directory=False) or
                _identity(visible) != record.identity or visible.st_size != record.size):
            raise ModelSourceStagingError()
        if record.descriptor is not None:
            opened = os.fstat(record.descriptor)
            if not _plain(opened, directory=False) or _identity(opened) != record.identity or opened.st_size != record.size:
                raise ModelSourceStagingError()
        elif record.path_facts is None or _file_facts(visible) != record.path_facts:
            raise ModelSourceStagingError()

    def transfer(self, selected):
        self.live()
        record = _File(self.snapshot / selected.path)
        self.files.append(record)
        try:
            self.session.assert_current()
            record.descriptor = os.open(record.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0), 0o600)
            facts = os.fstat(record.descriptor)
            if not _plain(facts, directory=False) or facts.st_size != 0:
                raise ModelSourceStagingError()
            record.identity = _identity(facts)
            self.live(); self.check_file(record)

            def write(chunk):
                if (type(chunk) is not bytes or not 1 <= len(chunk) <= CHUNK_BYTES or
                        len(chunk) > selected.sizeBytes - record.size or
                        len(chunk) > self.manifest.source.totalBytes - self.written):
                    raise ModelSourceStagingError()
                self.live(); self.check_file(record)
                part = memoryview(chunk)
                offset = 0
                while offset < len(part):
                    self.live(); self.check_file(record)
                    self.session.assert_current()
                    count = os.write(record.descriptor, part[offset:])
                    if type(count) is not int or not 1 <= count <= len(part) - offset:
                        raise ModelSourceStagingError()
                    offset += count; record.size += count; self.written += count
                    self.check_file(record)
                self.live()

            receipt = self.session.transfer_file(selected.path, write)
            self.live(); self.check_file(record)
            if receipt.size_bytes != selected.sizeBytes or record.size != selected.sizeBytes:
                raise ModelSourceStagingError()
            self.session.assert_current()
            os.fsync(record.descriptor)
            self.live(); self.check_file(record)
        except ModelSourceTransferError as error:
            if error.reason == "close_unconfirmed":
                self.uncertain = True
            raise
        finally:
            if record.descriptor is not None:
                try:
                    os.close(record.descriptor)
                except BaseException:
                    # Do not retry this fd number; a failed close can still retire it.
                    record.close_uncertain = True
                    self.uncertain = True
                else:
                    record.descriptor = None
                    if record.identity is not None:
                        facts = record.path.lstat()
                        if _plain(facts, directory=False) and _identity(facts) == record.identity and facts.st_size == record.size:
                            record.path_facts = _file_facts(facts)
        if record.close_uncertain:
            raise ModelSourceStagingError()
        self.live(); self.check_file(record)

    def fill(self) -> StagedModelSource:
        self.prepare()
        for selected in self.manifest.source.files:
            self.transfer(selected)
        self.live()
        if self.written != self.manifest.source.totalBytes:
            raise ModelSourceStagingError()
        verify_snapshot(self.manifest, str(self.snapshot), private_cache_root=self.stage_root, fence=self.live)
        self.live()
        for record in self.files:
            self.check_file(record)
        self.session.assert_current()
        return StagedModelSource(self.stage_root, self.snapshot, self.manifest.manifestDigest,
            self.written, len(self.files))

    def cleanup(self) -> bool:
        if self.uncertain or any(record.descriptor is not None or record.close_uncertain for record in self.files):
            return False
        try:
            # Positively inspect the complete fixed tree before any removal.
            self.check_directories()
            owned = {record.path for record in (*self.directories, *self.files) if record.identity is not None}
            for record in (*self.directories, *self.files):
                if record.identity is None and os.path.lexists(record.path):
                    return False
            for directory in self.directories:
                if directory.identity is not None:
                    with os.scandir(directory.path) as entries:
                        for entry in entries:
                            if directory.path / entry.name not in owned:
                                return False
            for record in self.files:
                if record.identity is not None:
                    self.check_file(record)
            for record in reversed(self.files):
                if record.identity is not None:
                    self.check_file(record)
                    os.unlink(record.path)
            for record in reversed(self.directories):
                if record.identity is not None:
                    self.check_directories()
                    os.rmdir(record.path)
                    self.directories.remove(record)
            return True
        except BaseException:
            return False


@contextmanager
def stage_model_source(manifest: ModelDownloadManifest, *, prepared_root: Path, maximum_payload_bytes: int,
                       maximum_duration_seconds: int, allowed_origins: tuple[str, ...] = ("https://huggingface.co",),
                       is_current: Callable[[], bool] = lambda: True) -> Iterator[StagedModelSource]:
    """Temporary read-only custody only; no retained data adoption or publication."""
    global _RETAINED_STAGING
    if not _STAGING_SLOT.acquire(blocking=False):
        raise ModelSourceStagingError()
    owner = None
    try:
        owner = _Staging(manifest, prepared_root, maximum_payload_bytes, maximum_duration_seconds, allowed_origins, is_current)
        yield owner.fill()
    except Exception:
        raise ModelSourceStagingError() from None
    finally:
        if owner is None or owner.cleanup():
            _STAGING_SLOT.release()
        else:
            _RETAINED_STAGING = owner
            raise ModelSourceStagingError() from None
