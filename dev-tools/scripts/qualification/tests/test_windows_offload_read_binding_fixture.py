"""Real Core/base identity/close with synthetic ABI; no native qualification."""
import copy
import ctypes as C
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from threading import get_ident
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import test_windows_offload_core_fixture as existing
from modules.adapters.runtime.python.worker.tasks import windows_offload_core as w

engine = existing.subject
SCRIPT = Path(__file__).resolve().parents[1] / 'windows_offload_read_binding_fixture.py'
SPEC = importlib.util.spec_from_file_location('read_binding_fixture_subject', SCRIPT)
subject = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(subject)
HASHES = {engine.TOOL_FILES[1]: 'a' * 64}


def report(case):
    value = subject.base_report(case, engine.source_digest(HASHES), 0)
    value.update(elapsed_ns=100000, timer_configured=True)
    if case == 'deadline-control': value['outcome'] = 'armed'
    else:
        value.update(**{n: True for n in subject._FLAGS if n not in
                     ('core_uncertainty_retained', 'model_started', 'production_composed')},
                     native_call_count=20, read_handle_count=3, retirement_identity_count=6,
                     acknowledged_close_count=3, last_native_phase='CloseHandle',
                     last_native_return_code=1, last_os_error_code=0)
    return value


class SyntheticNative:
    def __init__(self):
        self.profile = engine._READ_PROFILE
        self.buffers, self.calls = [], []
        self.timer_configured = True; self.component_thread = get_ident()
    def live(self): pass


