"""Closed diagnostic for unused read-chain retirement; no staging authority.

Declarations are inert. The separate fixed engine supplies the actual owned
Job, source bindings, handshake and timer. Failure retains original objects;
this fixture never retries cleanup, releases disk credit or starts a model.
"""
import re
from threading import get_ident
import time

SCHEMA = 'windows-offload-read-binding-native-v1'
CASES = ('deadline-control', 'unused-read-binding')
MAX_CALLS, MAX_HANDLES = 4096, 128
_FLAGS = ('timer_configured', 'fixture_owner_retained', 'core_prepared', 'core_cleanup_confirmed',
          'core_handles_closed', 'core_uncertainty_retained',
          'retirement_identities_confirmed', 'reverse_original_closes_confirmed',
          'no_query_after_close', 'custody_release_confirmed', 'late_borrow_refused',
          'no_staging_effects', 'model_started', 'production_composed')
_COUNTS = ('native_call_count', 'read_handle_count', 'retirement_identity_count',
           'acknowledged_close_count', 'late_borrow_callback_count', 'late_borrow_native_calls')
_FIELDS = frozenset(('schema_version', 'case', 'source_digest', 'outcome',
                    'last_native_phase', 'last_native_return_code', 'last_os_error_code',
                    'elapsed_ns', 'failure_stage', *_FLAGS, *_COUNTS))
_PHASES = frozenset(('none', 'NtCreateFile', 'GetDriveTypeW',
                     'GetFileInformationByHandleEx', 'GetVolumeInformationByHandleW', 'CloseHandle'))
_FAILURES = frozenset(('read-binding-operation', 'read-binding-owner', 'read-binding-case',
    'read-binding-source', 'read-binding-construction', 'read-binding-preparation',
    'read-binding-capture', 'read-binding-state', 'read-binding-identity',
    'read-binding-close', 'read-binding-retirement', 'read-binding-late-borrow',
    'read-binding-native-phase', 'read-binding-report-fields', 'read-binding-report-case',
    'read-binding-report-source', 'read-binding-report-type', 'read-binding-report-bounds',
    'read-binding-report-control', 'read-binding-report-outcome'))


class ReadBindingFixtureError(RuntimeError):
    def __init__(self, stage):
        self.stage = stage if type(stage) is str and stage in _FAILURES else 'read-binding-operation'
        super().__init__('The isolated cache-binding check did not complete.')


def _need(value, stage):
    if not value: raise ReadBindingFixtureError(stage)


def base_report(case, source, started):
    return {'schema_version': SCHEMA, 'case': case, 'source_digest': source,
            'outcome': 'observed', 'last_native_phase': 'none',
            'last_native_return_code': None, 'last_os_error_code': None,
            'elapsed_ns': max(1, time.monotonic_ns() - started), 'failure_stage': 'none',
            **{n: False for n in _FLAGS}, **{n: 0 for n in _COUNTS}}


