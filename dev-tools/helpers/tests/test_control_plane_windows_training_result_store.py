"""Exact native component routing; physical and model tests stay separate."""
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class NativeTrainingStoreRoutingTests(unittest.TestCase):
    root=Path(__file__).resolve().parents[3]
    scope=catalog.NATIVE_TRAINING_RESULT_SCOPE

    def select(self,paths,root=None,required=None):
        return {c['id']:c for c in catalog.plan(root or self.root,paths,required or ['focused-tests'],'a'*64)['selected']}

    def test_closed_scope_selects_real_abi_and_build_regressions(self):
        checks=self.select(list(self.scope))
        self.assertEqual(checks['native-training-result-store-abi']['argv'],['node',self.scope[2],'--native-abi'])
        self.assertEqual(checks['native-training-result-store-build-unit']['argv'],[sys.executable,'-B',self.scope[4]])
        self.assertEqual(checks['focused-tests']['argv'],['node',self.scope[2]])
        self.assertIn('dependencies',checks)
        self.assertIn('test_control_plane_focused.',checks['control-plane']['argv'])
        self.assertFalse(any('test:all' in str(arg) or 'model-blocker' in str(arg) for check in checks.values() for arg in check['argv']))

    def test_missing_support_never_substitutes_a_native_pass(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            for path in self.scope:
                if path==self.scope[2]: continue
                target=root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((self.root/path).read_bytes())
            checks=self.select([self.scope[0]],root)
            self.assertNotIn('native-training-result-store-abi',checks)
            self.assertIn('run_focused_checks.py',' '.join(checks['focused-tests']['argv']))

    def test_unknown_mixed_scope_and_explicit_controller_keep_broad_guards(self):
        checks=self.select([self.scope[0],self.scope[6],'modules/unknown/current.ts'])
        self.assertIn('run_focused_checks.py',' '.join(checks['focused-tests']['argv']))
        self.assertNotIn('test_control_plane_windows_training_result_store.',checks['control-plane']['argv'])

    def test_native_file_effects_require_explicit_check_and_contract_tests_are_passive(self):
        checks=self.select(list(catalog.NATIVE_TRAINING_FILE_SCOPE))
        self.assertIn('native-training-result-files-contract',checks)
        self.assertNotIn('native-training-result-files',checks)
        self.assertEqual(checks['native-training-result-files-contract']['argv'],[sys.executable,'-B',catalog.NATIVE_TRAINING_FILE_FEATURE[2]])
        self.assertEqual(checks['focused-tests']['argv'],['node',self.scope[2]])
        selected=self.select(list(catalog.NATIVE_TRAINING_FILE_SCOPE),required=['native-training-result-files'])
        self.assertEqual(selected['native-training-result-files']['argv'],[sys.executable,'-B',catalog.NATIVE_TRAINING_FILE_FEATURE[1],'--run'])
        self.assertIn('test_control_plane_windows_training_result_store.',checks['control-plane']['argv'])

    def test_missing_native_file_contract_support_preserves_generic_fallback(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            for path in catalog.NATIVE_TRAINING_FILE_SCOPE:
                if path==catalog.NATIVE_TRAINING_FILE_FEATURE[2]:continue
                target=root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((self.root/path).read_bytes())
            checks=self.select(list(catalog.NATIVE_TRAINING_FILE_FEATURE),root)
            self.assertNotIn('native-training-result-files-contract',checks)
            self.assertNotIn('native-training-result-files',checks)
            self.assertIn('run_focused_checks.py',' '.join(checks['focused-tests']['argv']))
        checks=self.select(list(self.scope),required=['control-plane'])
        self.assertNotIn('test_control_plane_windows_training_result_store.',checks['control-plane']['argv'])


if __name__=='__main__': unittest.main()
