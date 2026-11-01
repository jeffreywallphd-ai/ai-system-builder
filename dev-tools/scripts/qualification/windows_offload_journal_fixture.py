"""Closed low-level journal diagnostic; no production domain or lease authority.

Imported declarations are pure. Only the separately reviewed shared standalone
engine supplies a real Job/dispatch/timer owner. All paths are freshly created
fixed fixture paths. Unknown API state is retained, never retried or cleaned.
"""
import ctypes as C
import hashlib
import re
from threading import get_ident
import time
import uuid

SCHEMA = 'windows-offload-journal-native-v2'
CASES = ('deadline-control', 'journal-roundtrip', 'journal-namespace-denied', 'journal-mutation-denied')
REPEATED_READS = 8
MAX_CALLS, MAX_HANDLES = 4096, 136
# label, exact target, one desired right, FILE_CREATE, directory. No caller input.
_PROBES = (
    ('file-write-data', 'file', 2, False, False),
    ('file-append-data', 'file', 4, False, False),
    ('file-delete', 'file', 0x10000, False, False),
    ('file-write-dac', 'file', 0x40000, False, False),
    ('file-write-owner', 'file', 0x80000, False, False),
    ('namespace-add-file', 'namespace', 2, False, True),
    ('namespace-add-directory', 'namespace', 4, False, True),
    ('namespace-delete-child', 'namespace', 0x40, False, True),
    ('namespace-delete', 'namespace', 0x10000, False, True),
    ('namespace-write-dac', 'namespace', 0x40000, False, True),
    ('namespace-write-owner', 'namespace', 0x80000, False, True),
    ('child-create', 'child', 2, True, False),
    ('stream-create', 'stream', 2, True, False),
    ('parent-delete-child', 'parent', 0x40, False, True),
)
_PROBE_LABELS = frozenset(row[0] for row in _PROBES) | {'none', 'resize-handle-control'}
_PROBE_FLAGS = ('probe_identity_readback', 'probe_handles_closed', 'probe_cleanup_confirmed',
                'probe_uncertainty_retained', 'parent_delete_child_denied', 'resize_control_denied')
_PROBE_COUNTS = ('probe_native_call_count', 'probe_unretired_handle_records')
_PROBE_FIELDS = ('probe_results', 'probe_last_label', 'probe_last_native_return_code',
                 'resize_native_return_code', 'resize_os_error_code',
                 *_PROBE_FLAGS, *_PROBE_COUNTS)
_PHASES = frozenset({
    'none', 'NtCreateFile', 'NtCreateEvent', 'NtSetSecurityObject', 'CloseHandle',
    'GetFileInformationByHandleEx', 'GetVolumeInformationByHandleW',
    'SetFileInformationByHandle', 'DeviceIoControl', 'WaitForSingleObject',
    'CancelIoEx', 'GetOverlappedResult', 'LocalFree', 'GetDriveTypeW',
    'OpenProcessToken', 'GetTokenInformation', 'IsValidSid', 'GetSecurityInfo',
    'GetSecurityDescriptorControl', 'GetSecurityDescriptorLength',
    'SetSecurityDescriptorOwner', 'InitializeSecurityDescriptor',
    'SetSecurityDescriptorDacl', 'SetSecurityDescriptorControl',
    'IsValidSecurityDescriptor', 'IsValidAcl', 'directory-page-query',
    'DuplicateHandle', 'NtQueryVolumeInformationFile', 'NtWriteFile', 'NtReadFile',
    'FlushFileBuffers',
})
_FLAGS = ('expected_refusal', 'api_created', 'api_cleanup_confirmed', 'api_handles_closed',
          'api_uncertainty_retained', 'guard_retirement_confirmed',
          'history_intentionally_retained', 'collision_namespace_created',
          'timer_configured', 'model_started', 'production_composed', 'shared_domain_qualified')
_COUNTS = ('journal_frames', 'journal_data_bytes', 'allocated_bytes', 'repeated_reads',
           'peak_live_data_irps', 'live_data_irps_after', 'unretired_handle_records', 'native_call_count')
