"""Closed model-free original-source session protocol.

Messages are observations, never file, Source, process or retirement authority.
This private role has a distinct wire version and one frozen lifetime deadline.
The legacy IO protocol is unchanged. Production offload remains unavailable.
"""
from pathlib import Path, PureWindowsPath
import ctypes as C
import hashlib
import json
import struct
import os
import re
import sys
import sysconfig
from threading import RLock, get_ident
import time

from . import windows_offload_core as core
from . import windows_offload_execution as io
from . import windows_offload_native_session as native
from . import windows_offload_source_ledger as ledger
from .local_model_offload import OffloadAdmissionError

_VERSION = 2
_OPERATIONS = {0: 'prepare-source', 1: 'check-source',
               2: 'retire-unused-source', 3: 'finish-source'}
_STATES = {0: 'source-prepared', 1: 'source-checked',
           2: 'source-retired', 3: 'source-finished'}
_FIELDS = frozenset(('v', 'nonce', 'seq', 'op', 'body',
                     'source_digest', 'deadline_ns'))
_FRAME_BYTES = 4096
_TRANSFER_ATTEMPTS = 32
_ENGINE_NORMAL = 1024
_PARENT_ROLE, _CHILD_ROLE = object(), object()
_PARENT = None
_ENTRY_CONTEXT = None
_NATIVE_OWNERS = {}
_SOURCE_NAMES = ('local_model_offload.py', 'offload_recovery.py', 'windows_offload_core.py',
                 'windows_offload_backend.py', 'windows_offload_source_ledger.py',
                 'windows_offload_native_session.py', 'windows_offload_execution.py',
                 'windows_offload_sources.py', 'windows_offload_source_session.py',
                 'windows_offload_source_session_child.py')
_PRIVATE_PACKAGE = '_aisb_owned_source'
_BOOTSTRAP = None


def _private_environment():
    _need(__name__ == _PRIVATE_PACKAGE + '.windows_offload_source_session'
          and sys.flags.isolated == sys.flags.no_site == 1 and sys.dont_write_bytecode
          and sys.prefix == sys.base_prefix and sys.argv == ['-c']
          and os.name == 'nt' and sys.implementation.name == 'cpython')


def _source_inputs():
    folder = Path(__file__).absolute().parent
    values = {name: io._read_source(folder / name) for name in _SOURCE_NAMES}
    hashes = {name: hashlib.sha256(raw).hexdigest() for name, raw in values.items()}
    digest = hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return values, hashes, digest


def _qualification_root(value):
    _need(type(value) is str)
    path = Path(io._root(value))
    expected = Path(__file__).absolute().parents[6] / '.local-codex/windows-offload-source-session-native-v1'
    _need(str(path) == value and path.parent == expected
          and re.fullmatch('[a-f0-9]{32}', path.name) is not None)
    return path


def _source_bootstrap(folder, hashes, nonce, deadline, runtime, run_root, *, handles):
    """Fixed source-buffer closure. Caller data selects no module or function."""
    _need(type(folder) is type(Path()) and folder.is_absolute()
          and type(hashes) is dict and hashes.keys() == set(_SOURCE_NAMES)
          and all(type(n) is str and type(h) is str and re.fullmatch('[a-f0-9]{64}', h)
                  for n, h in hashes.items())
          and type(nonce) is str and re.fullmatch('[a-f0-9]{32}', nonce)
          and type(deadline) is int and 0 < deadline < 2**63
          and type(runtime) is tuple and len(runtime) == 2
          and io._root(runtime[0]) == runtime[0]
          and type(runtime[1]) is str and re.fullmatch('[a-f0-9]{64}', runtime[1]))
    _qualification_root(run_root)
    _need(type(handles) is tuple and len(handles) in (1, 4)
          and len(handles) == len(set(handles))
          and all(type(n) is int and 0 < n < C.c_void_p(-1).value for n in handles))
    mode = 'windows_offload_source_session' if len(handles) == 1 else 'windows_offload_source_session_child'
    bootstrap = (nonce, hashes, deadline, runtime, run_root, handles)
    code = ('import hashlib,os,sys,types\n'
            'p=' + repr(str(folder)) + ';h=' + repr(hashes) + '\n'
            'pkg=types.ModuleType(' + repr(_PRIVATE_PACKAGE) + ');pkg.__path__=[p];sys.modules[pkg.__name__]=pkg\n'
            'for n in ' + repr(_SOURCE_NAMES) + ':\n'
            " with open(os.path.join(p,n),'rb') as f:b=f.read(2097153)\n"
            ' if not(0<len(b)<=2097152 and hashlib.sha256(b).hexdigest()==h[n]):raise SystemExit(9)\n'
            " m=types.ModuleType(pkg.__name__+'.'+n[:-3]);m.__file__=os.path.join(p,n);m.__package__=pkg.__name__;sys.modules[m.__name__]=m\n"
            " exec(compile(b,m.__file__,'exec',dont_inherit=True),m.__dict__)\n"
            'm=sys.modules[pkg.__name__+' + repr('.' + mode) + ']\n'
            'm._BOOTSTRAP=' + repr(bootstrap) + '\n'
            'm._entry()\n')
    _need(len(code.encode('utf8')) <= 16384)
    return code


