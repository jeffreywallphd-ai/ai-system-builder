"""Focused read-only observer tests; real cases create only inert owned children."""
from pathlib import Path
import contextlib
import ctypes
import importlib.util
import io
import json
import os
import queue
import subprocess
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "observe_windows_process_exit.py"
SPEC = importlib.util.spec_from_file_location("owned_process_observer_tests", SOURCE)
observer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(observer)


class FakeApi:
    def __init__(self):
        self.parents = {300: 200, 200: 100, 100: 50}
        self.births = {300: 30, 200: 20, 100: 10}
        self.opened = []
        self.closed = []
        self.waits = []
        self.dead = set()
        self.bad_close = set()
        self.bad_wait = set()

    def open(self, pid):
        if pid not in self.parents:
            raise ValueError("Unknown synthetic process")
        self.opened.append(pid)
        return pid

    def live(self, handle):
        return handle not in self.dead

    def information(self, handle, pid):
        return {"pid": pid, "parentPid": self.parents[pid], "birth": self.births[pid], "handle": handle}

    def wait(self, handle, duration):
        self.waits.append((handle, duration))
        if handle in self.bad_wait:
            return False
        self.dead.add(handle)
        return True

    def code(self, handle):
        return 0 if handle in self.dead else 259

    def close(self, handle):
        self.closed.append(handle)
        return handle not in self.bad_close


