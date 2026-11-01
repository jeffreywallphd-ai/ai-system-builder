"""Typed synthetic ABI and strict oracles; never physical IO qualification."""
import copy
import ctypes as C
import importlib.util
from pathlib import Path
import sys
from threading import get_ident
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_execution as x

FOLDER=Path(__file__).resolve().parents[1]
def load(name,leaf):
    spec=importlib.util.spec_from_file_location(name,FOLDER/leaf)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
subject=load('read_session_fixture_subject','windows_offload_read_session_fixture.py')
base=load('read_session_core_subject','windows_offload_core_fixture.py')


def result(case):
    return {'case':case,'accepted':True,'child_membership_and_limits':True,'suspend_previous_count':0,
            'original_read_intent':True,'caller_failed_and_exited':True,'caller_frontier_published':True,
            'read_result':0,'read_error':995 if case==subject.CASES[0] else 109,'read_success_acknowledged':False,
            'cancel_result':1 if case==subject.CASES[0] else None,'cancel_error':0 if case==subject.CASES[0] else None,
            'child_stop_acknowledged':case==subject.CASES[1],'controller_exit':9,'reaper_exit':0,'child_exit':9,
            'job_active':0,'job_total':1,'owned_handles':15,'closed_handles':15,'original_rows_settled':True,
            'terminal_rows_acknowledged':True,'terminal_final_proof':True,'failed_request_preserved':True,
            'core_retired':False,'replayed_native_dispatches':0,'model_started':False,'disk_credit_granted':False,
            'parent_qualification_granted':False}


class Function:
    def __init__(self,kernel,name):self.kernel=kernel;self.name=name
    def __call__(self,*args):
        k=self.kernel;k.calls.append((self.name,args))
        if self.name in k.errors:raise k.errors[self.name]
        if self.name=='IsProcessInJob':args[-1]._obj.value=k.inside
        if self.name=='QueryInformationJobObject':
            v=args[2]._obj;v.basic.flags=0x2308;v.basic.active_process_limit=1
            v.process_memory_limit=v.job_memory_limit=k.memory
        return k.results.get(self.name,1)