class _OriginalSourceEntry:
    """Original private entry facts; handoff data alone proves no watchdog."""
    def __init__(self, role, bootstrap):
        _private_environment()
        _need(_ENTRY_CONTEXT is None and role in (_PARENT_ROLE, _CHILD_ROLE)
              and type(bootstrap) is tuple and len(bootstrap) == 6)
        nonce, hashes, deadline, runtime, run_root, handles = bootstrap
        self.__origin, self.role = self, role
        self.values, self.hashes, self.digest = _source_inputs()
        _need(type(hashes) is dict and hashes == self.hashes
              and type(nonce) is str and re.fullmatch('[a-f0-9]{32}', nonce)
              and type(deadline) is int and 0 < deadline - time.monotonic_ns() <= io._BUDGET_NS
              and type(runtime) is tuple and len(runtime) == 2
              and io._root(runtime[0]) == runtime[0]
              and type(runtime[1]) is str and re.fullmatch('[a-f0-9]{64}', runtime[1]))
        self.nonce, self.deadline, self.runtime = nonce, deadline, runtime
        self.run_root = _qualification_root(run_root)
        _need(type(handles) is tuple and len(handles) == (1 if role is _PARENT_ROLE else 4)
              and len(handles) == len(set(handles))
              and all(type(n) is int and 0 < n < C.c_void_p(-1).value for n in handles))
        self.handles, self.pid = handles, os.getpid()
        self.hash_facts = tuple(sorted(self.hashes.items()))
        gate = RLock()
        dispatched = role is _CHILD_ROLE

        def read_dispatch():
            with gate:
                return dispatched

        def mark_dispatch():
            nonlocal dispatched
            with gate:
                _need(role is _PARENT_ROLE and not dispatched)
                dispatched = True

        self.dispatch = (read_dispatch, mark_dispatch)
        self.original = (role, nonce, self.hashes, self.digest, deadline, runtime,
                         self.run_root, handles, self.pid, self.hash_facts, self.dispatch)

    def assert_original(self):
        _private_environment()
        _need(type(self) is _OriginalSourceEntry and self.__origin is self
              and _ENTRY_CONTEXT is self and type(self.original) is tuple and len(self.original) == 11
              and all(a is b for a, b in zip(
                  (self.role, self.nonce, self.hashes, self.digest, self.deadline, self.runtime,
                   self.run_root, self.handles, self.pid, self.hash_facts, self.dispatch), self.original))
              and tuple(sorted(self.hashes.items())) == self.hash_facts
              and self.pid == os.getpid())

    def __copy__(self):raise OffloadAdmissionError()
    def __deepcopy__(self, memo):raise OffloadAdmissionError()
    def __reduce_ex__(self, protocol):raise OffloadAdmissionError()


def _original_actor(owner):
    parent_type = globals().get('_OriginalSourceParent')
    if parent_type is not None and type(owner) is parent_type and _PARENT is owner:
        owner.origin()
        return _PARENT_ROLE
    module = sys.modules.get(__package__ + '.windows_offload_source_session_child')
    child_type = getattr(module, '_OriginalSourceChild', None)
    if child_type is not None and type(owner) is child_type and module._CHILD is owner:
        owner.origin()
        return _CHILD_ROLE
    raise OffloadAdmissionError()


class _RuntimeSourceRows(ledger._SourceRows):
    """Original Source table; observation corruption grants no dispatch."""
    def __init__(self, api, role):
        _need(type(api) is _SourceNative and _original_actor(api.owner) is role)
        self._initialize_rows(api, role)

    def physical_origin_bound(self):
        _need(type(self) is _RuntimeSourceRows and self.origin is self
              and type(self.owner) is _SourceNative
              and type(self.original) is tuple and len(self.original) == 10
              and all(a is b for a, b in zip(
                  (self.owner, self.role, self.rows, self.bindings, self.completions,
                   self.claims, self.reservations, self.issued, self.calls, self.payloads), self.original))
              and len(self.rows) == 16384
              and all(type(v) is list and len(v) == 16384 for v in
                      (self.bindings, self.completions, self.claims, self.payloads)))
        binding = _NATIVE_OWNERS.get(id(self.owner))
        _need(type(binding) is tuple and len(binding) == 4
              and binding[0] is self.owner and binding[1] is self
              and binding[2] is self.owner.owner and binding[3] is self.role)

    def origin_bound(self):
        self.physical_origin_bound()
        api = self.owner
        _need(api.rows is self and api.rows is api._rows_origin
              and self.deadline == api.deadline_ns == api._deadline_origin
              and _original_actor(api.owner) is self.role
              and type(self.order) is tuple and self.order is self.order_origin
              and len(self.calls) == len(self.issued) == len(self.order)
              and all(a is b for a, b in zip(self.issued, self.order))
              and all(a is b.payload for a, b in zip(self.calls, self.order))
              and all(row.payload is self.payloads[row.index] for row in self.order)
              and self.api_bindings is self.api_origin is api.function_bindings)
        if self.api_bindings is not None:
            for function, args, result in self.api_bindings:
                _need(tuple(function.argtypes) == args and function.restype is result)


class _EngineCall:
    __slots__ = ('origin', 'api', 'function', 'args', 'valid', 'keep', 'terminal',
                 'facts', 'row', 'row_origin', 'known_return')

    def __init__(self, api, function, args, valid, keep, terminal):
        self.origin, self.api = self, api
        self.function, self.args, self.valid, self.keep, self.terminal = function, args, valid, keep, terminal
        self.facts = (self, api, function, args, valid, keep, terminal)
        self.row = self.row_origin = self.known_return = None

    def assert_original(self, api):
        _need(type(self) is _EngineCall and self.origin is self and self.api is api
              and type(self.facts) is tuple and len(self.facts) == 7
              and all(a is b for a, b in zip((self, api, self.function, self.args,
                                            self.valid, self.keep, self.terminal), self.facts))
              and api.engine_calls.get(id(self)) is self.facts
              and self.row is self.row_origin and type(self.row) is ledger._SourceSlot)
        api.rows.member(self.row)
        binding = self.row.binding
        _need(type(binding) is tuple and len(binding) == 9
              and binding[2] is self.function and binding[3] is self.args
              and binding[4] == (api.owner, self, self.keep, api)
              and binding[5] == get_ident())


