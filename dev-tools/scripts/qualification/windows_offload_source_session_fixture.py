"""Fixed Source-session qualification support. Import performs no effects.

The parent watchdog holds the actual process returned by the fixed launcher.
Ready/dispatch JSON is data; it does not prove that watchdog or Native authority.
Unknown outcomes remain failed evidence and grant no cleanup or staging credit.
"""
import os
import hashlib
import json
from pathlib import Path
import stat
import subprocess
import sys
from threading import Event, RLock, Thread
import time
import types
import uuid

_BUDGET_NS = 120 * 10**9
_TERMINAL_OBSERVATION_MS = 2000
_POPEN_TYPE = subprocess.Popen
ROOT = Path(__file__).absolute().parents[3]
ENTRY = Path(__file__).absolute().with_name('qualify_windows_offload_source_session.py')
RUNS = ROOT / '.local-codex/windows-offload-source-session-native-v1'
_ENTRY_TOKEN = object()
_NATIVE_ENTRY = None
_CONTROL_OWNERS = []
_COLLECTION_OWNERS = []


class SourceSessionFixtureError(RuntimeError):
    def __init__(self, stage):
        allowed = ('entry', 'fence-owner', 'fence-start', 'fence-dispatch',
                   'fence-wait', 'fence-termination', 'fence-exit')
        self.stage = stage if type(stage) is str and stage in allowed else 'entry'
        super().__init__('The isolated Source-session check did not complete.')


def _need(value, stage):
    if not value:
        raise SourceSessionFixtureError(stage)


def _entry_environment():
    _need(__name__ == '_standalone_source_session_qualification'
          and _NATIVE_ENTRY is _ENTRY_TOKEN and os.name == 'nt'
          and sys.flags.isolated == sys.flags.no_site == 1 and sys.dont_write_bytecode
          and sys.prefix == sys.base_prefix and len(sys.argv) == 2
          and Path(sys.argv[0]).absolute() == ENTRY
          and sys.argv[1] in ('--native', '--native-shared-write-denial'), 'entry')
    return 'shared-write-map-denial' if sys.argv[1] == '--native-shared-write-denial' else None


class _ParentFenceApi:
    """Use the retained Windows handle, never a later PID lookup or pathname."""
    def __init__(self):
        _entry_environment()
        _need(os.name == 'nt', 'entry')
        import _winapi
        self.wait = _winapi.WaitForSingleObject
        self.terminate = _winapi.TerminateProcess
        self.exit_code = _winapi.GetExitCodeProcess


class _OriginalDispatchEvent:
    """One unnamed creator-owned event; no serialized signal grants admission."""
    def __init__(self):
        _entry_environment()
        import ctypes as C
        _need(type(self) is _OriginalDispatchEvent and not _CONTROL_OWNERS
              and not hasattr(self, '_OriginalDispatchEvent__origin'), 'entry')
        _CONTROL_OWNERS.append(self)  # Retain partial output before acquisition.
        self.__origin = self
        self.k = C.WinDLL('kernel32.dll', use_last_error=True, winmode=0x800)
        ptr, u32, i32 = C.c_void_p, C.c_uint32, C.c_int32
        for name, args, result in (
                ('CreateEventW', (ptr, i32, i32, C.c_wchar_p), ptr),
                ('SetHandleInformation', (ptr, u32, u32), i32),
                ('GetHandleInformation', (ptr, C.POINTER(u32)), i32),
                ('SetEvent', (ptr,), i32), ('CloseHandle', (ptr,), i32)):
            function = getattr(self.k, name)
            function.argtypes, function.restype = list(args), result
        self.handle = None
        self.signal_started = self.close_started = self.closed = False
        value = self.k.CreateEventW(None, 1, 0, None)
        _need(type(value) is int and 0 < value < C.c_void_p(-1).value, 'entry')
        self.handle = value
        self.functions = tuple((getattr(self.k, name), tuple(args), result) for name, args, result in (
            ('SetEvent', (ptr,), i32), ('CloseHandle', (ptr,), i32)))
        self.original = (self.k, value, self.functions)
        _need(self.k.SetHandleInformation(value, 1, 1) != 0, 'entry')
        flags = u32()
        _need(self.k.GetHandleInformation(value, C.byref(flags)) != 0 and flags.value & 1 == 1, 'entry')

    def _assert_original(self):
        _need(type(self) is _OriginalDispatchEvent and self.__origin is self
              and _CONTROL_OWNERS == [self]
              and type(self.original) is tuple and len(self.original) == 3
              and self.k is self.original[0] and self.handle == self.original[1]
              and self.functions is self.original[2]
              and all(tuple(fn.argtypes) == args and fn.restype is result
                      for fn, args, result in self.functions)
              and self.k.SetEvent is self.functions[0][0] and self.k.CloseHandle is self.functions[1][0]
              and not self.close_started and not self.closed, 'entry')

    def signal(self, fence):
        self._assert_original()
        _need(type(fence) is _OriginalParentFence and not self.signal_started, 'fence-dispatch')
        fence.assert_dispatch_allowed()
        self.signal_started = True
        _need(self.k.SetEvent(self.original[1]) != 0, 'fence-dispatch')

    def close_after_exit(self, fence):
        self._assert_original()
        _need(type(fence) is _OriginalParentFence, 'fence-exit')
        fence._assert_original()
        known = fence._bound_facts[9]()
        _need(fence.exit_observed and type(known) is tuple and len(known) == 5
              and known[0] == fence.number
              and fence.thread is fence.thread_origin and not fence.thread.is_alive(), 'fence-exit')
        self.close_started = True
        _need(self.k.CloseHandle(self.original[1]) != 0, 'fence-exit')
        self.closed = True