class ObserverLogicTests(unittest.TestCase):
    def run_fake(self, api, root=100, ready=None, timeout=30_000):
        with patch.object(observer.os, "name", "nt"), patch.object(observer, "_api", return_value=api):
            return observer.observe_with_root(300, root, ready or (lambda _value: None), timeout)

    def test_exact_two_hops_are_held_and_only_worker_and_launcher_are_retired(self):
        api = FakeApi()
        admissions = []
        result = self.run_fake(api, ready=admissions.append)
        self.assertEqual(admissions, [{"pid": 300, "rootPid": 100, "parentPid": 200, "chain": [300, 200, 100]}])
        self.assertEqual(result, {"pid": 300, "exitCode": 0, "rootPid": 100, "retired": [{"pid": 300, "exitCode": 0}, {"pid": 200, "exitCode": 0}]})
        self.assertEqual([pid for pid, _duration in api.waits], [300, 200])
        self.assertEqual(api.closed, [100, 200, 300])

    def test_root_itself_is_a_valid_owned_target(self):
        api = FakeApi()
        result = self.run_fake(api, root=300)
        self.assertEqual(api.opened, [300])
        self.assertEqual(result["retired"], [{"pid": 300, "exitCode": 0}])

    def test_wrong_root_never_opens_the_unrelated_claimed_process(self):
        api = FakeApi()
        admissions = []
        with self.assertRaises(ValueError):
            self.run_fake(api, root=999, ready=admissions.append)
        self.assertEqual(api.opened, [300, 200, 100])
        self.assertEqual(api.closed, [100, 200, 300])
        self.assertEqual(admissions, [])

    def test_cycle_later_birth_and_exited_process_deny_before_ready(self):
        for kind in ["cycle", "later-birth", "exited"]:
            api = FakeApi()
            if kind == "cycle":
                api.parents[200] = 300
            elif kind == "later-birth":
                api.births[200] = 31
            else:
                api.dead.add(200)
            admissions = []
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.run_fake(api, ready=admissions.append)
            self.assertEqual(admissions, [])
            self.assertEqual(api.closed, list(reversed(api.opened)))

    def test_liveness_is_rechecked_after_the_entire_chain_is_open(self):
        api = FakeApi()
        original = api.live
        def live(handle):
            return False if len(api.opened) == 3 and handle == 300 else original(handle)
        api.live = live
        with self.assertRaises(ValueError):
            self.run_fake(api)
        self.assertEqual(api.waits, [])
        self.assertEqual(api.closed, [100, 200, 300])

    def test_unknown_launcher_exit_does_not_produce_success(self):
        api = FakeApi()
        api.bad_wait.add(200)
        with self.assertRaises(ValueError):
            self.run_fake(api)
        self.assertEqual(api.closed, [100, 200, 300])

    def test_one_total_wait_budget_is_shared_across_the_chain(self):
        api = FakeApi()
        with patch.object(observer.time, "monotonic", side_effect=[0, 0.5, 0.75]):
            self.run_fake(api)
        self.assertEqual(api.waits, [(300, 29500), (200, 29250)])

    def test_callback_failure_still_releases_all_handles(self):
        api = FakeApi()
        def failed(_admission):
            raise RuntimeError("Synthetic callback failure")
        with self.assertRaises(RuntimeError):
            self.run_fake(api, ready=failed)
        self.assertEqual(api.closed, [100, 200, 300])

    def test_unknown_handle_close_denies_and_still_attempts_all_releases(self):
        api = FakeApi()
        api.bad_close.add(200)
        with self.assertRaises(ValueError):
            self.run_fake(api)
        self.assertEqual(api.closed, [100, 200, 300])

    def test_a_close_exception_does_not_skip_other_handles_or_hide_primary_failure(self):
        api = FakeApi()
        original = api.close
        def close(handle):
            original(handle)
            if handle == 200:
                raise RuntimeError("Synthetic close failure")
            return True
        api.close = close
        api.bad_wait.add(300)
        with self.assertRaisesRegex(ValueError, "exit was not observed"):
            self.run_fake(api)
        self.assertEqual(api.closed, [100, 200, 300])

    def test_pid_only_mode_keeps_zero_argument_callback_and_integer_result(self):
        api = FakeApi()
        ready = []
        with patch.object(observer.os, "name", "nt"), patch.object(observer, "_api", return_value=api):
            result = observer.observe(300, lambda: ready.append(True))
        self.assertEqual(result, 0)
        self.assertEqual(ready, [True])
        self.assertEqual(api.opened, [300])

    def test_invalid_explicit_roots_and_budgets_never_fall_back_or_open(self):
        for root in [None, True, 0, -1, 2**32, "100"]:
            with self.subTest(root=root), patch.object(observer, "_api") as api, self.assertRaises(ValueError):
                observer.observe_with_root(300, root, lambda _value: None)
            api.assert_not_called()

    def test_legacy_and_root_cli_frames_are_exact_and_distinct(self):
        for args, root in [(["300"], False), (["300", "--root-pid", "100"], True)]:
            api = FakeApi()
            with self.subTest(root=root), patch.object(observer.os, "name", "nt"), patch.object(observer, "_api", return_value=api), patch.object(sys, "argv", [str(SOURCE), *args]), contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(observer.main(), 0)
            frames = [json.loads(line) for line in out.getvalue().splitlines()]
            self.assertEqual(len(frames), 2)
            self.assertEqual([row["phase"] for row in frames], ["ready", "exited"])
            if root:
                self.assertEqual(frames[0]["chain"], [300, 200, 100])
                self.assertEqual(frames[1]["retired"], [{"pid": 300, "exitCode": 0}, {"pid": 200, "exitCode": 0}])
            else:
                self.assertEqual(frames, [{"phase": "ready", "pid": 300}, {"phase": "exited", "pid": 300, "exitCode": 0}])


