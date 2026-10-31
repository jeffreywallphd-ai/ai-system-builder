"""Model-free Core/ABI fault tests. All native and directory facts are synthetic."""
import ctypes as C
import copy
from pathlib import Path
import struct
from types import MethodType, SimpleNamespace
from threading import Thread
import unittest
from unittest.mock import Mock, patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_core as c


class SyntheticApi:
    """Finite fresh-domain simulation; no Windows, directory or model effects."""
    def __init__(self, owner):
        self.owner, self.steps, self.nodes = owner, [], {}
        self.fail = self.changed = None
        self.broken = False
        self.acl = struct.pack('<BBHHH', 2, 0, 28, 1, 0) + struct.pack('<BBHI', 0, 0, 20, 0x1701ff) + c._WORLD

    def step(self, name):
        self.steps.append(name)
        if self.fail == name:
            raise RuntimeError('synthetic native failure')

    def node(self, directory, parent=None, name=None, size=0):
        handle = c._Handle()
        handle.slot.value = 10 + len(self.owner._handles)
        self.owner._handles.append(handle)
        self.nodes[handle] = {'identity': b'volume00' + handle.value.to_bytes(16, 'little'), 'directory': directory,
                              'parent': parent, 'name': name, 'size': size, 'allocated': size, 'permissions': (self.acl, c._PRIVATE_CONTROL)}
        return handle

    def prepare(self, path):
        self.step('prepare')
        root = self.node(True)
        return ((root, self.identity(root)),)

    def identity(self, handle):
        self.step('identity')
        return self.nodes[handle]['identity']

    def kind(self, handle, directory):
        self.step('kind')
        c._require(self.nodes[handle]['directory'] is directory)

    def create_directory(self, parent, name):
        self.step('create-' + (name if name == '.aisb-offload-v1' else 'leaf'))
        c._require(not any(n['parent'] is parent and n['name'] == name for n in self.nodes.values()))
        handle = self.node(True, parent, name)
        return handle, self.identity(handle), self.acl

    def permissions(self, handle):
        self.step('permissions')
        return self.nodes[handle]['permissions']

    def protect(self, handle, original):
        self.step('protect')
        c._require(self.permissions(handle) == original and original[1] == c._PRIVATE_CONTROL)
        result = c._acl(original[0], deny=True), original[1]
        self.nodes[handle]['permissions'] = result
        return result

    def entries(self, handle):
        self.step('entries')
        rows = [(n['name'], n['identity'][8:], n['size'], n['allocated'], n['directory'])
                for n in self.nodes.values() if n['parent'] is handle and not n.get('deleted')]
        return tuple(rows)

    def open_index(self, handle):
        self.step('open-index')
        return next(h for h, n in self.nodes.items() if n['parent'] is handle and n['name'] == 'index.json')

    def file_facts(self, handle):
        self.step('file-facts')
        n = self.nodes[handle]
        c._require(not n['directory'] and not n.get('named_stream'))
        return n['identity'], n['size'], n['allocated']

    def guard(self, handle):
        self.step('guard')
        value = {'handle': handle, 'retired': False}
        self.owner._guards.append(value)
        return value

    def check_guard(self, guard):
        self.step('check-guard')
        c._require(not guard['retired'] and not self.broken)

    def retire_guard(self, guard):
        self.step('retire-guard')
        c._require(not guard['retired'])
        guard['retired'] = True

    def delete(self, handle):
        self.step('delete')
        c._require(not self.entries(handle) if self.nodes[handle]['directory'] else True)
        c._require(not self.nodes[handle].get('deleted'))
        self.nodes[handle]['deleted'] = True

    def close(self, handle):
        self.step('close')
        c._require(not handle.closed)
        handle.closed = True


class SyntheticExecution(c._NativeExecutionPort):
    """Finite in-memory test callbacks only; no actual Windows DLL is loaded."""
    def __init__(self): self.core, self.mode, self.late = None, None, None
    def assert_bound(self, core):
        c._require(core is self.core and core._factory is SyntheticApi)
    def execute(self, core, operation):
        self.assert_bound(core)
        if self.mode == 'skip': return None
        if self.mode == 'early':
            self.late = operation
            return None
        result = operation()
        if self.mode == 'double':
            try: operation()
            except c.OffloadAdmissionError: pass
        return result


def raw_api_core():
    execution = SyntheticExecution()
    core = c.WindowsOffloadCore(Path.cwd(), _api_factory=SyntheticApi, _execution=execution)
    execution.core = core
    api = object.__new__(c._WindowsApi); api.owner = core; core._api = api
    return core, api


def fresh_core():
    execution = SyntheticExecution()
    value = c.WindowsOffloadCore(Path.cwd() / 'synthetic-fresh-domain', _api_factory=SyntheticApi, _execution=execution)
    execution.core = value
    value.prepare_fresh_binding()
    return value


class SyntheticAnchorReceiver(c._JournalAnchorReceiver):
    """Fake independent duplicate; never a native journal or release proof."""
    def __init__(self, fail=None):
        self.fail, self.calls, self.anchor = fail, 0, None

    def _accept_core_anchor(self, binding, handle, identity):
        binding.assert_borrow_callback(self)
        self.calls += 1
        self.borrowed = handle
        self.anchor = SimpleNamespace(identity=identity, closed=False)
        if self.fail == 'interrupt': raise KeyboardInterrupt()
        if self.fail == 'reentry':
            try: binding.borrow_anchor(self)
            except c.OffloadAdmissionError: pass
        return True if self.fail == 'bool' else None