class _OriginalParentFence:
    """One original wait/termination frontier; no process or deadline renewal."""
    def __init__(self, process, deadline):
        _entry_environment()
        _need(type(process) is _POPEN_TYPE and type(process.pid) is int and process.pid > 0
              and type(deadline) is int and 0 < deadline - time.monotonic_ns() <= _BUDGET_NS,
              'fence-owner')
        handle = process._handle
        number = int(handle)
        _need(type(number) is int and number > 0, 'fence-owner')
        self.__origin = self
        self.process, self.handle, self.number = process, handle, number
        self.deadline = deadline
        api = _ParentFenceApi()
        self.functions = (api.wait, api.terminate, api.exit_code)
        self.lock, self.armed = RLock(), Event()
        gate = self.lock
        terminate = self.functions[1]
        used = False
        known_exit = None

        def abort_original():
            nonlocal used
            with gate:
                if used:
                    return
                used = True
                self.kill_started = True
            terminate(number, 9)

        def abort_used():
            with gate:
                return used

        def retain_exit(observed_number, code, wait_at, observed_at):
            nonlocal known_exit
            with gate:
                _need(known_exit is None and observed_number == number
                      and type(code) is int and 0 <= code <= 0xffffffff and code != 259,
                      'fence-exit')
                _need(type(wait_at) is int and type(observed_at) is int
                      and 0 < wait_at <= observed_at, 'fence-exit')
                on_time = observed_at <= deadline
                known_exit = (number, code, wait_at, observed_at, on_time)
                return on_time

        def read_exit():
            with gate:
                return known_exit

        self.original = self._bound_facts = (process, handle, number, process.pid,
                                             deadline, self.functions, abort_original, abort_used,
                                             retain_exit, read_exit)
        self.thread = self.thread_origin = None
        self.wait_intent = self.wait_origin = None
        self.phase = 'new'
        self.kill_started = self.expired = self.failed = self.exit_observed = False
        self.code = None

    def _assert_original(self):
        _need(type(self) is _OriginalParentFence and self.__origin is self
              and self.original is self._bound_facts
              and type(self.original) is tuple and len(self.original) == 10
              and self.process is self.original[0] and self.handle is self.original[1]
              and self.number == self.original[2] and self.deadline == self.original[4]
              and self.functions is self.original[5]
              and self.process.pid == self.original[3]
              and self.process._handle is self.handle and int(self.handle) == self.number,
              'fence-owner')

    def arm(self):
        with self.lock:
            self._assert_original()
            _need(self.phase == 'new' and self.thread is None, 'fence-start')
            self.thread = self.thread_origin = Thread(target=self._watch, args=(self._bound_facts,), daemon=True,
                                                       name='source-parent-watchdog')
            self.phase = 'starting'
            self.thread.start()
        _need(self.armed.wait(2), 'fence-start')
        self.assert_dispatch_allowed()

    def assert_dispatch_allowed(self):
        with self.lock:
            self._assert_original()
            _need(self.thread is self.thread_origin and self.thread is not None
                  and self.thread.is_alive() and self.phase == 'waiting'
                  and not self.failed and not self.expired and not self.kill_started
                  and not self._bound_facts[7]()
                  and self._bound_facts[9]() is None
                  and self.wait_intent is self.wait_origin
                  and type(self.wait_intent) is tuple and len(self.wait_intent) == 4
                  and self.wait_intent[0] is self.functions[0]
                  and self.wait_intent[1] == self.number
                  and type(self.wait_intent[2]) is int and 0 < self.wait_intent[2] <= 120000
                  and self.wait_intent[3] == self.deadline
                  and time.monotonic_ns() < self.deadline,
                  'fence-dispatch')

    def _terminate_original_once(self):
        self._assert_original()
        self._bound_facts[6]()

    def _observe_exit(self, wait, number, timeout, exit_code, retain_exit):
        result = wait(number, timeout)
        wait_at = time.monotonic_ns()
        _need(type(result) is int and result in (0, 258), 'fence-wait')
        if result == 0:
            code = exit_code(number)
            observed_at = time.monotonic_ns()
            _need(type(code) is int and 0 <= code <= 0xffffffff and code != 259, 'fence-exit')
            on_time = retain_exit(number, code, wait_at, observed_at)
            with self.lock:
                self.code, self.exit_observed = code, True
                self.expired = self.expired or not on_time
        return result

    def _watch(self, bound):
        # Capture immutable call inputs before committing the original wait.
        wait, terminate, exit_code = bound[5]
        number, deadline, abort = bound[2], bound[4], bound[6]
        retain_exit = bound[8]
        try:
            with self.lock:
                self._assert_original()
                remaining = deadline - time.monotonic_ns()
                _need(0 < remaining <= _BUDGET_NS, 'fence-start')
                timeout = max(1, (remaining + 999999) // 1000000)
                self.wait_intent = self.wait_origin = (wait, number, timeout, deadline)
                self.phase = 'waiting'
                self.armed.set()
            observed = self._observe_exit(wait, number, timeout, exit_code, retain_exit)
            if observed == 258:
                _need(time.monotonic_ns() >= deadline, 'fence-wait')
                with self.lock:
                    self.expired = True
                    self.phase = 'expired'
                abort()
                # This only observes an aborted process. It extends no healthy
                # lifetime and can never produce a passing qualification.
                self._observe_exit(wait, number, _TERMINAL_OBSERVATION_MS, exit_code, retain_exit)
            with self.lock:
                if not self.exit_observed:
                    self.failed = True
                self.phase = 'observed' if self.exit_observed else 'unconfirmed'
        except BaseException:
            with self.lock:
                self.failed = True
                self.phase = 'failed'
                self.armed.set()
            try:
                abort()
            except BaseException:
                pass

    def join_observed(self):
        _need(self.thread is self.thread_origin and self.thread is not None, 'fence-exit')
        self.thread.join(2)
        with self.lock:
            self._assert_original()
            known = self._bound_facts[9]()
            _need(not self.thread.is_alive() and self.exit_observed
                  and self.phase == 'observed' and not self.failed and not self.expired
                  and not self.kill_started and not self._bound_facts[7]()
                  and type(known) is tuple and len(known) == 5
                  and known[0] == self.original[2] and known[1] == 0
                  and known[4] is True and known[2] <= known[3] <= self.original[4]
                  and type(self.code) is int and self.code == 0, 'fence-exit')
            return None


def _regular_bytes(path, maximum):
    info = path.lstat()
    _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
          and not path.is_symlink() and not getattr(info, 'st_file_attributes', 0) & 0x400
          and 0 < info.st_size <= maximum, 'entry')
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
    with path.open('rb') as stream:
        _need(identity(os.fstat(stream.fileno())) == identity(info), 'entry')
        raw = stream.read(maximum + 1)
        _need(identity(os.fstat(stream.fileno())) == identity(info), 'entry')
    _need(len(raw) == info.st_size and identity(path.lstat()) == identity(info), 'entry')
    return raw


