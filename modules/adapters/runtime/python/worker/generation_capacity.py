"""Minimized worker-local advisory telemetry; never model readiness or admission."""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import re
import subprocess
import sys
from threading import Event, Lock, Thread
import time

_MAX_OUTPUT = 4096
_CACHE_SECONDS = 30.0
_CALLER_WAIT_SECONDS = 1.0
_QUERY_SECONDS = 0.75
_ARGS = ("--query-gpu=memory.total,mig.mode.current,mig.mode.pending", "--format=csv,noheader,nounits")


class _ProbeRetirementUnconfirmed(RuntimeError):
    def __init__(self, process: subprocess.Popen, reader: Thread | None):
        super().__init__("Driver probe retirement is unconfirmed.")
        self.process, self.reader = process, reader


def _visibility_key() -> tuple[str | None, ...] | None:
    # nvidia-smi does not implement CUDA's remapping policy. Never infer a
    # selected device from a UUID, MIG selector, empty mask or multiple indices.
    cuda = os.environ.get("CUDA_VISIBLE_DEVICES")
    nvidia = os.environ.get("NVIDIA_VISIBLE_DEVICES")
    order = os.environ.get("CUDA_DEVICE_ORDER")
    if (cuda not in (None, "0") or nvidia not in (None, "0", "all")
            or order not in (None, "FASTEST_FIRST", "PCI_BUS_ID")
            or any(key.startswith("CUDA_MPS_") for key in os.environ)):
        return None
    return cuda, nvidia, order


def _driver_context() -> tuple[str, dict[str, str]] | None:
    # No PATH search, project-local executable, caller path or inherited secrets.
    if sys.platform == "win32":
        if ctypes.sizeof(ctypes.c_void_p) != 8:
            return None
        buffer = ctypes.create_unicode_buffer(32768)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        get_directory = kernel.GetSystemDirectoryW
        get_directory.argtypes = (ctypes.POINTER(ctypes.c_wchar), ctypes.c_uint)
        get_directory.restype = ctypes.c_uint
        length = get_directory(buffer, len(buffer))
        if not 0 < length < len(buffer):
            return None
        directory = Path(buffer.value)
        if not directory.is_absolute():
            return None
        # NVML needs the native Program Files location. Resolve it through the
        # OS, never from inherited ProgramFiles/ProgramW6432 or a caller path.
        program_files = ctypes.create_unicode_buffer(32768)
        shell = ctypes.WinDLL("shell32", use_last_error=True)
        get_folder = shell.SHGetFolderPathW
        get_folder.argtypes = (ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p,
                              ctypes.c_uint, ctypes.POINTER(ctypes.c_wchar))
        get_folder.restype = ctypes.c_long
        if get_folder(None, 0x26, None, 0, program_files) != 0 or not Path(program_files.value).is_absolute():
            return None
        return str(directory / "nvidia-smi.exe"), {
            "SystemRoot": str(directory.parent), "WINDIR": str(directory.parent),
            "ProgramFiles": program_files.value,
            "PATH": str(directory), "LANG": "C", "LC_ALL": "C",
        }
    if sys.platform.startswith("linux"):
        return "/usr/bin/nvidia-smi", {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"}
    return None


def _parse_total(raw: bytes | None) -> int | None:
    if not isinstance(raw, bytes) or len(raw) > _MAX_OUTPUT:
        return None
    # N/A is NVIDIA's unsupported-field marker, used by non-MIG consumer GPUs.
    # Enabled, pending enablement, extra lines/fields and unknown text all deny.
    match = re.fullmatch(rb"[ \t]*([0-9]{1,9})[ \t]*,[ \t]*(Disabled|N/A|\[N/A\])[ \t]*,[ \t]*(Disabled|N/A|\[N/A\])[ \t]*(?:\r?\n)?", raw)
    if match is None:
        return None
    if match.group(2).strip(b"[]") != match.group(3).strip(b"[]"):
        return None
    total = int(match.group(1)) * 1024 ** 2
    return total if 0 < total <= 2 ** 53 - 1 else None


def _retire(process: subprocess.Popen, reader: Thread | None) -> None:
    # This runs only in the one daemon probe. An uncertain exit or held output
    # keeps that probe active; a public timeout never authorizes another child.
    while True:
        try:
            if process.poll() is None:
                try:
                    process.kill()
                except OSError:
                    pass
            process.wait(timeout=1.0)
            break
        except (OSError, subprocess.TimeoutExpired):
            time.sleep(0.05)
    if reader is not None:
        reader.join()
    if process.stdout is not None:
        process.stdout.close()


def _query_driver() -> int | None:
    context = _driver_context()
    if context is None:
        return None
    executable, environment = context
    process = subprocess.Popen(
        [executable, *_ARGS], cwd=str(Path(executable).parent), env=environment,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        shell=False, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    output: list[bytes | None] = []
    reader: Thread | None = None
    success = False
    try:
        def read() -> None:
            try:
                output.append(process.stdout.read(_MAX_OUTPUT + 1))
            except OSError:
                output.append(None)
        candidate = Thread(target=read, name="accelerator-capacity-output", daemon=True)
        candidate.start()
        reader = candidate
        code = process.wait(timeout=_QUERY_SECONDS)
        reader.join(timeout=0.05)
        success = code == 0 and not reader.is_alive()
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        pass
    finally:
        try:
            _retire(process, reader)
        except Exception:
            raise _ProbeRetirementUnconfirmed(process, reader) from None
    return _parse_total(output[0]) if success and len(output) == 1 else None


class _CapacityReader:
    def __init__(self) -> None:
        self._lock = Lock()
        self._active: Event | None = None
        self._active_key: tuple[str | None, ...] | None = None
        self._cache_key: tuple[str | None, ...] | None = None
        self._expires = 0.0
        self._value: int | None = None
        self._unconfirmed: _ProbeRetirementUnconfirmed | None = None

    def read(self) -> int | None:
        key = _visibility_key()
        if key is None:
            return None
        with self._lock:
            if self._cache_key == key and time.monotonic() < self._expires:
                return self._value
            if self._active is None:
                completed = Event()
                self._active, self._active_key = completed, key
                def probe() -> None:
                    value = None
                    try:
                        value = _query_driver()
                    except _ProbeRetirementUnconfirmed as error:
                        # Keep this worker's slot fenced. A swallowed close or
                        # drain failure is not authority to launch another child.
                        with self._lock:
                            self._unconfirmed = error
                        return
                    except Exception:
                        # Only a fixed unknown is public. No path, driver output,
                        # environment, traceback or credential enters diagnostics.
                        pass
                    with self._lock:
                        self._value, self._cache_key = value, key
                        self._expires = time.monotonic() + _CACHE_SECONDS
                        self._active = self._active_key = None
                        completed.set()
                try:
                    Thread(target=probe, name="accelerator-capacity-probe", daemon=True).start()
                except RuntimeError:
                    self._active = self._active_key = None
                    return None
            elif self._active_key != key:
                return None
            completed = self._active
        completed.wait(_CALLER_WAIT_SECONDS)
        with self._lock:
            return self._value if (self._cache_key == key and _visibility_key() == key
                                   and time.monotonic() < self._expires) else None


_reader = _CapacityReader()


def read_local_accelerator_memory_bytes() -> int | None:
    return _reader.read()