_FIELDS = frozenset(('schema_version', 'case', 'source_digest', 'outcome',
                     'last_native_phase', 'last_native_return_code', 'last_os_error_code',
                     'elapsed_ns', 'failure_stage', *_FLAGS, *_COUNTS, *_PROBE_FIELDS))
_FAILURE_STAGES = frozenset({
    'journal-operation', 'journal-report-fields', 'journal-report-case',
    'journal-report-source', 'journal-report-boolean', 'journal-report-count',
    'journal-report-scope', 'journal-report-time', 'journal-report-phase',
    'journal-report-status', 'journal-report-live-bounds', 'journal-report-control',
    'journal-report-roundtrip', 'journal-report-collision',
    'journal-api-construction', 'journal-api-owner', 'journal-api-admission',
    'journal-api-result', 'journal-read-chain',
    'journal-source-drift', 'journal-api-unsettled', 'journal-native-admission',
    'journal-native-phase', 'journal-native-result', 'journal-fixture-case',
    'journal-collision-refusal', 'journal-collision-not-refused', 'journal-readback',
    'journal-prefix', 'journal-repeat-readback', 'journal-live-custody-growth',
    'journal-final-file', 'journal-retirement',
    'journal-report-probes', 'journal-probe-original', 'journal-probe-path',
    'journal-probe-identity', 'journal-probe-readback', 'journal-probe-denial',
    'journal-probe-custody', 'journal-probe-resize', 'journal-probe-retirement',
})


class JournalFixtureError(RuntimeError):
    def __init__(self, stage):
        self.stage = stage if type(stage) is str and stage in _FAILURE_STAGES else 'journal-operation'
        super().__init__('The isolated journal check did not complete.')


def _need(value, stage):
    if not value: raise JournalFixtureError(stage)


def _void(function, *args):
    _need(function(*args) is None, 'journal-api-result')


def base_report(case, source, started):
    return {'schema_version': SCHEMA, 'case': case, 'source_digest': source,
            'outcome': 'observed', 'last_native_phase': 'none',
            'last_native_return_code': None, 'last_os_error_code': None,
            'elapsed_ns': max(1, time.monotonic_ns() - started), 'failure_stage': 'none',
            **{name: False for name in (*_FLAGS, *_PROBE_FLAGS)},
            **{name: 0 for name in (*_COUNTS, *_PROBE_COUNTS)},
            'probe_results': [], 'probe_last_label': 'none', 'probe_last_native_return_code': None,
            'resize_native_return_code': None, 'resize_os_error_code': None}


