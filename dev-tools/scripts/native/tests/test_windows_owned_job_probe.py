"""Pure fixed-job lifecycle tests: mocked APIs only, no child/job creation."""
import contextlib
import ctypes as C
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock,patch

SOURCE=Path(__file__).resolve().parents[1]/'probe_windows_owned_job.py'
spec=importlib.util.spec_from_file_location('owned_job_probe',SOURCE);j=importlib.util.module_from_spec(spec);spec.loader.exec_module(j)
p=j.p


class Native:
    def __init__(self):
        self.k=Mock();self.uncertain=False;self.closed=[];self.created=False;self.exited=False;self.code=259;self.member=True
        self.location=lambda executable:r'C:\Python314\python.exe' if executable else r'C:\Windows'
        self.inheritable=lambda handle:handle in (12,13)
        self.k.CreateJobObjectW.return_value=11;self.k.CreateEventW.side_effect=[12,13]
        self.k.SetInformationJobObject.return_value=1;self.k.UpdateProcThreadAttribute.return_value=1;self.k.ResumeThread.return_value=1
        self.k.GetProcessId.return_value=16
        def attributes(buffer,_count,_flags,size):C.cast(size,C.POINTER(C.c_size_t)).contents.value=256;return 0 if buffer is None else 1
        self.k.InitializeProcThreadAttributeList.side_effect=attributes
        self.k.CreateProcessW.side_effect=self.create
        self.k.QueryInformationJobObject.side_effect=self.query
        def membership(_process,_job,result):C.cast(result,C.POINTER(p.I32)).contents.value=int(self.member);return 1
        self.k.IsProcessInJob.side_effect=membership
        self.k.SetEvent.side_effect=lambda _h:self.end(23)
        self.k.TerminateJobObject.side_effect=lambda *_:self.end(j.FORCED_EXIT) if self.member else 1
        self.k.TerminateProcess.side_effect=lambda *_:self.end(j.FORCED_EXIT)

    def create(self,_image,_command,_ps,_ts,_inherit,_flags,_environment,_cwd,_startup,result):
        info=C.cast(result,C.POINTER(j.Process)).contents;info.process=14;info.thread=15;info.pid=16;info.tid=17;self.created=True;return 1

    def query(self,_job,kind,result,_size,_returned):
        if kind==9:
            info=C.cast(result,C.POINTER(j.m.ExtendedLimits)).contents;info.basic.flags=j.FLAGS;info.basic.active_process_limit=1
            info.process_memory_limit=info.job_memory_limit=j.MEMORY_BYTES;info.peak_process_memory=1000000;info.peak_job_memory=1100000
        else:
            info=C.cast(result,C.POINTER(j.Accounting)).contents;info.total=int(self.created);info.active=int(self.created and not self.exited)
        return 1

    def end(self,code):self.exited=True;self.code=code;return 1
    def wait(self,handle,_timeout):return self.exited if handle==14 else True
    def exit_code(self,_handle):return self.code
    def close(self,handle):
        self.closed.append(handle)
        if handle==11 and self.created:self.end(j.FORCED_EXIT)


