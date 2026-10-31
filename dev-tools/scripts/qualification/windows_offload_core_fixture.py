"""Private fixed fresh-Core qualification support; never a runtime dependency.

Pure declarations/oracles do no native I/O. Native execution is standalone-only
and requires its separately reviewed fixed parent/child owner. No model, old
fixture, caller path/command or production readiness is admitted by JSON.
"""
from __future__ import annotations

import hashlib
import json
import re
import ctypes as C
from dataclasses import dataclass
import importlib.util
import os
from pathlib import Path, PureWindowsPath
import stat
import subprocess
import sys
from threading import get_ident
import time
import types
import uuid

SCHEMA = 'windows-offload-core-native-v2'
CASES = ('deadline-control', 'empty-stage', 'one-index', 'namespace-denied')
CORE_CASES = CASES[1:]
MEMORY_BYTES = 512 * 1024**2
LIMIT_FLAGS = 0x2000 | 0x100 | 0x200 | 0x8
BUDGET_NS = 120 * 1_000_000_000
CONTROL_NS = 3 * 1_000_000_000
MAX_REPORT_BYTES = 8192
MAX_NATIVE_CALLS = 4096
ROOT = Path(__file__).absolute().parents[3]
ENTRY = ROOT / 'dev-tools/scripts/qualification/qualify_windows_offload_core.py'
RUNS = ROOT / '.local-codex/windows-offload-core-native-v2'
TASK_FILES = tuple('modules/adapters/runtime/python/worker/tasks/' + name for name in (
    'local_model_offload.py', 'offload_recovery.py', 'windows_offload_core.py', 'windows_offload_backend.py'))
TOOL_FILES = (
    'dev-tools/scripts/qualification/qualify_windows_offload_core.py',
    'dev-tools/scripts/qualification/windows_offload_core_fixture.py',
)


@dataclass(frozen=True, slots=True, eq=False)
class _FixtureProfile:
    entry: Path
    module_name: str
    schema: str
    cases: tuple
    task_files: tuple
    tool_files: tuple
    runs: Path


_CORE_PROFILE = _FixtureProfile(ENTRY, '_standalone_windows_core_fixture', SCHEMA,
                                CASES, TASK_FILES, TOOL_FILES, RUNS)
_JOURNAL_PROFILE = _FixtureProfile(
    ROOT / 'dev-tools/scripts/qualification/qualify_windows_offload_journal.py',
    '_standalone_windows_journal_engine', 'windows-offload-journal-native-v1',
    ('deadline-control', 'journal-roundtrip', 'journal-namespace-denied'),
    TASK_FILES + ('modules/adapters/runtime/python/worker/tasks/windows_offload_journal.py',),
    ('dev-tools/scripts/qualification/qualify_windows_offload_journal.py', TOOL_FILES[1],
     'dev-tools/scripts/qualification/windows_offload_journal_fixture.py'),
    ROOT / '.local-codex/windows-offload-journal-native-v1')


def _canonical_profile(profile):
    require(type(profile) is _FixtureProfile
            and (profile is _CORE_PROFILE or profile is _JOURNAL_PROFILE), 'fixture-profile')
    return profile


def _profile_for(native):
    # Real owners expose a read-only origin-bound profile. Explicit synthetic
    # ABI fixtures retain the old Core default and confer no native authority.
    return _canonical_profile(getattr(native, 'profile', _CORE_PROFILE))
_NATIVE_OWNERS = []
_HEX = re.compile('[a-f0-9]{64}')
_PHASES = frozenset({
    'none', 'NtCreateFile', 'NtCreateEvent', 'NtSetSecurityObject', 'CloseHandle',
    'GetFileInformationByHandleEx', 'GetVolumeInformationByHandleW',
    'SetFileInformationByHandle', 'DeviceIoControl', 'WaitForSingleObject',
    'CancelIoEx', 'GetOverlappedResult', 'LocalFree', 'GetDriveTypeW',
    'OpenProcessToken', 'GetTokenInformation', 'IsValidSid', 'GetSecurityInfo',
    'GetSecurityDescriptorControl', 'InitializeSecurityDescriptor',
    'SetSecurityDescriptorDacl', 'SetSecurityDescriptorControl',
    'IsValidSecurityDescriptor', 'IsValidAcl', 'directory-page-query',
})
_CHILD_FIELDS = frozenset({
    'schema_version', 'case', 'source_digest', 'outcome', 'expected_refusal',
    'core_created', 'core_cleanup_confirmed', 'core_handles_closed',
    'core_uncertainty_retained', 'index_bytes', 'native_call_count',
    'last_native_phase', 'last_native_return_code', 'last_os_error_code',
    'elapsed_ns', 'timer_configured', 'model_started', 'production_composed',
    'failure_stage',
})


class FixtureError(RuntimeError):
    def __init__(self, stage):
        if type(stage) is not str or not re.fullmatch('[a-z][a-z0-9-]{0,63}', stage):
            stage = 'invalid-stage'
        self.stage = stage
        super().__init__('The isolated Windows staging check did not complete.')


def require(value, stage):
    if not value:
        raise FixtureError(stage)


def decode_report(raw):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_REPORT_BYTES, 'report-size')
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, 'report-duplicate-key')
            value[key] = item
        return value
    def nonfinite(_): raise FixtureError('report-nonfinite')
    try:
        result = json.loads(raw.decode('utf8'), object_pairs_hook=unique, parse_constant=nonfinite)
    except (ValueError, UnicodeError, RecursionError):
        raise FixtureError('report-json') from None
    require(type(result) is dict, 'report-shape')
    return result