def _load_runtime_sources():
    """Load exact checked buffers into an inert, non-actor package."""
    folder = ROOT / 'modules/adapters/runtime/python/worker/tasks'
    names = ('local_model_offload.py', 'offload_recovery.py', 'windows_offload_core.py',
             'windows_offload_backend.py', 'windows_offload_source_ledger.py',
             'windows_offload_native_session.py', 'windows_offload_execution.py',
             'windows_offload_sources.py', 'windows_offload_source_session.py',
             'windows_offload_source_session_child.py')
    values = {name: _regular_bytes(folder / name, 2 * 1024**2) for name in names}
    hashes = {name: hashlib.sha256(raw).hexdigest() for name, raw in values.items()}
    package = types.ModuleType('_aisb_source_qualification_inputs')
    _need(package.__name__ not in sys.modules, 'entry')
    package.__path__ = [str(folder)]
    sys.modules[package.__name__] = package
    for name in names:
        module = types.ModuleType(package.__name__ + '.' + name[:-3])
        module.__package__, module.__file__ = package.__name__, str(folder / name)
        sys.modules[module.__name__] = module
        exec(compile(values[name], module.__file__, 'exec', dont_inherit=True), module.__dict__)
    _need(all(hashlib.sha256(_regular_bytes(folder / name, 2 * 1024**2)).hexdigest() == hashes[name]
              for name in names), 'entry')
    source = sys.modules[package.__name__ + '.windows_offload_source_session']
    _need(tuple(source._SOURCE_NAMES) == names, 'entry')
    return source, folder, hashes


