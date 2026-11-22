"""Portable package tampering/identity cases; no build, extraction or launch."""
from pathlib import Path
import copy
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import training_package_evidence as evidence
import test_training_first_phase_evidence as earlier_fixture


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def row(raw):
    return {'bytes': len(raw), 'sha256': evidence.first.sha(raw)}


def fixture():
    run, commit = 'a' * 32, 'b' * 40
    original = {'modules/adapters/runtime/python/worker/main.py': row(b'worker'),
                'apps/desktop/forge.config.js': row(b'configuration'), 'package.json': row(b'package')}
    files = {name: value['sha256'] for name, value in original.items()}
    digest = evidence.first.sha(encoded(files))
    identity = {'run_id': run, 'source_commit': commit, 'execution_source_digest': digest,
                'owner_source_digest': digest}
    report = {'schema_version': 'headless-local-training-package-qualification-v1',
        'status': 'qualified-recorded-source-offline-package-only', **identity,
        'artifacts': {}, 'scope': dict(evidence.SCOPE)}
    values = {}
    for role in ('owner', 'execution'):
        values[role + '_snapshot'] = {'schema_version': 'source-snapshot-v1', 'head': commit,
                                     'files': files, 'source_digest': digest}
    values['source'] = {'schema_version': 'training-source-copy-references-v1',
        'source_commit': commit, 'source_digest': digest, 'candidate_not_created': True,
        'files': original, 'file_count': len(original), 'total_bytes': sum(value['bytes'] for value in original.values())}
    values['electron'] = {'schema_version': 'installed-electron-distribution-references-v1',
        'version': '42.11.18', 'platform': 'win32', 'arch': 'x64', 'distribution_relative': 'node_modules/electron/dist',
        'files': {'electron.exe': row(b'electron')}, 'file_count': 1, 'total_bytes': 8}
    schemas = {'reference_plan': 'current-offline-package-reference-plan-v1',
        'plan': 'current-training-native-package-plan-v1', 'effect': 'training-native-package-effect-review-v1',
        'review': 'independent-native-package-result-review-v1', 'observation': 'current-primary-offline-training-package-v1',
        'metadata': 'current-training-package-metadata-v1', 'metadata_effect': 'training-package-metadata-effect-review-v1',
        'metadata_review': 'independent-package-metadata-result-review-v1'}
    for name, schema in schemas.items(): values[name] = {**identity, 'schema_version': schema}
    values['plan'].update(phase='training-package', deadline_seconds=420, native_effect_allowance=0,
        operator_deployment_allowed=False, metadata_prepared=True, input_manifest_sha256='d' * 64,
        limits={'process_bytes': 2 * 1024**3, 'job_bytes': 4 * 1024**3, 'process_count': 32})
    values['effect'].update(disposition='accepted', role='training-package', native_effect_allowance=1,
                            operator_deployment_allowed=True)
    values['review'].update(disposition='accepted-offline-package-and-confirmed-retirement-only',
        native_effect_allowance=0, application_launch_allowed=False, training_or_accuracy_qualified=False, parent_pass=False)
    values['metadata_effect'].update(disposition='accepted', metadata_preparation_allowed=True, native_effect_allowance=0)
    values['metadata_review'].update(disposition='accepted-metadata-preparation-only', native_effect_allowance=0, parent_pass=False)
    values['metadata'].update(status='prepared-review-required', native_effects=0, operator_deployed=False,
        forge_imported=False, automatic_retry_allowed=False, parent_pass=False, original_inputs_unchanged=True,
        empty_candidate_cache=True, empty_packager_temp=True, package_output_absent=True)
    values['inputs'] = {'schema_version': 'fixed-offline-training-package-inputs-v1', 'run_id': run,
        'source_digest': digest, 'zip': row(b'closed-zip')}
    values['metadata']['zip'] = values['inputs']['zip']
    rows = {name: row(b'app') for name in evidence.REQUIRED_PACKAGE}
    rows['resources/worker/main.py'] = original['modules/adapters/runtime/python/worker/main.py']
    rows['ai-system-builder.exe'] = {'bytes': evidence.byte_inputs.MIB, 'sha256': evidence.first.sha(b'MZ fixture')}
    values['tree'] = {'schema_version': 'actual-offline-training-package-tree-v1', 'source_digest': digest,
        'files': rows, 'directories': [], 'parent_pass': False, 'optional_ocr_qualification': 'not-asserted',
        'file_count': len(rows), 'total_bytes': sum(value['bytes'] for value in rows.values()),
        'application_sha256': rows['ai-system-builder.exe']['sha256'],
        'worker_main_sha256': rows['resources/worker/main.py']['sha256'], 'worker_source_files': 1}
    values['package'] = {'schemaVersion': 'training-offline-package-v1', 'status': 'packaged-offline',
        'sourceDigest': digest, 'sourceFiles': len(original), 'sourceBytes': values['source']['total_bytes'],
        'electronVersion': '42.11.18', 'electronInputFiles': 1, 'packageFiles': len(rows),
        'packageBytes': values['tree']['total_bytes'], 'applicationSha256': values['tree']['application_sha256'],
        'workerMainSha256': values['tree']['worker_main_sha256'], 'workerSourceFiles': 1,
        'originalOcrHookRetained': True, 'accuracyExecuted': False, 'applicationExecuted': False,
        'parentPass': False, 'optionalOcrQualification': 'not-asserted'}
    values['review'].update(package_files=copy.deepcopy(rows), package_file_count=len(rows),
        package_bytes=values['tree']['total_bytes'], application_sha256=values['tree']['application_sha256'],
        worker_main_sha256=values['tree']['worker_main_sha256'])
    values['observation'].update(status='packaged-review-required', native_retirement_confirmed=True,
        training_executed=False, application_executed=False, accuracy_executed=False,
        automatic_retry_allowed=False, parent_pass=False, package_files=len(rows),
        package_bytes=values['tree']['total_bytes'], application_sha256=values['tree']['application_sha256'],
        worker_main_sha256=values['tree']['worker_main_sha256'])
    _, old_raw, old_values = earlier_fixture.fixture()
    values['native'] = old_values['input_native']
    raw = {'stdout': old_raw['input_stdout'], 'stderr': old_raw['input_stderr'],
           'script': b'# inert native effect source', 'metadata_script': b'# inert metadata source', 'trailer': b'\n// fixed trailer'}
    repack(report, raw, values)
    return report, raw, values


