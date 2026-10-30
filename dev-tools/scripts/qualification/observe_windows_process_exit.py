"""Read-only observation of one live owned process; never starts or stops it."""
from __future__ import annotations
import ctypes
from ctypes import wintypes
import json
import os
import sys
import time

MAX_PARENT_HOPS = 2
PROCESS_ACCESS = 0x00100000 | 0x1000  # synchronize/limited query only
# Existing qualification controllers allow 600/900/1200/2400 seconds of work,
# then 30 seconds for retirement, or 60 seconds of startup plus retirement.
# Installed generation separately observes its existing 1200-second window.
# Only the compatible PID-only Python API uses these exact windows. The CLI
# and root-bound shutdown API retain the short limit; this grants no authority
# to start work, extend its execution budget or establish job ownership.
QUALIFICATION_OBSERVATION_WINDOWS_MS = frozenset({
    630_000, 690_000, 930_000, 990_000, 1_200_000,
    1_230_000, 1_290_000, 2_430_000, 2_490_000,
})


class _FileTime(ctypes.Structure):
    _fields_ = [("low", ctypes.c_uint32), ("high", ctypes.c_uint32)]


class _BasicInformation(ctypes.Structure):
    _fields_ = [("exit_status", ctypes.c_int32), ("peb", ctypes.c_void_p),
                ("affinity", ctypes.c_size_t), ("priority", ctypes.c_int32),
                ("pid", ctypes.c_size_t), ("parent_pid", ctypes.c_size_t)]


def _pid(value):
    if type(value) is not int or not 0 < value <= 0xFFFFFFFF:
        raise ValueError("A bounded Windows process identity is required.")
    return value


class _WindowsApi:
    def __init__(self, ancestry):
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        self.kernel.GetExitCodeProcess.restype = wintypes.BOOL
        self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.kernel.WaitForSingleObject.restype = wintypes.DWORD
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        if ancestry:
            # Dynamic linking is deliberate: an unavailable/changed native API
            # denies admission. Never request broader rights or scan processes.
            self.nt = ctypes.WinDLL("ntdll", use_last_error=True)
            self.nt.NtQueryInformationProcess.argtypes = [wintypes.HANDLE, ctypes.c_uint32,
                ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32)]
            self.nt.NtQueryInformationProcess.restype = ctypes.c_int32
            self.kernel.GetProcessId.argtypes = [wintypes.HANDLE]
            self.kernel.GetProcessId.restype = wintypes.DWORD
            self.kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, *[ctypes.POINTER(_FileTime)] * 4]
            self.kernel.GetProcessTimes.restype = wintypes.BOOL

    def open(self, pid):
        handle = self.kernel.OpenProcess(PROCESS_ACCESS, False, pid)
        if not handle:
            raise ValueError("Owned process handle is unavailable.")
        return handle

    def code(self, handle):
        code = wintypes.DWORD()
        if not self.kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
            raise ValueError("Owned process exit code is unavailable.")
        return code.value

    def live(self, handle):
        return self.kernel.WaitForSingleObject(handle, 0) == 258 and self.code(handle) == 259

    def information(self, handle, pid):
        info = _BasicInformation()
        length = ctypes.c_uint32()
        status = self.nt.NtQueryInformationProcess(handle, 0, ctypes.byref(info), ctypes.sizeof(info), ctypes.byref(length))
        if status < 0 or length.value != ctypes.sizeof(info):
            raise ValueError("Native process ancestry is unavailable.")
        if self.kernel.GetProcessId(handle) != pid or info.pid != pid:
            raise ValueError("Native process identity changed.")
        parent = _pid(info.parent_pid)
        stamps = [_FileTime() for _ in range(4)]
        if not self.kernel.GetProcessTimes(handle, *[ctypes.byref(stamp) for stamp in stamps]):
            raise ValueError("Native process creation time is unavailable.")
        birth = stamps[0].low | stamps[0].high << 32
        if birth <= 0:
            raise ValueError("Native process creation time is invalid.")
        return {"pid": pid, "parentPid": parent, "birth": birth, "handle": handle}

    def wait(self, handle, timeout_ms):
        return self.kernel.WaitForSingleObject(handle, timeout_ms) == 0

    def close(self, handle):
        return bool(self.kernel.CloseHandle(handle))


def _api(ancestry):
    try:
        return _WindowsApi(ancestry)
    except (AttributeError, OSError) as error:
        raise ValueError("Native process observation is unsupported.") from error


