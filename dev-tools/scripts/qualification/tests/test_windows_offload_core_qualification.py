"""Default/imported declarations cannot execute fixtures or reopen accuracy."""
import builtins
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'qualify_windows_offload_core.py'
SPEC = importlib.util.spec_from_file_location('fresh_core_declaration_subject', SCRIPT)
subject = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(subject)


class FreshCoreDeclarationTests(unittest.TestCase):
    def test_default_and_plan_are_effect_free_and_preserve_technical_gaps(self):
        for args, expected in (([], 3), (['--plan'], 0)):
            output = io.StringIO()
            with self.subTest(args=args), patch('sys.stdout', output), patch('subprocess.Popen', side_effect=AssertionError('No process')), patch.object(Path, 'open', side_effect=AssertionError('No file')), patch.object(Path, 'mkdir', side_effect=AssertionError('No directory')):
                self.assertEqual(subject.main(args), expected)
            value = json.loads(output.getvalue())
            self.assertEqual(value['status'], 'technical-check-pending')
            self.assertEqual(value['action_owner'], 'agent')
            self.assertEqual(value['user_action'], 'No action needed.')
            self.assertEqual(len(value['required_native_checks']), 7)
            for key in ('qualification_complete', 'native_tests_executed', 'native_effects', 'old_staging_accessed', 'model_or_worker_started', 'quality_tests_executed', 'parent_qualification_granted', 'production_composed'):
                self.assertIs(value[key], False)

    def test_no_native_path_command_pid_budget_proof_or_force_option(self):
        for flag in ('--native', '--self-test', '--root', '--command', '--pid', '--budget', '--proof', '--force'):
            output = io.StringIO()
            with self.subTest(flag=flag), patch('sys.stdout', output), patch.object(subject, 'current_plan') as plan:
                self.assertEqual(subject.main([flag, 'synthetic-private-input']), 2)
            plan.assert_not_called()
            self.assertNotIn('synthetic-private-input', output.getvalue())

    def test_imported_native_entry_is_refused_before_any_effect_or_native_import(self):
        original = builtins.__import__
        def checked(name, *args, **kwargs):
            if name.split('.')[0] in {'ctypes', 'runpy', 'subprocess', 'windows_offload_core_fixture'}:
                raise AssertionError('No native import')
            return original(name, *args, **kwargs)
        output = io.StringIO()
        with patch('builtins.__import__', side_effect=checked), patch('sys.stdout', output), patch.object(Path, 'open', side_effect=AssertionError('No file')), patch.object(Path, 'mkdir', side_effect=AssertionError('No directory')):
            self.assertEqual(subject.main(['--native']), 2)
        self.assertEqual(json.loads(output.getvalue())['status'], 'request-refused')

    def test_import_does_not_load_windows_runtime_frameworks_or_accuracy_runners(self):
        original = builtins.__import__
        def checked(name, *args, **kwargs):
            if name.split('.')[0] in {'ctypes', 'torch', 'transformers', 'accelerate', 'modules', 'run_model_blocker_tests', 'run_optional_generation_qualification'}:
                raise AssertionError('Unexpected native/runtime/accuracy import')
            return original(name, *args, **kwargs)
        spec = importlib.util.spec_from_file_location('cold_core_declaration', SCRIPT)
        with patch('builtins.__import__', side_effect=checked): spec.loader.exec_module(importlib.util.module_from_spec(spec))

    def test_failed_planning_never_prints_private_error_detail(self):
        for error in (ValueError, OSError, SyntaxError):
            output = io.StringIO()
            with self.subTest(error=error), patch.object(subject, 'current_plan', side_effect=error('synthetic-private-path')), patch('sys.stdout', output):
                self.assertEqual(subject.main(['--plan']), 2)
            self.assertNotIn('synthetic-private-path', output.getvalue())


if __name__ == '__main__': unittest.main()
