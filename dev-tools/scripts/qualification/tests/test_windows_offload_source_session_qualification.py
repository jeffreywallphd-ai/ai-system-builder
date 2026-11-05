"""Inert Source runtime entry tests. No Native, process, model or file effects."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace

SCRIPT=Path(__file__).resolve().parents[1]/'qualify_windows_offload_source_session.py'
SPEC=importlib.util.spec_from_file_location('source_runtime_entry_subject',SCRIPT)
subject=importlib.util.module_from_spec(SPEC);sys.modules[SPEC.name]=subject;SPEC.loader.exec_module(subject)


class EntryTests(unittest.TestCase):
    def request(self,args):
        output=io.StringIO()
        with patch('sys.stdout',output),patch.object(Path,'open',side_effect=AssertionError('No file')), \
             patch.object(Path,'mkdir',side_effect=AssertionError('No directory')):
            code=subject.main(args)
        return code,json.loads(output.getvalue())

    def test_plan_and_default_are_inert_and_preserve_scope_limits(self):
        for args,expected in (([],3),(['--plan'],0)):
            code,value=self.request(args);self.assertEqual(code,expected)
            self.assertEqual(value['cases'],['source-roundtrip','shared-write-map-denial','sharing-open-denial'])
            self.assertEqual((value['shared_rows_per_actor'],value['terminal_rows_inside_total']),(16384,64))
            self.assertEqual(value['frame_fragment_attempts'],32)
            for field in ('native_effects','native_tests_executed','qualification_complete','model_started',
                          'quality_tests_executed','old_staging_accessed','borrower_started',
                          'production_composed','parent_qualification_granted'):
                self.assertIs(value[field],False)

    def test_imported_native_and_arbitrary_commands_paths_or_limits_are_refused(self):
        for args in (['--native'],['--native-shared-write-denial'],['--native-sharing-open-denial'],['--nat'],
                     ['--native-sharing-open-denial','--native'],['--native-sharing-open-denial','--plan'],
                     ['--native-shared-write-denial','--native'],
                     ['--native-shared-write-denial','--plan'],['--native','--plan'],['--root','synthetic-private'],
                     ['--command','synthetic-private'],['--budget','1'],['--force']):
            code,value=self.request(args)
            self.assertEqual(code,2);self.assertEqual(value['status'],'request-refused')
            self.assertNotIn('synthetic-private',json.dumps(value))

    def test_native_loader_guard_runs_before_any_file_or_module_effect(self):
        with patch.object(Path,'open',side_effect=AssertionError('No source read'))as read:
            with self.assertRaises(ValueError):subject._load_fixture()
        read.assert_not_called()

    def test_fixed_loader_compiles_the_retained_source_buffer_without_running_native(self):
        name='_standalone_source_session_qualification'
        self.assertNotIn(name,sys.modules)
        try:
            with patch.object(subject,'_native_environment',lambda:None):module=subject._load_fixture()
            self.assertEqual(module.__name__,name)
            self.assertIs(module._NATIVE_ENTRY,module._ENTRY_TOKEN)
            self.assertEqual(module._CONTROL_OWNERS,[]);self.assertEqual(module._COLLECTION_OWNERS,[])
            self.assertEqual(len(module._QUALIFICATION_SOURCE_SHA256),64)
            with self.assertRaises(module.SourceSessionFixtureError):module._entry_environment()
            with patch.object(subject,'_native_environment',lambda:None),self.assertRaises(ValueError):subject._load_fixture()
        finally:sys.modules.pop(name,None)

    def test_native_branch_returns_only_the_fixed_collector_result(self):
        fixture=SimpleNamespace(run_native=lambda:9)
        with patch.object(subject,'_native_environment',lambda:None), \
             patch.object(subject,'_load_fixture',return_value=fixture)as load:
            self.assertEqual(subject.main(['--native']),9)
        load.assert_called_once_with()

    def test_new_sharing_case_uses_only_fixed_collector(self):
        fixture=SimpleNamespace(run_native=lambda:9)
        with patch.object(subject,'_native_environment',lambda:None),patch.object(subject,'_load_fixture',return_value=fixture)as load:
            self.assertEqual(subject.main(['--native-sharing-open-denial']),9)
        load.assert_called_once_with()

    def test_distinct_denial_branch_returns_only_fixed_collector_result(self):
        fixture=SimpleNamespace(run_native=lambda:9)
        with patch.object(subject,'_native_environment',lambda:None), \
             patch.object(subject,'_load_fixture',return_value=fixture)as load:
            self.assertEqual(subject.main(['--native-shared-write-denial']),9)
        load.assert_called_once_with()


if __name__=='__main__':unittest.main()