def validate_child_report(value, case, source):
    _need(type(value) is dict and set(value) == _FIELDS, 'read-binding-report-fields')
    _need(type(case) is str and case in CASES and type(value['case']) is str
          and value['case'] == case and type(value['schema_version']) is str
          and value['schema_version'] == SCHEMA, 'read-binding-report-case')
    _need(type(source) is str and re.fullmatch('[a-f0-9]{64}', source)
          and type(value['source_digest']) is str and value['source_digest'] == source,
          'read-binding-report-source')
    for n in _FLAGS: _need(type(value[n]) is bool, 'read-binding-report-type')
    for n in _COUNTS: _need(type(value[n]) is int and 0 <= value[n] <= MAX_CALLS, 'read-binding-report-type')
    for n in ('last_native_return_code', 'last_os_error_code'):
        _need(value[n] is None or type(value[n]) is int and 0 <= value[n] <= 0xffffffff,
              'read-binding-report-type')
    _need(type(value['elapsed_ns']) is int and 0 < value['elapsed_ns'] <= 120 * 10**9
          and type(value['last_native_phase']) is str and value['last_native_phase'] in _PHASES
          and type(value['failure_stage']) is str and value['failure_stage'] == 'none'
          and type(value['outcome']) is str and value['timer_configured'] is True
          and not value['model_started'] and not value['production_composed']
          and not value['core_uncertainty_retained'] and value['read_handle_count'] <= MAX_HANDLES,
          'read-binding-report-bounds')
    if case == 'deadline-control':
        _need(value['outcome'] == 'armed' and value['last_native_phase'] == 'none'
              and value['last_native_return_code'] is value['last_os_error_code'] is None
              and not any(value[n] for n in _COUNTS)
              and not any(value[n] for n in _FLAGS if n != 'timer_configured'),
              'read-binding-report-control')
    else:
        _need(value['outcome'] == 'observed'
              and all(value[n] for n in _FLAGS if n not in
                      ('model_started', 'production_composed', 'core_uncertainty_retained'))
              and 1 <= value['read_handle_count'] <= MAX_HANDLES
              and value['retirement_identity_count'] == 2 * value['read_handle_count']
              and value['acknowledged_close_count'] == value['read_handle_count']
              and value['late_borrow_callback_count'] == value['late_borrow_native_calls'] == 0
              and value['native_call_count'] >= 3 * value['read_handle_count']
              and value['last_native_phase'] == 'CloseHandle'
              and value['last_native_return_code'] not in (None, 0), 'read-binding-report-outcome')
    return dict(value)


def failure_diagnostics(value):
    """Safe incomplete observations, never a failed payload or a pass."""
    if type(value) is not dict: return {}
    out = {}
    if type(value.get('failure_stage')) is str and value['failure_stage'] in _FAILURES:
        out['component_failure_stage'] = value['failure_stage']
    if type(value.get('last_native_phase')) is str and value['last_native_phase'] in _PHASES:
        out['last_native_phase'] = value['last_native_phase']
    for n in ('last_native_return_code', 'last_os_error_code', *_COUNTS):
        v = value.get(n); maximum = MAX_CALLS if n in _COUNTS else 0xffffffff
        if v is None or type(v) is int and 0 <= v <= maximum: out[n] = v
    for n in ('fixture_owner_retained', 'core_prepared', 'core_uncertainty_retained',
              'core_cleanup_confirmed', 'core_handles_closed', 'custody_release_confirmed'):
        if type(value.get(n)) is bool: out[n] = value[n]
    return out


class _Owner:
    """Pins original Core, observer and native slots before dispatch."""
    def __init__(self, engine, native, module, hashes, value):
        _need(type(native) is engine._Native and engine._profile_for(native) is engine._READ_PROFILE
              and native.timer_configured is True, 'read-binding-owner')
        native.live()
        self.__origin = self
        self.engine, self.native, self.module, self.hashes, self.value = engine, native, module, hashes, value
        self.thread = get_ident()
        self.core = self.port = self.factory = self.api = self.binding = None
        self.chain = self.handles = self.entries = self.retirement = None
        self.phase, self.uncertain, self.identities, self.closes, self.events = 'preparing', False, [], [], []
        self.receiver = None
        native.buffers.append(self)  # Before API/Core constructors or callbacks.

    def live(self):
        _need(type(self) is _Owner and getattr(self, '_Owner__origin', None) is self
              and type(self.native) is self.engine._Native
              and self.engine._profile_for(self.native) is self.engine._READ_PROFILE
              and self.native.timer_configured is True and not self.uncertain
              and any(v is self for v in self.native.buffers)
              and self.thread == get_ident() == self.native.component_thread, 'read-binding-owner')
        self.native.live()

    def capture(self):
        self.live(); c = self.core; w = self.module
        _need(type(c) is w.WindowsOffloadCore and c._api is not None
              and type(c._chain) is tuple and 1 <= len(c._chain) <= MAX_HANDLES
              and type(c._handles) is list and len(c._handles) == len(c._chain)
              and c._uncertain is c._retired is c._busy is False
              and c._dispatch is c._pending is None and not c._execution_calls
              and w._CUSTODY.get(id(c)) is c and id(c) not in w._READ_RETIREMENTS,
              'read-binding-capture')
        _need(c._api is self.api and type(self.api) is self.factory, 'read-binding-capture')
        self.binding, self.chain, self.handles = c._accounting, c._chain, c._handles
        self.entries = tuple((row, row[0], row[0].slot, row[0].slot.value, row[1]) for row in self.chain)
        for rank, (row, handle, slot, number, identity) in enumerate(self.entries):
            _need(type(row) is tuple and len(row) == 2 and type(handle) is w._Handle
                  and self.handles[rank] is handle and type(slot) is w._PTR
                  and type(number) is int and 0 < number < w.C.c_void_p(-1).value
                  and type(identity) is bytes and len(identity) == 24
                  and not handle.close_started and not handle.closed and not handle.delete_started
                  and all(old[1] is not handle and old[3] != number for old in self.entries[:rank]),
                  'read-binding-capture')
        self.value['read_handle_count'] = len(self.entries)
        self.phase = 'retiring'  # Preparation identities never enter this ledger.

    def bound(self):
        self.live(); c = self.core
        _need(c._api is self.api and c._factory is self.factory and c._execution is self.port
              and c._accounting is self.binding and c._chain is self.chain and c._handles is self.handles
              and len(self.handles) == len(self.entries) and c._uncertain is False
              and c._namespace is c._stage is c._index is c._reservation is c._protected is c._sealed is None
              and not c._guards and not c._allocations, 'read-binding-state')
        for rank, (row, handle, slot, number, _) in enumerate(self.entries):
            _need(self.chain[rank] is row and self.handles[rank] is handle
                  and handle.slot is slot and slot.value == number and handle.delete_started is False,
                  'read-binding-state')

    def rank(self, handle):
        self.bound()
        ranks = [i for i, row in enumerate(self.entries) if row[1] is handle]
        _need(len(ranks) == 1, 'read-binding-state')
        return ranks[0]


