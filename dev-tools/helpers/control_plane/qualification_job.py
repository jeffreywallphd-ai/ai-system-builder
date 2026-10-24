"""Closed, model-free Windows job qualification. Never a real offload lease.

Only this file's fixed fixtures can be started. No command, PID, directory,
retained-slot, quota override or existing-process adoption API is provided.
"""
from __future__ import annotations

import ctypes as c
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time

FLAGS = 0x2000 | 0x100 | 0x200 | 0x8  # kill-on-close, process/job commit, count
PROCESS_COMMIT = 256 * 1024**2
JOB_COMMIT = 512 * 1024**2
READ_PROCESS = 0x100000 | 0x1000  # synchronize and limited query; no mutation
JOB_LIST_ATTRIBUTE = 0x2000D
CASES = ("normal-descendants", "guardian-crash", "guardian-crash-before-resume")
MAX_MESSAGE = 4096
FALLBACK_EXIT = 97  # Natural fixture expiry must never look like job shutdown.


class QualificationJobError(RuntimeError):
    def __init__(self, phase):
        self.phase = phase
        super().__init__("Owned fixture qualification is unavailable: " + phase)


def _require(value, phase):
    if not value:
        raise QualificationJobError(phase)


class _Basic(c.Structure):
    _fields_ = [("process_time", c.c_int64), ("job_time", c.c_int64),
                ("flags", c.c_uint32), ("minimum_ws", c.c_size_t),
                ("maximum_ws", c.c_size_t), ("active_limit", c.c_uint32),
                ("affinity", c.c_size_t), ("priority", c.c_uint32),
                ("scheduling", c.c_uint32)]


class _Io(c.Structure):
    _fields_ = [(name, c.c_uint64) for name in
                ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]


class _Limits(c.Structure):
    _fields_ = [("basic", _Basic), ("io", _Io), ("process_memory", c.c_size_t),
                ("job_memory", c.c_size_t), ("peak_process", c.c_size_t), ("peak_job", c.c_size_t)]


class _Startup(c.Structure):
    _fields_ = [("cb", c.c_uint32), ("reserved", c.c_wchar_p),
                ("desktop", c.c_wchar_p), ("title", c.c_wchar_p),
                *[(name, c.c_uint32) for name in ("x", "y", "width", "height", "chars_x", "chars_y", "fill", "flags")],
                ("show", c.c_uint16), ("reserved_size", c.c_uint16),
                ("reserved_bytes", c.c_void_p), ("stdin", c.c_void_p),
                ("stdout", c.c_void_p), ("stderr", c.c_void_p)]


class _StartupEx(c.Structure):
    _fields_ = [("startup", _Startup), ("attributes", c.c_void_p)]


class _Process(c.Structure):
    _fields_ = [("process", c.c_void_p), ("thread", c.c_void_p),
                ("pid", c.c_uint32), ("tid", c.c_uint32)]


class _Members(c.Structure):
    _fields_ = [("assigned", c.c_uint32), ("count", c.c_uint32),
                ("pids", c.c_size_t * 2)]


class _FileTime(c.Structure):
    _fields_ = [("low", c.c_uint32), ("high", c.c_uint32)]


