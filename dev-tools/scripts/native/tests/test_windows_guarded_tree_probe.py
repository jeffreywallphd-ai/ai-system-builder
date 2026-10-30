"""Pure nested ownership/comparison/cleanup tests; no native effects."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import unittest
from unittest.mock import Mock,patch

spec=importlib.util.spec_from_file_location('guarded_tree',Path(__file__).resolve().parents[1]/'probe_windows_guarded_tree.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t);p=t.p;i=t.i
identity=lambda tag:b'volume01'+tag*16
ROOT=identity(b'R');NESTED=identity(b'N');PARENT=identity(b'P');DATA=identity(b'D');ROOT_EXTRA=identity(b'E');CHILD_EXTRA=identity(b'C')
entry=lambda name,uid,size=0,kind=False:i.Entry(name,uid[8:],size,size,kind)
ROOT_ROWS=(entry('.',ROOT,kind=True),entry('..',PARENT,kind=True),entry('probe.bin',DATA,4096),entry('unexpected.bin',ROOT_EXTRA),entry('nested',NESTED,kind=True))
NESTED_ROWS=(entry('.',NESTED,kind=True),entry('..',ROOT,kind=True),entry('unexpected.bin',CHILD_EXTRA))


class TreeTests(unittest.TestCase):
    def parent(self,native):
        value=p.Fixture.__new__(p.Fixture);value.n=native;value.root=10;value.identity=ROOT;value.uncertain=False;return value

    def native(self):
        value=Mock(uncertain=False);value.private_root.return_value=(11,struct.pack('<BBHHH',2,0,8,0,0));value.relative.return_value=12
        value.identity.side_effect=lambda handle:{10:ROOT,11:NESTED,12:NESTED,13:NESTED}[handle]
        value.permissions.return_value=(value.private_root.return_value[1],p.PRIVATE_CONTROL);return value

    def fixture(self):
        value=t.Fixture.__new__(t.Fixture);value.n=Mock(uncertain=False);value.uncertain=False;value.finished=False
        value.flat=Mock(uncertain=False);value.flat.file=Mock(uncertain=False,identity=DATA);value.flat.file.directory=Mock(uncertain=False,identity=ROOT,root=10,parents=[1]);value.flat.extra=Mock(uncertain=False,identity=ROOT_EXTRA)
        value.nested=Mock(uncertain=False,identity=NESTED);value.nested_file=Mock(uncertain=False,identity=CHILD_EXTRA)
        value.flat.file.directory.lock.handle=30;value.nested.lock.handle=31
        for guard in [value.flat.file.directory.lock,value.nested.lock,value.flat.file.guard,value.flat.extra.guard,value.nested_file.guard]:guard.broken.return_value=False
        value.n.identity.side_effect=lambda handle:{1:PARENT,10:ROOT,30:ROOT,31:NESTED}[handle]
        value.n.entries.side_effect=[ROOT_ROWS,NESTED_ROWS,ROOT_ROWS,NESTED_ROWS]
        value.flat.cleanup.return_value=value.nested_file.cleanup.return_value=value.nested.cleanup.return_value=True
        p._RETAINED.append(value);return value

    def test_default_plan_has_no_native_owner_or_fixture_effect(self):
        for args in ([],['--plan']):
            with patch.object(t,'Windows') as native,patch.object(t,'Owner') as owner,contextlib.redirect_stdout(io.StringIO()) as output:self.assertEqual(t.main(args),0)
            v=json.loads(output.getvalue());self.assertFalse(v['native_effects']);self.assertEqual((v['maximum_directories'],v['maximum_files'],v['maximum_depth'],v['maximum_fixture_data_bytes']),(2,3,2,4096));native.assert_not_called();owner.assert_not_called()

    def test_cli_rejects_paths_commands_pids_and_limits_without_echo(self):
        for args in (['--path','HIDDEN_VALUE'],['--command','HIDDEN_VALUE'],['--pid','5'],['--limit','9999'],['--plan','--self-test']):
            with patch.object(t,'Windows') as native,patch.object(t,'Owner') as owner,contextlib.redirect_stderr(io.StringIO()) as output:
                with self.assertRaises(SystemExit):t.main(args)
            self.assertNotIn('HIDDEN_VALUE',output.getvalue());native.assert_not_called();owner.assert_not_called()

    def test_nested_creation_uses_only_fixed_name_and_own_new_handles(self):
        native=self.native();parent=self.parent(native);value=t.NestedDirectory(native,parent)
        native.private_root.assert_called_once_with(10,'nested');native.relative.assert_called_once_with(10,'nested',0x60080)
        self.assertIs(value.parent,parent);self.assertEqual(value.parents,[10]);self.assertTrue(value.create_acknowledged)
        self.assertTrue(value.cleanup());self.assertNotIn(10,[call.args[0] for call in native.close.call_args_list])

    def test_invalid_or_uncertain_parent_denies_before_creation(self):
        native=self.native()
        for parent in [None,Mock(),self.parent(native)]:
            if isinstance(parent,p.Fixture):parent.uncertain=True
            with self.assertRaises(p.ProbeError):t.NestedDirectory(native,parent)
        native.private_root.assert_not_called();native.delete_owned.assert_not_called()

    def test_changed_parent_identity_cannot_create_or_adopt_a_child(self):
        native=self.native();native.identity.side_effect=None;native.identity.return_value=PARENT
        with self.assertRaises(p.ProbeError):t.NestedDirectory(native,self.parent(native))
        native.private_root.assert_not_called();native.close.assert_not_called();self.assertTrue(native.uncertain)

    def test_interrupted_child_creation_retains_custody_and_never_cleans_partial_output(self):
        native=self.native();native.private_root.side_effect=KeyboardInterrupt();before=len(p._RETAINED)
        with self.assertRaises(KeyboardInterrupt):t.NestedDirectory(native,self.parent(native))
        self.assertTrue(native.uncertain);self.assertEqual(len(p._RETAINED),before+1);native.delete_owned.assert_not_called();native.close.assert_not_called()

    def test_alias_parent_or_child_handles_are_not_accepted_as_new_custody(self):
        for root,mutator in [(10,12),(11,10),(11,11)]:
            native=self.native();native.private_root.return_value=(root,native.private_root.return_value[1]);native.relative.return_value=mutator
            with self.assertRaises(p.ProbeError):t.NestedDirectory(native,self.parent(native))
            self.assertTrue(native.uncertain);native.close.assert_not_called();native.delete_owned.assert_not_called()

    def test_nested_cleanup_never_closes_borrowed_parent_and_is_idempotent(self):
        native=self.native();value=t.NestedDirectory(native,self.parent(native))
        self.assertTrue(value.cleanup());self.assertTrue(value.cleanup());self.assertEqual([call.args[0] for call in native.close.call_args_list],[12,11]);native.delete_owned.assert_called_once_with(11)

    def test_lost_borrowed_parent_identity_prevents_all_cleanup_effects(self):
        native=self.native();value=t.NestedDirectory(native,self.parent(native));native.identity.side_effect=lambda handle:PARENT if handle==10 else NESTED
        with self.assertRaises(p.ProbeError):value.cleanup()
        self.assertTrue(native.uncertain);native.delete_owned.assert_not_called();native.close.assert_not_called()

    def test_changed_owned_child_identity_is_not_deleted(self):
        native=self.native();value=t.NestedDirectory(native,self.parent(native));native.identity.side_effect=lambda handle:ROOT if handle==10 else PARENT
        with self.assertRaises(p.ProbeError):value.cleanup()
        native.delete_owned.assert_not_called();native.close.assert_not_called();self.assertTrue(native.uncertain)

    def test_unknown_nested_guard_handoff_preserves_parent_child_and_pending_handle(self):
        native=self.native();value=t.NestedDirectory(native,self.parent(native));native.relative.return_value=13
        with patch.object(p,'Oplock',side_effect=KeyboardInterrupt()),self.assertRaises(KeyboardInterrupt):value.guard()
        self.assertFalse(value.cleanup());self.assertTrue(native.uncertain);native.close.assert_not_called();native.delete_owned.assert_not_called()

    def test_fixed_directory_mapping_checks_native_children_and_parent_dot_identity(self):
        result=t.directory_inventory(ROOT_ROWS,{'probe.bin':(DATA,4096),'unexpected.bin':(ROOT_EXTRA,0)},{'nested':NESTED},ROOT,PARENT)
        self.assertEqual(result,{'files':2,'logical_bytes':4096,'allocation_bytes':4096,'directories':1})
        with self.assertRaises(p.ProbeError):t.directory_inventory(ROOT_ROWS,{'probe.bin':(DATA,4096),'unexpected.bin':(ROOT_EXTRA,0)},{'nested':NESTED},ROOT,DATA)

    def test_unexpected_directory_wrong_directory_identity_and_duplicate_names_deny(self):
        for rows,directories in [(ROOT_ROWS,{}),(ROOT_ROWS,{'nested':ROOT}),(ROOT_ROWS+(entry('NESTED',NESTED,kind=True),),{'nested':NESTED})]:
            with self.assertRaises(p.ProbeError):t.directory_inventory(rows,{'probe.bin':(DATA,4096),'unexpected.bin':(ROOT_EXTRA,0)},directories,ROOT,PARENT)

    def test_identical_leaf_name_and_size_do_not_substitute_a_different_parent_file(self):
        self.assertEqual(t.directory_inventory(NESTED_ROWS,{'unexpected.bin':(CHILD_EXTRA,0)},{},NESTED,ROOT)['files'],1)
        with self.assertRaises(p.ProbeError) as error:t.directory_inventory(NESTED_ROWS,{'unexpected.bin':(ROOT_EXTRA,0)},{},NESTED,ROOT)
        self.assertEqual(error.exception.stage,'inventory-entry-mismatch')

    def test_known_tree_scans_include_both_directories_and_all_three_files(self):
        value=self.fixture();first=value.scan();second=value.scan()
        self.assertEqual(first,second);self.assertEqual((first.files,first.directories,first.logical,first.allocated),(3,2,4096,4096))
        self.assertEqual([call.args[0] for call in value.n.entries.call_args_list],[30,31,30,31])

    def test_unknown_nested_listing_or_object_alias_denies_all_cleanup(self):
        for kind in ['unknown','alias']:
            value=self.fixture()
            if kind=='unknown':value.n.entries.side_effect=[ROOT_ROWS,NESTED_ROWS+(entry('other',identity(b'X')),)]
            else:value.nested_file.identity=ROOT_EXTRA
            with self.assertRaises(p.ProbeError):value.scan()
            self.assertFalse(value.cleanup());self.assertTrue(value.n.uncertain);value.flat.cleanup.assert_not_called();value.nested.cleanup.assert_not_called()

    def test_broken_guard_during_final_metadata_cannot_be_missed_for_any_node(self):
        for number in range(5):
            value=self.fixture();state=[False]*5;guards=[value.flat.file.directory.lock,value.nested.lock,value.flat.file.guard,value.flat.extra.guard,value.nested_file.guard]
            for index,guard in enumerate(guards):guard.broken.side_effect=lambda index=index:state[index]
            value.nested_file.owned_content.side_effect=lambda:state.__setitem__(number,True)
            with self.assertRaises(p.ProbeError):value.fresh()
            self.assertFalse(value.cleanup());value.flat.cleanup.assert_not_called();value.nested_file.cleanup.assert_not_called()

    def test_all_guards_retire_before_child_deletion_and_parent_remains_open(self):
        value=self.fixture();order=[]
        for guard,name in [(value.nested_file.guard,'nested-file-guard'),(value.flat.extra.guard,'root-extra-guard'),(value.flat.file.guard,'data-guard'),(value.nested.lock,'nested-guard'),(value.flat.file.directory.lock,'root-guard')]:guard.release.side_effect=lambda name=name:order.append(name)
        value.nested_file.cleanup.side_effect=lambda:order.append('nested-file-delete') or True;value.nested.cleanup.side_effect=lambda:order.append('nested-delete') or True;value.flat.cleanup.side_effect=lambda:order.append('root-cleanup') or True
        self.assertTrue(value.cleanup());self.assertEqual(order,['nested-file-guard','root-extra-guard','data-guard','nested-guard','root-guard','nested-file-delete','nested-delete','root-cleanup']);self.assertTrue(value.cleanup());self.assertEqual(len(order),8)
        value.n.identity.assert_called_with(10)

    def test_guard_release_failure_prevents_any_child_cleanup_or_retry(self):
        value=self.fixture();value.nested.lock.release.side_effect=p.ProbeError('test-release')
        with self.assertRaises(p.ProbeError):value.cleanup()
        self.assertTrue(value.n.uncertain);self.assertFalse(value.cleanup());value.nested_file.cleanup.assert_not_called();value.nested.cleanup.assert_not_called();value.flat.cleanup.assert_not_called()

    def test_lost_parent_after_nested_cleanup_prevents_root_cleanup(self):
        value=self.fixture();value.n.identity.side_effect=None;value.n.identity.return_value=PARENT
        with self.assertRaises(p.ProbeError):value.cleanup()
        self.assertTrue(value.n.uncertain);value.flat.cleanup.assert_not_called()

    def test_unknown_tree_lifetime_refuses_every_cleanup_effect(self):
        value=self.fixture();value.n.uncertain=True
        self.assertFalse(value.cleanup());value.nested_file.guard.release.assert_not_called();value.flat.cleanup.assert_not_called()

    def test_unknown_prepare_close_result_prevents_all_cleanup_or_retry(self):
        value=self.fixture();value.flat.file.close_creator.side_effect=KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):value.prepare()
        self.assertTrue(value.n.uncertain);self.assertFalse(value.cleanup());value.nested_file.guard.release.assert_not_called();value.flat.cleanup.assert_not_called()

    def test_native_close_failure_marks_shared_adapter_uncertain(self):
        for outcome in [0,KeyboardInterrupt()]:
            native=t.Windows.__new__(t.Windows);native.uncertain=False;native.k=Mock()
            if isinstance(outcome,BaseException):native.k.CloseHandle.side_effect=outcome
            else:native.k.CloseHandle.return_value=outcome
            with patch.object(t.C,'get_last_error',create=True,return_value=6),self.assertRaises(BaseException):native.close(11)
            self.assertTrue(native.uncertain);native.k.CloseHandle.assert_called_once_with(11)

    def test_guard_failures_name_only_the_fixed_role_and_checkpoint(self):
        for number,role in enumerate(t.GUARD_ROLES):
            value=self.fixture();guards=value.guards();guards[number].broken.return_value=True
            with self.assertRaises(p.ProbeError) as error:value.live_guards()
            self.assertEqual(error.exception.stage,'tree-guard-break-'+role)
            value.prepare=Mock()
            with patch.object(t,'Fixture',return_value=value):row=t.run_case(value.n,t.CASES[0])
            self.assertEqual(row['failure_stage'],'tree-guard-break-'+role);self.assertEqual(row['guard_checkpoint'],'scan-start')
            self.assertFalse(row['cleanup_confirmed']);self.assertNotIn('HIDDEN_VALUE',json.dumps(row))

    def test_setup_stops_at_the_first_broken_acquired_guard(self):
        value=self.fixture();value.flat.file.admit.return_value={'denied':False}
        value.nested.guard.side_effect=lambda:setattr(value.flat.file.directory.lock.broken,'return_value',True)
        with self.assertRaises(p.ProbeError) as error:value.prepare()
        self.assertEqual(error.exception.stage,'tree-guard-break-root');self.assertEqual(value.checkpoint,'prepare-nested-guard')
        value.flat.file.admit.assert_not_called();value.nested_file.admit.assert_not_called();self.assertFalse(value.cleanup())

    def test_both_case_oracles_use_complete_equal_scans_and_comparison_only_refusal(self):
        for name in t.CASES:
            value=self.fixture();value.prepare=Mock()
            with patch.object(t,'Fixture',return_value=value):row=t.run_case(value.n,name)
            self.assertEqual(row['status'],'observed');self.assertTrue(row['cleanup_confirmed']);self.assertEqual(row['known_files'],3)
            if name==t.CASES[1]:self.assertTrue(row['cross_directory_identity_mismatch_denied']);self.assertEqual(row['denial_kind'],'parent-specific-metadata-comparison')

    def test_changed_second_snapshot_cannot_be_turned_into_successful_cleanup(self):
        value=self.fixture();value.prepare=Mock();snapshot=value.scan();value.scan=Mock(side_effect=[snapshot,snapshot._replace(logical=0)])
        with patch.object(t,'Fixture',return_value=value):row=t.run_case(value.n,t.CASES[0])
        self.assertEqual(row['status'],'failed');self.assertEqual(row['failure_stage'],'tree-inventory-changed');self.assertFalse(row['cleanup_confirmed'])

    def test_bounded_error_reports_never_publish_identifiers_or_parent_qualification(self):
        value=json.loads(t.encode({'HIDDEN_VALUE':'x'*9000}));self.assertNotIn('HIDDEN_VALUE',json.dumps(value));self.assertEqual(value['schema'],t.SCHEMA)
        for key in ['retained_data_accessed','model_or_worker_started','restart_admitted','parent_qualification','general_tree_protection_qualified','inherited_acl_qualified','protected_journal_qualified','guardian_crash_qualified']:self.assertFalse(value[key])

    def test_all_cases_and_cleanup_are_required_and_unknown_failures_are_redacted(self):
        with patch.object(t,'Windows'),patch.object(t,'run_case',side_effect=lambda _n,name:{'case':name,'status':'observed','cleanup_confirmed':True}):value=t.self_test()
        self.assertTrue(value['all_cases_observed']);self.assertFalse(value['parent_qualification'])
        with patch.object(t,'Windows',side_effect=ValueError('HIDDEN_VALUE')):value=t.self_test()
        self.assertNotIn('HIDDEN_VALUE',json.dumps(value));self.assertFalse(value['all_cases_observed'])


if __name__=='__main__':unittest.main()
