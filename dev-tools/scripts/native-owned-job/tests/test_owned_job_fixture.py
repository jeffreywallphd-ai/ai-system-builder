"""Model-free native evidence. Only exact newly owned fixtures are terminated."""
import ctypes
import importlib.util
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / "owned_job_fixture.py"
spec = importlib.util.spec_from_file_location("owned_job_fixture", SCRIPT)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class PolicyTests(unittest.TestCase):
    def test_unsupported_host_denies_before_any_native_api_or_process(self):
        with patch.object(fixture, "supported", return_value=False), patch.object(fixture.subprocess, "Popen") as launch:
            with self.assertRaises(fixture.FixtureUnavailable): fixture.OwnedFixture()
        launch.assert_not_called()

    def test_unknown_arguments_cannot_select_a_command_path_or_limits(self):
        for args in [[], ["--guardian", "other.py"], ["--command", "anything"], ["--limit", "1"]]:
            with patch.object(sys, "argv", [str(SCRIPT), *args]), patch.object(fixture, "guardian") as start:
                with self.assertRaises(fixture.FixtureUnavailable): fixture.main()
            start.assert_not_called()

    def test_profile_is_small_fixed_and_independent_of_staging(self):
        self.assertEqual(fixture.COMMIT_LIMIT, 256 * 1024**2)
        self.assertEqual(fixture.JOB_LIST_ATTRIBUTE, 0x2000D)
        self.assertEqual(fixture.LIMIT_FLAGS, 0x2308)
        self.assertEqual(fixture.CHILD_SECONDS, 20)
        self.assertFalse(hasattr(fixture, "acquire_staging"))
        self.assertFalse(hasattr(fixture, "admit_model"))

    def test_native_setup_failure_never_starts_a_child_or_falls_back(self):
        for stage in ("job", "limits"):
            api = Mock()
            api.CreateJobObjectW.return_value = None if stage == "job" else 123
            api.GetHandleInformation.return_value = 1
            api.SetInformationJobObject.return_value = 0
            api.CloseHandle.return_value = 1
            with patch.object(fixture, "kernel_api", return_value=api):
                with self.assertRaises(fixture.FixtureUnavailable): fixture.OwnedFixture()
            api.CreateProcessW.assert_not_called()
            api.ResumeThread.assert_not_called()
            api.InitializeProcThreadAttributeList.assert_not_called()
            if stage == "limits": api.CloseHandle.assert_called_once_with(123)

    def test_an_uncertain_handle_close_is_never_retried_or_called_successful(self):
        owner = fixture.OwnedFixture.__new__(fixture.OwnedFixture)
        owner.api = Mock(); owner.api.CloseHandle.return_value = 0
        owner.job, owner.process, owner.thread = 123, None, None
        with self.assertRaises(fixture.FixtureUnavailable): owner.close()
        self.assertIsNone(owner.job)
        owner.close()
        owner.api.CloseHandle.assert_called_once_with(123)

    def test_natural_fallback_and_unexpected_exits_cannot_qualify(self):
        with patch.object(sys, "argv", [str(SCRIPT), "--fixed-waiter"]), patch.object(fixture, "supported", return_value=True), patch.object(fixture.time, "sleep") as sleep:
            self.assertEqual(fixture.main(), fixture.FALLBACK_EXIT_CODE)
        sleep.assert_called_once_with(fixture.CHILD_SECONDS)
        for code in (fixture.FALLBACK_EXIT_CODE, fixture.STILL_ACTIVE, 1, 74, False, None):
            with self.subTest(code=code), self.assertRaises(fixture.FixtureUnavailable):
                fixture.qualify_job_shutdown(code)
        fixture.qualify_job_shutdown(0)


