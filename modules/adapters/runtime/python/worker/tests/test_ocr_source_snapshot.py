"""Portable source-binding/native fault tests; physical Windows checks are separate."""
import ctypes as c
from dataclasses import replace
import hashlib
from pathlib import PureWindowsPath
import threading
import unittest
from unittest.mock import Mock, patch

from modules.adapters.runtime.python.worker.ocr import resource, source_snapshot as s
from modules.adapters.runtime.python.worker.ocr.protocol import MAX_SOURCE_BYTES, OcrCancelled, OcrContractError

ROOT = r"C:\owned\ai-system-builder-runtime-abcdef"
NAME = "0001-synthetic.pdf"
ARTIFACT = "synthetic-artifact"
DATA = b"%PDF-1.7 synthetic private source"


def binding(**changes):
    return s.OcrSourceBinding(**{"stage_root": ROOT, "file_name": NAME, "artifact_id": ARTIFACT,
                                "byte_length": len(DATA), "sha256": hashlib.sha256(DATA).hexdigest(), **changes})


class NativeFixture:
    def __init__(self, data=DATA):
        self.data, self.position, self.entries = data, 0, {}
        self.k = Mock()
        self.inheritable = Mock(return_value=False)
        self.k.CreateFileW.side_effect = self.open
        self.k.GetFileType.return_value = 1
        self.k.GetDriveTypeW.return_value = 3
        self.k.GetFileInformationByHandle.side_effect = self.info
        self.k.ReadFile.side_effect = self.read
        self.k.CloseHandle.return_value = True

    def open(self, path, access, sharing, security, disposition, flags, template):
        handle = 100 + len(self.entries)
        self.entries[handle] = access == 0x81
        return handle

    def info(self, handle, pointer):
        record = pointer._obj
        record.attributes = 0x10 if self.entries[handle] else 0
        record.links, record.volume, record.index_low = 1, 23, handle
        record.size_low = len(self.data) if not self.entries[handle] else 0
        return True

    def read(self, handle, buffer, maximum, count, overlapped):
        value = self.data[self.position:self.position + maximum]
        self.position += len(value)
        c.memmove(buffer, value, len(value))
        count._obj.value = len(value)
        return True


