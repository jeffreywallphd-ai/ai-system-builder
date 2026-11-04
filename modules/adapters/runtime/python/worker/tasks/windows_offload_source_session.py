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
_MAP_DENIAL_CASE = 'shared-write-map-denial'
_FAILURE_STATES = {}
_FAILURE_PHASES = frozenset((
    'initializing', 'parent-native', 'mapper-prepare', 'child-launch',
    'source-exchange', 'child-retirement', 'mapper-retirement',
    'timer-retirement', 'report-publication', 'prepare-source',
    'attribute-denial', 'write-denial', 'write-diagnostic', 'unknown'))
_FAILURE_APIS = {
    'NtCreateFile': 'open-file', 'NtCreateEvent': 'create-event',
    'NtReadFile': 'read-file', 'ReadFile': 'read-file', 'WriteFile': 'write-file',
    'GetFileInformationByHandleEx': 'file-information',
    'GetVolumeInformationByHandleW': 'volume-information',
    'GetDriveTypeW': 'drive-type', 'DeviceIoControl': 'read-oplock',
    'CreateFileMappingW': 'create-section', 'MapViewOfFile': 'map-view',
    'VirtualQuery': 'query-view', 'UnmapViewOfFile': 'unmap-view',
    'CloseHandle': 'close-handle', 'WaitForMultipleObjects': 'wait',
    'WaitForSingleObject': 'wait', 'GetExitCodeProcess': 'process-exit',
    'QueryInformationJobObject': 'job-information', 'CreateProcessW': 'create-process',
    'ResumeThread': 'resume-thread', 'DeleteTimerQueueTimer': 'retire-timer',
    'CancelIoEx': 'cancel-io', 'GetOverlappedResult': 'io-result'}
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
_MAPPER_OWNERS = {}
_MAPPER_RETURNS = {}
_MAPPER_RESOURCES = {}
_MAPPER_PREPARED = {}
_MAPPER_CLOSED = {}
_PARENT_RETIREMENTS = {}
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


