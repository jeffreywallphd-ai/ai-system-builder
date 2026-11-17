"""Closed fixture admission and recovery tests; physical proof is opt-in."""
from __future__ import annotations

import copy
import ctypes as c
import io
import json
import os
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import qualification_job as job


class FakeNative:
    def __init__(self, changed=None):
        self.k = SimpleNamespace(**{name: MagicMock(return_value=1) for name in
            ("CreateJobObjectW", "SetInformationJobObject", "QueryInformationJobObject",
             "CloseHandle", "InitializeProcThreadAttributeList", "UpdateProcThreadAttribute",
             "DeleteProcThreadAttributeList", "CreateProcessW", "ResumeThread", "TerminateProcess")})
        self.k.CreateJobObjectW.return_value = 101
        self.flags = MagicMock(return_value=0)
        self.member = MagicMock(return_value=True)
        self.exited = MagicMock(return_value=1)
        self.changed = changed or {}
        def query(handle, kind, output, size, returned):
            value = c.cast(output, c.POINTER(job._Limits)).contents
            value.basic.flags = self.changed.get("flags", job.FLAGS)
            value.basic.active_limit = self.changed.get("count", 2)
            value.process_memory = self.changed.get("process", job.PROCESS_COMMIT)
            value.job_memory = self.changed.get("job", job.JOB_COMMIT)
            return 1
        def initialize(buffer, count, flags, size):
            c.cast(size, c.POINTER(c.c_size_t)).contents.value = 128
            return 0 if buffer is None else 1
        def create(*args):
            value = c.cast(args[-1], c.POINTER(job._Process)).contents
            value.process, value.thread, value.pid, value.tid = 201, 202, 123, 124
            return 1
        self.k.QueryInformationJobObject.side_effect = query
        self.k.InitializeProcThreadAttributeList.side_effect = initialize
        self.k.CreateProcessW.side_effect = create


def supervisor_fixture(exit_code=0, duplicate_failure=0, identity_failure=False, wrong_guardian=False):
    native = FakeNative()
    native.k.WaitForSingleObject = MagicMock(return_value=258)
    native.k.GetCurrentProcess = MagicMock(return_value=999)
    native.k.DuplicateHandle = MagicMock()
    rows = [{"handle": 10, "pid": 20, "creation_ticks": 30},
            {"handle": 11, "pid": 21, "creation_ticks": 31}]
    message = {"phase": "ready", "assignment": "job-list-at-creation", "flags": job.FLAGS,
               "suspended": False, "handles": rows}
    class Process:
        pid, _handle = 99, 501
        def __init__(self):
            self.returncode = None
            self.stdin, self.stderr = io.BytesIO(), io.BytesIO()
            self.stdout = io.BytesIO(json.dumps(message).encode() + b"\n")
        def communicate(self, data=None, timeout=None):
            self.returncode = 0
            return b'{"phase":"stopped","owned_exit_observed":true}\n', b""
        def poll(self):
            return self.returncode
        def kill(self):
            self.returncode = 1
        def wait(self, timeout=None):
            return self.returncode
    process = Process()
    def identity(handle):
        if handle == 501:
            return {"pid": 100 if wrong_guardian else 99, "creation_ticks": 777}
        if identity_failure and handle == 301:
            raise job.QualificationJobError("synthetic-local-identity-failure")
        index = {10: 0, 11: 1, 301: 0, 302: 1}[handle]
        return {key: rows[index][key] for key in ("pid", "creation_ticks")}
    def duplicate(source, handle, target, output, access, inherit, options):
        ordinal = native.k.DuplicateHandle.call_count
        if ordinal == duplicate_failure:
            return 0
        c.cast(output, c.POINTER(c.c_void_p)).contents.value = 300 + ordinal
        return 1
    native.identity = MagicMock(side_effect=identity)
    native.exited.return_value = exit_code
    native.k.DuplicateHandle.side_effect = duplicate
    return native, process


class QualificationJobTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"SystemRoot": "C:\\Windows"}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        error = patch.object(c, "get_last_error", return_value=122, create=True)
        error.start()
        self.addCleanup(error.stop)

    def test_unknown_cli_paths_pids_and_commands_have_no_native_effect(self):
        for args in ([], ["C:\\private"], ["123"], ["--self-test", "--command"], ["_leaf", "123"]):
            with self.subTest(args=args), patch.object(job, "_Win") as native, patch.object(job.subprocess, "Popen") as start, patch("sys.stderr", new_callable=io.StringIO) as error:
                self.assertEqual(job.main(args), 2)
                self.assertEqual(json.loads(error.getvalue())["phase"], "arguments")
                self.assertNotIn("private", error.getvalue())
                native.assert_not_called()
                start.assert_not_called()

    def test_unsupported_host_has_no_native_or_process_effect(self):
        with patch.object(job.sys, "platform", "linux"), patch.object(c, "WinDLL", create=True) as load, patch.object(job.subprocess, "Popen") as start:
            with self.assertRaisesRegex(job.QualificationJobError, "platform"):
                job.qualify()
            load.assert_not_called()
            start.assert_not_called()

    def test_environment_never_forwards_provider_or_python_settings(self):
        with patch.dict(os.environ, {"HF_TOKEN": "synthetic-only", "PYTHONPATH": "synthetic-only", "PATH": "synthetic-only"}):
            self.assertEqual(job._environment(), {"SystemRoot": "C:\\Windows", "WINDIR": "C:\\Windows"})
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(job.QualificationJobError):
            job._environment()

    def test_role_and_framing_are_bounded(self):
        for role in ("cmd.exe", "_leaf --extra", "_guardian", 123):
            with self.assertRaises(job.QualificationJobError):
                job._fixture_command(role)
        self.assertEqual(job._line(io.BytesIO(b"ok\n"), 1), b"ok\n")
        for raw in (b"", b"missing-newline", b"x" * (job.MAX_MESSAGE + 1) + b"\n"):
            with self.assertRaises(job.QualificationJobError):
                job._line(io.BytesIO(raw), 1)

    def test_ready_refuses_duplicate_fields_unknown_authority_and_wrong_identity(self):
        value = {"phase": "ready", "assignment": "job-list-at-creation", "flags": job.FLAGS,
                 "suspended": False, "handles": [{"handle": 10, "pid": 20, "creation_ticks": 30},
                                                  {"handle": 11, "pid": 21, "creation_ticks": 31}]}
        encode = lambda v: json.dumps(v).encode() + b"\n"
        self.assertEqual(job._ready(encode(value), False), value["handles"])
        bad = []
        for key, replacement in (("flags", job.FLAGS | 0x800), ("suspended", True), ("phase", "stopped")):
            bad.append({**value, key: replacement})
        bad += [{**value, "command": "synthetic"}, {**value, "handles": []}]
        for key, replacement in (("handle", True), ("pid", 2**32), ("creation_ticks", -1)):
            changed = copy.deepcopy(value)
            changed["handles"][0][key] = replacement
            bad.append(changed)
        duplicate = copy.deepcopy(value)
        duplicate["handles"][1] = duplicate["handles"][0]
        bad.append(duplicate)
        for candidate in bad:
            with self.subTest(candidate=candidate), self.assertRaises(job.QualificationJobError):
                job._ready(encode(candidate), False)
        for raw in (encode(value).replace(b'"flags":', b'"flags":0,"flags":', 1), b"null\n", b"x" * 4097, b"{}"):
            with self.assertRaises(job.QualificationJobError):
                job._ready(raw, False)

    def test_inheritable_job_denies_before_limits_or_creation(self):
        native = FakeNative()
        native.flags.return_value = 1
        with self.assertRaisesRegex(job.QualificationJobError, "inheritable-job"):
            job._FixtureJob(native)
        native.k.SetInformationJobObject.assert_not_called()
        native.k.CreateProcessW.assert_not_called()
        native.k.CloseHandle.assert_called_once_with(101)

    def test_unconfirmed_limits_deny_before_any_process_creation(self):
        for changed in ({"flags": job.FLAGS | 0x1000}, {"count": 3}, {"process": job.PROCESS_COMMIT + 1}, {"job": job.JOB_COMMIT + 1}):
            native = FakeNative(changed)
            with self.subTest(changed=changed), self.assertRaisesRegex(job.QualificationJobError, "limit-readback"):
                job._FixtureJob(native)
            native.k.CreateProcessW.assert_not_called()
            native.k.CloseHandle.assert_called_once_with(101)
        native = FakeNative()
        native.k.SetInformationJobObject.return_value = 0
        with self.assertRaisesRegex(job.QualificationJobError, "job-limits"):
            job._FixtureJob(native)
        native.k.CreateProcessW.assert_not_called()

    def test_atomic_attribute_denial_never_creates_or_resumes_a_worker(self):
        native = FakeNative()
        owned = job._FixtureJob(native)
        native.k.UpdateProcThreadAttribute.return_value = 0
        with self.assertRaisesRegex(job.QualificationJobError, "attribute-job-list"):
            owned.start(False)
        native.k.CreateProcessW.assert_not_called()
        native.k.ResumeThread.assert_not_called()
        native.k.DeleteProcThreadAttributeList.assert_called_once()
        owned.close()

    def test_creation_failure_never_grants_membership_or_resume(self):
        native = FakeNative()
        owned = job._FixtureJob(native)
        native.k.CreateProcessW.side_effect = None
        native.k.CreateProcessW.return_value = 0
        with self.assertRaisesRegex(job.QualificationJobError, "process-create"):
            owned.start(False)
        self.assertIsNone(owned.process)
        native.member.assert_not_called()
        native.k.ResumeThread.assert_not_called()
        owned.close()

    def test_membership_is_checked_while_the_exact_new_worker_is_suspended(self):
        native = FakeNative()
        owned = job._FixtureJob(native)
        native.member.return_value = False
        with self.assertRaisesRegex(job.QualificationJobError, "atomic-membership"):
            owned.start(False)
        native.k.ResumeThread.assert_not_called()
        self.assertEqual(owned.process.process, 201)
        owned.close()

    def test_unknown_exit_retains_the_handle_and_never_grants_cleanup_success(self):
        native = FakeNative()
        owned = job._FixtureJob(native)
        owned.start(True)
        native.exited.side_effect = job.QualificationJobError("synthetic-unconfirmed-exit")
        with self.assertRaisesRegex(job.QualificationJobError, "teardown-unconfirmed"):
            owned.close()
        self.assertEqual(owned.handles, [201])
        native.k.TerminateProcess.assert_called_once_with(201, 1)
        self.assertNotIn(((201,),), [(call.args,) for call in native.k.CloseHandle.call_args_list])

    def test_natural_or_error_exit_is_not_positive_job_shutdown_proof(self):
        for code in (2, 97, 98):
            native, process = supervisor_fixture(exit_code=code)
            with self.subTest(code=code), patch.object(job, "_Win", return_value=native), patch.object(job.subprocess, "Popen", return_value=process):
                with self.assertRaises(job.QualificationJobError):
                    job._run_case("normal-descendants")

    def test_later_duplicate_failure_retires_only_already_created_local_handles(self):
        native, process = supervisor_fixture(duplicate_failure=2)
        with patch.object(job, "_Win", return_value=native), patch.object(job.subprocess, "Popen", return_value=process):
            with self.assertRaises(job.QualificationJobError):
                job._run_case("normal-descendants")
        native.k.CloseHandle.assert_called_once_with(301)
        self.assertEqual(native.k.DuplicateHandle.call_args_list[0].args[:3], (501, 10, 999))
        self.assertEqual(native.k.DuplicateHandle.call_args_list[0].args[4:], (job.READ_PROCESS, False, 0))

    def test_local_identity_failure_still_retires_the_successful_duplicate(self):
        native, process = supervisor_fixture(identity_failure=True)
        with patch.object(job, "_Win", return_value=native), patch.object(job.subprocess, "Popen", return_value=process):
            with self.assertRaises(job.QualificationJobError):
                job._run_case("normal-descendants")
        native.k.CloseHandle.assert_called_once_with(301)

    def test_wrong_retained_guardian_identity_denies_before_duplication(self):
        native, process = supervisor_fixture(wrong_guardian=True)
        with patch.object(job, "_Win", return_value=native), patch.object(job.subprocess, "Popen", return_value=process):
            with self.assertRaises(job.QualificationJobError):
                job._run_case("normal-descendants")
        native.k.DuplicateHandle.assert_not_called()
        native.k.CloseHandle.assert_not_called()

    def test_failed_thread_close_stays_owned_until_successful_retry(self):
        native = FakeNative()
        owned = job._FixtureJob(native)
        owned.start(True)
        native.k.CloseHandle.side_effect = lambda handle: 0 if handle == 202 else 1
        with self.assertRaisesRegex(job.QualificationJobError, "teardown-unconfirmed"):
            owned.close()
        self.assertEqual(owned.process.thread, 202)
        native.k.CloseHandle.side_effect = None
        owned.close()
        self.assertIsNone(owned.process.thread)

    def test_positive_shutdown_oracle_requires_exact_count_and_integer_zero(self):
        self.assertTrue(job._shutdown_codes([0, 0], 2))
        self.assertTrue(job._shutdown_codes([0], 1))
        for codes, count in (([], 1), ([0], 2), ([0, 0], 1), ([False], 1), ([0.0], 1), ([2], 1), ([97], 1), ([259], 1), ((0,), 1), ([0], True)):
            with self.subTest(codes=codes, count=count):
                self.assertFalse(job._shutdown_codes(codes, count))

    def test_bad_frame_cannot_create_or_retire_a_local_handle(self):
        native, process = supervisor_fixture()
        process.stdout = io.BytesIO(b'{"phase":"untrusted","handles":[10,11]}\n')
        with patch.object(job, "_Win", return_value=native), patch.object(job.subprocess, "Popen", return_value=process):
            with self.assertRaises(job.QualificationJobError):
                job._run_case("normal-descendants")
        native.k.DuplicateHandle.assert_not_called()
        native.k.CloseHandle.assert_not_called()


@unittest.skipUnless(sys.platform == "win32" and os.environ.get("AISB_RUN_OWNED_JOB_NATIVE") == "1",
                     "Actual Windows owned-job qualification requires its explicit opt-in.")
class NativeQualificationJobTests(unittest.TestCase):
    def test_actual_owned_descendants_and_guardian_failure(self):
        result = job.qualify()
        self.assertEqual([case["case"] for case in result["cases"]], list(job.CASES))
        self.assertTrue(all(case["passed"] for case in result["cases"]))
        self.assertTrue(result["expiry_negative_control"]["rejected_as_shutdown"])
        self.assertEqual(result["expiry_negative_control"]["observed_natural_exit_code"], job.FALLBACK_EXIT)
        self.assertFalse(result["real_restart_admitted"])
        self.assertFalse(result["parent_qualification_complete"])
        print("OWNED_JOB_OBSERVATION " + json.dumps(result), flush=True)


if __name__ == "__main__":
    unittest.main()
