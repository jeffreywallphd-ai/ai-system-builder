"""Private original-worker Job controller. Importing this module performs no IO.

The controller launches only its shipped sibling worker/main.py with its own
installed interpreter. It is not a model executor, a qualifier or a file owner.
ABI declarations reuse the repository's existing Win32 launch patterns; no
qualification actor, effect grant or budget is imported or widened here.
"""
from __future__ import annotations

import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import platform
from queue import Empty, Full, Queue
import re
import subprocess
import sys
from threading import Event, Lock, Thread, get_ident
import time

P, U32, I32 = C.c_void_p, C.c_uint32, C.c_int32
FLAGS = 0x2000 | 0x8 | 0x100 | 0x200  # kill-on-close, active, process/Job commit
JOB_LIST, HANDLE_LIST = 0x2000D, 0x20002
CREATE_FLAGS = 0x80000 | 0x4 | 0x400 | 0x08000000
FRAME_BYTES, CHUNK_BYTES, OUTPUT_BYTES = 65536, 8192, 1024 * 1024


class LaunchUnavailable(RuntimeError):
    def __init__(self):
        super().__init__("The original managed worker is unavailable.")


def need(value):
    if value is not True:
        raise LaunchUnavailable()


def exact(raw, keys):
    need(type(raw) is dict and set(raw) == set(keys))
    return raw


def integer(value, low, high):
    need(type(value) is int and low <= value <= high)
    return value


def capture_profile(raw):
    value = exact(raw, ("schema", "profileId", "processMemoryBytes", "jobMemoryBytes",
                        "maximumActiveProcesses", "maximumDurationMs", "observationMs"))
    need(value["schema"] == "windows-original-worker-job-v1")
    need(type(value["profileId"]) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}", value["profileId"]) is not None)
    process = integer(value["processMemoryBytes"], 1, 2**53 - 1)
    integer(value["jobMemoryBytes"], process, 2**53 - 1)
    integer(value["maximumActiveProcesses"], 1, 32)
    integer(value["maximumDurationMs"], 1, 86400000)
    integer(value["observationMs"], 1, 5000)
    # All values are explicit configuration, never production defaults.
    return dict(value)


def profile_digest(profile):
    value = capture_profile(profile)
    return "sha256:" + hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()


def capture_boot(raw):
    value = exact(raw, ("schema", "nonce", "profile", "profileDigest", "environment"))
    need(value["schema"] == "windows-original-worker-launch-v1")
    need(type(value["nonce"]) is str and re.fullmatch(r"[a-f0-9]{64}", value["nonce"]) is not None)
    profile = capture_profile(value["profile"])
    need(value["profileDigest"] == profile_digest(profile))
    env = value["environment"]
    need(type(env) is dict and 1 <= len(env) <= 256)
    seen, copied = set(), {}
    for key, text in env.items():
        need(type(key) is str and 0 < len(key) <= 160 and not any(c in key for c in "=\x00\r\n")
             and key.casefold() not in seen and type(text) is str and len(text) <= 8192 and "\x00" not in text)
        seen.add(key.casefold()); copied[key] = text
    need(sum(len(k) + len(v) + 2 for k, v in copied.items()) <= 24000)
    need(copied.get("PYTHON_RUNTIME_HOST") == "127.0.0.1"
         and re.fullmatch(r"[0-9]{1,5}", copied.get("PYTHON_RUNTIME_PORT", "")) is not None
         and 1024 <= int(copied["PYTHON_RUNTIME_PORT"]) <= 65535)
    need(re.fullmatch(r"[a-f0-9]{64}", copied.get("PYTHON_RUNTIME_STARTUP_PROOF", "")) is not None
         and len(copied.get("PYTHON_RUNTIME_AUTH_TOKEN", "")) >= 32)
    return {**value, "profile": profile, "environment": copied}


def parse_frame(data):
    need(type(data) is bytes and 0 < len(data) <= FRAME_BYTES)
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result); result[key] = value
        return result
    try:
        return json.loads(data.decode("utf8"), object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(LaunchUnavailable()))
    except (UnicodeError, ValueError, RecursionError):
        raise LaunchUnavailable() from None