def source_digest(hashes):
    require(type(hashes) is dict and 1 <= len(hashes) <= 32, 'source-bindings')
    require(all(type(n) is str and re.fullmatch('[a-zA-Z0-9_./-]{1,200}', n)
                and '..' not in n.split('/') and not n.startswith('/')
                and type(h) is str and _HEX.fullmatch(h) for n, h in hashes.items()), 'source-bindings')
    return hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_child_report(value, case, expected_source):
    """Data oracle only. It never grants a process, file or execution capability."""
    require(type(value) is dict and set(value) == _CHILD_FIELDS, 'report-fields')
    require(case in CASES and value['case'] == case and value['schema_version'] == SCHEMA, 'report-case')
    require(type(expected_source) is str and _HEX.fullmatch(expected_source)
            and value['source_digest'] == expected_source, 'report-source')
    for name in ('expected_refusal', 'core_created', 'core_cleanup_confirmed', 'core_handles_closed',
                 'core_uncertainty_retained', 'timer_configured', 'model_started', 'production_composed'):
        require(type(value[name]) is bool, 'report-boolean')
    require(not value['model_started'] and not value['production_composed'], 'report-scope')
    require(value['timer_configured'] is True, 'report-timer-unconfirmed')
    require(value['failure_stage'] == 'none', 'report-child-failure')
    require(type(value['index_bytes']) is int and value['index_bytes'] in (0, 2), 'report-index')
    require(type(value['native_call_count']) is int and 0 <= value['native_call_count'] <= MAX_NATIVE_CALLS, 'report-count')
    require(type(value['elapsed_ns']) is int and 0 < value['elapsed_ns'] <= BUDGET_NS, 'report-time')
    require(type(value['last_native_phase']) is str and value['last_native_phase'] in _PHASES, 'report-native-phase')
    for name in ('last_native_return_code', 'last_os_error_code'):
        item = value[name]
        require(item is None or type(item) is int and 0 <= item <= 0xffffffff, 'report-native-code')
    if case == 'deadline-control':
        require(value['outcome'] == 'armed' and value['timer_configured']
                and not any(value[n] for n in ('core_created', 'core_cleanup_confirmed', 'core_handles_closed',
                                               'core_uncertainty_retained', 'expected_refusal'))
                and value['native_call_count'] == value['index_bytes'] == 0
                and value['last_native_phase'] == 'none'
                and value['last_native_return_code'] is value['last_os_error_code'] is None,
                'report-deadline-control')
    elif case == 'namespace-denied':
        require(value['outcome'] == 'expected-denial' and value['expected_refusal']
                and value['core_uncertainty_retained'] and not value['core_created']
                and not value['core_cleanup_confirmed'] and not value['core_handles_closed']
                and value['index_bytes'] == 0
                and value['native_call_count'] > 0 and value['last_native_phase'] == 'NtCreateFile'
                and value['last_native_return_code'] == 0xc0000035, 'report-native-refusal')
    else:
        require(value['outcome'] == 'observed' and not value['expected_refusal']
                and value['core_created'] and value['core_cleanup_confirmed'] and value['core_handles_closed']
                and not value['core_uncertainty_retained']
                and value['native_call_count'] > 0
                and value['index_bytes'] == (2 if case == 'one-index' else 0)
                and value['last_native_phase'] == 'CloseHandle'
                and value['last_native_return_code'] not in (None, 0), 'report-positive-core')
    return dict(value)


def validate_parent_observation(value, case, profile=_CORE_PROFILE):
    """Validate observations collected by the actual owner, not a readiness API."""
    profile = _canonical_profile(profile)
    require(type(case) is str and case in profile.cases, 'parent-case')
    fields = {'case', 'process_exit_observed', 'exit_code', 'job_active_zero',
              'membership_read_back', 'limits_read_back', 'dispatch_after_ready',
              'parent_cleanup_confirmed', 'report_bytes', 'elapsed_ns'}
    require(type(value) is dict and set(value) == fields and value['case'] == case, 'parent-fields')
    for name in fields - {'case', 'exit_code', 'report_bytes', 'elapsed_ns'}:
        require(type(value[name]) is bool and value[name], 'parent-observation')
    require(type(value['exit_code']) is int and value['exit_code'] == (2 if case == 'deadline-control' else 0), 'parent-exit')
    require(type(value['report_bytes']) is int and 0 < value['report_bytes'] <= MAX_REPORT_BYTES, 'parent-report-size')
    require(type(value['elapsed_ns']) is int and 0 < value['elapsed_ns'] <= BUDGET_NS, 'parent-time')
    return dict(value)


def _load_file(name, path, expected):
    # -B only suppresses bytecode writes; SourceFileLoader could still execute
    # stale .pyc. Compile the exact bounded hash-checked source buffer instead.
    require(_hash_file(path) == expected, 'source-drift')
    with path.open('rb') as stream: raw = stream.read(2 * 1024**2 + 1)
    require(0 < len(raw) <= 2 * 1024**2 and hashlib.sha256(raw).hexdigest() == expected
            and _hash_file(path) == expected, 'source-drift')
    value = types.ModuleType(name)
    value.__file__, value.__package__ = str(path), name.rpartition('.')[0]
    value.__spec__ = importlib.util.spec_from_loader(name, loader=None)
    sys.modules[name] = value
    exec(compile(raw, str(path), 'exec', dont_inherit=True), value.__dict__)
    require(_hash_file(path) == expected, 'source-drift')
    return value


def _hash_file(path, maximum=2 * 1024**2):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink()
            and not getattr(info, 'st_file_attributes', 0) & 0x400
            and 0 < info.st_size <= maximum, 'source-file')
    def identity(v): return v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns
    value = hashlib.sha256(); count = 0
    with path.open('rb') as stream:
        require(identity(os.fstat(stream.fileno())) == identity(info), 'source-identity')
        while block := stream.read(65536):
            count += len(block)
            require(count <= info.st_size, 'source-size')
            value.update(block)
        require(identity(os.fstat(stream.fileno())) == identity(info), 'source-identity')
    require(count == info.st_size and identity(path.lstat()) == identity(info), 'source-identity')
    return value.hexdigest()


def _repo_hashes(profile=_CORE_PROFILE):
    profile = _canonical_profile(profile)
    values = {name: _hash_file(ROOT / name) for name in profile.task_files + profile.tool_files}
    require(globals().get('_LOADED_SOURCE_SHA256') == values[TOOL_FILES[1]], 'fixture-loaded-source')
    return values


def _all_hashes(native):
    """Bind installed runtime inputs as well as the exact repository component."""
    require(sys.flags.isolated == sys.flags.no_site == 1 and sys.dont_write_bytecode
            and sys.prefix == sys.base_prefix, 'isolated-base-runtime')
    image = Path(native.api.location(True))
    require(image == Path(sys.executable) and image.is_absolute(), 'runtime-image')
    dll = C.create_unicode_buffer(32768); native.buffers.append(dll)
    count = native.call('runtime-dll', native.k.GetModuleFileNameW, sys.dllhandle, dll, len(dll),
                        valid=lambda value: type(value) is int and 0 < value < len(dll))
    require(count == len(dll.value), 'runtime-dll')
    paths = {'runtime-image': image, 'runtime-dll': Path(dll.value)}
    for module in (os, C, hashlib, json, subprocess, uuid):
        paths['runtime-' + module.__name__.replace('.', '-')] = Path(module.__file__)
        cached = getattr(module, '__cached__', None)
        if cached and Path(cached).is_file(): paths['cached-' + module.__name__.replace('.', '-')] = Path(cached)
    return {**_repo_hashes(_profile_for(native)), **{name: _hash_file(path, 64 * 1024**2) for name, path in paths.items()}}


def _private_core_package(expected, profile=_CORE_PROFILE):
    """Load the real four files; skip unrelated package/Pydantic startup only."""
    profile = _canonical_profile(profile)
    sources = profile.task_files + profile.tool_files
    require(_repo_hashes(profile) == {n: expected[n] for n in sources}, 'source-drift')
    name = '_fixed_windows_staging_qualification_tasks'
    require(name not in sys.modules, 'source-package-reentry')
    package = types.ModuleType(name)
    package.__path__ = [str(ROOT / Path(TASK_FILES[0]).parent)]
    package.__spec__ = importlib.util.spec_from_loader(name, loader=None, is_package=True)
    sys.modules[name] = package
    values = {}
    for relative in profile.task_files:
        leaf = Path(relative).stem
        values[leaf] = _load_file(name + '.' + leaf, ROOT / relative, expected[relative])
    require(_repo_hashes(profile) == {n: expected[n] for n in sources}, 'source-drift')
    return values


