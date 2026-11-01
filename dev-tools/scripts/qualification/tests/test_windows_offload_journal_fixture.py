"""Synthetic ABI/producer/controller checks; no Windows or model evidence."""
import copy
import importlib.util
import json
import hashlib
from pathlib import Path
from pathlib import PureWindowsPath
from threading import get_ident
from types import SimpleNamespace
import unittest
import sys
from unittest.mock import Mock, patch

import test_windows_offload_core_fixture as existing
from modules.adapters.runtime.python.worker.tasks import windows_offload_journal as codec

engine = existing.subject
SCRIPT = Path(__file__).resolve().parents[1] / 'windows_offload_journal_fixture.py'
SPEC = importlib.util.spec_from_file_location('journal_fixture_subject', SCRIPT)
subject = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(subject)
HASHES = {engine.TOOL_FILES[1]: 'a' * 64}


def report(case):
    value = subject.base_report(case, engine.source_digest(HASHES), 0)
    value.update(elapsed_ns=100000, timer_configured=True)
    if case == 'deadline-control': value['outcome'] = 'armed'
    elif case in ('journal-roundtrip', 'journal-mutation-denied'):
        value.update(api_created=True, api_cleanup_confirmed=True, api_handles_closed=True,
                     guard_retirement_confirmed=True, history_intentionally_retained=True,
                     journal_frames=5, journal_data_bytes=2560, allocated_bytes=4096,
                     repeated_reads=8, peak_live_data_irps=1, native_call_count=200,
                     last_native_phase='CloseHandle', last_native_return_code=1, last_os_error_code=0)
        if case == 'journal-mutation-denied':
            value.update(probe_identity_readback=True, probe_handles_closed=True, probe_cleanup_confirmed=True,
                parent_delete_child_denied=True, resize_control_denied=True,
                probe_native_call_count=100, probe_last_label='parent-delete-child',
                probe_last_native_return_code=0xc0000022, resize_native_return_code=0, resize_os_error_code=5,
                probe_results=[{'label': row[0], 'native_status': 0xc0000022, 'output_absent': True}
                               for row in subject._PROBES])
    else:
        value.update(outcome='expected-denial', expected_refusal=True,
                     collision_parent_created=True, api_uncertainty_retained=True,
                     unretired_handle_records=5, native_call_count=40,
                     last_native_phase='NtCreateFile', last_native_return_code=0xc0000035,
                     last_os_error_code=0)
    return value


class SyntheticNative:
    """Explicit unit context only; class substitution never qualifies a Job."""
    def __init__(self):
        self.profile = engine._JOURNAL_PROFILE
        self.buffers = []; self.timer_configured = True; self.component_thread = get_ident()
        self.live = Mock()