class BasicLimits(C.Structure):
    _fields_ = [("process_time", C.c_int64), ("job_time", C.c_int64), ("flags", U32),
                ("minimum_working_set", C.c_size_t), ("maximum_working_set", C.c_size_t),
                ("active_process_limit", U32), ("affinity", C.c_size_t), ("priority", U32), ("scheduling", U32)]


class IoCounters(C.Structure):
    _fields_ = [(n, C.c_uint64) for n in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]


class ExtendedLimits(C.Structure):
    _fields_ = [("basic", BasicLimits), ("io", IoCounters), ("process_memory_limit", C.c_size_t),
                ("job_memory_limit", C.c_size_t), ("peak_process_memory", C.c_size_t), ("peak_job_memory", C.c_size_t)]


class Security(C.Structure):
    _fields_ = [("length", U32), ("descriptor", P), ("inherit", I32)]


class Startup(C.Structure):
    _fields_ = [("cb", U32), ("reserved", C.c_wchar_p), ("desktop", C.c_wchar_p), ("title", C.c_wchar_p),
                *[(n, U32) for n in ("x", "y", "width", "height", "chars_x", "chars_y", "fill", "flags")],
                ("show", C.c_uint16), ("reserved_size", C.c_uint16), ("reserved_bytes", P),
                ("stdin", P), ("stdout", P), ("stderr", P)]


class StartupEx(C.Structure):
    _fields_ = [("startup", Startup), ("attributes", P)]


class Process(C.Structure):
    _fields_ = [("process", P), ("thread", P), ("pid", U32), ("tid", U32)]


class Accounting(C.Structure):
    _fields_ = [(n, C.c_int64) for n in ("user", "kernel", "period_user", "period_kernel")] + [
        (n, U32) for n in ("faults", "total", "active", "terminated")]


class FileTime(C.Structure):
    _fields_ = [("low", U32), ("high", U32)]


class Handle:
    def __init__(self, owner, role, slot=None):
        self.owner, self.role = owner, role
        self.slot = slot if slot is not None else P()
        self.known = self.close_attempted = self.closed = False


class WindowsKernel:
    """Real finite Win32 API table. Construction is explicit, not import-time."""
    def __init__(self):
        need(sys.platform == "win32" and C.sizeof(P) == 8 and platform.machine().lower() in ("amd64", "x86_64"))
        need(C.sizeof(StartupEx) == 112 and C.sizeof(Process) == 24 and C.sizeof(ExtendedLimits) == 144)
        k = C.WinDLL("kernel32", use_last_error=True)
        signatures = {
            "CreateJobObjectW": ([P, C.c_wchar_p], P), "SetInformationJobObject": ([P, I32, P, U32], I32),
            "QueryInformationJobObject": ([P, I32, P, U32, P], I32), "GetHandleInformation": ([P, C.POINTER(U32)], I32),
            "InitializeProcThreadAttributeList": ([P, U32, U32, C.POINTER(C.c_size_t)], I32),
            "UpdateProcThreadAttribute": ([P, U32, C.c_size_t, P, C.c_size_t, P, P], I32),
            "DeleteProcThreadAttributeList": ([P], None),
            "CreateProcessW": ([C.c_wchar_p, C.c_wchar_p, P, P, I32, U32, P, C.c_wchar_p, P, P], I32),
            "IsProcessInJob": ([P, P, C.POINTER(I32)], I32), "ResumeThread": ([P], U32),
            "WaitForSingleObject": ([P, U32], U32), "TerminateJobObject": ([P, U32], I32), "CloseHandle": ([P], I32),
            "CreatePipe": ([C.POINTER(P), C.POINTER(P), P, U32], I32), "SetHandleInformation": ([P, U32, U32], I32),
            "CreateFileW": ([C.c_wchar_p, U32, U32, P, U32, U32, P], P),
            "ReadFile": ([P, P, U32, C.POINTER(U32), P], I32),
            "GetProcessTimes": ([P, P, P, P, P], I32),
            "QueryFullProcessImageNameW": ([P, U32, C.c_wchar_p, C.POINTER(U32)], I32),
        }
        self.functions = {}
        for name, (args, result) in signatures.items():
            function = getattr(k, name); function.argtypes, function.restype = args, result
            self.functions[name] = function
        self.error = C.get_last_error

    def invoke(self, name, args, record):
        value = self.functions[name](*args)
        record.update(value=value, value_returned=True)  # Before the error reader.
        return value, self.error()