def _journal_fixture(hashes):
    path = _JOURNAL_PROFILE.tool_files[2]
    return _load_file('_fixed_windows_journal_component', ROOT / path, hashes[path])


class _Handle:
    def __init__(self, owner, name):
        self.owner, self.name = owner, name
        self.value = None
        self.close_started = self.closed = False


# Reuse the existing owned-job probe's fixed Windows ABI and minimal environment
# design locally, without executing that probe's transitive cached-code loaders.
class _BasicLimits(C.Structure):
    _fields_ = [('process_time', C.c_int64), ('job_time', C.c_int64), ('flags', C.c_uint32),
                ('minimum_working_set', C.c_size_t), ('maximum_working_set', C.c_size_t),
                ('active_process_limit', C.c_uint32), ('affinity', C.c_size_t),
                ('priority', C.c_uint32), ('scheduling', C.c_uint32)]


class _IoCounters(C.Structure):
    _fields_ = [(name, C.c_uint64) for name in ('read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes')]


class _ExtendedLimits(C.Structure):
    _fields_ = [('basic', _BasicLimits), ('io', _IoCounters), ('process_memory_limit', C.c_size_t),
                ('job_memory_limit', C.c_size_t), ('peak_process_memory', C.c_size_t), ('peak_job_memory', C.c_size_t)]


class _Security(C.Structure):
    _fields_ = [('length', C.c_uint32), ('descriptor', C.c_void_p), ('inherit', C.c_int32)]


class _Startup(C.Structure):
    _fields_ = [('cb', C.c_uint32), ('reserved', C.c_wchar_p), ('desktop', C.c_wchar_p), ('title', C.c_wchar_p),
                *[(name, C.c_uint32) for name in ('x', 'y', 'width', 'height', 'chars_x', 'chars_y', 'fill', 'flags')],
                ('show', C.c_uint16), ('reserved_size', C.c_uint16), ('reserved_bytes', C.c_void_p),
                ('stdin', C.c_void_p), ('stdout', C.c_void_p), ('stderr', C.c_void_p)]


class _StartupEx(C.Structure):
    _fields_ = [('startup', _Startup), ('attributes', C.c_void_p)]


class _Process(C.Structure):
    _fields_ = [('process', C.c_void_p), ('thread', C.c_void_p), ('pid', C.c_uint32), ('tid', C.c_uint32)]


class _Accounting(C.Structure):
    _fields_ = [(name, C.c_int64) for name in ('user', 'kernel', 'period_user', 'period_kernel')] + [
        (name, C.c_uint32) for name in ('faults', 'total', 'active', 'terminated')]


def _windows_path(value):
    require(type(value) is str and 1 <= len(value) < 32768 and '\0' not in value, 'runtime-path')
    path = PureWindowsPath(value)
    require(path.is_absolute() and len(path.anchor) == 3 and path.anchor[1:] == ':\\' and '..' not in path.parts, 'runtime-path')
    return path


def _isolated_environment(windows):
    path = _windows_path(windows)
    return {'SystemRoot': str(path), 'WINDIR': str(path), 'PATH': str(path / 'System32') + ';' + str(path)}


def _worker_arguments(image, bootstrap, ready, dispatch):
    path = _windows_path(image)
    require(path.name.lower() in ('python.exe', 'python3.exe', 'pythonw.exe'), 'runtime-image')
    return [str(path), '-I', '-S', '-B', '-c', bootstrap, str(ready), str(dispatch)]


class _Windows:
    def __init__(self, owner):
        require((C.sizeof(_BasicLimits), C.sizeof(_ExtendedLimits), C.sizeof(_StartupEx), C.sizeof(_Process)) == (64, 144, 112, 24), 'native-layout')
        self.k = C.WinDLL('kernel32', use_last_error=True)
        self.owner = owner

    def location(self, image):
        text = C.create_unicode_buffer(32768)
        self.owner.buffers.append(text)
        function = self.k.GetModuleFileNameW if image else self.k.GetWindowsDirectoryW
        args = (None, text, len(text)) if image else (text, len(text))
        count = self.owner.call('runtime-location', function, *args,
                                valid=lambda value: type(value) is int and 0 < value < len(text))
        require(type(count) is int and 0 < count < len(text), 'runtime-location')
        _windows_path(text.value)
        return text.value


_ABI = types.SimpleNamespace(Process=_Process, Accounting=_Accounting, Security=_Security, StartupEx=_StartupEx,
                             m=types.SimpleNamespace(ExtendedLimits=_ExtendedLimits))


