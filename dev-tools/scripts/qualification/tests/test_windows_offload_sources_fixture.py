"""Pure SOURCE ledger/fixture tests. No real Native, model or fixture setup."""
import copy
import ctypes as C
import importlib.util
import builtins
import io
import json
from pathlib import Path
import pickle
import sys
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ENGINE = Path(__file__).resolve().parents[1] / 'windows_offload_core_fixture.py'
SPEC = importlib.util.spec_from_file_location('source_qualification_engine_under_test', ENGINE)
e = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = e
SPEC.loader.exec_module(e)

def load(leaf,name):
    spec=importlib.util.spec_from_file_location(name,ENGINE.with_name(leaf))
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module
    spec.loader.exec_module(module);return module

f=load('windows_offload_sources_fixture.py','source_fixture_under_test')
entry=load('qualify_windows_offload_sources.py','source_entry_under_test')


class SourceSlotsTests(unittest.TestCase):
    def setUp(self):
        # An inert instance supplies pure table ownership for these tests. It is
        # NOT a Job/timer producer or permission to construct the SourceAPI.
        owner = object.__new__(e._Native)
        owner._Native__origin = owner
        owner._Native__profile = e._SOURCE_PROFILE
        owner._Native__component_thread = __import__('threading').get_ident()
        owner.calls,owner.buffers = [],[]
        owner.pending = None
        owner.deadline_ns = time.monotonic_ns()+120*10**9
        owner.uncertain = owner.expired = False
        e._NATIVE_OWNERS.append(owner)
        self.addCleanup(lambda:e._NATIVE_OWNERS.remove(owner))
        self.owner = owner
        owner.source_slots = self.arena = e._SourceSlots(owner,e._SOURCE_CHILD)

    def deny(self, operation):
        with self.assertRaises(e.FixtureError):operation()

    def invoke_data(self, ticket, value=7, terminal=False):
        # These are simulated records only; no native function is invoked.
        row=self.arena.begin(ticket,'synthetic-native',lambda:None,(),(object(),),terminal=terminal)
        self.arena.returned(row,value,0)
        self.arena.acknowledge(row)
        return row

    def test_one_physical16384_table_includes_shared64_terminal_tail(self):
        ticket=self.arena.reserve('whole-graph',16320,64)
        self.assertEqual(len(ticket.rows),16384)
        self.assertEqual(sum(row.terminal for row in ticket.rows),64)
        self.assertEqual(len({id(row) for row in ticket.rows}),16384)
        self.deny(lambda:self.arena.reserve('overflow',1,0))
        self.assertFalse(self.owner.calls)

    def test_source_and_engine_cannot_each_get_a_fresh_terminal_pool(self):
        first=self.arena.reserve('source-close',0,40)
        second=self.arena.reserve('engine-close',0,24)
        self.assertFalse({id(row) for row in first.rows}&{id(row) for row in second.rows})
        self.deny(lambda:self.arena.reserve('extra-close',0,1))

    def test_acknowledged_rows_are_not_refunded_or_reused(self):
        ticket=self.arena.reserve('source',2,1)
        rows=[self.invoke_data(ticket),self.invoke_data(ticket),self.invoke_data(ticket,terminal=True)]
        self.assertEqual(len({id(row) for row in rows}),3)
        self.deny(lambda:self.invoke_data(ticket))
        self.deny(lambda:self.invoke_data(ticket,terminal=True))
        self.assertTrue(all(row.reservation is ticket for row in rows))

    def test_in_place_list_clear_cannot_drop_original_intent_or_ack(self):
        ticket=self.arena.reserve('source',1,0)
        row=self.arena.begin(ticket,'synthetic-native',lambda:None,(),(object(),))
        self.arena.returned(row,7,0)
        self.owner.calls.clear();self.arena.issued.clear()
        self.deny(lambda:self.arena.acknowledge(row))
        self.assertIs(self.arena.rows[row.index],row)
        self.assertIs(self.arena.bindings[row.index],row.binding)
        self.assertIs(self.arena.completions[row.index],row.completion)
        self.assertIs(self.arena.order[0],row)

    def test_copies_and_serialized_snapshots_do_not_transfer_reservations(self):
        ticket=self.arena.reserve('source',1,0)
        for value in (ticket,self.arena):
            for operation in (copy.copy,copy.deepcopy,pickle.dumps):
                with self.subTest(value=type(value).__name__,operation=operation.__name__):
                    self.deny(lambda:operation(value))

    def test_known_return_is_distinct_from_ack_and_keeps_actual_scalar(self):
        ticket=self.arena.reserve('source',1,0)
        row=self.arena.begin(ticket,'synthetic-native',lambda:None,(),())
        value=int('1073741829')
        self.arena.returned(row,value,997)
        self.assertIs(row.completion[1],value)
        self.assertEqual(row.completion[2],997)
        self.assertFalse(row.payload['acknowledged'])
        self.arena.acknowledge(row)
        self.assertTrue(row.payload['acknowledged'])
        self.deny(lambda:self.arena.acknowledge(row))

    def test_scalar_bool_and_foreign_completion_are_denied(self):
        ticket=self.arena.reserve('source',1,0)
        row=self.arena.begin(ticket,'synthetic-native',lambda:None,(),())
        self.deny(lambda:self.arena.returned(row,True,0))
        self.arena.returned(row,0,0)
        row.completion=tuple(list(row.completion))
        self.deny(lambda:self.arena.acknowledge(row))

    def test_output_payload_rebinding_keeps_original_completion_and_denies_ack(self):
        ticket=self.arena.reserve('source',1,0)
        row=self.arena.begin(ticket,'synthetic-native',lambda:None,(),())
        self.arena.returned(row,23,0)
        row.payload['result']=42
        self.deny(lambda:self.arena.acknowledge(row))
        self.assertEqual(self.arena.completions[row.index][1],23)

    def test_bootstrap_retains_actual_original_dll_object(self):
        class Dll:
            def __init__(self,name):self._name,self._handle=name,123
        with patch.object(C,'WinDLL',Dll,create=True):
            ticket=self.arena.reserve('system-bootstrap',1,0)
            row=self.arena.begin(ticket,'system-bootstrap',Dll,('kernel32.dll',),(),
                                 variant='system-library',library='kernel32.dll')
            dll=Dll('kernel32.dll')
            self.deny(lambda:self.arena.returned(row,1,0))
            self.arena.returned(row,dll,5)
            self.assertIs(row.completion[1],dll)
            self.assertEqual(row.completion[2],5)
            self.arena.acknowledge(row)

    def test_late_ack_cannot_turn_an_expired_return_into_success(self):
        ticket=self.arena.reserve('source',1,0)
        row=self.arena.begin(ticket,'synthetic-native',lambda:None,(),())
        self.arena.returned(row,1,0)
        self.owner.expired=True
        self.deny(lambda:self.arena.acknowledge(row))
        self.assertIsNotNone(self.arena.completions[row.index])
        self.assertFalse(row.payload['acknowledged'])

    def test_known_return_is_retained_after_lists_are_cleared_before_return(self):
        ticket=self.arena.reserve('source',1,0)
        row=self.arena.begin(ticket,'synthetic-native',lambda:None,(),())
        original=row.payload
        self.owner.calls.clear();self.arena.issued.clear()
        self.arena.returned(row,31,997)
        self.assertIs(self.arena.payloads[row.index],original)
        self.assertEqual(self.arena.completions[row.index][1:3],(31,997))
        self.assertTrue(original['returned']);self.assertFalse(original['acknowledged'])
        self.deny(lambda:self.arena.acknowledge(row))
        self.deny(lambda:self.arena.begin(ticket,'replay',lambda:None,(),()))

    def test_replaced_observation_payload_cannot_erase_the_original_known_reply(self):
        ticket=self.arena.reserve('source',1,0)
        row=self.arena.begin(ticket,'synthetic-native',lambda:None,(),())
        original=row.payload;row.payload=dict(original)
        self.arena.returned(row,0,5)
        self.assertIs(self.arena.payloads[row.index],original)
        self.assertEqual(original['os_error'],5)
        self.assertFalse(row.payload['returned'])
        self.deny(lambda:self.arena.acknowledge(row))

    def test_in_place_original_payload_drift_keeps_actual_return_without_ack(self):
        ticket=self.arena.reserve('source',1,0)
        row=self.arena.begin(ticket,'synthetic-native',lambda:None,(),())
        row.payload['stage']='changed-observation'
        self.deny(lambda:self.arena.returned(row,73,5))
        self.assertEqual(self.arena.completions[row.index][1:3],(73,5))
        self.assertIs(row.completion,self.arena.completions[row.index])
        self.assertTrue(self.arena.fenced and self.owner.uncertain)
        self.assertFalse(row.payload['acknowledged'])
        self.deny(lambda:self.arena.acknowledge(row))