class OriginalWorker:
    """One actual worker/Job owner. Unknown native calls retain all their buffers."""
    def __init__(self, boot, *, kernel=None, executable=None, worker_root=None, clock=time.monotonic):
        self.boot = capture_boot(boot)
        self.profile = self.boot["profile"]
        self.kernel = kernel  # Trusted private test seam; wire data cannot select it.
        self.invoke = kernel.invoke if kernel is not None else None
        self.clock, self.thread = clock, get_ident()
        self.executable = executable if executable is not None else sys.executable
        self.root = worker_root if worker_root is not None else Path(__file__).absolute().parent.parent
        self.handles, self.buffers, self.pending, self.readers = [], [], [], []
        self.lock = Lock(); self.unknown = False
        self.create_attempted = self.resume_attempted = self.stop_attempted = False
        self.attributes_initialized = self.attributes_delete_attempted = self.attributes_deleted = False
        self.phase = "bound"; self.started_at = self.clock()
        self.job = self.process = self.primary_thread = None
        self.stdout = self.stderr = None
        self.creation_identity = None

    def _main(self):
        need(get_ident() == self.thread)

    def call(self, name, *args, valid=lambda value: type(value) is int and value != 0, keep=()):
        row = {"name": name, "args": args, "keep": keep, "thread": get_ident(), "returned": False}
        with self.lock:
            self.pending.append(row)
        try:
            value, error = self.invoke(name, args, row)
            row.update(value=value, error=error, returned=True)
            need(type(error) is int and 0 <= error <= 0xffffffff and valid(value) is True)
            with self.lock:
                self.pending.remove(row)
            return value, error
        except BaseException:
            self.unknown = True; self.phase = "uncertain"
            raise LaunchUnavailable() from None

    def handle(self, role):
        handle = Handle(self, role); self.handles.append(handle); return handle

    def acknowledge(self, handle, value):
        need(handle.owner is self and handle in self.handles and not handle.known
             and type(value) is int and 0 < value < C.c_void_p(-1).value
             and all(h is handle or not h.known or h.closed or h.slot.value != value for h in self.handles))
        handle.slot.value = value; handle.known = True; return handle

    def number(self, handle):
        need(type(handle) is Handle and handle.owner is self and handle in self.handles and handle.known
             and not handle.close_attempted and not handle.closed)
        return handle.slot.value

    def close(self, handle):
        self._main(); value = self.number(handle); handle.close_attempted = True
        self.call("CloseHandle", value, keep=(handle, handle.slot)); handle.closed = True

    def limits(self):
        limits = ExtendedLimits(); self.buffers.append(limits)
        self.call("QueryInformationJobObject", self.number(self.job), 9, C.byref(limits), C.sizeof(limits), None, keep=(limits, self.job))
        need(limits.basic.flags == FLAGS and limits.basic.active_process_limit == self.profile["maximumActiveProcesses"]
             and limits.process_memory_limit == self.profile["processMemoryBytes"] and limits.job_memory_limit == self.profile["jobMemoryBytes"]
             and limits.basic.process_time == 0 and limits.basic.job_time == 0)

    def accounting(self):
        accounting = Accounting()
        self.call("QueryInformationJobObject", self.number(self.job), 1, C.byref(accounting), C.sizeof(accounting), None, keep=(accounting, self.job))
        need(accounting.active <= self.profile["maximumActiveProcesses"] and accounting.total >= accounting.active)
        return accounting

    def image(self, process):
        size = U32(32768); buffer = C.create_unicode_buffer(size.value)
        self.call("QueryFullProcessImageNameW", process, 0, buffer, C.byref(size), keep=(buffer, size))
        need(0 < size.value < 32768)
        return os.path.normcase(os.path.normpath(buffer.value))

    def prepare(self):
        self._main(); need(self.phase == "bound" and not self.create_attempted)
        self.phase = "preparing"
        if self.kernel is None:
            self.kernel = WindowsKernel(); self.invoke = self.kernel.invoke
        need(callable(self.invoke) and type(self.executable) is str and bool(self.executable))
        root = Path(self.root); entry = root / "main.py"
        # Fixed shipped paths only. This preflight is not Model/file custody.
        need(root.is_absolute() and root.is_dir() and not root.is_symlink() and entry.is_file() and not entry.is_symlink())
        need(not any(getattr(p.lstat(), "st_file_attributes", 0) & 0x400 for p in (root, entry)))
        self.root, self.entry = root, entry
        self.job = self.handle("job")
        value, _ = self.call("CreateJobObjectW", None, None, valid=lambda v: type(v) is int and 0 < v < C.c_void_p(-1).value, keep=(self.job,))
        self.acknowledge(self.job, value)
        inherit = U32(); self.call("GetHandleInformation", self.number(self.job), C.byref(inherit), keep=(inherit, self.job))
        need(inherit.value & 1 == 0)
        limits = ExtendedLimits(); limits.basic.flags = FLAGS; limits.basic.active_process_limit = self.profile["maximumActiveProcesses"]
        limits.process_memory_limit = self.profile["processMemoryBytes"]; limits.job_memory_limit = self.profile["jobMemoryBytes"]
        self.buffers.append(limits)
        self.call("SetInformationJobObject", self.number(self.job), 9, C.byref(limits), C.sizeof(limits), keep=(limits, self.job)); self.limits()
        security = Security(C.sizeof(Security), None, 1); self.buffers.append(security)
        stdin = self.handle("stdin")
        value, _ = self.call("CreateFileW", "NUL", 0x80000000, 3, C.byref(security), 3, 0, None,
                             valid=lambda v: type(v) is int and 0 < v < C.c_void_p(-1).value, keep=(security, stdin))
        self.acknowledge(stdin, value)
        writers = []
        for role in ("stdout", "stderr"):
            reader, writer = self.handle(role), self.handle(role + "-write")
            self.call("CreatePipe", C.byref(reader.slot), C.byref(writer.slot), C.byref(security), 0, keep=(reader, writer, security))
            self.acknowledge(reader, reader.slot.value); self.acknowledge(writer, writer.slot.value)
            self.call("SetHandleInformation", self.number(reader), 1, 0, keep=(reader,))
            setattr(self, role, reader); writers.append(writer)
        size = C.c_size_t()
        value, error = self.call("InitializeProcThreadAttributeList", None, 2, 0, C.byref(size),
                                 valid=lambda v: type(v) is int and v == 0, keep=(size,))
        need(error == 122 and 0 < size.value <= 65536)
        attributes = C.create_string_buffer(size.value); self.attributes = attributes; self.buffers.append(attributes)
        self.call("InitializeProcThreadAttributeList", attributes, 2, 0, C.byref(size), keep=(attributes, size)); self.attributes_initialized = True
        jobs = (P * 1)(self.number(self.job)); inherited = (P * 3)(self.number(stdin), *(self.number(h) for h in writers))
        self.buffers.extend((jobs, inherited))
        self.call("UpdateProcThreadAttribute", attributes, 0, JOB_LIST, jobs, C.sizeof(jobs), None, None, keep=(attributes, jobs))
        self.call("UpdateProcThreadAttribute", attributes, 0, HANDLE_LIST, inherited, C.sizeof(inherited), None, None, keep=(attributes, inherited))
        startup = StartupEx(); startup.startup.cb = C.sizeof(startup); startup.startup.flags = 0x100
        startup.startup.stdin, startup.startup.stdout, startup.startup.stderr = tuple(inherited); startup.attributes = C.cast(attributes, P)
        info = Process(); command = C.create_unicode_buffer(subprocess.list2cmdline([self.executable, "-I", "-B", "-u", str(entry)]))
        env = C.create_unicode_buffer("\0".join(k + "=" + v for k, v in sorted(self.boot["environment"].items(), key=lambda item: item[0].casefold())) + "\0\0")
        self.buffers.extend((startup, info, command, env))
        self.process, self.primary_thread = self.handle("process"), self.handle("thread")
        self.create_attempted = True
        self.call("CreateProcessW", self.executable, command, None, None, 1, CREATE_FLAGS, env, str(root), C.byref(startup), C.byref(info),
                  keep=(info, startup, command, env, self.process, self.primary_thread))
        self.acknowledge(self.process, info.process); self.acknowledge(self.primary_thread, info.thread)
        for handle in (stdin, *writers): self.close(handle)
        member = I32(); self.call("IsProcessInJob", self.number(self.process), self.number(self.job), C.byref(member), keep=(member, self.process, self.job)); need(member.value == 1)
        # A Windows venv launcher runs this controller in its base interpreter.
        # Its suspended child is still the exact selected venv executable, not
        # the controller's base image. Its descendants remain in this same Job.
        need(self.image(self.number(self.process)) == os.path.normcase(os.path.normpath(self.executable)))
        times = [FileTime() for _ in range(4)]; self.buffers.extend(times)
        self.call("GetProcessTimes", self.number(self.process), *(C.byref(value) for value in times), keep=tuple(times))
        self.creation_identity = (times[0].high << 32) | times[0].low; need(self.creation_identity > 0)
        self.limits(); accounting = self.accounting(); need(accounting.active == accounting.total == 1)
        self.phase = "suspended"

    def resume(self, admission=lambda: True):
        self._main(); need(self.phase == "suspended" and not self.resume_attempted and not self.unknown)
        current = admission; need(callable(current) and current() is True)
        need((self.clock() - self.started_at) * 1000 < self.profile["maximumDurationMs"])
        self.limits(); need(self.accounting().active == 1)
        need(current() is True and not self.unknown)
        need((self.clock() - self.started_at) * 1000 < self.profile["maximumDurationMs"])
        self.resume_attempted = True
        self.call("ResumeThread", self.number(self.primary_thread), valid=lambda v: type(v) is int and v == 1, keep=(self.primary_thread,))
        self.close(self.primary_thread); self.phase = "running"

    def worker_exited(self):
        self._main()
        if self.process is None or not self.process.known or self.process.close_attempted: return False
        value, _ = self.call("WaitForSingleObject", self.number(self.process), 0,
                             valid=lambda v: type(v) is int and v in (0, 258), keep=(self.process,))
        return value == 0

    def request_stop(self):
        self._main()
        if self.stop_attempted: return
        need(self.job is not None and self.job.known and not self.job.close_attempted)
        self.stop_attempted = True
        self.call("TerminateJobObject", self.number(self.job), 75, keep=(self.job,))
        self.phase = "retiring"

    def observe_retirement(self):
        self._main()
        if self.phase == "retired": return True
        if self.unknown or not self.stop_attempted or not self.worker_exited(): return False
        if self.accounting().active != 0 or any(thread.is_alive() for thread in self.readers): return False
        with self.lock:
            if self.pending or self.unknown: return False
        self.attributes_delete_attempted = True
        self.call("DeleteProcThreadAttributeList", self.attributes, valid=lambda v: v is None, keep=(self.attributes,))
        self.attributes_deleted = True
        for handle in reversed(self.handles):
            if not handle.closed: self.close(handle)
        need(not self.pending and not self.unknown and all(h.closed for h in self.handles))
        self.phase = "retired"; return True

    def start_readers(self, publish):
        self._main(); need(not self.readers and self.phase in ("suspended", "running"))
        def read(handle, lane):
            try:
                while True:
                    buffer = C.create_string_buffer(CHUNK_BYTES); size = U32()
                    value, error = self.call("ReadFile", self.number(handle), buffer, CHUNK_BYTES, C.byref(size), None,
                                             valid=lambda v: type(v) is int and v in (0, 1), keep=(handle, buffer, size))
                    need(size.value <= CHUNK_BYTES)
                    if value == 0:
                        need(error == 109); return
                    if size.value == 0: return
                    publish(lane, bytes(buffer.raw[:size.value]))
            except BaseException:
                self.unknown = True
        for lane in ("stdout", "stderr"):
            thread = Thread(target=read, args=(getattr(self, lane), lane), daemon=True)
            self.readers.append(thread); thread.start()


