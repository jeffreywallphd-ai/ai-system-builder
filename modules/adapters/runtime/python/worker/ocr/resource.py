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
from .windows_api import FileInfo, NativeFailure, Windows, need

MAX_BINARY_BYTES = 2 * 1024**2
MAX_SOURCE_BYTES = 1024**2
MAX_MANIFEST_BYTES = 4096
_UNCERTAIN_RESOURCES = {}


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

    def close(self):
        # Keep every unacknowledged handle alive. Do not silently unlock a lease.
        remaining = []
        for handle in reversed(self.handles):
            try:
                acknowledged = bool(self.native.k.CloseHandle(handle))
            except BaseException:
                acknowledged = False
            if not acknowledged:
                remaining.append(handle)
        self.handles = list(reversed(remaining))
        if self.handles:
            _UNCERTAIN_RESOURCES[id(self)] = self
            return False
        return True

    def pin(self, path, *, directory=False, maximum=0):
        # Attribute-only directory handles do not participate in delete-sharing
        # checks. Request LIST_DIRECTORY too, without enumerating any contents.
        access = 0x81 if directory else 0x80000000
        sharing = 3 if directory else 1  # Directory readers/writers, no deletion; file readers only.
        flags = 0x02000000 | 0x00200000 if directory else 0x00200000
        handle = self.native.k.CreateFileW(str(path), access, sharing, None, 3, flags, None)
        need(handle and handle != c.c_void_p(-1).value, "resource-open")
        self.handles.append(handle)
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
            count = c.c_uint32()
            need(self.native.k.ReadFile(handle, buffer, len(buffer), c.byref(count), None), "resource-read")
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
        resource.close()
        raise


def open_resource(native: Windows):
    return _open_bundle(native, Path(__file__).absolute().parent / "native")
