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
        if case in (f.CASES[1],f.CASES[3]):
            v.update(source_prepared=True,exact_hashes_confirmed=True,source_reads_completed=True,
                source_guards_retired=True,source_handles_closed=True,source_retired=True,
                source_native_calls=168,source_terminal_calls=24,source_closed_handles=12)
        else:v.update(hash_denial_observed=True,original_custody_retained=True,source_native_calls=88)
        if case==f.CASES[3]:
            v.update(**{n:True for n in f._READER_FLAGS},reader_reserved_normal=16,
                reader_native_calls=12,reader_terminal_calls=3,reader_closed_objects=3,
                private_view_bytes=f.VIEW_BYTES,private_view_commit_bytes=f.VIEW_BYTES)
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
        n.job=e._ABI;n.handles=[];n.source_reader=None
        n.source_case=getattr(self,'source_case',f.CASES[1]);self.arena.case=self.arena.case_origin=n.source_case
        n.source_normal=self.arena.reserve('engine-normal',256,0)
        n.source_final=self.arena.reserve('engine-final',0,9)
        n.source_escape_tickets=tuple(self.arena.reserve(name,0,1)for name in ('own-exit','deadline-exit','one-park'))
        n.source_safety=self.arena.reserve('engine-safety',0,4)
        n.source_finalizing=False;n.source_escapes=None;n.source_function_bindings=None
        self.effects=[]
        def reply(name,args):
            self.effects.append((name,args))
            if hasattr(self,'reader_reply')and name not in ('GetCurrentProcess','IsProcessInJob',
                    'QueryInformationJobObject','TerminateProcess','Sleep'):
                return self.reader_reply(name,args)
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
        names=('GetCurrentProcess','IsProcessInJob','QueryInformationJobObject','TerminateProcess','Sleep','CloseHandle')+getattr(self,'reader_names',())
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
        backend.payloads['model.safetensors']=getattr(self,'model_byte',b'x')*(f.READ_BYTES+128)
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


