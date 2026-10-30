"""Portable fault semantics. Native lifetime evidence is collected separately."""
import threading
import unittest
from unittest.mock import Mock, patch
from modules.adapters.runtime.python.worker.ocr import windows_process as p
from modules.adapters.runtime.python.worker.ocr.protocol import OcrCancelled
from modules.adapters.runtime.python.worker.ocr.windows_api import NativeFailure, Windows
from modules.adapters.runtime.python.worker.tests import qualification_ocr_windows as q


class OcrProcessTests(unittest.TestCase):
    def test_finish_never_retries_uncertain_child_handle(self):
        native = Mock()
        native.k.CloseHandle.return_value = False
        owner = p._Owner(native)
        owner.hold("stdin-read", 321)
        with patch.dict(p._PENDING, {}, clear=True):
            self.assertFalse(owner.close("stdin-read"))
            self.assertFalse(owner.finish("native-failure")["cleanup_confirmed"])
            owner.finish("native-failure")
            native.k.CloseHandle.assert_called_once_with(321)

    def test_close_has_strong_custody_before_dispatch_without_terminal_uncertainty(self):
        owner = p._Owner(Mock())
        owner.hold("extra", 321)
        def close(handle):
            self.assertIs(p._CLOSING_OWNERS[id(owner)], owner)
            self.assertNotIn(id(owner), p._PENDING)
            return True
        owner.n.k.CloseHandle.side_effect = close
        with patch.dict(p._PENDING, {}, clear=True), patch.dict(p._CLOSING_OWNERS, {}, clear=True):
            self.assertTrue(owner.close("extra"))
            self.assertTrue(owner.close("extra"))
            self.assertNotIn(id(owner), p._CLOSING_OWNERS)
            owner.n.k.CloseHandle.assert_called_once_with(321)

    def test_unknown_close_is_not_repeated_but_other_handles_retire(self):
        for result in (False, OSError("private"), KeyboardInterrupt(), SystemExit()):
            with self.subTest(result=type(result).__name__), \
                    patch.dict(p._PENDING, {}, clear=True), patch.dict(p._CLOSING_OWNERS, {}, clear=True):
                owner = p._Owner(Mock())
                owner.hold("first", 1); owner.hold("second", 2)
                def close(handle):
                    if handle == 2:
                        return True
                    if isinstance(result, BaseException):
                        raise result
                    return result
                owner.n.k.CloseHandle.side_effect = close
                self.assertFalse(owner.close("first"))
                self.assertFalse(owner.close("first"))
                self.assertTrue(owner.close("second"))
                self.assertEqual(owner.n.k.CloseHandle.call_count, 2)
                self.assertIs(p._PENDING[id(owner)], owner)
                self.assertIs(p._CLOSING_OWNERS[id(owner)], owner)

    def test_post_ack_mapping_failure_retains_exact_attempt_without_retry(self):
        class Broken(dict):
            def __delitem__(self, key):
                super().__delitem__(key)
                raise KeyboardInterrupt()
        owner = p._Owner(Mock())
        owner.handles = Broken(extra=321)
        owner.n.k.CloseHandle.return_value = True
        with patch.dict(p._PENDING, {}, clear=True), patch.dict(p._CLOSING_OWNERS, {}, clear=True):
            self.assertFalse(owner.close("extra"))
            self.assertFalse(owner.close("extra"))
            self.assertEqual(owner._close_attempts["extra"]["handle"], 321)
            self.assertFalse(owner.finish(None)["cleanup_confirmed"])
            owner.n.k.CloseHandle.assert_called_once_with(321)

    def test_reentrant_close_fences_even_when_outer_native_call_acknowledges(self):
        owner = p._Owner(Mock())
        owner.hold("extra", 321)
        def close(handle):
            self.assertFalse(owner.close("extra"))
            return True
        owner.n.k.CloseHandle.side_effect = close
        with patch.dict(p._PENDING, {}, clear=True), patch.dict(p._CLOSING_OWNERS, {}, clear=True):
            self.assertFalse(owner.close("extra"))
            self.assertIs(p._PENDING[id(owner)], owner)
            owner.n.k.CloseHandle.assert_called_once_with(321)

    def test_concurrent_close_dispatches_once_and_does_not_clear_prior_uncertainty(self):
        owner = p._Owner(Mock())
        owner.hold("extra", 321)
        entered, release = threading.Event(), threading.Event()
        results = []
        def close(handle):
            entered.set()
            self.assertTrue(release.wait(2))
            return True
        owner.n.k.CloseHandle.side_effect = close
        with patch.dict(p._PENDING, {id(owner): owner}, clear=True):
            first = threading.Thread(target=lambda: results.append(owner.close("extra")))
            second = threading.Thread(target=lambda: results.append(owner.close("extra")))
            first.start()
            try:
                self.assertTrue(entered.wait(2))
                second.start()
            finally:
                release.set()
                first.join(2)
                if second.ident is not None:
                    second.join(2)
            self.assertFalse(first.is_alive() or second.is_alive())
            self.assertEqual(results, [True, True])
            self.assertIs(p._PENDING[id(owner)], owner)
            owner.n.k.CloseHandle.assert_called_once_with(321)

    def test_pipe_join_allows_writer_to_retire_its_handle(self):
        owner = p._Owner(Mock())
        owner.hold("stdin-write", 321)
        owner.n.k.CloseHandle.return_value = True
        def join(timeout):
            writer = threading.Thread(target=lambda: owner.close("stdin-write"))
            writer.start(); writer.join(1)
            self.assertFalse(writer.is_alive())
        pipe = Mock()
        pipe.join.side_effect = join
        pipe.is_alive.return_value = False
        owner.threads = [pipe]
        self.assertTrue(owner.finish(None)["cleanup_confirmed"])
        owner.n.k.CloseHandle.assert_called_once_with(321)

    def test_ack_with_rebound_table_retains_original_value_and_denies_reacquisition(self):
        owner = p._Owner(Mock())
        owner.hold("extra", 321)
        def close(handle):
            owner.handles = {}
            return True
        owner.n.k.CloseHandle.side_effect = close
        with patch.dict(p._PENDING, {}, clear=True), patch.dict(p._CLOSING_OWNERS, {}, clear=True):
            self.assertFalse(owner.close("extra"))
            self.assertFalse(owner.close("extra"))
            self.assertEqual(owner._close_attempts["extra"]["handle"], 321)
            with self.assertRaises(NativeFailure):
                owner.hold("extra", 999)
            owner.n.k.CloseHandle.assert_called_once_with(321)

    def test_close_lock_interruption_retains_owner_and_denies_future_closes(self):
        owner = p._Owner(Mock())
        owner.hold("extra", 321)
        class InterruptedLock:
            def __enter__(self):
                self.custody = p._CLOSING_OWNERS[id(owner)]
                raise KeyboardInterrupt()
            def __exit__(self, *args):
                return False
        lock = owner._close_lock = InterruptedLock()
        with patch.dict(p._PENDING, {}, clear=True), patch.dict(p._CLOSING_OWNERS, {}, clear=True):
            self.assertFalse(owner.close("extra"))
            self.assertIs(lock.custody, owner)
            self.assertIs(p._PENDING[id(owner)], owner)
            owner._close_lock = threading.RLock()
            self.assertFalse(owner.close("extra"))
            self.assertFalse(owner.finish(None)["cleanup_confirmed"])
            self.assertEqual(owner.handles, {"extra": 321})
            owner.n.k.CloseHandle.assert_not_called()

    def test_invalid_exchange_does_not_construct_a_native_owner(self):
        with patch.object(p, "Windows") as native:
            for frame in (b"", b"1234", bytearray(b"12345"), b"x" * (p.MAX_REQUEST_BYTES + 5)):
                with self.assertRaises(NativeFailure):
                    p._execute(frame, lambda: False)
            with self.assertRaises(NativeFailure):
                p._execute(b"12345", None)
            native.assert_not_called()

    def test_concurrent_request_denied_before_native_construction(self):
        with patch.object(p, "_GATE", threading.Lock()), patch.object(p, "Windows") as native:
            p._GATE.acquire()
            try:
                with self.assertRaises(NativeFailure):
                    p._execute(b"12345", lambda: False)
                native.assert_not_called()
            finally:
                p._GATE.release()

    def test_uncertain_owner_or_resource_denies_successor_and_releases_gate(self):
        for name in ("_PENDING", "_UNCERTAIN_RESOURCES"):
            with patch.object(p, name, {123: object()}), patch.object(p, "_GATE", threading.Lock()), \
                    patch.object(p, "Windows") as native:
                with self.assertRaises(NativeFailure):
                    p._execute(b"12345", lambda: False)
                self.assertTrue(p._GATE.acquire(blocking=False))
                p._GATE.release()
                native.assert_not_called()

    def test_public_error_never_copies_native_or_source_details(self):
        with patch.object(p, "_execute", side_effect=NativeFailure("synthetic private diagnostic")):
            with self.assertRaises(p.OcrProcessError) as error:
                p.exchange(b"synthetic private input", lambda: False)
            self.assertEqual(str(error.exception), "Local text recognition is unavailable or did not finish safely.")
            self.assertIsNone(error.exception.__cause__)

    def test_windows_initialization_failure_never_exposes_os_or_path_detail(self):
        with patch.object(p, "Windows", side_effect=OSError("synthetic private OS path")), \
                patch.object(p, "_GATE", threading.Lock()):
            with self.assertRaises(p.OcrProcessError) as error:
                p.exchange(b"12345", lambda: False)
            self.assertEqual(str(error.exception), "Local text recognition is unavailable or did not finish safely.")
            self.assertIsNone(error.exception.__cause__)
            self.assertTrue(p._GATE.acquire(blocking=False))
            p._GATE.release()

    def test_cancelled_result_requires_confirmed_retirement(self):
        with patch.object(p, "_execute", return_value=(b"", {
                "passed": False, "reason": "cancelled", "cleanup_confirmed": True})):
            with self.assertRaises(OcrCancelled):
                p.exchange(b"12345", lambda: True)
        with patch.object(p, "_execute", return_value=(b"partial", {
                "passed": False, "reason": "cancelled", "cleanup_confirmed": False})):
            with self.assertRaises(p.OcrProcessError):
                p.exchange(b"12345", lambda: True)

    def test_no_partial_or_unretired_result_escapes(self):
        with patch.object(p, "_execute", return_value=(b"private partial text", {
                "passed": False, "reason": "native-failure", "cleanup_confirmed": True})):
            with self.assertRaises(p.OcrProcessError):
                p.exchange(b"12345", lambda: False)

    def test_failed_close_retains_exact_owner_and_handle(self):
        native = Mock()
        native.k.CloseHandle.return_value = False
        owner = p._Owner(native)
        owner.handles = {"job": 321}
        with patch.dict(p._PENDING, {}, clear=True):
            self.assertFalse(owner.close("job"))
            self.assertEqual(owner.handles, {"job": 321})
            self.assertIs(p._PENDING[id(owner)], owner)

    def test_cancel_before_prepare_has_no_resource_or_process_side_effect(self):
        native = Mock()
        owner = p._Owner(native)
        with patch.object(p, "open_resource") as resource:
            result, observation = owner.run(b"12345", lambda: True)
        self.assertEqual(result, b"")
        self.assertEqual(observation["reason"], "cancelled")
        self.assertTrue(observation["cleanup_confirmed"])
        resource.assert_not_called()
        native.k.CreateProcessW.assert_not_called()

    def test_raised_close_keeps_owner_and_all_unacknowledged_handles(self):
        native = Mock()
        native.k.CloseHandle.side_effect = OSError("synthetic-private-error")
        owner = p._Owner(native)
        owner.handles = {"extra": 321}
        with patch.dict(p._PENDING, {}, clear=True):
            result = owner.finish("native-failure")
            self.assertFalse(result["cleanup_confirmed"])
            self.assertEqual(owner.handles, {"extra": 321})
            self.assertIs(p._PENDING[id(owner)], owner)

    def test_raised_resource_close_keeps_exact_lease_with_owner(self):
        owner = p._Owner(Mock())
        lease = owner.resource = Mock()
        lease.close.side_effect = OSError("synthetic-private-error")
        with patch.dict(p._PENDING, {}, clear=True):
            result = owner.finish("native-failure")
            self.assertFalse(result["cleanup_confirmed"])
            self.assertIs(p._PENDING[id(owner)].resource, lease)

    def test_qualification_observer_close_failure_retains_read_handle_and_fences(self):
        import ctypes
        for failure in (False, OSError("synthetic-private-error")):
            native = Mock()
            if isinstance(failure, Exception):
                native.k.CloseHandle.side_effect = failure
            else:
                native.k.CloseHandle.return_value = failure
            entry = {"handle": ctypes.c_void_p(123)}
            with patch.dict(q._OBSERVERS, {id(entry): entry}, clear=True), \
                    patch.dict(q._OPERATOR_PENDING, {}, clear=True):
                with self.assertRaises(NativeFailure):
                    q.retire_observer(entry, native)
                self.assertIs(q._OPERATOR_PENDING[id(entry)], entry)
                with self.assertRaises(NativeFailure):
                    q.fresh_operator()

    def test_qualification_guardian_cleanup_attempts_independent_retires_and_fences(self):
        child, reader, native = Mock(), Mock(), Mock()
        child.poll.return_value = None
        child.terminate.side_effect = OSError("synthetic-stop-failure")
        child.wait.return_value = 91
        child.stdin.close.side_effect = OSError("synthetic-close-failure")
        child.stdout.closed = True
        child._handle.Detach.return_value = 123
        native.k.CloseHandle.return_value = False
        reader.is_alive.return_value = False
        entry = {"child": child, "reader": reader}
        with patch.dict(q._GUARDIANS, {id(entry): entry}, clear=True), \
                patch.dict(q._OPERATOR_PENDING, {}, clear=True):
            with self.assertRaises(NativeFailure):
                q.retire_guardian(entry, native)
            child.wait.assert_called_once()
            child.stdout.close.assert_called_once()
            native.k.CloseHandle.assert_called_once_with(123)
            self.assertIs(q._OPERATOR_PENDING[id(entry)], entry)
            self.assertEqual(entry["process_handle"], 123)
            with self.assertRaises(NativeFailure):
                q.fresh_operator()

    def test_crash_oracle_requires_live_before_and_exact_zero_after(self):
        self.assertTrue(q.strict_crash_shutdown(258, 0, 0))
        for values in ((0, 0, 0), (0, 0, 1), (258, 0, 1), (258, 0, 97), (258, 0, 259),
                       (258, 258, 0), (258, 0, False), (258, False, 0), (258.0, 0, 0)):
            with self.subTest(values=values):
                self.assertFalse(q.strict_crash_shutdown(*values))

    def test_active_zero_still_waits_for_exact_root_native_exit(self):
        native = Windows.__new__(Windows)
        native.k = Mock()
        native.k.WaitForSingleObject.side_effect = lambda handle, milliseconds: 0 if milliseconds == 1000 else 258
        def exit_code(handle, pointer):
            pointer._obj.value = p._FORCED_EXIT
            return True
        native.k.GetExitCodeProcess.side_effect = exit_code
        native.k.CloseHandle.return_value = True
        with self.assertRaises(NativeFailure):
            native.exit_code(123)  # Still not signalled on an immediate observation.
        owner = p._Owner(native)
        owner.process, owner.handles = 123, {"job": 5, "root": 123}
        owner.limits = Mock(return_value=Mock(peak_process=1, peak_job=1))
        owner.accounting = Mock(return_value={"total": 1, "active": 0, "terminated": 0})
        owner.events = Mock()
        result = owner.finish("timeout")
        self.assertTrue(result["cleanup_confirmed"])
        self.assertEqual(result["root_exit_code"], p._FORCED_EXIT)
        self.assertIsNone(result["failure_phase"])


if __name__ == "__main__":
    unittest.main()
