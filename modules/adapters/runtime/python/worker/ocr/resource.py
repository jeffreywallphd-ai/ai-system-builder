"""Fixed trusted-installation OCR resource, pinned for its entire native lease.

The build manifest detects incomplete/stale/substituted resources. It is not a
signature or protection against an attacker who can rewrite the installation.
Runtime callers cannot select a resource, compile one, or download a fallback.
"""
from __future__ import annotations
import ctypes as c
import hashlib
import json
from pathlib import Path
import re
import struct
import threading
from .windows_api import FileInfo, NativeFailure, Windows, need

MAX_BINARY_BYTES = 2 * 1024**2
MAX_SOURCE_BYTES = 1024**2
MAX_MANIFEST_BYTES = 4096
_UNCERTAIN_RESOURCES = {}
_CLOSING_RESOURCES = {}


def _unique(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, "resource-manifest")
        value[key] = item
    return value


def _validate_manifest(raw: bytes, source: bytes, binary: bytes) -> None:
    """Pure bounded identity check, also used by the trusted build verifier."""
    try:
        need(type(raw) is bytes and 0 < len(raw) <= MAX_MANIFEST_BYTES and
             type(source) is bytes and 0 < len(source) <= MAX_SOURCE_BYTES and
             type(binary) is bytes and 256 <= len(binary) <= MAX_BINARY_BYTES,
             "resource-bounds")
        record = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=_unique)
        need(type(record) is dict and set(record) == {
            "schema_version", "provider", "provider_version", "architecture",
            "source_sha256", "binary_sha256", "binary_bytes"}, "resource-manifest")
        need(record["schema_version"] == "windows-ocr-resource-v1" and
             record["provider"] == "windows" and record["provider_version"] == "1" and
             record["architecture"] == "x64" and type(record["binary_bytes"]) is int and
             record["binary_bytes"] == len(binary), "resource-manifest")
        for key, data in (("source_sha256", source), ("binary_sha256", binary)):
            need(type(record[key]) is str and re.fullmatch("[a-f0-9]{64}", record[key]) and
                 record[key] == hashlib.sha256(data).hexdigest(), "resource-identity")
        # Validate the fixed x64 executable form in addition to the build digest.
        offset, = struct.unpack_from("<I", binary, 0x3c)
        need(binary[:2] == b"MZ" and 64 <= offset <= min(4096, len(binary) - 24), "resource-image")
        need(binary[offset:offset + 4] == b"PE\0\0" and
             struct.unpack_from("<H", binary, offset + 4)[0] == 0x8664 and
             not (struct.unpack_from("<H", binary, offset + 22)[0] & 0x2000), "resource-image")
    except (ValueError, TypeError, OverflowError, RecursionError, struct.error):
        raise NativeFailure("resource-manifest") from None