class SourceReportsTests(unittest.TestCase):
    def value(self,case):
        v=f.base_report(case,'a'*64,time.monotonic_ns())
        v.update(timer_configured=True,elapsed_ns=100000)
        if case==f.CASES[0]:v['outcome']='armed';return v
        v.update(shared_rows_reserved=True,source_files=4,source_ancestors=3,source_reads=5,
            source_reserved_normal=144,source_reserved_terminal=24,
            engine_reserved_normal=256,engine_reserved_terminal=16,
            late_reuse_refused=True,no_source_replay=True)
        if case==f.CASES[1]:
            v.update(source_prepared=True,exact_hashes_confirmed=True,source_reads_completed=True,
                source_guards_retired=True,source_handles_closed=True,source_retired=True,
                source_native_calls=168,source_terminal_calls=24,source_closed_handles=12)
        else:v.update(hash_denial_observed=True,original_custody_retained=True,source_native_calls=88)
        return v

    def test_each_complete_case_has_strict_distinct_oracle(self):
        for case in f.CASES:
            value=self.value(case)
            self.assertEqual(f.validate_child_report(value,case,'a'*64),value)
            for other in f.CASES:
                if other!=case:
                    with self.assertRaises(f.SourceFixtureError):f.validate_child_report(value,other,'a'*64)

    def test_missing_extra_wrong_types_and_private_fields_are_rejected(self):
        for case in f.CASES:
            for key in f._FIELDS:
                value=self.value(case);value.pop(key)
                with self.subTest(case=case,key=key),self.assertRaises(f.SourceFixtureError):
                    f.validate_child_report(value,case,'a'*64)
            for key,bad in [('private','synthetic-private'),('elapsed_ns',True),('source_reads',True),
                            ('timer_configured',1),('source_digest','b'*64),('failure_stage','private')]:
                value=self.value(case);value[key]=bad
                with self.subTest(case=case,key=key),self.assertRaises(f.SourceFixtureError):
                    f.validate_child_report(value,case,'a'*64)

    def test_every_positive_fact_and_closure_count_is_required(self):
        for key in ('source_prepared','exact_hashes_confirmed','source_reads_completed',
                    'source_guards_retired','source_handles_closed','source_retired',
                    'shared_rows_reserved','late_reuse_refused','no_source_replay'):
            value=self.value(f.CASES[1]);value[key]=False
            with self.subTest(key=key),self.assertRaises(f.SourceFixtureError):
                f.validate_child_report(value,f.CASES[1],'a'*64)
        for key in f._COUNTS:
            value=self.value(f.CASES[1]);value[key]+=1
            with self.subTest(key=key),self.assertRaises(f.SourceFixtureError):
                f.validate_child_report(value,f.CASES[1],'a'*64)

    def test_hash_failure_cannot_claim_cleanup_or_parent_credit(self):
        for key in ('source_retired','source_handles_closed','source_guards_retired',
                    'exact_hashes_confirmed','source_prepared','disk_credit_granted',
                    'model_started','production_composed','parent_qualification_granted'):
            value=self.value(f.CASES[2]);value[key]=True
            with self.subTest(key=key),self.assertRaises(f.SourceFixtureError):
                f.validate_child_report(value,f.CASES[2],'a'*64)
        value=self.value(f.CASES[2]);value['original_custody_retained']=False
        with self.assertRaises(f.SourceFixtureError):f.validate_child_report(value,f.CASES[2],'a'*64)

    def test_safe_diagnostics_never_echo_unknown_values(self):
        value={'private':'synthetic-private','source_reads':'synthetic-private',
            'source_retired':1,'failure_stage':'synthetic-private','source_files':4,
            'source_native_calls':10**9,'hash_denial_observed':True}
        self.assertEqual(f.failure_diagnostics(value),{'source_files':4,'hash_denial_observed':True})
        self.assertEqual(f.failure_diagnostics(None),{})