def read_binding_core():
    """Real Core/base-close ledger; only the native replies are synthetic."""
    def prepare(api, path):
        api.step('prepare')
        return tuple((handle, api.identity(handle)) for handle in
                     (api.node(True), api.node(True), api.node(True)))
    with patch.object(SyntheticApi, 'prepare', prepare):
        core = fresh_core()
    api, events = core._api, []
    identity = api.identity
    def observe(handle):
        events.append(('identity', handle.slot.value))
        return identity(handle)
    def close(number):
        events.append(('close', number))
        return 1
    api.identity = observe
    api.k = SimpleNamespace(CloseHandle=close)
    api.call = MethodType(c._WindowsApi.call, api)
    api.close = MethodType(c._WindowsApi.close, api)
    return core, events


class CoreTests(unittest.TestCase):
    def setUp(self):
        # Synthetic test process only; restore the previous table on exit.
        self.scope = patch.dict(c._CUSTODY, {}, clear=True)
        self.scope.start()
        self.addCleanup(self.scope.stop)
        self.read_scope = patch.dict(c._READ_RETIREMENTS, {}, clear=True)
        self.read_scope.start()
        self.addCleanup(self.read_scope.stop)

    def test_unused_read_binding_closes_only_original_handles_after_all_identities(self):
        core, events = read_binding_core()
        handles = tuple(core._handles)
        numbers = [h.value for h in handles]
        self.assertIsNone(core._retire_unused_read_binding())
        self.assertEqual(events[:len(handles)], [('identity', n) for n in numbers])
        self.assertEqual([n for op, n in events if op == 'close'], numbers[::-1])
        closed = set()
        for operation, number in events:
            if operation == 'identity': self.assertNotIn(number, closed)
            else:
                self.assertNotIn(number, closed)
                closed.add(number)
        self.assertTrue(all(h.close_started is True and h.closed is True for h in handles))
        self.assertTrue(core._retired)
        self.assertEqual(core._retirement_kind, 'read-binding')
        self.assertNotIn(id(core), c._CUSTODY)
        self.assertNotIn(id(core), c._READ_RETIREMENTS)
        self.assertLessEqual(set(core._api.steps), {'prepare', 'identity'})
        before = list(events)
        with self.assertRaises(c.OffloadAdmissionError): core.assert_bound()
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertEqual(events, before)

    def test_unused_retirement_never_supplies_a_borrowed_staging_witness(self):
        core, events = read_binding_core()
        binding = core._journal_accounting_binding()
        receiver = SyntheticAnchorReceiver()
        core._retire_unused_read_binding()
        before = list(events)
        custody = dict(c._CUSTODY)
        with self.assertRaises(c.OffloadAdmissionError): binding.retired_witness(receiver, core)
        with self.assertRaises(c.OffloadAdmissionError): binding.borrow_anchor(receiver)
        self.assertEqual(receiver.calls, 0)
        self.assertEqual(events, before)
        self.assertEqual(c._CUSTODY, custody)
        self.assertFalse(core._uncertain)

    def test_staging_witness_requires_the_staging_retirement_kind(self):
        core = fresh_core(); binding = core._journal_accounting_binding()
        receiver = SyntheticAnchorReceiver(); binding.borrow_anchor(receiver)
        core.create_staging(4096); core.seal_staging(); core.retire_fresh_staging()
        witness = binding.retired_witness(receiver, core)
        for kind in ('read-binding', None, False, 0, 'staging-copy'):
            with self.subTest(kind=kind):
                core._retirement_kind = kind
                with self.assertRaises(c.OffloadAdmissionError): binding.retired_witness(receiver, core)
        core._retirement_kind = 'staging'
        self.assertIs(binding.retired_witness(receiver, core), witness)

    def test_unused_read_retirement_denies_actual_borrow_without_closing_anchor(self):
        core, events = read_binding_core(); binding = core._journal_accounting_binding()
        receiver = SyntheticAnchorReceiver(); binding.borrow_anchor(receiver)
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertFalse(any(op == 'close' for op, _ in events))
        self.assertFalse(receiver.anchor.closed)
        self.assertIs(binding._receiver, receiver)
        self.assertIs(c._CUSTODY[id(core)], core)

    def test_unused_read_retirement_rejects_nonempty_and_falsy_staging_states(self):
        states = [('_namespace', ()), ('_stage', False), ('_index', 0),
                  ('_reservation', 0), ('_reservation', 4096), ('_protected', []),
                  ('_sealed', {}), ('_guards', [object()]), ('_allocations', [object()]),
                  ('_pending', False), ('_retirement_kind', 'staging')]
        for name, value in states:
            with self.subTest(name=name, value=value):
                core, events = read_binding_core(); setattr(core, name, value)
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                self.assertFalse(any(op == 'close' for op, _ in events))
                self.assertTrue(core._uncertain)
                self.assertIs(c._CUSTODY[id(core)], core)

    def test_unused_read_retirement_rejects_incomplete_duplicate_or_foreign_records(self):
        def empty(core): core._chain = ()
        def duplicate(core): core._chain = (core._chain[0],) * len(core._chain)
        def extra(core): core._handles.append(c._Handle())
        def swapped(core): core._handles[0], core._handles[1] = core._handles[1], core._handles[0]
        def generation(core): core._handles[0].slot.value = core._handles[1].slot.value
        def started(core): core._handles[0].close_started = True
        def delete_started(core): core._handles[0].delete_started = True
        def identity_changed(core): core._api.nodes[core._handles[-1]]['identity'] = b'X' * 24
        for change in (empty, duplicate, extra, swapped, generation, started, delete_started, identity_changed):
            with self.subTest(change=change.__name__):
                core, events = read_binding_core(); change(core)
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                self.assertFalse(any(op == 'close' for op, _ in events))
                self.assertTrue(core._uncertain)

    def test_unused_read_retirement_copies_and_foreign_binding_do_not_poison_owners(self):
        core, events = read_binding_core(); other, _ = read_binding_core()
        clone = copy.copy(core)
        with self.assertRaises(c.OffloadAdmissionError): clone._retire_unused_read_binding()
        original = core._accounting
        for binding in (copy.copy(original), other._accounting):
            core._accounting = binding
            with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
            self.assertFalse(core._uncertain or other._uncertain)
        core._accounting = original
        self.assertFalse(any(op == 'close' for op, _ in events))

    def test_unused_read_retirement_retains_captured_containers_after_callback_swap(self):
        for field in ('_handles', '_chain', '_api', '_accounting'):
            with self.subTest(field=field):
                core, events = read_binding_core(); original_handles = core._handles
                original_chain = core._chain; api = core._api; identity = api.identity
                other, _ = read_binding_core()
                def swap(handle):
                    value = identity(handle)
                    replacement = {'_handles': list(original_handles), '_chain': tuple(list(original_chain)),
                                   '_api': other._api, '_accounting': other._accounting}[field]
                    setattr(core, field, replacement)
                    return value
                api.identity = swap
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                retained = c._READ_RETIREMENTS[id(core)]
                self.assertIs(retained.handles, original_handles)
                self.assertIs(retained.chain, original_chain)
                self.assertIs(retained.api, api)
                self.assertFalse(any(op == 'close' for op, _ in events))
                self.assertFalse(other._uncertain)

    def test_unused_read_retirement_reentry_or_borrow_during_identity_cannot_hide_change(self):
        for attack in ('reentry', 'borrow-state'):
            with self.subTest(attack=attack):
                core, events = read_binding_core(); identity = core._api.identity
                def changed(handle):
                    result = identity(handle)
                    if attack == 'reentry':
                        try: core.assert_bound()
                        except c.OffloadAdmissionError: pass
                    else: core._accounting._borrow_started = True
                    return result
                core._api.identity = changed
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                self.assertTrue(core._uncertain)
                self.assertFalse(any(op == 'close' for op, _ in events))

    def test_unused_read_retirement_changed_generation_after_close_is_not_adopted(self):
        core, events = read_binding_core(); handles = tuple(core._handles)
        close = core._api.k.CloseHandle
        def reused(number):
            result = close(number)
            handles[1].slot.value = handles[-1].slot.value
            return result
        core._api.k.CloseHandle = reused
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertEqual([n for op, n in events if op == 'close'], [handles[-1].slot.value])
        self.assertIs(c._READ_RETIREMENTS[id(core)].entries[1][1], handles[1])
        before = list(events)
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertEqual(events, before)

    def test_unused_read_retirement_failed_native_close_at_each_position_never_retries(self):
        for position in range(3):
            with self.subTest(position=position):
                core, events = read_binding_core(); handles = tuple(core._handles)
                close = core._api.k.CloseHandle; calls = []
                def fail(number):
                    calls.append(number); close(number)
                    return 0 if len(calls) == position + 1 else 1
                core._api.k.CloseHandle = fail
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                self.assertEqual(len(calls), position + 1)
                self.assertEqual(sum(h.closed for h in handles), position)
                self.assertTrue(core._uncertain)
                self.assertIs(c._CUSTODY[id(core)], core)
                self.assertIs(c._READ_RETIREMENTS[id(core)].handles, core._handles)
                before = list(events)
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                self.assertEqual(events, before)

    def test_unused_read_retirement_interruption_before_and_after_native_ack_keeps_slots(self):
        for after_ack in (False, True):
            with self.subTest(after_ack=after_ack):
                core, events = read_binding_core(); handles = tuple(core._handles)
                if after_ack:
                    close = core._api.close
                    def interrupted(handle):
                        close(handle)
                        raise KeyboardInterrupt()
                    core._api.close = interrupted
                else:
                    def interrupted(number):
                        events.append(('close', number))
                        raise KeyboardInterrupt()
                    core._api.k.CloseHandle = interrupted
                with self.assertRaises(KeyboardInterrupt): core._retire_unused_read_binding()
                self.assertEqual(sum(h.closed for h in handles), int(after_ack))
                self.assertTrue(handles[-1].close_started)
                self.assertTrue(core._uncertain)
                self.assertIs(c._READ_RETIREMENTS[id(core)].handles, core._handles)
                before = list(events)
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                self.assertEqual(events, before)

    def test_unused_read_retirement_does_not_accept_high_level_fake_close_without_ledger(self):
        core, events = read_binding_core()
        core._api.close = MethodType(SyntheticApi.close, core._api)
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertFalse(any(op == 'close' for op, _ in events))
        self.assertTrue(core._uncertain)
        self.assertIs(c._CUSTODY[id(core)], core)

    def test_unused_read_retirement_lost_ack_or_duplicate_dispatch_retains_closed_state(self):
        for mode in ('wrong-result', 'skip', 'double'):
            with self.subTest(mode=mode):
                core, events = read_binding_core(); execute = core._execution.execute
                if mode == 'wrong-result':
                    def lost(bound, operation):
                        execute(bound, operation)
                        return object()
                    core._execution.execute = lost
                else: core._execution.mode = mode
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                self.assertTrue(core._uncertain)
                self.assertIs(c._CUSTODY[id(core)], core)
                self.assertIn(id(core), c._READ_RETIREMENTS)
                self.assertEqual(sum(op == 'close' for op, _ in events), 0 if mode == 'skip' else 3)

    def test_unused_read_retirement_registry_removal_interruption_retains_original_snapshot(self):
        class InterruptedPop(dict):
            def pop(self, key, *args):
                super().pop(key, *args)
                raise KeyboardInterrupt()
        for registry in ('_CUSTODY', '_READ_RETIREMENTS'):
            with self.subTest(registry=registry):
                core, events = read_binding_core()
                with patch.object(c, registry, InterruptedPop(getattr(c, registry))):
                    with self.assertRaises(KeyboardInterrupt): core._retire_unused_read_binding()
                    self.assertTrue(core._retired and core._uncertain)
                    self.assertEqual(core._retirement_kind, 'read-binding')
                    self.assertIs(c._CUSTODY[id(core)], core)
                    self.assertIs(c._READ_RETIREMENTS[id(core)].handles, core._handles)
                    self.assertEqual(sum(op == 'close' for op, _ in events), 3)

    def test_unused_read_retirement_needs_prepared_api_and_finite_owner_before_callbacks(self):
        factory = Mock(side_effect=AssertionError('No native factory expected'))
        unopened = c.WindowsOffloadCore(Path.cwd(), _api_factory=factory)
        with self.assertRaises(c.OffloadAdmissionError): unopened._retire_unused_read_binding()
        factory.assert_not_called()
        self.assertNotIn(id(unopened), c._READ_RETIREMENTS)
        core, events = read_binding_core(); core._execution = None
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertEqual(events, [])
        self.assertFalse(any(h.closed for h in core._handles))

    def test_unused_read_retirement_rejects_every_started_or_malformed_borrow_state(self):
        states = [('_receiver', False), ('_borrow_started', True), ('_borrow_started', 0),
                  ('_borrowed', True), ('_borrowed', 0), ('_borrowing_thread', 1),
                  ('_uncertain', True), ('_uncertain', 0)]
        for name, value in states:
            with self.subTest(name=name, value=value):
                core, events = read_binding_core(); setattr(core._accounting, name, value)
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                self.assertFalse(any(op == 'close' for op, _ in events))
                self.assertFalse(any(h.closed for h in core._handles))
                self.assertIs(c._CUSTODY[id(core)], core)

    def test_unused_read_retirement_foreign_dispatch_thread_denies_before_identity_or_close(self):
        core, events = read_binding_core(); responses = []
        def execute(bound, operation):
            def run():
                try: responses.append(('value', operation()))
                except BaseException as error: responses.append(('error', error))
            thread = Thread(target=run, daemon=True)
            thread.start(); thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
            self.assertEqual(len(responses), 1)
            if responses[0][0] == 'error': raise responses[0][1]
            return responses[0][1]
        core._execution.execute = execute
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertEqual(events, [])
        self.assertTrue(core._uncertain)
        self.assertIs(c._READ_RETIREMENTS[id(core)].handles, core._handles)

    def test_unused_read_retirement_post_ack_slot_mutation_stops_further_closes(self):
        core, events = read_binding_core(); original = tuple(core._handles)
        close = core._api.close
        def mutated(handle):
            close(handle)
            handle.slot.value = 9999
        core._api.close = mutated
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertEqual(sum(op == 'close' for op, _ in events), 1)
        self.assertTrue(core._uncertain and original[-1].closed)
        snapshot = c._READ_RETIREMENTS[id(core)]
        self.assertIs(snapshot.entries[-1][1], original[-1])
        self.assertNotEqual(snapshot.entries[-1][3], original[-1].slot.value)

    def test_retired_read_binding_retries_cannot_overfill_full_owner_table(self):
        retired = []
        for _ in range(3):
            core, events = read_binding_core(); core._retire_unused_read_binding()
            retired.append((core, events, list(events)))
        active = [fresh_core() for _ in range(c._MAX_OWNERS)]
        before = dict(c._CUSTODY)
        self.assertEqual(len(before), c._MAX_OWNERS)
        for core, events, original_events in retired:
            with self.subTest(retired=id(core)):
                with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
                self.assertEqual(c._CUSTODY, before)
                self.assertEqual(c._READ_RETIREMENTS, {})
                self.assertEqual(events, original_events)
                self.assertTrue(core._retired)
                self.assertFalse(core._uncertain)
        self.assertTrue(all(before[id(core)] is core for core in active))

    def test_ordinary_run_rejects_completed_read_binding_without_transient_registration(self):
        core, events = read_binding_core(); core._retire_unused_read_binding()
        insertions = []
        class Observed(dict):
            def __setitem__(self, key, value):
                insertions.append(key)
                return super().__setitem__(key, value)
        before = list(events)
        with patch.object(c, '_CUSTODY', Observed(c._CUSTODY)):
            with self.assertRaises(c.OffloadAdmissionError): core.assert_bound()
            self.assertEqual(insertions, [])
            self.assertNotIn(id(core), c._CUSTODY)
            self.assertEqual(events, before)
            self.assertFalse(core._uncertain)

    def test_interrupted_retirement_pops_restore_entries_before_shared_lock_release(self):
        class InterruptedPop(dict):
            def pop(self, key, *args):
                super().pop(key, *args)
                raise KeyboardInterrupt()
        for registry in ('_CUSTODY', '_READ_RETIREMENTS'):
            with self.subTest(registry=registry):
                core, _ = read_binding_core(); observations = []
                class ObservedLock:
                    def __init__(self): self.lock = c.RLock()
                    def __enter__(self): self.lock.acquire(); return self
                    def __exit__(self, kind, error, traceback):
                        if kind is KeyboardInterrupt:
                            observations.append((c._CUSTODY.get(id(core)) is core,
                                                 id(core) in c._READ_RETIREMENTS))
                        self.lock.release()
                        return False
                with patch.object(c, registry, InterruptedPop(getattr(c, registry))), \
                     patch.object(c, '_CUSTODY_LOCK', ObservedLock()):
                    with self.assertRaises(KeyboardInterrupt): core._retire_unused_read_binding()
                    self.assertEqual(observations, [(True, True)])
                    self.assertIs(c._CUSTODY[id(core)], core)
                    self.assertIs(c._READ_RETIREMENTS[id(core)].core, core)

    def test_post_commit_interruption_does_not_resurrect_owner_after_competing_admission(self):
        core, events = read_binding_core()
        active = [fresh_core() for _ in range(c._MAX_OWNERS - 1)]
        admitted = []
        class AfterCommit:
            def __init__(self): self.lock, self.fired = c.RLock(), False
            def __enter__(self): self.lock.acquire(); return self
            def __exit__(self, kind, error, traceback):
                self.lock.release()
                if (kind is None and not self.fired and core._retired
                        and id(core) not in c._CUSTODY and id(core) not in c._READ_RETIREMENTS):
                    self.fired = True
                    # Model the legal competing admission after lock release,
                    # then a caller interruption before the outer call returns.
                    admitted.append(fresh_core())
                    raise KeyboardInterrupt()
                return False
        with patch.object(c, '_CUSTODY_LOCK', AfterCommit()):
            with self.assertRaises(KeyboardInterrupt): core._retire_unused_read_binding()
        self.assertEqual(len(admitted), 1)
        self.assertEqual(len(c._CUSTODY), c._MAX_OWNERS)
        self.assertNotIn(id(core), c._CUSTODY)
        self.assertNotIn(id(core), c._READ_RETIREMENTS)
        self.assertTrue(core._retired and not core._uncertain)
        self.assertTrue(core._read_retirement.released)
        self.assertEqual(sum(op == 'close' for op, _ in events), 3)
        self.assertTrue(all(c._CUSTODY[id(owner)] is owner for owner in active + admitted))
        with self.assertRaises(c.OffloadAdmissionError):
            core._journal_accounting_binding().retired_witness(SyntheticAnchorReceiver(), core)

    def test_unregistered_read_binding_cannot_mint_custody_admission(self):
        core, events = read_binding_core(); c._CUSTODY.pop(id(core))
        before = dict(c._CUSTODY)
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertEqual(c._CUSTODY, before)
        self.assertEqual(c._READ_RETIREMENTS, {})
        self.assertEqual(events, [])
        self.assertFalse(core._retired or core._uncertain)

    def test_pending_read_retirement_blocks_other_operation_before_identity_or_close(self):
        core, events = read_binding_core(); run = core._run; interrupted = []
        def interleave(function):
            if not interrupted:
                interrupted.append(True)
                try: run(core._check_bound)
                except c.OffloadAdmissionError: pass
            return run(function)
        core._run = interleave
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertEqual(events, [])
        self.assertTrue(core._uncertain)
        self.assertIs(c._CUSTODY[id(core)], core)
        self.assertIs(core._read_retirement, c._READ_RETIREMENTS[id(core)])

    def test_native_callback_cannot_assign_a_release_commit_before_acknowledged_removals(self):
        core, events = read_binding_core(); identity = core._api.identity
        def premature(handle):
            value = identity(handle)
            core._read_retirement.released = True
            return value
        core._api.identity = premature
        with self.assertRaises(c.OffloadAdmissionError): core._retire_unused_read_binding()
        self.assertFalse(core._read_retirement.released)
        self.assertFalse(any(op == 'close' for op, _ in events))
        self.assertTrue(core._uncertain)
        self.assertIs(c._CUSTODY[id(core)], core)
        self.assertIs(c._READ_RETIREMENTS[id(core)], core._read_retirement)

    def test_constructor_and_unprepared_denial_have_no_native_or_file_effects(self):
        factory = Mock(side_effect=AssertionError('No native factory expected'))
        core = c.WindowsOffloadCore(Path.cwd(), _api_factory=factory)
        factory.assert_not_called()
        with self.assertRaises(c.OffloadAdmissionError): core.assert_bound()
        factory.assert_not_called()

    def test_actual_core_preparation_requires_finite_owner_before_dll_or_file_callback(self):
        core = c.WindowsOffloadCore(Path.cwd())
        with patch.object(C, 'WinDLL', create=True) as native:
            with self.assertRaises(c.OffloadAdmissionError): core.prepare_fresh_binding()
            native.assert_not_called()
        self.assertIsNone(core._api)
        with self.assertRaises(TypeError): c._NativeExecutionPort()
        with self.assertRaises(c.OffloadAdmissionError): c.WindowsOffloadCore(Path.cwd(), _execution={})

    def test_accounting_binding_construction_is_effect_free_and_unprepared_borrow_denies(self):
        factory = Mock(side_effect=AssertionError('No native factory expected'))
        core = c.WindowsOffloadCore(Path.cwd(), _api_factory=factory)
        binding = core._journal_accounting_binding()
        self.assertIs(binding, core._journal_accounting_binding())
        receiver = SyntheticAnchorReceiver()
        with self.assertRaises(c.OffloadAdmissionError): binding.borrow_anchor(receiver)
        factory.assert_not_called()
        self.assertEqual(receiver.calls, 0)

    def test_independent_journal_anchor_survives_exact_core_retirement(self):
        core = fresh_core(); binding = core._journal_accounting_binding()
        receiver = SyntheticAnchorReceiver(); handles = list(core._handles)
        binding.borrow_anchor(receiver)
        self.assertEqual(core._handles, handles)
        self.assertEqual(receiver.calls, 1)
        with self.assertRaises(c.OffloadAdmissionError): binding.assert_borrow_callback(receiver)
        with self.assertRaises(c.OffloadAdmissionError): binding.retired_witness(receiver, core)
        core.create_staging(4096); core.seal_staging(); core.retire_fresh_staging()
        steps = list(core._api.steps)
        witness = binding.retired_witness(receiver, core)
        binding.assert_retired_witness(receiver, core, witness)
        self.assertIs(witness, binding.retired_witness(receiver, core))
        self.assertEqual(core._api.steps, steps)  # No closed-handle native query.
        self.assertTrue(receiver.borrowed.closed)
        self.assertFalse(receiver.anchor.closed)
        marker = object()
        self.assertIs(binding.execute(receiver, lambda: marker, retired=True), marker)

    def test_binding_receiver_core_and_witness_copies_do_not_grant_authority(self):
        core = fresh_core(); binding = core._journal_accounting_binding()
        receiver = SyntheticAnchorReceiver(); clone = copy.copy(binding)
        steps = list(core._api.steps)
        with self.assertRaises(c.OffloadAdmissionError): clone.borrow_anchor(receiver)
        self.assertEqual(receiver.calls, 0)
        self.assertEqual(core._api.steps, steps)
        self.assertFalse(core._uncertain)
        binding.borrow_anchor(receiver)
        for foreign in (SyntheticAnchorReceiver(), copy.copy(receiver)):
            with self.assertRaises(c.OffloadAdmissionError): binding.assert_consumer(foreign, core)
        other = fresh_core()
        self.assertEqual(core._chain[-1][1], other._chain[-1][1])
        with self.assertRaises(c.OffloadAdmissionError): binding.assert_consumer(receiver, other)
        core.create_staging(4096); core.seal_staging(); core.retire_fresh_staging()
        witness = binding.retired_witness(receiver, core)
        for foreign in (copy.copy(witness), {'retired': True}, True):
            with self.assertRaises(c.OffloadAdmissionError): binding.assert_retired_witness(receiver, core, foreign)

    def test_unknown_borrow_ack_or_hidden_reentry_retains_receiver_and_prevents_retry(self):
        for mode in ('bool', 'interrupt', 'reentry'):
            core = fresh_core(); binding = core._journal_accounting_binding()
            receiver = SyntheticAnchorReceiver(mode)
            with self.subTest(mode=mode), self.assertRaises(BaseException): binding.borrow_anchor(receiver)
            self.assertTrue(core._uncertain and binding._uncertain)
            self.assertIs(binding._receiver, receiver)
            self.assertIs(c._CUSTODY[id(core)], core)
            steps = list(core._api.steps)
            with self.assertRaises(c.OffloadAdmissionError): binding.borrow_anchor(receiver)
            self.assertEqual(receiver.calls, 1)
            self.assertEqual(core._api.steps, steps)
            self.assertNotIn('delete', steps)
            self.assertNotIn('close', steps)

    def test_retired_boolean_is_insufficient_after_lost_execution_ack(self):
        core = fresh_core(); binding = core._journal_accounting_binding()
        receiver = SyntheticAnchorReceiver(); binding.borrow_anchor(receiver)
        core.create_staging(4096); core.seal_staging()
        original = core._execution.execute
        def lost_ack(bound, operation):
            original(bound, operation)
            return object()
        core._execution.execute = lost_ack
        with self.assertRaises(c.OffloadAdmissionError): core.retire_fresh_staging()
        self.assertTrue(core._retired and all(h.closed for h in core._handles))
        self.assertTrue(core._uncertain)
        steps = list(core._api.steps)
        with self.assertRaises(c.OffloadAdmissionError): binding.retired_witness(receiver, core)
        self.assertEqual(core._api.steps, steps)

    def test_execution_producer_cannot_skip_return_early_or_hide_double_dispatch(self):
        for mode in ('skip', 'early', 'double'):
            execution = SyntheticExecution(); execution.mode = mode
            core = c.WindowsOffloadCore(Path.cwd(), _api_factory=SyntheticApi, _execution=execution)
            execution.core = core
            with self.subTest(mode=mode), self.assertRaises(c.OffloadAdmissionError): core.prepare_fresh_binding()
            if mode == 'early':
                with self.assertRaises(c.OffloadAdmissionError): execution.late()
                self.assertIsNone(core._api)
            self.assertTrue(core._uncertain)
            self.assertIs(c._CUSTODY[id(core)], core)

    def test_shallow_copy_or_foreign_api_owner_denies_before_original_callbacks(self):
        core = fresh_core(); clone = copy.copy(core)
        steps = list(core._api.steps)
        for operation in (clone.assert_bound, clone.retain_failure, clone.prepare_fresh_binding):
            with self.assertRaises(c.OffloadAdmissionError): operation()
        self.assertEqual(core._api.steps, steps)
        self.assertFalse(core._uncertain)
        core._api.owner = clone
        with self.assertRaises(c.OffloadAdmissionError): core.assert_bound()
        self.assertEqual(core._api.steps, steps)

    def test_real_core_fresh_create_seal_check_and_retire_with_synthetic_api(self):
        core = fresh_core()
        path = core.create_staging(4096)
        self.assertEqual(path.parent, core.cache_root / '.aisb-offload-v1')
        core._api.node(False, core._stage[0], 'index.json', 2)
        core.seal_staging()
        core.assert_sealed()
        core.retire_fresh_staging()
        self.assertTrue(core._retired)
        self.assertNotIn(id(core), c._CUSTODY)
        self.assertTrue(all(h.closed for h in core._handles))
        self.assertLess(core._api.steps.index('retire-guard'), core._api.steps.index('delete'))

    def test_empty_staging_is_supported_without_invented_index(self):
        core = fresh_core(); core.create_staging(4096); core.seal_staging()
        self.assertEqual(len(core._guards), 2)
        core.retire_fresh_staging()

    def test_existing_namespace_is_never_opened_adopted_or_cleaned(self):
        core = fresh_core()
        core._api.node(True, core._chain[-1][0], '.aisb-offload-v1')
        with self.assertRaises(c.OffloadAdmissionError): core.create_staging(4096)
        self.assertNotIn('delete', core._api.steps)
        self.assertNotIn('close', core._api.steps)
        self.assertIs(c._CUSTODY[id(core)], core)

    def test_failed_creation_return_keeps_all_predispatch_native_slots(self):
        core = fresh_core(); original = core._api.create_directory
        def create(*args):
            original(*args)
            raise KeyboardInterrupt()
        core._api.create_directory = create
        with self.assertRaises(KeyboardInterrupt): core.create_staging(4096)
        self.assertEqual(len(core._handles), 2)
        self.assertIs(c._CUSTODY[id(core)], core)
        with self.assertRaises(c.OffloadAdmissionError): core.create_staging(4096)
        self.assertEqual(core._api.steps.count('create-.aisb-offload-v1'), 1)

    def test_unknown_file_stream_or_allocation_refuses_before_protection(self):
        for case in ('extra', 'stream', 'size'):
            with self.subTest(case=case):
                core = fresh_core(); core.create_staging(2)
                handle = core._api.node(False, core._stage[0], 'foreign.bin' if case == 'extra' else 'index.json', 2)
                if case == 'stream': core._api.nodes[handle]['named_stream'] = True
                with self.assertRaises(c.OffloadAdmissionError): core.seal_staging()
                self.assertNotIn('protect', core._api.steps)
                self.assertNotIn('delete', core._api.steps)

    def test_late_guard_break_stops_reuse_and_cleanup_without_retry(self):
        core = fresh_core(); core.create_staging(4096); core.seal_staging()
        core._api.broken = True
        with self.assertRaises(c.OffloadAdmissionError): core.assert_sealed()
        before = list(core._api.steps)
        with self.assertRaises(c.OffloadAdmissionError): core.retire_fresh_staging()
        self.assertEqual(core._api.steps, before)
        self.assertNotIn('delete', before)

    def test_inherited_or_changed_private_profile_is_not_normalized(self):
        for control in (4, 0x404, 0x1404, 0x100c):
            core = fresh_core(); core.create_staging(4096)
            core._api.nodes[core._stage[0]]['permissions'] = (core._stage[2], control)
            with self.assertRaises(c.OffloadAdmissionError): core.seal_staging()
            self.assertNotIn('protect', core._api.steps)

    def test_failure_in_each_stage_preserves_custody_without_cleanup(self):
        for failure in ('protect', 'guard', 'check-guard', 'retire-guard', 'delete', 'close'):
            core = fresh_core(); core.create_staging(4096)
            if failure in ('retire-guard', 'delete', 'close'): core.seal_staging()
            core._api.fail = failure
            with self.subTest(failure=failure), self.assertRaises(c.OffloadAdmissionError):
                core.retire_fresh_staging() if core._sealed is not None else core.seal_staging()
            self.assertIs(c._CUSTODY[id(core)], core)
            steps = list(core._api.steps)
            with self.assertRaises(c.OffloadAdmissionError): core.assert_bound()
            self.assertEqual(steps, core._api.steps)

    def test_callback_reentry_cannot_hide_terminal_uncertainty(self):
        core = fresh_core()
        def identity(_):
            try: core.assert_bound()
            except c.OffloadAdmissionError: pass
            return core._chain[0][1]
        core._api.identity = identity
        with self.assertRaises(c.OffloadAdmissionError): core.assert_bound()
        self.assertTrue(core._uncertain)

    def test_native_close_unknown_or_interruption_is_never_retried(self):
        for reply in (0, {'closed': True}, KeyboardInterrupt()):
            core, api = raw_api_core()
            close = Mock(side_effect=reply if isinstance(reply, BaseException) else None,
                         return_value=reply if not isinstance(reply, BaseException) else None)
            api.k = SimpleNamespace(CloseHandle=close)
            handle = api.handle(); handle.slot.value = 701
            with self.assertRaises(BaseException): core._run(lambda: api.close(handle))
            self.assertTrue(handle.close_started)
            self.assertFalse(handle.closed)
            with self.assertRaises(c.OffloadAdmissionError): api.close(handle)
            close.assert_called_once_with(701)
            self.assertIs(c._CUSTODY[id(core)], core)
            self.assertIsNotNone(core._pending)

    def test_confirmed_native_close_is_idempotent_and_keeps_exact_attempt(self):
        core, api = raw_api_core()
        api.k = SimpleNamespace(CloseHandle=Mock(return_value=1))
        handle = api.handle(); handle.slot.value = 702
        core._run(lambda: api.close(handle)); core._run(lambda: api.close(handle))
        api.k.CloseHandle.assert_called_once_with(702)
        self.assertTrue(handle.close_started and handle.closed)

    def test_native_dispatch_requires_canonical_api_and_active_execution_thread(self):
        core, api = raw_api_core()
        callback = Mock(return_value=1)
        with self.assertRaises(c.OffloadAdmissionError): api.call(callback)
        callback.assert_not_called()
        duplicate = copy.copy(api)
        with self.assertRaises(c.OffloadAdmissionError): duplicate.call(callback)
        callback.assert_not_called()

    def test_pending_native_create_owns_output_slot_before_dispatch_and_denies_reuse(self):
        core, api = raw_api_core()
        parent = api.handle(); parent.slot.value = 100
        def create(slot, *_):
            self.assertIs(c._CUSTODY[id(core)], core)
            self.assertEqual(len(core._handles), 2)
            C.cast(slot, C.POINTER(c._PTR)).contents.value = 703
            return 259  # Pending, not successful ownership.
        api.n = SimpleNamespace(NtCreateFile=Mock(side_effect=create))
        with self.assertRaises(c.OffloadAdmissionError): core._run(lambda: api.open(parent, 'new', 0x700a1, create=True))
        self.assertEqual(core._handles[-1].slot.value, 703)
        self.assertIsNotNone(core._pending)
        self.assertTrue(core._uncertain)

    def test_raced_successful_break_or_unconfirmed_cancel_never_retires_or_closes(self):
        for result, status in ((1, 0), (0, 259)):
            core, api = raw_api_core()
            handle, event = api.handle(), api.handle(); handle.slot.value, event.slot.value = 710, 711
            overlapped = c._Overlapped(); overlapped.event = event.value; overlapped.internal = status
            api.k = SimpleNamespace(CancelIoEx=Mock(return_value=1), WaitForSingleObject=Mock(return_value=0), GetOverlappedResult=Mock(return_value=result), CloseHandle=Mock(return_value=1))
            guard = {'handle': handle, 'event': event, 'overlapped': overlapped, 'retirement_started': False, 'retired': False}
            core._guards.append(guard)
            with patch.object(C, 'get_last_error', return_value=995, create=True), self.assertRaises(c.OffloadAdmissionError):
                core._run(lambda: api.retire_guard(guard))
            self.assertFalse(guard['retired'])
            api.k.CloseHandle.assert_not_called()
            self.assertTrue(core._uncertain)

    def test_only_confirmed_cancelled_native_status_retires_the_exact_guard(self):
        core, api = raw_api_core()
        handle, event = api.handle(), api.handle(); handle.slot.value, event.slot.value = 712, 713
        overlapped = c._Overlapped(); overlapped.event = event.value; overlapped.internal = 0xc0000120
        api.k = SimpleNamespace(CancelIoEx=Mock(return_value=1), WaitForSingleObject=Mock(return_value=0), GetOverlappedResult=Mock(return_value=0), CloseHandle=Mock(return_value=1))
        guard = {'handle': handle, 'event': event, 'overlapped': overlapped, 'retirement_started': False, 'retired': False}
        core._guards.append(guard)
        with patch.object(C, 'get_last_error', return_value=995, create=True): core._run(lambda: api.retire_guard(guard))
        self.assertTrue(guard['retired'] and event.closed)
        self.assertFalse(handle.closed)
        api.k.CloseHandle.assert_called_once_with(713)
        with self.assertRaises(c.OffloadAdmissionError): api.retire_guard(guard)
        api.k.CancelIoEx.assert_called_once()

    def test_directory_page_requires_bounded_complete_valid_records(self):
        def page(name='index.json', following=0, attrs=0x80, length=None):
            text = name.encode('utf-16-le')
            header = c._DIRECTORY_ROW.pack(following, 0, 0, 0, 0, 0, 2, 2, attrs, len(text) if length is None else length, 0, 0, b'x' * 16)
            return (header + text).ljust(c._PAGE_BYTES, b'\0')
        self.assertEqual(c._directory_page(page())[0][0], 'index.json')
        for raw in (b'', page('../escape'), page(attrs=0x480), page(length=511), page(following=8)):
            with self.subTest(size=len(raw)), self.assertRaises(c.OffloadAdmissionError): c._directory_page(raw)


if __name__ == '__main__': unittest.main()