def _synthetic_source_inputs(run_root):
    """Create four tiny fixed files. Only the child constructs an inventory."""
    root = run_root / 'inputs'
    root.mkdir()
    config = {'model_type': 'qwen2', 'hidden_size': 8, 'intermediate_size': 16,
              'num_hidden_layers': 2, 'num_attention_heads': 2, 'num_key_value_heads': 1,
              'vocab_size': 32, 'max_position_embeddings': 4096}
    tokenizer = {'model': {'type': 'BPE', 'vocab': {'a': 0}, 'merges': []}}
    header = json.dumps({'layer.weight': {'dtype': 'F32', 'shape': [2],
                                        'data_offsets': [0, 8]}}, separators=(',', ':')).encode()
    payloads = {'config.json': json.dumps(config, separators=(',', ':')).encode(),
                'tokenizer.json': json.dumps(tokenizer, separators=(',', ':')).encode(),
                'tokenizer_config.json': b'{}',
                'model.safetensors': len(header).to_bytes(8, 'little') + header + b'\0' * 8}
    manifest = {}
    for name, raw in payloads.items():
        with (root / name).open('xb') as stream:
            _need(stream.write(raw) == len(raw), 'entry')
        info = (root / name).lstat()
        manifest[name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                          'identity': (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)}
    return manifest


class _StreamCapture:
    """Bounded diagnostic bytes; raw stream text is never written to evidence."""
    def __init__(self, stream, abort):
        self.stream, self.abort = stream, abort
        self.data = bytearray()
        self.bytes = 0
        self.digest = hashlib.sha256()
        self.overflow = self.failed = False
        self.start_attempted = self.started = False
        self.thread = Thread(target=self._read, daemon=True, name='source-parent-output')
    def start(self):
        _need(not self.start_attempted, 'fence-start')
        self.start_attempted = True
        try:
            self.thread.start()
            self.started = True
        except BaseException:
            self.failed = True
            raise

    def _read(self):
        try:
            while block := self.stream.read(65536):
                self.bytes += len(block)
                self.digest.update(block)
                if self.bytes > 65536:
                    self.overflow = True
                    self.abort()
                    return
                self.data.extend(block)
        except BaseException:
            self.failed = True
            try:self.abort()
            except BaseException:pass

    def join(self):
        _need(self.started, 'fence-exit')
        self.thread.join(2)
        _need(not self.thread.is_alive() and not self.overflow and not self.failed, 'fence-exit')


