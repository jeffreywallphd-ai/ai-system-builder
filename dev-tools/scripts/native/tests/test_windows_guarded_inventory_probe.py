"""Pure metadata, boundary and lifetime tests; no native fixtures or DLL calls."""
import contextlib
import ctypes as C
import importlib.util
import io
import json
from pathlib import Path
import struct
import unittest
from unittest.mock import Mock,patch

spec=importlib.util.spec_from_file_location('guarded_inventory',Path(__file__).resolve().parents[1]/'probe_windows_guarded_inventory.py')
i=importlib.util.module_from_spec(spec);spec.loader.exec_module(i);p=i.p
ROOT=b'volume01'+b'R'*16
PARENT=b'volume01'+b'P'*16
FILE=b'volume01'+b'F'*16


def page(records):
    data=bytearray(i.PAGE_BYTES);offset=0
    for index,record in enumerate(records):
        name,identity,size,allocation,attributes=record;name=name.encode('utf-16-le')
        length=i.HEADER.size+len(name);following=(length+7)//8*8 if index+1<len(records) else 0
        i.HEADER.pack_into(data,offset,following,0,0,0,0,0,size,allocation,attributes,len(name),0,0,identity)
        data[offset+i.HEADER.size:offset+length]=name
        offset+=following or length
    return bytes(data)


def record(name='probe.bin',identity=FILE[8:],size=4096,allocation=4096,attributes=0x20):
    return name,identity,size,allocation,attributes