def validate_child_report(value, case, source):
    _need(type(value) is dict and set(value) == _FIELDS, 'journal-report-fields')
    _need(type(case) is str and case in CASES and value['case'] == case
          and value['schema_version'] == SCHEMA, 'journal-report-case')
    _need(type(source) is str and re.fullmatch('[a-f0-9]{64}', source)
          and value['source_digest'] == source, 'journal-report-source')
    for name in _FLAGS: _need(type(value[name]) is bool, 'journal-report-boolean')
    for name in _COUNTS:
        _need(type(value[name]) is int and 0 <= value[name] <= MAX_CALLS * 65536,
              'journal-report-count')
    _need(value['timer_configured'] is True and value['failure_stage'] == 'none'
          and not any(value[n] for n in ('model_started', 'production_composed', 'shared_domain_qualified')),
          'journal-report-scope')
    _need(type(value['elapsed_ns']) is int and 0 < value['elapsed_ns'] <= 120 * 10**9,
          'journal-report-time')
    _need(type(value['last_native_phase']) is str and value['last_native_phase'] in _PHASES,
          'journal-report-phase')
    for name in ('last_native_return_code', 'last_os_error_code'):
        item = value[name]
        _need(item is None or type(item) is int and 0 <= item <= 0xffffffff,
              'journal-report-status')
    _need(value['native_call_count'] <= MAX_CALLS and value['peak_live_data_irps'] <= 1
          and value['live_data_irps_after'] <= 1 and value['unretired_handle_records'] <= MAX_HANDLES,
          'journal-report-live-bounds')
    _validate_probes(value, active=case == 'journal-mutation-denied')
    if case == 'deadline-control':
        _need(value['outcome'] == 'armed' and value['last_native_phase'] == 'none'
              and value['last_native_return_code'] is value['last_os_error_code'] is None
              and not any(value[n] for n in _COUNTS)
              and not any(value[n] for n in _FLAGS if n != 'timer_configured'),
              'journal-report-control')
    elif case in ('journal-roundtrip', 'journal-mutation-denied'):
        _need(value['outcome'] == 'observed' and value['api_created']
              and value['api_cleanup_confirmed'] and value['api_handles_closed']
              and value['guard_retirement_confirmed'] and value['history_intentionally_retained']
              and not value['expected_refusal'] and not value['api_uncertainty_retained']
              and not value['collision_namespace_created']
              and value['journal_frames'] == 5 and value['journal_data_bytes'] == 2560
              and 2560 <= value['allocated_bytes'] <= 65536
              and value['repeated_reads'] == REPEATED_READS and value['peak_live_data_irps'] == 1
              and value['live_data_irps_after'] == value['unretired_handle_records'] == 0
              and value['native_call_count'] > 0 and value['last_native_phase'] == 'CloseHandle'
              and value['last_native_return_code'] not in (None, 0), 'journal-report-roundtrip')
    else:
        _need(value['outcome'] == 'expected-denial' and value['expected_refusal']
              and value['collision_namespace_created'] and value['api_uncertainty_retained']
              and not any(value[n] for n in ('api_created', 'api_cleanup_confirmed', 'api_handles_closed',
                                            'guard_retirement_confirmed', 'history_intentionally_retained'))
              and not any(value[n] for n in ('journal_frames', 'journal_data_bytes', 'allocated_bytes',
                                            'repeated_reads', 'peak_live_data_irps', 'live_data_irps_after'))
              and value['unretired_handle_records'] > 0 and value['native_call_count'] > 0
              and value['last_native_phase'] == 'NtCreateFile'
              and value['last_native_return_code'] == 0xc0000035, 'journal-report-collision')
    return dict(value)


def _validate_probes(value, *, active):
    for name in _PROBE_FLAGS: _need(type(value[name]) is bool, 'journal-report-probes')
    for name in _PROBE_COUNTS:
        maximum = MAX_CALLS if name.endswith('call_count') else MAX_HANDLES
        _need(type(value[name]) is int and 0 <= value[name] <= maximum, 'journal-report-probes')
    _need(type(value['probe_last_label']) is str and value['probe_last_label'] in _PROBE_LABELS,
          'journal-report-probes')
    status = value['probe_last_native_return_code']
    _need(status is None or type(status) is int and 0 <= status <= 0xffffffff, 'journal-report-probes')
    rows = value['probe_results']
    _need(type(rows) is list and len(rows) <= len(_PROBES), 'journal-report-probes')
    if not active:
        _need(not rows and value['probe_last_label'] == 'none' and status is None
              and value['resize_native_return_code'] is value['resize_os_error_code'] is None
              and not any(value[n] for n in (*_PROBE_FLAGS, *_PROBE_COUNTS)), 'journal-report-probes')
        return
    _need(len(rows) == len(_PROBES) and value['probe_native_call_count'] > 0
          and value['probe_unretired_handle_records'] == 0
          and all(value[n] for n in _PROBE_FLAGS if n != 'probe_uncertainty_retained')
          and not value['probe_uncertainty_retained']
          and value['probe_last_label'] == 'parent-delete-child' and status == 0xc0000022
          and type(value['resize_native_return_code']) is int and value['resize_native_return_code'] == 0
          and type(value['resize_os_error_code']) is int and value['resize_os_error_code'] == 5,
          'journal-report-probes')
    for row, definition in zip(rows, _PROBES):
        _need(type(row) is dict and set(row) == {'label', 'native_status', 'output_absent'}
              and type(row['label']) is str and row['label'] == definition[0]
              and type(row['native_status']) is int and row['native_status'] == 0xc0000022
              and row['output_absent'] is True, 'journal-report-probes')