class SourceEntryTests(unittest.TestCase):
    def request(self,args):
        output=io.StringIO()
        with (patch('sys.stdout',output),patch.object(Path,'open',side_effect=AssertionError('No file')),
              patch.object(Path,'mkdir',side_effect=AssertionError('No directory'))):
            result=entry.main(args)
        return result,json.loads(output.getvalue())

    def test_default_and_plan_are_inert_and_preserve_all_gaps(self):
        for args,expected in (([],3),(['--plan'],0)):
            result,value=self.request(args);self.assertEqual(result,expected)
            self.assertEqual(value['cases'],list(f.CASES))
            self.assertEqual(value['shared_dispatch_slots'],16384)
            self.assertEqual(value['terminal_slots_inside_total'],64)
            self.assertEqual(value['inert_child_commit_ceiling_bytes'],512*1024**2)
            for key in ('native_effects','native_tests_executed','qualification_complete',
                        'old_staging_accessed','quality_tests_executed','model_or_worker_started',
                        'production_composed','parent_qualification_granted'):
                self.assertIs(value[key],False)

    def test_imported_native_and_arbitrary_parameters_deny_without_io(self):
        for args in (['--native'],['--nat'],['--plan','--native'],['--pid','123'],
            ['--root','synthetic-private'],['--budget','1'],['--force'],['--command','private']):
            result,value=self.request(args);self.assertEqual(result,2)
            self.assertEqual(value['status'],'request-refused');self.assertNotIn('private',json.dumps(value))

    def test_cold_import_cannot_load_native_models_or_execute_a_process(self):
        original=builtins.__import__
        def checked(name,*args,**kwargs):
            if name.split('.')[0]in {'ctypes','subprocess','torch','transformers','accelerate','modules'}:
                raise AssertionError('Unexpected native or model import')
            return original(name,*args,**kwargs)
        with patch('builtins.__import__',side_effect=checked):
            load('qualify_windows_offload_sources.py','cold_source_declaration')

    def test_plan_failure_never_exposes_exception_text(self):
        with patch.object(entry,'current_plan',side_effect=OSError('synthetic-private')):
            result,value=self.request(['--plan'])
        self.assertEqual(result,2);self.assertNotIn('synthetic-private',json.dumps(value))