class _Native:
    """One standalone diagnostic. No caller process target or generic runner."""
    def __init__(self, deadline_ns, *, profile=_CORE_PROFILE):
        self.__profile = _canonical_profile(profile)  # Before any native setup.
        self.__component_thread = get_ident()
        require(os.name == 'nt' and C.sizeof(C.c_void_p) == 8 and sys.implementation.name == 'cpython', 'platform')
        require(type(deadline_ns) is int and 0 < deadline_ns - time.monotonic_ns() <= BUDGET_NS, 'native-budget')
        require(len(_NATIVE_OWNERS) < 8, 'native-owner-limit')
        self.__origin = self
        self.deadline_ns, self.uncertain, self.expired = deadline_ns, False, False
        self.calls, self.buffers, self.handles = [], [], []
        self.pending = None
        self.timer = self.callback = self.due = None
        self.timer_started = self.timer_configured = False
        _NATIVE_OWNERS.append(self)  # Before library/attribute/output acquisition.
        self.job = _ABI
        self.api = _Windows(self)
        self.k = self.api.k
        ptr, u32, i32 = C.c_void_p, C.c_uint32, C.c_int32
        signatures = [
            ('CreateJobObjectW', [ptr, C.c_wchar_p], ptr),
            ('SetInformationJobObject', [ptr, i32, ptr, u32], i32),
            ('QueryInformationJobObject', [ptr, i32, ptr, u32, ptr], i32),
            ('CreateEventW', [C.POINTER(_Security), i32, i32, C.c_wchar_p], ptr),
            ('SetEvent', [ptr], i32), ('GetHandleInformation', [ptr, C.POINTER(u32)], i32),
            ('CloseHandle', [ptr], i32),
            ('InitializeProcThreadAttributeList', [ptr, u32, u32, C.POINTER(C.c_size_t)], i32),
            ('UpdateProcThreadAttribute', [ptr, u32, C.c_size_t, ptr, C.c_size_t, ptr, ptr], i32),
            ('DeleteProcThreadAttributeList', [ptr], None),
            ('CreateProcessW', [C.c_wchar_p, C.c_wchar_p, ptr, ptr, i32, u32, ptr, C.c_wchar_p, C.POINTER(_StartupEx), C.POINTER(_Process)], i32),
            ('IsProcessInJob', [ptr, ptr, C.POINTER(i32)], i32), ('ResumeThread', [ptr], u32),
            ('WaitForSingleObject', [ptr, u32], u32), ('GetExitCodeProcess', [ptr, C.POINTER(u32)], i32),
            ('GetProcessId', [ptr], u32), ('TerminateProcess', [ptr, u32], i32),
            ('GetWindowsDirectoryW', [C.c_wchar_p, u32], u32), ('GetModuleFileNameW', [ptr, C.c_wchar_p, u32], u32),
            ('CreateFileW', [C.c_wchar_p, u32, u32, ptr, u32, u32, ptr], ptr),
            ('GetFileType', [ptr], u32),
            ('GetFileInformationByHandleEx', [ptr, i32, ptr, u32], i32),
            ('GetFileSizeEx', [ptr, C.POINTER(C.c_int64)], i32),
            ('SetFilePointerEx', [ptr, C.c_int64, C.POINTER(C.c_int64), u32], i32),
            ('ReadFile', [ptr, ptr, u32, C.POINTER(u32), ptr], i32),
            ('WriteFile', [ptr, ptr, u32, C.POINTER(u32), ptr], i32),
            ('FlushFileBuffers', [ptr], i32),
            ('GetCurrentProcess', [], ptr),
            ('GetCurrentProcessId', [], u32),
            ('SetHandleInformation', [ptr, u32, u32], i32),
            ('DuplicateHandle', [ptr, ptr, ptr, C.POINTER(ptr), u32, i32, u32], i32),
            ('CreateThreadpoolTimer', [ptr, ptr, ptr], ptr),
            ('SetThreadpoolTimer', [ptr, ptr, u32, u32], None),
            ('IsThreadpoolTimerSet', [ptr], i32),
            ('Sleep', [u32], None),
            ('GetDriveTypeW', [C.c_wchar_p], u32),
        ]
        for label, args, result in signatures:
            fn = getattr(self.k, label); fn.argtypes, fn.restype = args, result

    @property
    def profile(self):
        return _canonical_profile(getattr(self, '_Native__profile', None))

    @property
    def component_thread(self):
        self.origin()
        return self.__component_thread

    def origin(self):
        require(type(self) is _Native and getattr(self, '_Native__origin', None) is self
                and any(value is self for value in _NATIVE_OWNERS), 'native-owner-origin')
        _canonical_profile(getattr(self, '_Native__profile', None))

    def live(self):
        self.origin()
        require(not self.uncertain and not self.expired and time.monotonic_ns() < self.deadline_ns, 'native-deadline')

    def call(self, stage, function, *args, valid=lambda value: type(value) is int and value != 0):
        self.live()
        require(self.pending is None and len(self.calls) < 16384, 'native-call-admission')
        row = {'stage': stage, 'function': function, 'args': args, 'started': False, 'returned': False, 'acknowledged': False, 'result': None, 'os_error': None}
        self.calls.append(row); self.pending = row
        row['started'] = True
        try:
            row['result'] = function(*args)
            row['returned'] = True
            row['os_error'] = C.get_last_error() & 0xffffffff
            require(valid(row['result']), stage)
            self.live()
            row['acknowledged'] = True; self.pending = None
            return row['result']
        except BaseException:
            self.uncertain = True
            raise

    def acquire(self, name, function, *args):
        entry = _Handle(self, name); self.handles.append(entry)
        entry.value = self.call('native-handle-create', function, *args,
                                valid=lambda value: type(value) is int and 0 < value < C.c_void_p(-1).value)
        return entry

    def close(self, entry):
        self.origin()
        require(type(entry) is _Handle and entry.owner is self and any(value is entry for value in self.handles), 'native-handle-owner')
        if entry.closed:
            return
        require(not entry.close_started and type(entry.value) is int and entry.value > 0, 'native-close-state')
        entry.close_started = True
        self.call('native-handle-close', self.k.CloseHandle, entry.value)
        entry.closed = True

    def inherit(self, entry, expected):
        flags = C.c_uint32(); self.buffers.append(flags)
        self.call('native-handle-flags', self.k.GetHandleInformation, entry.value, C.byref(flags))
        require(not flags.value & ~3 and bool(flags.value & 1) is expected, 'native-handle-inheritance')

    def wait(self, entry, maximum_ms):
        self.live()
        remaining = (self.deadline_ns - time.monotonic_ns()) // 1_000_000
        require(type(maximum_ms) is int and maximum_ms >= 0 and remaining > 0, 'native-wait-budget')
        return self.call('native-wait', self.k.WaitForSingleObject, entry.value, min(maximum_ms, remaining),
                         valid=lambda value: type(value) is int and value in (0, 258)) == 0

    def exit_self(self, code):
        # This is deliberately not a caller-selected process or graceful DLL exit.
        try:
            self.origin(); require(type(code) is int and code in (0, 2, 9), 'native-self-exit-code')
            self.k.TerminateProcess(self.k.GetCurrentProcess(), code)
        except BaseException:
            pass
        # A return/interrupt is unconfirmed termination. Never release live
        # callback memory by unwinding, publish success, or repeat termination.
        # Park only this diagnostic; the held deadline callback can still run
        # while WinDLL Sleep releases the GIL. OS/scheduling failure stays unknown.
        _park(native=self)

    def arm_deadline(self):
        self.live(); require(not self.timer_started, 'native-timer-reentry')
        self.timer_started = True
        callback_type = C.WINFUNCTYPE(None, C.c_void_p, C.c_void_p, C.c_void_p)
        def expired(_instance, _context, _timer):
            try:
                self.expired = True
                # WinDLL operations release the GIL, but callback dispatch still
                # needs it. Configuration is not a delivery/termination proof.
                self.k.TerminateProcess(self.k.GetCurrentProcess(), 2)
                self.uncertain = True  # Any return leaves termination unconfirmed.
            except BaseException:
                self.uncertain = True  # No callback traceback or unsafe cleanup.
        self.callback = callback_type(expired)
        self.buffers.append(self.callback)
        self.timer = self.call('native-timer-create', self.k.CreateThreadpoolTimer, C.cast(self.callback, C.c_void_p), None, None,
                               valid=lambda value: type(value) is int and value > 0)
        remaining = self.deadline_ns - time.monotonic_ns(); require(remaining > 0, 'native-timer-budget')
        self.due = C.c_int64(-max(1, remaining // 100)); self.buffers.append(self.due)
        self.call('native-timer-arm', self.k.SetThreadpoolTimer, self.timer, C.byref(self.due), 0, 0, valid=lambda value: value is None)
        self.call('native-timer-setting', self.k.IsThreadpoolTimerSet, self.timer)
        self.timer_configured = True
        # Keep callback/timer alive until exact own-process termination. Never
        # free Python callback memory during DLL/Python finalization or disarm
        # the sole boundary before potentially blocking final report output.


def _park(native):
    """Retain this standalone owner without another termination/cleanup attempt."""
    while True:
        try:
            native.uncertain = True
            native.k.Sleep(0xffffffff)
        except BaseException:
            pass


def _job_limits(native, handle):
    value = native.job.m.ExtendedLimits(); native.buffers.append(value)
    native.call('job-limits', native.k.QueryInformationJobObject, handle, 9, C.byref(value), C.sizeof(value), None)
    require(value.basic.flags == LIMIT_FLAGS and value.basic.active_process_limit == 1
            and value.process_memory_limit == value.job_memory_limit == MEMORY_BYTES, 'job-limits')
    return value


def _job_accounting(native, handle, active):
    value = native.job.Accounting(); native.buffers.append(value)
    native.call('job-accounting', native.k.QueryInformationJobObject, handle, 1, C.byref(value), C.sizeof(value), None)
    require(value.total == 1 and value.active == active and value.terminated == 0, 'job-accounting')
    return value


def _report_size(native, entry):
    value = C.c_int64(); native.buffers.append(value)
    native.call('report-size', native.k.GetFileSizeEx, entry.value, C.byref(value))
    require(0 <= value.value <= MAX_REPORT_BYTES, 'report-size')
    return value.value


def _write_report(native, entry, value):
    raw = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode() + b'\n'
    require(0 < len(raw) <= MAX_REPORT_BYTES and _report_size(native, entry) == 0, 'report-size')
    data = C.create_string_buffer(raw); count = C.c_uint32(); native.buffers.extend((data, count))
    native.call('report-write', native.k.WriteFile, entry.value, data, len(raw), C.byref(count), None)
    require(count.value == len(raw), 'report-write-count')
    native.call('report-flush', native.k.FlushFileBuffers, entry.value)
    require(_report_size(native, entry) == len(raw), 'report-write-size')


def _read_report(native, entry):
    size = _report_size(native, entry); require(size > 0, 'report-size')
    position = C.c_int64(); native.buffers.append(position)
    native.call('report-seek', native.k.SetFilePointerEx, entry.value, 0, C.byref(position), 0)
    require(position.value == 0, 'report-seek')
    data = C.create_string_buffer(size); count = C.c_uint32(); native.buffers.extend((data, count))
    native.call('report-read', native.k.ReadFile, entry.value, data, size, C.byref(count), None)
    require(count.value == size and _report_size(native, entry) == size, 'report-read-count')
    return bytes(data.raw[:size])


def _fresh_directory(path, profile=_CORE_PROFILE):
    """Known diagnostic namespace only; never list or adopt historical runs."""
    profile = _canonical_profile(profile)
    require(ROOT.resolve() == ROOT and path.is_relative_to(profile.runs)
            and path != profile.runs, 'fixture-confinement')
    for current in (ROOT, *[ROOT.joinpath(*path.relative_to(ROOT).parts[:i])
                           for i in range(1, len(path.relative_to(ROOT).parts))]):
        if not current.exists() and not current.is_symlink():
            current.mkdir(mode=0o700)
        info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and not current.is_symlink()
                and not getattr(info, 'st_file_attributes', 0) & 0x400
                and current.resolve() == current, 'fixture-directory')
    path.mkdir(mode=0o700)  # Exclusive final leaf; no collision adoption.
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink()
            and not getattr(info, 'st_file_attributes', 0) & 0x400, 'fixture-directory')
    return info.st_dev, info.st_ino