def repack(report, raw, values):
    def save(name): raw[name] = encoded(values[name]); return evidence.first.sha(raw[name])
    source_sha, electron_sha = save('source'), save('electron')
    raw['phase_source'] = raw['source']; raw['phase_electron'] = raw['electron']
    trailer_sha = evidence.first.sha(raw['trailer'])
    values['inputs'].update(source_manifest_sha256=source_sha, electron_manifest_sha256=electron_sha, config_trailer_sha256=trailer_sha)
    inputs_sha = save('inputs')
    metadata = values['metadata']
    metadata.update(source_manifest_sha256=source_sha, electron_manifest_sha256=electron_sha,
                    config_trailer_sha256=trailer_sha, package_inputs_sha256=inputs_sha)
    ref_sha = save('reference_plan')
    effect = values['metadata_effect']
    effect.update(plan_sha256=ref_sha, script_sha256=evidence.first.sha(raw['metadata_script']))
    metadata_effect_sha = save('metadata_effect'); metadata['metadata_effect_review_sha256'] = metadata_effect_sha
    metadata_sha = save('metadata')
    values['metadata_review'].update(reference_plan_sha256=ref_sha, metadata_result_sha256=metadata_sha,
        script_sha256=effect['script_sha256'], effect_review_sha256=metadata_effect_sha)
    meta_review_sha = save('metadata_review')
    plan = values['plan']
    plan['context'] = {'run_id': report['run_id'], 'phase': plan['phase'], 'input_manifest_sha256': plan['input_manifest_sha256'],
        'source_manifest_sha256': source_sha, 'electron_manifest_sha256': electron_sha,
        'package_inputs_sha256': inputs_sha, 'source_digest': report['execution_source_digest']}
    plan.update(metadata_result_sha256=metadata_sha, metadata_result_review_sha256=meta_review_sha)
    plan_sha = save('plan')
    values['effect'].update(script_sha256=evidence.first.sha(raw['script']), plan_sha256=plan_sha)
    effect_sha = save('effect'); native_sha = save('native'); tree_sha = save('tree')
    values['package']['manifestSha256'] = tree_sha; package_sha = save('package')
    values['observation'].update(native_effect_review_sha256=effect_sha, native_result_sha256=native_sha,
                               package_result_sha256=package_sha, package_tree_sha256=tree_sha)
    observation_sha = save('observation')
    values['review'].update(effect_review_sha256=effect_sha, script_sha256=evidence.first.sha(raw['script']),
        plan_sha256=plan_sha, native_result_sha256=native_sha, package_result_sha256=package_sha,
        package_tree_sha256=tree_sha, operator_observation_sha256=observation_sha)
    for name in ('review', 'owner_snapshot', 'execution_snapshot'):save(name)
    report['artifacts'] = {name: evidence.first.sha(value) for name, value in raw.items()}