class _SourceHandle:
    def __init__(self, owner, name):
        _original_actor(owner)
        _need(not hasattr(self, 'origin'))
        self.origin, self.owner, self.name = self, owner, name
        self.slot = self.slot_origin = C.c_void_p()
        self.number = None
        self.close_started = self.closed = False
        self.close_record = None

    def acknowledge(self):
        _original_actor(self.owner)
        _need(type(self) is _SourceHandle and self.origin is self
              and any(h is self for h in self.owner.handles)
              and self.slot is self.slot_origin and self.number is None
              and type(self.slot.value) is int and 0 < self.slot.value < C.c_void_p(-1).value)
        self.number = self.slot.value
        _need(id(self) not in self.owner.handle_bindings)
        self.owner.handle_bindings[id(self)] = (self, self.slot, self.number)

    @property
    def value(self):
        _original_actor(self.owner)
        _need(type(self) is _SourceHandle and self.origin is self
              and any(h is self for h in self.owner.handles)
              and self.slot is self.slot_origin and type(self.slot) is C.c_void_p
              and type(self.number) is int and self.slot.value == self.number
              and 0 < self.number < C.c_void_p(-1).value
              and self.owner.handle_bindings.get(id(self)) == (self, self.slot, self.number)
              and not self.close_started and not self.closed)
        return self.number

    def assert_closed(self, api):
        _original_actor(self.owner)
        _need(type(self) is _SourceHandle and self.origin is self
              and self.owner.api is api and self.closed is True and self.close_started is True
              and self.slot is self.slot_origin and self.slot.value == self.number
              and type(self.close_record) is _EngineCall)
        call = self.close_record
        call.assert_original(api)
        completion = call.row.completion
        _need(completion is api.rows.completions[call.row.index]
              and type(completion) is tuple and len(completion) == 4
              and call.function is api.k.CloseHandle and call.args == (self.number,)
              and call.keep == (self, self.slot) and call.row.payload['acknowledged'] is True
              and type(completion[1]) is int and completion[1] != 0)


