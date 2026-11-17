"""Private, source-bound Windows read of one newly staged PDF.

Bindings must come from application-authorized retrieved bytes and its owned
task stage. Neither constructing a binding nor matching a digest authorizes a
source. This module does not expose OCR, resolve artifacts or inspect old trees.
"""
from __future__ import annotations

import ctypes as c
from dataclasses import dataclass, field
import hashlib
from pathlib import PureWindowsPath
import re
import threading
from typing import Callable

from . import resource
from .protocol import MAX_SOURCE_BYTES, OcrCancelled, OcrContractError
from .windows_api import Windows, need

_CAPTURE_LOCK = threading.Lock()
_ERROR = "The staged document could not be verified for text recognition."


def _require(value: object) -> None:
    if not value:
        raise OcrContractError(_ERROR)


def _component(value: str) -> bool:
    stem = value.split(".", 1)[0].upper()
    return (bool(value) and value not in (".", "..") and
            not value.endswith((".", " ")) and "~" not in value and
            re.search(r'[<>:"/\\|?*\x00-\x1f\ud800-\udfff]', value) is None and
            stem not in {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"} and
            re.fullmatch(r"(?:COM|LPT)[1-9¹²³]", stem) is None)


@dataclass(frozen=True)
class OcrSourceBinding:
    """Host-compiled identity, never a renderer option or authority assertion."""

    stage_root: str = field(repr=False)
    file_name: str = field(repr=False)
    artifact_id: str = field(repr=False)
    byte_length: int
    sha256: str = field(repr=False)

    def __post_init__(self) -> None:
        _require(type(self.stage_root) is str and 0 < len(self.stage_root) <= 2048)
        root = PureWindowsPath(self.stage_root)
        _require(re.fullmatch(r"[A-Za-z]:", root.drive) is not None and root.is_absolute() and
                 str(root) == self.stage_root and len(root.parts) >= 3 and
                 all(_component(part) for part in root.parts[1:]) and
                 re.fullmatch(r"ai-system-builder-runtime-[A-Za-z0-9_-]{6,64}", root.name) is not None)
        _require(type(self.file_name) is str and 0 < len(self.file_name) <= 240 and
                 _component(self.file_name) and
                 re.fullmatch(r"[0-9]{4}-[A-Za-z0-9._-]+\.pdf", self.file_name) is not None and
                 1 <= int(self.file_name[:4]) <= 256)
        _require(type(self.artifact_id) is str and 0 < len(self.artifact_id) <= 512 and
                 all(ord(character) >= 32 and not 0xD800 <= ord(character) <= 0xDFFF
                     for character in self.artifact_id))
        _require(type(self.byte_length) is int and 0 < self.byte_length <= MAX_SOURCE_BYTES and
                 type(self.sha256) is str and re.fullmatch(r"[a-f0-9]{64}", self.sha256) is not None)


class _SourceLease(resource._Resource):
    """Reuse read mechanics; an unacknowledged close is never retried."""

    def __init__(self, native):
        super().__init__(native)
        self._attempted_close = False
        self._retired = False

    def pin(self, *args, **kwargs):
        need(not self._attempted_close, "retired-source-lease")
        return super().pin(*args, **kwargs)

    def close(self):
        if not self._attempted_close:
            self._attempted_close = True
            try:
                self._retired = super().close()
            except BaseException:
                resource._UNCERTAIN_RESOURCES[id(self)] = self
                self._retired = False
        return self._retired


def capture_source(binding: OcrSourceBinding, *, stage_root: str, local_path: str,
                   artifact_id: str, cancelled: Callable[[], bool] = lambda: False) -> bytes:
    """Capture once, then retire every lease before releasing immutable bytes.

Cancellation is checked between bounded synchronous local reads. This does not
claim a hard interruption deadline for an in-flight operating-system disk call.
"""
    _require(type(binding) is OcrSourceBinding)
    OcrSourceBinding.__post_init__(binding)
    expected_path = str(PureWindowsPath(binding.stage_root) / binding.file_name)
    _require(type(stage_root) is str and stage_root == binding.stage_root and
             type(local_path) is str and local_path == expected_path and
             type(artifact_id) is str and artifact_id == binding.artifact_id and callable(cancelled))

    def check_cancelled():
        value = cancelled()
        _require(type(value) is bool)
        if value:
            raise OcrCancelled("Text recognition was cancelled.")

    try:
        check_cancelled()
    except OcrCancelled:
        raise
    except Exception:
        raise OcrContractError(_ERROR) from None
    _require(_CAPTURE_LOCK.acquire(blocking=False))
    lease = None
    try:
        need(not resource._UNCERTAIN_RESOURCES, "uncertain-source-lease")
        native = Windows()
        root = PureWindowsPath(stage_root)
        # A drive letter and FILE_TYPE_DISK also admit mapped network drives.
        # This snapshot-specific API has one explicit wide-string argument and
        # UINT result; never use ambient/current-drive selection or fallback.
        query = native.k.GetDriveTypeW
        query.argtypes, query.restype = [c.c_wchar_p], c.c_uint32
        drive_type = query(root.anchor)
        need(type(drive_type) is int and drive_type == 3, "source-fixed-drive-required")
        lease = _SourceLease(native)
        for directory in (*reversed(root.parents), root):
            lease.pin(directory, directory=True, check_cancelled=check_cancelled)
        data = lease.pin(root / binding.file_name, maximum=binding.byte_length,
                         check_cancelled=check_cancelled)
        _require(len(data) == binding.byte_length and
                 hashlib.sha256(data).hexdigest() == binding.sha256)
        check_cancelled()
        return data
    except OcrCancelled:
        raise
    except Exception:
        raise OcrContractError(_ERROR) from None
    finally:
        if lease is None or lease.close():
            _CAPTURE_LOCK.release()
        else:
            # _Resource.close retains the exact owner/handles. Leave the source
            # admission lock held; no reset, adoption or stale-handle retry.
            raise OcrContractError(_ERROR) from None