class TrainingPackageEvidenceTests(unittest.TestCase):
    def test_consistently_relinked_non_git_source_commit_is_denied(self):
        report, raw, values = fixture(); report['source_commit'] = 'not-a-commit'
        for value in values.values():
            if type(value) is dict and 'source_commit' in value:value['source_commit'] = report['source_commit']
        for name in ('owner_snapshot', 'execution_snapshot'):values[name]['head'] = report['source_commit']
        repack(report, raw, values)
        with self.assertRaises(ValueError):evidence.validate(report, raw)

    def test_member_limit_matches_original_256_mib_capture_without_allocating_data(self):
        allowed = {'member': {'bytes': 256 * 1024**2, 'sha256': 'a' * 64}}
        self.assertEqual(evidence.package_rows(allowed), allowed)
        with self.assertRaises(ValueError):
            evidence.package_rows({'member': {'bytes': 256 * 1024**2 + 1, 'sha256': 'a' * 64}})

    def test_closed_package_bundle_is_supported_without_launch_authority(self):
        report, raw, _ = fixture(); values = evidence.validate(report, raw)
        self.assertEqual(values['package']['workerSourceFiles'], 1)
        self.assertTrue(all(value is False for value in report['scope'].values()))

    def test_every_retained_artifact_hash_is_required(self):
        report, raw, _ = fixture()
        for name in raw:
            with self.subTest(name=name), self.assertRaises(ValueError):evidence.validate(report, {**raw, name: raw[name] + b' '})

    def test_rehashed_wrong_role_deadline_and_allowance_are_still_denied(self):
        for record, field, value in (('plan', 'phase', 'training-ui'), ('plan', 'deadline_seconds', 690),
                ('effect', 'native_effect_allowance', True), ('plan', 'native_effect_allowance', False),
                ('review', 'native_effect_allowance', False), ('metadata_effect', 'native_effect_allowance', False)):
            report, raw, values = fixture(); values[record][field] = value; repack(report, raw, values)
            with self.subTest(record=record, field=field), self.assertRaises(ValueError):evidence.validate(report, raw)

    def test_rehashed_native_failure_and_incomplete_retirement_deny(self):
        for field, value in (('command_passed', False), ('cleanup_confirmed', False),
                             ('all_owned_handles_close_acknowledged', False), ('automatic_retry_allowed', True)):
            report, raw, values = fixture(); values['native'][field] = value; repack(report, raw, values)
            with self.subTest(field=field), self.assertRaises(ValueError):evidence.validate(report, raw)

    def test_rehashed_wrong_metadata_stage_or_claimed_application_execution_deny(self):
        for record, field, value in (('metadata', 'status', 'packaged'), ('metadata', 'forge_imported', True),
                ('package', 'applicationExecuted', True), ('observation', 'training_executed', True),
                ('package', 'optionalOcrQualification', 'passed')):
            report, raw, values = fixture(); values[record][field] = value; repack(report, raw, values)
            with self.subTest(record=record, field=field), self.assertRaises(ValueError):evidence.validate(report, raw)

    def test_worker_resource_cannot_differ_from_the_approved_source(self):
        report, raw, values = fixture(); values['tree']['files']['resources/worker/main.py'] = row(b'changed')
        repack(report, raw, values)
        with self.assertRaises(ValueError):evidence.validate(report, raw)

    def test_new_deleted_or_changed_product_source_remains_stale(self):
        before = {'modules/product.py': 'a'}
        for after in ({}, {'modules/product.py': 'b'}, {**before, 'apps/new.ts': 'c'}):
            with self.assertRaises(ValueError):evidence.current_source(before, after)
        self.assertEqual(len(evidence.QUALIFICATION_ONLY), 9)
        for path in evidence.QUALIFICATION_ONLY:evidence.current_source(before, {**before, path: 'qualification-only'})
        # Historical first-phase authority is deliberately not redefined.
        self.assertNotIn(evidence.REPORT, evidence.first.QUALIFICATION_ONLY)

    def test_path_alias_collision_and_package_bounds_deny(self):
        for rows in ({'../outside': row(b'x')}, {'A': row(b'x'), 'a': row(b'x')},
                     {'file': row(b'x'), 'file/child': row(b'y')}, {'NUL': row(b'x')},
                     {'huge': {'bytes': 512 * 1024**2 + 1, 'sha256': 'a' * 64}}):
            with self.subTest(rows=list(rows)), self.assertRaises(ValueError):evidence.package_rows(rows)

    def test_real_tree_walk_detects_extra_changed_and_linked_files(self):
        with tempfile.TemporaryDirectory(prefix='package-evidence-') as folder:
            root = Path(folder).resolve(); (root / 'resources').mkdir(); file = root / 'resources/data'
            file.write_bytes(b'data'); rows, directories = evidence.walk_package(root)
            self.assertEqual(rows, {'resources/data': row(b'data')}); self.assertEqual(directories, ['resources'])
            file.write_bytes(b'changed'); self.assertNotEqual(evidence.walk_package(root)[0], rows)
            (root / 'extra').write_bytes(b'extra'); self.assertIn('extra', evidence.walk_package(root)[0])
            os.link(file, root / 'linked')
            with self.assertRaises(ValueError):evidence.walk_package(root)

    def test_real_executable_and_package_metadata_identity(self):
        with tempfile.TemporaryDirectory(prefix='package-id-') as folder:
            root = Path(folder).resolve(); app = root / 'resources/app'; app.mkdir(parents=True)
            exe = root / 'ai-system-builder.exe'; exe.write_bytes(b'MZ' + b'0' * (1024**2 - 2))
            package = {'name': 'ai-system-builder', 'version': '0.1.0', 'main': '.vite/build/main.cjs'}
            (app / 'package.json').write_bytes(encoded(package)); rows, _ = evidence.walk_package(root)
            evidence.packaged_identity(root, rows)
            package['main'] = 'foreign.js'; (app / 'package.json').write_bytes(encoded(package))
            with self.assertRaises(ValueError):evidence.packaged_identity(root, rows)
            package['main'] = '.vite/build/main.cjs'; (app / 'package.json').write_bytes(encoded(package)); exe.write_bytes(b'NO' + b'0' * (1024**2 - 2))
            with self.assertRaises(ValueError):evidence.packaged_identity(root, rows)


