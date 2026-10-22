"""Constrain only this disposable qualification process using an unnamed job.

No privileges, persistent host settings, arbitrary limits or foreign processes.
The handle lives until child exit; the OS then releases the job.
"""
from __future__ import annotations
import ctypes
import sys

LIMIT_BYTES = 2 * 1024 ** 3
_job = None
_kernel = None


class BasicLimits(ctypes.Structure):
    _fields_ = [("process_time",ctypes.c_longlong),("job_time",ctypes.c_longlong),
        ("flags",ctypes.c_ulong),("minimum_working_set",ctypes.c_size_t),
        ("maximum_working_set",ctypes.c_size_t),("active_process_limit",ctypes.c_ulong),
        ("affinity",ctypes.c_size_t),("priority",ctypes.c_ulong),("scheduling",ctypes.c_ulong)]


class IoCounters(ctypes.Structure):
    _fields_ = [(name,ctypes.c_ulonglong) for name in ("read_ops","write_ops","other_ops","read_bytes","write_bytes","other_bytes")]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [("basic",BasicLimits),("io",IoCounters),("process_memory_limit",ctypes.c_size_t),
        ("job_memory_limit",ctypes.c_size_t),("peak_process_memory",ctypes.c_size_t),("peak_job_memory",ctypes.c_size_t)]


def constrain_current_process():
    global _job, _kernel
    if sys.platform != "win32" or _job is not None:
        raise RuntimeError("The declared isolated Windows memory profile is unavailable.")
    kernel=ctypes.WinDLL("kernel32",use_last_error=True)
    kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,ctypes.c_wchar_p]; kernel.CreateJobObjectW.restype=ctypes.c_void_p
    kernel.SetInformationJobObject.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_ulong]; kernel.SetInformationJobObject.restype=ctypes.c_int
    kernel.AssignProcessToJobObject.argtypes=[ctypes.c_void_p,ctypes.c_void_p]; kernel.AssignProcessToJobObject.restype=ctypes.c_int
    kernel.GetCurrentProcess.restype=ctypes.c_void_p
    kernel.IsProcessInJob.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.POINTER(ctypes.c_int)]; kernel.IsProcessInJob.restype=ctypes.c_int
    kernel.QueryInformationJobObject.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_ulong,ctypes.c_void_p]; kernel.QueryInformationJobObject.restype=ctypes.c_int
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    job=kernel.CreateJobObjectW(None,None)
    if not job:
        raise RuntimeError("Qualification memory job creation failed.")
    limits=ExtendedLimits(); limits.basic.flags=0x100 | 0x200
    limits.process_memory_limit=LIMIT_BYTES; limits.job_memory_limit=LIMIT_BYTES
    if not kernel.SetInformationJobObject(job,9,ctypes.byref(limits),ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job,kernel.GetCurrentProcess()):
        kernel.CloseHandle(job)
        raise RuntimeError("Qualification memory enforcement failed.")
    _job, _kernel=job,kernel
    return memory_profile_evidence()


def memory_profile_evidence():
    if _job is None or _kernel is None:
        raise RuntimeError("Qualification memory profile was not enforced.")
    limits=ExtendedLimits(); assigned=ctypes.c_int()
    if not _kernel.QueryInformationJobObject(_job,9,ctypes.byref(limits),ctypes.sizeof(limits),None) or not _kernel.IsProcessInJob(_kernel.GetCurrentProcess(),_job,ctypes.byref(assigned)):
        raise RuntimeError("Qualification memory enforcement readback failed.")
    if not assigned.value or limits.process_memory_limit!=LIMIT_BYTES or limits.job_memory_limit!=LIMIT_BYTES or limits.basic.flags & 0x300 != 0x300:
        raise RuntimeError("Qualification memory profile differs from its declaration.")
    return {"profile":"windows-owned-job-2gib", "enforced":True,"process_commit_limit_bytes":LIMIT_BYTES,"job_commit_limit_bytes":LIMIT_BYTES,"peak_process_commit_bytes":limits.peak_process_memory,"peak_job_commit_bytes":limits.peak_job_memory}
