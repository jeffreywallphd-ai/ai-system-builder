"""Real journal/lease consumers with explicitly synthetic native/domain facts.

No Windows DLL, file, process, model, historical cache or real domain is used.
These fixtures are never production factories or native qualification evidence.
"""
import copy
import ctypes as C
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_journal as j
from modules.adapters.runtime.python.worker.tasks import windows_offload_core as c
from modules.adapters.runtime.python.worker.tasks import windows_offload_backend as b
from modules.adapters.runtime.python.worker.tasks import offload_recovery as r
from modules.adapters.runtime.python.worker.tasks.local_model_offload import OwnedOffloadLease, OffloadAdmissionError, STAGING_LIMIT
from modules.adapters.runtime.python.worker.tests.test_windows_offload_core import fresh_core
from modules.adapters.runtime.python.worker.tests.test_windows_offload_backend import SyntheticWorker


class SyntheticDomain(j._JournalDomainPort):
    """Deliberate test-only fresh ledger/fence, never native authority."""
    def __init__(self, core, trace, other=0):
        self.core, self.trace, self.other = core, trace, other
        self.owner, self.overhead, self.stage = None, 0, 0
        self.frozen = self.sealed = self.references = self.credited = False
        self.fail = None

    def step(self, name):
        self.trace.append(name)
        if self.fail == name: raise OffloadAdmissionError()

    def assert_bound(self, journal, binding):
        self.step('domain-bound')
        j._need(not self.frozen and journal._core is self.core and binding is self.core._accounting)

    def reserve_journal(self, journal, amount):
        self.step('domain-overhead')
        j._need(self.owner is None and amount == j.JOURNAL_CHARGE
                and self.other + amount <= STAGING_LIMIT)
        self.owner, self.overhead = journal, amount
        return j._ChargeView(self.other)

    def assert_charge(self, journal, stage_amount):
        self.step('domain-charge')
        j._need(journal is self.owner and stage_amount == self.stage
                and self.overhead == j.JOURNAL_CHARGE
                and self.other + self.overhead + self.stage <= STAGING_LIMIT)

    def assert_mutation_fence(self, journal):
        self.step('domain-fence')
        j._need(journal is self.owner and not self.frozen)

    def reserve_staging(self, journal, amount):
        self.step('domain-reserve-stage')
        j._need(journal is self.owner and self.stage == 0 and not self.credited
                and self.other + self.overhead + amount <= STAGING_LIMIT)
        self.stage = amount

    def mark_sealed(self, journal):
        self.step('domain-seal')
        j._need(journal is self.owner and self.stage > 0 and not self.sealed)
        self.sealed = True

    def mark_references_released(self, journal):
        self.step('domain-references')
        j._need(journal is self.owner and self.sealed and not self.references)
        self.references = True

    def credit_retirement(self, journal, witness):
        self.step('domain-credit')
        journal._assert_credit_facts(self, witness)
        j._need(journal is self.owner and self.references and self.stage > 0 and not self.credited)
        self.stage, self.credited = 0, True

    def retain_failure(self, journal):
        self.trace.append('domain-freeze')
        self.frozen = True