def failure_diagnostics(value):
    """Unqualified bounded failure facts, never the failed child payload."""
    if type(value) is not dict: return {}
    result = {}
    if type(value.get('failure_stage')) is str and value['failure_stage'] in _FAILURE_STAGES:
        result['component_failure_stage'] = value['failure_stage']
    if type(value.get('last_native_phase')) is str and value['last_native_phase'] in _PHASES:
        result['last_native_phase'] = value['last_native_phase']
    for name in ('last_native_return_code', 'last_os_error_code', 'native_call_count',
                 'probe_last_native_return_code', 'probe_native_call_count',
                 'probe_unretired_handle_records', 'resize_native_return_code', 'resize_os_error_code'):
        item = value.get(name)
        maximum = MAX_CALLS if name.endswith('call_count') else MAX_HANDLES if name.endswith('handle_records') else 0xffffffff
        if item is None or type(item) is int and 0 <= item <= maximum: result[name] = item
    for name in ('api_created', 'api_uncertainty_retained', 'collision_namespace_created',
                 *_PROBE_FLAGS):
        if type(value.get(name)) is bool: result[name] = value[name]
    label = value.get('probe_last_label')
    if type(label) is str and label in _PROBE_LABELS: result['probe_last_label'] = label
    return result


class _ApiOwner:
    """Fixture-only native custody, never a production domain or phase owner."""
    def __init__(self, engine, native, journal, hashes, report):
        _need(type(native) is engine._Native
              and engine._profile_for(native) is engine._JOURNAL_PROFILE
              and native.timer_configured is True, 'journal-api-owner')
        native.live()  # Reject a copied controller before mutating its buffers.
        self.__origin = self
        self.engine, self.native, self.journal, self.hashes, self.report = engine, native, journal, hashes, report
        self.thread = get_ident()
        self._handles, self._guards, self._allocations, self._irps, self._calls = [], [], [], [], []
        self._probe_attempts = []
        self._pending = self._dispatch = self._retiring_io = self._constructing_api = self._api = None
        self._busy = self._uncertain = False
        native.buffers.append(self)  # Before constructor or callback acquisition.
        try:
            self.origin()
            engine._child_readback(native)
            _need(engine._all_hashes(native) == hashes, 'journal-source-drift')
            self._api = journal._WindowsJournalApi(self)
            _need(type(self._api) is journal._WindowsJournalApi
                  and self._constructing_api is self._api and self._api.owner is self,
                  'journal-api-construction')
        except BaseException:
            self._uncertain = True
            raise

    def origin(self):
        _need(type(self) is _ApiOwner and getattr(self, '_ApiOwner__origin', None) is self
              and type(self.native) is self.engine._Native
              and any(v is self for v in self.native.buffers)
              and self.engine._profile_for(self.native) is self.engine._JOURNAL_PROFILE
              and self.native.timer_configured is True
              and self.thread == get_ident() == self.native.component_thread, 'journal-api-owner')
        self.native.live()

    def run(self, function):
        self.origin()  # A copied owner cannot poison the real context.
        try:
            _need(not self._uncertain and not self._busy and self._dispatch is None,
                  'journal-api-admission')
            self._busy = True
            self._dispatch = {'thread': get_ident(), 'function': function, 'finished': False}
            self.engine._child_readback(self.native)
            _need(self.engine._all_hashes(self.native) == self.hashes, 'journal-source-drift')
            result = function()
            _need(not self._uncertain and self._pending is None, 'journal-api-unsettled')
            self.engine._child_readback(self.native)
            _need(self.engine._all_hashes(self.native) == self.hashes, 'journal-source-drift')
            self._dispatch['finished'] = True
            self._dispatch = None; self._busy = False
            return result
        except BaseException:
            self._uncertain = True  # Includes post-call predicates/bookkeeping.
            raise

    def _native_call(self, function, args, valid, keep):
        self.origin()
        try:
            _need(not self._uncertain and self._busy and self._dispatch is not None
                  and self._dispatch['thread'] == get_ident()
                  and not self._dispatch['finished'] and self._pending is None
                  and len(self._calls) < MAX_CALLS, 'journal-native-admission')
            label = getattr(function, '__name__', '')
            if label == 'query': label = 'directory-page-query'
            _need(label in _PHASES and label != 'none', 'journal-native-phase')
            row = {'function': function, 'args': args, 'valid': valid, 'keep': keep,
                   'started': False, 'returned': False, 'acknowledged': False, 'result': None}
            self._calls.append(row); self._pending = row
            self.report['native_call_count'] = len(self._calls)
            self.report['last_native_phase'] = label
            self.report['last_native_return_code'] = self.report['last_os_error_code'] = None
            self.report['peak_live_data_irps'] = max(self.report['peak_live_data_irps'], len(self._irps))
            row['started'] = True; row['result'] = function(*args); row['returned'] = True
            if type(row['result']) is int and -(2**31) <= row['result'] <= 0xffffffff:
                self.report['last_native_return_code'] = row['result'] & 0xffffffff
            self.report['last_os_error_code'] = C.get_last_error() & 0xffffffff
            _need(valid(row['result']) and not self._uncertain, 'journal-native-result')
            self.native.live()
            row['acknowledged'] = True; self._pending = None
            return row['result']
        except BaseException:
            self._uncertain = True
            raise


