"""Pure file-probe safety/denial/lifecycle tests. No native mapping or file calls."""
import contextlib
import ctypes
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import threading
import unittest
from unittest.mock import Mock,patch

SOURCE=Path(__file__).resolve().parents[1]/'probe_windows_file_protection.py'
spec=importlib.util.spec_from_file_location('file_probe',SOURCE);f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
p=f.p
SID=b'\x01\x01\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00'
ACL=p.private_acl(SID)


class FileProbeTests(unittest.TestCase):
    def native(self):
        native=Mock();native.uncertain=False;native.k.CreateFileMappingW.return_value=101;native.k.UnmapViewOfFile.return_value=1
        return native

    def fixture(self):
        fixture=f.Fixture.__new__(f.Fixture);fixture.n=self.native();fixture.directory=Mock();fixture.directory.root=11;fixture.directory.cleanup.return_value=True;fixture.id='a'*32
        fixture.creator=21;fixture.meta=22;fixture.pending_meta=None;fixture.guard=None;fixture.pending_guard=None;fixture.initial=(ACL,0x1004)
        fixture.identity=b'own';fixture.mutated=False;fixture.maps=[];fixture.uncertain=False;fixture.n.permissions.return_value=fixture.initial
        return fixture

    def frame(self):
        return {'structure_version':1,'structure_length':24,'original_level':0,'new_level':0,'flags':4,'transferred_bytes':None,'native_status':0x8000002e}

    def test_default_and_explicit_plan_do_not_load_windows_or_start_owner(self):
        for args in ([],['--plan']):
            with patch.object(f,'Windows') as windows,patch.object(f,'Owner') as owner,contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(f.main(args),0)
            value=json.loads(out.getvalue());self.assertEqual(value['schema'],f.SCHEMA);self.assertEqual(value['maximum_file_bytes'],4096)
            self.assertFalse(value['native_effects']);self.assertFalse(value['restart_admitted']);self.assertEqual(value['cases'],list(f.CASES));windows.assert_not_called();owner.assert_not_called()

    def test_cli_refuses_paths_sizes_pids_commands_and_echoes_no_private_arguments(self):
        for args in (['--root','private/path'],['--size','99999'],['--pid','1'],['--command','x'],['--plan','--self-test']):
            with patch.object(f,'Windows') as windows,patch.object(f,'Owner') as owner,contextlib.redirect_stderr(io.StringIO()) as out:
                with self.assertRaises(SystemExit):f.main(args)
            self.assertNotIn('private',out.getvalue());windows.assert_not_called();owner.assert_not_called()

    def test_error_owner_and_oversize_reports_keep_file_schema_and_false_authority(self):
        owner=f.Owner();value=owner.failure_report('native-deadline')
        self.assertEqual(value['schema'],f.SCHEMA);self.assertFalse(value['restart_admitted']);self.assertFalse(value['parent_qualification'])
        oversized=json.loads(owner.encode({'HIDDEN_VALUE':'x'*9000}));self.assertEqual(oversized['schema'],f.SCHEMA);self.assertNotIn('HIDDEN_VALUE',json.dumps(oversized))

    def test_private_file_creator_has_fixed_file_kind_and_bounded_current_user_descriptor(self):
        native=p.Windows.__new__(p.Windows);native.a=Mock();native.current_user_sid=Mock(return_value=SID);native.relative=Mock(return_value=21)
        with patch.object(p.C,'get_last_error',create=True,return_value=0):handle,acl=native.private_file(11,'probe.bin')
        self.assertEqual((handle,acl),(21,ACL));call=native.relative.call_args
        self.assertEqual(call.args,(11,'probe.bin',0x170083));self.assertIs(call.kwargs['directory'],False);self.assertTrue(call.kwargs['create'])
        self.assertIsInstance(call.kwargs['initial_security'][1],p.SecurityDescriptor)

    def test_mapping_is_anonymous_nonexecutable_and_exactly_4096_bytes(self):
        native=self.native()
        with patch.object(p.C,'get_last_error',create=True,return_value=0):mapping=f.Mapping(native,21,writable=True,view=False)
        native.k.CreateFileMappingW.assert_called_once_with(21,None,4,0,4096,None);native.k.MapViewOfFile.assert_not_called()
        mapping.close();native.close.assert_called_once_with(101)

    def test_mapping_view_is_retained_before_api_and_stays_until_confirmed_release(self):
        native=self.native();memory=ctypes.create_string_buffer(4096);address=ctypes.addressof(memory);before=len(p._RETAINED)
        def view(*args):
            self.assertGreater(len(p._RETAINED),before);self.assertEqual(args,(101,2,0,0,4096));return address
        native.k.MapViewOfFile.side_effect=view
        with patch.object(p.C,'get_last_error',create=True,return_value=0):mapping=f.Mapping(native,21,writable=True,view=True)
        mapping.write_marker();self.assertEqual(memory.raw[0],0x51);self.assertEqual(len(p._RETAINED),before+1)
        with patch.object(p.C,'get_last_error',create=True,return_value=0):mapping.close()
        native.k.UnmapViewOfFile.assert_called_once_with(address);self.assertEqual(len(p._RETAINED),before)

    def test_read_only_view_uses_read_access_and_cannot_call_write_marker(self):
        native=self.native();memory=ctypes.create_string_buffer(4096);native.k.MapViewOfFile.return_value=ctypes.addressof(memory)
        with patch.object(p.C,'get_last_error',create=True,return_value=0):mapping=f.Mapping(native,21,writable=False,view=True)
        self.assertEqual(native.k.CreateFileMappingW.call_args.args[2],2);self.assertEqual(native.k.MapViewOfFile.call_args.args[1],4)
        mapping.read_zero()
        with self.assertRaises(p.ProbeError):mapping.write_marker()
        with patch.object(p.C,'get_last_error',create=True,return_value=0):mapping.close()

    def test_interrupted_mapping_construction_preserves_unknown_lifetime(self):
        native=self.native();before=len(p._RETAINED)
        def interrupted(*_):self.assertGreater(len(p._RETAINED),before);raise KeyboardInterrupt()
        native.k.CreateFileMappingW.side_effect=interrupted
        with self.assertRaises(KeyboardInterrupt):f.Mapping(native,21,writable=True,view=False)
        self.assertTrue(native.uncertain);native.close.assert_not_called()

    def test_failed_unmap_never_closes_section_or_claims_cleanup(self):
        native=self.native();memory=ctypes.create_string_buffer(4096);native.k.MapViewOfFile.return_value=ctypes.addressof(memory);native.k.UnmapViewOfFile.return_value=0
        with patch.object(p.C,'get_last_error',create=True,return_value=5):mapping=f.Mapping(native,21,writable=True,view=True)
        with patch.object(p.C,'get_last_error',create=True,return_value=5):
            with self.assertRaises(p.ProbeError):mapping.close()
        self.assertTrue(mapping.uncertain);self.assertTrue(native.uncertain);native.close.assert_not_called()

    def test_unknown_mapping_kind_is_refused_before_any_native_call(self):
        native=self.native()
        with self.assertRaises(p.ProbeError):f.Mapping(native,21,writable=1,view=False)
        native.k.CreateFileMappingW.assert_not_called()

    def test_live_writable_handle_counts_only_actual_sharing_refusal(self):
        fixture=self.fixture();fixture.n.relative.side_effect=p.ProbeError('native-open',f.SHARING)
        with patch.object(p,'Oplock') as lock:self.assertEqual(fixture.admit(),{'denied':True,'phase':'open','native_code':f.SHARING})
        lock.assert_not_called();fixture.n.close.assert_not_called()
        fixture.n.relative.side_effect=p.ProbeError('native-open',f.ACCESS_DENIED)
        with self.assertRaises(p.ProbeError):fixture.admit()

    def test_section_refusal_needs_the_specific_native_warning_and_valid_frame(self):
        fixture=self.fixture();fixture.n.relative.return_value=31;fixture.n.identity.return_value=fixture.identity
        with patch.object(p,'Oplock',side_effect=p.ProbeError('oplock-not-granted',801,frame=self.frame())):
            self.assertTrue(fixture.admit()['denied'])
        fixture.n.close.assert_called_once_with(31)
        for code,frame in ((87,self.frame()),(801,{**self.frame(),'structure_version':0}),(801,{**self.frame(),'flags':0}),(801,{**self.frame(),'native_status':0})):
            fixture=self.fixture();fixture.n.relative.return_value=31;fixture.n.identity.return_value=fixture.identity
            with patch.object(p,'Oplock',side_effect=p.ProbeError('oplock-not-granted',code,frame=frame)):
                with self.assertRaises(p.ProbeError):fixture.admit()

    def test_guard_identity_mismatch_closes_only_unadmitted_handle(self):
        fixture=self.fixture();fixture.n.relative.return_value=31;fixture.n.identity.return_value=b'foreign'
        with patch.object(p,'Oplock') as lock:
            with self.assertRaises(p.ProbeError):fixture.admit()
        lock.assert_not_called();fixture.n.close.assert_called_once_with(31);fixture.n.delete_owned.assert_not_called()

    def test_unknown_native_open_never_becomes_a_successful_denial(self):
        fixture=self.fixture();fixture.n.relative.side_effect=p.ProbeError('native-open',0xc0000001)
        with self.assertRaises(p.ProbeError):fixture.admit()

    def test_cleanup_closes_maps_guard_creator_then_restores_and_removes_only_owned_file(self):
        fixture=self.fixture();fixture.mutated=True;events=[]
        mapping=Mock();mapping.close.side_effect=lambda:events.append('mapping');fixture.maps=[mapping]
        fixture.guard=Mock();fixture.guard.release.side_effect=lambda:events.append('guard')
        fixture.n.close.side_effect=lambda h:events.append(('close',h));fixture.n.set_permissions.side_effect=lambda *_:events.append('restore');fixture.n.delete_owned.side_effect=lambda h:events.append(('delete',h))
        self.assertTrue(fixture.cleanup());self.assertEqual(events,['mapping','guard','restore',('close',21),('delete',22),('close',22)])
        fixture.directory.cleanup.assert_called_once()

    def test_unconfirmed_native_mapping_prevents_every_further_file_or_folder_effect(self):
        fixture=self.fixture();fixture.n.uncertain=True
        self.assertFalse(fixture.cleanup());fixture.n.set_permissions.assert_not_called();fixture.n.delete_owned.assert_not_called();fixture.n.close.assert_not_called();fixture.directory.cleanup.assert_not_called()

    def test_foreign_pending_metadata_handle_is_only_closed_not_mutated_or_deleted(self):
        fixture=self.fixture();fixture.meta=None;fixture.pending_meta=99
        self.assertTrue(fixture.cleanup());fixture.n.set_permissions.assert_not_called();fixture.n.delete_owned.assert_called_once_with(21)
        self.assertEqual([c.args[0] for c in fixture.n.close.call_args_list],[99,21])

    def test_exact_restore_mismatch_keeps_file_and_original_failure_details(self):
        fixture=self.fixture();fixture.mutated=True;fixture.n.permissions.return_value=(ACL,4)
        with self.assertRaises(p.ProbeError) as caught:fixture.cleanup()
        self.assertEqual(caught.exception.stage,'file-restoration-mismatch');fixture.n.delete_owned.assert_not_called();fixture.directory.cleanup.assert_not_called()

    def test_failed_section_close_retains_mapping_and_stops_cleanup(self):
        native=self.native()
        with patch.object(p.C,'get_last_error',create=True,return_value=0):mapping=f.Mapping(native,21,writable=True,view=False)
        native.close.side_effect=p.ProbeError('handle-close',5)
        with self.assertRaises(p.ProbeError):mapping.close()
        self.assertTrue(mapping.uncertain);self.assertTrue(native.uncertain);self.assertIn(mapping,p._RETAINED)

    def test_pending_foreign_recovery_handle_is_never_adopted_on_constructor_failure(self):
        native=self.native();native.private_file.return_value=(21,ACL);native.identity.side_effect=[b'own',b'foreign'];native.permissions.return_value=(ACL,0x1004);native.relative.return_value=99
        directory=Mock();directory.root=11;directory.id='a'*32;directory.cleanup.return_value=True
        with patch.object(p,'Fixture',return_value=directory),patch.object(f,'Mapping'),self.assertRaises(p.ProbeError) as caught:f.Fixture(native)
        self.assertEqual(caught.exception.stage,'file-recovery-identity');native.delete_owned.assert_called_once_with(21);native.set_permissions.assert_not_called()

    def positive(self,*,fast=False,prebroken=False):
        fixture=self.fixture();fixture.guard=Mock();fixture.guard.broken.return_value=prebroken;fixture.guard.finished=False;fixture.admit=Mock(return_value={'denied':False});fixture.protect=Mock();fixture.close_creator=Mock();fixture.map=Mock();fixture.new_writer_denied=Mock(return_value=True);fixture.cleanup=Mock(return_value=True)
        released=threading.Event();fixture.guard.release.side_effect=released.set
        fixture.n.set_permissions.side_effect=lambda *_:None if fast else released.wait(1)
        with patch.object(f,'Fixture',return_value=fixture),patch.object(p,'WAIT_MS',20):row=f.run_case(fixture.n,'readonly-reader-and-security-barrier')
        return row,fixture

    def test_simulated_positive_requires_wait_and_confirmed_completion_and_cleanup(self):
        row,fixture=self.positive();self.assertEqual(row['status'],'observed');self.assertTrue(row['security_change_waited']);self.assertTrue(row['completed_after_guard_release']);self.assertTrue(row['cleanup_confirmed']);fixture.guard.security_break.assert_called_once()

    def test_completed_security_change_is_not_a_barrier_pass(self):
        row,_fixture=self.positive(fast=True);self.assertEqual(row['status'],'failed');self.assertFalse(row['security_change_waited']);self.assertTrue(row['cleanup_confirmed'])

    def test_prebroken_guard_cannot_claim_barrier_causality(self):
        row,fixture=self.positive(prebroken=True);self.assertEqual(row['status'],'failed');fixture.n.set_permissions.assert_not_called();self.assertTrue(row['cleanup_confirmed'])

    def test_default_directory_creator_remains_directory_with_original_access(self):
        native=p.Windows.__new__(p.Windows);native.a=Mock();native.current_user_sid=Mock(return_value=SID);native.relative=Mock(return_value=21)
        with patch.object(p.C,'get_last_error',create=True,return_value=0):native.private_root(11,'own')
        self.assertEqual(native.relative.call_args.args,(11,'own',0x700a1));self.assertIs(native.relative.call_args.kwargs['directory'],True)

    def test_protection_marks_potential_update_before_call_and_requires_readback(self):
        fixture=self.fixture();fixture.n.set_permissions.side_effect=lambda *_:self.assertTrue(fixture.mutated)
        with self.assertRaises(p.ProbeError) as caught:fixture.protect()
        self.assertEqual(caught.exception.stage,'file-protection-mismatch');self.assertTrue(fixture.mutated)

    def test_all_actual_case_results_are_required_and_never_qualify_parent(self):
        with patch.object(f,'Windows'),patch.object(f,'run_case',side_effect=lambda _n,name:{'case':name,'status':'observed','cleanup_confirmed':True}):value=f.self_test()
        self.assertTrue(value['all_cases_observed']);self.assertFalse(value['restart_admitted']);self.assertFalse(value['parent_qualification'])
        with patch.object(f,'Windows'),patch.object(f,'run_case',return_value={'status':'failed','cleanup_confirmed':False}) as run:value=f.self_test()
        self.assertEqual(run.call_count,1);self.assertFalse(value['all_cases_observed'])

    def test_unexpected_errors_are_fixed_copy_without_private_details(self):
        with patch.object(f,'Windows',side_effect=RuntimeError('HIDDEN_PATH_VALUE')):value=f.self_test()
        self.assertEqual(value['failure_stage'],'file-interrupted-or-internal-error');self.assertNotIn('HIDDEN_PATH_VALUE',json.dumps(value))

    def test_closed_file_fact_shape_rejects_directories_reparse_extra_links_and_wrong_size(self):
        native=f.Windows.__new__(f.Windows);native.k=Mock()
        for attrs,links,size in ((0x10,1,4096),(0x400,1,4096),(0x80,2,4096),(0x80,1,8192)):
            def facts(_h,kind,out,_size):
                if kind==9:ctypes.cast(out,ctypes.POINTER(p.U32)).contents.value=attrs
                else:
                    v=ctypes.cast(out,ctypes.POINTER(f.StandardInfo)).contents;v.size=size;v.links=links
                return 1
            native.k.GetFileInformationByHandleEx.side_effect=facts
            with patch.object(p.C,'get_last_error',create=True,return_value=0):
                with self.assertRaises(p.ProbeError):native.regular(21,4096)


if __name__=='__main__':unittest.main()
