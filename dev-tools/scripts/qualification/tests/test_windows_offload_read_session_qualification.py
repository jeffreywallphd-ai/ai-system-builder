"""Pure read-session declaration; no actual worker or Windows API execution."""
import builtins
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'qualify_windows_offload_read_session.py'
SPEC = importlib.util.spec_from_file_location('read_session_declaration_subject', SCRIPT)
subject = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(subject)


class DeclarationTests(unittest.TestCase):
    def test_default_and_plan_are_inert_and_preserve_gaps(self):
        for args,code in (([],3),(['--plan'],0)):
            output=io.StringIO()
            with self.subTest(args=args),patch('sys.stdout',output), \
                 patch('subprocess.Popen',side_effect=AssertionError('No child')), \
                 patch.object(Path,'open',side_effect=AssertionError('No file')), \
                 patch.object(Path,'mkdir',side_effect=AssertionError('No directory')):
                self.assertEqual(subject.main(args),code)
            value=json.loads(output.getvalue())
            self.assertEqual(value['cases'],['stalled-response-cancellation','owned-child-exit-during-response'])
            self.assertEqual(value['action_owner'],'agent');self.assertEqual(value['user_action'],'No action needed.')
            self.assertEqual(value['maximum_seconds'],120);self.assertEqual(value['maximum_active_children'],1)
            self.assertEqual(value['inert_child_commit_ceiling_bytes'],512*1024**2)
            self.assertTrue(value['ceiling_is_not_upfront_allocation_or_model_policy'])
            self.assertEqual(len(value['required_native_checks']),6)
            for n in ('qualification_complete','native_tests_executed','native_effects','old_staging_accessed',
                      'model_or_worker_started','quality_tests_executed','shared_domain_qualified',
                      'production_composed','parent_qualification_granted'):
                self.assertIs(value[n],False)

    def test_import_and_imported_native_do_not_reach_native_or_model_dependencies(self):
        original=builtins.__import__
        def checked(name,*args,**kwargs):
            if name.split('.')[0] in {'ctypes','torch','transformers','accelerate','modules',
                                     'windows_offload_core_fixture','windows_offload_read_session_fixture'}:
                raise AssertionError('Unexpected native import')
            return original(name,*args,**kwargs)
        output=io.StringIO()
        with patch('builtins.__import__',side_effect=checked),patch('sys.stdout',output), \
             patch.object(Path,'open',side_effect=AssertionError('No file')):
            spec=importlib.util.spec_from_file_location('cold_read_session_declaration',SCRIPT)
            spec.loader.exec_module(importlib.util.module_from_spec(spec))
            self.assertEqual(subject.main(['--native']),2)
        self.assertEqual(json.loads(output.getvalue())['status'],'request-refused')

    def test_caller_paths_processes_commands_limits_and_conflicting_modes_refuse_safely(self):
        for args in ([n,'synthetic-private-detail'] for n in
                     ('--root','--pid','--thread','--command','--profile','--budget','--memory','--proof','--force')):
            output=io.StringIO()
            with self.subTest(args=args),patch('sys.stdout',output):self.assertEqual(subject.main(args),2)
            self.assertNotIn('synthetic-private-detail',output.getvalue())
        output=io.StringIO()
        with patch('sys.stdout',output):self.assertEqual(subject.main(['--plan','--native']),2)

    def test_planning_failure_is_sanitized_and_never_passed(self):
        output=io.StringIO()
        with patch('sys.stdout',output),patch.object(subject,'current_plan',side_effect=ValueError('private-detail')):
            self.assertEqual(subject.main(['--plan']),2)
        self.assertNotIn('private-detail',output.getvalue());self.assertIs(json.loads(output.getvalue())['qualification_complete'],False)


if __name__ == '__main__':unittest.main()