class FixtureTests(unittest.TestCase):
    def context(self, *, failure=None):
        trace = []; native = SyntheticNative()
        def function(name, result):
            def invoke(*args): trace.append(name); return result
            invoke.__name__ = name
            return invoke
        class Api:
            def __new__(cls, owner):
                value = super().__new__(cls); owner._constructing_api = value
                return value
            def __init__(self, owner):
                self.owner = owner
                self.anchor = self.parent = self.namespace = self.file = None
                self._parent_witness = None
                self.data = b''
                self.n = SimpleNamespace(NtCreateFile=function('NtCreateFile',
                    0xc0000035 if failure == 'collision' else 0xc0000022 if failure == 'wrong-collision' else 0))
                if failure == 'constructor': raise KeyboardInterrupt()
            def handle(self):
                h = SimpleNamespace(closed=False); self.owner._handles.append(h); return h
            def call(self, name, result=1, valid=lambda v: type(v) is int and v != 0):
                return self.owner._native_call(function(name, result), (), valid, (self,))
            def prepare_base(self, cache):
                trace.append('base-path-walk'); return ((self.handle(), b'v' * 24),)
            def duplicate_anchor(self, handle, identity):
                self.call('DuplicateHandle'); self.anchor = self.handle(), identity
                if failure=='void-duplicate':return True
            def prepare(self):
                self.owner._native_call(self.n.NtCreateFile, (), lambda v: type(v) is int and v == 0, (self,))
                self.parent = self.handle(), b'o' * 24
                self.namespace = self.handle(), b'n' * 24
                self.file = self.handle(), b'f' * 24
                self.owner._guards.append({'retired': False})
                if failure=='void-prepare':return True
            def check(self, size):
                self.call('GetFileInformationByHandleEx')
                if failure == 'post-predicate': raise codec.OffloadAdmissionError()
                if len(self.data) != size: raise codec.OffloadAdmissionError()
                if failure=='void-check':return True
            def io(self, name, result=0):
                irp = object(); self.owner._irps.append(irp)
                self.call(name, result, lambda v: type(v) is int and v == 0)
                self.owner._irps.remove(irp)
            def write(self, raw, offset):
                self.io('NtWriteFile', -1 if failure == 'write' else 0)
                self.data = self.data[:offset] + raw
                if failure=='void-write':return True
            def flush(self):
                self.call('FlushFileBuffers', 0 if failure == 'flush' else 1)
                if failure=='void-flush':return True
            def read(self, size):
                self.io('NtReadFile'); return b'x' * size if failure == 'readback' else self.data[:size]
            def file_facts(self, handle): return self.file[1], len(self.data), 4096
            def retire(self):
                trace.append('retire')
                self.call('CloseHandle', 0 if failure == 'retire' else 1)
                for h in self.owner._handles: h.closed = True
                for g in self.owner._guards: g['retired'] = True
                if failure=='void-retire':return True
        journal = SimpleNamespace(_WindowsJournalApi=Api, _PARENT=codec._PARENT, _NAMESPACE=codec._NAMESPACE,
            _FrameData=codec._FrameData, _encode_frame=codec._encode_frame,
            _validate_prefix=codec._validate_prefix, PHASES=codec.PHASES,
            JOURNAL_CHARGE=codec.JOURNAL_CHARGE, OffloadAdmissionError=codec.OffloadAdmissionError)
        base = SimpleNamespace(_WindowsApi=SimpleNamespace(prepare=Api.prepare_base))
        patches = [patch.object(engine, '_Native', SyntheticNative),
                   patch.object(engine, '_child_readback'), patch.object(engine, '_all_hashes', return_value=HASHES),
                   patch.object(engine, '_private_core_package', return_value={'windows_offload_journal':journal, 'windows_offload_core':base}),
                   patch.object(engine, '_fresh_directory')]
        for guard in patches: guard.start(); self.addCleanup(guard.stop)
        return native, journal, trace

    def test_report_oracles_require_complete_separate_case_facts(self):
        for case in subject.CASES:
            value = report(case)
            self.assertEqual(subject.validate_child_report(value, case, engine.source_digest(HASHES)), value)
            for change in ({'timer_configured':False}, {'model_started':True}, {'shared_domain_qualified':True},
                           {'elapsed_ns':True}, {'native_call_count':True}, {'failure_stage':'journal-operation'},
                           {'last_os_error_code':-1}, {'extra':'private'}):
                with self.subTest(case=case,change=change), self.assertRaises(subject.JournalFixtureError):
                    subject.validate_child_report({**value,**change}, case, engine.source_digest(HASHES))

    def test_roundtrip_cannot_substitute_parent_exit_or_history_deletion_for_api_retirement(self):
        for field in ('api_cleanup_confirmed','api_handles_closed','guard_retirement_confirmed',
                      'history_intentionally_retained'):
            value=report('journal-roundtrip');value[field]=False
            with self.subTest(field=field),self.assertRaises(subject.JournalFixtureError):
                subject.validate_child_report(value,'journal-roundtrip',engine.source_digest(HASHES))
        for field,bad in (('journal_frames',4),('journal_data_bytes',2048),('repeated_reads',7),
                          ('peak_live_data_irps',2),('live_data_irps_after',1),('unretired_handle_records',1),
                          ('allocated_bytes',131072)):
            value=report('journal-roundtrip');value[field]=bad
            with self.subTest(field=field),self.assertRaises(subject.JournalFixtureError):
                subject.validate_child_report(value,'journal-roundtrip',engine.source_digest(HASHES))

    def test_core_schema_and_wrong_collision_cannot_qualify_journal(self):
        with self.assertRaises(subject.JournalFixtureError):
            subject.validate_child_report(existing.child('empty-stage'),'journal-roundtrip','a'*64)
        value=report('journal-parent-denied');value['last_native_return_code']=0xc0000022
        with self.assertRaises(subject.JournalFixtureError):
            subject.validate_child_report(value,'journal-parent-denied',engine.source_digest(HASHES))
        value=report('journal-parent-denied');value['api_cleanup_confirmed']=True
        with self.assertRaises(subject.JournalFixtureError):
            subject.validate_child_report(value,'journal-parent-denied',engine.source_digest(HASHES))

    def test_failure_diagnostics_never_echo_unknown_fields_or_private_stages(self):
        value=report('journal-roundtrip');value.update(failure_stage='synthetic-private-detail',
            last_native_phase='synthetic-private-detail',last_os_error_code='private',extra='private')
        result=subject.failure_diagnostics(value)
        self.assertNotIn('private',json.dumps(result))
        self.assertNotIn('component_failure_stage',result)
        self.assertEqual(subject.JournalFixtureError('private').stage,'journal-operation')

    def test_actual_fixture_producer_orders_five_frames_and_eight_reads_with_no_domain(self):
        native,journal,trace=self.context()
        value=subject.base_report('journal-roundtrip',engine.source_digest(HASHES),0)
        value.update(timer_configured=True,elapsed_ns=100000)
        subject.exercise(engine,native,'journal-roundtrip',HASHES,engine._JOURNAL_PROFILE.runs/'synthetic',value)
        self.assertEqual(value['journal_frames'],5);self.assertEqual(value['repeated_reads'],8)
        self.assertEqual(trace.count('NtWriteFile'),5);self.assertEqual(trace.count('FlushFileBuffers'),5)
        self.assertEqual(trace.count('NtReadFile'),13)
        self.assertLess(trace.index('base-path-walk'),trace.index('DuplicateHandle'))
        self.assertLess(trace.index('DuplicateHandle'),trace.index('NtCreateFile'))
        owner=next(x for x in native.buffers if type(x) is subject._ApiOwner)
        self.assertFalse(owner._uncertain);self.assertEqual(owner._irps,[])
        self.assertIsNone(owner._retiring_io);self.assertTrue(all(h.closed for h in owner._handles))
        subject.validate_child_report(value,'journal-roundtrip',engine.source_digest(HASHES))
        self.assertFalse(value['shared_domain_qualified'])

    def test_write_flush_readback_post_predicate_and_retire_failures_keep_exact_owner(self):
        for failure in ('write','flush','readback','post-predicate','retire',
                        'void-duplicate','void-prepare','void-check','void-write','void-flush','void-retire'):
            with self.subTest(failure=failure):
                native,journal,trace=self.context(failure=failure)
                value=subject.base_report('journal-roundtrip',engine.source_digest(HASHES),0)
                with self.assertRaises((subject.JournalFixtureError,codec.OffloadAdmissionError)):
                    subject.exercise(engine,native,'journal-roundtrip',HASHES,engine._JOURNAL_PROFILE.runs/'synthetic',value)
                owner=next(x for x in native.buffers if type(x) is subject._ApiOwner)
                self.assertTrue(owner._uncertain);self.assertFalse(value['api_cleanup_confirmed'])
                before=list(trace)
                with self.assertRaises(subject.JournalFixtureError):owner.run(lambda:owner._api.retire())
                self.assertEqual(trace,before)
                if failure not in ('retire','void-retire'):self.assertNotIn('retire',trace)
                if failure in ('write','flush','retire'):self.assertIsNotNone(owner._pending)
                self.assertTrue(self.doCleanups())

    def test_collision_accepts_only_exact_return_and_retains_without_retirement(self):
        native,journal,trace=self.context(failure='collision')
        value=subject.base_report('journal-parent-denied',engine.source_digest(HASHES),0)
        value.update(timer_configured=True,elapsed_ns=100000)
        subject.exercise(engine,native,'journal-parent-denied',HASHES,engine._JOURNAL_PROFILE.runs/'synthetic',value)
        owner=next(x for x in native.buffers if type(x) is subject._ApiOwner)
        self.assertTrue(owner._uncertain);self.assertIs(owner._pending['function'],owner._api.n.NtCreateFile)
        self.assertNotIn('retire',trace)
        subject.validate_child_report(value,'journal-parent-denied',engine.source_digest(HASHES))

    def test_constructor_interruption_pins_partial_api_before_return(self):
        native,journal,trace=self.context(failure='constructor')
        with self.assertRaises(KeyboardInterrupt):subject._ApiOwner(engine,native,journal,HASHES,{})
        owner=next(x for x in native.buffers if type(x) is subject._ApiOwner)
        self.assertTrue(owner._uncertain);self.assertIsNone(owner._api)
        self.assertIsNotNone(owner._constructing_api)

    def test_exercise_constructor_failure_reports_its_retained_uncertainty(self):
        native,journal,trace=self.context(failure='constructor')
        value=subject.base_report('journal-roundtrip',engine.source_digest(HASHES),0)
        with self.assertRaises(KeyboardInterrupt):
            subject.exercise(engine,native,'journal-roundtrip',HASHES,engine._JOURNAL_PROFILE.runs/'synthetic',value)
        self.assertTrue(value['api_uncertainty_retained'])
        self.assertFalse(value['api_cleanup_confirmed'])
        self.assertNotIn('retire',trace)

    def test_pre_acquisition_constructor_interruption_is_not_masked_by_missing_fields(self):
        native,journal,trace=self.context()
        value=subject.base_report('journal-roundtrip',engine.source_digest(HASHES),0)
        def setting(owner,name,value):
            if name=='engine':raise KeyboardInterrupt()
            object.__setattr__(owner,name,value)
        with patch.object(subject._ApiOwner,'__setattr__',setting),self.assertRaises(KeyboardInterrupt):
            subject.exercise(engine,native,'journal-roundtrip',HASHES,engine._JOURNAL_PROFILE.runs/'synthetic',value)
        self.assertFalse(value['api_uncertainty_retained']);self.assertEqual(native.buffers,[])

    def test_copied_wrong_thread_and_swallowed_reentry_cannot_dispatch(self):
        native,journal,trace=self.context();owner=subject._ApiOwner(engine,native,journal,HASHES,{})
        clone=copy.copy(owner)
        with self.assertRaises(subject.JournalFixtureError):clone.run(lambda:trace.append('copy'))
        with patch.object(subject,'get_ident',return_value=owner.thread+1):
            with self.assertRaises(subject.JournalFixtureError):owner.run(lambda:trace.append('thread'))
        self.assertFalse(owner._uncertain);self.assertEqual(trace,[])
        def suppressed():
            try:owner.run(lambda:None)
            except subject.JournalFixtureError:pass
        with self.assertRaises(subject.JournalFixtureError):owner.run(suppressed)
        self.assertTrue(owner._uncertain);self.assertIsNotNone(owner._dispatch)

    def test_source_drift_after_operation_prevents_acknowledgement(self):
        native,journal,trace=self.context();owner=subject._ApiOwner(engine,native,journal,HASHES,{})
        with patch.object(engine,'_all_hashes',side_effect=[HASHES,{'changed':'b'*64}]):
            with self.assertRaises(subject.JournalFixtureError):owner.run(lambda:trace.append('effect'))
        self.assertEqual(trace,['effect']);self.assertTrue(owner._uncertain)
        self.assertFalse(owner._dispatch['finished'])

    def test_wrong_profile_or_missing_actual_timer_denies_before_api_constructor(self):
        native,journal,trace=self.context();native.timer_configured=False
        with self.assertRaises(subject.JournalFixtureError):subject._ApiOwner(engine,native,journal,HASHES,{})
        self.assertEqual(native.buffers,[])

    def test_call_ceiling_stops_effects_and_cannot_be_reset_by_another_operation(self):
        native,journal,trace=self.context()
        value=subject.base_report('journal-roundtrip',engine.source_digest(HASHES),0)
        owner=subject._ApiOwner(engine,native,journal,HASHES,value)
        effect=Mock(return_value=0);effect.__name__='NtWriteFile'
        def calls(count):
            for _ in range(count):owner._native_call(effect,(),lambda v:type(v) is int and v==0,())
        owner.run(lambda:calls(subject.MAX_CALLS//2))
        owner.run(lambda:calls(subject.MAX_CALLS//2))
        with self.assertRaises(subject.JournalFixtureError):owner.run(lambda:calls(1))
        self.assertEqual(effect.call_count,subject.MAX_CALLS)
        with self.assertRaises(subject.JournalFixtureError):owner.run(lambda:calls(1))
        self.assertEqual(effect.call_count,subject.MAX_CALLS)
        self.assertTrue(owner._uncertain)

    def test_copied_real_controller_is_refused_before_original_buffers_change(self):
        native=object.__new__(engine._Native)
        native._Native__origin=native;native._Native__profile=engine._JOURNAL_PROFILE
        native._Native__component_thread=get_ident()
        native.buffers=[];native.timer_configured=True
        native.uncertain=native.expired=False
        native.deadline_ns=engine.time.monotonic_ns()+engine.BUDGET_NS
        with patch.object(engine,'_NATIVE_OWNERS',[native]):
            clone=copy.copy(native)
            with self.assertRaises(engine.FixtureError):
                subject._ApiOwner(engine,clone,SimpleNamespace(),HASHES,{})
        self.assertEqual(native.buffers,[])

    def test_source_closure_includes_new_entry_fixture_and_all_journal_dependencies(self):
        actual=hashlib.sha256(Path(engine.__file__).read_bytes()).hexdigest()
        with patch.object(engine,'_LOADED_SOURCE_SHA256',actual,create=True):
            core=engine._repo_hashes();journal=engine._repo_hashes(engine._JOURNAL_PROFILE)
        self.assertEqual(set(core),set(engine.TASK_FILES+engine.TOOL_FILES))
        self.assertEqual(set(journal),set(engine._JOURNAL_PROFILE.task_files+engine._JOURNAL_PROFILE.tool_files))
        self.assertIn('modules/adapters/runtime/python/worker/tasks/windows_offload_journal.py',journal)
        self.assertIn('modules/adapters/runtime/python/worker/tasks/windows_offload_backend.py',journal)
        self.assertIn('dev-tools/scripts/qualification/qualify_windows_offload_journal.py',journal)
        self.assertIn('dev-tools/scripts/qualification/windows_offload_journal_fixture.py',journal)
        self.assertNotIn(engine.TOOL_FILES[0],journal)

    def controller(self, *, bad_roundtrip=False):
        native=existing.FakeNative();native.profile=engine._JOURNAL_PROFILE
        def directory(path, profile):
            self.assertIs(profile,engine._JOURNAL_PROFILE)
            native.dispatched=native.exited=False;native.current_case=path.name
            value=report(path.name)
            if bad_roundtrip and path.name=='journal-roundtrip':
                value.update(failure_stage='journal-native-result',api_uncertainty_retained=True,extra='private')
            native.raw=json.dumps(value).encode()
            return (1,2)
        def exit_code(handle, slot):
            slot._obj.value=2 if native.current_case=='deadline-control' else 0
            return 1
        native.k.GetExitCodeProcess=exit_code
        return native,directory

    def test_real_collector_and_sessions_admit_four_separate_journal_cases_with_synthetic_abi(self):
        native,directory=self.controller();rows=[]
        with patch.object(engine,'_journal_fixture',return_value=subject), \
             patch.object(engine,'_fresh_directory',side_effect=directory):
            result=engine._collect(native,'a'*32,HASHES,engine._JOURNAL_PROFILE.runs/('a'*32),rows)
        self.assertTrue(result);self.assertEqual([r['case'] for r in rows],list(subject.CASES))
        self.assertTrue(all(r['accepted'] and r['parent']['parent_cleanup_confirmed'] for r in rows))
        self.assertEqual(rows[0]['parent']['exit_code'],2)
        self.assertFalse(rows[2]['child']['api_cleanup_confirmed'])
        self.assertTrue(rows[3]['child']['api_cleanup_confirmed'])
        self.assertTrue(rows[-1]['parent']['process_exit_observed'])

    def test_journal_oracle_failure_stops_collection_and_publishes_only_safe_diagnostics(self):
        native,directory=self.controller(bad_roundtrip=True);rows=[]
        with patch.object(engine,'_journal_fixture',return_value=subject), \
             patch.object(engine,'_fresh_directory',side_effect=directory):
            result=engine._collect(native,'a'*32,HASHES,engine._JOURNAL_PROFILE.runs/('a'*32),rows)
        self.assertFalse(result);self.assertEqual(len(rows),2)
        self.assertFalse(rows[-1]['accepted']);self.assertNotIn('child',rows[-1])
        self.assertEqual(rows[-1]['diagnostics']['component_failure_stage'],'journal-native-result')
        self.assertNotIn('private',json.dumps(rows))


    def test_closed_journal_native_owner_accepts_descriptor_calls_and_denies_unknown_before_dispatch(self):
        for phase in ('GetSecurityDescriptorLength', 'SetSecurityDescriptorOwner'):
            with self.subTest(phase=phase):
                native, journal, trace = self.context()
                value = subject.base_report('journal-roundtrip', engine.source_digest(HASHES), 0)
                owner = subject._ApiOwner(engine, native, journal, HASHES, value)
                effect = Mock(return_value=64 if phase.endswith('Length') else 1); effect.__name__ = phase
                with patch.object(subject.C, 'get_last_error', return_value=0, create=True):
                    result = owner.run(lambda: owner._native_call(effect, (), lambda v: type(v) is int and v > 0, (effect,)))
                self.assertGreater(result, 0); effect.assert_called_once()
                self.assertEqual(value['last_native_phase'], phase)
                self.assertEqual(value['native_call_count'], 1); self.assertTrue(owner._calls[0]['acknowledged'])
                unknown = Mock(return_value=1); unknown.__name__ = phase + 'Unexpected'
                with self.assertRaises(subject.JournalFixtureError):
                    owner.run(lambda: owner._native_call(unknown, (), lambda v: True, (unknown,)))
                unknown.assert_not_called(); self.assertTrue(owner._uncertain)
                self.assertEqual(value['native_call_count'], 1); self.assertEqual(len(owner._calls), 1)

    def test_new_descriptor_failure_diagnostics_cannot_qualify_journal_cleanup(self):
        for phase in ('GetSecurityDescriptorLength', 'SetSecurityDescriptorOwner'):
            with self.subTest(phase=phase):
                value = report('journal-roundtrip'); value['last_native_phase'] = phase
                self.assertEqual(subject.failure_diagnostics(value)['last_native_phase'], phase)
                with self.assertRaises(subject.JournalFixtureError):
                    subject.validate_child_report(value, 'journal-roundtrip', 'a' * 64)
        self.assertNotIn('last_native_phase', subject.failure_diagnostics({'last_native_phase': 'unknown-private-label'}))


    def test_mutation_report_uses_new_schema_and_distinct_probe_custody_fields(self):
        self.assertEqual(subject.SCHEMA, 'windows-offload-journal-native-v3')
        self.assertEqual(subject.CASES, ('deadline-control', 'journal-roundtrip', 'journal-parent-denied', 'journal-mutation-denied'))
        value = subject.base_report('journal-mutation-denied', engine.source_digest(HASHES), 0)
        self.assertEqual(value['probe_results'], [])
        self.assertEqual(value['probe_native_call_count'], 0)
        self.assertEqual(value['probe_unretired_handle_records'], 0)
        self.assertEqual(value['probe_last_label'], 'none')
        self.assertIsNone(value['probe_last_native_return_code'])
        for key in ('probe_identity_readback', 'probe_handles_closed', 'probe_cleanup_confirmed',
                    'probe_uncertainty_retained', 'parent_delete_child_denied', 'resize_control_denied'):
            self.assertIs(value[key], False)

    def test_unknown_probe_labels_and_statuses_never_enter_public_failure_diagnostics(self):
        value = {'probe_last_label': 'synthetic-private-name', 'probe_last_native_return_code': True,
                 'probe_native_call_count': 4097, 'probe_uncertainty_retained': 'yes'}
        result = subject.failure_diagnostics(value)
        self.assertNotIn('probe_last_label', result)
        self.assertNotIn('probe_last_native_return_code', result)
        self.assertNotIn('probe_native_call_count', result)
        self.assertNotIn('probe_uncertainty_retained', result)
        self.assertNotIn('synthetic-private', json.dumps(result))

    def test_mutation_oracle_refuses_missing_reordered_shared_granted_and_uncertain_evidence(self):
        value = report('journal-mutation-denied')
        changes = [
            {'schema_version': 'windows-offload-journal-native-v1'},
            {'probe_results': value['probe_results'][:-1]},
            {'probe_results': list(reversed(value['probe_results']))},
            {'probe_native_call_count': 4097}, {'probe_native_call_count': True},
            {'probe_unretired_handle_records': 1}, {'probe_last_native_return_code': True},
            {'probe_last_label': 'file-delete'}, {'resize_native_return_code': True},
            {'resize_os_error_code': 32}, {'resize_os_error_code': True},
        ]
        for name in subject._PROBE_FLAGS: changes.append({name: name == 'probe_uncertainty_retained'})
        for status in (0, 0xc0000043, 0xc0000034, True, None):
            rows = copy.deepcopy(value['probe_results']); rows[0]['native_status'] = status
            changes.append({'probe_results': rows})
        for field, item in (('output_absent', False), ('output_absent', 1), ('extra', 'private'),
                            ('label', 'unknown-private')):
            rows = copy.deepcopy(value['probe_results']); rows[0][field] = item
            changes.append({'probe_results': rows})
        for change in changes:
            with self.subTest(change=change), self.assertRaises(subject.JournalFixtureError):
                subject.validate_child_report({**value, **change}, 'journal-mutation-denied', engine.source_digest(HASHES))
        for case in subject.CASES[:-1]:
            with self.subTest(case=case), self.assertRaises(subject.JournalFixtureError):
                subject.validate_child_report({**report(case), 'probe_native_call_count': 1}, case, engine.source_digest(HASHES))

    def denial_context(self, *, status=0xc0000022, output=None, error=0):
        native, journal, trace = self.context()
        value = subject.base_report('journal-mutation-denied', engine.source_digest(HASHES), 0)
        owner = subject._ApiOwner(engine, native, journal, HASHES, value)
        api = owner._api
        api.call = lambda function, *args, valid, keep: owner._native_call(function, args, valid, keep)
        api.namespace = (SimpleNamespace(value=111), b'n' * 24, None)
        api.file = (SimpleNamespace(value=112), b'f' * 24, None)
        api.parent = (SimpleNamespace(value=115), b'o' * 24, None)
        chain = ((SimpleNamespace(value=113), b'p' * 24), (SimpleNamespace(value=114), b'v' * 24))
        calls = []
        def create(slot, access, attributes, io, allocation, flags, share, disposition, options, ea, size):
            self.assertIs(owner._probe_attempts[-1][2], slot._obj)
            self.assertIs(owner._pending['keep'], owner._probe_attempts[-1])
            self.assertTrue(owner._pending['started']); self.assertFalse(owner._pending['returned'])
            slot._obj.value = output
            calls.append((access, share, disposition, options, attributes._obj.root))
            return status
        create.__name__ = 'NtCreateFile'; api.n.NtCreateFile = create
        self.enterContext(patch.object(subject.C, 'get_last_error', return_value=error, create=True))
        return owner, api, chain, calls, value

    def test_fixed_matrix_dispatches_one_right_per_target_with_share7_and_preheld_outputs(self):
        owner, api, chain, calls, value = self.denial_context()
        for definition in subject._PROBES:
            owner.run(lambda: subject._deny_open(api, codec.w, codec, definition, chain))
        self.assertEqual(len(calls), 14)
        self.assertEqual([call[0] for call in calls], [row[2] for row in subject._PROBES])
        self.assertEqual([call[1] for call in calls], [7] * 14)
        self.assertEqual([call[2] for call in calls], [1] * 11 + [2, 2, 1])
        self.assertEqual(calls[-1][-1], chain[-1][0].value)
        self.assertEqual(calls[8][-1], api.parent[0].value)
        self.assertTrue(value['parent_delete_child_denied'])
        self.assertEqual(len(owner._probe_attempts), 14); self.assertFalse(owner._uncertain)
        self.assertEqual(value['probe_results'], report('journal-mutation-denied')['probe_results'])
        self.assertEqual(owner._handles, [])  # Denied null slots are not open handles to close.

    def test_sharing_missing_object_grant_and_unexpected_output_retain_custody_and_stop(self):
        for status, output in ((0xc0000043, None), (0xc0000034, None), (0, 701), (0xc0000022, 701)):
            with self.subTest(status=status, output=output):
                owner, api, chain, calls, value = self.denial_context(status=status, output=output)
                with self.assertRaises(subject.JournalFixtureError):
                    owner.run(lambda: subject._deny_open(api, codec.w, codec, subject._PROBES[0], chain))
                self.assertEqual(len(calls), 1); self.assertTrue(owner._uncertain)
                self.assertEqual(owner._probe_attempts[0][2].value, output)
                self.assertEqual(value['probe_last_label'], 'file-write-data')
                self.assertEqual(value['probe_last_native_return_code'], status)
                with self.assertRaises(subject.JournalFixtureError):
                    owner.run(lambda: subject._deny_open(api, codec.w, codec, subject._PROBES[1], chain))
                self.assertEqual(len(calls), 1)
                self.assertTrue(self.doCleanups())

    def test_matrix_copy_cannot_add_caller_names_or_combined_rights(self):
        owner, api, chain, calls, value = self.denial_context()
        copied = tuple(list(subject._PROBES[0]))
        with self.assertRaises(subject.JournalFixtureError):
            owner.run(lambda: subject._deny_open(api, codec.w, codec, copied, chain))
        self.assertEqual(calls, []); self.assertEqual(owner._probe_attempts, [])

    def test_resize_is_separate_handle_right_control_and_requires_exact_win32_denial(self):
        for result, error, accepted in ((0, 5, True), (1, 0, False), (-1, 0, False),
                                        (0, 32, False), (0, 0, False)):
            with self.subTest(result=result, error=error):
                owner, api, chain, calls, value = self.denial_context(error=error)
                resize = Mock(return_value=result); resize.__name__ = 'SetFileInformationByHandle'
                api.k = SimpleNamespace(SetFileInformationByHandle=resize)
                with patch.object(subject.C, 'set_last_error', create=True):
                    if accepted: owner.run(lambda: subject._resize_control(api))
                    else:
                        with self.assertRaises(subject.JournalFixtureError):
                            owner.run(lambda: subject._resize_control(api))
                self.assertEqual(value['probe_last_label'], 'resize-handle-control')
                self.assertEqual(value['resize_native_return_code'], result & 0xffffffff)
                self.assertEqual(value['resize_os_error_code'], error)
                self.assertEqual(subject.failure_diagnostics(value)['resize_native_return_code'], result & 0xffffffff)
                self.assertEqual(subject.failure_diagnostics(value)['resize_os_error_code'], error)
                self.assertIs(value['resize_control_denied'], accepted)
                self.assertFalse(value['parent_delete_child_denied']); self.assertEqual(value['probe_results'], [])
                self.assertEqual(resize.call_args.args[1], 6)
                self.assertTrue(self.doCleanups())

    def test_mutation_probe_starts_only_after_original_writer_and_guards_are_retired(self):
        native, journal, trace = self.context()
        journal._WindowsJournalApi.security = lambda api, handle: (b'fixed-acl', 0x1004, b'fixed-owner')
        value = subject.base_report('journal-mutation-denied', engine.source_digest(HASHES), 0)
        def probe(engine_arg, native_arg, j, w, hashes, cache, original, history, report_arg):
            original_owner = next(x for x in native.buffers if type(x) is subject._ApiOwner)
            self.assertTrue(all(h.closed for h in original_owner._handles))
            self.assertTrue(all(g['retired'] for g in original_owner._guards))
            self.assertTrue(report_arg['api_cleanup_confirmed'])
            self.assertEqual(original[0], (b'v' * 24,)); self.assertEqual(len(history), 2560)
            self.assertEqual(original[5], (b'f' * 24, 2560, 4096))
            self.assertEqual(report_arg['probe_native_call_count'], 0)
        with patch.object(subject, '_mutation_checks', side_effect=probe) as check:
            subject.exercise(engine, native, 'journal-mutation-denied', HASHES,
                             engine._JOURNAL_PROFILE.runs / 'synthetic', value)
        check.assert_called_once(); self.assertTrue(value['api_handles_closed'])

    def probe_producer_context(self, failure=None):
        native, journal, trace = self.context()
        journal._FILE = codec._FILE
        api_class = journal._WindowsJournalApi
        original_init = api_class.__init__
        identities = {'\\??\\C:\\': b'r' * 24, 'fixture': b'p' * 24, 'cache': b'v' * 24,
                      codec._PARENT: b'o' * 24,
                      codec._NAMESPACE: b'n' * 24, codec._FILE: b'f' * 24}
        acl = (b'fixed-acl', 0x1004, b'fixed-owner'); history = b'f' * 2560
        def function(name, callback):
            callback.__name__ = name
            return callback
        def initialize(api, owner):
            original_init(api, owner)
            def create(slot, *args):
                self.assertIs(slot._obj, owner._probe_attempts[-1][2])
                if failure == 'parent-grant' and owner.report['probe_last_label'] == 'parent-delete-child':
                    slot._obj.value = 777
                    return 0
                return 0xc0000022
            def volume(handle, a, b, c, d, flags, filesystem, size):
                flags._obj.value = 8; filesystem.value = 'NTFS'; return 1
            api.k = SimpleNamespace(GetDriveTypeW=function('GetDriveTypeW', lambda root: 3),
                GetVolumeInformationByHandleW=function('GetVolumeInformationByHandleW', volume),
                SetFileInformationByHandle=function('SetFileInformationByHandle', lambda *args: 0),
                CloseHandle=function('CloseHandle', lambda *args: 0 if failure == 'close' else 1))
            api.n.NtCreateFile = function('NtCreateFile', create)
        def call(api, function, *args, valid=lambda value: type(value) is int and value != 0, keep=()):
            return api.owner._native_call(function, args, valid, keep)
        def open_read(api, parent, name, access, *, directory=True, share=3):
            self.assertEqual(share, 7); self.assertIn(access, (0x200a0, 0x200a1, 0x20081))
            handle = SimpleNamespace(closed=False, value=len(api.owner._handles) + 500, name=name)
            api.owner._handles.append(handle)
            trace.append('open-read:' + name)
            return handle
        def security(api, handle):
            trace.append('security:' + handle.name)
            return (*acl[:2], b'wrong-owner') if failure == 'security' else acl
        def read(api, size):
            trace.append('readback')
            return b'x' * size if failure == 'readback' else history[:size]
        def retire(api):
            trace.append('probe-retire')
            for handle in reversed(api.owner._handles):
                api.call(api.k.CloseHandle, handle.value, keep=(handle,))
                handle.closed = True
        replacements = {'__init__': initialize, 'call': call, 'open': open_read,
            'identity': lambda api, handle: b'x' * 24 if failure == 'identity'
                or failure == 'parent-identity' and handle.name == codec._PARENT else identities[handle.name],
            'security': security, 'read': read, 'file_facts': lambda api, handle: (b'f' * 24, 2560, 4096),
            'retire': retire}
        for name, replacement in replacements.items():
            self.enterContext(patch.object(api_class, name, replacement, create=True))
        self.enterContext(patch.object(subject.C, 'get_last_error', return_value=5, create=True))
        self.enterContext(patch.object(subject.C, 'set_last_error', create=True))
        original = ((b'r' * 24, b'p' * 24, b'v' * 24), b'n' * 24, acl, b'f' * 24, acl,
                    (b'f' * 24, 2560, 4096), b'o' * 24, acl)
        value = report('journal-roundtrip'); value['case'] = 'journal-mutation-denied'
        return native, journal, original, history, value, trace

    def test_real_probe_producer_requires_two_positive_readbacks_and_distinct_closed_custody(self):
        native, journal, original, history, value, trace = self.probe_producer_context()
        original_count = value['native_call_count']
        subject._mutation_checks(engine, native, journal, codec.w, HASHES,
                                 PureWindowsPath('C:/fixture/cache'), original, history, value)
        subject.validate_child_report(value, 'journal-mutation-denied', engine.source_digest(HASHES))
        self.assertEqual(trace.count('readback'), 2); self.assertEqual(value['native_call_count'], original_count)
        self.assertTrue(value['probe_cleanup_confirmed']); self.assertFalse(value['probe_uncertainty_retained'])
        owner = next(item for item in native.buffers if type(item) is subject._ApiOwner)
        self.assertIsNot(owner.report, value); self.assertEqual(len(owner._probe_attempts), 14)
        self.assertTrue(all(h.closed for h in owner._handles)); self.assertEqual(len(owner._calls), value['probe_native_call_count'])
        self.assertLess(trace.index('readback'), trace.index('probe-retire'))

    def test_probe_identity_security_readback_and_close_failures_preserve_original_retirement(self):
        for failure in ('identity', 'security', 'readback', 'close'):
            with self.subTest(failure=failure):
                native, journal, original, history, value, trace = self.probe_producer_context(failure)
                with self.assertRaises(subject.JournalFixtureError):
                    subject._mutation_checks(engine, native, journal, codec.w, HASHES,
                        PureWindowsPath('C:/fixture/cache'), original, history, value)
                self.assertTrue(value['api_cleanup_confirmed']); self.assertFalse(value['api_uncertainty_retained'])
                self.assertTrue(value['probe_uncertainty_retained']); self.assertFalse(value['probe_cleanup_confirmed'])
                self.assertGreater(value['probe_unretired_handle_records'], 0)
                if failure != 'close':
                    self.assertEqual(value['probe_results'], []); self.assertNotIn('probe-retire', trace)
                else: self.assertEqual(len(value['probe_results']), 14)
                self.assertTrue(self.doCleanups())

    def test_parent_grant_is_last_and_reports_its_retained_output_without_cleanup(self):
        native, journal, original, history, value, trace = self.probe_producer_context('parent-grant')
        with self.assertRaises(subject.JournalFixtureError):
            subject._mutation_checks(engine, native, journal, codec.w, HASHES,
                PureWindowsPath('C:/fixture/cache'), original, history, value)
        owner = next(item for item in native.buffers if type(item) is subject._ApiOwner)
        self.assertTrue(value['resize_control_denied']); self.assertEqual(value['resize_os_error_code'], 5)
        self.assertEqual(len(value['probe_results']), 14)
        self.assertEqual(value['probe_last_label'], 'parent-delete-child')
        self.assertEqual(value['probe_last_native_return_code'], 0)
        self.assertFalse(value['probe_results'][-1]['output_absent'])
        self.assertEqual(owner._probe_attempts[-1][2].value, 777)
        self.assertEqual(value['probe_unretired_handle_records'], len(owner._handles) + 1)
        self.assertTrue(value['probe_uncertainty_retained']); self.assertFalse(value['probe_cleanup_confirmed'])
        self.assertNotIn('probe-retire', trace); self.assertEqual(trace.count('readback'), 1)
        diagnostics = subject.failure_diagnostics(value)
        self.assertEqual(diagnostics['probe_unretired_handle_records'], len(owner._handles) + 1)
        self.assertEqual(diagnostics['resize_os_error_code'], 5)
        with self.assertRaises(subject.JournalFixtureError):
            owner.run(lambda: owner._api.retire())
        self.assertNotIn('probe-retire', trace)

    def test_new_private_parent_identity_is_required_before_any_mutation_probe(self):
        native, journal, original, history, value, trace = self.probe_producer_context('parent-identity')
        with self.assertRaises(subject.JournalFixtureError):
            subject._mutation_checks(engine, native, journal, codec.w, HASHES,
                PureWindowsPath('C:/fixture/cache'), original, history, value)
        self.assertEqual(value['probe_results'], []); self.assertFalse(value['probe_identity_readback'])
        self.assertTrue(value['probe_uncertainty_retained']); self.assertNotIn('probe-retire', trace)

    def test_schema1_and_schema2_reports_remain_history_not_current_parent_proof(self):
        for version in ('windows-offload-journal-native-v1', 'windows-offload-journal-native-v2'):
            value = report('journal-roundtrip'); value['schema_version'] = version
            with self.subTest(version=version), self.assertRaises(subject.JournalFixtureError):
                subject.validate_child_report(value, 'journal-roundtrip', engine.source_digest(HASHES))


if __name__=='__main__':unittest.main()
