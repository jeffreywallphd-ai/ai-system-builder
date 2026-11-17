"""Pure file-probe safety/denial/lifecycle tests. No native mapping or file calls."""
import contextlib
import ctypes
import importlib.util
import io
import json
import struct
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
        native.streams.return_value={f.DEFAULT_STREAM:(4096,4096)}
        return native

    def fixture(self):
        fixture=f.Fixture.__new__(f.Fixture);fixture.n=self.native();fixture.directory=Mock();fixture.directory.root=11;fixture.directory.cleanup.return_value=True;fixture.id='a'*32
        fixture.creator=21;fixture.meta=22;fixture.pending_meta=None;fixture.guard=None;fixture.pending_guard=None;fixture.initial=(ACL,0x1004)
        fixture.guard_request_started=False
        fixture.identity=b'own';fixture.mutated=False;fixture.maps=[];fixture.uncertain=False;fixture.n.permissions.return_value=fixture.initial
        fixture.n.identity.return_value=fixture.identity;fixture.expected_size=4096;fixture.known_streams={f.DEFAULT_STREAM:4096};fixture.extra_handles=[];fixture.seed=False
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
        with patch.object(p,'Oplock',side_effect=p.OplockNotGranted(801,frame=self.frame())):
            self.assertTrue(fixture.admit()['denied'])
        fixture.n.close.assert_called_once_with(31)
        for code,frame in ((87,self.frame()),(801,{**self.frame(),'structure_version':0}),(801,{**self.frame(),'flags':0}),(801,{**self.frame(),'native_status':0})):
            fixture=self.fixture();fixture.n.relative.return_value=31;fixture.n.identity.return_value=fixture.identity
            with patch.object(p,'Oplock',side_effect=p.OplockNotGranted(code,frame=frame)):
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
        native=self.native();native.private_file.return_value=(21,ACL);native.identity.side_effect=[b'own',b'foreign',b'own'];native.permissions.return_value=(ACL,0x1004);native.relative.return_value=99
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

    def stream_buffer(self,entries):
        value=bytearray(f.STREAM_BYTES);offset=0
        for index,(name,size,allocation) in enumerate(entries):
            encoded=name.encode('utf-16-le');span=(24+len(encoded)+7)//8*8
            struct.pack_into('<IIqq',value,offset,span if index+1<len(entries) else 0,len(encoded),size,allocation)
            value[offset+24:offset+24+len(encoded)]=encoded;offset+=span
        return bytes(value)

    def test_stream_metadata_parses_aligned_default_and_named_entries_without_payload_reads(self):
        raw=self.stream_buffer([(f.DEFAULT_STREAM,4096,4096),(f.SEED_STREAM,4096,4096)])
        self.assertEqual(f.stream_records(raw),{f.DEFAULT_STREAM:(4096,4096),f.SEED_STREAM:(4096,4096)})

    def test_stream_metadata_rejects_malformed_offsets_sizes_names_and_duplicates(self):
        valid=self.stream_buffer([(f.DEFAULT_STREAM,4096,4096)])
        invalid=[b'',valid[:-1],self.stream_buffer([(f.DEFAULT_STREAM,4097,4096)]),self.stream_buffer([(f.DEFAULT_STREAM,4096,-1)]),self.stream_buffer([(f.DEFAULT_STREAM,0,0),(f.DEFAULT_STREAM.lower(),0,0)]),self.stream_buffer([('bad\0name',0,0)])]
        for offset,fmt,number in [(0,'<I',25),(0,'<I',f.STREAM_BYTES),(4,'<I',0),(4,'<I',3),(4,'<I',514)]:
            raw=bytearray(valid);struct.pack_into(fmt,raw,offset,number);invalid.append(bytes(raw))
        for raw in invalid:
            with self.subTest(length=len(raw)),self.assertRaises(p.ProbeError):f.stream_records(raw)

    def test_named_stream_refusal_precedes_native_guard_and_never_exposes_names(self):
        fixture=self.fixture();fixture.n.streams.return_value={f.DEFAULT_STREAM:(4096,4096),'private-stream-value':(0,0)}
        with patch.object(p,'Oplock') as lock:result=fixture.admit()
        self.assertEqual(result,{'denied':True,'phase':'streams','native_code':0});fixture.n.relative.assert_not_called();lock.assert_not_called();self.assertNotIn('private-stream',json.dumps(result))

    def test_unknown_stream_or_size_prevents_restore_and_delete(self):
        for records in [{f.DEFAULT_STREAM:(4096,4096),'other':(0,0)},{f.DEFAULT_STREAM:(1,4096)}]:
            fixture=self.fixture();fixture.mutated=True;fixture.n.streams.return_value=records
            with self.assertRaises(p.ProbeError):fixture.cleanup()
            fixture.n.set_permissions.assert_not_called();fixture.n.delete_owned.assert_not_called();fixture.directory.cleanup.assert_not_called()

    def test_post_grant_failure_retains_live_guard_until_caller_cleanup(self):
        fixture=self.fixture();fixture.n.relative.return_value=31;fixture.n.permissions.return_value=(ACL,4)
        lock=Mock();lock.broken.return_value=False;lock.handle=31
        with patch.object(p,'Oplock',return_value=lock),self.assertRaises(p.ProbeError):fixture.admit()
        self.assertIs(fixture.guard,lock);fixture.n.close.assert_not_called();lock.release.assert_not_called()

    def test_seed_file_has_fixed_deny_delete_sharing_and_stream_requires_held_seed(self):
        native=f.Windows.__new__(f.Windows);native._private_object=Mock(return_value=(21,ACL))
        self.assertEqual(native.seed_file(11),(21,ACL));native._private_object.assert_called_once_with(11,'probe.bin',directory=False,share=3)
        fixture=self.fixture();fixture.n=native
        with self.assertRaises(p.ProbeError):native.seed_stream(fixture)

    def test_metadata_query_keeps_aligned_buffer_until_actual_return_and_uses_fixed_size(self):
        native=f.Windows.__new__(f.Windows);native.k=Mock();native.uncertain=False;raw=self.stream_buffer([(f.DEFAULT_STREAM,4096,4096)]);before=len(p._RETAINED)
        def queried(handle,kind,buffer,size):
            self.assertEqual((handle,kind,size),(21,7,65536));self.assertGreater(len(p._RETAINED),before);self.assertEqual(ctypes.cast(buffer,ctypes.c_void_p).value%8,0);ctypes.memmove(buffer,raw,size);return 1
        native.k.GetFileInformationByHandleEx.side_effect=queried
        with patch.object(p.C,'get_last_error',create=True,return_value=0),patch.object(p.C,'set_last_error',create=True):result=native.streams(21)
        self.assertEqual(result,{f.DEFAULT_STREAM:(4096,4096)});self.assertEqual(len(p._RETAINED),before)

    def test_seed_constructor_keeps_one_replacement_fenced_creator_and_recovery_handle(self):
        native=self.native();native.seed_file.return_value=(21,ACL);native.identity.return_value=b'own';native.permissions.return_value=(ACL,0x1004)
        directory=Mock();directory.root=11;directory.id='a'*32;directory.cleanup.return_value=True
        with patch.object(p,'Fixture',return_value=directory),patch.object(f,'Mapping'):fixture=f.Fixture(native,seed=True)
        self.assertEqual(fixture.creator,fixture.meta);self.assertEqual(fixture.meta,21);native.seed_file.assert_called_once_with(11);native.private_file.assert_not_called();native.relative.assert_not_called()
        self.assertTrue(fixture.cleanup());native.delete_owned.assert_called_once_with(21);native.close.assert_called_once_with(21)

    def test_seed_stream_uses_only_fixed_literal_after_actual_seed_identity(self):
        fixture=self.fixture();native=f.Windows.__new__(f.Windows);fixture.n=native;fixture.seed=True;fixture.meta=fixture.creator
        native.identity=Mock(side_effect=[b'own',b'own']);native.regular=Mock();native._relative_open=Mock(return_value=31)
        self.assertEqual(native.seed_stream(fixture),31)
        native._relative_open.assert_called_once_with(11,'probe.bin:probe-stream:$DATA',0x100083,create=True,directory=False)

    def test_post_grant_stream_race_and_wrong_size_are_refused_without_closing_live_irp(self):
        for records in [{f.DEFAULT_STREAM:(4096,4096),'new-stream':(0,0)},{f.DEFAULT_STREAM:(1,4096)}]:
            fixture=self.fixture();fixture.n.relative.return_value=31;fixture.n.streams.side_effect=[{f.DEFAULT_STREAM:(4096,4096)},records]
            guard=Mock();guard.handle=31;guard.broken.return_value=False
            with patch.object(p,'Oplock',return_value=guard),self.assertRaises(p.ProbeError):fixture.admit()
            self.assertIs(fixture.guard,guard);fixture.n.close.assert_not_called();guard.release.assert_not_called()

    def test_unknown_stream_query_lifetime_retains_buffer_and_disallows_cleanup(self):
        native=f.Windows.__new__(f.Windows);native.k=Mock();native.uncertain=False;before=len(p._RETAINED)
        native.k.GetFileInformationByHandleEx.side_effect=KeyboardInterrupt()
        with patch.object(p.C,'set_last_error',create=True),self.assertRaises(KeyboardInterrupt):native.streams(21)
        self.assertTrue(native.uncertain);self.assertGreater(len(p._RETAINED),before)

    def test_unexpected_pending_metadata_status_is_not_retired_or_counted_as_empty(self):
        for error in (996,997):
            native=f.Windows.__new__(f.Windows);native.k=Mock();native.uncertain=False;native.k.GetFileInformationByHandleEx.return_value=0;before=len(p._RETAINED)
            with patch.object(p.C,'set_last_error',create=True),patch.object(p.C,'get_last_error',create=True,return_value=error),self.assertRaises(p.ProbeError):native.streams(21)
            self.assertTrue(native.uncertain);self.assertGreater(len(p._RETAINED),before)

    def test_unknown_constructor_interrupt_keeps_pending_handle_and_prevents_all_cleanup(self):
        fixture=self.fixture();fixture.n.relative.return_value=31
        with patch.object(p,'Oplock',side_effect=KeyboardInterrupt()),self.assertRaises(KeyboardInterrupt):fixture.admit()
        self.assertTrue(fixture.n.uncertain);self.assertFalse(fixture.cleanup());fixture.n.close.assert_not_called();fixture.n.delete_owned.assert_not_called()

    def test_plain_error_stage_is_not_a_completed_rejection_witness(self):
        fixture=self.fixture();fixture.n.relative.return_value=31
        with patch.object(p,'Oplock',side_effect=p.ProbeError('oplock-not-granted',801,frame=self.frame())),self.assertRaises(p.ProbeError):fixture.admit()
        self.assertTrue(fixture.n.uncertain);fixture.n.close.assert_not_called();self.assertFalse(fixture.cleanup())

    def test_file_pending_alias_is_not_closed_again_after_guard_release(self):
        fixture=self.fixture();fixture.pending_guard=31;fixture.guard_request_started=True;fixture.guard=Mock();fixture.guard.release.side_effect=lambda:fixture.n.close(31)
        self.assertTrue(fixture.cleanup());self.assertEqual([c.args[0] for c in fixture.n.close.call_args_list],[31,21,22])


    def test_creator_close_success_retires_only_temporary_custody_and_is_idempotent(self):
        fixture=self.fixture();before=len(p._RETAINED)
        def close(handle):
            self.assertEqual(handle,21);self.assertEqual(len(p._RETAINED),before+1)
            self.assertTrue(any(type(v) is tuple and len(v)==2 and v[0] is fixture and v[1]==21 for v in p._RETAINED))
        fixture.n.close.side_effect=close;fixture.close_creator();fixture.close_creator()
        fixture.n.close.assert_called_once_with(21);self.assertIsNone(fixture.creator);self.assertEqual(fixture.meta,22)
        self.assertFalse(fixture.uncertain);self.assertFalse(fixture.n.uncertain);self.assertEqual(len(p._RETAINED),before)

    def test_unknown_creator_close_retains_local_and_shared_custody_and_refuses_cleanup(self):
        for failure in [p.ProbeError('synthetic-close'),KeyboardInterrupt()]:
            fixture=self.fixture();fixture.n.close.side_effect=failure
            with self.assertRaises(type(failure)) as caught:fixture.close_creator()
            self.assertIs(caught.exception,failure);self.assertTrue(fixture.uncertain);self.assertTrue(fixture.n.uncertain);self.assertEqual(fixture.creator,21)
            self.assertTrue(any(type(v) is tuple and len(v)==2 and v[0] is fixture and v[1]==21 for v in p._RETAINED))
            with self.assertRaises(p.ProbeError):fixture.close_creator()
            self.assertFalse(fixture.cleanup());fixture.n.close.assert_called_once_with(21);fixture.n.identity.assert_not_called();fixture.n.delete_owned.assert_not_called();fixture.directory.cleanup.assert_not_called()

    def test_uncertain_creator_close_is_denied_before_any_native_effect(self):
        for local,shared in [(True,False),(False,True)]:
            fixture=self.fixture();fixture.uncertain=local;fixture.n.uncertain=shared;before=len(p._RETAINED)
            with self.assertRaises(p.ProbeError):fixture.close_creator()
            fixture.n.close.assert_not_called();self.assertEqual(len(p._RETAINED),before)

    def test_interrupted_creator_close_finalization_keeps_failure_and_refuses_cleanup(self):
        fixture=self.fixture();fixture.n.close.return_value=None
        with patch.object(p,'retire_reference',side_effect=KeyboardInterrupt()),self.assertRaises(KeyboardInterrupt):fixture.close_creator()
        self.assertTrue(fixture.uncertain);self.assertTrue(fixture.n.uncertain);self.assertIsNone(fixture.creator);self.assertEqual(fixture.meta,22)
        self.assertFalse(fixture.cleanup());fixture.n.close.assert_called_once_with(21);fixture.n.delete_owned.assert_not_called();fixture.directory.cleanup.assert_not_called()



if __name__=='__main__':unittest.main()
