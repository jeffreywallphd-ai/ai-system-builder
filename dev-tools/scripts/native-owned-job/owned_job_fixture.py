"""Uncomposed Windows lifetime fixture for one fixed, harmless Python child.

This is not a runtime launcher or a staging protection provider. Its private
guardian protocol is used only by the adjacent tests. No caller command, path,
job handle, PID or resource limit can be supplied to create a child.
"""
from __future__ import annotations

import ctypes
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import threading
import time

SCRIPT = Path(__file__).resolve()
sys.path.insert(0, str(SCRIPT.parents[1] / "qualification"))
from windows_qualification_memory import ExtendedLimits

COMMIT_LIMIT = 256 * 1024**2
LIMIT_FLAGS = 0x2000 | 0x8 | 0x100 | 0x200
JOB_LIST_ATTRIBUTE = 0x2000D
CHILD_SECONDS = 20
GUARDIAN_SECONDS = 25
WAIT_MILLISECONDS = 5000
STILL_ACTIVE = 259
FALLBACK_EXIT_CODE = 75


class FixtureUnavailable(RuntimeError):
    def __init__(self):
        super().__init__("The owned Windows lifetime fixture is unavailable.")


def require(value):
    if not value:
        raise FixtureUnavailable()


def supported():
    return (sys.platform == "win32" and ctypes.sizeof(ctypes.c_void_p) == 8
            and platform.machine().lower() in {"amd64", "x86_64"}
            and sys.implementation.name == "cpython" and sys.version_info[:2] == (3, 12))


class StartupInfo(ctypes.Structure):
    _fields_ = [("size", ctypes.c_ulong), ("reserved", ctypes.c_wchar_p),
                ("desktop", ctypes.c_wchar_p), ("title", ctypes.c_wchar_p),
                *[(name, ctypes.c_ulong) for name in ("x", "y", "x_size", "y_size", "x_chars", "y_chars", "fill", "flags")],
                ("show", ctypes.c_ushort), ("reserved_size", ctypes.c_ushort),
                ("reserved_bytes", ctypes.c_void_p), ("stdin", ctypes.c_void_p),
                ("stdout", ctypes.c_void_p), ("stderr", ctypes.c_void_p)]


class StartupInfoEx(ctypes.Structure):
    _fields_ = [("startup", StartupInfo), ("attributes", ctypes.c_void_p)]


class ProcessInformation(ctypes.Structure):
    _fields_ = [("process", ctypes.c_void_p), ("thread", ctypes.c_void_p),
                ("pid", ctypes.c_ulong), ("thread_id", ctypes.c_ulong)]


class ProcessIds(ctypes.Structure):
    _fields_ = [("assigned", ctypes.c_ulong), ("count", ctypes.c_ulong),
                ("ids", ctypes.c_size_t * 1)]


def kernel_api():
    require(supported())
    require(ctypes.sizeof(StartupInfoEx) == 112 and ctypes.sizeof(ProcessInformation) == 24
            and ctypes.sizeof(ExtendedLimits) == 144)
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    pointer = ctypes.c_void_p
    ulong = ctypes.c_ulong
    signatures = {
        "CreateJobObjectW": ([pointer, ctypes.c_wchar_p], pointer),
        "SetInformationJobObject": ([pointer, ctypes.c_int, pointer, ulong], ctypes.c_int),
        "QueryInformationJobObject": ([pointer, ctypes.c_int, pointer, ulong, pointer], ctypes.c_int),
        "GetHandleInformation": ([pointer, ctypes.POINTER(ulong)], ctypes.c_int),
        "InitializeProcThreadAttributeList": ([pointer, ulong, ulong, ctypes.POINTER(ctypes.c_size_t)], ctypes.c_int),
        "UpdateProcThreadAttribute": ([pointer, ulong, ctypes.c_size_t, pointer, ctypes.c_size_t, pointer, pointer], ctypes.c_int),
        "DeleteProcThreadAttributeList": ([pointer], None),
        "CreateProcessW": ([ctypes.c_wchar_p, ctypes.c_wchar_p, pointer, pointer, ctypes.c_int,
                            ulong, pointer, ctypes.c_wchar_p, pointer, pointer], ctypes.c_int),
        "ResumeThread": ([pointer], ulong),
        "IsProcessInJob": ([pointer, pointer, ctypes.POINTER(ctypes.c_int)], ctypes.c_int),
        "GetProcessTimes": ([pointer, pointer, pointer, pointer, pointer], ctypes.c_int),
        "GetExitCodeProcess": ([pointer, ctypes.POINTER(ulong)], ctypes.c_int),
        "WaitForSingleObject": ([pointer, ulong], ulong),
        "CloseHandle": ([pointer], ctypes.c_int),
        "OpenProcess": ([ulong, ctypes.c_int, ulong], pointer),
        "GetCurrentProcess": ([], pointer),
        "DuplicateHandle": ([pointer, pointer, pointer, ctypes.POINTER(pointer), ulong, ctypes.c_int, ulong], ctypes.c_int),
    }
    for name, (args, result) in signatures.items():
        function = getattr(api, name)
        function.argtypes, function.restype = args, result
    return api