class ReaderGraphTests(unittest.TestCase):
    source_case=f.CASES[3]
    model_byte=b'\0'
    reader_names=('WaitForSingleObject','CreateFileW','GetHandleInformation','GetFileType',
        'GetFileInformationByHandleEx','GetFileSizeEx','CreateFileMappingW','MapViewOfFile',
        'UnmapViewOfFile')
    def setUp(self):
        self.view_buffer=(C.c_ubyte*f.VIEW_BYTES)()
        self.fault=None
        SourceProducerTests.setUp(self)
    def reader_reply(self,name,args):
        if self.fault:
            override=self.fault(name,args)
            if override is not None:return override
        if name=='WaitForSingleObject':return 258
        if name=='CreateFileW':
            self.assertEqual(args[0],str(self.source._inventory.root/'model.safetensors'))
            self.assertEqual(args[3:],(None,3,0x00200080,None))
            if args[1]==0x80000000:
                self.assertEqual(args[2],1);return 501
            self.assertEqual(args[1:3],(0x40000000,7))
            C.set_last_error(32);return C.c_void_p(-1).value
        if name=='GetHandleInformation':args[1]._obj.value=0;return 1
        if name=='GetFileType':return 1
        if name=='GetFileInformationByHandleEx':
            self.assertEqual(args[0],501)
            if args[1]==9:args[2]._obj[0]=0x80
            else:
                self.assertEqual(args[1],18)
                C.memmove(args[2],self.source._files[1][1][0],24)
            return 1
        if name=='GetFileSizeEx':args[1]._obj.value=self.source._files[1][4];return 1
        if name=='CreateFileMappingW':self.assertEqual(args,(501,None,8,0,0,None));return 502
        if name=='MapViewOfFile':self.assertEqual(args,(502,1,0,0,65536));return C.addressof(self.view_buffer)
        if name in ('UnmapViewOfFile','CloseHandle'):return 1
        raise AssertionError('Unexpected reader operation')
    def make(self):
        graph=f._ReaderGraph(e,self.actor,self.s,self.source,self.port,self.hashes)
        self.assertFalse(self.backend.calls or self.backend.dll_calls)
        self.source.prepare()
        return graph
    def view_ready(self):
        graph=self.make();graph.bind_source()
        for label in graph._NORMAL[:-1]:graph._step(label)
        return graph
    def test_actual_reader_dispatch_uses_its16_rows_and_existing_three_terminal_rows(self):
        graph=self.make();before=len(self.actor.source_normal.rows)
        with (patch.object(Path,'open',side_effect=AssertionError('Hidden IO')),
              patch.object(e,'_all_hashes',side_effect=AssertionError('Hidden hash')),
              patch.object(e,'_child_readback',side_effect=AssertionError('Hidden Job query'))):
            graph.exercise()
        self.assertTrue(graph.retired and graph.changed)
        self.assertEqual(self.view_buffer[112],1)
        self.assertEqual(self.backend.payloads['model.safetensors'][112],0)
        self.assertEqual(len(graph.records),15)
        self.assertEqual(sum(r.binding is not None for r in graph.normal.rows),12)
        self.assertEqual(sum(r.binding is not None for r in graph.safety.rows),3)
        self.assertEqual(len(self.actor.source_normal.rows),before)
        self.assertEqual([r.binding[1]for r in graph.records],
            ['reader-'+label for label in graph._NORMAL+graph._TERMINAL])
        self.assertEqual([(name,args)for name,args in self.effects if name in ('UnmapViewOfFile','CloseHandle')],
            [('UnmapViewOfFile',(C.addressof(self.view_buffer),)),('CloseHandle',(502,)),('CloseHandle',(501,))])
        self.assertTrue(all(r.payload['acknowledged']for r in graph.records))
        self.source.assert_bound();self.source.retire_unused()
        self.assertTrue(self.source._retired)
    def test_constructor_reserves_before_source_dll_and_cannot_be_repeated_or_transferred(self):
        graph=self.make()
        mine={id(r)for r in graph.normal.rows}
        self.assertFalse(mine&{id(r)for r in self.actor.source_normal.rows})
        self.assertIs(graph.safety,self.actor.source_safety)
        self.assertLessEqual(sum(r.terminal for t in self.arena.reservations for r in t.rows),64)
        for operation in (lambda:copy.copy(graph),lambda:copy.deepcopy(graph),lambda:pickle.dumps(graph),
            lambda:f._ReaderGraph(e,self.actor,self.s,self.source,self.port,self.hashes)):
            with self.assertRaises(f.SourceFixtureError):operation()
        self.assertFalse(graph.records)
    def test_wrong_case_and_missing_job_proof_deny_without_reader_or_source_effects(self):
        self.actor.source_case=f.CASES[1]
        with self.assertRaises(f.SourceFixtureError):
            f._ReaderGraph(e,self.actor,self.s,self.source,self.port,self.hashes)
        self.assertFalse(self.backend.calls or self.backend.dll_calls)
    def test_original_source_file_output_identity_and_size_must_match(self):
        graph=self.make()
        def wrong(name,args):
            if name=='GetFileInformationByHandleEx'and args[1]==18:
                C.memset(args[2],7,24);return 1
        self.fault=wrong
        with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertTrue(graph.failed and self.source._uncertain)
        self.assertEqual(len(graph.records),6)
        self.assertFalse(graph.reader.retired)
        self.assertFalse(any(n=='MapViewOfFile'for n,_ in self.effects))
    def test_size_mismatch_stops_before_writer_or_mapping(self):
        graph=self.make()
        def wrong(name,args):
            if name=='GetFileSizeEx':args[1]._obj.value=1;return 1
        self.fault=wrong
        with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertEqual(len(graph.records),7)
        self.assertFalse(graph.writer.row or graph.section.row)
    def test_unexpected_writer_handle_is_kept_and_source_cleanup_is_denied(self):
        graph=self.make()
        self.fault=lambda name,args:703 if name=='CreateFileW'and args[1]==0x40000000 else None
        with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertEqual(graph.writer.slot.value,703)
        self.assertEqual(graph.writer.completion[1],703)
        self.assertIs(graph.writer.completion,self.arena.completions[graph.writer.row.index])
        self.assertFalse(graph.writer.row.payload['acknowledged'])
        self.assertFalse(graph.section.row or graph.view.row or graph.retired)
        with self.assertRaises(self.m.OffloadAdmissionError):self.source.retire_unused()
        self.assertFalse(any(n.closed for n in self.source._handles))
    def test_wrong_writer_error_is_not_the_expected_sharing_violation(self):
        graph=self.make()
        def denied(name,args):
            if name=='CreateFileW'and args[1]==0x40000000:
                C.set_last_error(5);return C.c_void_p(-1).value
        self.fault=denied
        with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertEqual(graph.writer.completion[2],5)
        self.assertFalse(graph.writer.row.payload['acknowledged'])
    def test_null_view_is_retained_without_any_memory_dereference(self):
        graph=self.make()
        self.fault=lambda name,args:0 if name=='MapViewOfFile'else None
        with patch.object(graph,'private_copy',side_effect=AssertionError('No dereference')):
            with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertEqual(graph.view.completion[1],0)
        self.assertFalse(graph.view.retired or graph.changed)
    def test_replaced_pointer_slot_and_generation_deny_before_touch(self):
        graph=self.view_ready();original=graph.view.slot
        graph.view.slot=C.c_void_p(C.addressof(self.view_buffer))
        with self.assertRaises(f.SourceFixtureError):graph.private_copy()
        graph.view.slot=original;generation=graph.view.generation;graph.view.generation=object()
        with self.assertRaises(f.SourceFixtureError):graph.private_copy()
        graph.view.generation=generation;original.value+=1
        with self.assertRaises(f.SourceFixtureError):graph.private_copy()
        self.assertEqual(self.view_buffer[112],0)

    def test_copied_or_rebound_map_intent_and_completion_deny_before_byte_access(self):
        graph=self.view_ready();row=graph.view.row
        binding=row.binding;row.binding=tuple(list(binding))
        with self.assertRaises(f.SourceFixtureError):graph.private_copy()
        self.assertIs(row.completion[0],binding)
        self.assertEqual(self.view_buffer[112],0)
        row.binding=binding;completion=row.completion;row.completion=tuple(list(completion))
        with self.assertRaises(f.SourceFixtureError):graph.private_copy()
        row.completion=completion;row.payload['result']=None
        with self.assertRaises(f.SourceFixtureError):graph.private_copy()
        self.assertEqual(self.view_buffer[112],0)
    def test_nonoverflowing_original_map_result_is_required_before_any_byte_access(self):
        graph=self.make()
        self.fault=lambda name,args:C.c_void_p(-1).value-4 if name=='MapViewOfFile'else None
        with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertFalse(graph.changed)
        self.assertEqual(self.view_buffer[112],0)
        self.assertTrue(graph.view.completion)
    def test_bad_observation_retains_known_original_map_return_without_ack(self):
        graph=self.make()
        def changed(name,args):
            if name=='MapViewOfFile':
                self.actor.pending['stage']='changed'
                return C.addressof(self.view_buffer)
        self.fault=changed
        with self.assertRaises(e.FixtureError):graph.exercise()
        self.assertEqual(graph.view.slot.value,C.addressof(self.view_buffer))
        self.assertIs(graph.view.completion,self.arena.completions[graph.view.row.index])
        self.assertFalse(graph.view.row.payload['acknowledged'])
    def test_inflight_interruption_retains_original_pending_graph_without_following_closes(self):
        graph=self.make()
        def interrupted(name,args):
            if name=='CreateFileMappingW':raise KeyboardInterrupt()
        self.fault=interrupted
        with self.assertRaises(KeyboardInterrupt):graph.exercise()
        self.assertIs(self.actor.pending,graph.section.row.payload)
        self.assertIsNone(graph.section.completion)
        self.assertFalse(graph.section.retired or graph.reader.retired)
        self.assertFalse(any(n in ('UnmapViewOfFile','CloseHandle')for n,_ in self.effects))
    def test_order_and_replay_denial_and_no_dereference_after_unmap(self):
        graph=self.view_ready()
        with self.assertRaises(f.SourceFixtureError):graph._step('reader-close')
        graph.private_copy();graph._step('guard-after');graph._step('view-unmap')
        with self.assertRaises(f.SourceFixtureError):graph._view_address()
        with self.assertRaises(f.SourceFixtureError):graph._step('view-unmap')
        graph._step('section-close');graph._step('reader-close')
        with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertEqual(sum(r.terminal for r in graph.records),3)
    def test_failed_unmap_stops_all_following_cleanup_and_retains_original_address(self):
        graph=self.make()
        self.fault=lambda name,args:0 if name=='UnmapViewOfFile'else None
        with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertTrue(graph.view.closing)
        self.assertFalse(graph.view.retired or graph.section.closing or graph.reader.closing)
        self.assertEqual(graph.view.slot.value,C.addressof(self.view_buffer))
        self.assertEqual(sum(r.terminal for r in graph.records),1)
    def test_original_function_binding_and_file_graph_drift_deny_without_dispatch(self):
        graph=self.make();graph.bind_source();before=len(self.effects)
        self.actor.k.MapViewOfFile=lambda *args:0
        with self.assertRaises(f.SourceFixtureError):graph._step('guard-before')
        self.assertEqual(len(self.effects),before)

    def test_rebound_source_file_graph_and_job_fact_deny_before_reader_open(self):
        graph=self.make();graph.bind_source();before=len(self.effects)
        files=self.source._files;self.source._files=tuple(list(files))
        with self.assertRaises((f.SourceFixtureError,self.m.OffloadAdmissionError)):graph._step('guard-before')
        self.source._files=files;self.arena.ready[5][0].value=0
        with self.assertRaises(e.FixtureError):graph._step('guard-before')
        self.assertEqual(len(self.effects),before)

    def test_failed_section_close_stops_before_reader_close(self):
        graph=self.make()
        self.fault=lambda name,args:0 if name=='CloseHandle'and args==(502,)else None
        with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertTrue(graph.view.retired and graph.section.closing)
        self.assertFalse(graph.section.retired or graph.reader.closing or graph.retired)
        self.assertEqual(sum(r.terminal for r in graph.records),2)

    def test_failed_reader_close_is_not_retirement_even_after_other_two_acknowledge(self):
        graph=self.make()
        self.fault=lambda name,args:0 if name=='CloseHandle'and args==(501,)else None
        with self.assertRaises(f.SourceFixtureError):graph.exercise()
        self.assertTrue(graph.view.retired and graph.section.retired and graph.reader.closing)
        self.assertFalse(graph.reader.retired or graph.retired)
        self.assertFalse(graph.records[-1].payload['acknowledged'])

    def test_read_handle_type_attributes_and_inheritance_denials_stop_before_mapping(self):
        # Separate fresh in-memory owners keep each failed history intact.
        for denial in ('inheritance','non-disk','reparse'):
            trial=ReaderGraphTests();trial.setUp()
            try:
                graph=trial.make()
                def fault(name,args):
                    if denial=='inheritance'and name=='GetHandleInformation':
                        args[1]._obj.value=1;return 1
                    if denial=='non-disk'and name=='GetFileType':return 2
                    if denial=='reparse'and name=='GetFileInformationByHandleEx'and args[1]==9:
                        args[2]._obj[0]=0x400;return 1
                trial.fault=fault
                with self.subTest(denial=denial),self.assertRaises(f.SourceFixtureError):graph.exercise()
                self.assertFalse(graph.section.row or graph.view.row)
            finally:trial.doCleanups()

    def test_final_byte_verification_failure_retains_completed_progress_without_source_retirement(self):
        initial=self.s._OriginalModelSources.__init__
        def construct(source,*args,**kwargs):
            initial(source,*args,**kwargs);self.source=source
        value=f.base_report(f.CASES[3],'a'*64,time.monotonic_ns())
        with(patch.object(self.s._OriginalModelSources,'__init__',construct),
             patch.object(e,'_child_readback'),patch.object(e,'_all_hashes',return_value=self.hashes),
             patch.object(e,'_private_core_package',return_value={'windows_offload_sources':self.s,'local_model_offload':self.m}),
             patch.object(f,'_synthetic_inputs',return_value=(self.backend.value(),object())),
             patch.object(f,'_verify_fresh_inputs',side_effect=f.SourceFixtureError('source-fresh-content'))):
            with self.assertRaises(f.SourceFixtureError)as caught:
                f.exercise(e,self.actor,f.CASES[3],self.hashes,object(),value)
        self.assertEqual(caught.exception.stage,'source-fresh-content')
        self.assertTrue(value['source_prepared']and value['exact_hashes_confirmed']and value['source_reads_completed'])
        self.assertTrue(value['shared_rows_reserved'])
        self.assertTrue(all(value[n]for n in f._READER_FLAGS if n!='source_bytes_unchanged'))
        self.assertEqual((value['reader_native_calls'],value['reader_terminal_calls'],value['reader_closed_objects']),(12,3,3))
        self.assertGreater(value['source_native_calls'],0)
        self.assertGreater(value['source_reserved_normal'],0)
        self.assertFalse(value['source_bytes_unchanged']or value['source_retired']or value['source_handles_closed'])
        self.assertFalse(self.source._retired)
        self.assertFalse(any(n.closed for n in self.source._handles))
        self.assertFalse(any(n=='CancelIoEx'for n,_ in self.backend.calls))
        with self.assertRaises(f.SourceFixtureError):f.validate_child_report(value,f.CASES[3],'a'*64)