def _probe_chain(api, w, cache):
    """Fresh read-only contenders allow all sharing; no old writer can deny access."""
    _need(re.fullmatch(r'[A-Za-z]:\\', cache.anchor) and 2 <= len(cache.parts) <= 128
          and cache.name == 'cache', 'journal-probe-path')
    api.call(api.k.GetDriveTypeW, cache.anchor, valid=lambda kind: type(kind) is int and kind == 3)
    chain = [api.open(None, '\\??\\' + cache.anchor, 0x200a0, share=7)]
    filesystem, flags = C.create_unicode_buffer(32), w._U32()
    api.call(api.k.GetVolumeInformationByHandleW, chain[0].value, None, 0, None, None,
             C.byref(flags), filesystem, 32, keep=(filesystem, flags))
    _need(filesystem.value == 'NTFS' and flags.value & 8, 'journal-probe-path')
    for part in cache.parts[1:]: chain.append(api.open(chain[-1], part, 0x200a0, share=7))
    return tuple((handle, api.identity(handle)) for handle in chain)


def _deny_open(api, w, j, definition, chain):
    """One fixed access request, retained before dispatch; no delete/rename/setter."""
    owner = api.owner
    _need(any(definition is row for row in _PROBES)
          and len(owner._probe_attempts) < len(_PROBES), 'journal-probe-custody')
    label, target, access, create, directory = definition
    parent, name = {
        'file': (api.namespace[0], j._FILE),
        'namespace': (chain[-1][0], j._NAMESPACE),
        'parent': (chain[-2][0], 'cache'),
        'child': (api.namespace[0], 'denied-child.bin'),
        'stream': (api.namespace[0], j._FILE + ':denied-stream'),
    }[target]
    output, text, io = w._PTR(), C.create_unicode_buffer(name), w._Io()
    string = w._Unicode(len(name.encode('utf-16-le')), C.sizeof(text), C.cast(text, w._PTR))
    attributes = w._Attributes(C.sizeof(w._Attributes), parent.value, C.pointer(string), 0x40, None, None)
    attempt = (definition, parent, output, text, io, string, attributes)
    owner._probe_attempts.append(attempt)  # Includes unexpected success output before dispatch.
    owner.report['probe_last_label'] = label
    owner.report['probe_last_native_return_code'] = None
    status = api.call(api.n.NtCreateFile, C.byref(output), access, C.byref(attributes), C.byref(io),
                      None, 0x80, 7, 2 if create else 1,
                      0x200000 | (1 if directory else 0x40), None, 0,
                      valid=lambda code: type(code) is int and -(2**31) <= code <= 0xffffffff,
                      keep=attempt)
    status &= 0xffffffff
    owner.report['probe_last_native_return_code'] = status
    row = {'label': label, 'native_status': status, 'output_absent': output.value is None}
    owner.report['probe_results'].append(row)
    # Sharing violation (C0000043), missing object and unexpected grants are failures.
    _need(status == 0xc0000022 and output.value is None, 'journal-probe-denial')
    if target == 'parent': owner.report['parent_delete_child_denied'] = True