def _json_object(raw):
    _need(type(raw) is bytes and 0 < len(raw) <= 4096, 'entry')
    def pairs(rows):
        result = {}
        for key, value in rows:
            _need(key not in result, 'entry')
            result[key] = value
        return result
    def bad(_value):raise SourceSessionFixtureError('entry')
    value = json.loads(raw.decode('utf8'), object_pairs_hook=pairs, parse_constant=bad)
    _need(type(value) is dict, 'entry')
    return value


def _validate_parent_report(value, digest):
    true_fields = ('child_exit_confirmed', 'job_active_zero', 'source_retired',
                   'original_handles_closed', 'timer_callbacks_retired')
    false_fields = ('model_started', 'borrower_started', 'production_composed', 'parent_qualification_granted')
    _need(value.keys() == {'schema_version', 'status', 'source_digest', 'native_calls',
                           'terminal_calls', *true_fields, *false_fields}
          and value['schema_version'] == 'owned-source-parent-result-v1' and value['status'] == 'passed'
          and value['source_digest'] == digest
          and type(value['native_calls']) is int and 0 < value['native_calls'] <= 16384
          and type(value['terminal_calls']) is int and 0 < value['terminal_calls'] <= 64
          and all(value[name] is True for name in true_fields)
          and all(value[name] is False for name in false_fields), 'fence-exit')
    return dict(value)


def _validate_denial_report(value, digest, manifest, source):
    """Exact observations only; original process/Job retirement is separate."""
    true_fields = ('child_exit_confirmed', 'job_active_zero', 'source_released_by_owned_exit',
                   'original_handles_closed', 'timer_callbacks_retired')
    false_fields = ('source_retired_unused', 'model_started', 'borrower_started',
                    'production_composed', 'parent_qualification_granted')
    _need(type(value) is dict and value.keys() == {
        'schema_version', 'status', 'source_digest', 'denial', 'mapping',
        'native_calls', 'terminal_calls', 'child_exit_code', *true_fields, *false_fields}
        and value['schema_version'] == 'owned-source-parent-denial-v1'
        and value['status'] == 'denied' and value['source_digest'] == digest
        and type(value['child_exit_code']) is int and value['child_exit_code'] == 9
        and type(value['native_calls']) is int and 0 < value['native_calls'] <= 1024 + 61
        and type(value['terminal_calls']) is int and 0 < value['terminal_calls'] <= 61
        and all(value[name] is True for name in true_fields)
        and all(value[name] is False for name in false_fields), 'fence-exit')
    source._denial_witness(value['denial'])
    mapping = value['mapping']
    flags = ('writer_closed_before_child', 'view_held_through_child_exit',
             'view_unmapped', 'section_and_ancestors_closed')
    _need(type(mapping) is dict and mapping.keys() == {
        'schema_version', 'target_identity_sha256', 'content_sha256', 'size', *flags}
        and mapping['schema_version'] == 'source-shared-write-view-v1'
        and mapping['target_identity_sha256'] == value['denial']['target_identity_sha256']
        and mapping['content_sha256'] == manifest['model.safetensors']['sha256']
        and type(mapping['size']) is int
        and 0 < mapping['size'] == manifest['model.safetensors']['bytes'] <= 4096
        and all(mapping[name] is True for name in flags), 'fence-exit')
    return dict(value)


def _cleanup_exact_inputs(run_root, manifest, removed=None):
    root = run_root / 'inputs'
    _need({p.name for p in root.iterdir()} == set(manifest), 'entry')
    for name, facts in manifest.items():
        path = root / name
        raw = _regular_bytes(path, 4096)
        info = path.lstat()
        _need((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) == facts['identity']
              and len(raw) == facts['bytes'] and hashlib.sha256(raw).hexdigest() == facts['sha256'], 'entry')
    for name in manifest:
        (root / name).unlink()
        if removed is not None:removed.append(name)
    root.rmdir()