class FreshInputVerificationTests(unittest.TestCase):
    def setUp(self):
        self.current=None;self.opened=[]
        outer=self
        class Stream(io.BytesIO):
            def fileno(self):return 42
        class File:
            def __init__(self,name,data,directory=False):
                self.name,self.data,self.link=name,data,False
                self.info=SimpleNamespace(st_mode=0o040000 if directory else 0o100000,
                    st_file_attributes=0,st_nlink=1,st_dev=1,st_ino=len(outer.files)+1,
                    st_size=len(data),st_mtime_ns=10,st_ctime_ns=11,st_birthtime_ns=11)
            def lstat(self):return self.info
            def is_symlink(self):return self.link
            def __truediv__(self,name):return outer.files[name]
            def open(self,mode):
                outer.opened.append(self.name);outer.current=self.info
                self.assert_mode=mode
                return Stream(self.data)
        self.files={}
        for name in ('config.json','model.safetensors','tokenizer.json','tokenizer_config.json'):
            self.files[name]=File(name,b'synthetic-'+name.encode())
        self.root=File('root',b'',True)
        self.inventory=SimpleNamespace(root=self.root,bindings=tuple((n,len(p.data),
            __import__('hashlib').sha256(p.data).hexdigest())for n,p in self.files.items()))
        self.facts=(f._fresh_facts(self.root,True),tuple((n,f._fresh_facts(p))for n,p in self.files.items()))
        scope=patch.object(f.os,'fstat',side_effect=lambda fd:self.current)
        scope.start();self.addCleanup(scope.stop)
    def test_only_the_four_exact_original_fresh_files_are_opened_and_hashes_match(self):
        f._verify_fresh_inputs(self.inventory,self.facts)
        self.assertEqual(self.opened,list(self.files))
    def test_changed_hash_and_changed_identity_do_not_qualify_unchanged_bytes(self):
        self.files['config.json'].data=b'X'*len(self.files['config.json'].data)
        with self.assertRaises(f.SourceFixtureError):f._verify_fresh_inputs(self.inventory,self.facts)
        self.files['config.json'].info.st_ino+=1;self.opened.clear()
        with self.assertRaises(f.SourceFixtureError):f._verify_fresh_inputs(self.inventory,self.facts)
        self.assertFalse(self.opened)
    def test_link_reparse_multiple_link_and_nonregular_inputs_deny_before_open(self):
        file=self.files['config.json']
        for field,value in (('link',True),('st_file_attributes',0x400),('st_nlink',2),('st_mode',0o040000)):
            target=file if field=='link'else file.info;old=getattr(target,field);setattr(target,field,value)
            with self.subTest(field=field),self.assertRaises(f.SourceFixtureError):
                f._verify_fresh_inputs(self.inventory,self.facts)
            setattr(target,field,old)
        self.assertFalse(self.opened)
    def test_opened_file_identity_mismatch_denies_before_read(self):
        info=SimpleNamespace(**vars(self.files['config.json'].info));info.st_ino=999
        with patch.object(f.os,'fstat',return_value=info):
            with self.assertRaises(f.SourceFixtureError):f._verify_fresh_inputs(self.inventory,self.facts)
        self.assertEqual(self.opened,['config.json'])
    def test_swapped_root_or_unapproved_leaf_is_not_followed(self):
        self.root.info.st_ino+=1
        with self.assertRaises(f.SourceFixtureError):f._verify_fresh_inputs(self.inventory,self.facts)
        self.assertFalse(self.opened)
        self.root.info.st_ino-=1
        self.inventory.bindings=(('../unknown',1,'a'*64),)+self.inventory.bindings[1:]
        with self.assertRaises(f.SourceFixtureError):f._verify_fresh_inputs(self.inventory,self.facts)
        self.assertFalse(self.opened)

    def test_windows_named_and_held_ctime_discrepancy_preserves_explicit_creation_identity(self):
        def windows_fstat(fd):
            info=SimpleNamespace(**vars(self.current));info.st_ctime_ns=777
            return info
        with patch.object(f.os,'fstat',side_effect=windows_fstat):
            f._verify_fresh_inputs(self.inventory,self.facts)
        self.assertEqual(self.opened,list(self.files))
        self.assertEqual(self.facts[1][0][1][-1],11)

    def test_missing_malformed_or_changed_creation_time_still_denies(self):
        file=self.files['config.json'];original=file.info.st_birthtime_ns
        for bad in (None,True,0,'synthetic-private',original+1):
            file.info.st_birthtime_ns=bad
            with self.subTest(bad=bad),self.assertRaises(f.SourceFixtureError)as caught:
                f._verify_fresh_inputs(self.inventory,self.facts)
            self.assertEqual(caught.exception.stage,'source-fresh-identity')
        del file.info.st_birthtime_ns
        with self.assertRaises(f.SourceFixtureError):f._verify_fresh_inputs(self.inventory,self.facts)
        self.assertFalse(self.opened)

    def test_held_hardlink_or_reparse_is_denied_before_content_read(self):
        class NoRead(io.BytesIO):
            def fileno(self):return 42
            def read(self,*args):raise AssertionError('Invalid held file must not be read')
        file=self.files['config.json']
        for field,value in(('st_nlink',2),('st_file_attributes',0x400),('st_mode',0o040000)):
            info=SimpleNamespace(**vars(file.info));setattr(info,field,value)
            with(patch.object(file,'open',return_value=NoRead(file.data)),patch.object(f.os,'fstat',return_value=info)):
                with self.subTest(field=field),self.assertRaises(f.SourceFixtureError)as caught:
                    f._verify_fresh_inputs(self.inventory,self.facts)
            self.assertEqual(caught.exception.stage,'source-fresh-open-identity')

    def test_modification_or_creation_drift_during_read_denies_before_next_file(self):
        for field in('st_mtime_ns','st_birthtime_ns'):
            calls=0;self.opened.clear()
            def drift(fd):
                nonlocal calls
                calls+=1;info=SimpleNamespace(**vars(self.current))
                if calls==2:setattr(info,field,getattr(info,field)+1)
                return info
            with patch.object(f.os,'fstat',side_effect=drift):
                with self.subTest(field=field),self.assertRaises(f.SourceFixtureError)as caught:
                    f._verify_fresh_inputs(self.inventory,self.facts)
            self.assertEqual(caught.exception.stage,'source-fresh-after-read')
            self.assertEqual(self.opened,['config.json'])

    def test_content_failure_and_file_exception_report_specific_safe_stages(self):
        file=self.files['config.json'];file.data=b'X'*len(file.data)
        with self.assertRaises(f.SourceFixtureError)as caught:f._verify_fresh_inputs(self.inventory,self.facts)
        self.assertEqual(caught.exception.stage,'source-fresh-content')
        with patch.object(file,'open',side_effect=OSError('synthetic-private')):
            with self.assertRaises(f.SourceFixtureError)as caught:f._verify_fresh_inputs(self.inventory,self.facts)
        self.assertEqual(caught.exception.stage,'source-fresh-content')
        self.assertNotIn('synthetic-private',str(caught.exception))