class ObserverQualificationDeadlineTests(unittest.TestCase):
    # Existing controller execution windows plus retirement, or startup and
    # retirement. Keep these values independent of the implementation constant.
    WINDOWS = (630_000, 690_000, 930_000, 990_000, 1_200_000,
               1_230_000, 1_290_000, 2_430_000, 2_490_000)

    def test_declared_qualification_windows_keep_the_pid_only_contract(self):
        for timeout in self.WINDOWS:
            api = FakeApi()
            admissions = []
            with self.subTest(timeout=timeout), patch.object(observer.os, "name", "nt"), patch.object(observer, "_api", return_value=api) as factory:
                self.assertEqual(observer.observe(300, lambda: admissions.append(True), timeout), 0)
            factory.assert_called_once_with(False)
            self.assertEqual(admissions, [True])
            self.assertEqual(api.opened, [300])
            self.assertEqual(api.waits, [(300, timeout)])
            self.assertEqual(api.closed, [300])

    def test_arbitrary_long_or_invalid_windows_deny_before_probing(self):
        for timeout in [True, False, None, 0, -1, 30_001, 600_000,
                        690_001, 2_490_001, 2**32, 690_000.0, "690000"]:
            with self.subTest(timeout=timeout), patch.object(observer.os, "name", "nt"), patch.object(observer, "_api") as api, self.assertRaises(ValueError):
                observer.observe(300, lambda: self.fail("Invalid window admitted"), timeout)
            api.assert_not_called()

    def test_qualification_windows_never_extend_root_bound_shutdown(self):
        for timeout in self.WINDOWS:
            with self.subTest(timeout=timeout), patch.object(observer.os, "name", "nt"), patch.object(observer, "_api") as api, self.assertRaises(ValueError):
                observer.observe_with_root(300, 100, lambda _value: self.fail("Long root wait admitted"), timeout)
            api.assert_not_called()

    def test_cli_cannot_select_a_longer_wait_in_either_mode(self):
        for args in [["300", "--timeout-ms", "690000"],
                     ["300", "--root-pid", "100", "--timeout-ms", "690000"]]:
            with self.subTest(args=args), patch.object(sys, "argv", [str(SOURCE), *args]), patch.object(observer, "_api") as api, contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(observer.main(), 1)
                self.assertEqual(out.getvalue(), "")
            api.assert_not_called()

    def test_long_wait_never_invents_an_exit_or_admits_an_exited_process(self):
        for kind in ["unknown-exit", "already-exited", "callback-failed"]:
            api = FakeApi()
            admissions = []
            if kind == "unknown-exit":
                api.bad_wait.add(300)
            elif kind == "already-exited":
                api.dead.add(300)
            def ready():
                admissions.append(True)
                if kind == "callback-failed":
                    raise RuntimeError("Synthetic callback failure")
            error = RuntimeError if kind == "callback-failed" else ValueError
            message = {"unknown-exit": "exit was not observed", "already-exited": "not live", "callback-failed": "Synthetic callback failure"}[kind]
            with self.subTest(kind=kind), patch.object(observer.os, "name", "nt"), patch.object(observer, "_api", return_value=api), self.assertRaisesRegex(error, message):
                observer.observe(300, ready, 690_000)
            self.assertEqual(admissions, [] if kind == "already-exited" else [True])
            self.assertEqual(api.closed, [300])
            if kind != "unknown-exit":
                self.assertEqual(api.waits, [])


class NativeInformationBoundaryTests(unittest.TestCase):
    def api(self, variant="valid"):
        api = object.__new__(observer._WindowsApi)
        def query(_handle, info_class, buffer, size, returned):
            self.assertEqual(info_class, 0)
            self.assertEqual(size, ctypes.sizeof(observer._BasicInformation))
            info = ctypes.cast(buffer, ctypes.POINTER(observer._BasicInformation)).contents
            info.pid = 301 if variant == "wrong-native-pid" else 300
            info.parent_pid = 0 if variant == "missing-parent" else 200
            ctypes.cast(returned, ctypes.POINTER(ctypes.c_uint32)).contents.value = size - 1 if variant == "wrong-layout" else size
            return -1 if variant == "native-denied" else 0
        def times(_handle, birth, *_other):
            value = ctypes.cast(birth, ctypes.POINTER(observer._FileTime)).contents
            value.low = 0 if variant == "zero-birth" else 30
            value.high = 0
            return variant != "time-denied"
        api.nt = SimpleNamespace(NtQueryInformationProcess=query)
        api.kernel = SimpleNamespace(GetProcessId=lambda _handle: 301 if variant == "wrong-handle-pid" else 300, GetProcessTimes=times)
        return api

    def test_supported_layout_and_exact_native_fields(self):
        if ctypes.sizeof(ctypes.c_void_p) == 8:
            self.assertEqual(ctypes.sizeof(observer._BasicInformation), 48)
            self.assertEqual(observer._BasicInformation.pid.offset, 32)
            self.assertEqual(observer._BasicInformation.parent_pid.offset, 40)
        self.assertEqual(self.api().information(7, 300), {"pid": 300, "parentPid": 200, "birth": 30, "handle": 7})

    def test_unsupported_or_mismatched_native_observations_deny(self):
        for variant in ["wrong-native-pid", "wrong-handle-pid", "missing-parent", "wrong-layout", "native-denied", "zero-birth", "time-denied"]:
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                self.api(variant).information(7, 300)

    def test_read_only_access_mask_excludes_write_memory_terminate_and_privilege_rights(self):
        self.assertEqual(observer.PROCESS_ACCESS, 0x00101000)
        for timeout in [True, 0, -1, 30001, "10"]:
            with self.subTest(timeout=timeout), patch.object(observer, "_api") as api, self.assertRaises(ValueError):
                observer.observe_with_root(300, 100, lambda _value: None, timeout)
            api.assert_not_called()

    def test_cli_refuses_unknown_or_unbounded_input_without_a_probe(self):
        for args in [[], ["0"], ["-1"], ["1.0"], ["١"], ["9"*100], ["300", "--other", "100"], ["300", "--root-pid", "100", "extra"]]:
            with self.subTest(args=args), patch.object(sys, "argv", [str(SOURCE), *args]), patch.object(observer, "_api") as api, contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(observer.main(), 1)
                self.assertEqual(out.getvalue(), "")
            api.assert_not_called()