class OwnedJobTests(unittest.TestCase):
    def error(self):return patch.object(j.C,'get_last_error',create=True,return_value=122)

    def test_default_plan_has_no_dll_owner_or_child_effect(self):
        for args in ([],['--plan']):
            with patch.object(j,'Windows') as native,patch.object(j,'Owner') as owner,contextlib.redirect_stdout(io.StringIO()) as output:self.assertEqual(j.main(args),0)
            value=json.loads(output.getvalue());self.assertFalse(value['native_effects']);self.assertFalse(value['model_started']);self.assertFalse(value['parent_qualification']);native.assert_not_called();owner.assert_not_called()

    def test_unknown_cli_paths_commands_pids_limits_and_mixed_modes_are_refused_without_echo(self):
        for args in (['--pid','123'],['--command','HIDDEN_VALUE'],['--root','HIDDEN_VALUE'],['--memory','99999999'],['--plan','--self-test']):
            with patch.object(j,'Windows') as native,patch.object(j,'Owner') as owner,contextlib.redirect_stderr(io.StringIO()) as output:
                with self.assertRaises(SystemExit):j.main(args)
            self.assertNotIn('HIDDEN_VALUE',output.getvalue());native.assert_not_called();owner.assert_not_called()

    def test_inert_limits_are_fixed_and_existing_two_gib_qualification_policy_is_untouched(self):
        self.assertEqual(j.FLAGS,0x2308);self.assertEqual(j.MEMORY_BYTES,512*1024**2);self.assertEqual(j.m.LIMIT_BYTES,2*1024**3);self.assertIsNone(j.m._job)
        self.assertTrue(j.plan()['ceilings_are_not_upfront_allocations']);self.assertFalse(j.plan()['actual_guardian_crash_tested']);self.assertFalse(j.plan()['staging_fence_ordering_tested'])

    @unittest.skipUnless(os.name=='nt','Windows SDK ABI reference only')
    def test_abi_shapes_match_x64_sdk(self):
        self.assertEqual((C.sizeof(j.m.BasicLimits),C.sizeof(j.m.ExtendedLimits),C.sizeof(j.Startup),C.sizeof(j.StartupEx),C.sizeof(j.Process),C.sizeof(j.Accounting)),(64,144,104,112,24,48))

    def test_environment_uses_only_supplied_os_path_and_never_inherits_provider_secrets(self):
        with patch.dict(os.environ,{'HF_TOKEN':'HIDDEN_VALUE','PATH':'untrusted','PYTHONPATH':'untrusted'}):value=j.isolated_environment(r'C:\Windows')
        self.assertEqual(value,{'SystemRoot':r'C:\Windows','WINDIR':r'C:\Windows','PATH':r'C:\Windows\System32;C:\Windows'})
        self.assertNotIn('HIDDEN_VALUE',json.dumps(value))

    def test_runtime_paths_refuse_relative_unc_parent_and_nul(self):
        for name in ['python.exe',r'\\server\share\python.exe',r'C:\folder\..\python.exe','C:\\bad\0name']:
            with self.assertRaises(p.ProbeError):j.windows_path(name)

    def test_worker_is_fixed_isolated_stdlib_program_with_two_numeric_event_arguments(self):
        args=j.worker_arguments(r'C:\Python314\python.exe',12,13)
        self.assertEqual(args,[r'C:\Python314\python.exe','-I','-S','-B','-c',j.WORKER,'12','13'])
        self.assertNotIn('torch',j.WORKER);self.assertNotIn('subprocess',j.WORKER)
        for ready,stop in [(True,13),(0,13),(12,12),('12',13),(2**64-1,13)]:
            with self.assertRaises(p.ProbeError):j.worker_arguments(r'C:\Python314\python.exe',ready,stop)
        with self.assertRaises(p.ProbeError):j.worker_arguments(r'C:\other.exe',12,13)

    def test_atomic_creation_uses_job_and_only_two_event_handles_before_resume(self):
        native=Native()
        with self.error():session=j.Session(native)
        calls=native.k.UpdateProcThreadAttribute.call_args_list;self.assertEqual([c.args[2] for c in calls],[0x2000d,0x20002])
        inherited=C.cast(calls[1].args[3],C.POINTER(p.PTR*2)).contents;self.assertEqual(list(inherited),[12,13]);self.assertNotIn(11,list(inherited))
        creation=native.k.CreateProcessW.call_args;self.assertTrue(creation.args[4]);self.assertEqual(creation.args[5],0x0008040c)
        self.assertEqual(creation.args[7],r'C:\Windows\System32');native.k.IsProcessInJob.assert_called_once();native.k.ResumeThread.assert_called_once_with(15)
        native.end(23)
        with self.error():self.assertTrue(session.cleanup())

    def test_event_only_worker_has_no_console_inheritance_or_hidden_console_fallback(self):
        native=Native()
        with self.error():session=j.Session(native)
        flags=native.k.CreateProcessW.call_args.args[5]
        self.assertEqual(flags&0x8,0x8)
        self.assertEqual(flags&(0x08000000|0x10|0x01000000),0)
        self.assertEqual(flags,0x0008040c)
        native.end(23)
        with self.error():self.assertTrue(session.cleanup())

    def test_wrong_limit_readback_denies_all_child_creation(self):
        native=Native();original=native.query
        def altered(*args):
            result=original(*args)
            if args[1]==9:C.cast(args[2],C.POINTER(j.m.ExtendedLimits)).contents.basic.flags|=0x800
            return result
        native.k.QueryInformationJobObject.side_effect=altered
        with self.error(),self.assertRaises(p.ProbeError):j.Session(native)
        native.k.CreateProcessW.assert_not_called();native.k.ResumeThread.assert_not_called()

    def test_missing_atomic_membership_never_resumes_and_stops_only_acknowledged_new_process(self):
        native=Native();native.member=False
        with self.error(),self.assertRaises(p.ProbeError):j.Session(native)
        native.k.ResumeThread.assert_not_called();native.k.TerminateProcess.assert_called_once_with(14,j.FORCED_EXIT);self.assertTrue(native.exited)

    def test_unknown_creation_interruption_keeps_all_buffers_and_never_mutates_partial_handles(self):
        native=Native();before=len(p._RETAINED);native.k.CreateProcessW.side_effect=KeyboardInterrupt()
        with self.error(),self.assertRaises(KeyboardInterrupt):j.Session(native)
        self.assertTrue(native.uncertain);self.assertGreater(len(p._RETAINED),before);native.k.ResumeThread.assert_not_called();native.k.TerminateProcess.assert_not_called();self.assertEqual(native.closed,[])
        native.k.DeleteProcThreadAttributeList.assert_not_called()

    def test_failed_creation_with_unclassified_partial_output_never_claims_custody(self):
        native=Native()
        def partial(*args):native.create(*args);return 0
        native.k.CreateProcessW.side_effect=partial
        with self.error(),self.assertRaises(p.ProbeError):j.Session(native)
        self.assertTrue(native.uncertain);native.k.ResumeThread.assert_not_called();native.k.TerminateProcess.assert_not_called();self.assertEqual(native.closed,[])

    def test_success_with_empty_output_is_unknown_not_proof_of_no_child(self):
        native=Native();native.k.CreateProcessW.side_effect=None;native.k.CreateProcessW.return_value=1
        with self.error(),self.assertRaises(p.ProbeError):j.Session(native)
        self.assertTrue(native.uncertain);self.assertEqual(native.closed,[]);native.k.ResumeThread.assert_not_called();native.k.DeleteProcThreadAttributeList.assert_not_called()

    def test_completed_failed_creation_with_zero_output_closes_only_known_setup_objects(self):
        native=Native();native.k.CreateProcessW.side_effect=None;native.k.CreateProcessW.return_value=0
        with self.error(),self.assertRaises(p.ProbeError):j.Session(native)
        self.assertFalse(native.uncertain);self.assertEqual(native.closed,[12,13,11]);native.k.ResumeThread.assert_not_called();native.k.TerminateProcess.assert_not_called()

    def test_job_handle_must_not_be_inherited(self):
        native=Native();native.inheritable=lambda _handle:True
        with self.error(),self.assertRaises(p.ProbeError):j.Session(native)
        native.k.CreateProcessW.assert_not_called();native.k.ResumeThread.assert_not_called()

    def test_events_must_be_explicitly_inheritable_before_process_creation(self):
        native=Native();native.inheritable=lambda _handle:False
        with self.error(),self.assertRaises(p.ProbeError):j.Session(native)
        native.k.CreateProcessW.assert_not_called();native.k.ResumeThread.assert_not_called()

    def test_duplicate_returned_handle_is_closed_at_most_once_and_never_used_for_launch(self):
        native=Native();native.k.CreateEventW.side_effect=[12,12]
        with self.error(),self.assertRaises(p.ProbeError):j.Session(native)
        self.assertEqual(native.closed.count(12),1);native.k.CreateProcessW.assert_not_called();native.k.ResumeThread.assert_not_called()

    def test_normal_event_stop_requires_actual_exit_code_active_zero_and_all_cleanup(self):
        native=Native()
        with self.error():row=j.run_case(native,j.CASES[0])
        self.assertEqual(row['status'],'observed');self.assertEqual(row['exit_code'],23);self.assertTrue(row['job_active_zero_observed']);self.assertTrue(row['cleanup_confirmed'])
        native.k.TerminateProcess.assert_not_called();native.k.TerminateJobObject.assert_not_called();self.assertEqual(native.closed,[15,14,12,13,11])

    def test_successful_accounting_records_four_fixed_phases_without_process_identity(self):
        with self.error():row=j.run_case(Native(),j.CASES[0])
        self.assertEqual([v['phase'] for v in row['job_accounting']],['suspended','ready','stopped','cleanup'])
        self.assertEqual([v['active'] for v in row['job_accounting']],[1,1,0,0])
        self.assertTrue(all(v['total']==1 and v['expected_total']==1 and v['terminated']==0 for v in row['job_accounting']))
        self.assertTrue(all(set(v)=={'phase','expected_total','total','active','terminated'} for v in row['job_accounting']))

    def test_accounting_projection_is_closed_typed_bounded_data_only(self):
        value=j.Accounting();value.total=0xffffffff;value.active=2;value.terminated=3
        self.assertEqual(j.accounting_fact(1,'ready',value),{'phase':'ready','expected_total':1,'total':0xffffffff,'active':2,'terminated':3})
        for expected,phase,data in [(True,'ready',value),(-1,'ready',value),(2**32,'ready',value),(1,True,value),(1,'HIDDEN_VALUE',value),(1,'ready',{'total':'HIDDEN_VALUE'})]:
            with self.assertRaises(p.ProbeError):j.accounting_fact(expected,phase,data)

    def test_failed_accounting_preserves_numbers_and_failure_even_after_process_cleanup(self):
        native=Native();original=native.query;reads=0
        def query(*args):
            nonlocal reads
            result=original(*args)
            if args[1]==1:
                reads+=1
                if reads>=2:
                    value=C.cast(args[2],C.POINTER(j.Accounting)).contents;value.total=2;value.active=0 if native.exited else 1;value.terminated=0
            return result
        native.k.QueryInformationJobObject.side_effect=query
        with self.error():row=j.run_case(native,j.CASES[0])
        self.assertEqual(row['status'],'failed');self.assertEqual(row['failure_stage'],'job-process-count');self.assertFalse(row['cleanup_confirmed'])
        self.assertEqual(row['job_accounting'][1],{'phase':'ready','expected_total':1,'total':2,'active':1,'terminated':0})
        self.assertEqual(row['job_accounting'][-1],{'phase':'cleanup','expected_total':1,'total':2,'active':0,'terminated':0})
        self.assertNotIn('ready_and_live_observed',row)

    def test_last_handle_close_is_followed_by_actual_process_exit_and_cleanup(self):
        native=Native()
        with self.error():row=j.run_case(native,j.CASES[1])
        self.assertEqual(row['status'],'observed');self.assertTrue(row['last_job_handle_closed']);self.assertTrue(row['native_process_exit_observed']);self.assertTrue(row['cleanup_confirmed'])
        self.assertEqual(native.closed,[15,11,14,12,13]);native.k.TerminateProcess.assert_not_called()

    def test_independent_worker_exit_cannot_qualify_job_close_even_with_confirmed_cleanup(self):
        self.assertGreater(j.WORKER_TIMEOUT_MS,1000*(p.NATIVE_SECONDS+p.REPORT_SECONDS+1))
        for code in (23,75,76,77):
            with self.subTest(code=code):
                native=Native();original_close=native.close
                def close(handle):
                    if handle==11:
                        native.closed.append(handle);native.end(code)  # Independent exit; job close has no effect.
                    else:original_close(handle)
                native.close=close
                with self.error():row=j.run_case(native,j.CASES[1])
                self.assertEqual(row['status'],'failed');self.assertEqual(row['failure_stage'],'worker-exit-code');self.assertTrue(row['cleanup_confirmed'])
                native.k.TerminateProcess.assert_not_called();native.k.TerminateJobObject.assert_not_called()

    def test_stop_request_without_exit_cannot_pass_even_when_failure_cleanup_succeeds(self):
        native=Native();native.k.SetEvent.side_effect=lambda _h:1
        with self.error():row=j.run_case(native,j.CASES[0])
        self.assertEqual(row['status'],'failed');self.assertEqual(row['failure_stage'],'worker-exit-timeout');self.assertTrue(row['cleanup_confirmed']);native.k.TerminateJobObject.assert_called_once_with(11,j.FORCED_EXIT)

    def test_uncertain_lifetime_prevents_every_cleanup_effect(self):
        native=Native()
        with self.error():session=j.Session(native)
        native.closed.clear();native.uncertain=True
        self.assertFalse(session.cleanup());self.assertEqual(native.closed,[]);native.k.TerminateJobObject.assert_not_called();native.k.TerminateProcess.assert_not_called()

    def test_interrupted_handle_close_prevents_retry_or_followup_native_effects(self):
        native=Native()
        with self.error():session=j.Session(native)
        native.close=Mock(side_effect=KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):session.close('job')
        self.assertTrue(native.uncertain);self.assertFalse(session.cleanup());native.close.assert_called_once_with(11)

    def test_unknown_wait_is_uncertain_not_timeout_or_success(self):
        native=j.Windows.__new__(j.Windows);native.k=Mock();native.uncertain=False;native.k.WaitForSingleObject.return_value=0xffffffff
        with self.error(),self.assertRaises(p.ProbeError):native.wait(14,0)
        self.assertTrue(native.uncertain)

    def test_reports_are_bounded_fixed_schema_and_never_claim_broader_authority(self):
        owner=j.Owner();value=json.loads(owner.encode({'HIDDEN_VALUE':'x'*9000}));self.assertEqual(value['schema'],j.SCHEMA);self.assertNotIn('HIDDEN_VALUE',json.dumps(value))
        for key in ['model_started','real_app_worker_started','restart_admitted','parent_qualification','actual_guardian_crash_tested','staging_fence_ordering_tested']:self.assertFalse(value[key])

    def test_all_cases_and_cleanup_required_unknown_errors_are_redacted(self):
        with patch.object(j,'Windows'),patch.object(j,'run_case',side_effect=lambda _n,name:{'case':name,'status':'observed','cleanup_confirmed':True,'synthetic_worker_resumed':True}):value=j.self_test()
        self.assertTrue(value['all_cases_observed']);self.assertTrue(value['synthetic_worker_start_observed']);self.assertFalse(value['parent_qualification'])
        with patch.object(j,'Windows',side_effect=RuntimeError('HIDDEN_VALUE')):value=j.self_test()
        self.assertNotIn('HIDDEN_VALUE',json.dumps(value));self.assertFalse(value['all_cases_observed'])


if __name__=='__main__':unittest.main()
