"""Model-free Core/ABI fault tests. All native and directory facts are synthetic."""
import ctypes as C
import copy
from pathlib import Path
import struct
from types import SimpleNamespace
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


class CoreTests(unittest.TestCase):
    def setUp(self):
        # Synthetic test process only; restore the previous table on exit.
        self.scope = patch.dict(c._CUSTODY, {}, clear=True)
        self.scope.start()
        self.addCleanup(self.scope.stop)

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