class _CollectionOwner:
    """Retain partial creator results. This record grants no Source authority."""
    def __init__(self, run_root):
        _entry_environment()
        _need(not _COLLECTION_OWNERS, 'entry')
        _COLLECTION_OWNERS.append(self)
        self.root, self.manifest, self.removed = run_root, {}, []
        self.event = self.process = self.fence = self.launch_escape = None
        self.captures = []
        self.launch_api = _ParentFenceApi()  # Resolve fixed builtins before launch.
        terminate = self.launch_api.terminate
        gate = RLock()
        launch = delegated_abort = None
        abort_used = False

        def bind_launch(process):
            nonlocal launch
            with gate:
                _need(launch is None and delegated_abort is None and not abort_used
                      and type(process) is _POPEN_TYPE, 'fence-owner')
                handle, number = process._handle, int(process._handle)
                _need(number > 0, 'fence-owner')
                launch = (process, handle, number)
                return launch

        def delegate(fence):
            nonlocal delegated_abort
            with gate:
                _need(launch is not None and delegated_abort is None and not abort_used
                      and type(fence) is _OriginalParentFence, 'fence-owner')
                # Bind while still unarmed, under the original fence lock.
                # Public owner/fence observations can never reopen fallback.
                with fence.lock:
                    fence._assert_original()
                    facts = fence._bound_facts
                    _need(facts[0] is launch[0] and facts[1] is launch[1]
                          and facts[2] == launch[2] and fence.phase == 'new'
                          and fence.thread is fence.thread_origin is None, 'fence-owner')
                    delegated_abort = facts[6]

        def abort_original():
            nonlocal abort_used
            with gate:
                if abort_used or launch is None:return
                abort_used = True
                if delegated_abort is not None:
                    target, args = delegated_abort, ()
                else:
                    target, args = terminate, (launch[2], 9)
            target(*args)  # Never invoke a target while holding the collection lock.

        self._bind_original_launch, self._delegate_original_fence = bind_launch, delegate
        self._abort_original = abort_original

    def retain_launch(self, process):
        _need(self.process is None and type(process) is _POPEN_TYPE, 'fence-owner')
        self.process = process
        facts = self._bind_original_launch(process)
        self.launch_escape = (*facts, self._abort_original)

    def delegate_fence(self, fence):
        return self._delegate_original_fence(fence)

    def abort(self):
        return self._abort_original()


