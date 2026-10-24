"""Private x64 Windows ABI for the fixed OCR resource and its owned process.

No process adoption, command dispatch, PID mutation or AssignProcess fallback.
Importing this module does not load Windows libraries or discover OCR support.
"""
from __future__ import annotations
import ctypes as c
import os


class NativeFailure(RuntimeError):
    """Only fixed internal phase codes; never OS messages, paths or payloads."""


def need(value: object, phase: str) -> None:
    if not value:
        raise NativeFailure(phase)


class Basic(c.Structure):
    _fields_ = [("process_time", c.c_int64), ("job_time", c.c_int64),
                ("flags", c.c_uint32), ("minimum_ws", c.c_size_t),
                ("maximum_ws", c.c_size_t), ("active_limit", c.c_uint32),
                ("affinity", c.c_size_t), ("priority", c.c_uint32),
                ("scheduling", c.c_uint32)]


class Io(c.Structure):
    _fields_ = [(name, c.c_uint64) for name in
                ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]


class Limits(c.Structure):
    _fields_ = [("basic", Basic), ("io", Io), ("process_memory", c.c_size_t),
                ("job_memory", c.c_size_t), ("peak_process", c.c_size_t), ("peak_job", c.c_size_t)]


class Accounting(c.Structure):
    _fields_ = [(name, c.c_int64) for name in ("user", "kernel", "period_user", "period_kernel")] + [
        (name, c.c_uint32) for name in ("faults", "total", "active", "terminated")]


class Startup(c.Structure):
    _fields_ = [("cb", c.c_uint32), ("reserved", c.c_wchar_p), ("desktop", c.c_wchar_p),
                ("title", c.c_wchar_p), *[(name, c.c_uint32) for name in
                ("x", "y", "width", "height", "chars_x", "chars_y", "fill", "flags")],
                ("show", c.c_uint16), ("reserved_size", c.c_uint16),
                ("reserved_bytes", c.c_void_p), ("stdin", c.c_void_p),
                ("stdout", c.c_void_p), ("stderr", c.c_void_p)]


class StartupEx(c.Structure):
    _fields_ = [("startup", Startup), ("attributes", c.c_void_p)]


class Process(c.Structure):
    _fields_ = [("process", c.c_void_p), ("thread", c.c_void_p),
                ("pid", c.c_uint32), ("tid", c.c_uint32)]


class Security(c.Structure):
    _fields_ = [("length", c.c_uint32), ("descriptor", c.c_void_p), ("inherit", c.c_int)]


class FileTime(c.Structure):
    _fields_ = [("low", c.c_uint32), ("high", c.c_uint32)]


class FileInfo(c.Structure):
    _fields_ = [("attributes", c.c_uint32), ("created", FileTime), ("accessed", FileTime),
                ("written", FileTime), ("volume", c.c_uint32), ("size_high", c.c_uint32),
                ("size_low", c.c_uint32), ("links", c.c_uint32),
                ("index_high", c.c_uint32), ("index_low", c.c_uint32)]


class CompletionAssociation(c.Structure):
    _fields_ = [("key", c.c_void_p), ("port", c.c_void_p)]


class Windows:
    def __init__(self):
        need(os.name == "nt" and c.sizeof(c.c_void_p) == 8, "unsupported-platform")
        self.k = c.WinDLL("kernel32", use_last_error=True)
        p, w, b = c.c_void_p, c.c_uint32, c.c_int
        signatures = {
            "CreateJobObjectW": ([p, c.c_wchar_p], p),
            "SetInformationJobObject": ([p, c.c_int, p, w], b),
            "QueryInformationJobObject": ([p, c.c_int, p, w, p], b),
            "GetHandleInformation": ([p, c.POINTER(w)], b),
            "SetHandleInformation": ([p, w, w], b), "CloseHandle": ([p], b),
            "InitializeProcThreadAttributeList": ([p, w, w, c.POINTER(c.c_size_t)], b),
            "UpdateProcThreadAttribute": ([p, w, c.c_size_t, p, c.c_size_t, p, p], b),
            "DeleteProcThreadAttributeList": ([p], None),
            "CreateProcessW": ([c.c_wchar_p, c.c_wchar_p, p, p, b, w, p, c.c_wchar_p,
                                c.POINTER(StartupEx), c.POINTER(Process)], b),
            "IsProcessInJob": ([p, p, c.POINTER(b)], b), "ResumeThread": ([p], w),
            "WaitForSingleObject": ([p, w], w), "GetExitCodeProcess": ([p, c.POINTER(w)], b),
            "GetProcessId": ([p], w),
            "GetProcessTimes": ([p, *[c.POINTER(FileTime)] * 4], b),
            "TerminateJobObject": ([p, w], b),
            "CreatePipe": ([c.POINTER(p), c.POINTER(p), c.POINTER(Security), w], b),
            "CreateFileW": ([c.c_wchar_p, w, w, c.POINTER(Security), w, w, p], p),
            "GetFileType": ([p], w), "GetFileInformationByHandle": ([p, c.POINTER(FileInfo)], b),
            "ReadFile": ([p, p, w, c.POINTER(w), p], b),
            "WriteFile": ([p, p, w, c.POINTER(w), p], b),
            "GetWindowsDirectoryW": ([p, w], w),
            "CreateIoCompletionPort": ([p, p, c.c_size_t, w], p),
            "GetQueuedCompletionStatus": ([p, c.POINTER(w), c.POINTER(c.c_size_t),
                                          c.POINTER(p), w], b),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.k, name)
            function.argtypes, function.restype = arguments, result
        need(c.sizeof(Limits) == 144 and c.sizeof(StartupEx) == 112 and
             c.sizeof(Process) == 24 and c.sizeof(Accounting) == 48 and
             c.sizeof(FileInfo) == 52, "native-abi")

    def inheritable(self, handle):
        flags = c.c_uint32()
        need(self.k.GetHandleInformation(handle, c.byref(flags)), "handle-flags")
        return bool(flags.value & 1)

    def member(self, process, job):
        result = c.c_int()
        need(self.k.IsProcessInJob(process, job, c.byref(result)), "membership-query")
        return bool(result.value)

    def exit_code(self, process, milliseconds=0):
        result = c.c_uint32()
        need(self.k.WaitForSingleObject(process, milliseconds) == 0 and
             self.k.GetExitCodeProcess(process, c.byref(result)), "root-native-exit")
        # A signalled process may legitimately exit with STILL_ACTIVE (259).
        return result.value

    def identity(self, process):
        pid, times = self.k.GetProcessId(process), [FileTime() for _ in range(4)]
        need(pid and self.k.GetProcessTimes(process, *[c.byref(item) for item in times]),
             "process-handle-identity")
        return {"pid": pid, "creation_ticks": times[0].low | times[0].high << 32}

    def environment(self):
        value = c.create_unicode_buffer(32768)
        length = self.k.GetWindowsDirectoryW(value, len(value))
        need(0 < length < len(value), "windows-directory")
        return {"SystemRoot": value.value, "WINDIR": value.value}