class _Win:
    def __init__(self):
        _require(sys.platform == "win32" and c.sizeof(c.c_void_p) == 8, "platform")
        self.k = c.WinDLL("kernel32", use_last_error=True)
        ptr, word, boolean = c.c_void_p, c.c_uint32, c.c_int
        signatures = {
            "CreateJobObjectW": ([ptr, c.c_wchar_p], ptr),
            "SetInformationJobObject": ([ptr, c.c_int, ptr, word], boolean),
            "QueryInformationJobObject": ([ptr, c.c_int, ptr, word, ptr], boolean),
            "GetHandleInformation": ([ptr, c.POINTER(word)], boolean),
            "CloseHandle": ([ptr], boolean),
            "InitializeProcThreadAttributeList": ([ptr, word, word, c.POINTER(c.c_size_t)], boolean),
            "UpdateProcThreadAttribute": ([ptr, word, c.c_size_t, ptr, c.c_size_t, ptr, ptr], boolean),
            "DeleteProcThreadAttributeList": ([ptr], None),
            "CreateProcessW": ([c.c_wchar_p, c.c_wchar_p, ptr, ptr, boolean, word, ptr,
                                c.c_wchar_p, c.POINTER(_StartupEx), c.POINTER(_Process)], boolean),
            "IsProcessInJob": ([ptr, ptr, c.POINTER(boolean)], boolean),
            "ResumeThread": ([ptr], word),
            "OpenProcess": ([word, boolean, word], ptr),
            "GetCurrentProcess": ([], ptr),
            "GetProcessId": ([ptr], word),
            "GetProcessTimes": ([ptr, *[c.POINTER(_FileTime)] * 4], boolean),
            "GetExitCodeProcess": ([ptr, c.POINTER(word)], boolean),
            "WaitForSingleObject": ([ptr, word], word),
            "DuplicateHandle": ([ptr, ptr, ptr, c.POINTER(ptr), word, boolean, word], boolean),
            "TerminateProcess": ([ptr, word], boolean),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.k, name)
            function.argtypes, function.restype = arguments, result
        _require(c.sizeof(_Limits) == 144 and c.sizeof(_StartupEx) == 112
                 and c.sizeof(_Process) == 24 and c.sizeof(_Members) == 24, "abi")

    def flags(self, handle):
        value = c.c_uint32()
        _require(self.k.GetHandleInformation(handle, c.byref(value)), "handle-readback")
        return value.value

    def identity(self, handle):
        pid = self.k.GetProcessId(handle)
        times = [_FileTime() for _ in range(4)]
        _require(pid and self.k.GetProcessTimes(handle, *[c.byref(t) for t in times]), "process-identity")
        return {"pid": pid, "creation_ticks": times[0].low | times[0].high << 32}

    def member(self, process, job):
        value = c.c_int()
        _require(self.k.IsProcessInJob(process, job, c.byref(value)), "membership-readback")
        return bool(value.value)

    def exited(self, handle, milliseconds):
        code = c.c_uint32()
        _require(self.k.WaitForSingleObject(handle, milliseconds) == 0
                 and self.k.GetExitCodeProcess(handle, c.byref(code)) and code.value != 259,
                 "owned-exit-unconfirmed")
        return code.value


def _environment():
    # No model/provider settings, credentials, Python path, user site or cache.
    root = os.environ.get("SystemRoot", "")
    _require(root and "\0" not in root and len(root) <= 1024, "environment")
    return {"SystemRoot": root, "WINDIR": root}


def _fixture_command(role):
    _require(type(role) is str and role in ("_worker", "_leaf", "_expiry", "_guardian-suspended", "_guardian-descendants"), "fixture-role")
    return [sys.executable, "-I", "-S", "-B", str(Path(__file__).resolve()), role]


def _line(stream, seconds, limit=MAX_MESSAGE):
    channel = queue.Queue(maxsize=1)
    def read():
        try:
            channel.put(stream.readline(limit + 1))
        except (OSError, ValueError):
            channel.put(None)
    thread = threading.Thread(target=read, daemon=True)
    thread.start()
    try:
        result = channel.get(timeout=seconds)
    except queue.Empty:
        raise QualificationJobError("protocol-timeout") from None
    _require(type(result) is bytes and 0 < len(result) <= limit and result.endswith(b"\n"), "protocol-size")
    return result