def _bootstrap(run_id, case, hashes, deadline_ns, ready, dispatch, report, profile=_CORE_PROFILE):
    profile = _canonical_profile(profile)
    require(type(run_id) is str and re.fullmatch('[a-f0-9]{32}', run_id)
            and type(case) is str and case in profile.cases, 'bootstrap-case')
    require(all(type(h) is int and 0 < h < 2**64 - 1 for h in (ready, dispatch, report))
            and len({ready, dispatch, report}) == 3, 'bootstrap-handles')
    require(type(deadline_ns) is int and deadline_ns > 0, 'bootstrap-deadline')
    source_digest(hashes)
    # Fixed source/cases only; no caller code, script/root/model or command slot.
    expected = hashes[TOOL_FILES[1]]
    code = ('import hashlib,types,sys\n'
            'p=' + repr(str(Path(__file__).absolute())) + '\n'
            'with open(p,"rb") as f:b=f.read(2097153)\n'
            'if not (0<len(b)<=2097152 and hashlib.sha256(b).hexdigest()==' + repr(expected) + '):raise RuntimeError("Fixed source unavailable.")\n'
            'm=types.ModuleType("_fixed_core_child_bootstrap");m.__file__=p;sys.modules[m.__name__]=m\n'
            'exec(compile(b,p,"exec",dont_inherit=True),m.__dict__)\n'
            'm._LOADED_SOURCE_SHA256=' + repr(expected) + '\n'
            'm._owned_child(' + ','.join(repr(x) for x in (run_id, case, hashes, deadline_ns, ready, dispatch, report))
            + ',m.' + ('_CORE_PROFILE' if profile is _CORE_PROFILE else '_JOURNAL_PROFILE') + ')\n')
    require(len(code.encode()) <= 16384, 'bootstrap-size')
    return code