def _resize_control(api):
    owner = api.owner
    owner.report['probe_last_label'] = 'resize-handle-control'
    owner.report['probe_last_native_return_code'] = None
    size = C.c_int64(0)
    C.set_last_error(0)
    result = api.call(api.k.SetFileInformationByHandle, api.file[0].value, 6, C.byref(size), C.sizeof(size),
                      valid=lambda code: type(code) is int and -(2**31) <= code <= 0x7fffffff,
                      keep=(api.file, size))
    error = C.get_last_error() & 0xffffffff
    owner.report['probe_last_native_return_code'] = result & 0xffffffff
    owner.report['resize_native_return_code'], owner.report['resize_os_error_code'] = result & 0xffffffff, error
    _need(result == 0 and error == 5, 'journal-probe-resize')
    owner.report['resize_control_denied'] = True  # Handle-right control only, not DACL proof.


def _mutation_checks(engine, native, j, w, hashes, cache, original, history, value):
    owner = object.__new__(_ApiOwner)
    probe = base_report('journal-mutation-denied', value['source_digest'], time.monotonic_ns())
    try:
        _need(value['api_cleanup_confirmed'] and value['api_handles_closed']
              and value['guard_retirement_confirmed'], 'journal-probe-original')
        _ApiOwner.__init__(owner, engine, native, j, hashes, probe)
        api = owner._api
        chain = owner.run(lambda: _probe_chain(api, w, cache))
        _need(tuple(item[1] for item in chain) == original[0], 'journal-probe-identity')
        def open_objects():
            namespace = api.open(chain[-1][0], j._NAMESPACE, 0x200a1, share=7)
            api.namespace = namespace, api.identity(namespace), None
            file = api.open(namespace, j._FILE, 0x20081, directory=False, share=7)
            api.file = file, api.identity(file), None
        owner.run(open_objects)
        def positive():
            _need(api.namespace[1] == original[1] and api.file[1] == original[3]
                  and api.security(api.namespace[0]) == original[2]
                  and api.security(api.file[0]) == original[4]
                  and api.file_facts(api.file[0]) == original[5], 'journal-probe-identity')
            _need(api.read(len(history)) == history, 'journal-probe-readback')
        owner.run(positive)
        probe['probe_identity_readback'] = True
        for definition in _PROBES[:-1]:
            owner.run(lambda: _deny_open(api, w, j, definition, chain))
        owner.run(lambda: _resize_control(api))
        owner.run(lambda: _deny_open(api, w, j, _PROBES[-1], chain))
        owner.run(positive)  # No mutation or stream growth after denied attempts.
        owner.run(lambda: _void(api.retire))
        _need(not owner._uncertain and not owner._irps and owner._retiring_io is None
              and not owner._allocations and all(h.closed for h in owner._handles)
              and all(g['retired'] is True for g in owner._guards), 'journal-probe-retirement')
        probe.update(probe_handles_closed=True, probe_cleanup_confirmed=True)
    except BaseException:
        if getattr(owner, '_ApiOwner__origin', None) is owner:
            owner._uncertain = True
            probe['probe_uncertainty_retained'] = any(v is owner for v in native.buffers)
        raise
    finally:
        if getattr(owner, '_ApiOwner__origin', None) is owner:
            probe['probe_native_call_count'] = len(owner._calls)
            probe['probe_unretired_handle_records'] = (sum(not h.closed for h in owner._handles)
                + sum(attempt[2].value is not None for attempt in owner._probe_attempts))
        value.update({name: probe[name] for name in _PROBE_FIELDS})