class SyntheticIo(j._WindowsJournalApi):
    """Synthetic file/native shape only. It never calls WinDLL or the OS."""
    def __init__(self, owner):
        self.owner, self.trace = owner, owner._domain.trace
        self.data, self.fail, self.reply = b'', None, None
        self.anchor = self.namespace = self.file = self.protected = None
        self.allocation = 4096

    def step(self, name):
        self.trace.append(name)
        if self.fail == name: raise OffloadAdmissionError()

    def new(self):
        value = self.handle(); value.slot.value = 1000 + len(self.owner._handles)
        return value

    def duplicate_anchor(self, source, identity):
        self.step('journal-duplicate')
        self.anchor = self.new(), identity

    def prepare(self):
        self.step('journal-prepare')
        self.namespace = self.new(), b'n' * 24, b'private'
        self.file = self.new(), b'f' * 24, b'private'
        self.owner._guards.append({'retired': False})

    def check(self, expected):
        self.step('journal-check')
        j._need(len(self.data) == expected and not any(g['retired'] for g in self.owner._guards))

    def write(self, raw, offset):
        phase = j._decode_frame(raw).phase
        self.step('journal-write-' + phase)
        j._need(offset == len(self.data))
        self.data += raw[:len(raw) // 2] if self.fail == 'partial-write' else raw
        if self.reply == 'write': return True

    def flush(self):
        self.step('journal-flush')
        if self.reply == 'flush': return True

    def read(self, size):
        self.step('journal-read')
        if self.fail == 'read-mismatch': return b'x' * size
        if self.fail == 'read-type': return bytearray(self.data[:size])
        return self.data[:size]

    def retire(self):
        self.step('journal-retire')
        for guard in self.owner._guards: guard['retired'] = True
        for handle in self.owner._handles: handle.close_started = handle.closed = True
        self.trace.append('journal-handles-retired')
        if self.reply == 'retire': return True


def prepared(other=0):
    core, trace = fresh_core(), []
    domain = SyntheticDomain(core, trace, other)
    journal = j.WindowsProtectedJournal(core, domain, _api_factory=SyntheticIo)
    journal.prepare()
    return core, journal, domain, trace


class JournalTableTestCase(unittest.TestCase):
    def setUp(self):
        for table in (c._CUSTODY, b._BACKENDS, r._RETAINED_OWNERS, j._OWNERS):
            scope = patch.dict(table, {}, clear=True); scope.start(); self.addCleanup(scope.stop)


class JournalTests(JournalTableTestCase):
    def test_missing_producers_and_default_constructor_have_no_native_or_file_effects(self):
        core = c.WindowsOffloadCore(Path.cwd())
        factory = Mock(side_effect=AssertionError('No native factory expected'))
        with patch.object(C, 'WinDLL', create=True) as native:
            for domain in (None, SyntheticDomain(core, [])):
                journal = j.WindowsProtectedJournal(core, domain, _api_factory=factory)
                with self.assertRaises(OffloadAdmissionError): journal.prepare()
            native.assert_not_called(); factory.assert_not_called()
        self.assertIsNone(r._CURRENT_OWNER._backend)
        with self.assertRaises(OffloadAdmissionError): j.WindowsProtectedJournal(core, {'fresh': True})
        with self.assertRaises(TypeError): j._JournalDomainPort()

    def test_full_unknown_charge_denies_before_bootstrap_duplication_or_creation(self):
        core, trace = fresh_core(), []
        domain = SyntheticDomain(core, trace, STAGING_LIMIT)
        factory = Mock(side_effect=AssertionError('No journal IO expected'))
        journal = j.WindowsProtectedJournal(core, domain, _api_factory=factory)
        steps = list(core._api.steps)
        with self.assertRaises(OffloadAdmissionError): journal.prepare()
        factory.assert_not_called()
        self.assertEqual(core._api.steps, steps)
        self.assertEqual(domain.stage, 0)
        self.assertIs(j._OWNERS[id(journal)], journal)
        self.assertTrue(domain.frozen)

    def test_missing_mutation_fence_denies_before_namespace_or_file_bootstrap(self):
        core, trace = fresh_core(), []
        domain = SyntheticDomain(core, trace); domain.fail = 'domain-fence'
        journal = j.WindowsProtectedJournal(core, domain, _api_factory=SyntheticIo)
        with self.assertRaises(OffloadAdmissionError): journal.prepare()
        self.assertNotIn('journal-prepare', trace)
        self.assertIsNone(journal._api.namespace)
        self.assertIsNone(journal._api.file)
        self.assertEqual(journal._api.data, b'')
        self.assertTrue(domain.frozen and journal._uncertain)

    def test_real_journal_backend_and_lease_order_durable_reserve_and_exact_retirement(self):
        core, journal, domain, trace = prepared()
        worker = SyntheticWorker(core, trace)
        backend = b.WindowsOffloadBackend(core, journal, worker)
        owner = r._GuardedOffloadOwner(backend)
        create = core._api.create_directory
        def checked_create(*args):
            self.assertEqual(domain.stage, 8192)
            self.assertEqual(j._decode_frame(journal._api.data[-j.FRAME_BYTES:]).phase, 'reserved')
            self.assertIsNone(journal._pending_frame)
            trace.append('core-create')
            return create(*args)
        core._api.create_directory = checked_create
        retire = core.retire_fresh_staging
        def checked_retire():
            trace.append('core-retire')
            retire()
            trace.append('core-retired-ack')
        core.retire_fresh_staging = checked_retire
        core_handles = list(core._handles)
        lease = OwnedOffloadLease(core.cache_root, 8192, _recovery=owner.worker_context)
        lease.seal(); lease.assert_guarded_reusable(owner.worker_context)
        with self.assertRaises(OffloadAdmissionError): lease.cleanup(model_released=True)
        self.assertEqual(domain.stage, 8192)
        self.assertNotIn('domain-credit', trace)
        worker.exited = True; owner.retire_owned_worker(); lease.cleanup(model_released=True)
        self.assertTrue(lease.released and core._retired and domain.credited)
        self.assertEqual(domain.stage, 0); self.assertEqual(domain.overhead, j.JOURNAL_CHARGE)
        self.assertEqual(len(journal._api.data), j.CAPACITY_BYTES)  # History kept.
        self.assertTrue(all(h.closed for h in journal._handles))
        self.assertFalse(any(h in core_handles for h in journal._handles))
        self.assertLess(trace.index('domain-reserve-stage'), trace.index('journal-write-reserved'))
        self.assertLess(trace.index('journal-write-reserved'), trace.index('core-create'))
        self.assertLess(trace.index('quiescent'), trace.index('journal-write-sealed'))
        self.assertLess(trace.index('native-retired'), trace.index('core-retired-ack'))
        self.assertLess(trace.index('core-retired-ack'), trace.index('journal-write-credited'))
        self.assertLess(trace.index('journal-handles-retired'), trace.index('domain-credit'))
        self.assertNotIn(id(journal), j._OWNERS)

    def test_stage_failures_retain_charge_frame_and_stop_before_supplier_creation(self):
        failures = ('journal-check', 'journal-flush', 'journal-read', 'read-mismatch', 'read-type', 'partial-write')
        for failure in failures:
            with self.subTest(failure=failure):
                core, journal, domain, trace = prepared()
                journal._api.fail = failure
                with self.assertRaises(OffloadAdmissionError): journal.reserve(core, 4096)
                self.assertEqual(domain.stage, 4096)
                self.assertTrue(journal._uncertain and domain.frozen)
                self.assertIs(j._OWNERS[id(journal)], journal)
                self.assertIsNotNone(journal._pending_frame)
                self.assertNotIn('create-.aisb-offload-v1', core._api.steps)
                self.assertNotIn('journal-retire', trace)
                before = list(trace)
                with self.assertRaises(OffloadAdmissionError): journal.reserve(core, 4096)
                self.assertEqual(trace, before)

    def test_unknown_void_replies_and_post_effect_interruptions_are_not_acknowledgements(self):
        for reply in ('write', 'flush'):
            core, journal, domain, trace = prepared(); journal._api.reply = reply
            with self.subTest(reply=reply), self.assertRaises(OffloadAdmissionError): journal.reserve(core, 4096)
            self.assertTrue(domain.frozen)
            self.assertEqual(domain.stage, 4096)
            self.assertNotIn('create-.aisb-offload-v1', core._api.steps)
        core, journal, domain, trace = prepared()
        original = domain.reserve_staging
        def interrupted(*args): original(*args); raise KeyboardInterrupt()
        domain.reserve_staging = interrupted
        with self.assertRaises(KeyboardInterrupt): journal.reserve(core, 4096)
        self.assertEqual(domain.stage, 4096)
        self.assertEqual(trace.count('domain-freeze'), 1)
        self.assertNotIn('journal-write-reserved', trace)

    def test_overhead_and_other_charge_share_unchanged_total_before_any_stage_write(self):
        core, journal, domain, trace = prepared(STAGING_LIMIT - j.JOURNAL_CHARGE - 8192)
        journal.reserve(core, 8192)
        self.assertEqual(domain.other + domain.overhead + domain.stage, STAGING_LIMIT)
        core, journal, domain, trace = prepared(STAGING_LIMIT - j.JOURNAL_CHARGE - 8192)
        with self.assertRaises(OffloadAdmissionError): journal.reserve(core, 8193)
        self.assertEqual(domain.stage, 0)
        self.assertNotIn('journal-write-reserved', trace)

    def test_new_core_same_identity_or_new_cache_cannot_reuse_the_existing_domain(self):
        core, journal, domain, trace = prepared()
        other = fresh_core()
        self.assertEqual(core._chain[-1][1], other._chain[-1][1])
        factory = Mock(side_effect=AssertionError('No new journal IO expected'))
        second = j.WindowsProtectedJournal(other, domain, _api_factory=factory)
        with self.assertRaises(OffloadAdmissionError): second.prepare()
        factory.assert_not_called()
        self.assertIs(domain.owner, journal)

    def test_copied_journal_or_foreign_core_has_no_original_native_callback(self):
        core, journal, domain, trace = prepared(); duplicate = copy.copy(journal)
        steps, before = list(core._api.steps), list(trace)
        for action in (lambda: duplicate.assert_bound(core), lambda: duplicate.reserve(core, 4096),
                       lambda: duplicate.seal(core), lambda: duplicate.credit_retirement(core)):
            with self.assertRaises(OffloadAdmissionError): action()
        self.assertEqual(core._api.steps, steps); self.assertEqual(trace, before)
        other = fresh_core(); before = list(trace)
        with self.assertRaises(OffloadAdmissionError): journal.reserve(other, 4096)
        self.assertEqual(trace, before)
        self.assertFalse(journal._uncertain)

    def test_skipped_early_duplicate_and_foreign_thread_callbacks_stop_later_effects(self):
        for mode in ('skip', 'early', 'double', 'foreign'):
            core, journal, domain, trace = prepared()
            if mode == 'foreign':
                original = core._execution.execute
                def execute(bound, operation):
                    with patch.object(j, 'get_ident', return_value=-7): return original(bound, operation)
                core._execution.execute = execute
            else:
                core._execution.mode = mode
            with self.subTest(mode=mode), self.assertRaises(OffloadAdmissionError): journal.reserve(core, 4096)
            self.assertTrue(journal._uncertain and domain.frozen)
            self.assertNotIn('create-.aisb-offload-v1', core._api.steps)
            if mode == 'early':
                before = list(trace)
                with self.assertRaises(OffloadAdmissionError): core._execution.late()
                self.assertEqual(trace, before)

    def test_unconfirmed_worker_or_journal_close_never_credits_or_retries(self):
        core, journal, domain, trace = prepared()
        worker = SyntheticWorker(core, trace)
        backend = b.WindowsOffloadBackend(core, journal, worker); owner = r._GuardedOffloadOwner(backend)
        lease = OwnedOffloadLease(core.cache_root, 8192, _recovery=owner.worker_context); lease.seal()
        with self.assertRaises(OffloadAdmissionError): lease.cleanup(model_released=True)
        journal._api.reply = 'retire'; worker.exited = True
        with self.assertRaises(OffloadAdmissionError): owner.retire_owned_worker()
        self.assertTrue(core._retired)
        self.assertEqual(domain.stage, 8192); self.assertTrue(domain.frozen)
        self.assertNotIn('domain-credit', trace)
        before = list(trace)
        with self.assertRaises(OffloadAdmissionError): owner.retire_owned_worker()
        self.assertEqual(trace, before)

    def test_untrusted_reservation_types_deny_without_touching_existing_charge(self):
        core, journal, domain, trace = prepared(); before = list(trace)
        for value in (True, False, 0, -1, 1.0, '4096', STAGING_LIMIT + 1):
            with self.subTest(value=value), self.assertRaises(OffloadAdmissionError): journal.reserve(core, value)
        self.assertEqual(trace, before); self.assertEqual(domain.stage, 0)

    def test_post_credit_registry_interruption_freezes_domain_and_forbids_retry(self):
        core, journal, domain, trace = prepared()
        journal.reserve(core, 8192); core.create_staging(8192); core.seal_staging()
        journal.seal(core); journal.references_released(core); core.retire_fresh_staging()
        credit = domain.credit_retirement
        class InterruptedLock:
            def __enter__(self): raise KeyboardInterrupt()
            def __exit__(self, *_): return False
        def interrupted_registry(*args):
            credit(*args)
            j._OWNERS_LOCK = InterruptedLock()
        domain.credit_retirement = interrupted_registry
        with patch.object(j, '_OWNERS_LOCK', j._OWNERS_LOCK):
            with self.assertRaises(KeyboardInterrupt): journal.credit_retirement(core)
            self.assertTrue(journal._uncertain and domain.frozen)
            self.assertIs(j._OWNERS[id(journal)], journal)
            before = list(trace)
            with self.assertRaises(OffloadAdmissionError): journal.credit_retirement(core)
            self.assertEqual(trace, before)


class FrameTests(unittest.TestCase):
    def history(self):
        raw = b''
        for phase in j.PHASES:
            raw += j._encode_frame(j._FrameData(phase, b'g' * 16, b'r' * 24, 0,
                       0 if phase == 'genesis' else 8192, j.JOURNAL_CHARGE, raw[-32:] if raw else j._ZERO))
        return raw

    def test_exact_closed_sequence_and_limits_are_data_only(self):
        raw = self.history()
        self.assertEqual(len(raw), j.CAPACITY_BYTES)
        self.assertEqual(j._validate_prefix(raw, generation=b'g' * 16, root_identity=b'r' * 24,
                                           reservation=8192, other_charge=0), 5)
        self.assertEqual(j._decode_frame(raw[-j.FRAME_BYTES:]).reservation, 8192)
        self.assertFalse(isinstance(j._decode_frame(raw[:j.FRAME_BYTES]), j._JournalDomainPort))

    def test_torn_extended_reordered_foreign_and_replayed_records_are_not_recovered(self):
        raw = self.history(); unit = j.FRAME_BYTES
        variants = (raw[:-1], raw + b'x', raw[unit:], raw[:unit] * 2,
                    raw[:unit] + raw[2 * unit:3 * unit] + raw[unit:2 * unit],
                    raw[:-1] + bytes([raw[-1] ^ 1]))
        for value in variants:
            with self.subTest(size=len(value)), self.assertRaises(OffloadAdmissionError):
                j._validate_prefix(value, generation=b'g' * 16, root_identity=b'r' * 24,
                                   reservation=8192, other_charge=0)
        for overrides in ({'generation': b'x' * 16}, {'root_identity': b'x' * 24}, {'reservation': 4096}, {'other_charge': 1}):
            values = {'generation': b'g' * 16, 'root_identity': b'r' * 24, 'reservation': 8192, 'other_charge': 0}
            values.update(overrides)
            with self.assertRaises(OffloadAdmissionError): j._validate_prefix(raw, **values)


class NativeIoTests(JournalTableTestCase):
    """Invoke real API methods against typed synthetic function replies only."""
    def kernel(self, journal, *, reply=0x103, wait=0, short=False, status=None, close=1):
        api = journal._api
        api.observed_irps = []  # Test observations are not runtime custody.
        def event(output, *_):
            self.assertIs(j._OWNERS[id(journal)], journal)
            self.assertIsNotNone(journal._pending)
            self.assertIsNone(journal._handles[-1].slot.value)
            output._obj.value = 10000 + len(journal._handles)
            return 0
        def request(handle, event_value, _routine, _context, io, buffer, count, offset, _key):
            irp = journal._irps[-1]
            api.observed_irps.append(irp)
            self.assertTrue(irp.issued and not irp.completed)
            self.assertIs(journal._pending[3][0], irp)
            self.assertEqual(irp.event.slot.value, event_value)
            self.assertEqual(irp.handle.slot.value, handle)
            io._obj.status = status
            io._obj.information = count - 1 if short else count
            return reply
        def read(*args):
            result = request(*args)
            C.memmove(args[5], api.data[:args[6]], args[6])
            return result
        api.n = SimpleNamespace(NtCreateEvent=Mock(side_effect=event),
                                NtWriteFile=Mock(side_effect=request), NtReadFile=Mock(side_effect=read))
        api.k = SimpleNamespace(WaitForSingleObject=Mock(return_value=wait),
                                CloseHandle=Mock(return_value=close), FlushFileBuffers=Mock(return_value=1))
        return api

    def test_pending_read_and_write_require_exact_completion_before_event_close(self):
        for writing in (False, True):
            with self.subTest(writing=writing):
                core, journal, domain, trace = prepared(); api = self.kernel(journal)
                raw = b'a' * j.FRAME_BYTES
                if writing:
                    result = journal._run(lambda: j._WindowsJournalApi._io(api, raw, 0, writing=True))
                    self.assertEqual(result, raw)
                else:
                    result = journal._run(lambda: j._WindowsJournalApi.read(api, len(api.data)))
                    self.assertEqual(result, api.data)
                irp = api.observed_irps[-1]
                self.assertTrue(irp.completed and irp.event.close_started and irp.event.closed)
                self.assertNotIn(irp, journal._irps)
                self.assertNotIn(irp.event, journal._handles)
                api.k.CloseHandle.assert_called_once_with(irp.event.slot.value)
                api.k.WaitForSingleObject.assert_called_once_with(irp.event.slot.value, 1500)
                self.assertFalse(domain.frozen)

    def test_timeout_short_cancelled_and_unknown_dispatch_keep_irp_and_never_close(self):
        cases = ({'wait': 258}, {'short': True}, {'status': 0xc0000120}, {'reply': -1073741823}, {'reply': True})
        for settings in cases:
            with self.subTest(settings=settings):
                core, journal, domain, trace = prepared(); api = self.kernel(journal, **settings)
                with self.assertRaises(OffloadAdmissionError):
                    journal._run(lambda: j._WindowsJournalApi._io(api, b'a' * 512, 0, writing=True))
                irp = journal._irps[-1]
                self.assertTrue(irp.issued and not irp.completed and not irp.event.closed)
                api.k.CloseHandle.assert_not_called()
                self.assertIs(j._OWNERS[id(journal)], journal)
                self.assertTrue(domain.frozen)
                calls = api.n.NtWriteFile.call_count
                with self.assertRaises(OffloadAdmissionError):
                    journal._run(lambda: j._WindowsJournalApi._io(api, b'a' * 512, 0, writing=True))
                self.assertEqual(api.n.NtWriteFile.call_count, calls)

    def test_lost_event_close_ack_is_one_attempt_with_completed_irp_retained(self):
        core, journal, domain, trace = prepared(); api = self.kernel(journal, close=0)
        with self.assertRaises(OffloadAdmissionError):
            journal._run(lambda: j._WindowsJournalApi._io(api, b'a' * 512, 0, writing=True))
        irp = journal._irps[-1]
        self.assertTrue(irp.completed and irp.event.close_started and not irp.event.closed)
        with self.assertRaises(OffloadAdmissionError): api.close(irp.event)
        self.assertEqual(api.k.CloseHandle.call_count, 1)
        self.assertIsNotNone(journal._pending)

    def test_flush_false_and_copied_api_cannot_supply_acknowledgement(self):
        core, journal, domain, trace = prepared(); api = self.kernel(journal)
        with self.assertRaises(TypeError): copy.copy(api)  # Owner required by __new__.
        duplicate = object.__new__(type(api))
        duplicate.__dict__.update(api.__dict__)
        with self.assertRaises(OffloadAdmissionError): j._WindowsJournalApi.flush(duplicate)
        api.k.FlushFileBuffers.assert_not_called()
        self.assertFalse(journal._uncertain)
        api.k.FlushFileBuffers.return_value = 0
        with self.assertRaises(OffloadAdmissionError): journal._run(lambda: j._WindowsJournalApi.flush(api))
        api.k.FlushFileBuffers.assert_called_once()
        self.assertIsNotNone(journal._pending)
        self.assertTrue(domain.frozen)

    def test_allocation_admission_uses_bounded_real_query_shape_before_file_effects(self):
        variants = ({}, {'sector_bytes': 8192}, {'sectors': 3}, {'available': 1},
                    {'returned_bytes': 0}, {'status': 0x103})
        for index, overrides in enumerate(variants):
            with self.subTest(overrides=overrides):
                core, journal, domain, trace = prepared(); api = self.kernel(journal)
                facts = {'total': 100000, 'available': 1000, 'sectors': 8, 'sector_bytes': 512,
                         'returned_bytes': C.sizeof(j._FsSize), 'status': 0}
                facts.update(overrides)
                def query(handle, io, result, length, kind):
                    self.assertEqual(kind, 3)
                    self.assertEqual(length, C.sizeof(j._FsSize))
                    self.assertIsNotNone(journal._pending)
                    for name in ('total', 'available', 'sectors', 'sector_bytes'):
                        setattr(result._obj, name, facts[name])
                    io._obj.information = facts['returned_bytes']
                    return facts['status']
                api.n.NtQueryVolumeInformationFile = Mock(side_effect=query)
                if index == 0:
                    self.assertEqual(journal._run(lambda: j._WindowsJournalApi._allocation_bound(api)), 4096)
                else:
                    with self.assertRaises(OffloadAdmissionError):
                        journal._run(lambda: j._WindowsJournalApi._allocation_bound(api))

    def test_native_count_bound_is_per_operation_and_unknown_cannot_reset_it(self):
        core, journal, domain, trace = prepared(); api = self.kernel(journal)
        def many(count):
            for _ in range(count): j._WindowsJournalApi.flush(api)
        for _ in range(3): journal._run(lambda: many(j._MAX_CALLS // 2))
        self.assertEqual(api.k.FlushFileBuffers.call_count, 3 * (j._MAX_CALLS // 2))
        with self.assertRaises(OffloadAdmissionError): journal._run(lambda: many(j._MAX_CALLS + 1))
        before = api.k.FlushFileBuffers.call_count
        with self.assertRaises(OffloadAdmissionError): journal._run(lambda: many(1))
        self.assertEqual(api.k.FlushFileBuffers.call_count, before)

    def test_swallowed_native_count_denial_still_prevents_operation_acknowledgement(self):
        core, journal, domain, trace = prepared(); api = self.kernel(journal)
        def suppressed():
            for _ in range(j._MAX_CALLS): j._WindowsJournalApi.flush(api)
            try: j._WindowsJournalApi.flush(api)
            except OffloadAdmissionError: pass
        with self.assertRaises(OffloadAdmissionError): journal._run(suppressed)
        self.assertTrue(journal._uncertain and domain.frozen)
        self.assertEqual(api.k.FlushFileBuffers.call_count, j._MAX_CALLS)

    def test_swallowed_pending_reentry_cannot_acknowledge_the_outer_native_call(self):
        core, journal, domain, trace = prepared(); api = self.kernel(journal)
        def reentry(_):
            try: j._WindowsJournalApi.flush(api)
            except OffloadAdmissionError: pass
            return 1
        api.k.FlushFileBuffers.side_effect = reentry
        with self.assertRaises(OffloadAdmissionError):
            journal._run(lambda: j._WindowsJournalApi.flush(api))
        self.assertTrue(journal._uncertain and domain.frozen)
        self.assertEqual(api.k.FlushFileBuffers.call_count, 1)

    def test_oversized_or_malformed_io_denies_before_native_event_acquisition(self):
        for raw, offset in ((b'a' * (j.CAPACITY_BYTES + 1), 0), (b'a', True), (b'a', -1)):
            core, journal, domain, trace = prepared(); api = self.kernel(journal)
            before = list(journal._handles)
            with self.assertRaises(OffloadAdmissionError):
                journal._run(lambda: j._WindowsJournalApi._io(api, raw, offset, writing=True))
            self.assertEqual(journal._handles, before)
            api.n.NtCreateEvent.assert_not_called()

    def test_repeated_completed_reads_keep_live_io_custody_bounded(self):
        core, journal, domain, trace = prepared(); api = self.kernel(journal)
        persistent = list(journal._handles)
        for _ in range(200):
            result = journal._run(lambda: j._WindowsJournalApi.read(api, len(api.data)))
            self.assertEqual(result, api.data)
            self.assertEqual(journal._irps, [])
            self.assertEqual(journal._handles, persistent)
        self.assertEqual(api.k.CloseHandle.call_count, 200)
        self.assertFalse(domain.frozen)

    def test_retired_event_token_cannot_close_a_new_handle_with_the_same_number(self):
        core, journal, domain, trace = prepared(); api = self.kernel(journal)
        journal._run(lambda: j._WindowsJournalApi.read(api, len(api.data)))
        retired = api.observed_irps[-1].event
        self.assertNotIn(retired, journal._handles)
        original = api.n.NtReadFile.side_effect
        def attempt_replay(*args):
            active = journal._irps[-1].event
            self.assertIsNot(active, retired)
            self.assertEqual(active.slot.value, retired.slot.value)
            closes = api.k.CloseHandle.call_count
            with self.assertRaises(OffloadAdmissionError): api.close(retired)
            self.assertEqual(api.k.CloseHandle.call_count, closes)
            return original(*args)
        api.n.NtReadFile.side_effect = attempt_replay
        journal._run(lambda: j._WindowsJournalApi.read(api, len(api.data)))
        self.assertEqual(api.k.CloseHandle.call_count, 2)
        self.assertEqual(journal._irps, [])
        self.assertFalse(journal._uncertain or domain.frozen)

    def test_interrupted_completed_io_bookkeeping_retains_request_and_freezes(self):
        class InterruptedRemoval(list):
            def remove(self, value): raise KeyboardInterrupt()
        for field in ('_irps', '_handles'):
            with self.subTest(field=field):
                core, journal, domain, trace = prepared(); api = self.kernel(journal)
                setattr(journal, field, InterruptedRemoval(getattr(journal, field)))
                with self.assertRaises(KeyboardInterrupt):
                    journal._run(lambda: j._WindowsJournalApi.read(api, len(api.data)))
                irp = api.observed_irps[-1]
                self.assertIs(journal._retiring_io, irp)
                self.assertTrue(irp.completed and irp.event.closed)
                self.assertTrue(journal._uncertain and domain.frozen)
                self.assertIs(j._OWNERS[id(journal)], journal)
                api.k.CloseHandle.assert_called_once_with(irp.event.slot.value)
                with self.assertRaises(OffloadAdmissionError):
                    journal._run(lambda: j._WindowsJournalApi.read(api, len(api.data)))
                self.assertEqual(api.n.NtReadFile.call_count, 1)


if __name__ == '__main__': unittest.main()
