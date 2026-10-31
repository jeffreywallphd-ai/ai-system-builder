"""Pure fixed-fixture oracles. Synthetic replies provide no native proof."""
import copy
import ctypes as C
import importlib.util
import json
import hashlib
import os
import py_compile
from pathlib import Path
import sys
import time
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'windows_offload_core_fixture.py'
SPEC = importlib.util.spec_from_file_location('core_native_fixture_subject', SCRIPT)
subject = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = subject
SPEC.loader.exec_module(subject)


def child(case):
    control, denied = case == 'deadline-control', case == 'namespace-denied'
    return {'schema_version': subject.SCHEMA, 'case': case, 'source_digest': 'a' * 64,
            'outcome': 'armed' if control else 'expected-denial' if denied else 'observed',
            'expected_refusal': denied, 'core_created': not (control or denied),
            'core_cleanup_confirmed': not (control or denied), 'core_handles_closed': not (control or denied),
            'core_uncertainty_retained': denied, 'index_bytes': 2 if case == 'one-index' else 0,
            'native_call_count': 0 if control else 50,
            'last_native_phase': 'none' if control else 'NtCreateFile' if denied else 'CloseHandle',
            'last_native_return_code': None if control else 0xc0000035 if denied else 1,
            'last_os_error_code': None if control else 0, 'elapsed_ns': 100_000,
            'timer_configured': True, 'model_started': False, 'production_composed': False, 'failure_stage': 'none'}


def parent(case):
    return {'case': case, 'process_exit_observed': True, 'exit_code': 2 if case == 'deadline-control' else 0,
            'job_active_zero': True, 'membership_read_back': True, 'limits_read_back': True,
            'dispatch_after_ready': True, 'parent_cleanup_confirmed': True, 'report_bytes': 1024,
            'elapsed_ns': 200_000}


class FakeNative:
    """Synthetic ABI/controller responses; never constructs a Windows DLL."""
    call = subject._Native.call
    acquire = subject._Native.acquire
    close = subject._Native.close
    inherit = subject._Native.inherit
    wait = subject._Native.wait

    def __init__(self, fail=None):
        self.deadline_ns = time.monotonic_ns() + subject.BUDGET_NS
        self.uncertain = self.expired = False
        self.calls, self.buffers, self.handles, self.pending = [], [], [], None
        self.fail, self.issued = fail, []
        self.next_handle = 100
        self.flags = {}; self.dispatched = self.exited = False
        self.raw = json.dumps(child('empty-stage')).encode()
        self.job = subject._ABI
        self.api = SimpleNamespace(location=lambda image: 'C:\\Python314\\python.exe' if image else 'C:\\Windows')
        functions = ('CreateFileW GetFileType GetFileSizeEx GetFileInformationByHandleEx DuplicateHandle '
                     'GetCurrentProcess CreateJobObjectW SetInformationJobObject QueryInformationJobObject '
                     'CreateEventW GetHandleInformation InitializeProcThreadAttributeList UpdateProcThreadAttribute '
                     'DeleteProcThreadAttributeList CreateProcessW GetProcessId IsProcessInJob ResumeThread '
                     'WaitForSingleObject SetEvent GetExitCodeProcess SetFilePointerEx ReadFile CloseHandle').split()
        self.k = SimpleNamespace(**{name: self.function(name) for name in functions})

    def origin(self): pass
    def live(self):
        subject.require(not self.uncertain and not self.expired and time.monotonic_ns() < self.deadline_ns, 'synthetic-deadline')

    def new(self, inherit=False):
        self.next_handle += 1; self.flags[self.next_handle] = int(inherit)
        return self.next_handle

    def function(self, name):
        def invoke(*args):
            self.issued.append(name)
            if name == 'GetCurrentProcess': return -1
            if name == 'CreateFileW': return self.new()
            if name == 'GetFileType': return 1
            if name == 'GetFileSizeEx': args[1]._obj.value = len(self.raw) if self.dispatched else 0; return 1
            if name == 'GetFileInformationByHandleEx': return 1
            if name == 'DuplicateHandle': args[3]._obj.value = self.new(True); return 1
            if name == 'CreateJobObjectW': return self.new()
            if name == 'CreateEventW': return self.new(True)
            if name == 'GetHandleInformation': args[1]._obj.value = self.flags.get(args[0], 0); return 1
            if name == 'InitializeProcThreadAttributeList':
                if args[0] is None:
                    args[3]._obj.value = 128; C.set_last_error(122); return 0
                return 1
            if name == 'QueryInformationJobObject':
                value = args[2]._obj
                if args[1] == 9:
                    value.basic.flags, value.basic.active_process_limit = subject.LIMIT_FLAGS, 1
                    value.process_memory_limit = value.job_memory_limit = subject.MEMORY_BYTES
                    if self.fail == 'limits': value.basic.active_process_limit = 2
                else:
                    value.total, value.active, value.terminated = 1, int(not self.exited), 0
                    if self.fail == 'active-zero' and self.exited: value.active = 1
                return 1
            if name == 'CreateProcessW':
                self.process, self.thread = self.new(), self.new()
                args[-1]._obj.process, args[-1]._obj.thread = self.process, self.thread
                args[-1]._obj.pid, args[-1]._obj.tid = 17, 18
                return 0 if self.fail == 'partial-create' else 1
            if name == 'GetProcessId': return 17
            if name == 'IsProcessInJob': args[2]._obj.value = 0 if self.fail == 'membership' else 1; return 1
            if name == 'DeleteProcThreadAttributeList': return None
            if name == 'ResumeThread': return 1
            if name == 'WaitForSingleObject':
                if args[0] == getattr(self, 'process', None):
                    if not self.dispatched or self.fail == 'exit-timeout': return 258
                    self.exited = True
                return 0
            if name == 'SetEvent': self.dispatched = True; return 1
            if name == 'GetExitCodeProcess': args[1]._obj.value = 0; return 1
            if name == 'SetFilePointerEx': args[2]._obj.value = 0; return 1
            if name == 'ReadFile': C.memmove(args[1], self.raw, len(self.raw)); args[3]._obj.value = len(self.raw); return 1
            if name == 'CloseHandle': return 0 if self.fail == 'close' else 1
            return 1
        return invoke