def _observe(pid, ready, timeout_ms, root_pid):
    _pid(pid)
    if (os.name != "nt" or type(timeout_ms) is not int
            or not (0 < timeout_ms <= 30_000
                    or root_pid is None and timeout_ms in QUALIFICATION_OBSERVATION_WINDOWS_MS)):
        raise ValueError("A bounded Windows process observation is required.")
    if root_pid is not None:
        _pid(root_pid)
        if ctypes.sizeof(ctypes.c_void_p) != 8 or ctypes.sizeof(_BasicInformation) != 48:
            raise ValueError("Native process ancestry requires a supported 64-bit Windows layout.")
    api = _api(root_pid is not None)
    nodes = []
    handles = []
    deadline = time.monotonic() + timeout_ms / 1000
    try:
        current = pid
        seen = set()
        while True:
            if current in seen:
                raise ValueError("Native process ancestry contains a cycle.")
            seen.add(current)
            handle = api.open(current)
            handles.append(handle)
            if not api.live(handle):
                raise ValueError("Owned process is not live at shutdown admission.")
            node = api.information(handle, current) if root_pid is not None else {"pid": current, "handle": handle}
            if nodes and node["birth"] > nodes[-1]["birth"]:
                raise ValueError("Native parent identity has a later creation time.")
            nodes.append(node)
            if root_pid is None or current == root_pid:
                break
            if len(nodes) > MAX_PARENT_HOPS:
                raise ValueError("The bounded native ancestry does not reach the test root.")
            current = node["parentPid"]
        # Handles remain held while the admission frame is consumed and through
        # retirement. Recheck liveness after constructing the entire chain.
        if not all(api.live(handle) for handle in handles):
            raise ValueError("Owned process ancestry exited before admission.")
        admission = {"pid": pid}
        if root_pid is not None:
            admission.update(rootPid=root_pid, parentPid=nodes[0]["parentPid"], chain=[node["pid"] for node in nodes])
        ready(admission)
        targets = nodes if root_pid is None or root_pid == pid else nodes[:-1]
        retired = []
        for node in targets:
            remaining = timeout_ms if root_pid is None else int((deadline - time.monotonic()) * 1000)
            if remaining <= 0 or not api.wait(node["handle"], remaining):
                raise ValueError("Owned process exit was not observed within the bound.")
            retired.append({"pid": node["pid"], "exitCode": api.code(node["handle"])})
        result = {"pid": pid, "exitCode": retired[0]["exitCode"]}
        if root_pid is not None:
            result.update(rootPid=root_pid, retired=retired)
        return result
    finally:
        failed = sys.exc_info()[0] is not None
        closed = True
        for handle in reversed(handles):
            try:
                closed = api.close(handle) and closed
            except Exception:
                closed = False
        if root_pid is not None and not closed and not failed:
            raise ValueError("Owned native observation handles could not be released.")


def observe(pid: int, ready, timeout_ms: int = 30_000) -> int:
    """PID-only compatibility: short waits or exact existing qualification windows.

    The caller supplies the owned identity and enforces its execution limits.
    Observation is read-only and does not prove a protected job or staging fence.
    """
    return _observe(pid, lambda _admission: ready(), timeout_ms, None)["exitCode"]


def observe_with_root(pid: int, root_pid: int, ready, timeout_ms: int = 30_000):
    """Controlled test ancestry/exit evidence, never an authorization capability."""
    _pid(root_pid)  # Explicit root mode can never fall back to PID-only mode.
    return _observe(pid, ready, timeout_ms, root_pid)


def _decimal(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 10 or not value.isascii() or not value.isdigit():
        raise ValueError("Invalid bounded observer input.")
    return _pid(int(value))


def main():
    try:
        if len(sys.argv) == 2:
            pid = _decimal(sys.argv[1])
            code = observe(pid, lambda: print(json.dumps({"phase": "ready", "pid": pid}), flush=True))
            result = {"pid": pid, "exitCode": code}
        elif len(sys.argv) == 4 and sys.argv[2] == "--root-pid":
            pid, root = _decimal(sys.argv[1]), _decimal(sys.argv[3])
            result = observe_with_root(pid, root, lambda admission: print(json.dumps({"phase": "ready", **admission}), flush=True))
        else:
            raise ValueError("Invalid bounded observer input.")
        print(json.dumps({"phase": "exited", **result}), flush=True)
        return 0
    except Exception:
        print("Owned native process exit observation failed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