class _FixtureJob:
    def __init__(self, native):
        self.n = native
        self.job, self.process, self.handles = None, None, []
        job = native.k.CreateJobObjectW(None, None)
        _require(job, "job-create")
        self.job = job
        try:
            _require(native.flags(job) & 1 == 0, "inheritable-job")
            limits = _Limits()
            limits.basic.flags, limits.basic.active_limit = FLAGS, 2
            limits.process_memory, limits.job_memory = PROCESS_COMMIT, JOB_COMMIT
            _require(native.k.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)), "job-limits")
            observed = self.limits()
            _require(observed.basic.flags == FLAGS and observed.basic.active_limit == 2
                     and observed.process_memory == PROCESS_COMMIT and observed.job_memory == JOB_COMMIT,
                     "limit-readback")
        except BaseException:
            # No fixture exists at this admission boundary.
            native.k.CloseHandle(job)
            self.job = None
            raise

    def limits(self):
        value = _Limits()
        _require(self.n.k.QueryInformationJobObject(self.job, 9, c.byref(value), c.sizeof(value), None), "limit-query")
        return value

    def start(self, suspended, *, expiry=False):
        _require(type(suspended) is bool and type(expiry) is bool, "fixture-mode")
        k = self.n.k
        size = c.c_size_t()
        initialized = k.InitializeProcThreadAttributeList(None, 1, 0, c.byref(size))
        _require(not initialized and c.get_last_error() == 122 and 0 < size.value <= 65536, "attribute-size")
        attributes = c.create_string_buffer(size.value)
        _require(k.InitializeProcThreadAttributeList(attributes, 1, 0, c.byref(size)), "attribute-init")
        try:
            jobs = (c.c_void_p * 1)(self.job)
            _require(k.UpdateProcThreadAttribute(attributes, 0, JOB_LIST_ATTRIBUTE,
                                                c.byref(jobs), c.sizeof(jobs), None, None), "attribute-job-list")
            startup = _StartupEx()
            startup.startup.cb = c.sizeof(startup)
            startup.attributes = c.cast(attributes, c.c_void_p)
            environment = c.create_unicode_buffer("\0".join(f"{key}={value}" for key, value in sorted(_environment().items())) + "\0")
            command = c.create_unicode_buffer(subprocess.list2cmdline(_fixture_command("_expiry" if expiry else "_worker")))
            process = _Process()
            # Job assignment is inside creation, not a later AssignProcessToJobObject.
            _require(k.CreateProcessW(sys.executable, command, None, None, False,
                                      0x80000 | 0x4 | 0x400 | 0x8000000,
                                      environment, str(Path(__file__).resolve().parent),
                                      c.byref(startup), c.byref(process)), "process-create")
            self.process = process
            self.handles.append(process.process)
            _require(self.n.member(process.process, self.job), "atomic-membership")
            if not suspended:
                _require(k.ResumeThread(process.thread) == 1, "resume")
                _require(k.CloseHandle(process.thread), "thread-close")
                process.thread = None
        finally:
            k.DeleteProcThreadAttributeList(attributes)

    def observe_members(self, count):
        deadline = time.monotonic() + 10
        while True:
            members = _Members()
            _require(self.n.k.QueryInformationJobObject(self.job, 3, c.byref(members), c.sizeof(members), None), "members-query")
            _require(members.assigned == members.count and 0 < members.count <= 2, "member-count")
            pids = tuple(members.pids[:members.count])
            _require(len(set(pids)) == len(pids) and self.process.pid in pids, "member-identity")
            if len(pids) == count:
                break
            _require(time.monotonic() < deadline, "descendant-timeout")
            time.sleep(0.02)
        for pid in pids:
            if pid == self.process.pid:
                continue
            handle = self.n.k.OpenProcess(READ_PROCESS, False, pid)
            _require(handle, "member-open")
            self.handles.append(handle)
            _require(self.n.member(handle, self.job), "descendant-membership")
        _require(len(self.handles) == count, "observation-count")

    def describe_members(self):
        # No remote allocation or parent PID lookup. These source handles remain
        # owned here until the supervisor's stop/EOF or the guardian's exit.
        result = []
        for handle in self.handles:
            _require(self.n.k.WaitForSingleObject(handle, 0) == 258
                     and self.n.member(handle, self.job), "member-not-live")
            result.append({"handle": handle, **self.n.identity(handle)})
        return result

    def close(self):
        failures = []
        if self.job:
            if self.n.k.CloseHandle(self.job):
                self.job = None
            else:
                failures.append("job-close")
        retained = []
        for handle in self.handles:
            confirmed = False
            try:
                self.n.exited(handle, 5000)
                confirmed = True
            except QualificationJobError:
                # Only the exact process handle returned by this CreateProcess may
                # be terminated on failed cleanup. No PID or adopted member action.
                if self.process and handle == self.process.process:
                    if self.n.k.TerminateProcess(handle, 1):
                        try:
                            self.n.exited(handle, 5000)
                            confirmed = True
                        except QualificationJobError:
                            pass
                failures.append("owned-exit")
            if not confirmed or not self.n.k.CloseHandle(handle):
                retained.append(handle)
                failures.append("process-close")
        self.handles = retained
        if self.process and self.process.thread:
            if not self.n.k.CloseHandle(self.process.thread):
                failures.append("thread-close")
            else:
                self.process.thread = None
        _require(not failures, "teardown-unconfirmed")