class InventoryTests(unittest.TestCase):
    def error(self,values=0):
        return patch.object(i.C,'get_last_error',create=True,side_effect=values if type(values) is list else None,return_value=values if type(values) is int else 0)

    def reader(self,pages):
        native=i.Windows.__new__(i.Windows);native.uncertain=False;native.k=Mock();rows=iter(pages)
        def query(_handle,_kind,output,_length):
            value=next(rows)
            if isinstance(value,BaseException):raise value
            if value is None:return 0
            C.memmove(output,value,len(value));return 1
        native.k.GetFileInformationByHandleEx.side_effect=query
        return native

    def test_default_and_plan_have_no_native_owner_or_fixture_effects(self):
        for args in ([],['--plan']):
            with patch.object(i,'Windows') as native,patch.object(i,'Owner') as owner,contextlib.redirect_stdout(io.StringIO()) as output:self.assertEqual(i.main(args),0)
            value=json.loads(output.getvalue());self.assertFalse(value['native_effects']);self.assertFalse(value['retained_data_accessed']);self.assertFalse(value['parent_qualification']);native.assert_not_called();owner.assert_not_called()

    def test_cli_refuses_paths_pids_commands_limits_and_mixed_modes_without_echo(self):
        for args in (['--path','HIDDEN_VALUE'],['--pid','88'],['--command','HIDDEN_VALUE'],['--limit','999'],['--plan','--self-test']):
            with patch.object(i,'Windows') as native,patch.object(i,'Owner') as owner,contextlib.redirect_stderr(io.StringIO()) as output:
                with self.assertRaises(SystemExit):i.main(args)
            self.assertNotIn('HIDDEN_VALUE',output.getvalue());native.assert_not_called();owner.assert_not_called()

    def test_sdk_offsets_alignment_and_fixed_bounds(self):
        class SDK(C.Structure):
            _fields_=[('next',p.U32),('index',p.U32),*[(n,C.c_int64) for n in ['created','accessed','written','changed','size','allocation']],*[(n,p.U32) for n in ['attributes','length','ea','tag']],('identity',C.c_ubyte*16),('name',p.U16*1)]
        self.assertEqual((SDK.name.offset,SDK.identity.offset,C.sizeof(SDK),i.HEADER.size),(88,72,96,88))
        self.assertEqual((i.PAGE_BYTES,i.MAX_PAGES,i.MAX_ENTRIES),(65536,4,32))

    def test_valid_metadata_and_dot_entries_roundtrip_without_payload_reads(self):
        values=i.page_entries(page([record('.',ROOT[8:],0,0,0x10),record('..',PARENT[8:],0,0,0x10),record()]))
        self.assertEqual(i.exact_inventory(values,{'probe.bin':(FILE,4096)},ROOT,PARENT),{'files':1,'logical_bytes':4096,'allocation_bytes':4096})

    def test_buffer_type_size_and_zero_record_are_refused(self):
        for value in [None,bytearray(i.PAGE_BYTES),b'\0'*(i.PAGE_BYTES-1),b'\0'*i.PAGE_BYTES]:
            with self.subTest(value_type=type(value).__name__),self.assertRaises(p.ProbeError):i.page_entries(value)

    def test_record_lengths_offsets_sizes_identity_and_ea_fail_closed(self):
        good=page([record()])
        for offset,fmt,value in [(60,'I',0),(60,'I',3),(60,'I',512),(0,'I',89),(0,'I',65536),(40,'q',-1),(48,'q',i.METADATA_BYTE_LIMIT+1),(64,'I',1)]:
            bad=bytearray(good);struct.pack_into('<'+fmt,bad,offset,value)
            with self.subTest(offset=offset,value=value),self.assertRaises(p.ProbeError):i.page_entries(bytes(bad))
        bad=bytearray(good);bad[72:88]=b'\0'*16
        with self.assertRaises(p.ProbeError):i.page_entries(bytes(bad))

    def test_unsupported_native_types_and_unaccounted_storage_flags_are_refused(self):
        for flag in [0x400,0x200,0x800,0x4000,0x1000,0x40,0x10000]:
            with self.subTest(flag=flag),self.assertRaises(p.ProbeError):i.page_entries(page([record(attributes=flag)]))

    def test_undefined_reparse_tag_on_regular_file_is_not_misread_as_a_reparse_point(self):
        data=bytearray(page([record()]));struct.pack_into('<I',data,68,0xffffffff)
        self.assertEqual(len(i.page_entries(bytes(data))),1)

    def test_utf16_leaf_control_traversal_and_ambiguous_names_are_refused(self):
        for name in ['a/b','a\\b','a:b','a\0b','a\nb','a.','a ','*']:
            with self.subTest(name=name),self.assertRaises(p.ProbeError):i.page_entries(page([record(name)]))
        bad=bytearray(page([record('a')]));bad[88:90]=b'\x00\xd8'
        with self.assertRaises(p.ProbeError):i.page_entries(bytes(bad))

    def test_duplicate_case_names_and_invalid_dot_metadata_are_refused(self):
        for records in [[record('one'),record('ONE',b'2'*16)],[record('.',attributes=0x20)],[record('.',size=1,attributes=0x10)]]:
            with self.assertRaises(p.ProbeError):i.page_entries(page(records))

    def test_page_record_limit_is_enforced(self):
        with self.assertRaises(p.ProbeError):i.page_entries(page([record(str(n),bytes([n+1])*16) for n in range(33)]))

    def test_reader_restarts_once_then_continues_and_requires_terminal_status(self):
        native=self.reader([page([record()]),None])
        with self.error([0,18]),patch.object(i.C,'set_last_error',create=True):rows=native.entries(42)
        self.assertEqual([c.args[1] for c in native.k.GetFileInformationByHandleEx.call_args_list],[20,19]);self.assertEqual(len(rows),1)

    def test_empty_directory_requires_explicit_clean_native_end(self):
        native=self.reader([None])
        with self.error(18),patch.object(i.C,'set_last_error',create=True):self.assertEqual(native.entries(42),())

    def test_successful_page_tail_does_not_mean_complete_inventory(self):
        native=self.reader([page([record()]),None])
        with self.error([0,234]),patch.object(i.C,'set_last_error',create=True),self.assertRaises(p.ProbeError):native.entries(42)
        self.assertFalse(native.uncertain)

    def test_ambiguous_nonempty_native_end_is_never_silently_discarded(self):
        native=self.reader([page([record()])]);original=native.k.GetFileInformationByHandleEx.side_effect
        def query(*args):original(*args);return 0
        native.k.GetFileInformationByHandleEx.side_effect=query
        with self.error(18),patch.object(i.C,'set_last_error',create=True),self.assertRaises(p.ProbeError):native.entries(42)

    def test_duplicates_across_native_pages_cannot_be_hidden_by_page_boundaries(self):
        native=self.reader([page([record('one')]),page([record('ONE',b'2'*16)])])
        with self.error(),patch.object(i.C,'set_last_error',create=True),self.assertRaises(p.ProbeError):native.entries(42)

    def test_page_limit_never_returns_a_complete_prefix(self):
        native=self.reader([page([record(str(n),bytes([n+1])*16)]) for n in range(i.MAX_PAGES)])
        with self.error(),patch.object(i.C,'set_last_error',create=True),self.assertRaises(p.ProbeError):native.entries(42)

    def test_total_entry_limit_cannot_be_bypassed_with_another_native_page(self):
        native=self.reader([page([record(str(n),bytes([n+1])*16) for n in range(32)]),page([record('last',b'Z'*16)])])
        with self.error(),patch.object(i.C,'set_last_error',create=True),self.assertRaises(p.ProbeError) as error:native.entries(42)
        self.assertEqual(error.exception.stage,'inventory-entry-limit')

    def test_pending_and_unknown_query_keep_aligned_buffers_and_deny_further_effects(self):
        for outcome in (996,997,KeyboardInterrupt()):
            native=self.reader([outcome if isinstance(outcome,BaseException) else None]);before=len(p._RETAINED)
            with self.error(outcome if type(outcome) is int else 0),patch.object(i.C,'set_last_error',create=True),self.assertRaises(BaseException):native.entries(42)
            self.assertTrue(native.uncertain);self.assertEqual(len(p._RETAINED),before+1)
            self.assertEqual(C.addressof(p._RETAINED[-1][1])%8,0)

    def test_expected_manifest_mismatch_duplicate_identity_and_cross_volume_deny(self):
        rows=i.page_entries(page([record()]))
        for expected in [{},{'probe.bin':(FILE,4095)},{'probe.bin':(b'otherVol'+FILE[8:],4096)},{'probe.bin':(b'volume01'+b'X'*16,4096)}]:
            with self.assertRaises(p.ProbeError):i.exact_inventory(rows,expected,ROOT,PARENT)
        duplicate=i.page_entries(page([record(),record('extra',FILE[8:],0,0)]))
        with self.assertRaises(p.ProbeError):i.exact_inventory(duplicate,{'probe.bin':(FILE,4096),'extra':(FILE,0)},ROOT,PARENT)

    def test_dot_identity_and_nonrecursive_scope_are_enforced(self):
        for records in [[record('.',b'X'*16,0,0,0x10),record()],[record('nested',b'N'*16,0,0,0x10)]]:
            with self.assertRaises(p.ProbeError):i.exact_inventory(i.page_entries(page(records)),{'probe.bin':(FILE,4096)},ROOT,PARENT)

    def test_unexpected_entry_is_refused_even_when_every_object_is_known_owned(self):
        extra=b'volume01'+b'X'*16;rows=i.page_entries(page([record(),record('unexpected.bin',extra[8:],0,0)]))
        self.assertEqual(i.exact_inventory(rows,{'probe.bin':(FILE,4096),'unexpected.bin':(extra,0)},ROOT,PARENT)['files'],2)
        with self.assertRaises(p.ProbeError) as error:i.exact_inventory(rows,{'probe.bin':(FILE,4096)},ROOT,PARENT)
        self.assertEqual(error.exception.stage,'inventory-unexpected-entry')

    def fixture(self):
        value=i.Fixture.__new__(i.Fixture);value.n=Mock(uncertain=False);value.uncertain=False;value.finished=False;value.file=Mock();value.extra=Mock();p._RETAINED.append(value);return value

    def test_cleanup_retires_all_child_and_parent_guards_before_any_delete(self):
        value=self.fixture();order=[]
        value.extra.guard.release.side_effect=lambda:order.append('extra-guard');value.file.guard.release.side_effect=lambda:order.append('file-guard')
        value.file.directory.lock.release.side_effect=lambda:order.append('parent-guard');value.extra.cleanup.side_effect=lambda:order.append('extra-cleanup') or True;value.file.cleanup.side_effect=lambda:order.append('file-cleanup') or True
        self.assertTrue(value.cleanup());self.assertEqual(order,['extra-guard','file-guard','parent-guard','extra-cleanup','file-cleanup']);self.assertTrue(value.cleanup());self.assertEqual(len(order),5)

    def test_guard_retirement_failure_prevents_all_child_cleanup_and_retry(self):
        value=self.fixture();value.file.guard.release.side_effect=p.ProbeError('test-close')
        with self.assertRaises(p.ProbeError):value.cleanup()
        self.assertTrue(value.n.uncertain);self.assertFalse(value.cleanup());value.extra.cleanup.assert_not_called();value.file.cleanup.assert_not_called();value.file.directory.lock.release.assert_not_called()

    def test_unknown_inventory_or_native_lifetime_prevents_all_cleanup_effects(self):
        value=self.fixture();value.uncertain=True
        self.assertFalse(value.cleanup());value.extra.guard.release.assert_not_called();value.file.cleanup.assert_not_called()
        value.uncertain=False;value.n.uncertain=True;self.assertFalse(value.cleanup());value.file.guard.release.assert_not_called()

    def test_unknown_file_creation_return_retains_reference_and_never_adopts_or_cleans(self):
        native=Mock(uncertain=False);native.private_file.side_effect=KeyboardInterrupt();before=len(p._RETAINED)
        with self.assertRaises(KeyboardInterrupt):i.EmptyOwnedFile(native,42)
        self.assertTrue(native.uncertain);self.assertEqual(len(p._RETAINED),before+1);native.delete_owned.assert_not_called();native.close.assert_not_called()

    def test_freshness_failure_marks_group_uncertain_before_cleanup(self):
        value=self.fixture();value.file.directory.lock.broken.return_value=True
        with self.assertRaises(p.ProbeError):value.fresh()
        self.assertTrue(value.n.uncertain);self.assertFalse(value.cleanup());value.file.cleanup.assert_not_called()

    def test_break_during_final_metadata_is_rechecked_for_every_live_guard(self):
        for role in ('root','file','extra'):
            with self.subTest(role=role):
                value=self.fixture();state={key:False for key in ('root','file','extra')}
                value.file.directory.lock.broken.side_effect=lambda:state['root'];value.file.guard.broken.side_effect=lambda:state['file'];value.extra.guard.broken.side_effect=lambda:state['extra']
                (value.extra if role=='extra' else value.file).owned_content.side_effect=lambda:state.__setitem__(role,True)
                with self.assertRaises(p.ProbeError):value.fresh()
                self.assertTrue(value.n.uncertain);self.assertFalse(value.cleanup());value.file.cleanup.assert_not_called();value.extra.cleanup.assert_not_called()

    def test_uncertainty_set_by_metadata_prevents_further_guard_calls_and_cleanup(self):
        value=self.fixture();value.file.directory.lock.broken.return_value=False;value.file.guard.broken.return_value=False;value.extra.guard.broken.return_value=False
        value.extra.owned_content.side_effect=lambda:setattr(value.n,'uncertain',True)
        with self.assertRaises(p.ProbeError):value.fresh()
        self.assertFalse(value.cleanup());value.file.cleanup.assert_not_called();value.file.directory.lock.broken.assert_called_once()

    def empty_file(self):
        value=i.EmptyOwnedFile.__new__(i.EmptyOwnedFile);value.n=Mock(uncertain=False);value.parent=10;value.creator=None;value.meta=42;value.identity=FILE
        value.initial=(struct.pack('<BBHHH',2,0,8,0,0),p.PRIVATE_CONTROL);value.mutated=False;value.guard=None;value.pending_guard=None;value.guard_request_started=False;value.uncertain=False;value.finished=False;value.create_started=True;value.create_acknowledged=True
        value.n.identity.return_value=FILE;value.n.streams.return_value={i.f.DEFAULT_STREAM:(0,0)};value.n.permissions.return_value=value.initial;value.n.relative.return_value=43;p._RETAINED.append(value);return value

    def test_extra_unknown_identity_or_stream_is_not_eligible_for_cleanup(self):
        for changed in ['identity','stream']:
            value=self.empty_file()
            if changed=='identity':value.n.identity.return_value=b'volume01'+b'X'*16
            else:value.n.streams.return_value={':unknown:$DATA':(0,0)}
            with self.assertRaises(p.ProbeError):value.cleanup()
            self.assertTrue(value.n.uncertain);value.n.delete_owned.assert_not_called();value.n.set_permissions.assert_not_called()

    def test_extra_interrupted_oplock_constructor_does_not_close_or_reuse_pending_handle(self):
        value=self.empty_file()
        with patch.object(p,'Oplock',side_effect=KeyboardInterrupt()),self.assertRaises(KeyboardInterrupt):value.admit()
        self.assertTrue(value.n.uncertain);self.assertFalse(value.cleanup());value.n.close.assert_not_called();value.n.delete_owned.assert_not_called()

    def test_extra_completed_typed_rejection_retires_only_known_pending_handle(self):
        value=self.empty_file()
        with patch.object(p,'Oplock',side_effect=p.OplockNotGranted(801)),self.assertRaises(p.ProbeError):value.admit()
        self.assertFalse(value.n.uncertain);value.n.close.assert_called_once_with(43);self.assertFalse(value.guard_request_started)
        self.assertTrue(value.cleanup());value.n.delete_owned.assert_called_once_with(42)

    def test_incomplete_scan_marks_ownership_uncertain_before_any_cleanup(self):
        value=self.fixture();value.extra=None;value.fresh=Mock();value.file.identity=FILE;value.file.directory.identity=ROOT;value.file.directory.parents=[10]
        value.n.identity.side_effect=[ROOT,PARENT];value.n.entries.side_effect=p.ProbeError('inventory-query')
        with self.assertRaises(p.ProbeError):value.scan()
        self.assertTrue(value.n.uncertain);self.assertFalse(value.cleanup());value.file.cleanup.assert_not_called()

    def test_changed_root_identity_cannot_start_a_scan_or_authorize_cleanup(self):
        value=self.fixture();value.fresh=Mock();value.file.directory.identity=ROOT;value.n.identity.return_value=PARENT
        with self.assertRaises(p.ProbeError):value.scan()
        self.assertTrue(value.n.uncertain);value.n.entries.assert_not_called();self.assertFalse(value.cleanup());value.file.cleanup.assert_not_called()

    def test_changed_second_scan_remains_failed_and_cannot_be_cleaned_as_stable(self):
        native=Mock(uncertain=False);value=Mock(uncertain=False);value.scan.side_effect=[((),{'files':1},ROOT,PARENT),((),{'files':2},ROOT,PARENT)]
        value.cleanup.side_effect=lambda:not value.uncertain
        with patch.object(i,'Fixture',return_value=value):row=i.run_case(native,i.CASES[0])
        self.assertEqual(row['status'],'failed');self.assertEqual(row['failure_stage'],'inventory-changed');self.assertFalse(row['cleanup_confirmed']);self.assertTrue(native.uncertain)

    def test_reports_are_bounded_redacted_and_never_claim_parent_or_restart(self):
        value=json.loads(i.encode({'HIDDEN_VALUE':'x'*9000}));self.assertEqual(value['schema'],i.SCHEMA);self.assertNotIn('HIDDEN_VALUE',json.dumps(value))
        for key in ['retained_data_accessed','model_or_worker_started','restart_admitted','parent_qualification','recursive_tree_qualified','protected_journal_qualified','guardian_crash_qualified']:self.assertFalse(value[key])

    def test_all_cases_cleanup_and_closed_unknown_error_reporting_are_required(self):
        with patch.object(i,'Windows'),patch.object(i,'run_case',side_effect=lambda _n,name:{'case':name,'status':'observed','cleanup_confirmed':True}):value=i.self_test()
        self.assertTrue(value['all_cases_observed']);self.assertFalse(value['parent_qualification'])
        with patch.object(i,'Windows',side_effect=ValueError('HIDDEN_VALUE')):value=i.self_test()
        self.assertNotIn('HIDDEN_VALUE',json.dumps(value));self.assertFalse(value['all_cases_observed'])


if __name__=='__main__':unittest.main()