class OcrSourceSnapshotTests(unittest.TestCase):
    def setUp(self):
        # Fake-only ownership state. No production/native retained owner is reset.
        self.lock_patch = patch.object(s, "_CAPTURE_LOCK", threading.Lock())
        self.registry_patch = patch.dict(resource._UNCERTAIN_RESOURCES, {}, clear=True)
        self.lock_patch.start()
        self.registry_patch.start()
        self.addCleanup(self.lock_patch.stop)
        self.addCleanup(self.registry_patch.stop)

    def capture(self, value=None, **changes):
        args = {"stage_root": ROOT, "local_path": str(PureWindowsPath(ROOT) / NAME),
                "artifact_id": ARTIFACT, **changes}
        return s.capture_source(binding() if value is None else value, **args)

    def closed(self, native):
        self.assertEqual([call.args[0] for call in native.k.CloseHandle.call_args_list],
                         list(reversed(native.entries)))
        self.assertFalse(resource._UNCERTAIN_RESOURCES)
        self.assertFalse(s._CAPTURE_LOCK.locked())

    def test_exact_bytes_and_ancestor_first_noninheritable_read_leases(self):
        native = NativeFixture()
        with patch.object(s, "Windows", return_value=native):
            self.assertEqual(self.capture(), DATA)
        calls = native.k.CreateFileW.call_args_list
        root = PureWindowsPath(ROOT)
        self.assertEqual([call.args[0] for call in calls],
                         [str(p) for p in (*reversed(root.parents), root, root / NAME)])
        for call in calls[:-1]:
            self.assertEqual(call.args[1:3], (0x81, 3))
            self.assertTrue(call.args[5] & 0x00200000)
        self.assertEqual(calls[-1].args[1:3], (0x80000000, 1))
        self.assertEqual(native.inheritable.call_count, len(calls))
        native.k.GetDriveTypeW.assert_called_once_with(root.anchor)
        self.assertEqual(native.k.GetDriveTypeW.argtypes, [c.c_wchar_p])
        self.assertIs(native.k.GetDriveTypeW.restype, c.c_uint32)
        self.closed(native)

    def test_root_traversal_alias_network_device_and_noncanonical_forms_deny(self):
        roots = ["", ROOT + "\\", ROOT.replace("\\", "/"), "C:relative",
                 ROOT.replace("owned", ".."), ROOT.replace("owned", "OWNED~1"),
                 ROOT.replace("owned", "CON"), ROOT.replace("owned", "COM¹.txt"),
                 ROOT.replace("owned", "owned."), ROOT.replace("owned", "owned "),
                 ROOT.replace("owned", "owned:stream"), r"\\server\share\task",
                 r"\\?\C:\owned\ai-system-builder-runtime-abcdef", "C:\\", None, 123]
        with patch.object(s, "Windows") as constructor:
            for root in roots:
                with self.subTest(root=root), self.assertRaises(OcrContractError):
                    binding(stage_root=root)
            constructor.assert_not_called()

    def test_only_exact_generated_bounded_pdf_child_is_accepted(self):
        values = ["../0001-source.pdf", "child\\0001-source.pdf", "0001-source.pdf:ads",
                  "0001-source.pdf ", "0001-source.PDF", "0000-source.pdf", "0257-source.pdf",
                  "0001-~1.pdf", "0001-source.png", "0001-" + "x" * 240 + ".pdf", True]
        for name in values:
            with self.subTest(name=name), self.assertRaises(OcrContractError):
                binding(file_name=name)

    def test_digest_length_and_artifact_types_are_strict_and_bounded(self):
        for field, values in {"sha256": ["A" * 64, "f" * 63, "sha256:" + "f" * 64, None],
                              "byte_length": [0, -1, True, 1.0, MAX_SOURCE_BYTES + 1],
                              "artifact_id": ["", "x" * 513, "private\nvalue", "\ud800", 23]}.items():
            for value in values:
                with self.subTest(field=field, value=repr(value)), self.assertRaises(OcrContractError):
                    binding(**{field: value})

    def test_binding_representation_excludes_source_id_path_name_and_digest(self):
        shown = repr(binding())
        for private in (ROOT, NAME, ARTIFACT, hashlib.sha256(DATA).hexdigest()):
            self.assertNotIn(private, shown)

    def test_nonfixed_unknown_or_invalid_drive_type_denies_before_file_acquisition(self):
        for value in (0, 1, 2, 4, 5, 6, 7, True, "3", None):
            native = NativeFixture()
            native.k.GetDriveTypeW.return_value = value
            with self.subTest(value=value), patch.object(s, "Windows", return_value=native):
                with self.assertRaises(OcrContractError):
                    self.capture()
                native.k.CreateFileW.assert_not_called()
                native.k.CloseHandle.assert_not_called()
                self.assertFalse(s._CAPTURE_LOCK.locked())

    def test_failed_drive_query_is_sanitized_before_acquisition_and_can_retry(self):
        native = NativeFixture()
        native.k.GetDriveTypeW.side_effect = OSError("private-network-drive")
        with patch.object(s, "Windows", return_value=native):
            with self.assertRaises(OcrContractError) as error:
                self.capture()
            self.assertEqual(str(error.exception), s._ERROR)
            native.k.CreateFileW.assert_not_called()
            self.assertFalse(s._CAPTURE_LOCK.locked())
            native.k.GetDriveTypeW.side_effect = None
            native.k.GetDriveTypeW.return_value = 3
            self.assertEqual(self.capture(), DATA)
        self.closed(native)

    def test_task_root_path_and_artifact_must_match_before_native_io(self):
        with patch.object(s, "Windows") as constructor:
            for change in ({"stage_root": ROOT + "other"}, {"artifact_id": "other"},
                           {"local_path": str(PureWindowsPath(ROOT) / "0002-other.pdf")},
                           {"local_path": str(PureWindowsPath(ROOT) / NAME).lower()},
                           {"cancelled": False}):
                with self.subTest(change=change), self.assertRaises(OcrContractError):
                    self.capture(**change)
            constructor.assert_not_called()

    def test_forged_or_mutated_binding_is_revalidated(self):
        value = binding()
        object.__setattr__(value, "file_name", "../other.pdf")
        with patch.object(s, "Windows") as constructor:
            for invalid in (value, {}, None):
                with self.assertRaises(OcrContractError):
                    s.capture_source(invalid, stage_root=ROOT, local_path=ROOT, artifact_id=ARTIFACT)
            constructor.assert_not_called()

    def test_changed_content_or_length_deny_without_poisoning_acknowledged_cleanup(self):
        for value in (replace(binding(), sha256="0" * 64), replace(binding(), byte_length=len(DATA) + 1)):
            native = NativeFixture()
            with patch.object(s, "Windows", return_value=native), self.assertRaises(OcrContractError):
                self.capture(value)
            self.closed(native)
        native = NativeFixture()
        with patch.object(s, "Windows", return_value=native):
            self.assertEqual(self.capture(), DATA)

    def test_every_partial_open_failure_retires_only_acquired_handles(self):
        count = len(PureWindowsPath(ROOT).parents) + 2
        for failed_index in range(count):
            native = NativeFixture()
            def opening(*args):
                return 0 if len(native.entries) == failed_index else native.open(*args)
            native.k.CreateFileW.side_effect = opening
            with self.subTest(failed_index=failed_index), patch.object(s, "Windows", return_value=native):
                with self.assertRaises(OcrContractError):
                    self.capture()
            self.closed(native)

    def test_native_metadata_redirect_type_link_and_bound_failures_deny(self):
        for field, value in (("attributes", 0x400), ("attributes", 0x10), ("links", 2),
                             ("size_low", 0), ("size_low", MAX_SOURCE_BYTES + 1)):
            native = NativeFixture()
            def metadata(handle, pointer):
                native.info(handle, pointer)
                if not native.entries[handle]:
                    setattr(pointer._obj, field, value)
                return True
            native.k.GetFileInformationByHandle.side_effect = metadata
            with self.subTest(field=field, value=value), patch.object(s, "Windows", return_value=native):
                with self.assertRaises(OcrContractError):
                    self.capture()
            self.closed(native)

    def test_native_file_type_flags_and_info_failures_close_acquired_handle(self):
        for operation in ("inheritable", "GetFileType", "GetFileInformationByHandle"):
            native = NativeFixture()
            call = native.inheritable if operation == "inheritable" else getattr(native.k, operation)
            call.side_effect = None
            call.return_value = True if operation == "inheritable" else 0
            with self.subTest(operation=operation), patch.object(s, "Windows", return_value=native):
                with self.assertRaises(OcrContractError):
                    self.capture()
            self.closed(native)

    def test_read_failure_or_private_exception_is_sanitized_and_retired(self):
        for result in (False, OSError("C:\\private-source synthetic-secret")):
            native = NativeFixture()
            native.k.ReadFile.side_effect = result if isinstance(result, Exception) else None
            native.k.ReadFile.return_value = result
            with patch.object(s, "Windows", return_value=native), self.assertRaises(OcrContractError) as error:
                self.capture()
            self.assertEqual(str(error.exception), s._ERROR)
            self.closed(native)

    def test_native_observed_length_change_is_rejected(self):
        native = NativeFixture()
        def metadata(handle, pointer):
            native.info(handle, pointer)
            if not native.entries[handle]:
                pointer._obj.size_low += 1
            return True
        native.k.GetFileInformationByHandle.side_effect = metadata
        with patch.object(s, "Windows", return_value=native), self.assertRaises(OcrContractError):
            self.capture()
        self.closed(native)

    def test_file_larger_than_authorized_bytes_denies_before_read(self):
        native = NativeFixture(DATA + b"extra")
        with patch.object(s, "Windows", return_value=native), self.assertRaises(OcrContractError):
            self.capture()
        native.k.ReadFile.assert_not_called()
        self.closed(native)

    def test_cancellation_before_io_and_between_actual_bounded_reads(self):
        with patch.object(s, "Windows") as constructor, self.assertRaises(OcrCancelled):
            self.capture(cancelled=lambda: True)
        constructor.assert_not_called()
        native = NativeFixture(b"x" * 130000)
        value = replace(binding(), byte_length=len(native.data), sha256=hashlib.sha256(native.data).hexdigest())
        with patch.object(s, "Windows", return_value=native), self.assertRaises(OcrCancelled):
            self.capture(value, cancelled=lambda: native.position > 0)
        self.assertEqual(native.position, 65536)
        self.closed(native)

    def test_bad_cancellation_callback_is_fixed_error_and_does_not_hold_admission(self):
        for value in (1, None, "private-error"):
            with self.assertRaises(OcrContractError) as error:
                self.capture(cancelled=lambda: value)
            self.assertEqual(str(error.exception), s._ERROR)
            self.assertFalse(s._CAPTURE_LOCK.locked())
        with self.assertRaises(OcrContractError):
            self.capture(cancelled=Mock(side_effect=OSError("private-error")))

    def test_uncertain_close_retains_owner_and_denies_successor_without_retry(self):
        for failed_close in (False, OSError("private-close-error")):
            with self.subTest(failed_close=repr(failed_close)), patch.dict(resource._UNCERTAIN_RESOURCES, {}, clear=True), patch.object(s, "_CAPTURE_LOCK", threading.Lock()):
                native = NativeFixture()
                native.k.CloseHandle.side_effect = [failed_close, True, True, True]
                with patch.object(s, "Windows", return_value=native) as constructor:
                    with self.assertRaises(OcrContractError):
                        self.capture()
                    self.assertTrue(s._CAPTURE_LOCK.locked())
                    self.assertEqual(len(resource._UNCERTAIN_RESOURCES), 1)
                    lease = next(iter(resource._UNCERTAIN_RESOURCES.values()))
                    self.assertEqual(len(lease.handles), 1)
                    count = native.k.CloseHandle.call_count
                    self.assertFalse(lease.close())
                    self.assertEqual(native.k.CloseHandle.call_count, count)
                    with self.assertRaises(OcrContractError):
                        self.capture()
                    self.assertEqual(constructor.call_count, 1)
                    with self.assertRaises(Exception):
                        lease.pin("C:\\other")

    def test_retirement_bookkeeping_failure_also_retains_exact_owner(self):
        native = NativeFixture()
        with patch.object(s, "Windows", return_value=native), patch.object(resource._Resource, "close", side_effect=RuntimeError("private")):
            with self.assertRaises(OcrContractError):
                self.capture()
        self.assertTrue(s._CAPTURE_LOCK.locked())
        self.assertEqual(len(resource._UNCERTAIN_RESOURCES), 1)

    def test_native_initialization_failure_releases_unused_capture_slot(self):
        native = NativeFixture()
        with patch.object(s, "Windows", side_effect=[OSError("private-native"), native]):
            with self.assertRaises(OcrContractError):
                self.capture()
            self.assertFalse(s._CAPTURE_LOCK.locked())
            self.assertEqual(self.capture(), DATA)

    def test_concurrent_source_capture_is_refused_without_another_native_owner(self):
        native = NativeFixture()
        def reading(*args):
            with self.assertRaises(OcrContractError):
                self.capture()
            return native.read(*args)
        native.k.ReadFile.side_effect = reading
        with patch.object(s, "Windows", return_value=native) as constructor:
            self.assertEqual(self.capture(), DATA)
            self.assertEqual(constructor.call_count, 1)
        self.closed(native)

    def test_existing_uncertain_resource_prevents_source_acquisition(self):
        resource._UNCERTAIN_RESOURCES[123] = object()
        with patch.object(s, "Windows") as constructor, self.assertRaises(OcrContractError):
            self.capture()
        constructor.assert_not_called()
        self.assertFalse(s._CAPTURE_LOCK.locked())

    def test_interrupt_still_attempts_native_retirement(self):
        native = NativeFixture()
        native.k.ReadFile.side_effect = KeyboardInterrupt()
        with patch.object(s, "Windows", return_value=native), self.assertRaises(KeyboardInterrupt):
            self.capture()
        self.closed(native)