def guarded_repack(report,raw,values):
    for key in ('cloned_manifest','user_authority'):raw[key]=encoded(values[key])
    values['plan']['user_authority_sha256']=evidence.first.sha(raw['user_authority'])
    values['plan']['input_manifest_sha256']=evidence.first.sha(raw['cloned_manifest'])
    values['metadata']['tiny_rows']={**values['cloned_manifest']['files'],'input.json':row(raw['cloned_manifest'])}
    repack(report,raw,values)
    values['guard_claim']['review_digest']=evidence.first.sha(raw['effect'])
    raw['guard_claim']=encoded(values['guard_claim'])
    values['guard_used'].update(claim_sha256=evidence.first.sha(raw['guard_claim']),effect_review_digest=evidence.first.sha(raw['effect']))
    raw['guard_used']=encoded(values['guard_used'])
    values['observation'].update(guard_claim_sha256=evidence.first.sha(raw['guard_claim']),guard_used_sha256=evidence.first.sha(raw['guard_used']))
    raw['observation']=encoded(values['observation'])
    values['review']['operator_observation_sha256']=evidence.first.sha(raw['observation'])
    raw['review']=encoded(values['review'])
    report['artifacts']={key:evidence.first.sha(value)for key,value in raw.items()}

def guarded_fixture():
    previous,earlier_raw,earlier_values=fixture()
    previous['run_id']=evidence.ORIGINAL_INPUT_RUN
    for value in earlier_values.values():
        if type(value)is dict and 'run_id'in value:value['run_id']=previous['run_id']
    repack(previous,earlier_raw,earlier_values)
    evidence.validate(previous,earlier_raw)
    report,raw,values=fixture();run='c'*32;report['run_id']=run
    guard_hash='e'*64
    files={**values['execution_snapshot']['files'],evidence.GUARD_SOURCE:guard_hash,
        evidence.REPORT:evidence.first.sha(encoded(previous))}
    digest=evidence.first.sha(encoded(files));report.update(owner_source_digest=digest,execution_source_digest=digest)
    for value in values.values():
        if type(value)is not dict:continue
        if 'run_id'in value:value['run_id']=run
        if 'owner_source_digest'in value:value['owner_source_digest']=digest
        if 'execution_source_digest'in value:value['execution_source_digest']=digest
        if 'source_digest'in value:value['source_digest']=digest
        if 'sourceDigest'in value:value['sourceDigest']=digest
    for role in ('owner','execution'):
        values[role+'_snapshot'].update(files=copy.deepcopy(files),source_digest=digest)
    proof={key:'f'*64 for key in evidence.GUARD_PROOF_ROLES}
    prior='.local-codex/h/'+evidence.first.PACKET+'/native-ui-repeat-'+evidence.PRIOR_FAILED_UI_RUN+'/native-ui-result-independent-review.json'
    for key in ('reference_plan','plan'):
        values[key].update(input_run_id=evidence.ORIGINAL_INPUT_RUN,guard_profile='loader-package',staging_relative='.local-codex/z/'+run[:8],
            proof_hashes=copy.deepcopy(proof),prior_review_relative=prior,proof_bindings={f'C:/qualification/proof/{n}.json':'f'*64 for n in range(19)})
    values['plan']['implementation_files']={evidence.GUARD_SOURCE:guard_hash}
    values['metadata'].update(staging_relative='.local-codex/z/'+run[:8],guard_allowance_reserved=False,staging_root_device=1,staging_root_inode=2)
    values['effect'].update(package_reservation_and_final_copy_allowed=True,ui_attempt_allowed=False)
    values['observation'].update(input_run_id=evidence.ORIGINAL_INPUT_RUN,guard_profile='loader-package')
    values['cloned_manifest']={'schemaVersion':'tiny-training-input-v1','inputProfile':'generated-tiny-qwen2-v1','files':{
        key:row(('synthetic-'+key).encode())for key in ('config.json','generation_config.json','model.safetensors','special_tokens_map.json','tokenizer.json','tokenizer_config.json')}}
    values['user_authority']={'schema_version':'qualification-user-direction-attestation-v1',
        'authority_ref':'user-allow-one-new-guarded-desktop-training-attempt-after-review-20261122','authorized_ui_attempts':1,
        'model_downloads_authorized':False,'accepted_accuracy_reruns_authorized':False,'old_failure_and_stop_records_must_remain':True,
        'automatic_retry_authorized':False,'record_is_operator_attestation_not_machine_authenticated_user_identity':True}
    values['guard_claim']={'schema_version':'reviewed-training-loader-package-v1','authority_ref':values['user_authority']['authority_ref'],
        'prior_run_id':evidence.PRIOR_FAILED_UI_RUN,'run_id':run,'proof_hashes':copy.deepcopy(proof),'prior_review':prior,
        'source_hashes':{'owned_command_job.py':guard_hash},'review_digest':'f'*64,'automatic_retry_allowed':False}
    values['guard_used']={'schema_version':'reviewed-training-loader-package-used-v1','run_id':run,'claim_sha256':'f'*64,
        'effect_review_digest':'f'*64,'automatic_retry_allowed':False}
    report.update(schema_version=evidence.GUARDED_SCHEMA,input_run_id=evidence.ORIGINAL_INPUT_RUN,guard_profile='loader-package',
        previous_qualification={'report':previous,'raw_utf8':encoded(previous).decode(),'sha256':evidence.first.sha(encoded(previous))})
    guarded_repack(report,raw,values);return report,raw,values