def serve(stdin, stdout, *, owner_factory=OriginalWorker):
    """Closed private protocol. Worker bytes never become controller commands."""
    boot = capture_boot(parse_frame(stdin.readline(FRAME_BYTES + 1)))
    nonce, digest = boot["nonce"], boot["profileDigest"]
    owner = owner_factory(boot)
    commands, output = Queue(maxsize=8), Queue(maxsize=8)
    overflow, input_ended, stop_received = Event(), Event(), Event()
    output_total = 0
    def frame(kind, **fields):
        payload = json.dumps({"schema": "windows-original-worker-control-v1", "nonce": nonce, "profileDigest": digest,
                              "kind": kind, **fields}, separators=(",", ":"))
        need(len(payload.encode("utf8")) <= FRAME_BYTES)
        stdout.write(payload.encode("utf8") + b"\n"); stdout.flush()
    def read_commands():
        try:
            for _ in range(4):  # resume and stop, with bounded malformed attempts
                data = stdin.readline(FRAME_BYTES + 1)
                if not data: return
                value = exact(parse_frame(data), ("schema", "nonce", "profileDigest", "action"))
                need(value["schema"] == "windows-original-worker-command-v1" and value["nonce"] == nonce
                     and value["profileDigest"] == digest and value["action"] in ("resume", "stop"))
                if value["action"] == "stop": stop_received.set()
                commands.put_nowait(value["action"])
        except BaseException:
            overflow.set()
        finally:
            input_ended.set()
    def publish(lane, data):
        nonlocal output_total
        with owner.lock:
            output_total += len(data)
            if output_total > OUTPUT_BYTES: overflow.set(); return
        try: output.put_nowait((lane, data))
        except Full: overflow.set()
    def drain_output():
        import base64
        try:
            while True:
                lane, data = output.get_nowait()
                frame("worker-output", lane=lane, data=base64.b64encode(data).decode("ascii"))
        except Empty:
            pass
    try:
        owner.prepare(); owner.start_readers(publish)
        frame("suspended")
        Thread(target=read_commands, daemon=True).start()
        uncertain_reported = False
        while True:
            drain_output()
            expired = (owner.clock() - owner.started_at) * 1000 >= owner.profile["maximumDurationMs"]
            if stop_received.is_set() or input_ended.is_set() or overflow.is_set() or expired or owner.worker_exited():
                owner.request_stop()
            elif not owner.stop_attempted:
                try:
                    action = commands.get_nowait()
                    if action == "resume":
                        owner.resume(lambda: not stop_received.is_set() and not input_ended.is_set() and not overflow.is_set())
                        frame("running")
                    else: owner.request_stop()
                except Empty: pass
            if owner.unknown and not uncertain_reported:
                frame("uncertain"); uncertain_reported = True
            if owner.observe_retirement():
                # Native retirement joins the reader lifetime. Drain the stable
                # final queue before announcing retirement or losing its output.
                drain_output()
                frame("retired"); return 0
            time.sleep(0.025)
    except BaseException:
        # Retain the original owner and all unknown native buffers. Never claim
        # original worker retirement because the controller itself is exiting.
        owner.unknown = True
        try:
            if owner.job is not None and owner.job.known and not owner.job.close_attempted:
                owner.request_stop()  # One stop of this owned Job, never a PID.
        except BaseException:
            pass
        try: frame("uncertain")
        except BaseException: pass
        while True:
            time.sleep(1)


def main():
    try:
        return serve(sys.stdin.buffer, sys.stdout.buffer)
    except BaseException:
        # No raw exception, command, path or environment reaches public sinks.
        return 75


if __name__ == "__main__":
    raise SystemExit(main())