class SourceProducerTests(unittest.TestCase):
    # All Windows replies here are synthetic in-memory functions.
    deny=SourceSlotsTests.deny
    def setUp(self):
        SourceSlotsTests.setUp(self)
        from modules.adapters.runtime.python.worker.tests import test_windows_offload_sources as original
        self.original=original;self.s=original.s;self.m=original.m
        self.actor=self.owner;self.hashes={'synthetic-source':'a'*64};n=self.actor
        n.job=e._ABI;n.handles=[];n.source_case=f.CASES[1];self.arena.case=self.arena.case_origin=n.source_case
        n.source_normal=self.arena.reserve('engine-normal',256,0)
        n.source_final=self.arena.reserve('engine-final',0,9)
        n.source_escape_tickets=tuple(self.arena.reserve(name,0,1)for name in ('own-exit','deadline-exit','one-park'))
        n.source_safety=self.arena.reserve('engine-safety',0,4)
        n.source_finalizing=False;n.source_escapes=None;n.source_function_bindings=None
        self.effects=[]
        def reply(name,args):
            self.effects.append((name,args))
            if name=='GetCurrentProcess':return C.c_void_p(-1).value
            if name=='IsProcessInJob':args[2]._obj.value=1
            if name=='QueryInformationJobObject':
                v=args[2]._obj
                if args[1]==9:
                    v.basic.flags,v.basic.active_process_limit=e.LIMIT_FLAGS,1
                    v.process_memory_limit=v.job_memory_limit=e.MEMORY_BYTES
                else:v.total,v.active,v.terminated=1,1,0
            if name=='Sleep':return None
            return 1
        class Function:
            def __init__(self,name):self.name=name;self.argtypes=[];self.restype=C.c_int32
            def __call__(self,*args):return reply(self.name,args)
        names=('GetCurrentProcess','IsProcessInJob','QueryInformationJobObject','TerminateProcess','Sleep','CloseHandle')
        n.k=SimpleNamespace(**{name:Function(name)for name in names})
        n.source_function_bindings=tuple((getattr(n.k,name),(),C.c_int32)for name in names)
        n.source_functions=tuple(getattr(n.k,name)for name in names)
        self.arena.api_bindings=self.arena.api_origin=n.source_function_bindings
        n.source_process=n.call('source-current-process',n.k.GetCurrentProcess)
        n.source_escapes=e._SourceEscapes(n,self.arena,n.source_escape_tickets,self.arena.order[-1])
        n.callback=object();n.timer=17;n.due=C.c_int64(-1000);n.timer_configured=True
        n.source_escapes.bind_timer(n.callback,n.timer)
        e._child_readback(n);self.arena.capture_child_ready(self.hashes)
        backend=self.original.FakeSourceNative();self.backend=backend
        # One file spans an8MiB boundary. No file is created and no model loads.
        backend.payloads['model.safetensors']=b'x'*(f.READ_BYTES+128)
        class Dll:
            def __init__(self,name,**kwargs):
                self._name,self._handle=name,123
                backend.dll_calls.append((name,kwargs))
            def __getattr__(self,name):return backend.functions[name]
        for scope in (patch.object(C,'WinDLL',Dll),patch.object(C,'get_last_error',wraps=C.get_last_error)):
            scope.start();self.addCleanup(scope.stop)
        self.source=object.__new__(self.s._OriginalModelSources)
        self.addCleanup(lambda:self.s._SOURCE_CUSTODY.pop(id(self.source),None))
        self.addCleanup(lambda:self.s._SOURCE_RETIREMENTS.pop(id(self.source),None))
        self.port=f._source_execution(e,n,self.s,self.source,self.hashes)
        self.s._OriginalModelSources.__init__(self.source,backend.value(),_execution=self.port)

    def test_real_source_owner_uses_shared_physical_rows_and_exact_original_replies(self):
        source=self.source;source.prepare();source.assert_bound();source.retire_unused()
        self.assertTrue(source._retired)
        self.assertEqual(len(source._reads),5)
        self.assertTrue(all(row.completed for row in source._reads))
        self.assertTrue(all(row.retired for row in source._guards))
        self.assertTrue(all(row.closed for row in source._handles))
        self.assertEqual(len(source._calls),7*source._plan.ancestors+147)
        source_rows=[row for row in self.arena.order if row.binding[8]is not None]
        self.assertEqual(len(source_rows),len(source._calls))
        for row,original in zip(source_rows,source._calls):
            self.assertIs(row.binding[8],original);self.assertIs(row.completion[1],original.value)
            self.assertEqual(row.completion[2],original.error)
        self.assertEqual(sum(row.terminal for row in source_rows),source._plan.unused_close_calls)
        self.assertEqual(sum(len(t.rows)for t in self.arena.reservations if t.purpose=='source-normal'),source._plan.prepare_calls+source._plan.live_check_calls)
        before=len(self.arena.order)
        with self.assertRaises(self.m.OffloadAdmissionError):source.prepare()
        self.assertEqual(len(self.arena.order),before)

    def test_per_native_assertions_do_not_query_job_hash_files_or_import(self):
        with (patch.object(e,'_child_readback',side_effect=AssertionError('Hidden job IO')),
              patch.object(e,'_all_hashes',side_effect=AssertionError('Hidden hash IO')),
              patch.object(Path,'open',side_effect=AssertionError('Hidden file IO'))):
            self.source.prepare();self.source.assert_bound();self.source.retire_unused()

    def test_missing_job_proof_and_changed_original_output_deny_before_dll(self):
        member=self.arena.ready[5][0];member.value=0
        with self.assertRaises(self.m.OffloadAdmissionError):self.source.prepare()
        self.assertFalse(self.backend.dll_calls or self.backend.calls)

    def test_wrong_hash_retains_original_io_and_does_not_close_or_credit(self):
        self.backend.payloads['model.safetensors']=b'y'*(f.READ_BYTES+128)
        with self.assertRaises(self.m.OffloadAdmissionError):self.source.prepare()
        self.assertTrue(self.source._uncertain)
        self.assertIs(self.s._SOURCE_CUSTODY[id(self.source)].owner,self.source)
        self.assertTrue(self.source._reads)
        self.assertFalse(any(row.closed for row in self.source._handles))
        self.assertFalse(any(row.terminal for row in self.source._calls))
        self.assertEqual(self.owner.pending,None)
        f._assert_hash_denial(self.source,self.s,self.port)
        # A logical hash denial does not confiscate original engine final rows.
        self.owner.source_finalizing=True
        self.owner.call('synthetic-final-close',self.owner.k.CloseHandle,99)
        self.assertTrue(self.arena.order[-1].terminal)

    def test_partial_io_keeps_independent_source_and_shared_ledger_custody(self):
        def interrupt(name,args):
            if name=='NtReadFile':raise KeyboardInterrupt()
        self.backend.fault=interrupt
        with self.assertRaises(KeyboardInterrupt):self.source.prepare()
        record=self.source._pending
        self.assertIsNotNone(record);self.assertTrue(record.started);self.assertFalse(record.returned)
        row=next(row for row in self.arena.order if row.binding[8]is record)
        self.assertIs(self.owner.pending,row.payload);self.assertIsNotNone(row.binding)
        self.assertIsNone(row.completion);self.assertTrue(self.arena.fenced)
        self.assertTrue(self.s._SOURCE_CUSTODY[id(self.source)].read_origins)
        with self.assertRaises(f.SourceFixtureError):f._assert_hash_denial(self.source,self.s,self.port)

    def test_access_denied_cannot_be_counted_as_the_expected_hash_rejection(self):
        self.backend.functions['NtCreateFile']=lambda *args:0xc0000022
        with self.assertRaises(self.m.OffloadAdmissionError):self.source.prepare()
        with self.assertRaises(f.SourceFixtureError):f._assert_hash_denial(self.source,self.s,self.port)
        self.assertFalse(self.source._reads)

    def test_completed_call_with_failed_io_status_cannot_qualify_hash_rejection(self):
        self.backend.pending_read=True
        with self.assertRaises(self.m.OffloadAdmissionError):self.source.prepare()
        with self.assertRaises(f.SourceFixtureError):f._assert_hash_denial(self.source,self.s,self.port)
        self.assertFalse(self.source._reads[-1].completed)

    def test_wrong_hash_witness_rejects_tampered_completion_or_retired_guard(self):
        self.backend.payloads['model.safetensors']=b'y'*(f.READ_BYTES+128)
        with self.assertRaises(self.m.OffloadAdmissionError):self.source.prepare()
        f._assert_hash_denial(self.source,self.s,self.port)
        read=self.source._reads[-1];read.io.information-=1
        with self.assertRaises(f.SourceFixtureError):f._assert_hash_denial(self.source,self.s,self.port)
        read.io.information+=1;self.source._guards[-1].retired=True
        with self.assertRaises((f.SourceFixtureError,self.m.OffloadAdmissionError)):
            f._assert_hash_denial(self.source,self.s,self.port)

    def test_second_selected_check_is_denied_without_another_native_dispatch(self):
        self.source.prepare();self.source.assert_bound();before=len(self.backend.calls)
        with self.assertRaises(self.m.OffloadAdmissionError):self.source.assert_bound()
        self.assertEqual(len(self.backend.calls),before)

    def test_source_cannot_consume_the_engine_final_or_escape_tail(self):
        self.source.prepare()
        tickets=self.port.ticket.native
        mine={id(row)for row in tickets.normal.rows+tickets.terminal.rows}
        engine={id(row)for t in (self.owner.source_normal,self.owner.source_final,
            *self.owner.source_escape_tickets,self.owner.source_safety)for row in t.rows}
        self.assertFalse(mine&engine)
        self.assertLessEqual(sum(row.terminal for t in self.arena.reservations for row in t.rows),64)

    def test_terminal_starvation_denies_before_source_dll_and_retains_partial_reservation(self):
        self.arena.reserve('withheld-synthetic-tail',0,48)
        with self.assertRaises(self.m.OffloadAdmissionError):self.source.prepare()
        self.assertFalse(self.backend.calls or self.backend.dll_calls)
        self.assertTrue(any(t.purpose=='source-normal'for t in self.arena.reservations))
        self.assertTrue(any(type(v)is f._Allocation for v in self.owner.buffers))
        self.assertIsNone(self.source._api)

    def test_original_exit_is_one_attempt_without_a_fabricated_ack(self):
        self.owner.source_escapes.terminate_once(9)
        self.owner.source_escapes.terminate_once(9)
        rows=[row for row in self.arena.order if row.binding[6]=='escape']
        self.assertEqual(len(rows),1);self.assertFalse(rows[0].payload['acknowledged'])
        self.assertTrue(rows[0].payload['returned']);self.assertTrue(self.owner.uncertain)
        self.assertEqual([(name,args)for name,args in self.effects if name=='TerminateProcess'],
            [('TerminateProcess',(C.c_void_p(-1).value,9))])
        self.deny(lambda:self.arena.acknowledge(rows[0]))

    def test_foreign_timer_context_denies_and_original_timer_wins_only_once(self):
        escape=self.owner.source_escapes
        for args in ((None,None,17),(1,object(),17),(1,None,18)):
            self.deny(lambda:escape.terminate_once(2,timer_args=args))
        self.assertFalse(any(name=='TerminateProcess'for name,_ in self.effects))
        escape.terminate_once(2,timer_args=(1,None,17));escape.terminate_once(9)
        self.assertEqual(sum(name=='TerminateProcess'for name,_ in self.effects),1)

    def test_one_park_keeps_normal_pending_and_no_exit_credit(self):
        ticket=self.arena.reserve('synthetic-pending',1,0)
        pending=self.arena.begin(ticket,'synthetic-pending',lambda:None,(),())
        self.owner.source_escapes.park_once();self.owner.source_escapes.park_once()
        self.assertIs(self.owner.pending,pending.payload)
        self.assertEqual(sum(name=='Sleep'for name,_ in self.effects),1)
        self.assertFalse(self.arena.order[-1].payload['acknowledged'])


if __name__ == '__main__':unittest.main()