class _Session:
    """Actual fixed parent-owned child; output slots exist before dispatch."""
    def __init__(self, native, run_id, case, hashes, folder):
        self.__origin = self
        self.profile = _profile_for(native)
        require(type(case) is str and case in self.profile.cases, 'session-case')
        self.n, self.case, self.folder = native, case, folder
        self.handles = {}
        self.info = native.job.Process(); native.buffers.append(self.info)
        self.attributes = None
        self.attributes_init_started = self.attributes_ready = self.attributes_delete_started = False
        self.create_started = self.create_acknowledged = self.resumed = self.finished = False
        self.uncertain = False
        self.observed = None
        native.buffers.append(self)  # Retain before constructor/prepare handoff.
        try:
            self.prepare(run_id, hashes)
        except BaseException:
            self.uncertain = native.uncertain = True
            raise

    def origin(self):
        require(type(self) is _Session and getattr(self, '_Session__origin', None) is self
                and any(value is self for value in self.n.buffers)
                and _profile_for(self.n) is self.profile, 'session-origin')

    def acquire(self, name, function, *args):
        self.origin(); require(name not in self.handles, 'session-handle-duplicate')
        entry = self.n.acquire(name, function, *args)
        self.handles[name] = entry
        return entry

    def slot(self, name, slot):
        self.origin(); require(name not in self.handles, 'session-handle-duplicate')
        entry = _Handle(self.n, name); self.n.handles.append(entry)
        self.handles[name] = entry
        # The PROCESS_INFORMATION/output slot itself was retained before issue.
        entry.value = slot
        require(type(slot) is int and 0 < slot < C.c_void_p(-1).value, 'session-output-handle')
        require(all(other is entry or other.value != slot for other in self.handles.values()), 'session-output-duplicate')
        return entry

    def prepare(self, run_id, hashes):
        n = self.n; k = n.k; job = n.job
        self.origin(); n.live()
        report = self.acquire('report', k.CreateFileW, str(self.folder / 'result.json'),
                              0xc0000000, 1, None, 1, 0x80200080, None)
        n.inherit(report, False)
        require(n.call('report-file-type', k.GetFileType, report.value) == 1 and _report_size(n, report) == 0, 'report-file-type')
        attributes = (C.c_uint32 * 2)(); n.buffers.append(attributes)
        n.call('report-file-kind', k.GetFileInformationByHandleEx, report.value, 9, C.byref(attributes), C.sizeof(attributes))
        require(not attributes[0] & (0x10 | 0x400), 'report-file-kind')
        inherited = C.c_void_p(); n.buffers.append(inherited)
        n.call('report-handle-duplicate', k.DuplicateHandle, k.GetCurrentProcess(), report.value,
               k.GetCurrentProcess(), C.byref(inherited), 0, 1, 2)
        report_child = self.slot('report-child', inherited.value); n.inherit(report_child, True)
        bound_job = self.acquire('job', k.CreateJobObjectW, None, None); n.inherit(bound_job, False)
        limits = job.m.ExtendedLimits(); n.buffers.append(limits)
        limits.basic.flags, limits.basic.active_process_limit = LIMIT_FLAGS, 1
        limits.process_memory_limit = limits.job_memory_limit = MEMORY_BYTES
        n.call('job-limits-set', k.SetInformationJobObject, bound_job.value, 9, C.byref(limits), C.sizeof(limits))
        _job_limits(n, bound_job.value)
        security = job.Security(C.sizeof(job.Security), None, True); n.buffers.append(security)
        ready = self.acquire('ready', k.CreateEventW, C.byref(security), 1, 0, None)
        dispatch = self.acquire('dispatch', k.CreateEventW, C.byref(security), 1, 0, None)
        n.inherit(ready, True); n.inherit(dispatch, True)
        size = C.c_size_t(); n.buffers.append(size)
        n.call('attribute-size', k.InitializeProcThreadAttributeList, None, 2, 0, C.byref(size),
               valid=lambda ok: type(ok) is int and ok == 0 and C.get_last_error() == 122)
        require(0 < size.value <= 65536, 'attribute-size')
        self.attributes = C.create_string_buffer(size.value); n.buffers.append(self.attributes)
        self.attributes_init_started = True
        n.call('attribute-init', k.InitializeProcThreadAttributeList, self.attributes, 2, 0, C.byref(size))
        self.attributes_ready = True
        jobs = (C.c_void_p * 1)(bound_job.value)
        allowed = (C.c_void_p * 3)(ready.value, dispatch.value, report_child.value)
        startup = job.StartupEx(); n.buffers.extend((jobs, allowed, startup))
        n.call('attribute-job', k.UpdateProcThreadAttribute, self.attributes, 0, 0x2000d,
               C.byref(jobs), C.sizeof(jobs), None, None)
        n.call('attribute-handles', k.UpdateProcThreadAttribute, self.attributes, 0, 0x20002,
               C.byref(allowed), C.sizeof(allowed), None, None)
        startup.startup.cb, startup.attributes = C.sizeof(startup), C.cast(self.attributes, C.c_void_p)
        executable, windows = n.api.location(True), n.api.location(False)
        # Fixed source-owned bootstrap; no generic caller command API.
        argv = _worker_arguments(executable,
                                 _bootstrap(run_id, self.case, hashes, n.deadline_ns, ready.value, dispatch.value, report_child.value, self.profile),
                                 ready.value, dispatch.value)
        require(len(argv) == 8 and argv[1:5] == ['-I', '-S', '-B', '-c'], 'bootstrap-arguments')
        values = _isolated_environment(windows)
        environment = C.create_unicode_buffer('\0'.join(key + '=' + value for key, value in sorted(values.items(), key=lambda row: row[0].casefold())) + '\0')
        command = C.create_unicode_buffer(subprocess.list2cmdline(argv)); n.buffers.extend((environment, command, self.info))
        self.create_started = True
        n.call('atomic-process-create', k.CreateProcessW, executable, command, None, None, True,
               0x80000 | 0x4 | 0x400 | 0x8, environment, str(_windows_path(windows) / 'System32'),
               C.byref(startup), C.byref(self.info))
        self.create_acknowledged = True
        process, thread = self.slot('process', self.info.process), self.slot('thread', self.info.thread)
        require(process.value != thread.value and self.info.pid > 0 and self.info.tid > 0, 'created-process-shape')
        n.inherit(process, False); n.inherit(thread, False)
        require(n.call('created-process-id', k.GetProcessId, process.value) == self.info.pid, 'created-process-id')
        member = C.c_int32(); n.buffers.append(member)
        n.call('atomic-membership', k.IsProcessInJob, process.value, bound_job.value, C.byref(member))
        require(member.value == 1, 'atomic-membership')
        _job_limits(n, bound_job.value); _job_accounting(n, bound_job.value, 1)
        self.attributes_delete_started = True
        n.call('attribute-delete', k.DeleteProcThreadAttributeList, self.attributes, valid=lambda value: value is None)
        self.attributes_ready = False
        n.close(report_child)
        require(n.call('child-resume', k.ResumeThread, thread.value, valid=lambda value: type(value) is int and value == 1) == 1, 'child-resume')
        self.resumed = True; n.close(thread)

    def observe(self):
        self.origin(); n = self.n; k = n.k
        process, job = self.handles['process'], self.handles['job']
        require(n.wait(self.handles['ready'], 8000) and not n.wait(process, 0), 'child-ready')
        _job_limits(n, job.value); _job_accounting(n, job.value, 1)
        n.call('child-dispatch', k.SetEvent, self.handles['dispatch'].value)
        require(n.wait(process, 15000 if self.case == 'deadline-control' else 120000), 'child-exit-unconfirmed')
        code = C.c_uint32(); n.buffers.append(code)
        n.call('child-exit-code', k.GetExitCodeProcess, process.value, C.byref(code))
        require(code.value != 259, 'child-still-active')
        _job_accounting(n, job.value, 0); _job_limits(n, job.value)
        raw = _read_report(n, self.handles['report'])
        self.observed = {'case': self.case, 'process_exit_observed': True, 'exit_code': code.value,
                         'job_active_zero': True, 'membership_read_back': True, 'limits_read_back': True,
                         'dispatch_after_ready': True, 'parent_cleanup_confirmed': False,
                         'report_bytes': len(raw), 'elapsed_ns': 1}
        return raw

    def close(self):
        self.origin(); n = self.n
        require(not self.finished and not self.uncertain and self.observed is not None
                and self.observed['process_exit_observed'] and self.observed['job_active_zero'], 'session-retirement')
        for name in ('process', 'ready', 'dispatch', 'report', 'job'):
            n.close(self.handles[name])
        require(all(value.closed for value in self.handles.values()) and not self.attributes_ready, 'session-retirement')
        self.finished = True
        self.observed['parent_cleanup_confirmed'] = True


def _inherited(native, name, value):
    require(type(value) is int and 0 < value < C.c_void_p(-1).value, 'child-handle')
    require(all(entry.value != value for entry in native.handles), 'child-handle-duplicate')
    entry = _Handle(native, name); native.handles.append(entry)
    entry.value = value
    native.inherit(entry, True)
    return entry


def _child_readback(native):
    member = C.c_int32(); native.buffers.append(member)
    native.call('child-job-membership', native.k.IsProcessInJob, native.k.GetCurrentProcess(), None, C.byref(member))
    require(member.value == 1, 'child-job-membership')
    # NULL queries this process's immediate Job. The parent separately observes
    # membership of its exact created process in its exact held Job handle.
    _job_limits(native, None); _job_accounting(native, None, 1)


def _base_report(case, digest, started):
    return {'schema_version': SCHEMA, 'case': case, 'source_digest': digest,
            'outcome': 'failed', 'expected_refusal': False, 'core_created': False,
            'core_cleanup_confirmed': False, 'core_handles_closed': False,
            'core_uncertainty_retained': False, 'index_bytes': 0, 'native_call_count': 0,
            'last_native_phase': 'none', 'last_native_return_code': None,
            'last_os_error_code': None, 'elapsed_ns': max(1, time.monotonic_ns() - started),
            'timer_configured': False, 'model_started': False, 'production_composed': False,
            'failure_stage': 'none'}


