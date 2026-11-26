"""Contract checks only: no native files, module load, job or model execution."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1]/'qualify_windows_training_result_store.py'
sys.path.insert(0,str(SCRIPT.parent))
spec=importlib.util.spec_from_file_location('training_native_feature',SCRIPT)
feature=importlib.util.module_from_spec(spec);spec.loader.exec_module(feature)


class NativeFeatureContractTests(unittest.TestCase):
    def diagnostics(self):return {'sealStep':0,'nativeStatus':0,'permissionBits':0,'permissionControl':0,'grantedAccess':0}
    def result(self):return {'kind':'native-file-result','passed':True,'cleanup_passed':True,'stage':14,'diagnostics':self.diagnostics(),'checks':feature.CHECKS.copy()}

    def test_exact_success_requires_all_eight_real_feature_checks_and_cleanup(self):
        value=self.result();self.assertEqual(feature.decode_result(json.dumps(value)),value)
        for field,wrong in [('kind','copied-status'),('cleanup_passed',False),('stage',8),('checks',feature.CHECKS[:-1])]:
            invalid=copy.deepcopy(value);invalid[field]=wrong
            with self.subTest(field=field),self.assertRaises(ValueError):feature.decode_result(json.dumps(invalid))

    def test_failed_or_forged_replies_never_claim_closure_or_emit_payload_fields(self):
        failed={'kind':'native-file-result','passed':False,'cleanup_passed':False,'stage':6,'diagnostics':self.diagnostics(),'checks':[]}
        self.assertEqual(feature.decode_result(json.dumps(failed)),failed)
        for wrong in [{**failed,'checks':feature.CHECKS},{**failed,'cleanup_passed':True},{**failed,'stage':True},{**failed,'private_path':'must not enter result'},{**failed,'passed':1}]:
            with self.subTest(wrong=wrong),self.assertRaises(ValueError):feature.decode_result(json.dumps(wrong))
        with self.assertRaises(ValueError):feature.decode_result('x'*16385)

    def test_numeric_diagnostics_deny_payload_fields_boolean_and_out_of_range_values(self):
        for key,value in [('sealStep',7),('nativeStatus',2**32),('permissionBits',16),('permissionControl',0x150d),('permissionControl',1),('permissionControl',2),('grantedAccess',-1),('sealStep',True),('path','must-not-appear')]:
            report=self.result();report['diagnostics'][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):feature.decode_result(json.dumps(report))

    def test_plan_refuses_unsupported_node_before_source_or_native_execution(self):
        with patch.object(feature.build,'profile'),patch.object(feature.shutil,'which',return_value='C:/fixed/node.exe'),patch.object(feature.fixed,'safe',side_effect=lambda p,k:p),patch.object(feature.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='v23.1.0')),patch.object(feature.fixed,'digest') as read:
            with self.assertRaisesRegex(ValueError,'Node24'):feature.plan()
            read.assert_not_called()

    def test_plan_is_no_model_no_retry_and_fixed_small_file_profile(self):
        with patch.object(feature.build,'profile'),patch.object(feature.shutil,'which',return_value='C:/fixed/node.exe'),patch.object(feature.fixed,'safe',side_effect=lambda p,k:p),patch.object(feature.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='v24.22.1\n')),patch.object(feature.fixed,'digest',return_value='a'*64):
            value=feature.plan()
        self.assertFalse(value['model']);self.assertFalse(value['automatic_retry']);self.assertEqual(value['maximum_synthetic_data_bytes'],16384)
        self.assertEqual(value['compiler_job_commit_bytes'],2*1024**3);self.assertEqual(value['compiler_process_limit'],8)
        self.assertEqual(set(value['sources']),set(feature.SOURCES))

    def test_retained_namespace_capacity_is_bounded_without_descending_or_reusing(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);namespace=root/'artifacts/tmp/native-training-result-files';namespace.mkdir(parents=True)
            for n in range(feature.MAX_RUNS):(namespace/f'{n:032x}').mkdir()
            (namespace/'execution.lock').write_bytes(b'')
            (namespace/'admission.lock').write_bytes(b'')
            with patch.object(feature,'ROOT',root),patch.object(feature,'NAMESPACE',namespace),patch.object(feature,'lock_byte'):
                with self.assertRaisesRegex(ValueError,'storage is full'):feature.create_folder()
            self.assertEqual(len(list(namespace.iterdir())),feature.MAX_RUNS+2)

    def test_default_plan_path_does_not_open_a_fixture_or_claim_review(self):
        with patch.object(feature.sys,'argv',['fixed-profile','--plan']),patch.object(feature,'plan',return_value={'profile':feature.PROFILE}),patch.object(feature,'create_folder') as create,patch.object(feature,'reviewed_source') as review,patch('builtins.print'):
            feature.main();create.assert_not_called();review.assert_not_called()

    def test_children_do_not_inherit_keys_preloads_or_module_search_paths(self):
        with patch.dict(os.environ,{'NODE_OPTIONS':'--require unreviewed.js','NODE_PATH':'unreviewed','PYTHONPATH':'unreviewed','PROVIDER_API_KEY':'must-not-forward'}):
            node=feature.child_environment(Path('C:/fixed/node.exe'))
            python=feature.child_environment(Path('C:/fixed/node.exe'),python=True)
        self.assertEqual(node['NODE_OPTIONS'],'--preserve-symlinks --preserve-symlinks-main')
        for key in ('NODE_PATH','PYTHONPATH','PROVIDER_API_KEY'):
            self.assertNotIn(key,node);self.assertNotIn(key,python)
        self.assertEqual(python['PYTHONNOUSERSITE'],'1')

    def test_full_source_review_drift_fails_even_with_unchanged_five_file_plan(self):
        current={'source':'same-five-files'};review={'source_digest':'whole-current-source','review_digest':'accepted'}
        with patch.object(feature,'plan',return_value=current),patch.object(feature,'reviewed_source',return_value=review):
            self.assertTrue(feature.final_inputs_match(current,review))
        with patch.object(feature,'plan',return_value=current),patch.object(feature,'reviewed_source',return_value={**review,'source_digest':'changed-helper-source'}):
            self.assertFalse(feature.final_inputs_match(current,review))

    def test_original_lock_rejects_hardlinks_before_opening_or_locking(self):
        with tempfile.TemporaryDirectory() as name:
            namespace=Path(name);original=namespace/'original';original.write_bytes(b'unchanged');os.link(original,namespace/'execution.lock')
            with patch.object(feature,'NAMESPACE',namespace),patch.object(feature,'lock_byte') as lock:
                with self.assertRaisesRegex(ValueError,'identity unavailable'):
                    with feature.file_lease('execution.lock'): self.fail('Lock must not be admitted.')
                lock.assert_not_called()
            self.assertEqual(original.read_bytes(),b'unchanged')

    def test_opened_lock_identity_mismatch_prevents_locking_and_closes_original_fd(self):
        with tempfile.TemporaryDirectory() as name:
            namespace=Path(name);path=namespace/'execution.lock';path.write_bytes(b'');original=path.stat()
            wrong=SimpleNamespace(st_dev=original.st_dev,st_ino=original.st_ino+1,st_nlink=1,st_mode=original.st_mode)
            with patch.object(feature,'NAMESPACE',namespace),patch.object(feature.os,'fstat',return_value=wrong),patch.object(feature,'lock_byte') as lock:
                with self.assertRaisesRegex(ValueError,'changed'):
                    with feature.file_lease('execution.lock'):self.fail('Changed original must not be admitted.')
                lock.assert_not_called()

    def test_original_lock_is_unlocked_and_closed_after_exception(self):
        with tempfile.TemporaryDirectory() as name:
            namespace=Path(name);seen=[]
            with patch.object(feature,'NAMESPACE',namespace),patch.object(feature,'lock_byte',side_effect=lambda fd,acquire:seen.append((fd,acquire))):
                with self.assertRaisesRegex(ValueError,'synthetic failure'):
                    with feature.file_lease('execution.lock'):raise ValueError('synthetic failure')
            self.assertEqual([acquire for _,acquire in seen],[True,False]);self.assertEqual(seen[0][0],seen[1][0])
            with self.assertRaises(OSError):os.fstat(seen[0][0])

    @unittest.skipUnless(os.name=='nt','Original Windows byte-range lock')
    def test_concurrent_namespace_admission_cannot_exceed_the_fixed_limit(self):
        from concurrent.futures import ThreadPoolExecutor
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);namespace=root/'artifacts/tmp/native-training-result-files';namespace.mkdir(parents=True);(namespace/'admission.lock').write_bytes(b'')
            def attempt():
                try:return feature.create_folder()
                except (OSError,ValueError):return None
            with patch.object(feature,'ROOT',root),patch.object(feature,'NAMESPACE',namespace),patch.object(feature,'MAX_RUNS',1),ThreadPoolExecutor(max_workers=2) as pool:
                result=list(pool.map(lambda _:attempt(),range(2)))
            self.assertEqual(sum(value is not None for value in result),1)
            self.assertEqual(len([p for p in namespace.iterdir() if len(p.name)==32]),1)


if __name__=='__main__':unittest.main()
