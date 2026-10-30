"""Real lease/Core/backend consumer; journal/worker/native facts are synthetic."""
from pathlib import Path
import copy
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_core as c
from modules.adapters.runtime.python.worker.tasks import windows_offload_backend as b
from modules.adapters.runtime.python.worker.tasks import offload_recovery as r
from modules.adapters.runtime.python.worker.tasks.local_model_offload import OwnedOffloadLease, OffloadAdmissionError, STAGING_LIMIT
from modules.adapters.runtime.python.worker.tests.test_windows_offload_core import fresh_core


class SyntheticJournal(b._ProtectedJournalPort):
    """New zero-charge synthetic domain, not durable/native authority."""
    def __init__(self, core, trace):
        self.core, self.trace = core, trace
        self.charge = 0
        self.retained_unknown = False
        self.fail = None
        self.bad = None
    def step(self, name, core):
        self.trace.append(name)
        if core is not self.core or self.fail == name: raise OffloadAdmissionError()
        return True if self.bad == name else None
    def assert_bound(self, core):
        if self.retained_unknown: raise OffloadAdmissionError()
        return self.step('journal-bound', core)
    def reserve(self, core, amount):
        result = self.step('reserve', core)
        if self.charge or amount > STAGING_LIMIT: raise OffloadAdmissionError()
        self.charge = amount
        return result
    def assert_reserved(self, core, amount):
        if self.charge != amount: raise OffloadAdmissionError()
        return self.step('reserved', core)
    def seal(self, core): return self.step('journal-seal', core)
    def assert_sealed(self, core): return self.step('journal-sealed', core)
    def references_released(self, core): return self.step('journal-refs', core)
    def credit_retirement(self, core):
        result = self.step('credit', core)
        if result is None: self.charge = 0
        return result


class SyntheticWorker(b._OwnedWorkerPort):
    """Explicit synthetic standalone owner. No process or Job is launched."""
    def __init__(self, core, trace): self.core, self.trace, self.exited, self.fail = core, trace, False, None
    def step(self, name, core):
        self.trace.append(name)
        if core is not self.core or self.fail == name: raise OffloadAdmissionError()
    def assert_bound(self, core): return self.step('worker-bound', core)
    def assert_writer_quiescent(self, core): return self.step('quiescent', core)
    def references_released(self, core): return self.step('worker-refs', core)
    def assert_native_retired(self, core):
        self.step('native-retired', core)
        if not self.exited: raise OffloadAdmissionError()


