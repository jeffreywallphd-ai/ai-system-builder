"""Pure diagnostic safety checks; no native APIs, permission changes or models."""
import contextlib
import ctypes
import importlib.util
import io
import json
from pathlib import Path
import struct
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

SOURCE=Path(__file__).resolve().parents[1]/'probe_windows_staging_protection.py'
spec=importlib.util.spec_from_file_location('staging_protection_probe',SOURCE)
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
WORLD=b'\x01\x01\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00'
ACL=struct.pack('<BBHHH',2,0,8,0,0)


class ProbeTests(unittest.TestCase):
    def test_transfer_count_is_unavailable_until_a_successful_query(self):
        lock=self.lock();lock.output=p.OplockOutput(1,24,3,1,1,0,0)
        self.assertIsNone(lock.frame()['transferred_bytes'])
        lock.native.k.WaitForSingleObject.return_value=0;lock.native.k.GetOverlappedResult.return_value=0
        with patch.object(p.C,'get_last_error',create=True,return_value=995):
            with self.assertRaises(p.ProbeError) as caught:lock.completed_break()
        self.assertIsNone(caught.exception.frame['transferred_bytes'])
        def completed(_h,_ov,count,_wait):ctypes.cast(count,ctypes.POINTER(p.U32)).contents.value=24;return 1
        lock.native.k.GetOverlappedResult.side_effect=completed
        lock.completed_break();self.assertEqual(lock.frame()['transferred_bytes'],24)

    def test_only_unmeasured_transfer_count_can_be_null_in_closed_frame(self):
        frame={'structure_version':1,'structure_length':24,'original_level':0,'new_level':0,'flags':4,'transferred_bytes':None,'native_status':0x8000002e}
        self.assertEqual(p.ProbeError('rejected-frame',frame=frame).frame,frame)
        for key in frame:
            if key!='transferred_bytes':self.assertIsNone(p.ProbeError('rejected-frame',frame={**frame,key:None}).frame)
        for bad in (True,-1,2**32,'private-value'):
            self.assertIsNone(p.ProbeError('rejected-frame',frame={**frame,'transferred_bytes':bad}).frame)

    def test_shared_owner_hooks_preserve_directory_failure_schema(self):
        owner=p.DiagnosticOwner();value=owner.failure_report('native-deadline')
        self.assertEqual(value,p.failed_report('native-deadline'))
        self.assertEqual(owner.encode(value),p.encode_report(value))

    def test_rejected_oplock_keeps_native_frame_before_event_retirement(self):
        native=Mock();native.uncertain=False;native.k.CreateEventW.return_value=31
        def rejected(_h,_code,_in,_insize,out,_size,_bytes,overlapped):
            frame=ctypes.cast(out,ctypes.POINTER(p.OplockOutput)).contents
            frame.version=1;frame.length=24;frame.flags=4
            ctypes.cast(overlapped,ctypes.POINTER(p.Overlapped)).contents.internal=0x8000002e
            return 0
        native.k.DeviceIoControl.side_effect=rejected
        with patch.object(p.C,'get_last_error',create=True,return_value=801):
            with self.assertRaises(p.ProbeError) as caught:p.Oplock(native,21)
        self.assertEqual(caught.exception.frame['native_status'],0x8000002e)
        self.assertEqual(caught.exception.frame['flags'],4);self.assertIsNone(caught.exception.frame['transferred_bytes']);native.close.assert_called_once_with(31)

    def test_default_and_explicit_plan_have_no_native_or_fixture_effect(self):
        for argv in ([],['--plan']):
            with self.subTest(argv=argv),patch.object(p,'Windows') as native,patch.object(p,'self_test') as run,contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(p.main(argv),0)
                result=json.loads(out.getvalue());self.assertFalse(result['native_effects']);self.assertFalse(result['restart_admitted'])
                self.assertFalse(result['parent_qualification']);self.assertFalse(result['retained_data_accessed']);self.assertEqual(result['cases'],list(p.CASES))
                native.assert_not_called();run.assert_not_called()

    def test_cli_refuses_paths_commands_credentials_and_combined_modes_before_effect(self):
        for argv in (['--root','other'],['--pid','1'],['--command','x'],['--acl','x'],['--token','x'],['--plan','--self-test']):
            with self.subTest(argv=argv),patch.object(p,'Windows') as native,patch.object(p,'self_test') as run,contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):p.main(argv)
                native.assert_not_called();run.assert_not_called()

    def test_invalid_options_never_echo_private_argument_text(self):
        with contextlib.redirect_stderr(io.StringIO()) as out:
            with self.assertRaises(SystemExit):p.main(['--root','private/path/secret'])
        self.assertEqual(out.getvalue(),'Invalid directory protection probe options. Use --help.\n')

    def test_unsupported_platform_fails_before_loading_a_library(self):
        with patch.object(p.os,'name','unsupported'):
            with self.assertRaisesRegex(p.ProbeError,'did not complete'):p.Windows()

    def test_deny_ace_preserves_original_entries_and_does_not_deny_permission_recovery(self):
        original=struct.pack('<BBHHH',4,0,12,0,0)+b'\0'*4
        new=p.deny_writes(original,WORLD)
        revision,_,size,count,_=struct.unpack('<BBHHH',new[:8])
        self.assertEqual((revision,size,count),(4,len(original)+20,1))
        self.assertEqual(new[8:12],struct.pack('<BBH',1,0,20))
        self.assertEqual(struct.unpack('<I',new[12:16])[0],0x156)
        self.assertEqual(new[16:28],WORLD);self.assertEqual(new[28:],original[8:])
        self.assertFalse(p.WRITE_MASK & (0x40000|0x80000|0x10000))

    def test_malformed_or_oversized_acl_and_any_other_sid_are_refused(self):
        for acl,sid in ((b'',WORLD),(b'\0'*8,WORLD),(ACL+b'padding',WORLD),(ACL,b'bad'),(ACL,b'\0'*12),(struct.pack('<BBHHH',2,0,65528,0,0)+b'\0'*65520,WORLD)):
            with self.subTest(length=len(acl)):
                with self.assertRaises(p.ProbeError):p.deny_writes(acl,sid)

    def test_error_diagnostics_have_fixed_copy_bounded_stage_and_numeric_code(self):
        error=p.ProbeError('secret/path/example',-1)
        self.assertEqual(error.stage,'invalid-stage');self.assertEqual(error.code,0)
        self.assertNotIn('secret',str(error));self.assertNotIn('path',str(error))

    def fixture(self):
        fixture=p.Fixture.__new__(p.Fixture);fixture.n=Mock();fixture.n.uncertain=False
        fixture.parents=[11,12];fixture.root=21;fixture.mutator=22;fixture.lock=None;fixture.original=(ACL,4);fixture.mutated=True;fixture.uncertain=False;fixture.id='a'*32
        fixture.n.permissions.return_value=fixture.original
        return fixture

    def test_cleanup_restores_exact_original_and_only_deletes_owned_handle(self):
        fixture=self.fixture()
        self.assertTrue(fixture.cleanup())
        fixture.n.set_permissions.assert_called_once_with(21,ACL,4)
        fixture.n.permissions.assert_called_once_with(21)
        fixture.n.delete_owned.assert_called_once_with(21)
        self.assertEqual([c.args[0] for c in fixture.n.close.call_args_list],[22,21,12,11])
        self.assertTrue(fixture.cleanup())

    def test_unconfirmed_worker_or_native_operation_preserves_every_handle(self):
        for own,native in ((True,False),(False,True)):
            fixture=self.fixture();fixture.uncertain=own;fixture.n.uncertain=native
            self.assertFalse(fixture.cleanup());fixture.n.set_permissions.assert_not_called();fixture.n.delete_owned.assert_not_called();fixture.n.close.assert_not_called()

    def test_restoration_mismatch_never_deletes_or_closes_the_recovery_handle(self):
        fixture=self.fixture();fixture.n.permissions.return_value=(ACL,0x1004)
        with self.assertRaises(p.ProbeError):fixture.cleanup()
        fixture.n.delete_owned.assert_not_called();fixture.n.close.assert_not_called();self.assertTrue(fixture.uncertain)

    def test_release_failure_prevents_permission_and_cleanup_effects(self):
        fixture=self.fixture();fixture.lock=Mock();fixture.lock.release.side_effect=p.ProbeError('oplock-completion-unconfirmed')
        with self.assertRaises(p.ProbeError):fixture.cleanup()
        fixture.n.set_permissions.assert_not_called();fixture.n.delete_owned.assert_not_called()

    def test_only_access_denied_counts_as_child_write_denial(self):
        fixture=self.fixture();fixture.n.relative.side_effect=p.ProbeError('native-create',0xc0000022)
        self.assertFalse(fixture.child_allowed())
        fixture.n.relative.side_effect=p.ProbeError('native-create',0xc0000035)
        with self.assertRaises(p.ProbeError):fixture.child_allowed()

    def test_successfully_created_child_is_removed_only_by_its_returned_handle(self):
        fixture=self.fixture();fixture.n.relative.return_value=33
        self.assertTrue(fixture.child_allowed());fixture.n.delete_owned.assert_called_once_with(33);fixture.n.close.assert_called_once_with(33)

    def test_failed_native_case_still_stops_further_cases_on_unknown_cleanup(self):
        row={'case':p.CASES[0],'status':'failed','cleanup_confirmed':False}
        with patch.object(p,'Windows'),patch.object(p,'run_case',return_value=row) as run:
            value=p.self_test()
        self.assertEqual(run.call_count,1);self.assertFalse(value['all_cases_observed']);self.assertFalse(value['restart_admitted'])

    def test_observed_directory_cases_never_grant_restart_or_parent_pass(self):
        with patch.object(p,'Windows'),patch.object(p,'run_case',side_effect=lambda _n,name:{'case':name,'status':'observed','cleanup_confirmed':True}):
            value=p.self_test()
        self.assertTrue(value['all_cases_observed']);self.assertFalse(value['restart_admitted']);self.assertFalse(value['parent_qualification'])

    def test_unexpected_exception_is_redacted_and_not_success(self):
        with patch.object(p,'Windows',side_effect=RuntimeError('secret/path')):
            value=p.self_test()
        self.assertEqual(value['failure_stage'],'interrupted-or-internal-error');self.assertFalse(value['native_effects']);self.assertNotIn('secret',json.dumps(value))

    def test_relative_creation_requires_native_exclusive_created_disposition(self):
        native=p.Windows.__new__(p.Windows);native.n=Mock();native.k=Mock();native.uncertain=False
        def open_wrong(handle,_access,_attrs,status,*_rest):
            ctypes.cast(handle,ctypes.POINTER(p.PTR)).contents.value=123
            ctypes.cast(status,ctypes.POINTER(p.IoStatus)).contents.information=1
            return 0
        native.n.NtCreateFile.side_effect=open_wrong
        with self.assertRaises(p.ProbeError) as caught:native.relative(1,'new-fixture',1,create=True)
        self.assertEqual(caught.exception.stage,'exclusive-create');native.k.CloseHandle.assert_called_once_with(123)
        self.assertEqual(native.n.NtCreateFile.call_args.args[7],2)

    def test_pending_native_open_preserves_buffers_without_adopting_or_closing(self):
        native=p.Windows.__new__(p.Windows);native.n=Mock();native.k=Mock();native.uncertain=False
        native.n.NtCreateFile.return_value=0x103
        with self.assertRaises(p.ProbeError) as caught:native.relative(1,'new-fixture',1,create=True)
        self.assertEqual(caught.exception.stage,'native-open-completion-unconfirmed');self.assertTrue(native.uncertain);native.k.CloseHandle.assert_not_called()

    def test_path_traversal_separators_ads_and_long_names_refused_before_open(self):
        native=p.Windows.__new__(p.Windows);native.n=Mock()
        for name in ('..','.',r'a\b','a/b','a:b','a '*2,'x'*256,''):
            with self.subTest(name=name):
                with self.assertRaises(p.ProbeError):native.relative(1,name,1)
        native.n.NtCreateFile.assert_not_called()

    def test_structure_layout_matches_fixed_64_bit_windows_protocol(self):
        self.assertEqual(ctypes.sizeof(p.ObjectAttributes),48)
        self.assertEqual(ctypes.sizeof(p.IoStatus),16)
        self.assertEqual(ctypes.sizeof(p.Overlapped),32)
        self.assertEqual(ctypes.sizeof(p.OplockInput),12)
        self.assertEqual(ctypes.sizeof(p.OplockOutput),24)

    def test_directory_request_uses_sdk_read_and_handle_flags_not_write_caching(self):
        # Windows SDK winioctl.h: READ=1, HANDLE=2, WRITE=4. Directories admit RH.
        native=Mock();native.k.CreateEventW.return_value=44;native.k.DeviceIoControl.return_value=0
        def request(_handle,code,buffer,*_):
            self.assertEqual(code,0x90240)
            value=ctypes.cast(buffer,ctypes.POINTER(p.OplockInput)).contents
            self.assertEqual((value.version,value.length,value.level,value.flags),(1,12,3,1))
            return 0
        native.k.DeviceIoControl.side_effect=request
        with patch.object(p.C,'get_last_error',create=True,return_value=997):p.Oplock(native,33)

    def test_reopened_mutator_must_match_the_exclusive_native_object(self):
        native=Mock();native.uncertain=False;native.ancestors.return_value=[11]
        native.private_root.return_value=(21,ACL);native.relative.return_value=22;native.identity.side_effect=[b'created',b'replaced'];native.permissions.return_value=(ACL,0x1004)
        with self.assertRaises(p.ProbeError) as caught:p.Fixture(native)
        self.assertEqual(caught.exception.stage,'mutator-identity-mismatch')
        native.set_permissions.assert_not_called()
        native.delete_owned.assert_called_once_with(21)
        self.assertEqual(native.close.call_args_list[0].args,(22,))

    def test_reopened_guard_mismatch_never_requests_an_oplock(self):
        fixture=self.fixture();fixture.identity=b'created';fixture.n.relative.return_value=33;fixture.n.identity.return_value=b'replaced'
        with patch.object(p,'Oplock') as lock:
            with self.assertRaises(p.ProbeError) as caught:fixture.guard()
        self.assertEqual(caught.exception.stage,'guard-identity-mismatch');lock.assert_not_called();fixture.n.close.assert_called_once_with(33)

    def lock(self):
        lock=p.Oplock.__new__(p.Oplock);lock.native=Mock();lock.handle=33;lock.event=44;lock.finished=False;lock.overlapped=p.Overlapped();p._RETAINED.append(lock)
        return lock

    def test_unconfirmed_oplock_completion_retains_buffers_and_handles(self):
        lock=self.lock();lock.native.k.CancelIoEx.return_value=1;lock.native.k.WaitForSingleObject.return_value=258
        with patch.object(p.C,'get_last_error',create=True,return_value=0):
            with self.assertRaises(p.ProbeError) as caught:lock.release()
        self.assertEqual(caught.exception.stage,'oplock-completion-unconfirmed');self.assertFalse(lock.finished)
        lock.native.close.assert_not_called();self.assertIn(lock,p._RETAINED)

    def test_successful_native_completion_precedes_handle_and_event_release(self):
        lock=self.lock();lock.native.k.CancelIoEx.return_value=0;lock.native.k.WaitForSingleObject.return_value=0;lock.native.k.GetOverlappedResult.return_value=1
        with patch.object(p.C,'get_last_error',create=True,return_value=1168):lock.release()
        self.assertTrue(lock.finished);self.assertEqual([c.args[0] for c in lock.native.close.call_args_list],[33,44])
        lock.release();self.assertEqual(lock.native.close.call_count,2)

    def test_failed_oplock_result_is_not_cleanup(self):
        lock=self.lock();lock.native.k.CancelIoEx.return_value=1;lock.native.k.WaitForSingleObject.return_value=0;lock.native.k.GetOverlappedResult.return_value=0
        with patch.object(p.C,'get_last_error',create=True,return_value=5):
            with self.assertRaises(p.ProbeError):lock.release()
        lock.native.close.assert_not_called();self.assertFalse(lock.finished)

    def test_oplock_request_needs_io_pending_not_merely_a_truthy_success(self):
        native=Mock();native.k.CreateEventW.return_value=44;native.k.DeviceIoControl.return_value=1
        with patch.object(p.C,'get_last_error',create=True,return_value=0):
            with self.assertRaises(p.ProbeError) as caught:p.Oplock(native,33)
        self.assertEqual(caught.exception.stage,'oplock-not-granted');native.close.assert_called_once_with(44)

    def simulated_fixture(self):
        fixture=self.fixture();fixture.break_state={'broken':False};fixture.lock=SimpleNamespace(finished=False,output=SimpleNamespace(flags=1),broken=lambda:fixture.break_state['broken'],security_break=lambda:True)
        fixture.protect=Mock();fixture.guard=Mock();fixture.child_allowed=Mock(return_value=False);fixture.cleanup=Mock(return_value=True)
        fixture.lock.frame=lambda:{'structure_version':1,'structure_length':24,'original_level':3,'new_level':1,'flags':1,'transferred_bytes':24,'native_status':0}
        return fixture

    def test_simulated_combination_requires_wait_and_actual_thread_exit(self):
        fixture=self.simulated_fixture();released=p.threading.Event()
        def release():fixture.lock.finished=True;released.set()
        fixture.lock.release=release
        def mutate(*_):
            fixture.break_state['broken']=True
            if not released.wait(1):raise p.ProbeError('simulated-wait-expired')
        with patch.object(p,'Fixture',return_value=fixture),patch.object(p,'WAIT_MS',20):
            row=p.run_case(SimpleNamespace(set_permissions=mutate),'combined')
        self.assertEqual(row['status'],'observed');self.assertTrue(row['security_change_waited']);self.assertTrue(row['cleanup_confirmed'])
        self.assertTrue(row['completed_after_guard_release']);fixture.cleanup.assert_called_once()

    def test_fast_security_change_is_a_failed_barrier_not_a_pass(self):
        fixture=self.simulated_fixture();fixture.lock.release=lambda:setattr(fixture.lock,'finished',True)
        def mutate(*_):fixture.break_state['broken']=True
        with patch.object(p,'Fixture',return_value=fixture),patch.object(p,'WAIT_MS',20):
            row=p.run_case(SimpleNamespace(set_permissions=mutate),'combined')
        self.assertEqual(row['status'],'failed');self.assertEqual(row['failure_stage'],'security-barrier-not-established');self.assertFalse(row['security_change_waited'])
        self.assertTrue(row['cleanup_confirmed'])

    def test_permissions_only_case_claims_no_guard_release(self):
        fixture=self.simulated_fixture();fixture.lock=None
        with patch.object(p,'Fixture',return_value=fixture),patch.object(p,'WAIT_MS',20):
            row=p.run_case(SimpleNamespace(set_permissions=lambda *_:None),'permissions-only')
        self.assertEqual(row['status'],'observed');self.assertTrue(row['security_change_completed']);self.assertNotIn('completed_after_guard_release',row)

    def test_prebroken_guard_is_rejected_before_the_security_thread(self):
        fixture=self.simulated_fixture();fixture.break_state['broken']=True;fixture.lock.release=lambda:setattr(fixture.lock,'finished',True)
        native=Mock()
        with patch.object(p,'Fixture',return_value=fixture):row=p.run_case(native,'combined')
        self.assertEqual(row['status'],'failed');self.assertEqual(row['failure_stage'],'guard-already-broken');native.set_permissions.assert_not_called()

    def test_native_dacl_update_uses_one_exact_object_without_win32_propagation(self):
        native=p.Windows.__new__(p.Windows);native.a=Mock();native.n=Mock();native.uncertain=False;native.n.NtSetSecurityObject.return_value=0
        before=len(p._RETAINED)
        def set_one(handle,mask,descriptor):
            self.assertEqual((handle,mask),(123,4));self.assertGreater(len(p._RETAINED),before)
            self.assertEqual(ctypes.sizeof(ctypes.cast(descriptor,ctypes.POINTER(p.SecurityDescriptor)).contents),40)
            return 0
        native.n.NtSetSecurityObject.side_effect=set_one
        with patch.object(p.C,'get_last_error',create=True,return_value=0):native.set_permissions(123,ACL,0x1404)
        self.assertEqual(len(p._RETAINED),before);native.a.SetSecurityInfo.assert_not_called();native.a.SetKernelObjectSecurity.assert_not_called()
        native.a.SetSecurityDescriptorControl.assert_called_once()
        self.assertEqual(native.a.SetSecurityDescriptorControl.call_args.args[1:],(0x1500,0x1400))

    def test_invalid_descriptor_control_is_refused_before_any_native_update(self):
        native=p.Windows.__new__(p.Windows);native.a=Mock();native.n=Mock()
        for control in (False,True,0,8,0x8000,0x2004,0x1104,0x1504,-1):
            with self.subTest(control=control):
                with self.assertRaises(p.ProbeError):native.set_permissions(123,ACL,control)
        native.n.NtSetSecurityObject.assert_not_called()

    def test_interrupted_native_open_keeps_buffers_before_call_and_never_adopts(self):
        native=p.Windows.__new__(p.Windows);native.n=Mock();native.k=Mock();native.uncertain=False;before=len(p._RETAINED)
        def interrupted(*_):
            self.assertGreater(len(p._RETAINED),before);raise KeyboardInterrupt()
        native.n.NtCreateFile.side_effect=interrupted
        with self.assertRaises(KeyboardInterrupt):native.relative(1,'fresh',1,create=True)
        self.assertTrue(native.uncertain);self.assertGreater(len(p._RETAINED),before);native.k.CloseHandle.assert_not_called()

    def test_completed_break_requires_status_frame_levels_and_acknowledgment(self):
        for field,value,stage in [('internal',0x216,'security-break-completion'),('version',2,'security-break-frame'),('length',0,'security-break-frame'),('original',1,'security-break-transition'),('new',0,'security-break-transition'),('flags',0,'security-break-transition'),('flags',5,'security-break-transition')]:
            with self.subTest(field=field,value=value):
                lock=self.lock();lock.output=p.OplockOutput(1,24,3,1,1,0,0);lock.native.k.WaitForSingleObject.return_value=0
                def completed(_h,_ov,count,_wait):ctypes.cast(count,ctypes.POINTER(p.U32)).contents.value=24;return 1
                lock.native.k.GetOverlappedResult.side_effect=completed
                setattr(lock.overlapped if field=='internal' else lock.output,field,value)
                with patch.object(p.C,'get_last_error',create=True,return_value=0):
                    with self.assertRaises(p.ProbeError) as caught:lock.security_break()
                self.assertEqual(caught.exception.stage,stage)

    def test_canceled_completion_is_cleanup_only_and_cannot_validate_a_break(self):
        lock=self.lock();lock.output=p.OplockOutput(1,24,3,1,1,0,0);lock.native.k.WaitForSingleObject.return_value=0;lock.native.k.GetOverlappedResult.return_value=0
        with patch.object(p.C,'get_last_error',create=True,return_value=995):
            with self.assertRaises(p.ProbeError):lock.security_break()
            lock.release()
        self.assertTrue(lock.finished)

    def test_original_and_cleanup_failures_are_both_preserved(self):
        facts={};p.record_failure(facts,p.ProbeError('security-break-frame',5),'observation');p.record_failure(facts,p.ProbeError('owned-empty-cleanup',145),'cleanup')
        self.assertEqual(facts['failure_stage'],'security-break-frame');self.assertEqual(facts['native_code'],5)
        self.assertEqual(facts['additional_failures'],[{'phase':'cleanup','stage':'owned-empty-cleanup','native_code':145}])

    def owner(self):
        owner=p.DiagnosticOwner();owner.watchdog=Mock();owner.watchdog.is_alive.return_value=False
        return owner

    def test_success_retires_watchdog_before_publication_and_emits_once(self):
        owner=self.owner();timer=Mock();timer.is_alive.return_value=False;order=[]
        owner.watchdog.join.side_effect=lambda *_:order.append('join-watchdog')
        output=Mock();output.write.side_effect=lambda *_:order.append('write')
        with patch.object(p.threading,'Timer',return_value=timer),patch.object(p.sys,'stdout',output),patch.object(p.os,'_exit') as exit_process:
            self.assertEqual(owner.finish({'all_cases_observed':True,'unconfirmed_native_lifetime':False}),0)
        self.assertEqual(order,['join-watchdog','write']);self.assertEqual(output.write.call_count,1);timer.cancel.assert_called_once();timer.join.assert_called_once();exit_process.assert_not_called()
        self.assertTrue(owner.stopping);self.assertTrue(owner.report_done.is_set())

    def test_uncertainty_forces_own_process_exit_after_failed_report(self):
        owner=self.owner();timer=Mock()
        with patch.object(p.threading,'Timer',return_value=timer),patch.object(p.os,'_exit',side_effect=SystemExit(2)) as exit_process,contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit):owner.finish({'unconfirmed_native_lifetime':True,'status':'failed','all_cases_observed':True})
        report=json.loads(out.getvalue());self.assertFalse(report['all_cases_observed']);self.assertFalse(report['cleanup_confirmed']);self.assertTrue(report['unconfirmed_native_lifetime'])
        exit_process.assert_called_once_with(2);owner.watchdog.join.assert_not_called();timer.start.assert_called_once()

    def test_watchdog_uses_fixed_deadline_and_one_redacted_failure_report(self):
        owner=self.owner();owner.stopped=Mock();owner.stopped.wait.return_value=False
        with patch.object(owner,'abort_claimed') as abort:owner.expire()
        owner.stopped.wait.assert_called_once_with(30);report=abort.call_args.args[0]
        self.assertEqual(report['failure_stage'],'native-deadline');self.assertFalse(report['restart_admitted']);self.assertFalse(report['parent_qualification']);self.assertTrue(owner.claimed)

    def test_retired_watchdog_cannot_publish_a_late_failure(self):
        owner=self.owner();owner.stopping=True;owner.stopped=Mock();owner.stopped.wait.return_value=False
        with patch.object(owner,'abort_claimed') as abort:owner.expire()
        abort.assert_not_called()

    def test_duplicate_writer_cannot_append_a_second_report_or_finalize(self):
        owner=self.owner();owner.claimed=True;owner.report_done=Mock()
        with patch.object(p.os,'_exit',side_effect=SystemExit(2)),contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit):owner.abort(p.failed_report('interrupted-or-internal-error'))
        self.assertEqual(out.getvalue(),'');owner.report_done.wait.assert_called_once_with(6)

    def test_oversized_report_is_replaced_by_a_bounded_fixed_failure(self):
        text=p.encode_report({'private':'x'*9000});self.assertLess(len(text.encode()),8192);self.assertNotIn('private',text)
        self.assertEqual(json.loads(text)['failure_stage'],'report-size')

    def test_success_flag_cannot_survive_an_oversized_report_replacement(self):
        owner=self.owner();timer=Mock();timer.is_alive.return_value=False
        with patch.object(p.threading,'Timer',return_value=timer),contextlib.redirect_stdout(io.StringIO()) as out:
            code=owner.finish({'all_cases_observed':True,'private':'x'*9000})
        self.assertEqual(code,2);self.assertFalse(json.loads(out.getvalue())['all_cases_observed'])

    def test_security_thread_is_retained_before_start_until_confirmed_join(self):
        fixture=self.simulated_fixture();fixture.lock=None;native=Mock();before=len(p._RETAINED)
        def observed(*_):self.assertGreater(len(p._RETAINED),before)
        native.set_permissions.side_effect=observed
        with patch.object(p,'Fixture',return_value=fixture):row=p.run_case(native,'permissions-only')
        self.assertEqual(row['status'],'observed');self.assertEqual(len(p._RETAINED),before)

    def test_unchanged_fixture_checks_permissions_without_an_unneeded_update(self):
        fixture=self.fixture();fixture.mutated=False
        self.assertTrue(fixture.cleanup());fixture.n.set_permissions.assert_not_called();fixture.n.permissions.assert_called_once_with(21)
        fixture.n.delete_owned.assert_called_once_with(21)

    def test_protection_marks_mutation_before_issue_and_checks_actual_readback(self):
        fixture=self.fixture();fixture.mutated=False;expected=(p.deny_writes(ACL,WORLD),0x1004);fixture.n.permissions.return_value=expected
        def update(*_):self.assertTrue(fixture.mutated)
        fixture.n.set_permissions.side_effect=update;fixture.protect()
        fixture.n.set_permissions.assert_called_once_with(21,*expected);fixture.n.permissions.assert_called_once_with(21)

    def test_interrupted_permission_update_cannot_be_treated_as_unchanged(self):
        fixture=self.fixture();fixture.mutated=False;fixture.n.set_permissions.side_effect=KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):fixture.protect()
        self.assertTrue(fixture.mutated)

    def test_permission_mismatch_logs_only_equality_and_bounded_control_bits(self):
        fixture=self.fixture();fixture.mutated=False;fixture.n.permissions.return_value=(b'private-acl',0x404)
        with self.assertRaises(p.ProbeError) as caught:fixture.cleanup()
        error=caught.exception;facts={};p.record_failure(facts,error,'cleanup')
        self.assertEqual(facts['permission_state'],{'acl_equal':False,'expected_dacl_control':4,'actual_dacl_control':0x404})
        self.assertNotIn('private',json.dumps(facts));fixture.n.set_permissions.assert_not_called();fixture.n.delete_owned.assert_not_called()

    def test_invalid_permission_diagnostics_are_dropped_without_disclosure(self):
        for state in ({'secret':'private-value'},{'acl_equal':True,'expected_dacl_control':-1,'actual_dacl_control':4}):
            error=p.ProbeError('permission-restoration-mismatch',state=state)
            self.assertIsNone(error.state);self.assertNotIn('private',str(error))

    def test_private_acl_is_noninheriting_and_has_only_the_supplied_principal(self):
        acl=p.private_acl(WORLD);revision,_,size,count,_=struct.unpack('<BBHHH',acl[:8])
        self.assertEqual((revision,size,count),(2,28,1));self.assertEqual(acl[8:12],struct.pack('<BBH',0,0,20))
        self.assertEqual(struct.unpack('<I',acl[12:16])[0],0x1701ff);self.assertEqual(acl[16:],WORLD)
        self.assertFalse(p.PRIVATE_ACCESS & 0x80000)
        for bad in (b'',b'\0'*12,WORLD+b'extra',bytes([1,16])+b'\0'*66):
            with self.assertRaises(p.ProbeError):p.private_acl(bad)

    def token_native(self, *, outside=False, oversized=False):
        native=p.Windows.__new__(p.Windows);native.k=Mock();native.a=Mock();native.close=Mock()
        def opened(_process,access,out):
            self.assertEqual(access,8);ctypes.cast(out,ctypes.POINTER(p.PTR)).contents.value=123;return 1
        def query(_handle,kind,buffer,capacity,size):
            self.assertEqual(kind,1)
            ctypes.cast(size,ctypes.POINTER(p.U32)).contents.value=5000 if oversized else 28
            if buffer is None:return 0
            base=ctypes.addressof(buffer);value=ctypes.cast(buffer,ctypes.POINTER(p.TokenUser)).contents
            value.sid=base+40 if outside else base+16
            if not outside:ctypes.memmove(base+16,WORLD,len(WORLD))
            return 1
        native.a.OpenProcessToken.side_effect=opened;native.a.GetTokenInformation.side_effect=query;native.a.IsValidSid.return_value=1
        return native

    def test_token_query_is_own_process_read_only_bounded_and_closes_exact_handle(self):
        native=self.token_native()
        with patch.object(p.C,'get_last_error',create=True,return_value=122):self.assertEqual(native.current_user_sid(),WORLD)
        native.k.GetCurrentProcess.assert_called_once();native.close.assert_called_once_with(123)

    def test_token_sid_pointer_and_capacity_denied_before_reading_or_validating(self):
        for kwargs in ({'outside':True},{'oversized':True}):
            native=self.token_native(**kwargs)
            with patch.object(p.C,'get_last_error',create=True,return_value=122):
                with self.assertRaises(p.ProbeError):native.current_user_sid()
            native.a.IsValidSid.assert_not_called();native.close.assert_called_once_with(123)

    def test_private_descriptor_is_passed_at_exclusive_creation_without_setting_existing_acl(self):
        native=p.Windows.__new__(p.Windows);native.a=Mock();native.current_user_sid=Mock(return_value=WORLD);native.relative=Mock(return_value=123)
        with patch.object(p.C,'get_last_error',create=True,return_value=0):handle,acl=native.private_root(11,'fresh')
        self.assertEqual(handle,123);self.assertEqual(acl,p.private_acl(WORLD))
        self.assertTrue(native.relative.call_args.kwargs['create']);security=native.relative.call_args.kwargs['initial_security']
        self.assertEqual(bytes(security[0])[:-1],acl);self.assertIsInstance(security[1],p.SecurityDescriptor)
        self.assertEqual(native.a.SetSecurityDescriptorControl.call_args.args[1:],(0x1500,0x1000))
        native.a.SetSecurityInfo.assert_not_called()

    def test_creation_rejects_unexpected_control_without_normalizing_its_baseline(self):
        native=Mock();native.uncertain=False;native.ancestors.return_value=[11];native.private_root.return_value=(21,ACL);native.identity.return_value=b'created';native.permissions.return_value=(ACL,0x1404)
        with self.assertRaises(p.ProbeError) as caught:p.Fixture(native)
        self.assertEqual(caught.exception.stage,'creation-profile-unavailable');self.assertEqual(caught.exception.state['expected_dacl_control'],0x1004)
        native.set_permissions.assert_not_called();native.relative.assert_not_called();native.delete_owned.assert_called_once_with(21)

    def test_interrupted_exclusive_create_retains_initial_security_buffers(self):
        native=p.Windows.__new__(p.Windows);native.n=Mock();native.k=Mock();native.uncertain=False
        security=(ctypes.create_string_buffer(ACL),p.SecurityDescriptor())
        def interrupted(_out,_access,attrs,*_):
            self.assertTrue(ctypes.cast(attrs,ctypes.POINTER(p.ObjectAttributes)).contents.security)
            self.assertTrue(any(type(v) is tuple and v[-1] is security for v in p._RETAINED))
            raise KeyboardInterrupt()
        native.n.NtCreateFile.side_effect=interrupted
        with self.assertRaises(KeyboardInterrupt):native.relative(11,'fresh',1,create=True,initial_security=security)
        self.assertTrue(native.uncertain)

    def test_failed_advisory_transition_preserves_actual_bounded_frame(self):
        lock=self.lock();lock.output=p.OplockOutput(1,24,3,0,5,0,0);lock.native.k.WaitForSingleObject.return_value=0
        def completed(_h,_ov,count,_wait):ctypes.cast(count,ctypes.POINTER(p.U32)).contents.value=24;return 1
        lock.native.k.GetOverlappedResult.side_effect=completed
        with patch.object(p.C,'get_last_error',create=True,return_value=0):
            with self.assertRaises(p.ProbeError) as caught:lock.advisory_break()
        facts={};p.record_failure(facts,caught.exception,'observation')
        self.assertEqual(facts['oplock_state'],{'structure_version':1,'structure_length':24,'original_level':3,'new_level':0,'flags':5,'transferred_bytes':24,'native_status':0})

    def test_advisory_cache_ack_does_not_imply_a_content_write_barrier(self):
        lock=self.lock();lock.output=p.OplockOutput(1,24,3,0,1,0,0);lock.native.k.WaitForSingleObject.return_value=0
        def completed(_h,_ov,count,_wait):ctypes.cast(count,ctypes.POINTER(p.U32)).contents.value=24;return 1
        lock.native.k.GetOverlappedResult.side_effect=completed
        with patch.object(p.C,'get_last_error',create=True,return_value=0):self.assertTrue(lock.advisory_break())

    def test_private_profile_does_not_qualify_inherited_acl_round_trip(self):
        value=p.plan();self.assertEqual(value['fixture_profile'],'fresh-protected-current-user-v1');self.assertFalse(value['inherited_acl_round_trip_qualified'])

    def test_constructor_cleanup_failure_does_not_replace_creation_profile_error(self):
        native=Mock();native.uncertain=False;native.ancestors.return_value=[11];native.private_root.return_value=(21,ACL);native.identity.return_value=b'created';native.permissions.return_value=(ACL,0x1404)
        with patch.object(p.Fixture,'cleanup',side_effect=p.ProbeError('owned-empty-cleanup',145)):
            with self.assertRaises(p.ProbeError) as caught:p.Fixture(native)
        self.assertEqual(caught.exception.stage,'creation-profile-unavailable')
        self.assertEqual(caught.exception.secondary,[{'phase':'constructor-cleanup','stage':'owned-empty-cleanup','native_code':145}])

    def test_unconfirmed_constructor_cleanup_and_private_exception_are_redacted(self):
        for outcome in (False,RuntimeError('private/path/data')):
            native=Mock();native.uncertain=False;native.ancestors.return_value=[11];native.private_root.return_value=(21,ACL);native.identity.return_value=b'created';native.permissions.return_value=(ACL,0x1404)
            options={'return_value':False} if outcome is False else {'side_effect':outcome}
            with patch.object(p.Fixture,'cleanup',**options):
                with self.assertRaises(p.ProbeError) as caught:p.Fixture(native)
            facts={};p.record_failure(facts,caught.exception,'construction')
            self.assertEqual(facts['failure_stage'],'creation-profile-unavailable');self.assertEqual(len(facts['additional_failures']),1)
            self.assertNotIn('private',json.dumps(facts));self.assertNotIn('path',json.dumps(facts))

    def test_top_level_report_retains_constructor_primary_and_secondary(self):
        error=p.ProbeError('creation-profile-unavailable');error.secondary=[{'phase':'constructor-cleanup','stage':'owned-empty-cleanup','native_code':145}]
        with patch.object(p,'Windows'),patch.object(p,'run_case',side_effect=error):value=p.self_test()
        self.assertEqual(value['failure_stage'],'creation-profile-unavailable');self.assertEqual(value['additional_failures'],error.secondary);self.assertFalse(value['all_cases_observed'])


if __name__=='__main__':unittest.main()
