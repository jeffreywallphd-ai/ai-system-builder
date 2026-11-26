"""No-file native builder admission and fixed-command regressions."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT=Path(__file__).resolve().parents[1]/'build_windows_training_result_store.py'
sys.path.insert(0,str(SCRIPT.parent))
spec=importlib.util.spec_from_file_location('training_store_build',SCRIPT)
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)


class TrainingResultBuildTests(unittest.TestCase):
    def test_fixed_compiler_argv_has_no_implicit_library_or_shell_search(self):
        args=build.argv(Path('C:/fixed compiler/cl.exe'),[Path('C:/headers')],[Path('C:/lib/node.lib')],Path('C:/owned output'))
        self.assertEqual(args[0],str(Path('C:/fixed compiler/cl.exe')))
        self.assertTrue({'/WX','/NODEFAULTLIB','/DELAYLOAD:node.exe','/LD','/guard:cf','/NXCOMPAT'}.issubset(args))
        self.assertIn(str(build.SOURCE),args)
        self.assertFalse(any(arg.startswith('/LIBPATH') for arg in args))

    def test_unsupported_toolchain_fails_before_sdk_or_source_reads(self):
        with patch.object(build.fixed,'profile',side_effect=ValueError('unavailable')),patch.object(build,'safe') as safe:
            with self.assertRaisesRegex(ValueError,'unavailable'): build.profile()
            safe.assert_not_called()

    def test_hash_mismatch_denies_before_compiler_and_output_creation(self):
        policy=json.loads(build.POLICY.read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory() as name:
            root=Path(name); cache=root/'cache';cache.mkdir(); path=root/'policy.json';path.write_text(json.dumps(policy))
            for leaf in policy['files']: (cache/leaf).write_bytes(b'wrong')
            with patch.object(build,'POLICY',path),patch.object(build,'CACHE',cache),patch.object(build.fixed,'profile',return_value=(None,[],[])):
                with self.assertRaisesRegex(ValueError,'input differs'): build.profile()

    def test_policy_cannot_add_unpinned_sdk_inputs(self):
        policy=json.loads(build.POLICY.read_text(encoding='utf-8'));policy['files']['untrusted.h']={'bytes':1,'sha256':'0'*64}
        with tempfile.TemporaryDirectory() as name:
            path=Path(name)/'policy.json';path.write_text(json.dumps(policy))
            with patch.object(build,'POLICY',path),patch.object(build.fixed,'profile',return_value=(None,[],[])):
                with self.assertRaisesRegex(ValueError,'inventory differs'): build.profile()

    def test_redirected_output_parent_fails_before_creation(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);parent=root/'artifacts';parent.mkdir(); original=build.safe
            def safe(path,kind=None):
                if path==parent: raise ValueError('Redirected')
                return original(path,kind)
            with patch.object(build,'ROOT',root),patch.object(build,'NAMESPACE',root/'artifacts/tmp/native-training-result-store'),patch.object(build,'safe',side_effect=safe):
                with self.assertRaisesRegex(ValueError,'Redirected'): build.create_output_folder()
            self.assertFalse((parent/'tmp').exists())

    def test_inventory_binds_own_source_builder_and_policy(self):
        with patch.object(build.fixed,'inventory',return_value={}),patch.object(build,'digest',return_value='f'*64) as digest:
            result=build.inventory(None,[],[])
        self.assertEqual(set(result),{p.relative_to(build.ROOT).as_posix() for p in (build.SOURCE,build.SCRIPT,build.POLICY)})
        self.assertEqual(digest.call_count,3)


if __name__=='__main__': unittest.main()