def _observed_api(owner):
    w, engine = owner.module, owner.engine
    base = engine._tracked_api(w, owner.native, owner.value)
    class ObservedApi(base):
        def __new__(cls, core):
            owner.live()
            _need(cls is owner.factory and core is owner.core and owner.api is None,
                  'read-binding-construction')
            instance = object.__new__(cls)
            owner.api = instance  # Before DLL/function setup or failed __init__.
            return instance

        def call(self, function, *args, **kwargs):
            owner.live()
            if owner.phase == 'retiring':
                owner.bound()
                _need(getattr(function, '__name__', '') in ('GetFileInformationByHandleEx', 'CloseHandle'),
                      'read-binding-native-phase')
            return super().call(function, *args, **kwargs)

        def identity(self, handle):
            if owner.phase == 'preparing': return super().identity(handle)
            rank = owner.rank(handle)
            _need(owner.phase == 'retiring' and rank not in owner.closes
                  and handle.closed is handle.close_started is False, 'read-binding-identity')
            owner.events.append(('identity-started', rank))
            result = super().identity(handle)
            owner.bound()
            _need(type(result) is bytes and result == owner.entries[rank][4], 'read-binding-identity')
            owner.identities.append(rank); owner.events.append(('identity-acknowledged', rank))
            owner.value['retirement_identity_count'] = len(owner.identities)
            return result

        def close(self, handle):
            rank = owner.rank(handle); count = len(owner.entries)
            _need(owner.phase == 'retiring' and rank == count - len(owner.closes) - 1
                  and owner.identities[:count] == list(range(count))
                  and owner.identities[count:] == list(reversed(range(rank, count)))
                  and rank not in owner.closes and handle.close_started is handle.closed is False,
                  'read-binding-close')
            owner.events.append(('close-started', rank))
            result = super().close(handle)  # Real base ledger, never a fake ACK.
            owner.bound()
            _need(result is None and handle.close_started is handle.closed is True, 'read-binding-close')
            owner.closes.append(rank); owner.events.append(('close-acknowledged', rank))
            owner.value['acknowledged_close_count'] = len(owner.closes)
            return result
    return ObservedApi