class _Resource:
    def __init__(self, native):
        self.native, self.handles = native, []
        self.executable = None
        self._close_lock = threading.RLock()
        self._close_attempts = {}
        self._closing = False

    def close(self):
        self._closing = True
        _CLOSING_RESOURCES[id(self)] = self
        try:
            with self._close_lock:
                return self._close_held()
        except BaseException:
            # Lock entry, snapshot allocation and bookkeeping can all fail.
            # Preserve the primary open/read error and exact native custody.
            _UNCERTAIN_RESOURCES[id(self)] = self
            return False

    def _close_held(self):
        handles = self.handles
        for handle in reversed(tuple(handles)):
            attempt = self._close_attempts.get(handle)
            if attempt is not None:
                # An earlier unknown result, or a reentrant attempt, cannot
                # be made safe by a later positive native return value.
                attempt["state"] = "unknown"
                _UNCERTAIN_RESOURCES[id(self)] = self
                continue
            attempt = {"handle": handle, "state": "closing"}
            self._close_attempts[handle] = attempt
            try:
                need(self.native.k.CloseHandle(handle), "resource-close")
                need(attempt["state"] == "closing" and self.handles is handles and
                     handles.count(handle) == 1, "resource-close-identity")
                handles.remove(handle)
                attempt["state"] = "closed"
            except BaseException:
                attempt["state"] = "unknown"
                _UNCERTAIN_RESOURCES[id(self)] = self
        if (self.handles or id(self) in _UNCERTAIN_RESOURCES or
                any(item["state"] != "closed" for item in self._close_attempts.values())):
            _UNCERTAIN_RESOURCES[id(self)] = self
            return False
        _CLOSING_RESOURCES.pop(id(self), None)
        return True

    def _check_active(self, check_cancelled):
        need(not self._closing, "retired-resource-lease")
        if check_cancelled is not None:
            check_cancelled()
        # RLock allows a cancellation callback to retire this resource. It must
        # not return to an acquisition or read on that retired generation.
        need(not self._closing, "retired-resource-lease")

    def pin(self, path, *, directory=False, maximum=0, check_cancelled=None):
        # Serialize synchronous native reads with close; never hold this lock
        # across process pipe joins. Check again after every callback reentry.
        with self._close_lock:
            return self._pin(path, directory=directory, maximum=maximum,
                             check_cancelled=check_cancelled)

    def _pin(self, path, *, directory, maximum, check_cancelled):
        self._check_active(check_cancelled)
        # Attribute-only directory handles do not participate in delete-sharing
        # checks. Request LIST_DIRECTORY too, without enumerating any contents.
        access = 0x81 if directory else 0x80000000
        sharing = 3 if directory else 1  # Directory readers/writers, no deletion; file readers only.
        flags = 0x02000000 | 0x00200000 if directory else 0x00200000
        handle = self.native.k.CreateFileW(str(path), access, sharing, None, 3, flags, None)
        need(handle and handle != c.c_void_p(-1).value, "resource-open")
        self.handles.append(handle)
        self._check_active(check_cancelled)
        info = FileInfo()
        need(not self.native.inheritable(handle) and
             self.native.k.GetFileType(handle) == 1 and
             self.native.k.GetFileInformationByHandle(handle, c.byref(info)), "resource-file")
        need(not info.attributes & 0x400 and bool(info.attributes & 0x10) == directory,
             "resource-redirected")
        if directory:
            return None
        length = info.size_low | info.size_high << 32
        need(info.links == 1 and 0 < length <= maximum, "resource-bounds")
        data = bytearray()
        buffer = c.create_string_buffer(65536)
        while True:
            self._check_active(check_cancelled)
            count = c.c_uint32()
            need(self.native.k.ReadFile(handle, buffer, len(buffer), c.byref(count), None), "resource-read")
            self._check_active(check_cancelled)
            if not count.value:
                break
            data.extend(buffer.raw[:count.value])
            need(len(data) <= maximum, "resource-bounds")
        need(len(data) == length, "resource-changed")
        return bytes(data)


def _open_bundle(native, folder):
    """Private implementation seam; the public adapter always uses its fixed folder."""
    need(not _UNCERTAIN_RESOURCES, "uncertain-resource-lease")
    need(folder.is_absolute() and len(folder.drive) == 2 and folder.drive.endswith(":"),
         "resource-local-drive")
    resource = _Resource(native)
    try:
        # Pin ancestors in order before opening children. OPEN_REPARSE_POINT and
        # native attribute checks reject junctions, symlinks and other redirects.
        for directory in (*reversed(folder.parents), folder):
            resource.pin(directory, directory=True)
        source = resource.pin(folder / "WindowsOcrHelper.cs", maximum=MAX_SOURCE_BYTES)
        resource.pin(folder / "build", directory=True)
        manifest = resource.pin(folder / "build" / "resource.json", maximum=MAX_MANIFEST_BYTES)
        executable = folder / "build" / "WindowsOcrHelper.exe"
        binary = resource.pin(executable, maximum=MAX_BINARY_BYTES)
        _validate_manifest(manifest, source, binary)
        resource.executable = executable
        return resource
    except BaseException:
        try:
            resource.close()
        except BaseException:
            _CLOSING_RESOURCES[id(resource)] = resource
            _UNCERTAIN_RESOURCES[id(resource)] = resource
        raise


def open_resource(native: Windows):
    return _open_bundle(native, Path(__file__).absolute().parent / "native")