def _guardian(suspended):
    job = _FixtureJob(_Win())
    try:
        job.start(suspended)
        job.observe_members(1 if suspended else 2)
        handles = job.describe_members()
        print(json.dumps({"phase": "ready", "assignment": "job-list-at-creation",
                          "flags": FLAGS, "suspended": suspended, "handles": handles}), flush=True)
        _require(_line(sys.stdin.buffer, 15, 8) == b"stop\n", "stop-protocol")
        job.close()
        print(json.dumps({"phase": "stopped", "owned_exit_observed": True}), flush=True)
        return 0
    finally:
        job.close()


def _ready(raw, suspended):
    _require(type(raw) is bytes and 0 < len(raw) <= MAX_MESSAGE and raw.endswith(b"\n"), "ready-size")
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate")
            value[key] = item
        return value
    try:
        value = json.loads(raw, object_pairs_hook=unique)
    except (ValueError, UnicodeError):
        raise QualificationJobError("ready-json") from None
    _require(type(value) is dict and set(value) == {"phase", "assignment", "flags", "suspended", "handles"}
             and value["phase"] == "ready" and value["assignment"] == "job-list-at-creation"
             and type(value["flags"]) is int and value["flags"] == FLAGS
             and value["suspended"] is suspended, "ready-header")
    handles = value["handles"]
    _require(type(handles) is list and len(handles) == (1 if suspended else 2), "ready-count")
    for row in handles:
        _require(type(row) is dict and set(row) == {"handle", "pid", "creation_ticks"}, "ready-fields")
        _require(all(type(row[key]) is int and 0 < row[key] <= maximum for key, maximum in
                     (("handle", 2**64 - 1), ("pid", 2**32 - 1), ("creation_ticks", 2**64 - 1))), "ready-identity")
    _require(len({row["handle"] for row in handles}) == len(handles)
             and len({row["pid"] for row in handles}) == len(handles), "ready-duplicate")
    return handles