@unittest.skipUnless(fixture.supported(), "Declared Windows x64 CPython 3.12 fixture")
class ActualWindowsTests(unittest.TestCase):
    def observe(self, trigger):
        api = fixture.kernel_api()
        guardian = subprocess.Popen([sys.executable, "-I", "-S", "-B", str(SCRIPT), "--guardian"],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW)
        messages = queue.Queue(maxsize=4)
        def reader():
            try:
                while line := guardian.stdout.readline(2049):
                    if len(line) > 2048:
                        messages.put_nowait(ValueError("Oversized fixture protocol")); return
                    messages.put_nowait(json.loads(line))
            except BaseException as error:
                try: messages.put_nowait(error)
                except queue.Full: pass
        reading = threading.Thread(target=reader, daemon=True); reading.start()
        child = query_job = None
        def take():
            value = messages.get(timeout=10)
            if isinstance(value, BaseException): raise value
            return value
        try:
            ready = take(); self.assertEqual(ready["stage"], "suspended")
            self.assertEqual(set(ready), {"stage", "pid", "created", "job", "facts"})
            self.assertEqual(ready["facts"]["process_commit_limit_bytes"], fixture.COMMIT_LIMIT)
            self.assertTrue(ready["facts"]["exact_member"])
            child = api.OpenProcess(0x100000 | 0x1000, False, ready["pid"])
            self.assertTrue(child)
            self.assertEqual(fixture.creation_identity(api, child), ready["created"])
            duplicate = ctypes.c_void_p()
            self.assertTrue(api.DuplicateHandle(int(guardian._handle), ready["job"], api.GetCurrentProcess(),
                                               ctypes.byref(duplicate), 0x4, False, 0))
            query_job = duplicate.value
            checked = fixture.readback(api, query_job, child, ready["pid"])
            self.assertEqual(checked, ready["facts"])
            # This query reference would keep the job alive; never retain it
            # across the crash/closure whose kill-on-last-close we are testing.
            if trigger != "held-job-control":
                temporary = query_job; query_job = None
                self.assertTrue(api.CloseHandle(temporary))
            if trigger == "bad-ack":
                guardian.stdin.write("BAD\n"); guardian.stdin.flush()
                self.assertEqual(api.WaitForSingleObject(child, fixture.WAIT_MILLISECONDS), 0)
                self.assertEqual(take(), {"status": "fixture-unavailable"})
                self.assertEqual(guardian.wait(timeout=5), 3)
                self.assertEqual(guardian.stderr.read(2049), "")
                return
            guardian.stdin.write("ACK\n"); guardian.stdin.flush()
            self.assertEqual(take(), {"stage": "running"})
            self.assertEqual(api.WaitForSingleObject(child, 0), 258)
            self.assertEqual(fixture.exit_code(api, child), fixture.STILL_ACTIVE)
            if trigger == "self-expiry-control":
                self.assertEqual(api.WaitForSingleObject(child, 25000), 0)
                self.assertEqual(fixture.exit_code(api, child), fixture.FALLBACK_EXIT_CODE)
                with self.assertRaises(fixture.FixtureUnavailable):
                    fixture.qualify_job_shutdown(fixture.exit_code(api, child))
                guardian.stdin.write("CLOSE\n"); guardian.stdin.flush()
                self.assertEqual(take(), {"status": "fixture-unavailable"})
                self.assertEqual(guardian.wait(timeout=5), 3)
                self.assertEqual(guardian.stderr.read(2049), "")
                return
            started = time.monotonic()
            if trigger == "close":
                guardian.stdin.write("CLOSE\n"); guardian.stdin.flush()
            elif trigger == "eof":
                guardian.stdin.close()
            elif trigger in {"crash", "held-job-control"}:
                # Popen retains the exact newly owned supervisor handle.
                guardian.kill()
            else:
                self.fail("Unsupported fixed trigger")
            if trigger == "held-job-control":
                # Deliberate negative control: an extra job reference prevents
                # last-close termination. It is not qualifying crash evidence.
                self.assertEqual(api.WaitForSingleObject(child, 250), 258)
                self.assertEqual(fixture.exit_code(api, child), fixture.STILL_ACTIVE)
                temporary = query_job; query_job = None
                self.assertTrue(api.CloseHandle(temporary))
            self.assertEqual(api.WaitForSingleObject(child, fixture.WAIT_MILLISECONDS), 0)
            self.assertNotEqual(fixture.exit_code(api, child), fixture.STILL_ACTIVE)
            fixture.qualify_job_shutdown(fixture.exit_code(api, child))
            self.assertLess(time.monotonic() - started, fixture.CHILD_SECONDS)
            self.assertEqual(fixture.creation_identity(api, child), ready["created"])
            if trigger not in {"crash", "held-job-control"}:
                finished = take(); self.assertEqual(finished["stage"], "exited")
                self.assertTrue(finished["observed"])
                self.assertEqual(finished["exit_code"], fixture.exit_code(api, child))
                self.assertEqual(guardian.wait(timeout=5), 0)
            else:
                self.assertIsNotNone(guardian.wait(timeout=5))
            self.assertEqual(guardian.stderr.read(2049), "")
        finally:
            if query_job:
                self.assertTrue(api.CloseHandle(query_job))
            if guardian.poll() is None:
                guardian.kill(); guardian.wait(timeout=5)
            if child:
                # Even failure cleanup requires observed exact owned exit.
                self.assertEqual(api.WaitForSingleObject(child, 25000), 0)
                self.assertTrue(api.CloseHandle(child))
            if not guardian.stdin.closed: guardian.stdin.close()
            reading.join(timeout=2); self.assertFalse(reading.is_alive())
            guardian.stdout.close(); guardian.stderr.close()

    def test_orderly_guardian_close_observes_exact_child_exit(self): self.observe("close")

    def test_guardian_input_loss_observes_exact_child_exit(self): self.observe("eof")

    def test_abrupt_guardian_termination_observes_exact_child_exit(self): self.observe("crash")

    def test_invalid_ack_closes_the_suspended_child_without_running_it(self): self.observe("bad-ack")

    def test_extra_job_reference_is_a_sensitive_negative_control(self): self.observe("held-job-control")

    def test_actual_self_expiry_is_observed_but_never_qualifies(self): self.observe("self-expiry-control")


if __name__ == "__main__": unittest.main()