class _SourceNative(native._NativePrimitives):
    """Closed standalone Source actor API, sharing one physical Source table."""
    _handle_type = _SourceHandle

    def __new__(cls, owner):
        _need(cls is _SourceNative)
        _original_actor(owner)  # Default/imported/shared-worker use denies here.
        _need(owner.api is None and _ENTRY_CONTEXT is not None and not _NATIVE_OWNERS)
        value = super().__new__(cls)
        owner.api = value
        return value

    def __init__(self, owner):
        role = _original_actor(owner)
        _need(not hasattr(self, '_SourceNative__origin'))
        _need(os.name == 'nt' and C.sizeof(C.c_void_p) == 8
              and sys.implementation.name == 'cpython' and sysconfig.get_platform() == 'win-amd64')
        self.__origin, self.owner, self.role = self, owner, role
        self.deadline_ns = self._deadline_origin = owner.deadline
        self.calls, self.buffers = owner.calls, owner.buffers
        self.pending = None
        self.uncertain = False
        self.initializing = True
        self.function_bindings = None
        self.dll = self.dll_facts = None
        self.engine_calls = self._engine_calls_origin = {}
        self.rows = self._rows_origin = object.__new__(_RuntimeSourceRows)
        _need(not _NATIVE_OWNERS)
        _NATIVE_OWNERS[id(self)] = (self, self.rows, owner, role)
        _RuntimeSourceRows.__init__(self.rows, self, role)
        self.engine_normal = self.rows.reserve('engine-normal', _ENGINE_NORMAL, 0)
        final = 61 if role is _PARENT_ROLE else 13
        self.engine_final = self.rows.reserve('engine-final', 0, final)
        self.escapes = tuple(self.rows.reserve(label, 0, 1)
                             for label in ('source-own-exit', 'source-deadline-exit', 'source-park'))
        # These debts exist before DLL or output acquisition.
        if role is _PARENT_ROLE:
            self._wait_outer_dispatch()
        self.dll = self._system_kernel()
        self.dll_facts = (self.dll, self.dll._name, self.dll._handle)
        self.k = self.dll
        self.timer_callback = C.WINFUNCTYPE(None, C.c_void_p, C.c_ubyte)
        self._configure_functions()
        self.process = self.call(self.k.GetCurrentProcess)
        self.pid = self.call(self.k.GetCurrentProcessId)
        _need(type(self.pid) is int and self.pid > 0)
        owner._assert_runtime_image(self)
        self.timer = _SourceLifetimeTimer(self)  # Installed before blocking actor IO.
        self.initializing = False
        self.live()

    def origin(self):
        _need(type(self) is _SourceNative and self.__origin is self
              and self.owner.api is self and self._handle_type is _SourceHandle
              and self.role is _original_actor(self.owner)
              and self.engine_calls is self._engine_calls_origin)
        self.rows.origin_bound()
        if self.dll_facts is not None:
            _need(type(self.dll_facts) is tuple and len(self.dll_facts) == 3
                  and self.dll is self.dll_facts[0]
                  and self.dll._name == self.dll_facts[1] and self.dll._handle == self.dll_facts[2])

    def live(self):
        self.origin()
        _need(not self.uncertain and not self.rows.fenced
              and 0 < self.deadline_ns - time.monotonic_ns() <= io._BUDGET_NS)
        self.owner._native_live(self.initializing)

    def _system_kernel(self):
        self.owner.entry.assert_original()
        _need(self.owner.entry.dispatch[0]())
        row = self.rows.begin(self.engine_normal, 'source-system-bootstrap', C.WinDLL,
                              ('kernel32.dll',), (), variant='system-library', library='kernel32.dll')
        try:
            value = C.WinDLL('kernel32.dll', use_last_error=True, winmode=0x800)
            error = C.get_last_error() & 0xffffffff
            self.rows.returned(row, value, error)
            self.rows.acknowledge(row)
            return value
        except BaseException:
            self.rows.fenced = self.uncertain = True
            raise

    def _wait_outer_dispatch(self):
        """The only pre-DLL call waits on a fixed inherited kernel event.

        The creator signals its original event only after the actual original-
        handle watchdog wait is committed. Ready JSON supplies no admission.
        This bounded builtin wait is itself debited to the one Source table.
        """
        entry = self.owner.entry
        entry.assert_original()
        _need(entry.role is _PARENT_ROLE and not entry.dispatch[0]())
        import _winapi
        function = _winapi.WaitForSingleObject
        args = (entry.handles[0], io._remaining(entry.deadline))
        arena = self.rows
        row = arena.begin(self.engine_normal, 'source-outer-dispatch', function, args,
                           (self, self.owner, entry))
        try:
            result = function(*args)
            error = C.GetLastError() & 0xffffffff
            arena.returned(row, result, error)
            _need(type(result) is int and result == 0)
            arena.acknowledge(row)
            entry.dispatch[1]()
        except BaseException:
            arena.fenced = self.uncertain = True
            raise

    def _configure_functions(self):
        _need(self.initializing and self.function_bindings is None)
        ptr, u32, i32 = C.c_void_p, C.c_uint32, C.c_int32
        specs = (
            ('CreateEventW', (ptr, i32, i32, C.c_wchar_p), ptr),
            ('SetEvent', (ptr,), i32), ('ResetEvent', (ptr,), i32),
            ('CreatePipe', (C.POINTER(ptr), C.POINTER(ptr), C.POINTER(native._Security), u32), i32),
            ('ReadFile', (ptr, ptr, u32, C.POINTER(u32), ptr), i32),
            ('WriteFile', (ptr, ptr, u32, C.POINTER(u32), ptr), i32),
            ('GetFileType', (ptr,), u32), ('GetHandleInformation', (ptr, C.POINTER(u32)), i32),
            ('SetHandleInformation', (ptr, u32, u32), i32), ('CloseHandle', (ptr,), i32),
            ('WaitForSingleObject', (ptr, u32), u32),
            ('WaitForMultipleObjects', (u32, C.POINTER(ptr), i32, u32), u32),
            ('GetCurrentProcess', (), ptr), ('GetCurrentProcessId', (), u32),
            ('GetCurrentThreadId', (), u32), ('GetProcessId', (ptr,), u32),
            ('GetExitCodeProcess', (ptr, C.POINTER(u32)), i32),
            ('QueryFullProcessImageNameW', (ptr, u32, C.c_wchar_p, C.POINTER(u32)), i32),
            ('CreateJobObjectW', (ptr, C.c_wchar_p), ptr),
            ('SetInformationJobObject', (ptr, i32, ptr, u32), i32),
            ('QueryInformationJobObject', (ptr, i32, ptr, u32, C.POINTER(u32)), i32),
            ('IsProcessInJob', (ptr, ptr, C.POINTER(i32)), i32),
            ('InitializeProcThreadAttributeList', (ptr, u32, u32, C.POINTER(C.c_size_t)), i32),
            ('UpdateProcThreadAttribute', (ptr, u32, C.c_size_t, ptr, C.c_size_t, ptr, ptr), i32),
            ('DeleteProcThreadAttributeList', (ptr,), None),
            ('CreateProcessW', (C.c_wchar_p, C.c_wchar_p, ptr, ptr, i32, u32, ptr, C.c_wchar_p,
                                C.POINTER(native._StartupEx), C.POINTER(native._Process)), i32),
            ('ResumeThread', (ptr,), u32), ('GetWindowsDirectoryW', (C.c_wchar_p, u32), u32),
            ('GetModuleFileNameW', (ptr, C.c_wchar_p, u32), u32),
            ('CreateTimerQueueTimer', (C.POINTER(ptr), ptr, self.timer_callback, ptr, u32, u32, u32), i32),
            ('DeleteTimerQueueTimer', (ptr, ptr, ptr), i32),
            ('ExitProcess', (u32,), None), ('Sleep', (u32,), None),
        )
        bindings = []
        for name, args, result in specs:
            function = getattr(self.k, name)
            function.argtypes, function.restype = list(args), result
            bindings.append((function, args, result))
        self.function_bindings = tuple(bindings)
        self.rows.api_bindings = self.rows.api_origin = self.function_bindings

    def _call_row(self, function, *args, valid=lambda n: type(n) is int and n != 0,
                  keep=(), terminal=False, _wait_deadline=None):
        self.live()
        _need(type(args) is tuple and type(keep) is tuple and type(terminal) is bool
              and any(function is original for original, _, _ in self.function_bindings))
        if _wait_deadline is not None:
            _need(type(_wait_deadline) is int and _wait_deadline <= self.deadline_ns and len(args) == 4)
            args = (*args[:-1], io._remaining(_wait_deadline))
        call = _EngineCall(self, function, args, valid, keep, terminal)
        self.engine_calls[id(call)] = call.facts
        row = self.rows.begin(self.engine_final if terminal else self.engine_normal,
                              'source-engine-native', function, args, (self.owner, call, keep, self),
                              terminal=terminal)
        call.row = call.row_origin = row
        return call

    def _perform(self, call):
        self.live()
        call.assert_original(self)
        arena, row = self.rows, call.row
        function, args, valid = call.facts[2:5]
        try:
            value = function(*args)
            error = C.get_last_error() & 0xffffffff
            call.known_return = (value, error, get_ident())
            arena.returned(row, value, error)
            call.assert_original(self)
            _need(valid(value))
            arena.acknowledge(row)
            return value
        except BaseException:
            arena.fenced = self.uncertain = True
            raise

    def call(self, function, *args, **kwargs):
        return self._perform(self._call_row(function, *args, **kwargs))

    def location(self, function):
        text = C.create_unicode_buffer(32768)
        self.buffers.append(text)
        size = self.call(function, text, len(text),
                         valid=lambda n: type(n) is int and 0 < n < len(text), keep=(text,))
        _need(size == len(text.value))
        return io._root(text.value)

    def escape_exit(self, code, *, deadline=False):
        """One owned standalone exit. It cannot return a cleanup acknowledgement."""
        self.origin()
        _need(type(code) is int and code in (0, 2, 9) and type(deadline) is bool)
        if deadline:
            _need(type(self.timer) is _SourceLifetimeTimer and self.timer.api is self
                  and self.timer.phase == 'expired')
        else:
            _need(get_ident() == self.owner.thread)
        arena = self.rows
        ticket = self.escapes[1 if deadline else 0]
        function = self.k.ExitProcess
        row = arena.begin_escape(ticket, 'source-owned-exit', function, (code,),
                                  (self, self.owner, getattr(self, 'timer', None)))
        try:
            result = function(code)
            error = C.get_last_error() & 0xffffffff
            arena.returned(row, result, error)
        finally:
            self.uncertain = True
            self._park_original()

    def _park_original(self):
        # This helper is reachable only in the separately owned standalone
        # role. Never introduce another Native call after the one park debt.
        try:
            arena = self.rows
            function = self.k.Sleep
            arena.begin_escape(self.escapes[2], 'source-owned-park', function,
                                (0xffffffff,), (self, self.owner))
            function(0xffffffff)
        except BaseException:
            pass
        _terminal_halt_without_calls()