def _source_bootstrap(folder, hashes, nonce, deadline, runtime, run_root, *, handles, case=None):
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
    _need(case is None or type(case) is str and case == _MAP_DENIAL_CASE)
    _need(type(handles) is tuple and len(handles) in (1, 4)
          and len(handles) == len(set(handles))
          and all(type(n) is int and 0 < n < C.c_void_p(-1).value for n in handles))
    mode = 'windows_offload_source_session' if len(handles) == 1 else 'windows_offload_source_session_child'
    bootstrap = (nonce, hashes, deadline, runtime, run_root, handles)
    if case is not None:
        bootstrap += (case,)
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
              and type(bootstrap) is tuple and len(bootstrap) in (6, 7))
        nonce, hashes, deadline, runtime, run_root, handles = bootstrap[:6]
        case = bootstrap[6] if len(bootstrap) == 7 else None
        _need(len(bootstrap) == 6 or type(case) is str and case == _MAP_DENIAL_CASE)
        self.__origin, self.role = self, role
        self.values, self.hashes, self.digest = _source_inputs()
        _need(type(hashes) is dict and hashes == self.hashes
              and type(nonce) is str and re.fullmatch('[a-f0-9]{32}', nonce)
              and type(deadline) is int and 0 < deadline - time.monotonic_ns() <= io._BUDGET_NS
              and type(runtime) is tuple and len(runtime) == 2
              and io._root(runtime[0]) == runtime[0]
              and type(runtime[1]) is str and re.fullmatch('[a-f0-9]{64}', runtime[1]))
        self.nonce, self.deadline, self.runtime = nonce, deadline, runtime
        self.case = case
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
                         self.run_root, handles, self.pid, self.hash_facts, self.dispatch, self.case)

    def assert_original(self):
        _private_environment()
        _need(type(self) is _OriginalSourceEntry and self.__origin is self
              and _ENTRY_CONTEXT is self and type(self.original) is tuple and len(self.original) == 12
              and all(a is b for a, b in zip(
                  (self.role, self.nonce, self.hashes, self.digest, self.deadline, self.runtime,
                   self.run_root, self.handles, self.pid, self.hash_facts, self.dispatch, self.case), self.original))
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
        diagnostic_bindings = []
        for name, args, result in specs:
            function = getattr(self.k, name)
            function.argtypes, function.restype = list(args), result
            bindings.append((function, args, result))
            diagnostic_bindings.append((self.k, name, function, args, result))
        self.diagnostic_bindings = tuple(diagnostic_bindings)
        self.function_bindings = tuple(bindings)
        self.rows.api_bindings = self.rows.api_origin = self.function_bindings
        _bind_failure_api(self.owner, self, self.diagnostic_bindings)

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
        label = _failure_engine_api(self, function)
        _failure_native(self.owner, label)
        try:
            value = function(*args)
            error = C.get_last_error() & 0xffffffff
            call.known_return = (value, error, get_ident())
            arena.returned(row, value, error)
            _failure_native(self.owner, label, True, value, error)
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


def _init_failure_state(owner, actor):
    """Negative-only observations. These functions provide no native authority."""
    if owner.entry.case != _MAP_DENIAL_CASE:
        return
    _need(type(actor) is str and actor in ('parent', 'child')
          and id(owner) not in _FAILURE_STATES and len(_FAILURE_STATES) < 2)
    phase, native, engine = 'initializing', (None, None, None, None), None

    def set_phase(value):
        nonlocal phase
        phase = value if type(value) is str and value in _FAILURE_PHASES else 'unknown'

    def capture(api, returned, value, error):
        nonlocal native
        if type(api) is not str or api not in (*_FAILURE_APIS.values(), 'system-library', 'unknown'):
            api = 'unknown'
        if type(returned) is not bool:
            native = (None, None, None, None)
            return
        result = ('zero' if value == 0 else 'nonzero') if type(value) is int else (
            'null' if value is None else 'opaque')
        native = (api, returned, result if returned else None,
                  error if returned and type(error) is int and 0 <= error <= 0xffffffff else None)

    def read(error):
        # Exact exception types only; do not invoke exception display hooks.
        kind = 'other'
        for original, label in ((OffloadAdmissionError, 'admission'), (TypeError, 'type'),
                                (ValueError, 'value'), (OSError, 'os')):
            if type(error) is original:
                kind = label
                break
        api, returned, result, os_error = native
        return {'schema_version': 'source-failure-diagnostic-v1', 'actor': actor,
                'phase': phase, 'error_kind': kind, 'api': api, 'returned': returned,
                'result_class': result, 'win32_error': os_error}

    def bind_api(api, functions):
        nonlocal engine
        _need(engine is None and type(api) is _SourceNative
              and api.owner is owner and owner.api is api
              and type(functions) is tuple and 0 < len(functions) <= 64
              and api.diagnostic_bindings is functions)
        for row in functions:
            _need(type(row) is tuple and len(row) == 5 and type(row[1]) is str
                  and row[0] is api.k and getattr(api.k, row[1]) is row[2]
                  and any(row[2] is f and row[3] == args and row[4] is result
                          for f, args, result in api.function_bindings))
        engine = (api, functions)

    def engine_api(api, function):
        if (engine is None or engine[0] is not api
                or api.__dict__.get('diagnostic_bindings') is not engine[1]):
            return 'unknown'
        return _failure_api(function, engine[1])

    _FAILURE_STATES[id(owner)] = (owner, set_phase, capture, read, bind_api, engine_api)


def _failure_phase(owner, phase):
    state = _FAILURE_STATES.get(id(owner))
    if type(state) is tuple and len(state) == 6 and state[0] is owner:
        state[1](phase)


def _failure_native(owner, api, returned=False, value=None, error=None):
    state = _FAILURE_STATES.get(id(owner))
    if type(state) is tuple and len(state) == 6 and state[0] is owner:
        state[2](api, returned, value, error)


def _bind_failure_api(owner, api, functions):
    state = _FAILURE_STATES.get(id(owner))
    if type(state) is tuple and len(state) == 6 and state[0] is owner:
        state[4](api, functions)


def _failure_engine_api(api, function):
    state = _FAILURE_STATES.get(id(api.owner))
    if type(state) is tuple and len(state) == 6 and state[0] is api.owner:
        return state[5](api, function)
    return 'unknown'


def _failure_api(function, functions):
    """Read only the caller's already retained fixed signature table."""
    if function is C.__dict__.get('WinDLL'):
        return 'system-library'
    if type(functions) is tuple and len(functions) <= 64:
        for row in functions:
            if type(row) is tuple and len(row) == 5 and row[2] is function and type(row[1]) is str:
                return _FAILURE_APIS.get(row[1], 'unknown')
    return 'unknown'


def _failure_diagnostic(value):
    """A closed informational shape; never an original-call denial witness."""
    _need(type(value) is dict and value.keys() == {
        'schema_version', 'actor', 'phase', 'error_kind', 'api', 'returned',
        'result_class', 'win32_error'})
    for key, choices in (
            ('schema_version', ('source-failure-diagnostic-v1',)),
            ('actor', ('parent', 'child')), ('phase', _FAILURE_PHASES),
            ('error_kind', ('admission', 'type', 'value', 'os', 'other'))):
        _need(type(value[key]) is str and value[key] in choices)
    _need(value['api'] is None or type(value['api']) is str
          and value['api'] in (*_FAILURE_APIS.values(), 'system-library', 'unknown'))
    _need(value['returned'] is None or type(value['returned']) is bool)
    _need(value['result_class'] is None or type(value['result_class']) is str
          and value['result_class'] in ('zero', 'nonzero', 'null', 'opaque'))
    _need(value['win32_error'] is None or type(value['win32_error']) is int
          and 0 <= value['win32_error'] <= 0xffffffff)
    _need(value['returned'] is True or value['result_class'] is value['win32_error'] is None)
    if value['api'] is None:
        _need(value['returned'] is value['result_class'] is value['win32_error'] is None)
    else:
        _need(type(value['returned']) is bool
              and (value['result_class'] is not None if value['returned'] else value['result_class'] is None))
    return dict(value)


def _read_failure(owner, error):
    """Best effort, with no Native readback, writes, retirement or retries."""
    try:
        state = _FAILURE_STATES.get(id(owner))
        _need(type(state) is tuple and len(state) == 6 and state[0] is owner)
        return _failure_diagnostic(state[3](error))
    except BaseException:
        return None


def _failure_message(value, nonce, source, deadline):
    _need(type(value) is dict and type(value.get('body')) is dict)
    body = value['body']
    _need(body.keys() == {'error', 'source_retired', 'diagnostic'}
          and body['error'] == 'source-session-unavailable' and type(body['error']) is str
          and body['source_retired'] is False)
    diagnostic = _failure_diagnostic(body['diagnostic'])
    _need(diagnostic['actor'] == 'child')
    # The old strict header and error contract still owns the envelope.
    _message({**value, 'body': {'error': body['error'], 'source_retired': False}},
             nonce, source, deadline, response=True)
    _need(type(value['seq']) is int and value['seq'] == 0)
    return diagnostic


def _parent_failure(value):
    _need(type(value) is dict and value.keys() == {
        'schema_version', 'status', 'failure_stage', 'diagnostic',
        'child_diagnostic', 'parent_qualification_granted'}
        and value['schema_version'] == 'owned-source-parent-failure-v1'
        and type(value['schema_version']) is str and value['status'] == 'failed'
        and type(value['status']) is str and value['failure_stage'] == 'source-operation'
        and type(value['failure_stage']) is str and value['parent_qualification_granted'] is False)
    own, child = value['diagnostic'], value['child_diagnostic']
    if own is not None:_need(_failure_diagnostic(own)['actor'] == 'parent')
    if child is not None:_need(_failure_diagnostic(child)['actor'] == 'child')
    return {**value, 'diagnostic': None if own is None else dict(own),
            'child_diagnostic': None if child is None else dict(child)}


def _parent_failure_bytes(owner, error):
    legacy = b'{"schema_version":"owned-source-parent-result-v1","status":"failed","failure_stage":"source-operation","parent_qualification_granted":false}\n'
    try:
        if type(owner) is not _OriginalSourceParent or owner.entry.case != _MAP_DENIAL_CASE:
            return legacy
        value = _parent_failure({
            'schema_version': 'owned-source-parent-failure-v1', 'status': 'failed',
            'failure_stage': 'source-operation', 'diagnostic': _read_failure(owner, error),
            'child_diagnostic': owner.child_diagnostic, 'parent_qualification_granted': False})
        raw = json.dumps(value, sort_keys=True, separators=(',', ':')).encode() + b'\n'
        if len(raw) <= 4096:return raw
    except BaseException:
        pass
    return legacy


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


def _denial_witness(value):
    """Validate diagnostic data only; this supplies no exit or cleanup proof."""
    _need(type(value) is dict and value.keys() == {
        'schema_version', 'phase', 'control_code',
        'requested_level', 'native_return', 'win32_error',
        'target_identity_sha256', 'source_call_count'})
    for field, expected in (
            ('schema_version', 'source-native-denial-v1'),
            ('phase', 'prepare-source')):
        _need(type(value[field]) is str and value[field] == expected)
    for field, expected in (('control_code', 0x90240), ('requested_level', 1),
                            ('native_return', 0), ('win32_error', 801)):
        _need(type(value[field]) is int and value[field] == expected)
    _need(type(value['target_identity_sha256']) is str
          and re.fullmatch('[a-f0-9]{64}', value['target_identity_sha256']) is not None
          and type(value['source_call_count']) is int
          and 0 < value['source_call_count'] <= 16320)
    return value


def _denial_message(value, nonce, source, deadline):
    """Separate qualification response; the old v2 parser stays unchanged."""
    _need(type(value) is dict and type(value.get('body')) is dict)
    body = value['body']
    _need(body.keys() == {'error', 'source_retired', 'denial'}
          and body['source_retired'] is False)
    # Reuse every old header/error check. The parsed negative body remains data.
    _message({**value, 'body': {'error': body['error'], 'source_retired': False}},
             nonce, source, deadline, response=True)
    _need(value['seq'] == 0)
    _denial_witness(body['denial'])
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



class _MappedRegion(C.Structure):
    # MEMORY_BASIC_INFORMATION64. Use fixed Windows widths, not c_ulong.
    _fields_ = [('base', C.c_void_p), ('allocation_base', C.c_void_p),
                ('allocation_protect', C.c_uint32), ('partition', C.c_uint16),
                ('padding', C.c_uint16), ('region_size', C.c_size_t),
                ('state', C.c_uint32), ('protect', C.c_uint32),
                ('kind', C.c_uint32)]


def _mapper_fit(api, directories):
    """Pure graph bound against existing tickets, before mapper acquisition."""
    _need(type(directories) is int and 1 <= directories <= 24)
    api.rows.assert_reserved(api.engine_normal)
    api.rows.assert_reserved(api.engine_final)
    normal = sum(row.binding is None for row in api.engine_normal.rows)
    final = sum(row.binding is None for row in api.engine_final.rows)
    _need(normal >= 3 * directories + 16 + 256
          and final >= directories + 3 + 16)


class _MapperResource:
    """An original output slot, retained even on a partial Native failure."""
    def __init__(self, mapper, kind):
        _need(type(self) is _MapperResource and not hasattr(self, 'origin')
              and kind in ('ancestor', 'writer', 'section', 'view'))
        self.origin, self.mapper, self.kind = self, mapper, kind
        self.slot = C.c_void_p()
        self.original = (mapper, kind, self.slot)
        self.acquire = self.close = None
        self.close_started = self.closed = False

    def number(self):
        mapper = self.mapper
        mapper.live()
        _need(type(self) is _MapperResource and self.origin is self
              and self.original == (mapper, self.kind, self.slot)
              and any(item is self for item in mapper.resources)
              and not self.close_started and not self.closed)
        call = self.acquire
        mapper.acknowledged(call)
        _need(call['output'] is self and type(call['known']) is tuple
              and len(call['known']) == 4 and self.slot.value == call['known'][3]
              and type(self.slot.value) is int
              and 0 < self.slot.value < C.c_void_p(-1).value)
        return self.slot.value


class _SourceMappedDenial:
    """One closed, section-only fixture in the original Source parent.

    This is diagnostic composition, not an application source/worker port. Its
    calls debit the existing parent table. Unknown partial outputs stay held.
    """
    def __init__(self, parent):
        _need(type(self) is _SourceMappedDenial and not hasattr(self, 'origin')
              and _original_actor(parent) is _PARENT_ROLE
              and parent.entry.case == _MAP_DENIAL_CASE and parent.current.seq == 0
              and parent.mapper is self and id(parent) not in _MAPPER_OWNERS)
        self.origin, self.parent, self.api = self, parent, parent.api
        self.resources, self.buffers, self.calls = [], [], []
        self.functions = self.dll = self.dll_facts = None
        self.prepared = self.retirement_started = self.retired = False
        self.identity = self.content = self.size = None
        # Independent originals retain call/output custody before dispatch.
        originals = []
        self.original = (parent, self.api, self.resources, self.buffers, self.calls, originals)
        _MAPPER_OWNERS[id(parent)] = (parent, self, self.original, None)
        _MAPPER_RESOURCES[id(self)] = ()
        self.live()
        path = PureWindowsPath(str(parent.entry.run_root / 'inputs'))
        _need(re.fullmatch(r'[A-Za-z]:\\', path.anchor) is not None)
        self.parts = path.parts
        for name in self.parts[1:]:core._name(name)
        _mapper_fit(self.api, len(self.parts))
        self.dll = self.invoke(C.WinDLL, ('ntdll.dll',), (),
                               variant='system-library', library='ntdll.dll')
        self.dll_facts = (self.dll, self.dll._name, self.dll._handle)
        self._configure()
        self._prepare()

    def live(self):
        _need(type(self) is _SourceMappedDenial and self.origin is self
              and type(_MAPPER_OWNERS.get(id(self.parent))) is tuple
              and len(_MAPPER_OWNERS[id(self.parent)]) == 4
              and all(a is b for a, b in zip(_MAPPER_OWNERS[id(self.parent)][:3],
                                              (self.parent, self, self.original)))
              and self.functions is _MAPPER_OWNERS[id(self.parent)][3]
              and self.parent.mapper is self and type(self.original) is tuple and len(self.original) == 6
              and all(a is b for a, b in zip((self.parent, self.api, self.resources,
                                             self.buffers, self.calls), self.original[:5]))
              and get_ident() == self.parent.thread and not self.retired)
        originals = self.original[5]
        _need(len(self.calls) == len(originals)
              and all(call is facts[0] for call, facts in zip(self.calls, originals)))
        resources = _MAPPER_RESOURCES.get(id(self))
        _need(type(resources) is tuple and len(resources) == len(self.resources)
              and all(actual is item and item.original is facts
                      and item.slot is facts[2] and item.kind is facts[1]
                      for actual, (item, facts) in zip(self.resources, resources)))
        if self.prepared:
            _need(self.prepared_facts is _MAPPER_PREPARED.get(id(self))
                  and (self.parts, self.size, self.identity, self.content) == self.prepared_facts[:4])
        self.api.live()
        _need(self.api is self.parent.api and self.api.role is _PARENT_ROLE
              and self.parent.current is self.parent.requests[0]
              and self.parent.entry.case == _MAP_DENIAL_CASE)
        if self.dll_facts is not None:
            _need(self.dll is self.dll_facts[0] and self.dll._name == self.dll_facts[1]
                  and self.dll._handle == self.dll_facts[2])
        if self.functions is not None:
            for dll, name, function, args, result in self.functions:
                _need(getattr(dll, name) is function and tuple(function.argtypes) == args
                      and function.restype is result)

    def _configure(self):
        ptr, u32, i32 = C.c_void_p, C.c_uint32, C.c_int32
        specs = (
            (self.dll, 'NtCreateFile', (C.POINTER(ptr), u32, ptr, ptr, ptr,
                                       u32, u32, u32, u32, ptr, u32), i32),
            (self.api.k, 'GetFileInformationByHandleEx', (ptr, i32, ptr, u32), i32),
            (self.api.k, 'CreateFileMappingW', (ptr, ptr, u32, u32, u32, C.c_wchar_p), ptr),
            (self.api.k, 'MapViewOfFile', (ptr, u32, u32, u32, C.c_size_t), ptr),
            (self.api.k, 'VirtualQuery', (ptr, ptr, C.c_size_t), C.c_size_t),
            (self.api.k, 'UnmapViewOfFile', (ptr,), i32),
            (self.api.k, 'CloseHandle', (ptr,), i32),
        )
        values = []
        for dll, name, args, result in specs:
            function = getattr(dll, name)
            function.argtypes, function.restype = list(args), result
            values.append((dll, name, function, args, result))
        self.functions = tuple(values)
        _need(_MAPPER_OWNERS[id(self.parent)][3] is None)
        _MAPPER_OWNERS[id(self.parent)] = (self.parent, self, self.original, self.functions)
        # Freeze this table independently of its inspectable field.
        self.function_origin = self.functions

    def invoke(self, function, args, keep, *, output=None, terminal=False,
               variant='scalar', library=None):
        self.live()
        _need(type(args) is tuple and type(keep) is tuple and type(terminal) is bool)
        if variant == 'system-library':
            _need(self.dll is None and self.functions is None and not self.calls
                  and function is C.WinDLL and args == ('ntdll.dll',) and not terminal)
        else:
            _need(variant == 'scalar' and library is None
                  and self.functions is self.function_origin
                  and any(function is row[2] for row in self.functions))
        _need(output is None or type(output) is _MapperResource
              and output.mapper is self and output.acquire is None
              and any(item is output for item in self.resources))
        known_return = None
        def retain_known(value):
            nonlocal known_return
            _need(known_return is None)
            known_return = value
        def read_known():return known_return
        custody = (retain_known, read_known)
        output_slot = None if output is None else output.original[2]
        is_indirect = output_slot is not None and function is self.dll.NtCreateFile
        call = {'function': function, 'args': args, 'keep': keep, 'output': output,
                'terminal': terminal, 'row': None, 'known': None}
        facts = (call, function, args, keep, output, terminal)
        _MAPPER_RETURNS[id(call)] = (call, self, custody, output_slot)
        self.original[5].append(facts)
        self.calls.append(call)
        if output is not None:output.acquire = call
        arena = self.api.rows
        label = _failure_api(function, self.functions)
        _failure_native(self.parent, label)
        row = arena.begin(self.api.engine_final if terminal else self.api.engine_normal,
                          'source-mapper-native', function, args, (self.parent, self, call, keep, custody),
                          terminal=terminal, variant=variant, library=library)
        call['row'] = row
        try:
            if variant == 'system-library':
                value = function(*args, use_last_error=True, winmode=0x800)
            else:value = function(*args)
            error = C.get_last_error() & 0xffffffff
            indirect = output_slot.value if is_indirect else value
            # Known return/output remains in independent originals before validation/ACK.
            known = (value, error, get_ident(), indirect)
            retain_known(known)
            # The prebound closure is also held in the physical row and global
            # original registry. Observation-list drift cannot lose the return.
            if output_slot is not None and not is_indirect:
                output_slot.value = value
            arena.returned(row, value, error)
            _failure_native(self.parent, label, True, value, error)
            _need(self.original[5] and self.original[5][-1] is facts)
            self.original[5][-1] = facts + (row, known)
            call['known'] = known
            self._call_original(call)
            _need(variant == 'system-library' or type(value) is int
                  and (value == 0 if function is self.dll.NtCreateFile else value != 0))
            arena.acknowledge(row)
            return value
        except BaseException:
            arena.fenced = self.api.uncertain = True
            raise

    def _call_original(self, call):
        self.live()
        originals = [v for v in self.original[5] if v[0] is call]
        _need(len(originals) == 1 and len(originals[0]) == 8)
        _, function, args, keep, output, terminal, row, known = originals[0]
        _need(any(item is call for item in self.calls)
              and call.keys() == {'function', 'args', 'keep', 'output', 'terminal', 'row', 'known'}
              and all(call[key] is value for key, value in
                      (('function', function), ('args', args), ('keep', keep), ('output', output),
                       ('terminal', terminal), ('row', row), ('known', known))))
        self.api.rows.member(row)
        binding = row.binding
        completion = self.api.rows.completions[row.index]
        retained = _MAPPER_RETURNS.get(id(call))
        _need(type(retained) is tuple and len(retained) == 4
              and retained[0] is call and retained[1] is self
              and retained[2][1]() is known)
        _need(binding is self.api.rows.bindings[row.index]
              and binding[0] is (self.api.engine_final if terminal else self.api.engine_normal)
              and binding[1] == 'source-mapper-native' and binding[2] is function
              and binding[3] is args and binding[4] == (self.parent, self, call, keep, retained[2])
              and binding[5] == known[2] == get_ident()
              and completion is row.completion and type(completion) is tuple
              and completion[0] is binding and completion[1] is known[0]
              and completion[2:] == (known[1], known[2]))
        return row

    def acknowledged(self, call):
        row = self._call_original(call)
        _need(row.payload is self.api.rows.payloads[row.index]
              and row.payload['acknowledged'] is True
              and row.payload['result'] is call['known'][0]
              and row.payload['os_error'] == call['known'][1])

    def _new(self, kind):
        self.live()
        resource = _MapperResource(self, kind)
        self.resources.append(resource)
        _MAPPER_RESOURCES[id(self)] += ((resource, resource.original),)
        return resource

    def _open(self, parent, name, directory):
        self.live()
        text = C.create_unicode_buffer(name)
        string = core._Unicode(len(name.encode('utf-16-le')), C.sizeof(text), C.cast(text, C.c_void_p))
        attrs = core._Attributes(C.sizeof(core._Attributes),
                                 None if parent is None else parent.number(),
                                 C.pointer(string), 0x40, None, None)
        status = core._Io()
        handle = self._new('ancestor' if directory else 'writer')
        keep = (handle, text, string, attrs, status, parent)
        self.buffers.append(keep)
        self.invoke(self.dll.NtCreateFile,
                    (C.byref(handle.slot), 0x100081 if directory else 0x100083,
                     C.byref(attrs), C.byref(status), None, 0x80, 1, 1,
                     0x200000 | (1 if directory else 0x40), None, 0), keep, output=handle)
        _need(status.status in (None, 0) and status.information == 1)
        tags = (C.c_uint32 * 2)()
        self._information(handle, 9, tags)
        _need(bool(tags[0] & 0x10) is directory
              and not tags[0] & (0x400 | 0x200 | 0x800 | 0x4000 | 0x1000) and tags[1] == 0)
        return handle

    def _information(self, handle, kind, buffer):
        self.buffers.append(buffer)
        self.invoke(self.api.k.GetFileInformationByHandleEx,
                    (handle.number(), kind, C.byref(buffer), C.sizeof(buffer)), (handle, buffer))

    def _identity(self, handle):
        buffer = (C.c_ubyte * 24)()
        self._information(handle, 18, buffer)
        raw = bytes(buffer)
        _need(any(raw[:8]) and any(raw[8:]))
        return raw

    def _close(self, resource):
        number = resource.number()
        resource.close_started = True
        function = self.api.k.UnmapViewOfFile if resource.kind == 'view' else self.api.k.CloseHandle
        self.invoke(function, (number,), (resource,), terminal=True)
        resource.close = self.calls[-1]
        self.acknowledged(resource.close)
        _need(id(resource) not in _MAPPER_CLOSED)
        _MAPPER_CLOSED[id(resource)] = (self, resource, resource.close)
        resource.closed = True

    def _prepare(self):
        ancestors = []
        for index, part in enumerate(self.parts):
            handle = self._open(None if not ancestors else ancestors[-1],
                                '\\??\\' + part if index == 0 else part, True)
            ancestors.append(handle)
            self._identity(handle)
        writer = self._open(ancestors[-1], 'model.safetensors', False)
        identity = self._identity(writer)
        standard = core._Standard()
        self._information(writer, 1, standard)
        _need(0 < standard.size <= 4096 and 0 <= standard.allocated <= 65536
              and standard.links == 1 and not standard.directory and not standard.delete_pending)
        self.size = standard.size
        section = self._new('section')
        self.invoke(self.api.k.CreateFileMappingW, (writer.number(), None, 4, 0, 0, None),
                    (writer,), output=section)
        view = self._new('view')
        self.invoke(self.api.k.MapViewOfFile, (section.number(), 2, 0, 0, self.size),
                    (section,), output=view)
        region = _MappedRegion()
        self.buffers.append(region)
        address = view.number()
        result = self.invoke(self.api.k.VirtualQuery,
                             (address, C.byref(region), C.sizeof(region)), (view, section, region))
        _need(C.sizeof(region) == 48 and result == 48
              and region.base == region.allocation_base == address
              and region.allocation_protect == region.protect == 4
              and region.state == 0x1000 and region.kind == 0x40000
              and self.size <= region.region_size <= 65536)
        _need(view.number() == address and section.number() > 0 and writer.number() > 0)
        raw = C.string_at(address, self.size)
        self.content = hashlib.sha256(raw).hexdigest()
        self.identity = hashlib.sha256(identity).hexdigest()
        self._close(writer)  # Must ACK before the Source child is launched.
        self.prepared_facts = (self.parts, self.size, self.identity, self.content,
                               tuple(ancestors), writer, section, view)
        _MAPPER_PREPARED[id(self)] = self.prepared_facts
        self.prepared = True

    def retire_after_child(self):
        self.live()
        _need(self.prepared and not self.retirement_started)
        self.parent._assert_child_retired_for_mapper(self)
        _need(self.parent.denial['target_identity_sha256'] == self.identity)
        self.retirement_started = True
        ancestors, writer, section, view = self.prepared_facts[4:]
        _need(writer.closed and writer.close_started)
        self.acknowledged(writer.close)
        for resource in (view, section, *reversed(ancestors)):
            self._close(resource)
        for resource in self.resources:
            _need(resource.closed and resource.close_started)
            _need(_MAPPER_CLOSED.get(id(resource)) == (self, resource, resource.close))
            self.acknowledged(resource.close)
        self.retired = True

    def report(self):
        binding = _MAPPER_OWNERS.get(id(self.parent))
        _need(type(binding) is tuple and len(binding) == 4
              and all(a is b for a, b in zip(binding[:3], (self.parent, self, self.original)))
              and self.parent is self.original[0] and self.api is self.original[1]
              and self.parent.mapper is self and self.api is self.parent.api
              and get_ident() == self.parent.thread)
        self.parent.origin()
        self.api.origin()
        proof = _PARENT_RETIREMENTS.get(id(self.parent))
        _need(type(proof) is tuple and len(proof) == 8
              and proof[:4] == (self.parent, self, self.parent.process, self.parent.job)
              and proof[5:] == (9, 0, 1))
        _need(self.retired and self.prepared and self.retirement_started
              and self.prepared_facts is _MAPPER_PREPARED.get(id(self))
              and (self.parts, self.size, self.identity, self.content) == self.prepared_facts[:4])
        graph = _MAPPER_RESOURCES.get(id(self))
        _need(type(graph) is tuple and len(graph) == len(self.resources)
              and all(actual is item and item.original is facts and item.slot is facts[2]
                      and item.closed is True and item.close_started is True
                      and _MAPPER_CLOSED.get(id(item)) == (self, item, item.close)
                      for actual, (item, facts) in zip(self.resources, graph)))
        return {'schema_version': 'source-shared-write-view-v1',
                'target_identity_sha256': self.identity, 'content_sha256': self.content,
                'size': self.size, 'writer_closed_before_child': True,
                'view_held_through_child_exit': True, 'view_unmapped': True,
                'section_and_ancestors_closed': True}


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
                                 str(_PARENT.entry.run_root), handles=handles,
                                 case=_PARENT.entry.case)


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
        self.denial = self.observed_child_exit = None
        self.child_diagnostic = None
        self.mapper = None
        self.original = (entry, self.nonce, self.deadline, self.thread, self.buffers,
                         self.calls, self.handles, self.requests, self.handle_bindings,
                         self.channels, self.process_info)
        _init_failure_state(self, 'parent')

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
        raw = _decode(self._read_bytes(self.channels['response-read'], size))
        if self.entry.case == _MAP_DENIAL_CASE:
            if type(raw.get('body')) is dict and 'diagnostic' in raw['body']:
                self.child_diagnostic = _failure_message(raw, self.nonce, self.source_digest, self.deadline)
                raise OffloadAdmissionError()
            reply = _denial_message(raw, self.nonce, self.source_digest, self.deadline)
        else:
            reply = _message(raw, self.nonce, self.source_digest, self.deadline, response=True)
        _need(all(reply[name] == message[name] for name in _FIELDS - {'body'}))
        if self.entry.case == _MAP_DENIAL_CASE:
            _need(request.seq == 0 and self.denial is None)
            self.denial = reply['body']['denial']
        else:
            _need(reply['body'] == {'state': _STATES[request.seq]})

    def _retire_child(self, *, expected_exit=0):
        _need(type(expected_exit) is int and expected_exit in (0, 9))
        if expected_exit == 9:
            _need(self.entry.case == _MAP_DENIAL_CASE and self.current.seq == 0)
            _denial_witness(self.denial)
        api = self.api
        _need(api.wait((self.process,), self.deadline) == 0)
        code, accounting = C.c_uint32(259), native._Accounting()
        accounting.active = accounting.total = 0xffffffff
        self.buffers.extend((code, accounting))
        api.call(api.k.GetExitCodeProcess, self.process.value, C.byref(code), keep=(self.process, code))
        exit_snapshot, exit_row = code.value, api.rows.order[-1]
        api.call(api.k.QueryInformationJobObject, self.job.value, 1, C.byref(accounting),
                 C.sizeof(accounting), None, keep=(self.job, accounting))
        job_snapshot = (accounting.active, accounting.total)
        _need(code.value == exit_snapshot == expected_exit and job_snapshot == (0, 1))
        if expected_exit == 9:
            _need(id(self) not in _PARENT_RETIREMENTS)
            rows = api.rows.order[-3:]
            _need(len(rows) == 3)
            for row in rows:
                api.rows.member(row)
                record = row.binding[4][1]
                _need(type(record) is _EngineCall)
                record.assert_original(api)
                _need(row.payload['acknowledged'] is True
                      and row.completion is api.rows.completions[row.index])
            _need(rows[0].binding[2] is api.k.WaitForMultipleObjects
                  and rows[0].completion[1] == 0
                  and rows[0].binding[4][2][0] == (self.process,)
                  and rows[1].binding[2] is api.k.GetExitCodeProcess
                  and rows[1] is exit_row
                  and rows[1].binding[4][2] == (self.process, code)
                  and rows[2].binding[2] is api.k.QueryInformationJobObject
                  and rows[2].binding[4][2] == (self.job, accounting))
            _PARENT_RETIREMENTS[id(self)] = (self, self.mapper, self.process, self.job,
                                            rows, exit_snapshot, *job_snapshot)
        self.observed_child_exit = code.value
        for handle in (self.process, self.primary_thread, self.job, *self.channels.values()):
            if not handle.closed:
                api.close(handle)
            handle.assert_closed(api)

    def _assert_child_retired_for_mapper(self, mapper):
        self._live(self.current)
        proof = _PARENT_RETIREMENTS.get(id(self))
        _need(type(proof) is tuple and len(proof) == 8
              and proof[:4] == (self, mapper, self.process, self.job)
              and self.mapper is mapper and self.finishing and proof[5:] == (9, 0, 1))
        for row in proof[4]:
            self.api.rows.member(row)
            row.binding[4][1].assert_original(self.api)
            _need(row.completion is self.api.rows.completions[row.index]
                  and row.payload['acknowledged'] is True)
        for handle in (self.process, self.primary_thread, self.job, *self.channels.values()):
            handle.assert_closed(self.api)

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
                _failure_phase(self, 'parent-native')
                _SourceNative(self)
                self._close_outer_dispatch()
                if self.entry.case == _MAP_DENIAL_CASE:
                    _failure_phase(self, 'mapper-prepare')
                    _need(self.mapper is None)
                    self.mapper = object.__new__(_SourceMappedDenial)
                    self.buffers.append(self.mapper)
                    _SourceMappedDenial.__init__(self.mapper, self)
                _failure_phase(self, 'child-launch')
                self._launch(request)
            _failure_phase(self, 'source-exchange')
            self._exchange_source(request)
            if self.entry.case == _MAP_DENIAL_CASE:
                # A diagnostic negative response never proves retirement. Wait
                # on our original child and Job before closing the owned graph.
                _need(sequence == 0)
                self.finishing = True
                _failure_phase(self, 'child-retirement')
                self._retire_child(expected_exit=9)
                _failure_phase(self, 'mapper-retirement')
                self.mapper.retire_after_child()
                _failure_phase(self, 'timer-retirement')
                self.api.timer.retire()
                for handle in self.handles:
                    handle.assert_closed(self.api)
                self.retired = True
                self._live(request)
                self.state = 'source-denied'
                self.current = None
                return None
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
        if entry.case == _MAP_DENIAL_CASE:
            _failure_phase(_PARENT, 'report-publication')
            _need(_PARENT.retired and _PARENT.state == 'source-denied'
                  and _PARENT.observed_child_exit == 9)
            _denial_witness(_PARENT.denial)
            report = {'schema_version': 'owned-source-parent-denial-v1', 'status': 'denied',
                      'source_digest': entry.digest, 'denial': _PARENT.denial,
                      'mapping': _PARENT.mapper.report(),
                      'native_calls': len(_PARENT.calls),
                      'terminal_calls': sum(row.terminal for row in _PARENT.api.rows.order),
                      'child_exit_code': _PARENT.observed_child_exit,
                      'child_exit_confirmed': True, 'job_active_zero': True,
                      'source_released_by_owned_exit': True, 'source_retired_unused': False,
                      'original_handles_closed': True, 'timer_callbacks_retired': True,
                      'model_started': False, 'borrower_started': False,
                      'production_composed': False, 'parent_qualification_granted': False}
            output = json.dumps(report, sort_keys=True, separators=(',', ':')).encode() + b'\n'
            _need(len(output) <= 4096 and os.write(1, output) == len(output))
            raise SystemExit(0)
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
    except BaseException as error:
        failure = _parent_failure_bytes(_PARENT, error)
        try:os.write(1, failure)
        except BaseException:pass
        api = getattr(_PARENT, 'api', None)
        if type(api) is _SourceNative and hasattr(api, 'k'):
            try:api.escape_exit(9)
            except BaseException:_terminal_halt_without_calls()
        raise SystemExit(9)