class OcrQualificationProbeTests(unittest.TestCase):
    def setUp(self):
        from modules.adapters.runtime.python.worker.tests import qualification_ocr_source_snapshot as q
        self.q = q
        self.owners = patch.dict(q._PROBES, {}, clear=True)
        self.last_error = patch.object(q.c, "get_last_error", return_value=32, create=True)
        self.owners.start()
        self.last_error.start()
        self.addCleanup(self.owners.stop)
        self.addCleanup(self.last_error.stop)
        self.native = Mock()
        self.native.k.CreateFileW.return_value = 101
        self.native.k.CloseHandle.return_value = True

    def test_probe_is_strongly_owned_before_close_and_retires_exactly_once(self):
        probe = self.q._ProbeOwner(self.native, "synthetic-only", 0x40000000)
        self.assertIs(self.q._PROBES[id(probe)], probe)
        self.assertEqual(probe.handle, 101)
        self.assertTrue(probe.close())
        self.assertFalse(self.q._PROBES)
        self.assertTrue(probe.close())
        self.native.k.CloseHandle.assert_called_once_with(101)

    def test_invalid_returned_handle_is_not_closed_or_retained(self):
        for handle in (0, c.c_void_p(-1).value):
            self.native.k.CreateFileW.return_value = handle
            probe = self.q._ProbeOwner(self.native, "synthetic-only", 0x10000)
            self.assertFalse(probe.valid)
            self.assertEqual(probe.error, 32)
            self.assertFalse(self.q._PROBES)
            self.assertTrue(probe.close())
        self.native.k.CloseHandle.assert_not_called()

    def test_false_and_raised_close_retain_native_and_handle_and_deny_new_probe(self):
        for result in (False, OSError("private-probe-error")):
            with self.subTest(result=repr(result)), patch.dict(self.q._PROBES, {}, clear=True):
                self.native.k.CloseHandle.reset_mock()
                self.native.k.CloseHandle.side_effect = result if isinstance(result, Exception) else None
                self.native.k.CloseHandle.return_value = result
                probe = self.q._ProbeOwner(self.native, "synthetic-only", 0x40000000)
                self.assertFalse(probe.close())
                self.assertIs(self.q._PROBES[id(probe)], probe)
                self.assertIs(probe.native, self.native)
                self.assertEqual(probe.handle, 101)
                self.assertFalse(probe.close())
                self.native.k.CloseHandle.assert_called_once_with(101)
                count = self.native.k.CreateFileW.call_count
                with self.assertRaises(Exception):
                    self.q._ProbeOwner(self.native, "other-synthetic", 0x40000000)
                self.assertEqual(self.native.k.CreateFileW.call_count, count)
                with self.assertRaises(Exception):
                    self.q.source_fresh()

    def test_raised_acquisition_keeps_unknown_owner_without_closing_null_or_retrying(self):
        self.native.k.CreateFileW.side_effect = OSError("private-acquisition-error")
        with self.assertRaises(OSError):
            self.q._ProbeOwner(self.native, "synthetic-only", 0x40000000)
        self.assertEqual(len(self.q._PROBES), 1)
        probe = next(iter(self.q._PROBES.values()))
        self.assertIsNone(probe.handle)
        self.assertFalse(probe.close())
        self.assertFalse(probe.close())
        self.native.k.CloseHandle.assert_not_called()

    def test_interrupted_close_retains_exact_probe_without_retry(self):
        probe = self.q._ProbeOwner(self.native, "synthetic-only", 0x40000000)
        self.native.k.CloseHandle.side_effect = KeyboardInterrupt()
        self.assertFalse(probe.close())
        self.assertIs(self.q._PROBES[id(probe)], probe)
        self.assertFalse(probe.close())
        self.native.k.CloseHandle.assert_called_once_with(101)

    def test_unexpected_admitted_denial_probe_uses_the_retained_owner(self):
        case = self.q.WindowsOcrSourceSnapshot("test_01_pinned_file_and_ancestor_sharing_controls")
        case.native = self.native
        self.native.k.CloseHandle.return_value = False
        with self.assertRaises(Exception):
            case.denied_open("synthetic-only", 0x40000000)
        probe = next(iter(self.q._PROBES.values()))
        self.assertEqual(probe.handle, 101)
        self.assertFalse(probe.close())
        self.native.k.CloseHandle.assert_called_once_with(101)

    def test_acknowledged_probe_allows_only_a_fresh_subsequent_owner(self):
        first = self.q._ProbeOwner(self.native, "first-synthetic", 0x40000000)
        self.assertTrue(first.close())
        self.native.k.CreateFileW.return_value = 102
        second = self.q._ProbeOwner(self.native, "second-synthetic", 0x40000000)
        self.assertIs(self.q._PROBES[id(second)], second)
        self.assertTrue(second.close())
        self.assertEqual([call.args for call in self.native.k.CloseHandle.call_args_list], [(101,), (102,)])


if __name__ == "__main__":
    unittest.main()