class ReaderReportTests(unittest.TestCase):
    def test_every_reader_flag_and_count_is_required_only_for_the_reader_case(self):
        factory=SourceReportsTests()
        for name in f._READER_FLAGS+f._READER_COUNTS:
            good=factory.value(f.CASES[3]);good[name]=False if name in f._READER_FLAGS else good[name]-1
            with self.subTest(name=name),self.assertRaises(f.SourceFixtureError):
                f.validate_child_report(good,f.CASES[3],'a'*64)
            for case in f.CASES[:3]:
                old=factory.value(case);old[name]=True if name in f._READER_FLAGS else 1
                with self.subTest(case=case,name=name),self.assertRaises(f.SourceFixtureError):
                    f.validate_child_report(old,case,'a'*64)
    def test_private_copy_commit_charges_full_view_and_not_changed_byte(self):
        value=SourceReportsTests().value(f.CASES[3]);value['private_view_commit_bytes']=1
        with self.assertRaises(f.SourceFixtureError):f.validate_child_report(value,f.CASES[3],'a'*64)
    def test_legacy_v1_evidence_cannot_be_relabelled_as_current_reader_evidence(self):
        value=SourceReportsTests().value(f.CASES[3]);value['schema_version']='windows-offload-sources-native-v1'
        with self.assertRaises(f.SourceFixtureError):f.validate_child_report(value,f.CASES[3],'a'*64)


if __name__ == '__main__':unittest.main()