class ReadFixtureTests(unittest.TestCase):
    def setUp(self):
        for guard in (patch.dict(w._CUSTODY, {}, clear=True), patch.dict(w._READ_RETIREMENTS, {}, clear=True)):
            guard.start(); self.addCleanup(guard.stop)

    def context(self, fault=None):
        native, events = SyntheticNative(), []
        def initialize(api, core):
            api.owner = core
            if fault == 'constructor': raise KeyboardInterrupt()
            def facts(number, kind, output, size):
                events.append(('identity', number))
                if fault == 'retire-identity' and core._read_retirement is not None: return 0
                _bytes = b'volume00' + number.to_bytes(16, 'little')
                C.memmove(output, _bytes, size)
                return 1
            def close(number):
                events.append(('close', number))
                position = sum(kind == 'close' for kind, _ in events)
                if fault == 'close-' + str(position): return 0
                if fault == 'interrupt-close': raise KeyboardInterrupt()
                return 1
            facts.__name__, close.__name__ = 'GetFileInformationByHandleEx', 'CloseHandle'
            api.k = SimpleNamespace(GetFileInformationByHandleEx=facts, CloseHandle=close)
        def prepare(api, _path):
            handles = []
            for i in range(3):
                h = w._Handle(); h.slot.value = 100 + i; api.owner._handles.append(h); handles.append(h)
            if fault == 'preparation': raise KeyboardInterrupt()
            return tuple((h, api.identity(h)) for h in handles)
        for guard in (patch.object(engine.C, 'get_last_error', return_value=0, create=True),
                      patch.object(engine, '_Native', SyntheticNative),
                      patch.object(engine, '_private_core_package', return_value={
                          'windows_offload_core': w, 'local_model_offload': SimpleNamespace(OffloadAdmissionError=w.OffloadAdmissionError)}),
                      patch.object(engine, '_fresh_directory'), patch.object(engine, '_child_readback'),
                      patch.object(engine, '_all_hashes', return_value=HASHES),
                      patch.object(w._WindowsApi, '__init__', initialize), patch.object(w._WindowsApi, 'prepare', prepare)):
            guard.start(); self.addCleanup(guard.stop)
        return native, events

    def exercise(self, native, value):
        subject.exercise(engine, native, 'unused-read-binding', HASHES,
                         engine._READ_PROFILE.runs/('a'*32)/'unused-read-binding', value)

    def test_real_core_base_close_and_identity_produce_acknowledged_retirement(self):
        native, events = self.context(); value = subject.base_report('unused-read-binding', engine.source_digest(HASHES), 0)
        value.update(timer_configured=True, elapsed_ns=100000)
        self.exercise(native, value)
        owner = next(x for x in native.buffers if type(x) is subject._Owner)
        self.assertEqual(owner.identities, [0,1,2,2,1,0]); self.assertEqual(owner.closes, [2,1,0])
        self.assertEqual(owner.events[:6], [(op,i) for i in range(3) for op in ('identity-started','identity-acknowledged')])
        self.assertEqual([n for kind,n in events if kind == 'close'], [102,101,100])
        self.assertTrue(owner.core._read_retirement.released)
        self.assertNotIn(id(owner.core), w._CUSTODY); self.assertNotIn(id(owner.core), w._READ_RETIREMENTS)
        self.assertEqual(owner.receiver.calls, 0); self.assertFalse(owner.core._uncertain)
        self.assertEqual(subject.validate_child_report(value, 'unused-read-binding', engine.source_digest(HASHES)), value)

    def test_constructor_preparation_identity_and_each_native_close_failure_retain_without_retry(self):
        for fault in ('constructor','preparation','retire-identity','close-1','close-2','close-3','interrupt-close'):
            with self.subTest(fault=fault):
                native, events = self.context(fault); value = report('unused-read-binding')
                with self.assertRaises((KeyboardInterrupt,w.OffloadAdmissionError,subject.ReadBindingFixtureError)):
                    self.exercise(native,value)
                owner = next(x for x in native.buffers if type(x) is subject._Owner)
                self.assertTrue(owner.uncertain); self.assertTrue(value['core_uncertainty_retained'])
                self.assertIsNotNone(owner.core); self.assertIn(owner.core,native.buffers)
                self.assertIsNotNone(owner.api); self.assertIs(type(owner.api),owner.factory)
                self.assertIs(owner.api.owner,owner.core)
                self.assertIs(value['fixture_owner_retained'],True)
                closes = [n for op,n in events if op=='close']; self.assertEqual(len(closes), len(set(closes)))
                if fault.startswith('close-'): self.assertEqual(len(closes),int(fault[-1]))
                if fault in ('constructor','preparation','retire-identity'): self.assertFalse(closes)
                self.assertIsNone(owner.receiver)

    def test_preparation_identities_cannot_replace_retirement_identities(self):
        native,events=self.context(); original=w._ReadBindingRetirement.retire
        def skipped(snapshot):
            snapshot.call,snapshot.thread=snapshot.core._dispatch,get_ident()
            snapshot.check('dispatch')
            for _,h,_,_,_ in reversed(snapshot.entries):
                snapshot.api.close(h);snapshot.closed+=1
            snapshot.core._retired=True
        with patch.object(w._ReadBindingRetirement,'retire',skipped),self.assertRaises(w.OffloadAdmissionError):
            self.exercise(native,report('unused-read-binding'))
        self.assertTrue(any(op=='identity' for op,_ in events));self.assertFalse(any(op=='close' for op,_ in events))

    def test_reordered_or_duplicate_retirement_close_denies_before_wrong_native_dispatch(self):
        for wrong in ('reordered','duplicate'):
            native,events=self.context()
            def retire(s):
                s.call,s.thread=s.core._dispatch,get_ident();s.check('dispatch')
                for _,h,_,_,_ in s.entries:s.api.identity(h)
                rank=0 if wrong=='reordered' else len(s.entries)-1
                s.api.identity(s.entries[rank][1]);s.api.close(s.entries[rank][1])
                if wrong=='duplicate':s.api.close(s.entries[rank][1])
            with self.subTest(wrong=wrong),patch.object(w._ReadBindingRetirement,'retire',retire),self.assertRaises(w.OffloadAdmissionError):
                self.exercise(native,report('unused-read-binding'))
            self.assertEqual(len([1 for op,_ in events if op=='close']),0 if wrong=='reordered' else 1)

    def test_observer_failure_after_real_close_ack_keeps_original_slots_and_stops(self):
        native,events=self.context();base=subject._Owner.bound
        def fail(owner):
            base(owner)
            if owner.entries and any(h.closed for _,h,_,_,_ in owner.entries):raise KeyboardInterrupt()
        with patch.object(subject._Owner,'bound',fail),self.assertRaises(KeyboardInterrupt):
            self.exercise(native,report('unused-read-binding'))
        owner=next(x for x in native.buffers if type(x) is subject._Owner)
        self.assertEqual([n for op,n in events if op=='close'],[102])
        self.assertTrue(owner.entries[-1][1].closed);self.assertFalse(owner.entries[0][1].closed)
        self.assertIs(owner.core._read_retirement.handles,owner.handles)
        self.assertIs(w._CUSTODY.get(id(owner.core)),owner.core)

    def test_lost_execution_ack_does_not_publish_release(self):
        native,events=self.context();base=engine._fixture_execution
        def port(*args):
            p=base(*args);execute=p.execute
            def run(core,operation):
                result=execute(core,operation)
                if core._read_retirement is not None:raise KeyboardInterrupt()
                return result
            p.execute=run;return p
        with patch.object(engine,'_fixture_execution',side_effect=port),self.assertRaises(KeyboardInterrupt):
            self.exercise(native,report('unused-read-binding'))
        owner=next(x for x in native.buffers if type(x) is subject._Owner)
        self.assertEqual(len([1 for op,_ in events if op=='close']),3)
        self.assertFalse(owner.core._read_retirement.released);self.assertIs(w._CUSTODY[id(owner.core)],owner.core)

    def test_late_borrow_wrong_exception_or_callback_cannot_pass(self):
        for mode in ('return','wrong','callback'):
            native,_=self.context()
            def borrow(binding,receiver):
                if mode=='wrong':raise RuntimeError('synthetic-private')
                if mode=='callback':receiver._accept_core_anchor(None,None,None)
            with self.subTest(mode=mode),patch.object(w._JournalCoreBinding,'borrow_anchor',borrow),self.assertRaises(subject.ReadBindingFixtureError):
                self.exercise(native,report('unused-read-binding'))
            owner=next(x for x in native.buffers if type(x) is subject._Owner)
            self.assertTrue(owner.uncertain)
            self.assertFalse(owner.core._uncertain)

    def test_fixture_failure_after_committed_cleanup_does_not_invent_core_uncertainty(self):
        native,_=self.context();value=subject.base_report('unused-read-binding',engine.source_digest(HASHES),0)
        def fail(*_):raise RuntimeError('synthetic-private')
        with patch.object(w._JournalCoreBinding,'borrow_anchor',fail),self.assertRaises(subject.ReadBindingFixtureError):
            self.exercise(native,value)
        owner=next(x for x in native.buffers if type(x) is subject._Owner)
        self.assertTrue(owner.uncertain and owner.core._retired and owner.core._read_retirement.released)
        self.assertFalse(owner.core._uncertain)
        self.assertTrue(value['fixture_owner_retained'])
        self.assertFalse(value['core_uncertainty_retained'])
        for name in ('core_cleanup_confirmed','core_handles_closed','custody_release_confirmed'):
            self.assertTrue(value[name])
        self.assertFalse(value['late_borrow_refused'])
        self.assertNotIn(id(owner.core),w._CUSTODY);self.assertNotIn(id(owner.core),w._READ_RETIREMENTS)

    def test_each_schema_fact_has_strict_type_and_positive_case_constraints(self):
        source=engine.source_digest(HASHES)
        for case in subject.CASES:
            value=report(case);subject.validate_child_report(value,case,source)
            changes=[{'extra':'private'},{'source_digest':'b'*64},{'schema_version':'windows-offload-core-native-v2'},
                     {'timer_configured':False},{'elapsed_ns':True},{'failure_stage':'read-binding-operation'},
                     {'last_native_phase':'private'},{'last_os_error_code':-1}]
            changes.extend({n:1} for n in subject._FLAGS)
            changes.extend({n:True} for n in subject._COUNTS)
            if case!='deadline-control':
                changes.extend({n:False} for n in subject._FLAGS if value[n])
                changes.extend(({ 'retirement_identity_count':3},{'acknowledged_close_count':2},
                                {'late_borrow_callback_count':1},{'late_borrow_native_calls':1},
                                {'read_handle_count':0},{'native_call_count':0}))
            for change in changes:
                with self.subTest(case=case,change=change),self.assertRaises(subject.ReadBindingFixtureError):
                    subject.validate_child_report({**value,**change},case,source)

    def test_failure_diagnostics_allow_only_bounded_fixed_primitives(self):
        value={'failure_stage':'private','last_native_phase':'private','native_call_count':True,
               'last_os_error_code':-1,'extra':'private','read_handle_count':999999}
        self.assertNotIn('private',json.dumps(subject.failure_diagnostics(value)))
        self.assertNotIn('native_call_count',subject.failure_diagnostics(value))
        self.assertEqual(subject.ReadBindingFixtureError('private').stage,'read-binding-operation')

    def test_canonical_source_and_bootstrap_modes_are_separate(self):
        digest=hashlib.sha256(Path(engine.__file__).read_bytes()).hexdigest()
        with patch.object(engine,'_LOADED_SOURCE_SHA256',digest,create=True):
            values=engine._repo_hashes(engine._READ_PROFILE)
        self.assertEqual(set(values),set(engine._READ_PROFILE.task_files+engine._READ_PROFILE.tool_files))
        self.assertNotIn(engine._JOURNAL_PROFILE.tool_files[0],values)
        for profile in (engine._CORE_PROFILE,engine._JOURNAL_PROFILE,engine._READ_PROFILE):
            text=engine._bootstrap('a'*32,profile.cases[-1],HASHES,1,1,2,3,profile)
            expected='_READ_PROFILE' if profile is engine._READ_PROFILE else '_JOURNAL_PROFILE' if profile is engine._JOURNAL_PROFILE else '_CORE_PROFILE'
            self.assertIn(',m.'+expected+')',text)
            for bad in (copy.copy(profile),SimpleNamespace(**{name:getattr(profile,name) for name in profile.__slots__})):
                with self.assertRaises(engine.FixtureError):engine._bootstrap('a'*32,'deadline-control',HASHES,1,1,2,3,bad)
        with self.assertRaises(engine.FixtureError):engine._bootstrap('a'*32,'journal-roundtrip',HASHES,1,1,2,3,engine._READ_PROFILE)

    def test_actual_child_branch_uses_read_component_and_safe_own_failure_stage(self):
        for failure in (None, subject.ReadBindingFixtureError('read-binding-close'), RuntimeError('synthetic-private')):
            class End(BaseException): pass
            events,reports,exits=[],[],[]
            native=SimpleNamespace(profile=engine._READ_PROFILE,uncertain=False,timer_configured=False,
                deadline_ns=engine.time.monotonic_ns()+engine.BUDGET_NS,
                k=SimpleNamespace(GetFileType=lambda *_:1,SetEvent=lambda *_:1),
                wait=lambda *_:True,close=lambda *_:None)
            def arm():events.append('arm');native.timer_configured=True
            def exit_self(code):exits.append(code);raise End()
            def write(_native,_report,value):
                if reports:raise engine.FixtureError('already-written')
                reports.append(dict(value))
            def exercise(*args):
                events.append('read')
                self.assertIs(args[0],engine);self.assertIs(args[1],native)
                if failure is not None:raise failure
                args[-1].update(report('unused-read-binding'))
            native.arm_deadline,native.exit_self=arm,exit_self
            native.call=lambda _stage,function,*args,**_kwargs:function(*args)
            guards=(patch.object(sys,'flags',SimpleNamespace(isolated=1,no_site=1)),
                    patch.object(sys,'dont_write_bytecode',True),patch.object(sys,'prefix',sys.base_prefix),
                    patch.object(engine,'_Native',return_value=native),patch.object(engine,'_all_hashes',return_value=HASHES),
                    patch.object(engine,'_inherited',return_value=SimpleNamespace(value=1)),patch.object(engine,'_report_size',return_value=0),
                    patch.object(engine,'_child_readback'),patch.object(engine,'_read_fixture',return_value=subject),
                    patch.object(subject,'exercise',side_effect=exercise),patch.object(engine,'_write_report',side_effect=write),
                    patch.object(engine,'_exercise_core',side_effect=AssertionError('Wrong Core mode')),
                    patch.object(engine,'_journal_fixture',side_effect=AssertionError('Wrong Journal mode')))
            for guard in guards:guard.start()
            try:
                with self.subTest(failure=type(failure).__name__),self.assertRaises(End):
                    engine._owned_child('a'*32,'unused-read-binding',HASHES,native.deadline_ns,1,2,3,engine._READ_PROFILE)
            finally:
                for guard in reversed(guards):guard.stop()
            self.assertEqual(events,['arm','read']);self.assertEqual(exits[0],0 if failure is None else 9)
            expected='none' if failure is None else 'read-binding-close' if type(failure) is subject.ReadBindingFixtureError else 'read-binding-operation'
            self.assertEqual(reports[0]['failure_stage'],expected)
            self.assertNotIn('synthetic-private',json.dumps(reports))

    def controller(self,bad=False):
        native=existing.FakeNative();native.profile=engine._READ_PROFILE
        def directory(path,profile):
            self.assertIs(profile,engine._READ_PROFILE)
            native.dispatched=native.exited=False;native.current_case=path.name
            value=report(path.name)
            if bad and path.name=='unused-read-binding':value.update(failure_stage='read-binding-close',extra='synthetic-private')
            native.raw=json.dumps(value).encode();return (1,2)
        def exit_code(_handle,slot):slot._obj.value=2 if native.current_case=='deadline-control' else 0;return 1
        native.k.GetExitCodeProcess=exit_code
        return native,directory

    def test_real_collector_uses_exact_two_cases_and_separate_parent_observations(self):
        for bad in (False,True):
            native,directory=self.controller(bad);rows=[]
            with patch.object(engine,'_read_fixture',return_value=subject),patch.object(engine,'_fresh_directory',side_effect=directory):
                result=engine._collect(native,'a'*32,HASHES,engine._READ_PROFILE.runs/('a'*32),rows)
            self.assertEqual(result,not bad);self.assertEqual([r['case'] for r in rows],list(subject.CASES))
            self.assertEqual(rows[0]['parent']['exit_code'],2)
            self.assertTrue(rows[-1]['parent']['parent_cleanup_confirmed'])
            if bad:self.assertNotIn('child',rows[-1]);self.assertNotIn('synthetic-private',json.dumps(rows))


if __name__=='__main__':unittest.main()
