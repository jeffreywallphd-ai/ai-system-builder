"""Portable resource identity denials; actual locking needs Windows qualification."""
import hashlib
import json
import struct
import threading
from pathlib import PureWindowsPath
import unittest
from unittest.mock import Mock, patch
from modules.adapters.runtime.python.worker.ocr import resource as r
from modules.adapters.runtime.python.worker.ocr.windows_api import NativeFailure


class OcrResourceTests(unittest.TestCase):
    def test_uncertain_close_never_retries_even_after_handle_list_rebinding(self):
        for failure in (False, OSError("private"), KeyboardInterrupt(), SystemExit()):
            with self.subTest(failure=type(failure).__name__), \
                    patch.dict(r._UNCERTAIN_RESOURCES, {}, clear=True), \
                    patch.dict(r._CLOSING_RESOURCES, {}, clear=True):
                lease = r._Resource(Mock())
                lease.handles = [101, 102]
                def close(handle):
                    self.assertIs(r._CLOSING_RESOURCES[id(lease)], lease)
                    if handle == 101:
                        return True
                    if isinstance(failure, BaseException):
                        raise failure
                    return failure
                lease.native.k.CloseHandle.side_effect = close
                self.assertFalse(lease.close())
                lease.handles = []
                self.assertFalse(lease.close())
                self.assertEqual(lease.native.k.CloseHandle.call_count, 2)
                self.assertEqual(lease._close_attempts[102]["handle"], 102)
                self.assertIs(r._UNCERTAIN_RESOURCES[id(lease)], lease)

    def test_successful_close_is_idempotent_and_never_reopens(self):
        lease = r._Resource(Mock())
        lease.handles = [101]
        lease.native.k.CloseHandle.return_value = True
        with patch.dict(r._CLOSING_RESOURCES, {}, clear=True):
            self.assertTrue(lease.close())
            self.assertTrue(lease.close())
            self.assertNotIn(id(lease), r._CLOSING_RESOURCES)
            with self.assertRaises(NativeFailure):
                lease.pin("synthetic", directory=True)
            lease.native.k.CreateFileW.assert_not_called()
            lease.native.k.CloseHandle.assert_called_once_with(101)

    def test_post_ack_list_failure_keeps_exact_attempt(self):
        class Broken(list):
            def remove(self, handle):
                super().remove(handle)
                raise KeyboardInterrupt()
        lease = r._Resource(Mock())
        lease.handles = Broken([101])
        lease.native.k.CloseHandle.return_value = True
        with patch.dict(r._UNCERTAIN_RESOURCES, {}, clear=True), \
                patch.dict(r._CLOSING_RESOURCES, {}, clear=True):
            self.assertFalse(lease.close())
            self.assertFalse(lease.close())
            self.assertEqual(lease._close_attempts[101]["handle"], 101)
            lease.native.k.CloseHandle.assert_called_once_with(101)

    def test_cancellation_callback_cannot_close_then_open_or_use_a_generation(self):
        for checkpoint in (1, 2):
            lease = r._Resource(Mock())
            lease.native.k.CreateFileW.return_value = 101
            calls = 0
            def check():
                nonlocal calls
                calls += 1
                if calls == checkpoint:
                    self.assertTrue(lease.close())
            with self.subTest(checkpoint=checkpoint), self.assertRaises(NativeFailure):
                lease.pin("synthetic", directory=True, check_cancelled=check)
            self.assertEqual(lease.native.k.CreateFileW.call_count, checkpoint - 1)
            lease.native.k.GetFileType.assert_not_called()
            lease.native.k.ReadFile.assert_not_called()

    def test_native_read_completes_before_concurrent_close_and_returns_no_later_bytes(self):
        lease = r._Resource(Mock())
        native = lease.native
        native.k.CreateFileW.return_value = 101
        native.inheritable.return_value = False
        native.k.GetFileType.return_value = 1
        def info(handle, pointer):
            pointer._obj.links = 1
            pointer._obj.size_low = 1
            return True
        native.k.GetFileInformationByHandle.side_effect = info
        entered, release = threading.Event(), threading.Event()
        def read(handle, buffer, length, count, overlapped):
            entered.set()
            self.assertTrue(release.wait(2))
            count._obj.value = 0
            return True
        native.k.ReadFile.side_effect = read
        errors = []
        def pin():
            try:
                lease.pin("synthetic", maximum=1)
            except NativeFailure as error:
                errors.append(str(error))
        reader = threading.Thread(target=pin)
        closer = threading.Thread(target=lease.close)
        reader.start()
        try:
            self.assertTrue(entered.wait(2))
            closer.start()
            native.k.CloseHandle.assert_not_called()
        finally:
            release.set(); reader.join(2)
            if closer.ident is not None:
                closer.join(2)
        self.assertFalse(reader.is_alive() or closer.is_alive())
        self.assertEqual(errors, ["retired-resource-lease"])
        native.k.CloseHandle.assert_called_once_with(101)

    def test_cancel_during_read_reentry_stops_before_another_native_read(self):
        lease = r._Resource(Mock())
        native = lease.native
        native.k.CreateFileW.return_value = 101
        native.inheritable.return_value = False
        native.k.GetFileType.return_value = 1
        def info(handle, pointer):
            pointer._obj.links = 1; pointer._obj.size_low = 1
            return True
        native.k.GetFileInformationByHandle.side_effect = info
        def read(handle, buffer, length, count, overlapped):
            count._obj.value = 1
            return True
        native.k.ReadFile.side_effect = read
        calls = 0
        def check():
            nonlocal calls
            calls += 1
            if calls == 4:
                self.assertTrue(lease.close())
        with self.assertRaises(NativeFailure):
            lease.pin("synthetic", maximum=1, check_cancelled=check)
        native.k.ReadFile.assert_called_once()
        native.k.CloseHandle.assert_called_once_with(101)

    def test_bundle_failure_preserves_primary_error_when_close_is_unknown(self):
        lease = r._Resource(Mock())
        lease.handles = [101]
        lease.native.k.CloseHandle.side_effect = KeyboardInterrupt()
        original = NativeFailure("resource-redirected")
        lease.pin = Mock(side_effect=original)
        with patch.object(r, "_Resource", return_value=lease), \
                patch.dict(r._UNCERTAIN_RESOURCES, {}, clear=True), \
                patch.dict(r._CLOSING_RESOURCES, {}, clear=True):
            with self.assertRaises(NativeFailure) as caught:
                r._open_bundle(lease.native, PureWindowsPath("C:/fixed/native"))
            self.assertIs(caught.exception, original)
            self.assertFalse(lease.close())
            lease.native.k.CloseHandle.assert_called_once_with(101)

    def test_preexisting_uncertainty_survives_other_successful_closes(self):
        lease = r._Resource(Mock())
        lease.handles = [101]
        lease.native.k.CloseHandle.return_value = True
        with patch.dict(r._UNCERTAIN_RESOURCES, {id(lease): lease}, clear=True), \
                patch.dict(r._CLOSING_RESOURCES, {}, clear=True):
            self.assertFalse(lease.close())
            self.assertFalse(lease.close())
            self.assertIs(r._UNCERTAIN_RESOURCES[id(lease)], lease)
            lease.native.k.CloseHandle.assert_called_once_with(101)

    def test_snapshot_failure_retains_terminal_custody_and_original_bundle_error(self):
        class Interrupted(list):
            def __iter__(self):
                raise MemoryError()
        lease = r._Resource(Mock())
        lease.handles = Interrupted([101])
        original = NativeFailure("resource-redirected")
        lease.pin = Mock(side_effect=original)
        with patch.object(r, "_Resource", return_value=lease), \
                patch.dict(r._UNCERTAIN_RESOURCES, {}, clear=True), \
                patch.dict(r._CLOSING_RESOURCES, {}, clear=True):
            with self.assertRaises(NativeFailure) as caught:
                r._open_bundle(lease.native, PureWindowsPath("C:/fixed/native"))
            self.assertIs(caught.exception, original)
            self.assertIs(r._UNCERTAIN_RESOURCES[id(lease)], lease)
            self.assertIs(r._CLOSING_RESOURCES[id(lease)], lease)
            self.assertFalse(lease.close())
            lease.native.k.CloseHandle.assert_not_called()

    def test_ack_with_rebound_list_keeps_original_value_and_never_retries(self):
        lease = r._Resource(Mock())
        lease.handles = [101]
        def close(handle):
            lease.handles = []
            return True
        lease.native.k.CloseHandle.side_effect = close
        with patch.dict(r._UNCERTAIN_RESOURCES, {}, clear=True), \
                patch.dict(r._CLOSING_RESOURCES, {}, clear=True):
            self.assertFalse(lease.close())
            self.assertFalse(lease.close())
            self.assertEqual(lease._close_attempts[101]["handle"], 101)
            lease.native.k.CloseHandle.assert_called_once_with(101)

    def test_lock_entry_interruption_retains_closed_admission_and_primary_error(self):
        lease = r._Resource(Mock())
        lease.handles = [101]
        class InterruptedLock:
            def __enter__(self):
                raise KeyboardInterrupt()
            def __exit__(self, *args):
                return False
        lease._close_lock = InterruptedLock()
        original = NativeFailure("resource-redirected")
        lease.pin = Mock(side_effect=original)
        with patch.object(r, "_Resource", return_value=lease), \
                patch.dict(r._UNCERTAIN_RESOURCES, {}, clear=True), \
                patch.dict(r._CLOSING_RESOURCES, {}, clear=True):
            with self.assertRaises(NativeFailure) as caught:
                r._open_bundle(lease.native, PureWindowsPath("C:/fixed/native"))
            self.assertIs(caught.exception, original)
            self.assertTrue(lease._closing)
            self.assertIs(r._UNCERTAIN_RESOURCES[id(lease)], lease)
            self.assertIs(r._CLOSING_RESOURCES[id(lease)], lease)
            self.assertFalse(lease.close())
            lease.native.k.CloseHandle.assert_not_called()

    def test_bundle_primary_error_survives_an_unexpected_cleanup_exception(self):
        lease = r._Resource(Mock())
        original = NativeFailure("resource-redirected")
        lease.pin = Mock(side_effect=original)
        lease.close = Mock(side_effect=SystemExit())
        with patch.object(r, "_Resource", return_value=lease), \
                patch.dict(r._UNCERTAIN_RESOURCES, {}, clear=True), \
                patch.dict(r._CLOSING_RESOURCES, {}, clear=True):
            with self.assertRaises(NativeFailure) as caught:
                r._open_bundle(lease.native, PureWindowsPath("C:/fixed/native"))
            self.assertIs(caught.exception, original)
            self.assertIs(r._UNCERTAIN_RESOURCES[id(lease)], lease)
            self.assertIs(r._CLOSING_RESOURCES[id(lease)], lease)
            lease.close.assert_called_once()

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
