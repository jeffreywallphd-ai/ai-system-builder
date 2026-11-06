"""Source-owned mixed Python collection must execute tests, never skip a style."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_focused_checks as focused
from control_plane import catalog


class FocusedPythonCollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def put(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return name

    def test_function_fixture_routes_to_exact_pytest_without_import_heuristic(self):
        name = self.put('modules/adapters/example/test_fixture.py', 'def test_value(tmp_path, monkeypatch):\n    assert tmp_path\n')
        command = focused.python_test_command(self.root, name)
        self.assertEqual(command[:4], [sys.executable, '-B', '-m', 'pytest'])
        self.assertEqual(command[-2:], ['--', name])
        self.assertIn('--noconftest', command)
        self.assertIn('no:cacheprovider', command)
        self.assertIn('dev-tools/config/pytest-focused.ini', command)

    def test_class_based_unittest_keeps_original_discovery(self):
        name = self.put('modules/adapters/example/test_class.py', 'import unittest\nclass Cases(unittest.TestCase):\n    def test_value(self): pass\n')
        self.assertEqual(focused.python_test_command(self.root, name), [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'modules/adapters/example', '-p', 'test_class.py'])

    def test_pytest_import_alone_does_not_switch_unittest_collection(self):
        name = self.put('modules/adapters/example/test_class.py', 'import pytest\nimport unittest\nclass Cases(unittest.TestCase):\n    def test_value(self): pass\n')
        self.assertIn('unittest', focused.python_test_command(self.root, name))

    def test_invalid_source_is_not_guessed_or_executed(self):
        name = self.put('modules/adapters/example/test_invalid.py', 'def test_invalid(:\n')
        with self.assertRaises(SyntaxError): focused.python_test_command(self.root, name)

    def test_bounded_owner_selection_keeps_all_controlled_python_files_excluded(self):
        names = [self.put('modules/adapters/example/' + name, 'def test_value(): pass\n') for name in (
            'test_normal.py', 'test_constrained_json_outlines_integration.py', 'test_context_generation_ai_e2e.py',
            'test_model_training_task_matrix_e2e.py', 'test_bounded_model_loader_native.py', 'test_bounded_model_loader.py')]
        foreign = self.put('modules/adapters/foreign/test_other.py', 'def test_value(): pass\n')
        with patch.object(focused, 'snapshot', return_value={'files': dict.fromkeys([*names, foreign], 'fixture')}):
            commands = focused.commands(self.root, [names[0]])
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0][-1], names[0])

    def test_every_controlled_python_file_is_denied_by_exact_and_profile_selection(self):
        import json
        from control_plane.contracts import ControlError
        for name in ('test_constrained_json_outlines_integration.py', 'test_context_generation_ai_e2e.py',
                     'test_model_training_task_matrix_e2e.py', 'test_bounded_model_loader_native.py', 'test_bounded_model_loader.py'):
            path = self.put('modules/adapters/example/' + name, 'def test_value(): pass\n')
            self.put('dev-tools/config/contributor-check-profiles.json', json.dumps({
                'schema_version': 'contributor-check-profiles-v1',
                'profiles': {'owned': {'test_paths': [path], 'source_paths': [path]}}}))
            with self.subTest(name=name), patch.object(focused, 'snapshot', return_value={'files': {path: 'fixture'}}):
                with self.assertRaises(ControlError):
                    focused.commands(self.root, [path], exact=True)
                with self.assertRaises(ControlError):
                    focused.profile_commands(self.root, 'owned')

    def test_environment_removes_all_ambient_pytest_controls_without_mutating_input(self):
        source = {'PATH': 'fixture', 'PYTEST_ADDOPTS': '-p evil --pdb', 'PYTEST_PLUGINS': 'evil', 'PYTEST_CURRENT_TEST': 'foreign', 'pytest_debug': '1', 'PYTHONOPTIMIZE': '2'}
        result = focused.pytest_environment(source)
        self.assertEqual(result, {'PATH': 'fixture', 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1'})
        self.assertIn('PYTEST_ADDOPTS', source)

    def test_registered_profiles_exclude_every_controlled_python_test(self):
        import json
        root = Path(__file__).resolve().parents[3]
        profiles = json.loads((root / 'dev-tools/config/contributor-check-profiles.json').read_bytes())['profiles']
        violations = [(name, path) for name, profile in profiles.items() for path in profile['test_paths']
                      if Path(path).name in focused.CONTROLLED_PYTHON_TESTS]
        self.assertEqual(violations, [])

    def test_model_download_profile_runs_only_the_exact_ownership_tests(self):
        root = Path(__file__).resolve().parents[3]
        profile = 'model-download-ownership'
        adapter = 'modules/adapters/runtime/python/createPythonRuntimeTaskRegistryAdapter.ts'
        tests = [
            'modules/adapters/runtime/python/tests/createPythonRuntimeTaskRegistryAdapter.unit.test.ts',
            'modules/application/use-cases/model/tests/model-download-tasks.use-case.unit.test.ts',
        ]
        with patch.object(focused, 'snapshot', return_value={'files': dict.fromkeys(tests, 'fixture')}):
            self.assertEqual(focused.profile_commands(root, profile), [['node', '--import', 'tsx', '--test', '--', *tests]])

        config = 'dev-tools/config/contributor-check-profiles.json'
        owned = [adapter, config, tests[0], 'modules/adapters/runtime/python/README.md']
        plan = catalog.plan(root, owned, ['architecture'], 'synthetic')
        self.assertIn(profile, [check['id'] for check in plan['selected']])
        self.assertNotIn('focused-tests', [check['id'] for check in plan['selected']])

        unrelated = 'modules/adapters/runtime/python/createPythonRuntimePort.ts'
        plan = catalog.plan(root, [*owned, unrelated], ['architecture'], 'synthetic')
        self.assertIn('focused-tests', [check['id'] for check in plan['selected']])

    def test_functionality_profile_plans_fake_coverage_and_keeps_native_source_responsibility(self):
        import json
        root = Path(__file__).resolve().parents[3]
        profile = json.loads((root / 'dev-tools/config/contributor-check-profiles.json').read_bytes())['profiles']['functionality-outcomes']
        pure = 'dev-tools/scripts/qualification/tests/test_offload_supplier_boundary.py'
        native = ['modules/adapters/runtime/python/worker/tests/test_bounded_model_loader.py',
                  'modules/adapters/runtime/python/worker/tests/test_bounded_model_loader_native.py']
        self.assertIn(pure, profile['test_paths'])
        self.assertIn(pure, profile['source_paths'])
        for path in native:
            self.assertIn(path, profile['source_paths'])
            self.assertNotIn(path, profile['test_paths'])
        # Planning inspects source and returns commands; it does not execute them.
        commands = focused.profile_commands(root, 'functionality-outcomes')
        self.assertIn(focused.python_test_command(root, pure), commands)
        self.assertTrue(all(path not in command for command in commands for path in native))

    def test_fake_supplier_suite_retains_every_legacy_pure_case_without_native_collection(self):
        import importlib.util
        root = Path(__file__).resolve().parents[3]
        spec = importlib.util.spec_from_file_location('fake_supplier_collection_probe',
            root / 'dev-tools/scripts/qualification/tests/test_offload_supplier_boundary.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        loader = unittest.defaultTestLoader
        expected = set(loader.getTestCaseNames(module.fixtures.GenerationBoundsTests))
        expected.update(loader.getTestCaseNames(module.fixtures.PinnedLoaderBoundaryTests))
        native = {'test_pinned_supplier_exact_alias_lookup_reads_the_canonical_tensor',
                  'test_meta_tie_sentinel_is_removed_without_touching_real_tied_storage'}
        expected.update(set(loader.getTestCaseNames(module.fixtures.SafeDiskAliasTests)) - native)
        def cases(suite):
            for item in suite:
                if isinstance(item, unittest.TestSuite): yield from cases(item)
                else: yield item._testMethodName
        actual = set(cases(loader.loadTestsFromModule(module)))
        self.assertEqual(len(expected), 19)
        self.assertTrue(expected <= actual, sorted(expected - actual))
        self.assertTrue(actual.isdisjoint(native))

    def test_optimized_parent_is_refused_before_planning_or_execution(self):
        with patch.object(focused.sys, 'flags', SimpleNamespace(optimize=1)), patch.object(focused, 'commands') as commands, patch.object(focused.subprocess, 'run') as run:
            self.assertEqual(focused.main(), 1)
            commands.assert_not_called()
            run.assert_not_called()

    def test_plain_unittest_child_does_not_inherit_optimization(self):
        with patch.dict(focused.os.environ, {'PYTHONOPTIMIZE': '2'}), patch.object(sys, 'argv', ['focused', '--regression-test', 'modules/adapters/example/test.py']), patch.object(focused, 'commands', return_value=[[sys.executable, '-m', 'unittest']]), patch.object(focused.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            self.assertEqual(focused.main(), 0)
            self.assertNotIn('PYTHONOPTIMIZE', run.call_args.kwargs['env'])

    def test_main_preserves_failed_and_empty_collection_exit_codes(self):
        for code in (1, 5):
            with self.subTest(code=code), patch.object(sys, 'argv', ['focused', '--regression-test', 'modules/adapters/example/test.py']), patch.object(focused, 'commands', return_value=[[sys.executable, '-m', 'pytest']]), patch.object(focused, 'pytest_tooling_ready', return_value=True), patch.object(focused.subprocess, 'run', return_value=type('Result', (), {'returncode': code})()) as run:
                self.assertEqual(focused.main(), code)
                self.assertEqual(run.call_args.kwargs['env']['PYTEST_DISABLE_PLUGIN_AUTOLOAD'], '1')

    def test_missing_or_wrong_tooling_refuses_without_install_or_test_execution(self):
        with patch.object(sys, 'argv', ['focused', '--regression-test', 'modules/adapters/example/test.py']), patch.object(focused, 'commands', return_value=[[sys.executable, '-m', 'pytest']]), patch.object(focused, 'pytest_tooling_ready', return_value=False), patch.object(focused.subprocess, 'run') as run:
            self.assertEqual(focused.main(), 1)
            run.assert_not_called()

    def test_tooling_readiness_requires_hash_policy_exact_versions_and_known_markers(self):
        name = 'dev-tools/helpers/requirements-tests.txt'
        valid = '--only-binary=:all:\n--require-hashes\npytest==9.1.1 --hash=sha256:' + 'a' * 64 + '\n'
        self.put(name, valid)
        with patch.object(focused.importlib.metadata, 'version', return_value='9.1.1'):
            self.assertTrue(focused.pytest_tooling_ready(self.root))
        for value in (valid.replace('--require-hashes\n', ''), valid.replace('9.1.1', '9.1.2'), valid + valid.splitlines()[-1] + '\n', valid.replace(' --hash', '; unknown == "yes" --hash'), valid.replace(' --hash', '; python_version < "3.11" --hash')):
            self.put(name, value)
            with patch.object(focused.importlib.metadata, 'version', return_value='9.1.1'):
                self.assertFalse(focused.pytest_tooling_ready(self.root))
        self.put(name, valid)
        for result in ('wrong', focused.importlib.metadata.PackageNotFoundError('pytest')):
            with patch.object(focused.importlib.metadata, 'version', side_effect=result if isinstance(result, Exception) else None, return_value=result):
                self.assertFalse(focused.pytest_tooling_ready(self.root))

    def test_fixed_config_and_lock_are_controller_inputs_without_waiving_other_owners(self):
        plan = catalog.plan(self.root, ['dev-tools/config/pytest-focused.ini', 'dev-tools/helpers/requirements-tests.txt'], ['control-plane'], 'fixture')
        self.assertEqual(plan['coverage']['dev-tools/config/pytest-focused.ini'], ['control-plane'])
        self.assertIn('dependencies', plan['coverage']['dev-tools/helpers/requirements-tests.txt'])
        self.assertNotIn('focused-tests', [row['id'] for row in plan['selected']])
        other = catalog.plan(self.root, ['dev-tools/config/other.ini'], ['control-plane'], 'fixture')
        self.assertIn('focused-tests', other['coverage']['dev-tools/config/other.ini'])

    def test_semantic_curation_profile_covers_only_its_declared_runtime_paths(self):
        import json
        root = Path(__file__).resolve().parents[3]
        data = json.loads((root / 'dev-tools/config/contributor-check-profiles.json').read_bytes())
        profile = data['profiles']['dataset-semantic-curation']
        tests = {
            'modules/adapters/runtime/python/worker/tests/test_semantic_curation.py',
            'modules/adapters/runtime/python/worker/tests/test_advanced_dataset_preparation.py',
            'modules/adapters/runtime/python/worker/tests/test_dataset_quality.py',
        }
        self.assertEqual(set(profile['test_paths']), tests)
        owned = [
            'modules/adapters/runtime/python/worker/tasks/semantic_curation.py',
            'modules/adapters/runtime/python/worker/tests/test_semantic_curation.py',
            'modules/adapters/runtime/python/worker/README.md',
        ]
        self.assertTrue(set(owned).issubset(profile['source_paths']))
        plan = catalog.plan(root, owned, ['control-plane'], 'fixture')
        self.assertIn('dataset-semantic-curation', [row['id'] for row in plan['selected']])
        self.assertNotIn('focused-tests', [row['id'] for row in plan['selected']])
        other = catalog.plan(root, [*owned,
            'modules/adapters/runtime/python/worker/tasks/unowned_task.py'],
            ['control-plane'], 'fixture')
        self.assertIn('focused-tests', [row['id'] for row in other['selected']])

    def test_profile_reuses_one_source_view_and_preserves_exact_commands(self):
        import json
        node = self.put('modules/adapters/example/owned.unit.test.mjs', "import test from 'node:test';\n")
        python = self.put('modules/adapters/example/test_owned.py', 'import unittest\nclass Cases(unittest.TestCase): pass\n')
        files = {node: 'fixture', python: 'fixture'}
        self.put('dev-tools/config/contributor-check-profiles.json', json.dumps({
            'schema_version': 'contributor-check-profiles-v1',
            'profiles': {'owned': {'test_paths': [python, node], 'source_paths': [python, node]}}}))
        with patch.object(focused, 'snapshot', return_value={'files': files}) as snapshots:
            direct = focused.commands(self.root, [python, node], exact=True)
            snapshots.assert_called_once_with(self.root)
        with patch.object(focused, 'snapshot', return_value={'files': files}) as snapshots:
            self.assertEqual(focused.profile_commands(self.root, 'owned'), direct)
            snapshots.assert_called_once_with(self.root)

    def test_profile_and_direct_planning_do_not_cache_across_calls(self):
        import json
        from control_plane.contracts import ControlError
        node = self.put('modules/adapters/example/owned.unit.test.mjs', "import test from 'node:test';\n")
        self.put('dev-tools/config/contributor-check-profiles.json', json.dumps({
            'schema_version': 'contributor-check-profiles-v1',
            'profiles': {'owned': {'test_paths': [node], 'source_paths': [node]}}}))
        with patch.object(focused, 'snapshot', side_effect=[{'files': {node: 'fixture'}}, {'files': {}}, {'files': {}}]) as snapshots:
            self.assertEqual(focused.profile_commands(self.root, 'owned'), [['node', '--test', '--', node]])
            with self.assertRaises(ControlError): focused.profile_commands(self.root, 'owned')
            with self.assertRaises(ControlError): focused.commands(self.root, [node], exact=True)
            self.assertEqual(snapshots.call_args_list, [unittest.mock.call(self.root)] * 3)

    def test_profile_single_view_still_rejects_ai_missing_and_escaping_tests(self):
        import json
        from control_plane.contracts import ControlError
        ai = self.put('modules/adapters/example/ai.unit.test.mjs', '// @test-suite ai\n')
        cases = [(ai, {ai: 'fixture'}), ('modules/adapters/example/missing.unit.test.mjs', {}),
                 ('../escape.unit.test.mjs', {'../escape.unit.test.mjs': 'fixture'})]
        for name, files in cases:
            self.put('dev-tools/config/contributor-check-profiles.json', json.dumps({
                'schema_version': 'contributor-check-profiles-v1',
                'profiles': {'owned': {'test_paths': [name], 'source_paths': [name]}}}))
            with self.subTest(name=name), patch.object(focused, 'snapshot', return_value={'files': files}) as snapshots:
                with self.assertRaises(ControlError): focused.profile_commands(self.root, 'owned')
                snapshots.assert_called_once_with(self.root)

    def test_only_review_site_binds_nested_python_without_mutating_caller(self):
        for profile in ('review-site', 'functionality-outcomes'):
            for ambient in (None, 'synthetic-never-executed-python'):
                source = {'PATH': 'synthetic-path', 'PYTHONOPTIMIZE': '2'}
                if ambient is not None: source['PYTHON'] = ambient
                command = ['node', '--test', '--', 'fixed.unit.test.mjs']
                with self.subTest(profile=profile, ambient=ambient), patch.dict(focused.os.environ, source, clear=True), patch.object(sys, 'argv', ['focused', '--profile', profile]), patch.object(focused, 'profile_commands', return_value=[command]), patch.object(focused.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
                    self.assertEqual(focused.main(), 0)
                    self.assertEqual(dict(focused.os.environ), source)
                    self.assertEqual(run.call_args.args[0], command)
                    child = run.call_args.kwargs['env']
                    self.assertNotIn('PYTHONOPTIMIZE', child)
                    self.assertEqual(child.get('PYTHON'), sys.executable if profile == 'review-site' else ambient)
                    self.assertEqual(run.call_args.kwargs['timeout'], 630 if profile == 'review-site' else 270)

    def test_review_site_python_binding_keeps_failure_exit_and_timeouts(self):
        for code in (1, 5):
            with self.subTest(code=code), patch.object(sys, 'argv', ['focused', '--profile', 'review-site']), patch.object(focused, 'profile_commands', return_value=[['node', '--test', '--', 'fixed.unit.test.mjs']]), patch.object(focused.subprocess, 'run', return_value=SimpleNamespace(returncode=code)) as run:
                self.assertEqual(focused.main(), code)
                self.assertEqual(run.call_args.kwargs['env']['PYTHON'], sys.executable)
                self.assertEqual(run.call_args.kwargs['timeout'], 630)


    def test_review_site_pytest_environment_keeps_selected_python_and_controls(self):
        source = {'PYTHON': 'synthetic-never-executed-python', 'PYTHONOPTIMIZE': '2',
                  'PYTEST_ADDOPTS': '-p synthetic', 'PYTEST_PLUGINS': 'synthetic'}
        command = [sys.executable, '-B', '-m', 'pytest', '--', 'fixed_test.py']
        with patch.dict(focused.os.environ, source, clear=True), patch.object(sys, 'argv', ['focused', '--profile', 'review-site']), patch.object(focused, 'profile_commands', return_value=[command]), patch.object(focused, 'pytest_tooling_ready', return_value=True), patch.object(focused.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            self.assertEqual(focused.main(), 0)
            self.assertEqual(run.call_args.args[0], command)
            self.assertEqual(dict(focused.os.environ), source)
            self.assertEqual(run.call_args.kwargs['env'], {'PYTHON': sys.executable, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1'})
            self.assertEqual(run.call_args.kwargs['timeout'], 630)



if __name__ == '__main__':
    unittest.main()