def exercise(engine, native, case, hashes, folder, value):
    _need(engine._profile_for(native) is engine._JOURNAL_PROFILE
          and case in CASES[1:], 'journal-fixture-case')
    modules = engine._private_core_package(hashes, engine._JOURNAL_PROFILE)
    j = modules['windows_offload_journal']; w = modules['windows_offload_core']
    cache = folder / 'cache'
    engine._fresh_directory(cache, engine._JOURNAL_PROFILE)
    if case == 'journal-namespace-denied':
        engine._fresh_directory(cache / j._NAMESPACE, engine._JOURNAL_PROFILE)
        value['collision_namespace_created'] = True
    owner = object.__new__(_ApiOwner)  # Exact output reference before __init__.
    try:
        _ApiOwner.__init__(owner, engine, native, j, hashes, value)
        api = owner._api
        chain = owner.run(lambda: w._WindowsApi.prepare(api, cache))
        _need(type(chain) is tuple and 1 <= len(chain) <= 128, 'journal-read-chain')
        owner.run(lambda: _void(api.duplicate_anchor, chain[-1][0], chain[-1][1]))
        if case == 'journal-namespace-denied':
            try: owner.run(lambda: _void(api.prepare))
            except (j.OffloadAdmissionError, JournalFixtureError):
                _need(owner._uncertain and owner._pending is not None and api.namespace is None
                      and owner._pending['function'] is api.n.NtCreateFile
                      and owner._pending['returned'] and not owner._pending['acknowledged']
                      and type(owner._pending['result']) is int
                      and owner._pending['result'] & 0xffffffff == 0xc0000035
                      and value['last_native_phase'] == 'NtCreateFile'
                      and value['last_native_return_code'] == 0xc0000035, 'journal-collision-refusal')
                value.update(outcome='expected-denial', expected_refusal=True,
                             api_uncertainty_retained=True,
                             unretired_handle_records=sum(not h.closed for h in owner._handles))
                return
            raise JournalFixtureError('journal-collision-not-refused')
        owner.run(lambda: _void(api.prepare)); value['api_created'] = True
        generation = uuid.uuid4().bytes; previous = b'\0' * 32; history = b''
        for index, phase in enumerate(j.PHASES):
            frame = j._encode_frame(j._FrameData(phase, generation, api.anchor[1], 0,
                                     0 if index == 0 else 8192, j.JOURNAL_CHARGE, previous))
            def append():
                _void(api.check, len(history)); _void(api.write, frame, len(history)); _void(api.flush)
                expected = history + frame; _void(api.check, len(expected))
                raw = api.read(len(expected))
                _need(type(raw) is bytes and raw == expected, 'journal-readback')
                _void(api.check, len(expected))
                return expected
            history = owner.run(append); previous = frame[-32:]
            value['journal_frames'] += 1
        _need(j._validate_prefix(history, generation=generation, root_identity=api.anchor[1],
                                reservation=8192, other_charge=0) == 5, 'journal-prefix')
        baseline = list(owner._handles)
        for _ in range(REPEATED_READS):
            def read():
                _void(api.check, len(history)); raw = api.read(len(history)); _void(api.check, len(history))
                _need(type(raw) is bytes and raw == history, 'journal-repeat-readback')
            owner.run(read)
            _need(not owner._irps and owner._retiring_io is None and owner._handles == baseline,
                  'journal-live-custody-growth')
            value['repeated_reads'] += 1
        identity, size, allocated = owner.run(lambda: api.file_facts(api.file[0]))
        _need(identity == api.file[1] and size == len(history), 'journal-final-file')
        value['journal_data_bytes'], value['allocated_bytes'] = size, allocated
        original = None
        if case == 'journal-mutation-denied':
            original = owner.run(lambda: (tuple(item[1] for item in chain),
                api.namespace[1], api.security(api.namespace[0]), api.file[1],
                api.security(api.file[0]), api.file_facts(api.file[0])))
        owner.run(lambda: _void(api.retire))
        _need(not owner._uncertain and not owner._irps and owner._retiring_io is None
              and not owner._allocations and all(h.closed for h in owner._handles)
              and all(g['retired'] is True for g in owner._guards), 'journal-retirement')
        value.update(api_cleanup_confirmed=True, api_handles_closed=True,
                     guard_retirement_confirmed=True, history_intentionally_retained=True,
                     live_data_irps_after=0, unretired_handle_records=0)
        if case == 'journal-mutation-denied':
            _mutation_checks(engine, native, j, w, hashes, cache, original, history, value)
    except BaseException:
        if getattr(owner, '_ApiOwner__origin', None) is owner and not value['api_cleanup_confirmed']:
            owner._uncertain = True
            value['api_uncertainty_retained'] = any(v is owner for v in native.buffers)
            if value['api_uncertainty_retained']:
                value['live_data_irps_after'] = len(owner._irps)
                value['unretired_handle_records'] = sum(not h.closed for h in owner._handles)
        raise  # No uncertain cleanup, retry or production budget credit.
