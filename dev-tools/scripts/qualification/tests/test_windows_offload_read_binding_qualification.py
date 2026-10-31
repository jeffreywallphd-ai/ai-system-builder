"""Default/imported read_binding planning is effect-free; no native pass implied."""
import builtins
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'qualify_windows_offload_read_binding.py'
SPEC = importlib.util.spec_from_file_location('read_binding_declaration_subject', SCRIPT)
subject = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(subject)


class ReadBindingDeclarationTests(unittest.TestCase):
    def test_default_and_plan_cannot_start_native_file_process_or_model_work(self):
        for args, code in (([], 3), (['--plan'], 0)):
            output = io.StringIO()
            with self.subTest(args=args), patch('sys.stdout', output), \
                 patch('subprocess.Popen', side_effect=AssertionError('No process')), \
                 patch.object(Path, 'open', side_effect=AssertionError('No file')), \
                 patch.object(Path, 'mkdir', side_effect=AssertionError('No directory')):
                self.assertEqual(subject.main(args), code)
            value = json.loads(output.getvalue())
            self.assertEqual(value['status'], 'technical-check-pending')
            self.assertEqual(value['action_owner'], 'agent')
            self.assertEqual(value['user_action'], 'No action needed.')
            self.assertEqual(value['cases'], ['deadline-control','unused-read-binding'])
            self.assertEqual(len(value['required_native_checks']), 4)
            self.assertEqual(value['inert_child_commit_ceiling_bytes'], 512*1024**2)
            self.assertTrue(value['ceiling_is_not_upfront_allocation_or_model_policy'])
            for field in ('qualification_complete', 'native_tests_executed', 'native_effects',
                          'old_staging_accessed', 'model_or_worker_started', 'quality_tests_executed',
                          'shared_domain_qualified', 'production_composed', 'parent_qualification_granted'):
                self.assertIs(value[field], False)

    def test_arbitrary_roots_commands_profiles_and_limits_are_not_arguments(self):
        for flag in ('--native', '--root', '--command', '--pid', '--budget', '--profile', '--proof', '--force'):
            output = io.StringIO()
            with self.subTest(flag=flag), patch('sys.stdout', output), patch.object(subject, 'current_plan') as plan:
                self.assertEqual(subject.main([flag, 'synthetic-private-input']), 2)
            plan.assert_not_called(); self.assertNotIn('synthetic-private-input', output.getvalue())

    def test_imported_native_call_denies_before_native_import_or_file_access(self):
        original = builtins.__import__
        def checked(name, *args, **kwargs):
            if name.split('.')[0] in {'ctypes', 'types', 'subprocess', 'windows_offload_core_fixture'}:
                raise AssertionError('No native import')
            return original(name, *args, **kwargs)
        output = io.StringIO()
        with patch('builtins.__import__', side_effect=checked), patch('sys.stdout', output), \
             patch.object(Path, 'open', side_effect=AssertionError('No file')):
            self.assertEqual(subject.main(['--native']), 2)
        self.assertEqual(json.loads(output.getvalue())['status'], 'request-refused')

    def test_cold_import_does_not_load_native_or_model_frameworks(self):
        original = builtins.__import__
        def checked(name, *args, **kwargs):
            if name.split('.')[0] in {'ctypes', 'torch', 'transformers', 'accelerate', 'modules',
                                     'windows_offload_core_fixture', 'windows_offload_read_binding_fixture'}:
                raise AssertionError('Unexpected runtime import')
            return original(name, *args, **kwargs)
        spec = importlib.util.spec_from_file_location('cold_read_binding_declaration', SCRIPT)
        with patch('builtins.__import__', side_effect=checked):
            spec.loader.exec_module(importlib.util.module_from_spec(spec))

    def test_planning_failure_is_safe_and_never_a_pass(self):
        for error in (ValueError, OSError, SyntaxError):
            output = io.StringIO()
            with self.subTest(error=error), patch('sys.stdout', output), \
                 patch.object(subject, 'current_plan', side_effect=error('synthetic-private-detail')):
                self.assertEqual(subject.main(['--plan']), 2)
            self.assertNotIn('synthetic-private-detail', output.getvalue())
            self.assertFalse(json.loads(output.getvalue())['qualification_complete'])


if __name__ == '__main__': unittest.main()