def creation_identity(api, handle):
    # FILETIME contains two DWORDs. Keep the 64-bit result private to the tests.
    values = [(ctypes.c_ulong * 2)() for _ in range(4)]
    require(api.GetProcessTimes(handle, *(ctypes.byref(value) for value in values)))
    return int(values[0][0]) | (int(values[0][1]) << 32)


def exit_code(api, handle):
    code = ctypes.c_ulong()
    require(api.GetExitCodeProcess(handle, ctypes.byref(code)))
    return int(code.value)


def qualify_job_shutdown(code):
    # This declared Windows fixture accepts only the observed job-close code.
    # Natural expiry and unexpected child failures can never supply success.
    require(type(code) is int and code == 0)


def readback(api, job, process, pid):
    limits = ExtendedLimits()
    member = ctypes.c_int()
    ids = ProcessIds()
    require(api.QueryInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits), None))
    require(api.QueryInformationJobObject(job, 3, ctypes.byref(ids), ctypes.sizeof(ids), None))
    require(api.IsProcessInJob(process, job, ctypes.byref(member)) and member.value == 1)
    require(limits.basic.flags == LIMIT_FLAGS and limits.basic.active_process_limit == 1
            and limits.process_memory_limit == COMMIT_LIMIT and limits.job_memory_limit == COMMIT_LIMIT)
    require(ids.assigned == 1 and ids.count == 1 and ids.ids[0] == pid)
    return {"atomic_job_assignment": True, "active_process_limit": 1,
            "process_commit_limit_bytes": COMMIT_LIMIT, "job_commit_limit_bytes": COMMIT_LIMIT,
            "kill_on_last_job_close": True, "exact_member": True}


