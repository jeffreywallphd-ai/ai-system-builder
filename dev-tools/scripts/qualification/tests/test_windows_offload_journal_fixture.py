"""Synthetic ABI/producer/controller checks; no Windows or model evidence."""
import copy
import importlib.util
import json
import hashlib
from pathlib import Path
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
    elif case == 'journal-roundtrip':
        value.update(api_created=True, api_cleanup_confirmed=True, api_handles_closed=True,
                     guard_retirement_confirmed=True, history_intentionally_retained=True,
                     journal_frames=5, journal_data_bytes=2560, allocated_bytes=4096,
                     repeated_reads=8, peak_live_data_irps=1, native_call_count=200,
                     last_native_phase='CloseHandle', last_native_return_code=1, last_os_error_code=0)
    else:
        value.update(outcome='expected-denial', expected_refusal=True,
                     collision_namespace_created=True, api_uncertainty_retained=True,
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
                self.anchor = self.namespace = self.file = None
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
        journal = SimpleNamespace(_WindowsJournalApi=Api, _NAMESPACE=codec._NAMESPACE,
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
        value=report('journal-namespace-denied');value['last_native_return_code']=0xc0000022
        with self.assertRaises(subject.JournalFixtureError):
            subject.validate_child_report(value,'journal-namespace-denied',engine.source_digest(HASHES))
        value=report('journal-namespace-denied');value['api_cleanup_confirmed']=True
        with self.assertRaises(subject.JournalFixtureError):
            subject.validate_child_report(value,'journal-namespace-denied',engine.source_digest(HASHES))

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
        value=subject.base_report('journal-namespace-denied',engine.source_digest(HASHES),0)
        value.update(timer_configured=True,elapsed_ns=100000)
        subject.exercise(engine,native,'journal-namespace-denied',HASHES,engine._JOURNAL_PROFILE.runs/'synthetic',value)
        owner=next(x for x in native.buffers if type(x) is subject._ApiOwner)
        self.assertTrue(owner._uncertain);self.assertIs(owner._pending['function'],owner._api.n.NtCreateFile)
        self.assertNotIn('retire',trace)
        subject.validate_child_report(value,'journal-namespace-denied',engine.source_digest(HASHES))

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

    def test_real_collector_and_sessions_admit_three_separate_journal_cases_with_synthetic_abi(self):
        native,directory=self.controller();rows=[]
        with patch.object(engine,'_journal_fixture',return_value=subject), \
             patch.object(engine,'_fresh_directory',side_effect=directory):
            result=engine._collect(native,'a'*32,HASHES,engine._JOURNAL_PROFILE.runs/('a'*32),rows)
        self.assertTrue(result);self.assertEqual([r['case'] for r in rows],list(subject.CASES))
        self.assertTrue(all(r['accepted'] and r['parent']['parent_cleanup_confirmed'] for r in rows))
        self.assertEqual(rows[0]['parent']['exit_code'],2)
        self.assertFalse(rows[-1]['child']['api_cleanup_confirmed'])
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


if __name__=='__main__':unittest.main()