class GuardedParserTests(unittest.TestCase):
    def test_guarded_closed_package_keeps_old_history_and_no_execution_authority(self):
        report,raw,_=guarded_fixture();values=evidence.validate(report,raw)
        self.assertEqual(values['guard_claim']['run_id'],report['run_id'])
        self.assertTrue(all(v is False for v in report['scope'].values()))
        self.assertEqual(evidence.historical_report(report,values['owner_snapshot']['files'][evidence.REPORT])['run_id'],evidence.ORIGINAL_INPUT_RUN)
    def test_each_new_retained_blob_and_missing_role_is_rejected(self):
        report,raw,_=guarded_fixture()
        for key in ('guard_claim','guard_used','cloned_manifest','user_authority'):
            with self.subTest(key=key),self.assertRaises(ValueError):evidence.validate(report,{k:v for k,v in raw.items()if k!=key})
            with self.subTest(key=key),self.assertRaises(ValueError):evidence.validate(report,{**raw,key:raw[key]+b' '})
    def test_relinked_ui_or_wrong_prior_guard_is_rejected(self):
        for field,value in [('schema_version','reviewed-training-ui-loader-repeat-v1'),('prior_run_id','d'*32),('automatic_retry_allowed',True)]:
            report,raw,values=guarded_fixture();values['guard_claim'][field]=value;guarded_repack(report,raw,values)
            with self.subTest(field=field),self.assertRaises(ValueError):evidence.validate(report,raw)
    def test_relinked_missing_original_retirement_role_is_rejected(self):
        report,raw,values=guarded_fixture()
        for key in ('guard_claim','reference_plan','plan'):del values[key]['proof_hashes']['prior-used']
        guarded_repack(report,raw,values)
        with self.assertRaises(ValueError):evidence.validate(report,raw)
    def test_relinked_unsupported_extra_ui_or_copy_effect_is_rejected(self):
        for field,value in [('ui_attempt_allowed',True),('package_reservation_and_final_copy_allowed',False)]:
            report,raw,values=guarded_fixture();values['effect'][field]=value;guarded_repack(report,raw,values)
            with self.subTest(field=field),self.assertRaises(ValueError):evidence.validate(report,raw)
    def test_relinked_source_and_unconfirmed_staging_are_rejected(self):
        for field,value in [('guard_allowance_reserved',True),('staging_root_inode',False)]:
            report,raw,values=guarded_fixture();values['metadata'][field]=value;guarded_repack(report,raw,values)
            with self.subTest(field=field),self.assertRaises(ValueError):evidence.validate(report,raw)
        report,raw,values=guarded_fixture();values['guard_claim']['source_hashes']['owned_command_job.py']='d'*64;guarded_repack(report,raw,values)
        with self.assertRaises(ValueError):evidence.validate(report,raw)
    def test_changed_history_is_not_a_new_pass(self):
        report,raw,_=guarded_fixture();report['previous_qualification']['report']['scope']['parent_pass']=True
        with self.assertRaises(ValueError):evidence.validate(report,raw)

    def test_rehashed_history_bytes_must_match_the_captured_owner_source(self):
        report,raw,_=guarded_fixture()
        original=report['previous_qualification']['raw_utf8']
        for changed in (original.replace('\n','\r\n'),
                        json.dumps(report['previous_qualification']['report'],separators=(',',':'))):
            candidate=copy.deepcopy(report)
            history=candidate['previous_qualification']
            self.assertNotEqual(changed,original)
            history['raw_utf8']=changed
            history['sha256']=evidence.first.sha(changed.encode('utf8'))
            # Parsed history and all current physical blobs remain unchanged.
            self.assertEqual(json.loads(changed),history['report'])
            with self.subTest(reformat=changed[:30]),self.assertRaises(ValueError):
                evidence.validate(candidate,raw)
        for missing_or_wrong in (None,True,'a'*64):
            with self.subTest(anchor=missing_or_wrong),self.assertRaises(ValueError):
                evidence.historical_report(report,missing_or_wrong)
    def test_relinked_extra_authority_is_rejected(self):
        for field,value in [('authorized_ui_attempts',True),('model_downloads_authorized',True),('accepted_accuracy_reruns_authorized',True)]:
            report,raw,values=guarded_fixture();values['user_authority'][field]=value;guarded_repack(report,raw,values)
            with self.subTest(field=field),self.assertRaises(ValueError):evidence.validate(report,raw)



if __name__ == '__main__':
    unittest.main()
