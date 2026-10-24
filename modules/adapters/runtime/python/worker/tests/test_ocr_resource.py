"""Portable resource identity denials; actual locking needs Windows qualification."""
import hashlib
import json
import struct
import unittest
from unittest.mock import Mock, patch
from modules.adapters.runtime.python.worker.ocr import resource as r
from modules.adapters.runtime.python.worker.ocr.windows_api import NativeFailure


class OcrResourceTests(unittest.TestCase):
    def setUp(self):
        self.source = b"fixed synthetic source"
        binary = bytearray(256)
        binary[:2] = b"MZ"
        struct.pack_into("<I", binary, 0x3c, 64)
        binary[64:68] = b"PE\0\0"
        struct.pack_into("<H", binary, 68, 0x8664)
        self.binary = bytes(binary)
        self.manifest = {"schema_version": "windows-ocr-resource-v1", "provider": "windows",
                         "provider_version": "1", "architecture": "x64",
                         "source_sha256": hashlib.sha256(self.source).hexdigest(),
                         "binary_sha256": hashlib.sha256(self.binary).hexdigest(),
                         "binary_bytes": len(self.binary)}

    def raw(self, **changes):
        return json.dumps({**self.manifest, **changes}).encode()

    def test_exact_complete_resource_is_accepted(self):
        r._validate_manifest(self.raw(), self.source, self.binary)

    def test_source_or_binary_change_is_denied(self):
        for source, binary in ((self.source + b"changed", self.binary),
                               (self.source, self.binary + b"changed")):
            with self.subTest(source_changed=source != self.source), self.assertRaises(NativeFailure):
                r._validate_manifest(self.raw(), source, binary)

    def test_exact_fields_types_versions_and_digests(self):
        for changes in ({"extra": True}, {"provider": "external"}, {"architecture": "arm64"},
                        {"provider_version": 1}, {"schema_version": "other"},
                        {"source_sha256": "A" * 64}, {"binary_sha256": "f" * 64},
                        {"binary_bytes": True}, {"binary_bytes": 255}):
            with self.subTest(changes=changes), self.assertRaises(NativeFailure):
                r._validate_manifest(self.raw(**changes), self.source, self.binary)

    def test_duplicate_missing_and_wrong_container_are_denied(self):
        missing = dict(self.manifest)
        del missing["architecture"]
        values = [b"[]", b"null", json.dumps(missing).encode(),
                  self.raw()[:-1] + b',"provider":"windows"}']
        for value in values:
            with self.subTest(value=value[:20]), self.assertRaises(NativeFailure):
                r._validate_manifest(value, self.source, self.binary)

    def test_malformed_manifest_bounds_and_errors_are_content_safe(self):
        for value in (b"", b"private synthetic secret", b"\xff", b"x" * 4097,
                      b"[" * 1500 + b"]" * 1500):
            with self.assertRaises(NativeFailure) as error:
                r._validate_manifest(value, self.source, self.binary)
            self.assertNotIn("private synthetic secret", str(error.exception))

    def test_binary_type_and_bounds_are_checked_before_header(self):
        for binary in (b"", b"x" * 255, b"x" * (r.MAX_BINARY_BYTES + 1), bytearray(self.binary)):
            with self.assertRaises(NativeFailure):
                r._validate_manifest(self.raw(), self.source, binary)

    def test_source_is_bounded_immutable_bytes(self):
        for source in (b"", b"x" * (r.MAX_SOURCE_BYTES + 1), bytearray(self.source)):
            with self.assertRaises(NativeFailure):
                r._validate_manifest(self.raw(), source, self.binary)

    def test_even_matching_digest_cannot_allow_wrong_executable_form(self):
        for offset, replacement in ((0, b"NO"), (0x3c, struct.pack("<I", 0xffffffff)),
                                     (64, b"NOPE"), (68, b"\x4c\x01"), (86, b"\x00\x20")):
            binary = bytearray(self.binary)
            binary[offset:offset + len(replacement)] = replacement
            binary = bytes(binary)
            with self.assertRaises(NativeFailure):
                r._validate_manifest(self.raw(binary_sha256=hashlib.sha256(binary).hexdigest()),
                                     self.source, binary)

    def test_failed_close_retains_exact_resource_and_handle(self):
        native = Mock()
        native.k.CloseHandle.side_effect = [True, False]
        lease = r._Resource(native)
        lease.handles = [101, 102]
        with patch.dict(r._UNCERTAIN_RESOURCES, {}, clear=True):
            self.assertFalse(lease.close())
            self.assertEqual(lease.handles, [101])
            self.assertIs(r._UNCERTAIN_RESOURCES[id(lease)], lease)

    def test_raised_close_still_retires_other_handles_and_retains_uncertainty(self):
        native = Mock()
        native.k.CloseHandle.side_effect = [OSError("synthetic-private-error"), True]
        lease = r._Resource(native)
        lease.handles = [101, 102]
        with patch.dict(r._UNCERTAIN_RESOURCES, {}, clear=True):
            self.assertFalse(lease.close())
            self.assertEqual(lease.handles, [102])
            self.assertEqual(native.k.CloseHandle.call_count, 2)
            self.assertIs(r._UNCERTAIN_RESOURCES[id(lease)], lease)


if __name__ == "__main__":
    unittest.main()
