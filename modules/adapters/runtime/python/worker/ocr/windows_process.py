"""One fixed, private, bounded OCR exchange; no generic process runner API."""
from __future__ import annotations
import ctypes as c
import subprocess
import threading
import time
from .protocol import MAX_RESULT_BYTES, OcrCancelled
from .wire import MAX_REQUEST_BYTES
from .resource import open_resource, _UNCERTAIN_RESOURCES
from .windows_api import (
    Accounting, CompletionAssociation, Limits, NativeFailure, Process, Security,
    StartupEx, Windows, need,
)

MEMORY_BYTES = 512 * 1024**2
DEADLINE_SECONDS = 120
STDERR_BYTES = 64 * 1024
_LIMIT_FLAGS = 0x2000 | 0x100 | 0x200 | 0x8
_FORCED_EXIT = 0xE0000043
_COMPLETION_KEY = 0x4F435231
_GATE = threading.Lock()
_PENDING = {}


class OcrProcessError(RuntimeError):
    """Fixed user-safe message; internal journals contain no source/OS errors."""


class _Owner:
    def __init__(self, native):
        self.n = native
        self.handles = {}
        self.resource = None
        self.process = None
        self.threads = []
        self.output = bytearray()
        self.observed = {"stdout": 0, "stderr": 0, "stdin": 0}
        self.pipe_error = threading.Event()
        self.overflow = threading.Event()
        self.close_failed = False
        self.prepared = self.resumed = self.forced = False
        self.limit_messages = []
        self.event_count = 0
        self.observation = None

    def hold(self, name, handle):
        need(name not in self.handles and handle and handle != c.c_void_p(-1).value, "handle-create")
        self.handles[name] = handle
        return handle

    def close(self, name):
        handle = self.handles.get(name)
        if handle:
            try:
                acknowledged = bool(self.n.k.CloseHandle(handle))
            except BaseException:
                acknowledged = False
            if not acknowledged:
                self.close_failed = True
                _PENDING[id(self)] = self
                return False
            del self.handles[name]
        return True

    def limits(self):
        value = Limits()
        need(self.n.k.QueryInformationJobObject(self.handles["job"], 9, c.byref(value),
                                               c.sizeof(value), None), "limits-readback")
        need(value.basic.flags == _LIMIT_FLAGS and value.basic.active_limit == 1 and
             value.process_memory == MEMORY_BYTES and value.job_memory == MEMORY_BYTES,
             "limits-drift")
        return value

    def accounting(self):
        value = Accounting()
        need(self.n.k.QueryInformationJobObject(self.handles["job"], 1, c.byref(value),
                                               c.sizeof(value), None), "accounting-readback")
        need(value.active <= 1 and value.total >= value.active, "accounting-count")
        return {"total": value.total, "active": value.active, "terminated": value.terminated}

    def events(self):
        for _ in range(128):
            message, key, detail = c.c_uint32(), c.c_size_t(), c.c_void_p()
            ok = self.n.k.GetQueuedCompletionStatus(self.handles["completion"], c.byref(message),
                                                    c.byref(key), c.byref(detail), 0)
            if not ok:
                need(c.get_last_error() == 258 and not detail.value, "completion-readback")
                break
            need(key.value == _COMPLETION_KEY, "completion-key")
            self.event_count += 1
            need(self.event_count <= 4096, "completion-overflow")
            if message.value in (3, 9, 10):
                self.limit_messages.append(message.value)

    def pipe(self, name, child_reads):
        security = Security(c.sizeof(Security), None, True)
        read, write = c.c_void_p(), c.c_void_p()
        ok = self.n.k.CreatePipe(c.byref(read), c.byref(write), c.byref(security), 65536)
        if read.value:
            self.hold(name + "-read", read.value)
        if write.value:
            self.hold(name + "-write", write.value)
        need(ok and read.value and write.value, "pipe-create")
        parent, child = (write.value, read.value) if child_reads else (read.value, write.value)
        need(self.n.k.SetHandleInformation(parent, 1, 0) and
             not self.n.inheritable(parent) and self.n.inheritable(child), "pipe-inherit")
        return child

    def prepare(self, frame):
        need(not self.prepared and not self.handles and not _PENDING, "prepare-reentry")
        self.prepared = True
        self.resource = open_resource(self.n)
        k = self.n.k
        job = self.hold("job", k.CreateJobObjectW(None, None))
        need(not self.n.inheritable(job), "job-inherit")
        value = Limits()
        value.basic.flags, value.basic.active_limit = _LIMIT_FLAGS, 1
        value.process_memory = value.job_memory = MEMORY_BYTES
        need(k.SetInformationJobObject(job, 9, c.byref(value), c.sizeof(value)), "limits-set")
        self.limits()
        completion = self.hold("completion", k.CreateIoCompletionPort(c.c_void_p(-1).value, None, 0, 1))
        need(not self.n.inheritable(completion), "completion-inherit")
        association = CompletionAssociation(_COMPLETION_KEY, completion)
        need(k.SetInformationJobObject(job, 7, c.byref(association), c.sizeof(association)),
             "completion-association")
        stdin = self.pipe("stdin", True)
        stdout, stderr = self.pipe("stdout", False), self.pipe("stderr", False)
        size = c.c_size_t()
        need(not k.InitializeProcThreadAttributeList(None, 2, 0, c.byref(size)) and
             c.get_last_error() == 122 and 0 < size.value <= 65536, "attribute-size")
        storage = c.create_string_buffer(size.value)
        need(k.InitializeProcThreadAttributeList(storage, 2, 0, c.byref(size)), "attribute-init")
        try:
            jobs, inherited = (c.c_void_p * 1)(job), (c.c_void_p * 3)(stdin, stdout, stderr)
            need(k.UpdateProcThreadAttribute(storage, 0, 0x2000D, c.byref(jobs), c.sizeof(jobs),
                                             None, None), "attribute-job-list")
            need(k.UpdateProcThreadAttribute(storage, 0, 0x20002, c.byref(inherited),
                                             c.sizeof(inherited), None, None), "attribute-handle-list")
            startup = StartupEx()
            startup.startup.cb, startup.startup.flags = c.sizeof(startup), 0x100
            startup.startup.stdin, startup.startup.stdout, startup.startup.stderr = stdin, stdout, stderr
            startup.attributes = c.cast(storage, c.c_void_p)
            environment = c.create_unicode_buffer("\0".join(
                key + "=" + value for key, value in sorted(self.n.environment().items())) + "\0")
            executable = str(self.resource.executable)
            command = c.create_unicode_buffer(subprocess.list2cmdline([executable]))
            process = Process()
            created = k.CreateProcessW(executable, command, None, None, True,
                                       0x80000 | 0x4 | 0x400 | 0x8, environment,
                                       str(self.resource.executable.parent), c.byref(startup), c.byref(process))
            if process.process:
                self.process = self.hold("root", process.process)
            if process.thread:
                self.hold("thread", process.thread)
            need(created and self.process and process.thread, "atomic-process-create")
            need(not self.n.inheritable(self.process) and not self.n.inheritable(process.thread) and
                 self.n.member(self.process, job), "atomic-membership")
        finally:
            k.DeleteProcThreadAttributeList(storage)
        need(all([self.close(name) for name in ("stdin-read", "stdout-write", "stderr-write")]),
             "parent-child-handle-close")
        for operation, arguments in ((self.read, ("stdout",)), (self.read, ("stderr",)),
                                      (self.write, (frame,))):
            thread = threading.Thread(target=operation, args=arguments, daemon=True)
            self.threads.append(thread)
            thread.start()
        need(self.accounting()["active"] == 1 and self.n.member(self.process, job), "suspended-root")
        self.limits()
        need(not _PENDING and k.ResumeThread(self.handles["thread"]) == 1, "resume")
        self.resumed = True
        need(self.close("thread"), "thread-close")

    def read(self, name):
        try:
            buffer = c.create_string_buffer(65536)
            while True:
                count = c.c_uint32()
                if not self.n.k.ReadFile(self.handles[name + "-read"], buffer, len(buffer),
                                         c.byref(count), None):
                    need(c.get_last_error() == 109, "pipe-read")
                    break
                if not count.value:
                    break
                self.observed[name] += count.value
                if name == "stdout":
                    remaining = MAX_RESULT_BYTES + 4 - len(self.output)
                    self.output.extend(buffer.raw[:min(count.value, remaining)])
                    if self.observed[name] > MAX_RESULT_BYTES + 4:
                        self.overflow.set()
                elif self.observed[name] > STDERR_BYTES:
                    self.overflow.set()
                # stderr is counted and discarded, never saved or returned.
        except BaseException:
            self.pipe_error.set()

    def write(self, frame):
        try:
            handle = self.handles["stdin-write"]
            offset = 0
            while offset < len(frame):
                data = frame[offset:offset + 65536]
                count = c.c_uint32()
                need(self.n.k.WriteFile(handle, data, len(data), c.byref(count), None) and
                     0 < count.value <= len(data), "pipe-write")
                offset += count.value
            self.observed["stdin"] = offset
        except BaseException:
            self.pipe_error.set()
        finally:
            if not self.close("stdin-write"):
                self.pipe_error.set()

    def finish(self, reason):
        if self.observation is not None:
            return self.observation
        confirmed, account, exit_code, peak = False, None, None, None
        phase, failure_phase = "job-limits", None
        try:
            if "job" in self.handles:
                self.limits()
                phase = "job-stop-and-active-zero"
                if self.accounting()["active"]:
                    need(self.n.k.TerminateJobObject(self.handles["job"], _FORCED_EXIT), "job-terminate")
                    self.forced = True
                deadline = time.monotonic() + 10
                while self.accounting()["active"]:
                    need(time.monotonic() < deadline, "job-exit-timeout")
                    time.sleep(.01)
                account = self.accounting()
                if self.process:
                    # Job active-zero can precede process-handle signalling.
                    # Termination initiates exit; it is not an exit acknowledgement.
                    phase = "root-native-exit"
                    exit_code = self.n.exit_code(self.process, 1000)
                else:
                    need(account["total"] == 0, "unconfirmed-root")
                phase = "job-completion-and-limits"
                self.events()
                value = self.limits()
                peak = {"process": value.peak_process, "job": value.peak_job}
            # Close child-only handles even when launch/attribute setup failed.
            for name in ("stdin-read", "stdout-write", "stderr-write"):
                self.close(name)
            phase = "pipe-retirement"
            for thread in self.threads:
                thread.join(timeout=3)
            need(all(not thread.is_alive() for thread in self.threads), "pipe-retirement")
            confirmed = True
        except BaseException:
            reason = "cleanup-unconfirmed"
            failure_phase = phase
        if confirmed:
            for name in tuple(self.handles):
                self.close(name)
            if self.resource:
                try:
                    if not self.resource.close():
                        self.close_failed = True
                except BaseException:
                    self.close_failed = True
        confirmed = confirmed and not self.handles and not self.close_failed and not _UNCERTAIN_RESOURCES
        if not confirmed:
            _PENDING[id(self)] = self
            reason = "cleanup-unconfirmed"
            failure_phase = failure_phase or "handle-retirement"
        self.observation = {
            "reason": reason, "failure_phase": failure_phase,
            "root_exit_code": exit_code, "accounting": account,
            "cleanup_confirmed": confirmed, "all_handles_closed": confirmed,
            "assigned_at_creation": self.process is not None,
            "resumed_after_membership": self.resumed, "forced": self.forced,
            "limits": {"process_bytes": MEMORY_BYTES, "job_bytes": MEMORY_BYTES, "members": 1},
            "peak_commit": peak, "stdio_handles_inherited": 3 if self.process else 0,
            "observed_bytes": dict(self.observed), "limit_messages": list(self.limit_messages),
            "overflow": self.overflow.is_set(), "pipe_error": self.pipe_error.is_set(),
        }
        return self.observation

    def run(self, frame, cancelled):
        reason, normal = None, False
        deadline = time.monotonic() + DEADLINE_SECONDS
        try:
            need(not cancelled(), "cancelled")
            self.prepare(frame)
            while True:
                self.events()
                if cancelled():
                    reason = "cancelled"
                    break
                if time.monotonic() >= deadline:
                    reason = "timeout"
                    break
                if self.overflow.is_set() or self.pipe_error.is_set() or self.limit_messages:
                    reason = "bounded-io-or-limit-failure"
                    break
                wait = self.n.k.WaitForSingleObject(self.process, 20)
                need(wait in (0, 258), "root-wait")
                if wait == 0:
                    normal = True
                    break
        except BaseException as error:
            reason = "cancelled" if type(error) is NativeFailure and str(error) == "cancelled" else "native-failure"
        observation = self.finish(reason)
        observation["passed"] = (normal and observation["reason"] is None and
            observation["root_exit_code"] == 0 and observation["cleanup_confirmed"] and
            not observation["forced"] and not observation["overflow"] and
            not observation["pipe_error"] and not observation["limit_messages"] and
            self.observed["stderr"] == 0 and self.observed["stdin"] == len(frame))
        return bytes(self.output), observation


def _execute(frame, cancelled):
    need(type(frame) is bytes and 4 < len(frame) <= MAX_REQUEST_BYTES + 4 and
         callable(cancelled), "invalid-exchange")
    need(_GATE.acquire(blocking=False), "ocr-busy")
    try:
        need(not _PENDING and not _UNCERTAIN_RESOURCES, "uncertain-ocr-ownership")
        owner = _Owner(Windows())
        return owner.run(frame, cancelled)
    finally:
        _GATE.release()


def exchange(frame: bytes, cancelled) -> bytes:
    """Internal provider transport. Never return an unretired/partial result."""
    try:
        result, observation = _execute(frame, cancelled)
        if observation["cleanup_confirmed"] and observation["reason"] == "cancelled":
            raise OcrCancelled("Text recognition was cancelled.")
        need(observation["passed"], "ocr-exchange-failed")
        return result
    except (NativeFailure, OSError):
        raise OcrProcessError("Local text recognition is unavailable or did not finish safely.") from None