@unittest.skipUnless(os.name == "nt" and ctypes.sizeof(ctypes.c_void_p) == 8, "Focused Windows x64 inert process fixture")
class NativeInertObserverTests(unittest.TestCase):
    def exercise(self, executable):
        code = 'import os,json,sys;print(json.dumps({"pid":os.getpid(),"parentPid":os.getppid()}),flush=True);sys.stdin.read(1)'
        child = subprocess.Popen([executable, "-I", "-B", "-u", "-c", code], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        lines = queue.Queue()
        thread = threading.Thread(target=lambda: lines.put(child.stdout.readline(256)), daemon=True)
        thread.start()
        try:
            identity = json.loads(lines.get(timeout=10))
            frames = []
            def ready(admission):
                frames.append(admission)
                child.communicate("x", timeout=10)
            result = observer.observe_with_root(identity["pid"], os.getpid(), ready, 15_000)
            self.assertEqual(child.returncode, 0)
            self.assertEqual(len(frames), 1)
            self.assertEqual(frames[0]["parentPid"], identity["parentPid"])
            self.assertEqual(frames[0]["chain"][0], identity["pid"])
            self.assertEqual(frames[0]["chain"][-1], os.getpid())
            self.assertEqual([row["pid"] for row in result["retired"]], frames[0]["chain"][:-1])
            self.assertTrue(all(row["exitCode"] == 0 for row in result["retired"]))
            self.assertLessEqual(len(frames[0]["chain"]), 3)
        finally:
            if child.poll() is None:
                child.communicate("x", timeout=10)
            thread.join(timeout=1)
            self.assertFalse(thread.is_alive())

    def test_actual_current_interpreter_and_its_launcher_exit(self):
        self.exercise(sys.executable)

    def test_actual_base_interpreter_direct_child_exit(self):
        self.exercise(getattr(sys, "_base_executable", sys.executable))

    def test_actual_wrong_root_is_denied_without_stopping_the_inert_child(self):
        code = 'import os,json,sys;print(json.dumps({"pid":os.getpid()}),flush=True);sys.stdin.read(1)'
        child = subprocess.Popen([sys.executable, "-I", "-B", "-u", "-c", code], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        lines = queue.Queue()
        thread = threading.Thread(target=lambda: lines.put(child.stdout.readline(256)), daemon=True)
        thread.start()
        try:
            identity = json.loads(lines.get(timeout=10))
            admissions = []
            with self.assertRaises(ValueError):
                observer.observe_with_root(identity["pid"], 1, admissions.append, 1000)
            self.assertEqual(admissions, [])
            self.assertIsNone(child.poll())
        finally:
            if child.poll() is None:
                child.communicate("x", timeout=10)
            thread.join(timeout=1)
            self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