class FixtureTests(unittest.TestCase):
    def setUp(self):
        for scope in (patch.dict(x._OWNERS,{},clear=True),patch.object(C,'get_last_error',return_value=0,create=True)):
            scope.start();self.addCleanup(scope.stop)
        self.addCleanup(base._NATIVE_OWNERS.clear)

    def control(self,case=subject.CASES[0]):
        o=x._WindowsOffloadIoSession('C:\\synthetic-fresh-cache')
        api=object.__new__(x._Native);api._Native__origin=api;api.owner=o;o.api=api
        ak=SimpleNamespace(calls=[],errors={},results={})
        api.k=SimpleNamespace(ReadFile=object(),CloseHandle=Function(ak,'CloseHandle'))
        n=object.__new__(base._Native);n._Native__origin=n;n._Native__profile=base._EXECUTION_PROFILE
        n.deadline_ns=x.time.monotonic_ns()+x._BUDGET_NS;n.uncertain=n.expired=False;n.buffers=[]
        k=SimpleNamespace(calls=[],errors={},results={'WaitForSingleObject':0,'GetProcessId':321,'SuspendThread':0},inside=1,memory=x._MEMORY_BYTES)
        for name in ('IsProcessInJob','QueryInformationJobObject','WaitForSingleObject','GetProcessId',
                     'SuspendThread','SetEvent','TerminateJobObject'):setattr(k,name,Function(k,name))
        n.k=k;base._NATIVE_OWNERS.append(n)
        for i,name in enumerate(('start_event','request_event','completion_event','controller','request-read',
            'request-write','response-read','response-write','ready','dispatch','job','process','primary_thread')):
            h=x._Handle(o,name);o.handles.append(h);h.slot.value=i+100;h.acknowledge()
            if '-' in name or name in ('ready','dispatch'):o.channels[name]=h
            else:setattr(o,name,h)
        o.process_info.process=o.process._number;o.process_info.thread=o.primary_thread._number;o.process_info.pid=321
        o.launch_complete=True;o.state='initialized'
        r=x._Request(o,0);r.started=r.returned=r.published=r.consumed=True;r.effect_token=object()
        o.requests.append(r);o._effect_exits[id(r)]=(r,r.effect_token,get_ident(),True)
        o.active=r
        for name in ('request-read','response-write'):api.close(o.channels[name])
        o.active=None
        return subject._FaultControl(x,base,n,o,case),o,k

    def ready(self,c):
        for label in ('membership','limits','ready','process-id','suspend'):c.issue(label)

    def pending(self,c,o,started=True):
        r=x._Request(o,1);r.started=True;r.effect_token=object();o.requests.append(r)
        o.active=r;o.busy=True;o.controller_ident=get_ident()
        o._effect_exits[id(r)]=(r,r.effect_token,get_ident(),False)
        h=o.channels['response-read'];data=C.create_string_buffer(4);count=x._U32()
        row=o.api._call_row(o.api.k.ReadFile,h.value,C.byref(data),4,C.byref(count),None,keep=(h,data,count))
        if started:o.ledger.claim(row,o.api)
        return r,row

    def test_committed_before_claim_is_not_ready_until_original_start(self):
        c,o,k=self.control();self.ready(c);r,row=self.pending(c,o,started=False)
        with self.assertRaises(subject.ReadSessionFixtureError) as denied:subject._read_intent(x,o,r)
        self.assertEqual(denied.exception.stage,'read-intent-count')
        self.assertFalse(row.started);self.assertIsNone(row.native_thread)
        o.ledger.claim(row,o.api);self.assertIs(subject._read_intent(x,o,r),row)
        c.capture_read(r,row)
        with self.assertRaises(subject.ReadSessionFixtureError):c.capture_read(r,row)

    def test_foreign_retained_rows_bindings_completions_and_labels_invoke_no_callback_or_effect(self):
        class Foreign:
            def __init__(self):self.calls=0
            def bad(self,*_):self.calls+=1;raise AssertionError('Foreign callback')
            __getitem__=__iter__=__len__=__eq__=__bool__=bad
        for target in ('rows','bindings','completions','used'):
            with self.subTest(target=target),patch.dict(x._OWNERS,{},clear=True):
                c,o,k=self.control();c.issue('membership');value=Foreign()
                getattr(c,target)[0]=value;before=list(k.calls)
                with self.assertRaises(subject.ReadSessionFixtureError):c.issue('limits')
                self.assertEqual(value.calls,0);self.assertEqual(k.calls,before)

    def test_pending_oracle_binds_original_controller_response_and_refuses_metadata_only_or_substitution(self):
        c,o,k=self.control();self.ready(c);r,row=self.pending(c,o)
        self.assertIs(subject._read_intent(x,o,r),row)
        self.assertEqual(k.calls[-1][0],'SuspendThread')
        for mutate in (lambda:setattr(row,'started',False),lambda:setattr(row,'native_thread',-1),
                       lambda:setattr(row,'payload',tuple(list(row.payload))),lambda:setattr(r,'published',True)):
            before=(row.started,row.native_thread,row.payload,r.published)
            mutate()
            with self.assertRaises(subject.ReadSessionFixtureError):subject._read_intent(x,o,r)
            row.started,row.native_thread,row.payload,r.published=before
        c.capture_read(r,row);o._fence()
        c.issue('wake-caller')
        self.assertEqual(k.calls[-1],('SetEvent',(o.completion_event._number,)))
        self.assertIs(c.rows[-1]['keep'][0],o.completion_event)
        self.assertFalse(o._effect_exits[id(r)][3]);self.assertFalse(r.consumed)

    def test_child_stop_requires_real_caller_exit_and_published_frontier(self):
        c,o,k=self.control(subject.CASES[1]);self.ready(c);r,row=self.pending(c,o)
        c.capture_read(r,row);o._fence();c.issue('wake-caller')
        c.caller=SimpleNamespace(is_alive=lambda:True);c.caller_result={'failed':True};before=list(k.calls)
        with self.assertRaises(subject.ReadSessionFixtureError):c.issue('stop-child')
        self.assertEqual(k.calls,before);c.caller.is_alive=lambda:False
        with self.assertRaises(subject.ReadSessionFixtureError):c.issue('stop-child')
        self.assertEqual(k.calls,before)
        entry=o._effect_exits[id(r)];o._effect_exits[id(r)]=(*entry[:3],True)
        c.issue('stop-child');self.assertEqual(k.calls[-1],('TerminateJobObject',(o.job._number,9)))
        self.assertFalse(r.consumed);self.assertFalse(o.session_retired)

    def test_exact_original_child_thread_and_finite_order_are_used(self):
        c,o,k=self.control();self.ready(c)
        self.assertEqual([n for n,_ in k.calls],['IsProcessInJob','QueryInformationJobObject','WaitForSingleObject','GetProcessId','SuspendThread'])
        self.assertEqual(k.calls[-1][1],(o.primary_thread._number,));self.assertTrue(c.suspended)
        self.assertTrue(all(r['acknowledged'] for r in c.rows))
        self.assertTrue(o.channels['request-read'].closed and o.channels['response-write'].closed)
        self.assertEqual(sum(h.closed for h in o.handles),2)
        self.assertIsNot(o.primary_thread,o.controller);self.assertIsNot(o.controller,o.completion_event)
        before=list(k.calls)
        with self.assertRaises(subject.ReadSessionFixtureError):c.issue('suspend')
        self.assertEqual(k.calls,before)

    def test_foreign_origin_slot_function_output_and_handle_set_deny_before_effect(self):
        mutations=(lambda c,o,k:setattr(o.primary_thread,'slot',x._PTR(o.primary_thread._number)),
                   lambda c,o,k:setattr(c,'inside',x._I32()),lambda c,o,k:setattr(k,'SetEvent',Function(k,'SetEvent')),
                   lambda c,o,k:setattr(c,'_FaultControl__origin',object()),lambda c,o,k:o.handles.reverse())
        for mutate in mutations:
            with self.subTest(mutate=mutate),patch.dict(x._OWNERS,{},clear=True):
                c,o,k=self.control();mutate(c,o,k)
                with self.assertRaises(Exception):c.issue('membership')
                self.assertEqual(k.calls,[])

    def test_bad_membership_limits_previous_suspend_count_and_interruption_never_retry(self):
        for mode in ('membership','memory','suspend-count','interrupt'):
            with self.subTest(mode=mode),patch.dict(x._OWNERS,{},clear=True):
                c,o,k=self.control()
                if mode=='membership':k.inside=0
                if mode=='memory':k.memory+=1
                if mode=='suspend-count':k.results['SuspendThread']=1
                if mode=='interrupt':k.errors['SuspendThread']=KeyboardInterrupt()
                with self.assertRaises(BaseException):self.ready(c)
                before=list(k.calls)
                with self.assertRaises(BaseException):c.issue('membership' if mode=='membership' else 'suspend')
                self.assertEqual(k.calls,before)
                self.assertFalse(c.suspended)

    def test_partial_fault_receipt_or_changed_result_cannot_admit_next_effect(self):
        for mutate in (lambda c:c.rows[0].update(result=2),lambda c:c.rows[0].update(acknowledged=False),
                       lambda c:c.completions.__setitem__(0,None),lambda c:c.bindings.clear()):
            with self.subTest(mutate=mutate),patch.dict(x._OWNERS,{},clear=True):
                c,o,k=self.control();c.issue('membership');mutate(c);before=list(k.calls)
                with self.assertRaises(subject.ReadSessionFixtureError):c.issue('limits')
                self.assertEqual(k.calls,before)

    def test_missing_fenced_read_and_real_caller_exit_refuse_wake_and_stop(self):
        c,o,k=self.control(subject.CASES[1]);self.ready(c);before=list(k.calls)
        with self.assertRaises(subject.ReadSessionFixtureError):c.issue('wake-caller')
        self.assertEqual(k.calls,before)
        with self.assertRaises(subject.ReadSessionFixtureError):c.issue('stop-child')
        self.assertEqual(k.calls,before)

    def test_pure_oracle_requires_every_proof_and_does_not_conflate_error109_with_cancellation(self):
        for case in subject.CASES:
            value=result(case);self.assertEqual(subject.validate_case(value,case),value)
            for name in value:
                if name=='case':continue
                v=copy.deepcopy(value);v[name]=object()
                with self.subTest(case=case,name=name),self.assertRaises(subject.ReadSessionFixtureError):subject.validate_case(v,case)
        for change in ({'cancel_result':0,'cancel_error':1168},{'read_result':1,'read_error':0},
                       {'read_error':109},{'read_error':995,'read_success_acknowledged':True},
                       {'job_active':1},{'controller_exit':259},{'closed_handles':14},{'owned_handles':True}):
            v=result(subject.CASES[0]);v.update(change)
            with self.subTest(change=change),self.assertRaises(subject.ReadSessionFixtureError):subject.validate_case(v,subject.CASES[0])

    def test_imported_or_cross_profile_collector_denies_before_source_or_file_work(self):
        with patch.object(base,'_private_core_package',side_effect=AssertionError('No source load')):
            with self.assertRaises(subject.ReadSessionFixtureError):subject.collect(SimpleNamespace(),base,{},Path('.'),[])
            c,o,k=self.control()
            with self.assertRaises(subject.ReadSessionFixtureError):subject.collect(c.native,base,{},Path('.'),[])

    def test_failure_diagnostics_are_bounded_partial_facts_without_a_pass_or_native_effect(self):
        c,o,k=self.control();self.ready(c);r,row=self.pending(c,o);c.capture_read(r,row)
        before=list(k.calls);v=subject.failure_diagnostics(c)
        self.assertEqual(v['original_read'],{'started':True,'returned':False,'acknowledged':False,'result':None,'error':None})
        self.assertFalse(v['terminal_final_proof']);self.assertIsNone(v['cancel'])
        row.result=object();row.error='synthetic-private-detail'
        v=subject.failure_diagnostics(c);self.assertIsNone(v['original_read']['result']);self.assertIsNone(v['original_read']['error'])
        self.assertEqual(k.calls,before);self.assertNotIn('synthetic-private-detail',str(v))

    def test_partial_retirement_constructor_retains_unknown_diagnostics_without_replacing_failure(self):
        c,o,k=self.control();self.ready(c);before=list(k.calls)
        for fields in ({},{'owner':o},{'owner':o,'used':{}},
                       {'owner':o,'used':{},'query_outputs':None}):
            with self.subTest(fields=tuple(fields)):
                t=object.__new__(x._TerminalRetirement)
                for name,value in fields.items():setattr(t,name,value)
                o.terminal=t;v=subject.failure_diagnostics(c)
                self.assertIs(v['terminal_final_proof'],False)
                self.assertTrue(all(value is None for name,value in v.items() if name!='terminal_final_proof'))
                self.assertEqual(k.calls,before)


if __name__=='__main__':unittest.main()
