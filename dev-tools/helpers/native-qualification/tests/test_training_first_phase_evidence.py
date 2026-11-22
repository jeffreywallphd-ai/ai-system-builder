"""Real parser/file/tamper cases; no Native, model or private historical inputs."""
from pathlib import Path
import copy
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import training_first_phase_evidence as evidence
from control_plane import candidate


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def fixture():
    run, commit = 'a' * 32, 'b' * 40
    generator = 'dev-tools/scripts/qualification/visual-composer/training-host-prerequisites.py'
    files = {'modules/example.py': evidence.sha(b'current'), generator: evidence.sha(b'creator')}
    digest = evidence.sha(encoded(files))
    identity = {'run_id': run, 'source_commit': commit, 'execution_source_digest': digest}
    values, raw = {}, {}
    for role in ('owner', 'execution'):
        values[role + '_snapshot'] = {'schema_version': 'source-snapshot-v1', 'head': commit,
            'files': files.copy(), 'source_digest': digest}
    names = ('config.json', 'generation_config.json', 'model.safetensors',
             'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json')
    model_files = {name: {'bytes': 4, 'sha256': evidence.sha(b'tiny')} for name in names}
    values['manifest'] = {'schemaVersion': 'tiny-training-input-v1',
        'inputProfile': 'generated-tiny-qwen2-v1', 'files': model_files,
        'modelId': 'aisb-testing/tiny-qwen2-v1', 'provider': 'unknown',
        'displayName': 'Generated tiny training input', 'generatorSha256': files[generator]}
    manifest_sha = evidence.sha(encoded(values['manifest']))
    kinds = ('input-inspection', 'environment', 'pip-version', 'worker', 'gpu-nvidia',
             'gpu-rocm', 'torch', 'backend-cuda', 'environment', 'pip-version', 'training', 'context')
    rows = []
    for index, kind in enumerate(kinds, 1):
        rows.append({'probe': index, 'kind': kind, 'exitCode': 255 if kind == 'gpu-nvidia' else
                     None if kind == 'gpu-rocm' else 0,
            'spawnErrorCode': 'ENOENT' if kind == 'gpu-rocm' else None, 'stderrErrorType': None,
            'missingModules': [], 'stdoutBytes': 0, 'stderrBytes': 0,
            'stdoutSha256': evidence.sha(b''), 'stderrSha256': evidence.sha(b''),
            'runtimeFacts': {'validJson': True, 'installed': True, 'pinnedVersion': True,
                'hasCudaVersion': True, 'hasHipVersion': False, 'cudaAvailable': True,
                'importErrorPresent': False, 'importErrorCategory': None} if kind == 'torch' else None})
    outcomes = [{'operation': 'worker', 'success': True, 'detectedBackend': 'cuda',
                 'selectedBackend': 'cuda', 'verificationSuccess': True, 'recordedStages': 7},
                {'operation': 'model-training', 'success': True, 'detectedBackend': None,
                 'selectedBackend': None, 'verificationSuccess': None, 'recordedStages': 3}]
    readiness = {'schemaVersion': 'training-host-readiness-v1', 'status': 'inputs-and-dependencies-verified',
        'completed': ['inputs', 'worker', 'training', 'context'], 'probeEvidenceClosed': True,
        'accuracyExecuted': False, 'deniedActions': [], 'probeCount': 12, 'dependencyOutcomes': outcomes}
    directory = evidence.recipe(run)['manifest'][1].rsplit('/', 1)[0]
    creator = {'schemaVersion': 'tiny-training-input-created-v1', 'modelId': 'aisb-testing/tiny-qwen2-v1',
        'provider': 'unknown', 'displayName': 'Generated tiny training input',
        'inputProfile': 'generated-tiny-qwen2-v1', 'modelRelativeDirectory': directory,
        'modelFiles': 6, 'modelBytes': 24, 'manifestSha256': manifest_sha,
        'accuracyExecuted': False, 'launchAuthorized': False}
    raw.update(input_stdout=encoded(creator), input_stderr=b'', readiness_stdout=encoded(readiness),
               readiness_stderr=b'', probes=b''.join(json.dumps(row).encode() + b'\n' for row in rows))
    for label in ('input', 'readiness'):
        raw[label + '_script'] = b'# Inert retained source, never executed.\n'
        values[label + '_plan'] = dict(identity)
        values[label + '_effect_review'] = {**identity, 'disposition': 'accepted', 'native_effect_allowance': 1}
        values[label + '_observation'] = {**identity, 'parent_pass': False, 'training_executed': False}
        values[label + '_result_review'] = {**identity, 'parent_pass': False, 'native_effect_allowance': 0,
            'disposition': 'accepted-input-creation-and-confirmed-retirement-only' if label == 'input'
            else 'accepted-read-only-readiness-and-confirmed-retirement-only'}
        phase = 'training-input-create' if label == 'input' else 'training-readiness'
        schema_prefix = 'input-create' if label == 'input' else 'readiness'
        values[label + '_plan'].update(schema_version='current-training-first-phase-plan-v1' if label == 'input'
            else 'current-training-readiness-plan-v1', phase=phase,
            context={'run_id': run, 'phase': phase, **({'input_manifest_sha256': manifest_sha} if label == 'readiness' else {})},
            deadline_seconds=120 if label == 'input' else 300,
            limits={'process_bytes': 2 * 1024**3, 'job_bytes': 4 * 1024**3, 'process_count': 32},
            native_effect_allowance=0, owner_source_digest=digest)
        values[label + '_effect_review'].update(schema_version='training-' + schema_prefix + '-effect-review-v1', role=phase)
        values[label + '_result_review'].update(schema_version='independent-' + schema_prefix + '-result-review-v1')
        values[label + '_observation'].update(schema_version='current-primary-training-input-created-v1' if label == 'input'
            else 'current-primary-training-readiness-v1', accuracy_executed=False)
        values[label + '_native'] = {'root_exit_code': 0, 'limits': evidence.LIMITS.copy(),
            'job_accounting': {'total': 35 if label == 'readiness' else 1, 'active': 0, 'terminated': 0},
            'peak_active_observed': 6, 'peak_commit': {'process_commit_bytes': 700000000,
                'job_commit_bytes': 855000000}, 'explicit_inherited_handles': 3,
            'cleanup_errors': [], 'observed_limit_messages': [], 'observed_limit_notifications': [],
            'reason': None, 'logs': {}}
        native = values[label + '_native']
        for name in ('command_passed', 'assigned_at_creation', 'resumed_after_membership',
                     'cleanup_confirmed', 'all_owned_handles_close_acknowledged'):
            native[name] = True
        for name in ('log_overflow', 'completion_message_overflow', 'job_handle_inherited',
                     'forced_owned_job_termination', 'fence_required', 'automatic_retry_allowed',
                     'reviewed_retry_possible', 'native_proof_for_old_processes',
                     'reported_pids_are_process_identity', 'absence_of_limit_hits_claimed'):
            native[name] = False
        for channel in ('stdout', 'stderr'):
            payload = raw[label + '_' + channel]
            native['logs'][channel] = {'complete': True, 'bytes': len(payload), 'observed_bytes': len(payload),
                'sha256': evidence.sha(payload), 'cap_bytes': 8 * 1024**2, 'path': 'ignored-untrusted-path'}
    values['input_observation']['manifest_sha256'] = manifest_sha
    values['input_observation'].update(model_files=6, readiness_executed=False)
    values['readiness_observation'].update(input_manifest_sha256=manifest_sha, dependency_outcomes=outcomes)
    values['readiness_observation'].update(probe_count=12, package_or_ui_executed=False)
    values['readiness_plan']['input_manifest_sha256'] = manifest_sha
    values['readiness_result_review'].update(input_manifest_sha256=manifest_sha,
        dependency_outcomes=outcomes, finite_probe_rows=rows, probe_ledger_sha256=evidence.sha(raw['probes']),
        input_files_unchanged=model_files)
    report = {'schema_version': 'headless-local-training-input-qualification-v1',
        'status': 'qualified-recorded-source-first-phases-only', 'run_id': run, 'source_commit': commit,
        'owner_source_digest': digest, 'execution_source_digest': digest,
        'scope': {key: False for key in evidence.FALSE_SCOPE}, 'artifacts': {}}
    repack(report, raw, values)
    return report, raw, values