def _terminal_halt_without_calls():
    # No further Native invocation, Python unwinding or resource-credit claim.
    # The independent original-process watchdog owns this standalone process.
    while True:
        pass


class _SourceLifetimeTimer:
    """One original timer across all Source operations and idle time."""
    def __init__(self, api):
        _need(type(self) is _SourceLifetimeTimer and not hasattr(self, '_SourceLifetimeTimer__origin')
              and type(api) is _SourceNative and api.initializing)
        api.origin()
        self.__origin, self.api = self, api
        self.slot = C.c_void_p()
        self.lock = RLock()
        self.deadline = api.deadline_ns
        self.cutoff = self.deadline - 5 * 10**9
        _need(time.monotonic_ns() < self.cutoff)
        phase = 'pending'
        gate = self.lock
        cutoff, deadline = self.cutoff, self.deadline

        def read_state():
            with gate:
                return phase

        def expire():
            nonlocal phase
            with gate:
                if phase != 'pending':
                    return False
                _need(time.monotonic_ns() >= cutoff)
                phase = 'expired'
                return True

        def begin_retirement():
            nonlocal phase
            with gate:
                _need(phase == 'pending' and time.monotonic_ns() < cutoff
                      and time.monotonic_ns() < deadline)
                phase = 'completion-won'

        def finish_retirement():
            nonlocal phase
            with gate:
                _need(phase == 'completion-won' and time.monotonic_ns() < deadline)
                phase = 'retired'

        self.states = (read_state, expire, begin_retirement, finish_retirement)
        self.event = None
        self.callback = api.timer_callback(self._expired)
        self.number = None
        self.due = C.c_uint32(max(1, (self.cutoff - time.monotonic_ns() + 999999) // 1000000))
        self.original = (api, self.slot, self.lock, self.deadline, self.cutoff,
                         self.states, self.callback, self.due, self.event, None)
        # Retain the partial timer, callback and output before acquisition.
        api.timer = self
        api.buffers.extend((self, self.slot, self.callback, self.due))
        self.event = api.acquire('source-timer-completion', api.k.CreateEventW, None, 1, 0, None)
        self.original = (*self.original[:8], self.event, None)
        api.call(api.k.CreateTimerQueueTimer, C.byref(self.slot), None, self.callback,
                 None, self.due.value, 0, 8,
                 keep=(self, self.slot, self.callback, self.due, self.event))
        _need(type(self.slot.value) is int and 0 < self.slot.value < C.c_void_p(-1).value)
        self.number = self.slot.value
        self.original = (*self.original[:9], self.number)
        self._assert_original()

    @property
    def phase(self):
        self._assert_original()
        return self.original[5][0]()

    def _assert_original(self):
        _need(type(self) is _SourceLifetimeTimer and self.__origin is self
              and type(self.api) is _SourceNative and self.api.timer is self
              and type(self.original) is tuple and len(self.original) == 10
              and all(a is b for a, b in zip(
                  (self.api, self.slot, self.lock, self.deadline, self.cutoff,
                   self.states, self.callback, self.due, self.event), self.original[:9]))
              and self.deadline == self.api._deadline_origin
              and self.cutoff == self.deadline - 5 * 10**9
              and self.number is self.original[9]
              and (self.number is None or type(self.number) is int and self.slot.value == self.number))

    def _expired(self, parameter, fired):
        if type(self) is not _SourceLifetimeTimer or getattr(self, '_SourceLifetimeTimer__origin', None) is not self:
            return
        api = self.api
        if type(api) is not _SourceNative or getattr(api, 'timer', None) is not self:
            return
        try:
            self._assert_original()
            api.origin()
            _need(parameter is None and type(fired) is int and fired == 1)
            if not self.original[5][1]():
                return
            api.uncertain = True
            api.escape_exit(2, deadline=True)
        except BaseException:
            api.uncertain = True
            _terminal_halt_without_calls()

    def retire(self):
        self._assert_original()
        api = self.api
        api.live()
        _need(api.owner.finishing and self.number is not None)
        self.original[5][2]()  # One closure-owned cancellation admission.
        call = api._call_row(api.k.DeleteTimerQueueTimer, None, self.number, self.event.value,
                              valid=lambda n: type(n) is int and n in (0, 1),
                              keep=(self, self.slot, self.callback, self.event), terminal=True)
        result = api._perform(call)
        completion = call.row.completion
        _need(completion is api.rows.completions[call.row.index]
              and type(completion) is tuple and len(completion) == 4
              and (result != 0 or completion[2] == 997))
        _need(api.wait((self.event,), self.deadline) == 0)
        self._assert_original()
        # The event confirms all original callbacks are quiescent.
        api.close(self.event)
        self.original[5][3]()


def _need(value):
    if not value:
        raise OffloadAdmissionError()


def _model_root(value):
    """Pure path syntax only. A parsed path supplies no access authorization."""
    normalized = io._root(value)
    _need(normalized == value)
    for part in PureWindowsPath(normalized).parts[1:]:
        core._name(part)
        # Win32 inspection precedes the Native Source guard. Do not let a
        # directory component select a DOS device, including with an extension.
        stem = part.split('.', 1)[0].rstrip(' ').upper()
        _need(stem not in ('CON', 'PRN', 'AUX', 'NUL')
              and re.fullmatch('(COM|LPT)[1-9]', stem) is None)
    return normalized


def _message(value, nonce, source, deadline, *, response=False):
    """Validate one message against the original actor's frozen wire facts."""
    _need(type(value) is dict and value.keys() == _FIELDS
          and type(response) is bool
          and type(nonce) is str and re.fullmatch('[a-f0-9]{32}', nonce)
          and type(source) is str and re.fullmatch('[a-f0-9]{64}', source)
          and type(deadline) is int and 0 < deadline < 2**63)
    _need(type(value['v']) is int and value['v'] == _VERSION
          and type(value['nonce']) is str and value['nonce'] == nonce
          and type(value['source_digest']) is str and value['source_digest'] == source
          and type(value['deadline_ns']) is int and value['deadline_ns'] == deadline
          and type(value['seq']) is int and value['seq'] in _OPERATIONS
          and type(value['op']) is str and value['op'] == _OPERATIONS[value['seq']]
          and type(value['body']) is dict)
    body = value['body']
    if response:
        _need(body.keys() in ({'state'}, {'error', 'source_retired'}))
        if 'state' in body:
            _need(type(body['state']) is str and body['state'] == _STATES[value['seq']])
        else:
            _need(type(body['error']) is str and body['error'] == 'source-session-unavailable'
                  and type(body['source_retired']) is bool)
    elif value['seq'] == 0:
        _need(body.keys() == {'model_root'})
        _model_root(body['model_root'])
    else:
        _need(not body)
    return value


def _edge(state, sequence):
    _need(type(state) is str and type(sequence) is int
          and (state, sequence) in {('new', 0), ('source-prepared', 1),
                                   ('source-checked', 2), ('source-retired', 3)})
    return _STATES[sequence]


# These helpers frame bytes only; neither selects the v1 or Source actor.
_frame = io._frame
_decode = io._decode


class _SourceFrameIo:
    """Finite concrete frame transfer; a closed Source actor supplies live/call.

    The default base denies. Source calls use one original actor ledger; there
    is no per-frame counter that can create more Native row capacity.
    """
    def _live(self):
        raise OffloadAdmissionError()

    def _write_bytes(self, handle, raw):
        self._live()
        _need(type(raw) is bytes and 0 < len(raw) <= _FRAME_BYTES + 4)
        data = C.create_string_buffer(raw)
        self.buffers.append(data)
        offset = 0
        for _ in range(_TRANSFER_ATTEMPTS):
            self._live()
            count = C.c_uint32()
            self.buffers.append(count)
            self.api.call(self.api.k.WriteFile, handle.value, C.byref(data, offset),
                          len(raw) - offset, C.byref(count), None,
                          keep=(handle, data, count))
            _need(0 < count.value <= len(raw) - offset)
            offset += count.value
            if offset == len(raw):
                return None
        raise OffloadAdmissionError()

    def _read_bytes(self, handle, size):
        self._live()
        _need(type(size) is int and 0 < size <= _FRAME_BYTES)
        data = C.create_string_buffer(size)
        self.buffers.append(data)
        offset = 0
        for _ in range(_TRANSFER_ATTEMPTS):
            self._live()
            count = C.c_uint32()
            self.buffers.append(count)
            self.api.call(self.api.k.ReadFile, handle.value, C.byref(data, offset),
                          size - offset, C.byref(count), None,
                          keep=(handle, data, count))
            _need(0 < count.value <= size - offset)
            offset += count.value
            if offset == size:
                return bytes(data.raw)
        raise OffloadAdmissionError()



class _SourceRequest:
    def __init__(self, owner, sequence):
        _need(type(self) is _SourceRequest and not hasattr(self, 'origin'))
        owner.origin()
        _need(type(sequence) is int and sequence in _OPERATIONS)
        self.origin, self.owner, self.seq = self, owner, sequence
        self.op, self.deadline = _OPERATIONS[sequence], owner.deadline
        self.facts = (self, owner, sequence, self.op, self.deadline)

    def assert_original(self, owner):
        _need(type(self) is _SourceRequest and self.origin is self and self.owner is owner
              and any(request is self for request in owner.requests)
              and type(self.facts) is tuple and len(self.facts) == 5
              and all(a is b for a, b in zip((self, owner, self.seq, self.op, self.deadline), self.facts))
              and self.deadline == owner.entry.deadline)


class _SourceSessionContract:
    memory_bytes = 512 * 1024**2

    @staticmethod
    def sources():
        _PARENT.origin()
        values, hashes, digest = _source_inputs()
        _need(hashes == _PARENT.entry.hashes and digest == _PARENT.entry.digest)
        return values, hashes, digest

    @staticmethod
    def runtime_image():
        result = io._runtime_image()
        _need((str(result[0]), result[1]) == _PARENT.entry.runtime)
        return result

    @staticmethod
    def read_source(path, maximum):return io._read_source(path, maximum)

    @staticmethod
    def root(value):return io._root(value)

    @staticmethod
    def bootstrap(folder, hashes, nonce, handles, deadline, runtime):
        _PARENT.origin()
        return _source_bootstrap(folder, hashes, nonce, deadline, runtime,
                                 str(_PARENT.entry.run_root), handles=handles)


class _OriginalSourceParent(native._SessionMechanics, _SourceFrameIo):
    """One model-free synthetic Source session in a fixed standalone process."""
    def __init__(self, entry):
        _need(type(self) is _OriginalSourceParent and _PARENT is self
              and not hasattr(self, '_OriginalSourceParent__origin')
              and type(entry) is _OriginalSourceEntry and _ENTRY_CONTEXT is entry)
        entry.assert_original()
        _need(entry.role is _PARENT_ROLE)
        self.__origin, self.entry = self, entry
        self.nonce, self.deadline = entry.nonce, entry.deadline
        self.thread = get_ident()
        self.api = None
        self.buffers, self.calls, self.handles, self.requests = [], [], [], []
        self.handle_bindings = {}
        self.current = None
        self.state = 'new'
        self.failed = self.finishing = self.retired = False
        self.channels = {}
        self.process_info = native._Process()
        self.attributes = None
        self.attribute_started = self.attribute_retired = self.launch_complete = False
        self.process = self.primary_thread = self.job = None
        self.source_values = self.source_hashes = self.source_digest = None
        self.runtime = self.runtime_hash = None
        self.original = (entry, self.nonce, self.deadline, self.thread, self.buffers,
                         self.calls, self.handles, self.requests, self.handle_bindings,
                         self.channels, self.process_info)

    def origin(self):
        _need(type(self) is _OriginalSourceParent and self.__origin is self and _PARENT is self
              and self.entry is _ENTRY_CONTEXT and type(self.original) is tuple and len(self.original) == 11
              and all(a is b for a, b in zip(
                  (self.entry, self.nonce, self.deadline, self.thread, self.buffers,
                   self.calls, self.handles, self.requests, self.handle_bindings,
                   self.channels, self.process_info), self.original)))
        self.entry.assert_original()

    def _session_contract(self):
        self.origin()
        return _SourceSessionContract

    def _live(self, request=None):
        self.origin()
        _need(get_ident() == self.thread and not self.failed
              and 0 < self.deadline - time.monotonic_ns() <= io._BUDGET_NS)
        if request is not None:
            _need(self.current is request)
            request.assert_original(self)
        _need(self.current is not None)

    def _native_live(self, initializing):
        self._live(self.current)
        if not initializing:
            phase = self.api.timer.phase
            _need(phase == 'pending' or self.finishing and phase in ('completion-won', 'retired'))

    def _assert_runtime_image(self, api):
        _need(type(api) is _SourceNative and self.api is api and api.pid == self.entry.pid)
        text = C.create_unicode_buffer(32768)
        self.buffers.append(text)
        size = api.call(api.k.GetModuleFileNameW, None, text, len(text),
                         valid=lambda n: type(n) is int and 0 < n < len(text), keep=(text,))
        _need(size == len(text.value) and io._root(text.value).casefold() == self.entry.runtime[0].casefold()
              and io._root(sys.executable).casefold() == self.entry.runtime[0].casefold()
              and hashlib.sha256(io._read_source(Path(text.value), 64 * 1024**2)).hexdigest() == self.entry.runtime[1])

    def _native_intent(self, request, function, *args, **kwargs):
        self._live(request)
        return self.api.call(function, *args, **kwargs)

    def _close_outer_dispatch(self):
        api = self.api
        handle = _SourceHandle(self, 'outer-dispatch')
        self.handles.append(handle)
        handle.slot.value = self.entry.handles[0]
        handle.acknowledge()
        flags = C.c_uint32()
        self.buffers.append(flags)
        api.call(api.k.GetHandleInformation, handle.value, C.byref(flags), keep=(handle, flags))
        _need(flags.value & 1 == 1)
        api.close(handle)
        handle.assert_closed(api)

    def _exchange_source(self, request):
        body = {'model_root': str(self.entry.run_root / 'inputs')} if request.seq == 0 else {}
        message = {'v': _VERSION, 'nonce': self.nonce, 'seq': request.seq, 'op': request.op,
                   'source_digest': self.source_digest, 'deadline_ns': self.deadline, 'body': body}
        _message(message, self.nonce, self.source_digest, self.deadline)
        self._write_bytes(self.channels['request-write'], _frame(message))
        size = struct.unpack('<I', self._read_bytes(self.channels['response-read'], 4))[0]
        _need(0 < size <= _FRAME_BYTES)
        reply = _message(_decode(self._read_bytes(self.channels['response-read'], size)),
                         self.nonce, self.source_digest, self.deadline, response=True)
        _need(all(reply[name] == message[name] for name in _FIELDS - {'body'}))
        _need(reply['body'] == {'state': _STATES[request.seq]})

    def _retire_child(self):
        api = self.api
        _need(api.wait((self.process,), self.deadline) == 0)
        code, accounting = C.c_uint32(259), native._Accounting()
        accounting.active = accounting.total = 0xffffffff
        self.buffers.extend((code, accounting))
        api.call(api.k.GetExitCodeProcess, self.process.value, C.byref(code), keep=(self.process, code))
        api.call(api.k.QueryInformationJobObject, self.job.value, 1, C.byref(accounting),
                 C.sizeof(accounting), None, keep=(self.job, accounting))
        _need(code.value == 0 and accounting.active == 0 and accounting.total == 1)
        for handle in (self.process, self.primary_thread, self.job, *self.channels.values()):
            if not handle.closed:
                api.close(handle)
            handle.assert_closed(api)

    def _call(self, sequence):
        self.origin()
        _need(self.current is None and not self.failed and not self.retired and get_ident() == self.thread)
        next_state = _edge(self.state, sequence)
        _need(len(self.requests) == sequence)
        request = _SourceRequest(self, sequence)
        self.requests.append(request)
        self.current = request
        try:
            self._live(request)
            if sequence == 0:
                _need(self.api is None)
                _SourceNative(self)
                self._close_outer_dispatch()
                self._launch(request)
            self._exchange_source(request)
            if sequence == 3:
                self.finishing = True
                self._retire_child()
                self.api.timer.retire()
                for handle in self.handles:
                    handle.assert_closed(self.api)
                self.retired = True
            self._live(request)
            self.state = next_state
            self.current = None
            return None
        except BaseException:
            self.failed = True
            raise

    def prepare(self):return self._call(0)
    def check(self):return self._call(1)
    def retire_unused(self):return self._call(2)
    def finish(self):return self._call(3)


def _publish_ready(run_root, raw):
    """Publish complete telemetry once. Windows rename never replaces a file."""
    _need(type(raw) is bytes and 0 < len(raw) <= 2048)
    ready, pending = run_root / 'ready.json', run_root / 'ready.pending'
    _need(not ready.exists())
    with pending.open('xb') as stream:
        _need(stream.write(raw) == len(raw))
        stream.flush()
    os.rename(pending, ready)


def _entry():
    """Fixed standalone parent; imported/default/shared-worker calls deny."""
    global _ENTRY_CONTEXT, _PARENT
    _private_environment()
    _need(_ENTRY_CONTEXT is None and _PARENT is None)
    entry = _OriginalSourceEntry(_PARENT_ROLE, _BOOTSTRAP)
    _ENTRY_CONTEXT = entry
    _PARENT = object.__new__(_OriginalSourceParent)
    _OriginalSourceParent.__init__(_PARENT, entry)
    ready = {'schema_version': 'owned-source-parent-ready-v1', 'nonce': entry.nonce,
             'pid': entry.pid, 'source_digest': entry.digest, 'deadline_ns': entry.deadline}
    # Cooperative fixture telemetry only. Admission requires the separately
    # inherited kernel dispatch event and active external original-handle fence.
    raw = json.dumps(ready, sort_keys=True, separators=(',', ':')).encode()
    _need(len(raw) <= 2048)
    try:
        _publish_ready(entry.run_root, raw)
        _PARENT.prepare()
        _PARENT.check()
        _PARENT.retire_unused()
        _PARENT.finish()
        _need(_PARENT.retired and _PARENT.state == 'source-finished')
        report = {'schema_version': 'owned-source-parent-result-v1', 'status': 'passed',
                  'source_digest': entry.digest,
                  'native_calls': len(_PARENT.calls),
                  'terminal_calls': sum(row.terminal for row in _PARENT.api.rows.order),
                  'child_exit_confirmed': True, 'job_active_zero': True,
                  'source_retired': True, 'original_handles_closed': True,
                  'timer_callbacks_retired': True, 'model_started': False,
                  'borrower_started': False, 'production_composed': False,
                  'parent_qualification_granted': False}
        output = json.dumps(report, sort_keys=True, separators=(',', ':')).encode() + b'\n'
        _need(len(output) <= 4096 and os.write(1, output) == len(output))
        raise SystemExit(0)
    except SystemExit:
        raise
    except BaseException:
        failure = b'{"schema_version":"owned-source-parent-result-v1","status":"failed","failure_stage":"source-operation","parent_qualification_granted":false}\n'
        try:os.write(1, failure)
        except BaseException:pass
        api = getattr(_PARENT, 'api', None)
        if type(api) is _SourceNative and hasattr(api, 'k'):
            try:api.escape_exit(9)
            except BaseException:_terminal_halt_without_calls()
        raise SystemExit(9)
