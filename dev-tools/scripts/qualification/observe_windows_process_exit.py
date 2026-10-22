"""Read-only observation of one live owned process; never starts or stops it."""
from __future__ import annotations
import ctypes
from ctypes import wintypes
import json
import os
import sys


def observe(pid: int, ready, timeout_ms: int = 30_000) -> int:
    if os.name != "nt" or isinstance(pid, bool) or not isinstance(pid, int) or not 0 < pid <= 0xFFFFFFFF:
        raise ValueError("A Windows owned process identity is required.")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.GetExitCodeProcess.restype = wintypes.BOOL
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.OpenProcess(0x00100000 | 0x1000, False, pid)  # synchronize/query only
    if not handle:
        raise ValueError("Owned process is unavailable.")
    try:
        code = wintypes.DWORD()
        if kernel.WaitForSingleObject(handle, 0) != 258 or not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value != 259:
            raise ValueError("Owned process is not live at shutdown admission.")
        ready()
        if kernel.WaitForSingleObject(handle, timeout_ms) != 0:
            raise ValueError("Owned process exit was not observed within the bound.")
        if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
            raise ValueError("Owned process exit code is unavailable.")
        return code.value
    finally:
        kernel.CloseHandle(handle)


def main():
    try:
        if len(sys.argv) != 2 or not sys.argv[1].isascii() or not sys.argv[1].isdigit():
            raise ValueError("Invalid bounded observer input.")
        pid = int(sys.argv[1])
        code = observe(pid, lambda: print(json.dumps({"phase": "ready", "pid": pid}), flush=True))
        print(json.dumps({"phase": "exited", "pid": pid, "exitCode": code}), flush=True)
        return 0
    except (ValueError, OSError):
        print("Owned native process exit observation failed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