class OwnedFixture:
    """Create only this file's fixed isolated child, initially suspended.

    Atomic job-list creation closes the unassigned-suspended-process race. This
    object does not own any model, directory, file-protection or journal lease.
    """
    def __init__(self):
        self.api = kernel_api()
        self.job = self.process = self.thread = None
        self.pid = None
        attributes = None
        initialized = False
        try:
            self.job = self.api.CreateJobObjectW(None, None)
            require(self.job)
            flags = ctypes.c_ulong()
            require(self.api.GetHandleInformation(self.job, ctypes.byref(flags)) and flags.value & 1 == 0)
            limits = ExtendedLimits()
            limits.basic.flags = LIMIT_FLAGS
            limits.basic.active_process_limit = 1
            limits.process_memory_limit = limits.job_memory_limit = COMMIT_LIMIT
            require(self.api.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
            size = ctypes.c_size_t()
            # First call intentionally obtains the required finite allocation.
            self.api.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
            require(0 < size.value <= 65536)
            attributes = ctypes.create_string_buffer(size.value)
            require(self.api.InitializeProcThreadAttributeList(attributes, 1, 0, ctypes.byref(size)))
            initialized = True
            jobs = (ctypes.c_void_p * 1)(self.job)
            require(self.api.UpdateProcThreadAttribute(attributes, 0, JOB_LIST_ATTRIBUTE,
                                                       jobs, ctypes.sizeof(jobs), None, None))
            startup = StartupInfoEx()
            startup.startup.size = ctypes.sizeof(startup)
            startup.attributes = ctypes.cast(attributes, ctypes.c_void_p)
            command = ctypes.create_unicode_buffer(subprocess.list2cmdline(
                [sys.executable, "-I", "-S", "-B", str(SCRIPT), "--fixed-waiter"]))
            system_root = os.environ.get("SystemRoot")
            require(system_root and "\0" not in system_root)
            # platform.machine() uses this Windows value. The already checked
            # x64 parent launches the exact same interpreter; do not inherit
            # unrelated environment or let a missing value end the child early.
            environment = ctypes.create_unicode_buffer(
                f"PROCESSOR_ARCHITECTURE=AMD64\0SystemRoot={system_root}\0WINDIR={system_root}\0\0")
            info = ProcessInformation()
            require(self.api.CreateProcessW(sys.executable, command, None, None, False,
                                            0x80000 | 0x4 | 0x8000000 | 0x400,
                                            environment, str(SCRIPT.parent), ctypes.byref(startup), ctypes.byref(info)))
            self.process, self.thread, self.pid = info.process, info.thread, int(info.pid)
            self.facts = readback(self.api, self.job, self.process, self.pid)
            self.created = creation_identity(self.api, self.process)
            require(exit_code(self.api, self.process) == STILL_ACTIVE)
        except BaseException:
            self.close()
            raise
        finally:
            if initialized:
                self.api.DeleteProcThreadAttributeList(attributes)

    def resume(self):
        require(self.process and self.thread and self.job)
        require(self.api.ResumeThread(self.thread) == 1)
        require(self.api.CloseHandle(self.thread))
        self.thread = None

    def close(self):
        # Closing the last job handle requests termination. Only an actual wait
        # supplies exit evidence. Do not claim this orders filesystem release.
        if self.job:
            job = self.job
            self.job = None
            require(self.api.CloseHandle(job))
        code = None
        if self.process:
            require(self.api.WaitForSingleObject(self.process, WAIT_MILLISECONDS) == 0)
            code = exit_code(self.api, self.process)
            require(code != STILL_ACTIVE)
        for name in ("thread", "process"):
            handle = getattr(self, name)
            if handle:
                setattr(self, name, None)
                require(self.api.CloseHandle(handle))
        return code


def guardian():
    timer = threading.Timer(GUARDIAN_SECONDS, lambda: os._exit(74))
    timer.daemon = True
    timer.start()
    fixture = None
    try:
        fixture = OwnedFixture()
        # Native handles/identities are private test protocol, never public
        # diagnostics or persistent evidence. The observer closes its temporary
        # job query handle before ACK; it retains only the process handle.
        print(json.dumps({"stage": "suspended", "pid": fixture.pid, "created": fixture.created,
                          "job": int(fixture.job), "facts": fixture.facts}), flush=True)
        require(sys.stdin.readline(8) == "ACK\n")
        fixture.resume()
        print(json.dumps({"stage": "running"}), flush=True)
        action = sys.stdin.readline(8)
        require(action in {"CLOSE\n", ""})
        code = fixture.close()
        qualify_job_shutdown(code)
        print(json.dumps({"stage": "exited", "exit_code": code, "observed": True}), flush=True)
        return 0
    finally:
        if fixture is not None:
            fixture.close()
        timer.cancel()


def main():
    require(sys.argv[1:] in (["--guardian"], ["--fixed-waiter"]))
    require(supported())
    if sys.argv[1] == "--fixed-waiter":
        # No imports of model code, file writes, network, descendants or input.
        # The finite self-exit bounds damage if the test's own shutdown fails.
        time.sleep(CHILD_SECONDS)
        return FALLBACK_EXIT_CODE
    return guardian()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FixtureUnavailable:
        print('{"status":"fixture-unavailable"}', flush=True)
        raise SystemExit(3)