def repack(report, raw, values):
    """Keep hash links consistent to test semantic refusals, not hash mismatch alone."""
    for key, value in values.items():
        if not key.endswith(('_result_review', '_effect_review')):
            raw[key] = encoded(value)
    for label in ('input', 'readiness'):
        effect = values[label + '_effect_review']
        for key, suffix in (('script_sha256', 'script'), ('plan_sha256', 'plan')):
            effect[key] = evidence.sha(raw[label + '_' + suffix])
        raw[label + '_effect_review'] = encoded(effect)
        review = values[label + '_result_review']
        for key, suffix in (('script_sha256', 'script'), ('plan_sha256', 'plan'),
                            ('native_result_sha256', 'native'), ('operator_observation_sha256', 'observation'),
                            ('effect_review_sha256', 'effect_review')):
            review[key] = evidence.sha(raw[label + '_' + suffix])
        raw[label + '_result_review'] = encoded(review)
    report['artifacts'] = {key: evidence.sha(value) for key, value in raw.items()}


class TrainingFirstPhaseEvidenceTests(unittest.TestCase):
    def test_creator_non_json_cannot_pass_with_consistent_artifact_and_log_hashes(self):
        report, raw, values = fixture()
        raw['input_stdout'] = b'not a creator result\n'
        values['input_native']['logs']['stdout'].update(bytes=len(raw['input_stdout']),
            observed_bytes=len(raw['input_stdout']), sha256=evidence.sha(raw['input_stdout']))
        repack(report, raw, values)
        with self.assertRaises(ValueError): evidence.validate_facts(report, raw)

    def test_other_roles_or_foreign_context_are_denied_with_consistent_hash_links(self):
        for target in ('input', 'readiness', 'context'):
            report, raw, values = fixture()
            if target == 'context':
                values['readiness_plan']['context']['input_manifest_sha256'] = 'f' * 64
            else:
                values[target + '_plan']['phase'] = 'training-ui'
                values[target + '_plan']['context']['phase'] = 'training-ui'
                values[target + '_effect_review']['role'] = 'training-ui'
            repack(report, raw, values)
            with self.subTest(target=target), self.assertRaises(ValueError): evidence.validate_facts(report, raw)

    def test_creator_identity_counts_and_launch_authority_must_match_manifest(self):
        for key, value in (('modelRelativeDirectory', '../foreign'), ('modelBytes', 25),
                           ('modelFiles', True), ('modelId', 'foreign/model'), ('launchAuthorized', True)):
            report, raw, values = fixture()
            creator = evidence.decode(raw['input_stdout'])
            creator[key] = value
            raw['input_stdout'] = encoded(creator)
            values['input_native']['logs']['stdout'].update(bytes=len(raw['input_stdout']),
                observed_bytes=len(raw['input_stdout']), sha256=evidence.sha(raw['input_stdout']))
            repack(report, raw, values)
            with self.subTest(key=key), self.assertRaises(ValueError): evidence.validate_facts(report, raw)

    def test_boolean_allowance_aliases_are_not_execution_or_review_counts(self):
        for suffix, flag in (('effect_review', True), ('result_review', False), ('plan', False)):
            report, raw, values = fixture()
            values['input_' + suffix]['native_effect_allowance'] = flag
            repack(report, raw, values)
            with self.subTest(suffix=suffix), self.assertRaises(ValueError): evidence.validate_facts(report, raw)

    def test_utf16_and_utf32_cannot_bypass_utf8_nesting_scan(self):
        nested = 0
        for _ in range(100): nested = [nested]
        value = json.dumps({'text': '"', 'deep': nested})
        for encoding in ('utf-8', 'utf-16', 'utf-32'):
            with self.subTest(encoding=encoding), self.assertRaises(ValueError):
                evidence.decode(value.encode(encoding))

    def test_success_keeps_cumulative_35_and_missing_optional_gpu_inventory(self):
        report, raw, _ = fixture()
        values = evidence.validate_facts(report, raw)
        self.assertEqual(values['readiness_native']['job_accounting']['total'], 35)
        self.assertEqual(values['readiness_result_review']['finite_probe_rows'][5]['spawnErrorCode'], 'ENOENT')
        self.assertTrue(all(value is False for value in report['scope'].values()))

    def test_each_retained_artifact_must_match_its_actual_hash(self):
        report, raw, _ = fixture()
        for key in raw:
            changed = dict(raw, **{key: raw[key] + b' '})
            with self.subTest(key=key), self.assertRaises(ValueError):
                evidence.validate_facts(report, changed)

    def test_missing_or_foreign_artifact_is_not_qualified(self):
        report, raw, _ = fixture()
        for changed in ({key: value for key, value in raw.items() if key != 'input_native'},
                        {**raw, '../foreign': b'x'}):
            with self.assertRaises(ValueError):
                evidence.validate_facts(report, changed)

    def test_no_parent_or_accuracy_or_effect_claim_and_no_boolean_alias(self):
        report, raw, _ = fixture()
        for key in evidence.FALSE_SCOPE:
            for flag in (True, 0, 'false'):
                changed = copy.deepcopy(report)
                changed['scope'][key] = flag
                with self.subTest(key=key, flag=flag), self.assertRaises(ValueError):
                    evidence.validate_facts(changed, raw)

    def test_run_has_no_path_namespace_or_uppercase_alias(self):
        for run in ('../outside', 'a' * 31, 'A' * 32, True, [], 'a' * 32 + '/extra'):
            with self.subTest(run=run), self.assertRaises(ValueError):
                evidence.recipe(run)

    def test_duplicate_nonfinite_deep_oversized_and_scalar_json_are_denied(self):
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}', b'[' * 65 + b'0' + b']' * 65,
                    b' ' * (1024**2 + 1), b'true', b'"scalar"'):
            with self.subTest(size=len(raw)), self.assertRaises((ValueError, TypeError)):
                evidence.decode(raw)
        self.assertEqual(evidence.decode(b'{"text":"[\\\"{]"}'), {'text': '["{]'})

    def test_all_required_native_cleanup_and_limit_failures_are_semantic_denials(self):
        for field, value in (('root_exit_code', 1), ('root_exit_code', False), ('cleanup_confirmed', False),
                             ('all_owned_handles_close_acknowledged', False), ('automatic_retry_allowed', True),
                             ('forced_owned_job_termination', True), ('log_overflow', True),
                             ('completion_message_overflow', True), ('peak_active_observed', 33),
                             ('limits', {**evidence.LIMITS, 'job_bytes': 8 * 1024**3})):
            report, raw, values = fixture()
            values['readiness_native'][field] = value
            repack(report, raw, values)
            with self.subTest(field=field), self.assertRaises(ValueError):
                evidence.validate_facts(report, raw)

    def test_live_process_incomplete_drain_and_memory_over_limit_are_denied(self):
        for kind in ('active', 'drain', 'memory', 'force-error'):
            report, raw, values = fixture()
            native = values['input_native']
            if kind == 'active': native['job_accounting']['active'] = 1
            if kind == 'drain': native['logs']['stdout']['observed_bytes'] += 1
            if kind == 'memory': native['peak_commit']['process_commit_bytes'] = 2 * 1024**3 + 1
            if kind == 'force-error': native['cleanup_errors'] = ['unknown']
            repack(report, raw, values)
            with self.subTest(kind=kind), self.assertRaises(ValueError): evidence.validate_facts(report, raw)

    def test_probe_failure_cannot_be_hidden_in_an_also_modified_review(self):
        for field, value in (('exitCode', 1), ('exitCode', False), ('probe', True), ('kind', 'unknown'),
                             ('missingModules', ['torch']), ('stderrBytes', -1), ('runtimeFacts', {})):
            report, raw, values = fixture()
            values['readiness_result_review']['finite_probe_rows'][0][field] = value
            rows = values['readiness_result_review']['finite_probe_rows']
            raw['probes'] = b''.join(json.dumps(row).encode() + b'\n' for row in rows)
            values['readiness_result_review']['probe_ledger_sha256'] = evidence.sha(raw['probes'])
            repack(report, raw, values)
            with self.subTest(field=field), self.assertRaises(ValueError): evidence.validate_facts(report, raw)

    def test_other_optional_gpu_failures_are_not_silently_ignored(self):
        report, raw, values = fixture()
        rows = values['readiness_result_review']['finite_probe_rows']
        rows[4]['exitCode'] = 1
        raw['probes'] = b''.join(json.dumps(row).encode() + b'\n' for row in rows)
        values['readiness_result_review']['probe_ledger_sha256'] = evidence.sha(raw['probes'])
        repack(report, raw, values)
        with self.assertRaises(ValueError): evidence.validate_facts(report, raw)

    def test_foreign_manifest_or_execution_source_cannot_be_rebound_by_name(self):
        for record, field in (('readiness_plan', 'input_manifest_sha256'),
                              ('input_observation', 'execution_source_digest'),
                              ('readiness_result_review', 'source_commit')):
            report, raw, values = fixture()
            values[record][field] = 'c' * (40 if field == 'source_commit' else 64)
            repack(report, raw, values)
            with self.subTest(record=record), self.assertRaises(ValueError): evidence.validate_facts(report, raw)

    def test_every_source_addition_deletion_or_change_outside_nine_paths_stays_stale(self):
        before = {'modules/product.ts': 'a'}
        for after in ({}, {'modules/product.ts': 'b'}, {**before, 'apps/new.ts': 'c'}):
            with self.assertRaises(ValueError): evidence.current_source(before, after)
        self.assertEqual(len(evidence.QUALIFICATION_ONLY), 9)
        for name in evidence.QUALIFICATION_ONLY:
            evidence.current_source(before, {**before, name: 'new qualification-only bytes'})

    def test_stable_regular_file_bounds_and_single_link_are_enforced(self):
        with tempfile.TemporaryDirectory(prefix='first-evidence-') as folder:
            path = Path(folder).resolve() / 'bytes'
            path.write_bytes(b'12345')
            self.assertEqual(evidence.raw_file(path, 5), b'12345')
            with self.assertRaises(ValueError): evidence.raw_file(path, 4)
            os.link(path, path.with_name('linked'))
            with self.assertRaises(ValueError): evidence.raw_file(path)
            with self.assertRaises((OSError, ValueError)): evidence.raw_file(path.parent)

    def test_real_file_check_rehashes_six_inputs_and_does_not_open_log_paths(self):
        report, raw, values = fixture()
        # The controller already has an isolated TEMP. A second long fixture
        # prefix exceeds classic Windows paths before the reader can run.
        # Use one short repository-owned disposable slot, retaining real paths
        # and every production read/containment guard.
        home = Path(__file__).resolve().parents[4] / '.local-codex/t'
        home.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='e-', dir=home) as folder:
            base = Path(folder).resolve()
            primary, coding = base / 'p', base / 'h'
            primary.mkdir(); coding.mkdir()
            for name, (role, relative) in evidence.recipe(report['run_id']).items():
                path = (coding if role == 'coding' else primary) / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw[name])
            path = coding / evidence.REPORT
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(encoded(report))
            model = primary / evidence.recipe(report['run_id'])['manifest'][1]
            for name in values['manifest']['files']: (model.parent / name).write_bytes(b'tiny')
            def snapshot(root):
                return values[('owner' if root == coding else 'execution') + '_snapshot']
            with patch.object(evidence, 'roots', return_value=(primary, coding)), patch.object(candidate, 'snapshot', side_effect=snapshot):
                result = evidence.check(coding)
                self.assertFalse(result['parent_pass'])
                self.assertEqual(result['model_files'], 6)
                (model.parent / 'model.safetensors').write_bytes(b'evil')
                with self.assertRaises(ValueError): evidence.check(coding)

    def test_unknown_physical_root_is_not_an_implicit_evidence_root(self):
        with tempfile.TemporaryDirectory(prefix='first-evidence-') as folder:
            with self.assertRaises((ValueError, OSError)): evidence.roots(Path(folder).resolve())


if __name__ == '__main__':
    unittest.main()