class BackendTests(unittest.TestCase):
    def setUp(self):
        for table in (c._CUSTODY, b._BACKENDS, r._RETAINED_OWNERS):
            scope = patch.dict(table, {}, clear=True); scope.start(); self.addCleanup(scope.stop)

    def setup_consumer(self):
        core = fresh_core(); trace = []
        journal, worker = SyntheticJournal(core, trace), SyntheticWorker(core, trace)
        backend = b.WindowsOffloadBackend(core, journal, worker)
        owner = r._GuardedOffloadOwner(backend)
        return core, journal, worker, backend, owner, trace

    def test_real_lease_core_and_backend_order_reserve_before_create_and_retirement_before_credit(self):
        core, journal, worker, backend, owner, trace = self.setup_consumer()
        original_create = core._api.create_directory
        def create(*args):
            self.assertEqual(journal.charge, 4096)
            trace.append('create')
            return original_create(*args)
        core._api.create_directory = create
        lease = OwnedOffloadLease(core.cache_root, 4096, _recovery=owner.worker_context)
        lease.seal(); lease.assert_guarded_reusable(owner.worker_context)
        with self.assertRaises(OffloadAdmissionError): lease.cleanup(model_released=True)
        self.assertEqual(journal.charge, 4096)
        self.assertNotIn('delete', core._api.steps)
        worker.exited = True
        owner.retire_owned_worker()
        lease.cleanup(model_released=True)
        self.assertTrue(lease.released and core._retired)
        self.assertEqual(journal.charge, 0)
        self.assertLess(trace.index('reserve'), trace.index('create'))
        self.assertLess(trace.index('quiescent'), trace.index('journal-seal'))
        self.assertLess(trace.index('worker-refs'), trace.index('native-retired'))
        self.assertLess(trace.index('native-retired'), trace.index('credit'))
        self.assertEqual(trace.count('worker-refs'), 1)
        self.assertNotIn(id(backend), b._BACKENDS)

    def test_missing_real_producers_refuse_before_any_core_call(self):
        core = c.WindowsOffloadCore(Path.cwd())
        for journal, worker in ((None, None), (SyntheticJournal(core, []), None), (None, SyntheticWorker(core, []))):
            backend = b.WindowsOffloadBackend(core, journal, worker)
            with patch.object(core, 'assert_bound') as bound:
                with self.assertRaises(OffloadAdmissionError): backend.assert_ready()
                bound.assert_not_called()
        self.assertIsNone(core._api)
        with self.assertRaises(OffloadAdmissionError): b.WindowsOffloadBackend(core, {}, {})
        with self.assertRaises(TypeError): b._ProtectedJournalPort()
        with self.assertRaises(TypeError): b._OwnedWorkerPort()

    def test_copied_backend_and_copied_core_never_dispatch_original_producers(self):
        core, journal, worker, backend, owner, trace = self.setup_consumer()
        clone = copy.copy(backend)
        before = list(core._api.steps)
        with self.assertRaises(OffloadAdmissionError): clone.assert_ready()
        self.assertEqual(trace, [])
        self.assertEqual(core._api.steps, before)
        self.assertFalse(core._uncertain or backend._uncertain)
        with self.assertRaises(OffloadAdmissionError): b.WindowsOffloadBackend(copy.copy(core), journal, worker)

    def test_missing_finite_execution_owner_refuses_actual_backend_without_core_preparation(self):
        core = c.WindowsOffloadCore(Path.cwd()); trace = []
        backend = b.WindowsOffloadBackend(core, SyntheticJournal(core, trace), SyntheticWorker(core, trace))
        with self.assertRaises(OffloadAdmissionError): backend.assert_ready()
        self.assertIsNone(core._api)
        self.assertEqual(trace, [])

    def test_unknown_retained_full_domain_never_creates_or_resets_by_root(self):
        core, journal, worker, backend, owner, trace = self.setup_consumer()
        journal.retained_unknown = True
        with self.assertRaises(OffloadAdmissionError): OwnedOffloadLease(core.cache_root, 4096, _recovery=owner.worker_context)
        self.assertFalse(any(s.startswith('create-') for s in core._api.steps))
        self.assertEqual(journal.charge, 0)  # No new reservation; unknown is separately full.
        self.assertNotIn('reserve', trace)
        with self.assertRaises(OffloadAdmissionError): OwnedOffloadLease(core.cache_root / 'another', 4096, _recovery=owner.worker_context)

    def test_bool_ack_interruption_and_reentry_are_terminal_and_keep_charge(self):
        for mode in ('bool', 'interrupt', 'reentry'):
            core, journal, worker, backend, owner, trace = self.setup_consumer()
            original = journal.reserve
            def reserve(bound, amount):
                value = original(bound, amount)
                if mode == 'bool': return True
                if mode == 'interrupt': raise KeyboardInterrupt()
                try: backend.assert_ready()
                except OffloadAdmissionError: pass
                return value
            journal.reserve = reserve
            with self.subTest(mode=mode), self.assertRaises(BaseException): OwnedOffloadLease(core.cache_root, 4096, _recovery=owner.worker_context)
            self.assertEqual(journal.charge, 4096)
            before = list(trace)
            with self.assertRaises(OffloadAdmissionError): backend.assert_ready()
            self.assertEqual(trace, before)
            self.assertIs(b._BACKENDS[id(backend)], backend)
            self.assertNotIn('create-leaf', core._api.steps)

    def test_wrong_live_core_identity_refuses_without_reservation(self):
        core, journal, worker, backend, owner, trace = self.setup_consumer()
        journal.core = fresh_core()
        with self.assertRaises(OffloadAdmissionError): OwnedOffloadLease(core.cache_root, 4096, _recovery=owner.worker_context)
        self.assertNotIn('reserve', trace)

    def test_unconfirmed_worker_never_deletes_or_credits(self):
        core, journal, worker, backend, owner, trace = self.setup_consumer()
        lease = OwnedOffloadLease(core.cache_root, 4096, _recovery=owner.worker_context); lease.seal()
        with self.assertRaises(OffloadAdmissionError): lease.cleanup(model_released=True)
        with self.assertRaises(OffloadAdmissionError): owner.retire_owned_worker()
        self.assertNotIn('delete', core._api.steps)
        self.assertNotIn('credit', trace)
        self.assertEqual(journal.charge, 4096)
        worker.exited = True
        with self.assertRaises(OffloadAdmissionError): owner.retire_owned_worker()

    def test_failed_charge_retirement_keeps_exact_owner_after_file_cleanup(self):
        core, journal, worker, backend, owner, trace = self.setup_consumer()
        lease = OwnedOffloadLease(core.cache_root, 4096, _recovery=owner.worker_context); lease.seal()
        with self.assertRaises(OffloadAdmissionError): lease.cleanup(model_released=True)
        worker.exited = True; journal.fail = 'credit'
        with self.assertRaises(OffloadAdmissionError): owner.retire_owned_worker()
        self.assertEqual(journal.charge, 4096)
        self.assertIs(r._RETAINED_OWNERS[id(owner)], owner)
        self.assertIs(b._BACKENDS[id(backend)], backend)

    def test_current_production_factory_and_worker_view_remain_unavailable(self):
        with self.assertRaises(OffloadAdmissionError): r.current_guarded_context().check_ready()
        self.assertIsNone(r._CURRENT_OWNER._backend)
        self.assertFalse(hasattr(r.current_guarded_context(), 'retire_owned_worker'))


if __name__ == '__main__': unittest.main()
