"""Exact native component routing; physical and model tests stay separate."""
from pathlib import Path
import sys
import subprocess
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

    def test_container_document_scope_keeps_abi_contracts_and_explicit_file_boundary(self):
        checks=self.select(list(catalog.NATIVE_TRAINING_FILE_SCOPE + catalog.NATIVE_TRAINING_CONTAINER_DOCUMENTS))
        self.assertIn('native-training-result-store-abi',checks)
        self.assertIn('native-training-result-files-contract',checks)
        self.assertNotIn('native-training-result-files',checks)
        self.assertEqual(checks['focused-tests']['argv'],['node',self.scope[2]])
        self.assertIn('test_control_plane_windows_training_result_store.',checks['control-plane']['argv'])

    def test_native_documentation_uses_passive_existing_contracts_without_effects(self):
        for paths in ([self.scope[1]], list(catalog.NATIVE_TRAINING_DOCUMENT_SCOPE)):
            checks=self.select(paths)
            self.assertEqual(checks['focused-tests']['argv'],['node',self.scope[2]])
            self.assertNotIn('native-training-result-store-abi',checks)
            self.assertNotIn('native-training-result-store-build-unit',checks)
            self.assertNotIn('native-training-result-files',checks)
            self.assertFalse(any('--native-abi' in check['argv'] or '--run' in check['argv'] for check in checks.values()))
        explicit=self.select([self.scope[1]],required=['native-training-result-files'])
        self.assertIn('native-training-result-files',explicit,'An explicit physical check is never removed.')
        explicit=self.select(['dev-tools/helpers/README.md'],required=['control-plane'])
        self.assertNotIn('test_control_plane_windows_training_result_store.',explicit['control-plane']['argv'])

    def test_native_documentation_routing_pair_runs_both_complete_regression_modules(self):
        paths=list(catalog.NATIVE_TRAINING_DOCUMENT_SCOPE + catalog.NATIVE_TRAINING_DOCUMENT_ROUTING_CORE)
        checks=self.select(paths,required=['control-plane'])
        self.assertEqual(checks['focused-tests']['argv'],['node',self.scope[2]])
        self.assertIn('test_control_plane_windows_training_result_store.',checks['control-plane']['argv'])
        self.assertIn('test_control_plane_focused.',checks['control-plane']['argv'])
        self.assertNotIn('native-training-result-store-abi',checks)
        self.assertNotIn('native-training-result-files',checks)

    def test_native_documentation_route_executes_the_existing_passive_contracts(self):
        checks=self.select([self.scope[1]])
        argv=checks['focused-tests']['argv']
        self.assertEqual(argv,['node',self.scope[2]])
        with tempfile.TemporaryFile() as output:
            result=subprocess.run(argv,cwd=self.root,stdout=output,stderr=subprocess.STDOUT,timeout=60,check=False)
            output.seek(0);detail=output.read(65537)
        self.assertLessEqual(len(detail),65536)
        self.assertEqual(result.returncode,0,detail.decode('utf8',errors='replace'))

    def test_native_documentation_rule_does_not_cover_source_unknown_or_incomplete_routing(self):
        code=self.select([self.scope[1],self.scope[0]])
        self.assertIn('native-training-result-store-abi',code)
        self.assertIn('native-training-result-store-build-unit',code)
        for extra in ('modules/unknown/current.ts','docs/adr/unknown.md',self.scope[6]):
            checks=self.select([self.scope[1],extra])
            self.assertIn('run_focused_checks.py',' '.join(checks['focused-tests']['argv']))
        mixed=self.select(list(catalog.NATIVE_TRAINING_DOCUMENT_ROUTING_CORE)+[self.scope[1],'modules/unknown/current.ts'])
        self.assertNotIn('test_control_plane_windows_training_result_store.',mixed['control-plane']['argv'])
        self.assertIn('run_focused_checks.py',' '.join(mixed['focused-tests']['argv']))

    def test_native_documentation_missing_contract_support_keeps_fallback(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            for path in self.scope:
                if path==self.scope[2]:continue
                target=root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((self.root/path).read_bytes())
            checks=self.select([self.scope[1]],root)
            self.assertIn('run_focused_checks.py',' '.join(checks['focused-tests']['argv']))

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