def _tracked_api(core_module, native, diagnostics):
    class TrackedApi(core_module._WindowsApi):
        """Observe real calls; preserve all Core predicates and argument objects."""
        def call(self, function, *args, valid=lambda value: type(value) is int and value != 0, keep=()):
            native.live()
            require(diagnostics['native_call_count'] < MAX_NATIVE_CALLS, 'core-native-call-limit')
            label = getattr(function, '__name__', '')
            if label == 'query': label = 'directory-page-query'
            require(label in _PHASES and label != 'none', 'core-native-phase')
            diagnostics['native_call_count'] += 1
            diagnostics['last_native_phase'] = label
            diagnostics['last_native_return_code'] = diagnostics['last_os_error_code'] = None
            def observe(*actual):
                result = function(*actual)
                # Pointer values are never report data. Only documented scalar
                # result/error codes are retained, including signed NTSTATUS.
                if type(result) is int and -(2**31) <= result <= 0xffffffff:
                    diagnostics['last_native_return_code'] = result & 0xffffffff
                diagnostics['last_os_error_code'] = C.get_last_error() & 0xffffffff
                return result
            result = super().call(observe, *args, valid=valid, keep=(function, observe, *keep))
            native.live()
            return result
    return TrackedApi


def _fixture_execution(core_module, native, hashes):
    from threading import get_ident
    class FixtureExecution(core_module._NativeExecutionPort):
        """Private test-only port, admitted after real Job/handshake checks."""
        def __init__(self):
            self.__origin = self
            self.core = None
            self.thread = get_ident()
            self.busy = False
            native.buffers.append(self)

        def assert_bound(self, core):
            require(type(self) is FixtureExecution and self.__origin is self
                    and self.core is core and get_ident() == self.thread, 'fixture-port-owner')
            native.live(); _child_readback(native)
            require(_all_hashes(native) == hashes, 'source-drift')

        def execute(self, core, operation):
            self.assert_bound(core)
            require(not self.busy and callable(operation), 'fixture-port-reentry')
            self.busy = True
            # This boundary is this owned diagnostic process's parent Job and
            # deadline, not a production thread timeout or caller-supplied proof.
            result = operation()
            self.assert_bound(core)
            self.busy = False
            return result
    return FixtureExecution()


def _exercise_core(native, case, hashes, folder, value):
    require(case in CORE_CASES, 'core-case')
    loaded = _private_core_package(hashes)
    module = loaded['windows_offload_core']
    cache = folder / 'cache'
    _fresh_directory(cache)
    if case == 'namespace-denied':
        # This test alone creates the colliding name. It is never an old model
        # slot, and no path is supplied by the caller or enumerated from disk.
        _fresh_directory(cache / '.aisb-offload-v1')
    port = _fixture_execution(module, native, hashes)
    core = module.WindowsOffloadCore(cache, _api_factory=_tracked_api(module, native, value), _execution=port)
    port.core = core; native.buffers.append(core)
    try:
        core.prepare_fresh_binding()
        if case == 'namespace-denied':
            try:
                core.create_staging(8192)
            except loaded['local_model_offload'].OffloadAdmissionError:
                require(core._uncertain and core._stage is None and core._namespace is None
                        and value['last_native_phase'] == 'NtCreateFile'
                        and value['last_native_return_code'] == 0xc0000035, 'collision-refusal')
                value.update(outcome='expected-denial', expected_refusal=True, core_uncertainty_retained=True)
                return
            raise FixtureError('collision-not-refused')
        stage = core.create_staging(8192)
        value['core_created'] = True
        if case == 'one-index':
            # Fixed two bytes before sealing. No read/open of the sealed file
            # breaks its real Core oplock or changes its cleanup predicates.
            with (stage / 'index.json').open('xb') as stream:
                require(stream.write(b'{}') == 2, 'index-write')
            with (stage / 'index.json').open('rb') as stream:
                require(stream.read(3) == b'{}', 'index-read')
            value['index_bytes'] = 2
        core.seal_staging(); core.assert_sealed()
        core.retire_fresh_staging()
        require(core._retired and not core._uncertain and not core._allocations
                and all(handle.closed for handle in core._handles), 'core-retirement')
        value.update(outcome='observed', core_cleanup_confirmed=True, core_handles_closed=True)
    except BaseException:
        value['core_uncertainty_retained'] = core._uncertain
        raise


def _owned_child(run_id, case, hashes, deadline_ns, ready_value, dispatch_value, report_value,
                 profile=_CORE_PROFILE):
    """Fixed bootstrap only. Never exposed as a generic worker command."""
    started = time.monotonic_ns(); native = report = value = component = None
    try:
        profile = _canonical_profile(profile)
        require(type(run_id) is str and re.fullmatch('[a-f0-9]{32}', run_id)
                and type(case) is str and case in profile.cases, 'child-request')
        require(sys.flags.isolated == sys.flags.no_site == 1 and sys.dont_write_bytecode
                and sys.prefix == sys.base_prefix, 'isolated-base-runtime')
        source = source_digest(hashes)
        native = _Native(deadline_ns, profile=profile)
        require(_all_hashes(native) == hashes, 'source-drift')
        ready = _inherited(native, 'ready', ready_value)
        dispatch = _inherited(native, 'dispatch', dispatch_value)
        report = _inherited(native, 'report', report_value)
        require(native.call('child-report-type', native.k.GetFileType, report.value) == 1
                and _report_size(native, report) == 0, 'child-report-type')
        _child_readback(native)
        native.call('child-ready', native.k.SetEvent, ready.value)
        require(native.wait(dispatch, 8000), 'child-dispatch-timeout')
        _child_readback(native)
        require(_all_hashes(native) == hashes, 'source-drift')
        component = _journal_fixture(hashes) if profile is _JOURNAL_PROFILE else None
        value = (component.base_report(case, source, started) if component is not None
                 else _base_report(case, source, started))
        if case == 'deadline-control':
            native.deadline_ns = min(deadline_ns, time.monotonic_ns() + CONTROL_NS)
        native.arm_deadline()
        require(native.timer_configured is True, 'child-timer-unconfirmed')
        value['timer_configured'] = True
        if case == 'deadline-control':
            value.update(outcome='armed', elapsed_ns=max(1, time.monotonic_ns() - started))
            _write_report(native, report, value)
            # Timer delivery must cause actual native exit2 while WinDLL Sleep
            # releases the GIL. A marker or IsTimerSet result is not a pass.
            native.k.Sleep(0xffffffff)
            raise FixtureError('timer-returned')
        folder = profile.runs / run_id / case
        if component is None:
            _exercise_core(native, case, hashes, folder, value)
        else:
            component.exercise(sys.modules[__name__], native, case, hashes, folder, value)
        require(_all_hashes(native) == hashes, 'source-drift')
        value['elapsed_ns'] = max(1, time.monotonic_ns() - started)
        if component is None: validate_child_report(value, case, source)
        else: component.validate_child_report(value, case, source)
        _write_report(native, report, value)
        for entry in (ready, dispatch, report): native.close(entry)
        native.exit_self(0)
    except BaseException as error:
        if native is not None:
            # Failed diagnostics never authorise another Core operation or try
            # uncertain cleanup. If controller custody is intact, record only
            # allowlisted codes; otherwise the empty report remains a failure.
            if value is not None and report is not None and not native.uncertain:
                value['failure_stage'] = (error.stage if isinstance(error, FixtureError)
                    or component is not None and type(error) is component.JournalFixtureError
                    else 'journal-operation' if profile is _JOURNAL_PROFILE else 'core-operation')
                value['elapsed_ns'] = max(1, time.monotonic_ns() - started)
                try: _write_report(native, report, value)
                except BaseException: pass
            native.exit_self(9)
        raise FixtureError('child-initialization') from None