class ControllerTests(unittest.TestCase):
    def session(self, native):
        return subject._Session(native, 'a' * 32, 'empty-stage', {subject.TOOL_FILES[1]: 'a' * 64}, subject.RUNS / ('a' * 32) / 'empty-stage')

    def test_synthetic_complete_parent_observes_exit_before_bounded_read_and_close(self):
        native = FakeNative(); session = self.session(native)
        self.assertTrue(session.resumed)
        self.assertNotIn('ReadFile', native.issued)
        self.assertEqual(subject.decode_report(session.observe()), child('empty-stage'))
        session.close()
        self.assertTrue(session.observed['parent_cleanup_confirmed'])
        self.assertTrue(all(h.closed for h in native.handles))
        self.assertLess(native.issued.index('GetExitCodeProcess'), native.issued.index('ReadFile'))
        create = next(row for row in native.calls if row['stage'] == 'atomic-process-create')
        self.assertEqual(create['args'][5], 0x80000 | 4 | 0x400 | 8)
        attrs = next(row for row in native.calls if row['stage'] == 'attribute-handles')['args'][3]._obj
        self.assertEqual(len(attrs), 3)
        self.assertNotIn(session.handles['job'].value, list(attrs))
        self.assertEqual(native.issued.count('DeleteProcThreadAttributeList'), 1)

    def test_pre_resume_membership_limits_and_partial_creation_failures_retain_slots(self):
        for fail in ('membership', 'limits', 'partial-create'):
            native = FakeNative(fail)
            with self.subTest(fail=fail), self.assertRaises(subject.FixtureError): self.session(native)
            self.assertNotIn('ResumeThread', native.issued)
            self.assertNotIn('ReadFile', native.issued)
            self.assertTrue(native.uncertain)
            sessions = [x for x in native.buffers if type(x) is subject._Session]
            self.assertEqual(len(sessions), 1)
            self.assertFalse(sessions[0].finished)
            if fail == 'partial-create':
                self.assertTrue(sessions[0].create_started)
                self.assertFalse(sessions[0].create_acknowledged)
                self.assertIsNotNone(sessions[0].info.process)
                self.assertIsNotNone(native.pending)

    def test_timeout_and_active_process_never_allow_report_read_or_cleanup(self):
        for fail in ('exit-timeout', 'active-zero'):
            native = FakeNative(fail); session = self.session(native)
            with self.subTest(fail=fail), self.assertRaises(subject.FixtureError): session.observe()
            self.assertNotIn('ReadFile', native.issued)
            with self.assertRaises(subject.FixtureError): session.close()
            self.assertFalse(session.finished)

    def test_oversized_report_fails_before_read(self):
        native = FakeNative(); session = self.session(native); native.raw = b'x' * 8193
        with self.assertRaises(subject.FixtureError): session.observe()
        self.assertNotIn('ReadFile', native.issued)

    def test_failed_close_is_one_attempt_and_copied_session_is_denied_before_native_call(self):
        native = FakeNative(); session = self.session(native)
        copied = copy.copy(session); count = len(native.calls)
        with self.assertRaises(subject.FixtureError): copied.observe()
        self.assertEqual(len(native.calls), count)
        session.observe(); native.fail = 'close'
        entry = session.handles['process']
        with self.assertRaises(subject.FixtureError): session.close()
        self.assertTrue(entry.close_started); self.assertFalse(entry.closed)
        count = native.issued.count('CloseHandle')
        with self.assertRaises(subject.FixtureError): native.close(entry)
        self.assertEqual(native.issued.count('CloseHandle'), count)

    def test_collector_preserves_prior_case_and_stops_after_unconfirmed_observation(self):
        native = SimpleNamespace(uncertain=False, live=lambda: None)
        sessions = []
        class Session:
            def __init__(self, _n, _run, case, _hashes, _folder):
                self.case, self.uncertain = case, False
                self.observed = parent(case); sessions.append(self)
            def observe(self):
                if self.case == 'empty-stage': raise subject.FixtureError('synthetic-unconfirmed-exit')
                return json.dumps(child(self.case)).encode()
            def close(self): pass
        rows = []
        with patch.object(subject, '_fresh_directory'), patch.object(subject, '_Session', Session), patch.object(subject, 'source_digest', return_value='a' * 64):
            with self.assertRaises(subject.FixtureError): subject._collect(native, 'a' * 32, {}, subject.RUNS / ('a' * 32), rows)
        self.assertEqual([row['case'] for row in rows], ['deadline-control', 'empty-stage'])
        self.assertTrue(rows[0]['accepted']); self.assertFalse(rows[1]['accepted'])
        self.assertTrue(native.uncertain and sessions[-1].uncertain)

    def test_invalid_child_payload_is_not_echoed_and_does_not_start_another_case(self):
        native = SimpleNamespace(uncertain=False, live=lambda: None)
        started = []
        class Session:
            def __init__(self, _n, _run, case, _hashes, _folder):
                self.case = case; self.observed = parent(case); started.append(case)
            def observe(self):
                data = child(self.case); data[field] = 'synthetic-private-payload'
                return json.dumps(data).encode()
            def close(self): pass
        for field in ('extra', 'failure_stage'):
            rows = []; started.clear()
            with self.subTest(field=field), patch.object(subject, '_fresh_directory'), patch.object(subject, '_Session', Session), patch.object(subject, 'source_digest', return_value='a' * 64):
                self.assertFalse(subject._collect(native, 'a' * 32, {}, subject.RUNS / ('a' * 32), rows))
            self.assertEqual(started, ['deadline-control'])
            self.assertNotIn('child', rows[0])
            self.assertNotIn('synthetic-private-payload', json.dumps(rows))
            self.assertFalse(rows[0]['accepted'])

    def test_bootstrap_and_standalone_guard_refuse_caller_commands_and_imported_effects(self):
        for case, handles in [('unknown', (1, 2, 3)), ('empty-stage', (1, 1, 2)), ('empty-stage', (True, 2, 3))]:
            with self.assertRaises(subject.FixtureError): subject._bootstrap('a' * 32, case, {'a.py': 'a' * 64}, 12, *handles)
        with patch.object(subject, '_Native', side_effect=AssertionError('No native effects')), patch.object(Path, 'mkdir', side_effect=AssertionError('No files')):
            with self.assertRaises(subject.FixtureError): subject.standalone_native()

    def test_failure_diagnostics_are_codes_and_fixed_labels_only(self):
        self.assertEqual(subject._safe_failure({'failure_stage': 'synthetic-failure', 'last_native_phase': 'NtCreateFile',
                          'last_native_return_code': 0xc0000035, 'last_os_error_code': True,
                          'native_call_count': 12, 'private': 'not reported'}),
                         {'last_native_phase': 'NtCreateFile',
                          'last_native_return_code': 0xc0000035, 'native_call_count': 12})
        self.assertEqual(subject._safe_failure({'failure_stage': 'C:\\private', 'last_native_phase': 'private-path',
                                              'native_call_count': -1}), {'last_native_return_code': None, 'last_os_error_code': None})

    def test_exact_source_loader_ignores_a_valid_stale_bytecode_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'fixed.py'
            path.write_bytes(b'VALUE = "cached"\n'); before = path.stat()
            py_compile.compile(str(path), doraise=True)
            raw = b'VALUE = "source"\n'; path.write_bytes(raw)
            os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
            # Causal control: ordinary SourceFileLoader accepts the valid stale
            # cache even with -B. Only synthetic constants execute in this test.
            spec = importlib.util.spec_from_file_location('_synthetic_cached_control', path)
            cached = importlib.util.module_from_spec(spec); spec.loader.exec_module(cached)
            self.assertEqual(cached.VALUE, 'cached')
            loaded = subject._load_file('_synthetic_source_control', path, hashlib.sha256(raw).hexdigest())
            self.assertEqual(loaded.VALUE, 'source')
            with self.assertRaises(subject.FixtureError): subject._load_file('_synthetic_wrong_hash', path, '0' * 64)
        for name in ('_synthetic_source_control', '_synthetic_wrong_hash'): sys.modules.pop(name, None)

    def test_failed_exclusive_run_creation_cannot_write_inside_the_candidate(self):
        class End(BaseException): pass
        native = SimpleNamespace(calls=[], arm_deadline=lambda: None, exit_self=lambda code: (_ for _ in ()).throw(End(code)))
        output = []
        with patch.object(subject, '__name__', '_standalone_windows_core_fixture'), patch.object(sys, 'argv', [str(subject.ENTRY), '--native']), patch.object(sys, 'flags', SimpleNamespace(isolated=1, no_site=1)), patch.object(sys, 'dont_write_bytecode', True), patch.object(sys, 'prefix', sys.base_prefix), patch.object(subject, '_Native', return_value=native), patch.object(subject, '_all_hashes', return_value={'synthetic.py': 'a' * 64}), patch.object(subject, '_fresh_directory', side_effect=subject.FixtureError('fixture-directory')), patch.object(Path, 'open', side_effect=AssertionError('No candidate directory access')) as opened, patch.object(os, 'write', side_effect=lambda _fd, raw: output.append(raw) or len(raw)), patch.object(subject, '_park', side_effect=End(9)):
            with self.assertRaises(End) as ended: subject.standalone_native()
        self.assertEqual(ended.exception.args, (9,))
        opened.assert_not_called()
        result = json.loads(output[0]); self.assertEqual(result['failure_stage'], 'fixture-directory')
        self.assertNotIn('run_id', result)

    def test_native_dispatch_retains_interrupted_call_and_rejects_copy_before_effect(self):
        native = object.__new__(subject._Native)
        native._Native__origin = native
        native._Native__profile = subject._CORE_PROFILE
        native.uncertain = native.expired = False
        native.deadline_ns = time.monotonic_ns() + subject.BUDGET_NS
        native.calls, native.buffers, native.handles, native.pending = [], [], [], None
        effects = []
        def interrupted(*args): effects.append(args); raise KeyboardInterrupt()
        with patch.object(subject, '_NATIVE_OWNERS', [native]):
            copied = copy.copy(native)
            with self.assertRaises(subject.FixtureError): copied.call('synthetic-copy', interrupted, object())
            self.assertEqual(effects, [])
            argument = object()
            with self.assertRaises(KeyboardInterrupt): native.call('synthetic-interruption', interrupted, argument)
            self.assertTrue(native.uncertain)
            self.assertIs(native.pending['args'][0], argument)
            self.assertTrue(native.pending['started']); self.assertFalse(native.pending['returned'])
            with self.assertRaises(subject.FixtureError): native.call('synthetic-retry', interrupted, argument)
            self.assertEqual(len(effects), 1)

    def test_profiles_are_canonical_immutable_and_do_not_switch_core_constants(self):
        core, journal = subject._CORE_PROFILE, subject._JOURNAL_PROFILE
        self.assertIs(subject._canonical_profile(core), core)
        self.assertIs(subject._canonical_profile(journal), journal)
        self.assertEqual(core.cases, ('deadline-control', 'empty-stage', 'one-index', 'namespace-denied'))
        self.assertEqual((subject.ENTRY, subject.CASES, subject.SCHEMA, subject.RUNS),
                         (core.entry, core.cases, core.schema, core.runs))
        self.assertNotEqual(core.entry, journal.entry)
        self.assertNotEqual(core.schema, journal.schema)
        for value in (copy.copy(core), copy.copy(journal), {'cases': journal.cases}, None):
            with self.subTest(value=type(value).__name__), self.assertRaises(subject.FixtureError):
                subject._canonical_profile(value)
        with self.assertRaises(AttributeError): journal.entry = core.entry

    def test_bootstrap_binds_literal_canonical_profile_and_refuses_cross_cases(self):
        hashes = {subject.TOOL_FILES[1]: 'a' * 64}
        for profile in (subject._CORE_PROFILE, subject._JOURNAL_PROFILE):
            code = subject._bootstrap('a' * 32, profile.cases[1], hashes, 1, 10, 11, 12, profile)
            expected = 'm._CORE_PROFILE' if profile is subject._CORE_PROFILE else 'm._JOURNAL_PROFILE'
            self.assertIn(expected, code)
            compile(code, '<synthetic-fixed-bootstrap>', 'exec')
        for case, profile in (('journal-roundtrip', subject._CORE_PROFILE), ('empty-stage', subject._JOURNAL_PROFILE)):
            with self.assertRaises(subject.FixtureError):
                subject._bootstrap('a' * 32, case, hashes, 1, 10, 11, 12, profile)

    def test_journal_mode_cannot_run_through_core_entry_or_imported_module(self):
        with patch.object(subject, '__name__', subject._CORE_PROFILE.module_name), \
             patch.object(sys, 'argv', [str(subject._JOURNAL_PROFILE.entry), '--native']), \
             patch.object(subject, '_Native', side_effect=AssertionError('No native setup')) as native:
            with self.assertRaises(subject.FixtureError): subject.standalone_native_journal()
        native.assert_not_called()

    def test_native_profile_is_required_before_dispatch_and_has_no_public_setter(self):
        native = object.__new__(subject._Native); native._Native__origin = native
        native.calls, native.buffers, native.handles = [], [], []
        called = []
        with patch.object(subject, '_NATIVE_OWNERS', [native]):
            with self.assertRaises(subject.FixtureError): native.call('missing-profile', lambda: called.append(True))
        self.assertEqual(called, [])
        native._Native__profile = subject._CORE_PROFILE
        with self.assertRaises(AttributeError): native.profile = subject._JOURNAL_PROFILE

    def test_parent_oracle_refuses_cross_profile_case_without_rewriting_facts(self):
        value = parent('empty-stage')
        with self.assertRaises(subject.FixtureError):
            subject.validate_parent_observation(value, 'empty-stage', subject._JOURNAL_PROFILE)
        self.assertEqual(value, parent('empty-stage'))

    def test_timer_custody_and_one_shot_remaining_budget_use_only_self_exit(self):
        native = FakeNative()
        native.timer_started = native.timer_configured = False
        native.timer = native.callback = native.due = None
        events = []
        def create(callback, context, environment):
            self.assertIn(callback, native.buffers)
            self.assertIsNone(context); self.assertIsNone(environment)
            events.append('create'); return 17
        def setting(timer, due, period, window):
            self.assertEqual(timer, 17)
            self.assertIn(due._obj, native.buffers)
            self.assertLess(due._obj.value, 0)
            self.assertLessEqual(-due._obj.value, subject.BUDGET_NS // 100)
            self.assertEqual((period, window), (0, 0))
            events.append('arm')
        native.k.CreateThreadpoolTimer, native.k.SetThreadpoolTimer = create, setting
        native.k.IsThreadpoolTimerSet = lambda _timer: 1
        native.k.TerminateProcess = lambda target, code: events.append((target, code)) or 1
        with patch.object(C, 'WINFUNCTYPE', return_value=lambda callback: callback), patch.object(C, 'cast', side_effect=lambda value, _kind: value):
            subject._Native.arm_deadline(native)
        self.assertTrue(native.timer_configured)
        self.assertEqual(events, ['create', 'arm'])
        native.callback(None, None, None)
        self.assertEqual(events[-1], (-1, 2))
        self.assertTrue(native.expired and native.uncertain)
        self.assertIn(native.callback, native.buffers)
        self.assertIn(native.due, native.buffers)
        count = len(native.calls)
        with self.assertRaises(subject.FixtureError): subject._Native.arm_deadline(native)
        self.assertEqual(len(native.calls), count)

    def test_timer_create_or_unconfirmed_configuration_retains_callback_and_denies_admission(self):
        for phase in ('create', 'configuration'):
            native = FakeNative(); native.timer_started = native.timer_configured = False
            native.timer = native.callback = native.due = None
            native.k.CreateThreadpoolTimer = lambda *_args: 0 if phase == 'create' else 17
            native.k.SetThreadpoolTimer = lambda *_args: None
            native.k.IsThreadpoolTimerSet = lambda *_args: 0
            with self.subTest(phase=phase), patch.object(C, 'WINFUNCTYPE', return_value=lambda callback: callback), patch.object(C, 'cast', side_effect=lambda value, _kind: value):
                with self.assertRaises(subject.FixtureError): subject._Native.arm_deadline(native)
            self.assertTrue(native.uncertain and native.timer_started)
            self.assertFalse(native.timer_configured)
            self.assertIn(native.callback, native.buffers)
            self.assertIsNotNone(native.pending)

    def test_final_output_failure_always_exits_owned_native_process_without_retry(self):
        class End(BaseException): pass
        exits = []
        native = SimpleNamespace(calls=[], exit_self=lambda code: exits.append(code) or (_ for _ in ()).throw(End()))
        for failure in ('file', 'stdout', 'partial', 'encoding'):
            result = {'status': 'evidence-collected-review-required'}
            folder = None
            if failure == 'file':
                folder = SimpleNamespace(lstat=lambda: (_ for _ in ()).throw(OSError('synthetic-private-path')))
            if failure == 'encoding': result['synthetic'] = object()
            with self.subTest(failure=failure), patch.object(os, 'write', side_effect=OSError('synthetic-private-output') if failure == 'stdout' else lambda _fd, raw: len(raw) - (failure == 'partial')) as write, patch.object(subject, '_park', side_effect=End()) as park:
                with self.assertRaises(End): subject._finish_output(native, folder, None, result, time.monotonic_ns())
            self.assertEqual(exits[-1], 9)
            self.assertEqual(write.call_count, int(failure in ('stdout', 'partial')))
            park.assert_called_once_with(native)

    def test_no_native_constructor_result_returns_one_failed_outcome(self):
        output = []
        with patch.object(os, 'write', side_effect=lambda _fd, raw: output.append(raw) or len(raw)):
            self.assertEqual(subject._finish_output(None, None, None, {'status': 'failed'}, time.monotonic_ns()), 9)
        self.assertEqual(len(output), 1)
        self.assertEqual(json.loads(output[0])['status'], 'failed')

    def test_interrupted_exit_entry_parks_without_dispatch_unwind_or_termination_retry(self):
        class Parked(BaseException): pass
        for fault in (KeyboardInterrupt, MemoryError, subject.FixtureError):
            error = fault('synthetic-origin')
            native = SimpleNamespace(origin=lambda: (_ for _ in ()).throw(error), k=SimpleNamespace(TerminateProcess=lambda *_: self.fail('No unvalidated termination')))
            with self.subTest(fault=fault), patch.object(subject, '_park', side_effect=Parked()) as park:
                with self.assertRaises(Parked): subject._Native.exit_self(native, 9)
            park.assert_called_once_with(native=native)
        exits = []
        native = SimpleNamespace(calls=[], exit_self=lambda code: exits.append(code) or (_ for _ in ()).throw(KeyboardInterrupt()))
        with patch.object(os, 'write', side_effect=lambda _fd, raw: len(raw)), patch.object(subject, '_park', side_effect=Parked()) as park:
            with self.assertRaises(Parked): subject._finish_output(native, None, None, {'status': 'failed'}, time.monotonic_ns())
        self.assertEqual(exits, [9]); park.assert_called_once_with(native)

    def child_producer(self, case, configured):
        """Run the actual child branch with explicit synthetic controller ports.

        The fake exit sentinel is caught by its failure handler; no actual exit,
        timer or Core/file observation is supplied by this source test.
        """
        class End(BaseException): pass
        events, reports, exits = [], [], []
        native = SimpleNamespace(uncertain=False, timer_configured=False,
                                 deadline_ns=time.monotonic_ns()+subject.BUDGET_NS,
                                 k=SimpleNamespace(GetFileType=lambda *_: 1, SetEvent=lambda *_: 1),
                                 wait=lambda *_: True, close=lambda *_: None)
        def arm(): events.append('arm'); native.timer_configured = configured
        def exit_self(code): exits.append(code); raise End()
        def write(_native, _report, value):
            if reports: raise subject.FixtureError('synthetic-report-already-written')
            reports.append(json.loads(json.dumps(value)))
        def exercise(_native, actual_case, _hashes, _folder, value):
            events.append('core')
            facts = child(actual_case)
            for key in ('outcome','expected_refusal','core_created','core_cleanup_confirmed','core_handles_closed',
                        'core_uncertainty_retained','index_bytes','native_call_count','last_native_phase',
                        'last_native_return_code','last_os_error_code'):
                value[key] = facts[key]
        native.arm_deadline, native.exit_self = arm, exit_self
        native.call = lambda _stage, function, *args, **_kwargs: function(*args)
        hashes = {'synthetic.py':'a'*64}
        with patch.object(sys, 'flags', SimpleNamespace(isolated=1, no_site=1)), patch.object(sys, 'dont_write_bytecode', True), patch.object(sys, 'prefix', sys.base_prefix), patch.object(subject, '_Native', return_value=native), patch.object(subject, '_all_hashes', return_value=hashes), patch.object(subject, '_inherited', return_value=SimpleNamespace(value=1)), patch.object(subject, '_report_size', return_value=0), patch.object(subject, '_child_readback'), patch.object(subject, '_exercise_core', side_effect=exercise), patch.object(subject, '_write_report', side_effect=write):
            with self.assertRaises(End): subject._owned_child('a'*32, case, hashes, native.deadline_ns, 1, 2, 3)
        return events, reports, exits

    def test_actual_child_producer_reports_confirmed_timer_on_every_core_case(self):
        for case in subject.CORE_CASES:
            with self.subTest(case=case):
                events, reports, exits = self.child_producer(case, True)
                self.assertEqual(events, ['arm','core'])
                self.assertIs(reports[0]['timer_configured'], True)
                self.assertEqual(reports[0]['schema_version'], 'windows-offload-core-native-v2')
                self.assertEqual(reports[0]['failure_stage'], 'none')
                self.assertEqual(exits[0], 0)

    def test_child_unconfirmed_timer_stops_before_core_and_cannot_report_success(self):
        for configured in (False, None, 1):
            with self.subTest(configured=configured):
                events, reports, exits = self.child_producer('empty-stage', configured)
                self.assertEqual(events, ['arm'])
                self.assertIs(reports[0]['timer_configured'], False)
                self.assertEqual(reports[0]['failure_stage'], 'child-timer-unconfirmed')
                self.assertEqual(exits, [9])


class FixtureOracleTests(unittest.TestCase):
    def test_component_dispatch_error_types_and_failure_labels_are_mode_specific(self):
        class JournalError(Exception): pass
        class ReadError(Exception): pass
        journal = SimpleNamespace(JournalFixtureError=JournalError)
        read = SimpleNamespace(ReadBindingFixtureError=ReadError)
        with patch.object(subject, '_journal_fixture', return_value=journal) as j, \
             patch.object(subject, '_read_fixture', return_value=read) as r:
            self.assertIsNone(subject._component(subject._CORE_PROFILE, {}))
            j.assert_not_called(); r.assert_not_called()
            self.assertIs(subject._component(subject._JOURNAL_PROFILE, {}), journal)
            self.assertIs(subject._component(subject._READ_PROFILE, {}), read)
        for profile, component, own, wrong, label in (
                (subject._JOURNAL_PROFILE, journal, JournalError(), ReadError(), 'journal-operation'),
                (subject._READ_PROFILE, read, ReadError(), JournalError(), 'read-binding-operation')):
            self.assertTrue(subject._component_error(profile, component, own))
            self.assertFalse(subject._component_error(profile, component, wrong))
            self.assertEqual(subject._component_failure(profile), label)
        self.assertFalse(subject._component_error(subject._CORE_PROFILE, None, ReadError()))
        self.assertEqual(subject._component_failure(subject._CORE_PROFILE), 'core-operation')
        for profile in (copy.copy(subject._CORE_PROFILE), copy.copy(subject._JOURNAL_PROFILE),
                        copy.copy(subject._READ_PROFILE), None):
            with self.subTest(profile=profile), self.assertRaises(subject.FixtureError):
                subject._component(profile, {})

    def test_exact_case_facts_remain_distinct_from_native_qualification(self):
        for case in subject.CASES:
            value = child(case)
            self.assertEqual(subject.validate_child_report(value, case, 'a' * 64), value)
            self.assertEqual(subject.validate_parent_observation(parent(case), case), parent(case))
            self.assertFalse(value['model_started'] or value['production_composed'])

    def test_successful_exit_alone_or_unconfirmed_parent_observation_cannot_pass(self):
        for field, replacement in [('process_exit_observed', False), ('job_active_zero', False),
                                   ('membership_read_back', False), ('limits_read_back', False),
                                   ('dispatch_after_ready', False), ('parent_cleanup_confirmed', False),
                                   ('exit_code', 259), ('report_bytes', 8193), ('elapsed_ns', subject.BUDGET_NS + 1)]:
            value = parent('one-index'); value[field] = replacement
            with self.subTest(field=field), self.assertRaises(subject.FixtureError):
                subject.validate_parent_observation(value, 'one-index')

    def test_expected_refusal_requires_actual_collision_and_retained_uncertainty(self):
        for field, replacement in [('last_native_return_code', 0), ('last_native_phase', 'none'),
                                   ('core_uncertainty_retained', False), ('core_cleanup_confirmed', True),
                                   ('core_created', True), ('native_call_count', 0)]:
            value = child('namespace-denied'); value[field] = replacement
            with self.subTest(field=field), self.assertRaises(subject.FixtureError):
                subject.validate_child_report(value, 'namespace-denied', 'a' * 64)

    def test_timer_set_marker_is_not_native_exit_or_callback_delivery(self):
        value = child('deadline-control')
        subject.validate_child_report(value, 'deadline-control', 'a' * 64)
        observed = parent('deadline-control'); observed['exit_code'] = 0
        with self.assertRaises(subject.FixtureError): subject.validate_parent_observation(observed, 'deadline-control')
        observed['exit_code'] = 2; observed['process_exit_observed'] = False
        with self.assertRaises(subject.FixtureError): subject.validate_parent_observation(observed, 'deadline-control')

    def test_schema2_requires_actual_timer_configuration_for_every_successful_case(self):
        self.assertEqual(subject.SCHEMA, 'windows-offload-core-native-v2')
        for case in subject.CASES:
            for bad in (False, None, 0, 1):
                value = child(case); value['timer_configured'] = bad
                with self.subTest(case=case, bad=bad), self.assertRaises(subject.FixtureError):
                    subject.validate_child_report(value, case, 'a' * 64)
            value = child(case); value['schema_version'] = 'windows-offload-core-native-v1'
            with self.assertRaises(subject.FixtureError): subject.validate_child_report(value, case, 'a' * 64)

    def test_malformed_extra_bool_or_changed_source_does_not_enter_native_path(self):
        samples = []
        for field, replacement in [('source_digest', 'b' * 64), ('core_created', 1), ('native_call_count', True),
                                   ('last_native_phase', 'private-path'), ('elapsed_ns', 0), ('model_started', True)]:
            value = child('empty-stage'); value[field] = replacement; samples.append(value)
        value = child('empty-stage'); value['extra'] = True; samples.append(value)
        for value in samples:
            with self.assertRaises(subject.FixtureError): subject.validate_child_report(value, 'empty-stage', 'a' * 64)

    def test_strict_bounded_json_and_canonical_source_bindings(self):
        value = child('empty-stage')
        self.assertEqual(subject.decode_report(json.dumps(value).encode()), value)
        for raw in (b'', b'x' * 8193, b'{"x":1,"x":2}', b'{"x":NaN}', b'[]', b'\xff'):
            with self.assertRaises(subject.FixtureError): subject.decode_report(raw)
        self.assertEqual(subject.source_digest({'a.py': 'a' * 64, 'b.py': 'b' * 64}),
                         subject.source_digest({'b.py': 'b' * 64, 'a.py': 'a' * 64}))
        for value in ({'/private': 'a' * 64}, {'../private': 'a' * 64}, {'a.py': True}, {}):
            with self.assertRaises(subject.FixtureError): subject.source_digest(value)


if __name__ == '__main__': unittest.main()