def exercise(engine, native, case, hashes, folder, value):
    _need(engine._profile_for(native) is engine._READ_PROFILE and case == CASES[1], 'read-binding-case')
    modules = engine._private_core_package(hashes, engine._READ_PROFILE)
    w = modules['windows_offload_core']
    cache = folder / 'cache'; engine._fresh_directory(cache, engine._READ_PROFILE)
    owner = _Owner(engine, native, w, hashes, value)
    value['fixture_owner_retained'] = True
    try:
        owner.live(); engine._child_readback(native)
        _need(engine._all_hashes(native) == hashes, 'read-binding-source')
        owner.port = engine._fixture_execution(w, native, hashes)
        owner.factory = _observed_api(owner)
        owner.core = object.__new__(w.WindowsOffloadCore)  # Retain before __init__.
        native.buffers.append(owner.core); owner.port.core = owner.core
        _need(w.WindowsOffloadCore.__init__(owner.core, cache, _api_factory=owner.factory,
                                           _execution=owner.port) is None, 'read-binding-construction')
        _need(owner.core.prepare_fresh_binding() is None, 'read-binding-preparation')
        value['core_prepared'] = True; owner.capture()
        result = owner.core._retire_unused_read_binding()
        owner.retirement = owner.core._read_retirement
        owner.bound(); c = owner.core; n = len(owner.entries)
        _need(result is None and c._retired is True and type(c._retirement_kind) is str
              and c._retirement_kind == 'read-binding' and c._uncertain is c._busy is False
              and c._pending is c._dispatch is None and not c._execution_calls
              and type(owner.retirement) is w._ReadBindingRetirement
              and owner.retirement.core is c and owner.retirement.released is True
              and owner.retirement.chain is owner.chain and owner.retirement.handles is owner.handles
              and w._CUSTODY.get(id(c)) is None and w._READ_RETIREMENTS.get(id(c)) is None
              and owner.identities == list(range(n)) + list(reversed(range(n)))
              and owner.closes == list(reversed(range(n)))
              and all(h.close_started is h.closed is True for h in owner.handles), 'read-binding-retirement')
        value.update(core_cleanup_confirmed=True, core_handles_closed=True,
                     retirement_identities_confirmed=True, reverse_original_closes_confirmed=True,
                     no_query_after_close=True, custody_release_confirmed=True, no_staging_effects=True)
        class RefusedReceiver(w._JournalAnchorReceiver):
            def __init__(self): self.calls = 0
            def _accept_core_anchor(self, *_):
                self.calls += 1
                raise ReadBindingFixtureError('read-binding-late-borrow')
        owner.receiver = RefusedReceiver()
        before = value['native_call_count'], len(native.calls), tuple(owner.events)
        try: owner.binding.borrow_anchor(owner.receiver)
        except BaseException as error:
            _need(type(error) is modules['local_model_offload'].OffloadAdmissionError,
                  'read-binding-late-borrow')
        else: raise ReadBindingFixtureError('read-binding-late-borrow')
        _need(owner.receiver.calls == 0 and before ==
              (value['native_call_count'], len(native.calls), tuple(owner.events))
              and c._retired is True and c._uncertain is False
              and w._CUSTODY.get(id(c)) is None and w._READ_RETIREMENTS.get(id(c)) is None,
              'read-binding-late-borrow')
        owner.bound(); engine._child_readback(native)
        _need(engine._all_hashes(native) == hashes, 'read-binding-source')
        owner.phase = 'complete'
        value.update(core_cleanup_confirmed=True, core_handles_closed=True,
                     retirement_identities_confirmed=True, reverse_original_closes_confirmed=True,
                     no_query_after_close=True, custody_release_confirmed=True, late_borrow_refused=True,
                     no_staging_effects=True, late_borrow_callback_count=0, late_borrow_native_calls=0)
    except BaseException:
        owner.uncertain = True  # Preserve exact owner/original slots; no cleanup.
        value['fixture_owner_retained'] = any(v is owner for v in native.buffers)
        core = owner.core
        value['core_uncertainty_retained'] = (type(core) is w.WindowsOffloadCore
            and getattr(core, '_uncertain', False) is True
            and (w._CUSTODY.get(id(core)) is core
                 or getattr(w._READ_RETIREMENTS.get(id(core)), 'core', None) is core))
        raise