def _safe_failure(value):
    """Extract bounded diagnostics, never claim a failed case met its oracle."""
    result = {}
    if type(value) is not dict: return result
    # The owning oracle supplies its fixed failure stage. A general label regex
    # would still echo private text placed in a known child field.
    phase = value.get('last_native_phase')
    if type(phase) is str and phase in _PHASES: result['last_native_phase'] = phase
    for name in ('last_native_return_code', 'last_os_error_code', 'native_call_count'):
        item = value.get(name)
        maximum = MAX_NATIVE_CALLS if name == 'native_call_count' else 0xffffffff
        if item is None or type(item) is int and 0 <= item <= maximum: result[name] = item
    return result


def _collect(native, run_id, hashes, folder, rows):
    require(type(rows) is list and not rows, 'collector-initial-state')
    profile = _profile_for(native)
    component = _journal_fixture(hashes) if profile is _JOURNAL_PROFILE else None
    for case in profile.cases:
        native.live()
        case_folder = folder / case
        _fresh_directory(case_folder, profile)
        started = time.monotonic_ns()
        row = {'case': case, 'accepted': False, 'failure_stage': 'setup'}
        rows.append(row)
        session = _Session(native, run_id, case, hashes, case_folder)
        try:
            raw = session.observe()
            session.observed['elapsed_ns'] = max(1, time.monotonic_ns() - started)
            session.close()
            child = decode_report(raw)
            row['parent'] = dict(session.observed)
            try:
                validate_parent_observation(session.observed, case, profile)
                if component is None: validate_child_report(child, case, source_digest(hashes))
                else: component.validate_child_report(child, case, source_digest(hashes))
            except BaseException as error:
                if not (isinstance(error, FixtureError)
                        or component is not None and type(error) is component.JournalFixtureError): raise
                row['diagnostics'] = (_safe_failure(child) if component is None
                                      else component.failure_diagnostics(child))
                row['failure_stage'] = error.stage
                return False
            row['child'] = child  # Only the complete admitted fixed schema.
            row['accepted'] = True
            row['failure_stage'] = 'none'
        except BaseException as error:
            row['failure_stage'] = error.stage if isinstance(error, FixtureError) else 'case-observation'
            session.uncertain = native.uncertain = True
            # No cleanup/retry/resume after unknown issue. Parent self-exit will
            # release its Job, but that is not confirmed worker retirement.
            raise
    return True


def standalone_native():
    """Entry-owned process only; caller imports cannot reach native execution."""
    return _standalone_native(_CORE_PROFILE)


def standalone_native_journal():
    """Dedicated Journal entry; not a mutable switch on the Core entry."""
    return _standalone_native(_JOURNAL_PROFILE)


def _standalone_native(profile):
    profile = _canonical_profile(profile)
    require(__name__ == profile.module_name
            and Path(sys.argv[0]).absolute() == profile.entry and sys.argv[1:] == ['--native']
            and Path.cwd() == ROOT and sys.flags.isolated == sys.flags.no_site == 1
            and sys.dont_write_bytecode and sys.prefix == sys.base_prefix, 'standalone-only')
    started = time.monotonic_ns(); native = None; folder = None; folder_identity = None
    result = {'schema_version': profile.schema, 'status': 'failed', 'cases': [], 'qualification_complete': False,
              'parent_qualification_granted': False, 'production_composed': False,
              'model_started': False, 'quality_tests_executed': False,
              'old_staging_accessed': False, 'source_bindings': {}, 'failure_stage': 'initialization',
              'deadline_scope': 'Owned diagnostic only; callback delivery needs the Python GIL and host scheduling. Sleep/suspend and indefinitely stuck kernel I/O are not qualified.'}
    try:
        native = _Native(started + BUDGET_NS, profile=profile)
        native.arm_deadline()  # Before any case/file/Job creation.
        hashes = _all_hashes(native)
        result['source_bindings'] = hashes
        run_id = uuid.uuid4().hex
        candidate = profile.runs / run_id
        folder_identity = _fresh_directory(candidate, profile)
        folder = candidate  # Ownership is latched only after exclusive success.
        result['run_id'] = run_id
        accepted = _collect(native, run_id, hashes, folder, result['cases'])
        require(_all_hashes(native) == hashes, 'source-drift')
        if accepted:
            result.update(status='evidence-collected-review-required', failure_stage='none')
        else:
            result['failure_stage'] = 'case-not-qualified'
    except BaseException as error:
        result['failure_stage'] = error.stage if isinstance(error, FixtureError) else 'native-operation'
    return _finish_output(native, folder, folder_identity, result, started)


def _finish_output(native, folder, folder_identity, result, started):
    """Keep native callback custody even if final file/stdout publication fails."""
    code = 9
    try:
        # Fixed-size diagnostics only. No unknown native cleanup or next case,
        # raw exception, path, credential, model payload or arbitrary command.
        result['elapsed_ns'] = max(1, time.monotonic_ns() - started)
        if native is not None and native.calls:
            call = native.calls[-1]
            result['controller_diagnostics'] = {'stage': call['stage'], 'returned': call['returned'],
                                                'acknowledged': call['acknowledged'], 'os_error_code': call['os_error'],
                                                'uncertain_custody': native.uncertain,
                                                'call_count': len(native.calls)}
        raw = json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False).encode() + b'\n'
        require(len(raw) <= 32768, 'summary-size')
        if folder is not None:
            info = folder.lstat()
            require((info.st_dev, info.st_ino) == folder_identity and stat.S_ISDIR(info.st_mode)
                    and not getattr(info, 'st_file_attributes', 0) & 0x400 and not folder.is_symlink(), 'summary-folder-identity')
            with (folder / 'summary.json').open('xb') as stream:
                require(stream.write(raw) == len(raw), 'summary-write')
        require(os.write(1, raw) == len(raw), 'summary-output')
        if result['status'] == 'evidence-collected-review-required': code = 0
    except BaseException:
        # Never retry a partially written file/descriptor or unwind into Python
        # teardown while a timer callback/native Job may still be live.
        code = 9
    finally:
        if native is not None:
            try: native.exit_self(code)
            except BaseException: _park(native)
    # Constructor failure means no timer/Job was started. Return one failed
    # outcome instead of raising into the entry's second JSON response.
    return 9