def _run_case(case):
    _require(type(case) is str and case in CASES, "case")
    native = _Win()
    suspended = case == "guardian-crash-before-resume"
    process = subprocess.Popen(_fixture_command("_guardian-suspended" if suspended else "_guardian-descendants"),
                               env=_environment(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW,
                               close_fds=True)
    handles = []  # Only successfully created LOCAL duplicates; never wire values.
    try:
        descriptions = _ready(_line(process.stdout, 15), suspended)
        # CPython's Windows Popen retains the handle returned by its CreateProcess.
        # Hold that exact source object throughout handoff; never reopen its PID.
        try:
            guardian_handle = int(process._handle)
        except (AttributeError, TypeError, ValueError, OverflowError):
            raise QualificationJobError("guardian-handle") from None
        _require(0 < guardian_handle < 2**64, "guardian-handle")
        guardian_identity = native.identity(guardian_handle)
        _require(guardian_identity["pid"] == process.pid and guardian_identity["creation_ticks"] > 0
                 and native.k.WaitForSingleObject(guardian_handle, 0) == 258, "guardian-identity")
        for row in descriptions:
            _require(native.identity(guardian_handle) == guardian_identity
                     and native.k.WaitForSingleObject(guardian_handle, 0) == 258, "guardian-identity")
            copied = c.c_void_p()
            _require(native.k.DuplicateHandle(guardian_handle, row["handle"], native.k.GetCurrentProcess(),
                                             c.byref(copied), READ_PROCESS, False, 0) and copied.value,
                     "local-handle-duplicate")
            handle = copied.value
            handles.append(handle)  # Own it before any later query/duplicate fails.
            _require(native.identity(handle) == {key: row[key] for key in ("pid", "creation_ticks")}
                     and native.flags(handle) & 1 == 0
                     and native.k.WaitForSingleObject(handle, 0) == 258, "supervisor-identity")
        if case == "normal-descendants":
            output, error = process.communicate(b"stop\n", timeout=10)
            _require(process.returncode == 0 and not error and len(output) <= MAX_MESSAGE
                     and json.loads(output) == {"phase": "stopped", "owned_exit_observed": True}, "normal-shutdown")
        else:
            # Popen retains the exact newly created guardian; no caller PID action.
            process.kill()
            output, error = process.communicate(timeout=10)
            _require(process.returncode != 0 and not output and not error, "forced-guardian-exit")
        codes = [native.exited(handle, 5000) for handle in handles]
        _require(_shutdown_codes(codes, 1 if suspended else 2), "non-shutdown-exit")
        return {"case": case, "passed": True, "assigned_at_creation": True,
                "membership_checked_before_resume": True, "suspended_at_guardian_exit": suspended,
                "observed_members": len(handles), "native_exit_codes": codes,
                "guardian_exit_code": process.returncode, "job_handle_inherited": False}
    finally:
        try:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)
        finally:
            closed = True
            for handle in handles:
                if not native.k.CloseHandle(handle):
                    closed = False
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream:
                    stream.close()
            _require(closed, "supervisor-handle-close")


def _shutdown_codes(codes, expected):
    return (type(codes) is list and type(expected) is int and expected in (1, 2)
            and len(codes) == expected and all(type(code) is int and code == 0 for code in codes))


def _expiry_negative_control():
    native = _Win()
    owned = _FixtureJob(native)
    try:
        owned.start(False, expiry=True)
        identity = native.identity(owned.process.process)
        code = native.exited(owned.process.process, 5000)
        _require(native.identity(owned.process.process) == identity and code == FALLBACK_EXIT
                 and not _shutdown_codes([code], 1), "expiry-control-insensitive")
        return {"observed_natural_exit_code": code, "rejected_as_shutdown": True,
                "same_native_handle_observed": True, "passed": True}
    finally:
        owned.close()


def qualify():
    _require(sys.platform == "win32" and c.sizeof(c.c_void_p) == 8, "platform")
    return {"schema_version": "owned-qualification-job-observation-v1",
            "status": "evidence-collected-review-required", "python": list(sys.version_info[:3]),
            "cases": [_run_case(case) for case in CASES], "maximum_fixture_processes": 2,
            "expiry_negative_control": _expiry_negative_control(),
            "fixture_process_commit_limit_bytes": PROCESS_COMMIT, "fixture_job_commit_limit_bytes": JOB_COMMIT,
            "retained_staging_accessed": False, "model_or_provider_used": False,
            "real_restart_admitted": False, "parent_qualification_complete": False}


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        _require(len(args) == 1 and args[0] in ("--self-test", "_guardian-suspended", "_guardian-descendants", "_worker", "_leaf", "_expiry"), "arguments")
        _require(sys.platform == "win32" and c.sizeof(c.c_void_p) == 8, "platform")
        if args == ["--self-test"]:
            print(json.dumps(qualify()))
            return 0
        if args in (["_guardian-suspended"], ["_guardian-descendants"]):
            return _guardian(args == ["_guardian-suspended"])
        if args == ["_worker"]:
            child = subprocess.Popen(_fixture_command("_leaf"), env=_environment(),
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, close_fds=True,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
            child.wait(timeout=30)
            return FALLBACK_EXIT
        if args == ["_leaf"]:
            time.sleep(30)
            return FALLBACK_EXIT
        if args == ["_expiry"]:
            time.sleep(0.1)
            return FALLBACK_EXIT
        raise QualificationJobError("arguments")
    except (QualificationJobError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "unavailable", "phase": error.phase if isinstance(error, QualificationJobError)
                          else "native-or-protocol", "parent_qualification_complete": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