def run_native():
    """One fixed synthetic roundtrip. Collection never closes a roadmap."""
    case = _entry_environment()
    source, folder, hashes = _load_runtime_sources()
    runtime = source.io._runtime_image()
    nonce = uuid.uuid4().hex
    if not RUNS.exists():RUNS.mkdir()
    _need(RUNS.is_dir() and not RUNS.is_symlink()
          and not getattr(RUNS.lstat(), 'st_file_attributes', 0) & 0x400, 'entry')
    run_root = RUNS / nonce
    run_root.mkdir()
    owner = _CollectionOwner(run_root)
    fence = None
    stage = 'input-preparation'
    passed = False
    report = None
    try:
        owner.manifest = _synthetic_source_inputs(run_root)
        # Persist the exact owned manifest before any subsequent deletion.
        with (run_root / 'input-manifest.json').open('x', encoding='utf8') as stream:
            json.dump(owner.manifest, stream, sort_keys=True, indent=2)
            stream.write('\n')
        stage = 'dispatch-event'
        owner.event = object.__new__(_OriginalDispatchEvent)
        _OriginalDispatchEvent.__init__(owner.event)
        event = owner.event
        deadline = time.monotonic_ns() + _BUDGET_NS
        code = source._source_bootstrap(folder, hashes, nonce, deadline,
                                        (str(runtime[0]), runtime[1]), str(run_root),
                                        handles=(event.handle,), case=case)
        startup = subprocess.STARTUPINFO()
        startup.lpAttributeList = {'handle_list': [event.handle]}
        env = {name: os.environ[name] for name in ('SystemRoot', 'WINDIR', 'PATH') if name in os.environ}
        env['TEMP'] = env['TMP'] = str(run_root)
        stage = 'parent-launch'
        # Only this fixed original constructor produces a process. Neither
        # control JSON nor a report can select an image or command.
        owner.retain_launch(subprocess.Popen([str(runtime[0]), '-I', '-S', '-B', '-c', code],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   close_fds=True, startupinfo=startup, env=env,
                                   creationflags=0x8))  # DETACHED_PROCESS; no Job breakaway.
        process = owner.process
        stage = 'fence-start'
        owner.fence = object.__new__(_OriginalParentFence)
        _OriginalParentFence.__init__(owner.fence, process, deadline)
        fence = owner.fence
        owner.delegate_fence(fence)
        fence.arm()
        for stream in (process.stdout, process.stderr):
            capture = _StreamCapture(stream, owner.abort)
            owner.captures.append(capture)
            capture.start()
        stage = 'parent-ready'
        ready = run_root / 'ready.json'
        while not ready.exists():
            fence.assert_dispatch_allowed()
            _need(time.monotonic_ns() < deadline, 'fence-dispatch')
            time.sleep(0.01)
        expected = {'schema_version': 'owned-source-parent-ready-v1', 'nonce': nonce,
                    'pid': process.pid, 'source_digest': source._source_inputs()[2], 'deadline_ns': deadline}
        _need(_json_object(_regular_bytes(ready, 2048)) == expected, 'fence-dispatch')
        event.signal(fence)
        stage = 'parent-running'
        while fence.thread.is_alive():
            time.sleep(0.01)
        fence.join_observed()
        for capture in owner.captures:capture.join()
        observed = _json_object(bytes(owner.captures[0].data))
        report = (_validate_denial_report(observed, expected['source_digest'], owner.manifest, source)
                  if case == 'shared-write-map-denial'
                  else _validate_parent_report(observed, expected['source_digest']))
        stage = 'dispatch-event-close'
        event.close_after_exit(fence)
        stage = 'input-cleanup'
        _cleanup_exact_inputs(run_root, owner.manifest, owner.removed)
        passed = True
        stage = 'none'
    except BaseException:
        try:owner.abort()
        except BaseException:pass
        thread = getattr(owner.fence, 'thread', None)
        if thread is not None:thread.join(3)
        for capture in owner.captures:
            try:capture.join()
            except BaseException:pass
        if getattr(owner.fence, 'exit_observed', False) and not getattr(owner.event, 'close_started', True):
            try:owner.event.close_after_exit(owner.fence)
            except BaseException:pass
    result = {'schema_version': 'windows-offload-source-session-qualification-v1',
              'status': 'observed' if passed else 'failed',
              'collection_status': 'evidence-collected-review-required',
              'case': case or 'source-roundtrip', 'failure_stage': stage,
              'source_bindings': hashes, 'parent_report': report,
              'qualification_fixture_sha256': globals().get('_QUALIFICATION_SOURCE_SHA256'),
              'original_parent_exit_observed': getattr(owner.fence, 'exit_observed', False),
              'watchdog_expired': getattr(owner.fence, 'expired', False),
              'watchdog_failed': getattr(owner.fence, 'failed', True),
              'watchdog_termination_attempted': (owner.fence._bound_facts[7]()
                  if hasattr(owner.fence, '_bound_facts') else None),
              'exit_code': getattr(owner.fence, 'code', None),
              'owned_inputs_removed': bool(owner.manifest) and set(owner.removed) == set(owner.manifest),
              'removed_inputs': list(owner.removed),
              'input_manifest': owner.manifest,
              'dispatch_event_closed': getattr(owner.event, 'closed', False),
              'streams': [{'bytes': c.bytes, 'sha256': c.digest.hexdigest(),
                           'overflow': c.overflow, 'failed': c.failed,
                           'start_attempted': c.start_attempted, 'started': c.started} for c in owner.captures],
              'native_effects': True, 'native_tests_executed': True,
              'qualification_complete': False, 'quality_tests_executed': False,
              'model_started': False, 'old_staging_accessed': False,
              'production_composed': False, 'parent_qualification_granted': False}
    with (run_root / 'summary.json').open('x', encoding='utf8') as stream:
        json.dump(result, stream, sort_keys=True, indent=2)
        stream.write('\n')
    print(json.dumps({'status': result['status'], 'collection_status': result['collection_status'],
                      'evidence': (run_root / 'summary.json').relative_to(ROOT).as_posix(),
                      'qualification_complete': False}, sort_keys=True))
    return 0 if passed else 9
