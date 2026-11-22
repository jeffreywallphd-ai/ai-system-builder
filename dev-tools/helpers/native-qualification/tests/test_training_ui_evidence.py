"""Controlled evidence-parser cases; no app, model, Native effect or real score."""
from pathlib import Path
import base64
import copy
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import training_ui_evidence as evidence
import test_training_first_phase_evidence as first_fixture


def encoded(value): return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()
def sha(value): return evidence.first.sha(value)
def attachment(name, value):
    return {'name': name, 'contentType': 'application/json', 'body': base64.b64encode(encoded(value)).decode()}


def fixture():
    run, commit, identity = 'd' * 32, 'b' * 40, 'source.' + 'c' * 64
    _, original, old = first_fixture.fixture()
    cleanup = {'sourceRevision': identity, 'status': 'passed', 'mainExitCode': 0,
        'willQuitAcknowledged': True, 'physicalWorkersAlive': 0, 'physicalWorkersObserved': 1,
        'physicalWorkersNativeObserved': 1, 'physicalWorkersPidAbsenceObserved': 0,
        'failures': 0, 'failureTypes': [], 'failureStages': [], 'mainPid': 1, 'launchedPid': 2,
        'cleanupMilliseconds': 5}
    ui = {'schemaVersion': 'training-host-ui-outcome-v1', 'host': 'packaged-desktop', 'status': 'passed',
        'inputProfile': 'generated-tiny-qwen2-v1', 'phases': list(evidence.PHASES), 'nextPhase': 'complete',
        'parentQualificationGranted': False, 'scope': 'Controlled parser input only; never actual qualification.'}
    playwright = {'stats': {'expected': 1, 'unexpected': 0, 'flaky': 0, 'skipped': 0}, 'errors': [],
        'suites': [{'specs': [{'title': evidence.TITLE, 'ok': True, 'tests': [{'projectName': 'packaged-desktop',
            'status': 'expected', 'results': [{'status': 'passed', 'retry': 0, 'errors': [],
                'attachments': [attachment('training-host-ui', ui), attachment('desktop-owned-worker-cleanup', cleanup)]}]}]}]}]}
    files = {'modules/example.ts': 'a' * 64, evidence.GUARD: 'e' * 64}
    digest = sha(encoded(files))
    common = {'run_id': run, 'source_commit': commit, 'owner_source_digest': digest, 'execution_source_digest': digest}
    values = {name: {} for name in ('plan', 'effect', 'review', 'observation', 'metadata', 'tree',
        'owner_snapshot', 'execution_snapshot', 'native', 'cleanup', 'manifest', 'claim', 'used', 'authority', 'package_report')}
    for role in ('owner', 'execution'):
        values[role + '_snapshot'] = {'schema_version': 'source-snapshot-v1', 'head': commit,
            'source_digest': digest, 'files': dict(files)}
    for name, schema in (('plan', 'guarded-training-ui-repeat-plan-v1'),
        ('effect', 'guarded-training-ui-repeat-effect-review-v1'), ('review', 'independent-native-ui-result-review-v1'),
        ('observation', 'guarded-training-ui-repeat-outcome-v1'), ('metadata', 'reviewed-training-ui-repeat-metadata-v1')):
        values[name].update(common, schema_version=schema)
    proof = {name: 'f' * 64 for name in evidence.package.GUARD_PROOF_ROLES}
    bindings = {f'proof-{i}': 'f' * 64 for i in range(19)}
    prior = '.local-codex/h/' + evidence.first.PACKET + '/native-ui-repeat-' + evidence.PRIOR_RUN + '/native-ui-result-independent-review.json'
    plan = values['plan']
    plan.update(work_id='training-workflow-only-desktop-ui', claim={'claim_id': 'controlled-only'},
        roadmap_approval_fingerprint='a' * 64, deadline_seconds=690,
        limits={'process_bytes': 2 * 1024**3, 'job_bytes': 4 * 1024**3, 'active_limit': 32},
        guard_profile='loader', quality_checks_excluded=True, accuracy_executed=False,
        headless_qualified=False, parent_pass=False, automatic_retry_allowed=False,
        context={'run_id': run, 'phase': 'training-ui', 'source_identity': identity,
            'application_sha256': 'a' * 64, 'worker_main_sha256': 'b' * 64},
        proof_hashes=proof, proof_bindings=bindings, prior_failure_review_relative=prior,
        package_reference_source_commit='c' * 40)
    values['effect'].update(disposition='accepted', role='training-ui', native_effect_allowance=1,
        metadata_reservation_and_copy_allowed=True, v2_deployment_allowed=True)
    review = values['review']
    review.update(work_id=plan['work_id'], claim=copy.deepcopy(plan['claim']),
        roadmap_approval_fingerprint=plan['roadmap_approval_fingerprint'],
        disposition='accepted-desktop-training-ui-and-confirmed-retirement-only', native_effect_allowance=0,
        guard_implementation_sha256=files[evidence.GUARD], readiness_probe_count=12)
    for key in ('accuracy_qualified', 'headless_qualified', 'parent_pass', 'automatic_retry_allowed',
                'additional_ui_attempt_allowed', 'application_launch_allowed', 'cleanup_authorized', 'model_quality_testing_allowed'):
        review[key] = False
    authority = 'user-allow-one-new-guarded-desktop-training-attempt-after-review-20261122'
    values['claim'].update(schema_version='reviewed-training-ui-loader-repeat-v1', run_id=run,
        prior_run_id=evidence.PRIOR_RUN, proof_hashes=copy.deepcopy(proof), prior_review=prior,
        source_hashes={'owned_command_job.py': files[evidence.GUARD]}, automatic_retry_allowed=False, authority_ref=authority)
    values['used'].update(schema_version='reviewed-training-ui-loader-repeat-used-v1', run_id=run, automatic_retry_allowed=False)
    values['authority'].update(schema_version='qualification-user-direction-attestation-v1', authority_ref=authority,
        authorized_ui_attempts=1, model_downloads_authorized=False, accepted_accuracy_reruns_authorized=False,
        automatic_retry_authorized=False, old_failure_and_stop_records_must_remain=True,
        record_is_operator_attestation_not_machine_authenticated_user_identity=True, ui_deadline_seconds=690, **plan['limits'])
    values['metadata'].update(package_files=242, package_bytes=386291566, model_files=6, model_bytes=24240,
        old_proof_and_stops_preserved=True, native_executed=False, parent_pass=False)
    values['observation'].update(work_id=plan['work_id'], status='passed-review-required', source_identity=identity,
        ordered_phases=list(evidence.PHASES), guard_profile='loader', physical_workers=1,
        native_retirement_confirmed=True, desktop_and_workers_retired=True, training_executed=True,
        application_executed=True, quality_checks_excluded=True, accuracy_executed=False,
        headless_qualified=False, automatic_retry_allowed=False, parent_pass=False)
    values['cleanup'] = {'schemaVersion': 'owned-host-outcome-v1', 'kind': 'cleanup', **cleanup}
    values['native'] = old['input_native']
    values['manifest'] = old['manifest']
    values['package_report'] = {'run_id': evidence.PACKAGE_RUN, 'source_commit': 'c' * 40}
    values['tree'] = {'files': {}, 'directories': []}
    earlier = {'tree': {'files': {}, 'directories': []}, 'package': {'applicationSha256': 'a' * 64,
        'workerMainSha256': 'b' * 64}, 'source': {'files': {'modules/example.ts': {'bytes': 1, 'sha256': 'a' * 64}}},
        'plan': {'proof_hashes': proof, 'proof_bindings': bindings}}
    raw = {name: encoded({}) for name in evidence.recipe(run)}
    raw.update(stdout=original['input_stdout'], stderr=original['input_stderr'],
        probes=original['probes'], script=b'# inert script witness', playwright=encoded(playwright))
    report = {'schema_version': 'headless-local-training-ui-qualification-v2',
        'status': 'qualified-recorded-source-desktop-training-ui-only', **common, 'artifacts': {},
        'package_run_id': evidence.PACKAGE_RUN, 'input_origin_run_id': evidence.INPUT_RUN,
        'guard_profile': 'loader', 'quality_checks_excluded': True, 'scope': dict(evidence.SCOPE)}
    repack(report, raw, values)
    return report, raw, values, earlier


def repack(report, raw, values):
    def save(name): raw[name] = encoded(values[name]); return sha(raw[name])
    for name in ('owner_snapshot', 'execution_snapshot', 'manifest', 'authority', 'package_report', 'tree', 'native', 'cleanup'): save(name)
    plan = values['plan']
    plan.update(source_snapshot_sha256={role: sha(raw[role + '_snapshot']) for role in ('owner', 'execution')},
        package_report_sha256=sha(raw['package_report']), retained_package_tree_sha256=sha(raw['tree']),
        input_manifest_sha256=sha(raw['manifest']), user_authority_sha256=sha(raw['authority']))
    plan['context']['input_manifest_sha256'] = plan['input_manifest_sha256']
    plan_sha = save('plan')
    values['effect'].update(script_sha256=sha(raw['script']), plan_sha256=plan_sha)
    effect_sha = save('effect')
    values['claim']['review_digest'] = effect_sha; claim_sha = save('claim')
    values['used'].update(effect_review_digest=effect_sha, claim_sha256=claim_sha); save('used')
    values['metadata'].update(claim_sha256=claim_sha, input_manifest_sha256=sha(raw['manifest'])); save('metadata')
    for key, name in (('effect_review_sha256', 'effect'), ('metadata_result_sha256', 'metadata'), ('claim_sha256', 'claim'),
                      ('used_sha256', 'used'), ('native_result_sha256', 'native'), ('playwright_result_sha256', 'playwright')):
        values['observation'][key] = sha(raw[name])
    save('observation')
    refs = {'effect_review_sha256': 'effect', 'script_sha256': 'script', 'plan_sha256': 'plan',
        'native_result_sha256': 'native', 'playwright_result_sha256': 'playwright', 'cleanup_sha256': 'cleanup',
        'metadata_result_sha256': 'metadata', 'observation_sha256': 'observation',
        'readiness_probe_ledger_sha256': 'probes', 'claim_sha256': 'claim', 'used_sha256': 'used',
        'stdout_sha256': 'stdout', 'stderr_sha256': 'stderr'}
    values['review'].update({key: sha(raw[name]) for key, name in refs.items()}); save('review')
    report['artifacts'] = {key: sha(value) for key, value in raw.items()}


class EvidenceTests(unittest.TestCase):
    def validate(self, report, raw, earlier):
        # The package parser has its own real tests. This isolates the new owner;
        # the separate retained check composes both parsers against actual bytes.
        with patch.object(evidence.package, 'validate', return_value=earlier): return evidence.validate(report, raw)

    def test_complete_controlled_packet_never_grants_parent_or_effect(self):
        report, raw, _, earlier = fixture()
        self.validate(report, raw, earlier)
        self.assertFalse(report['scope']['parent_pass']); self.assertFalse(report['scope']['native_effect_allowed'])

    def test_each_missing_or_changed_role_is_refused(self):
        report, raw, _, earlier = fixture()
        for key in raw:
            with self.subTest(role=key), self.assertRaises(ValueError): self.validate(report, {k: v for k, v in raw.items() if k != key}, earlier)
            with self.subTest(changed=key), self.assertRaises(ValueError): self.validate(report, {**raw, key: raw[key] + b' '}, earlier)

    def test_effect_scope_and_quality_flags_are_refused_even_when_rehashed(self):
        for target, field, value in (('effect', 'native_effect_allowance', True), ('effect', 'role', 'training-package'),
            ('review', 'model_quality_testing_allowed', True), ('review', 'cleanup_authorized', True),
            ('observation', 'quality_checks_excluded', False), ('observation', 'parent_pass', True)):
            report, raw, values, earlier = fixture(); values[target][field] = value; repack(report, raw, values)
            with self.subTest(target=target, field=field), self.assertRaises(ValueError): self.validate(report, raw, earlier)

    def test_source_owner_claim_and_approval_correspondence(self):
        for target, field in (('review', 'work_id'), ('review', 'claim'), ('review', 'roadmap_approval_fingerprint'),
                              ('owner_snapshot', 'source_digest')):
            report, raw, values, earlier = fixture(); values[target][field] = 'foreign'; repack(report, raw, values)
            with self.subTest(field=field), self.assertRaises(ValueError): self.validate(report, raw, earlier)

    def test_foreign_prior_guard_and_source_are_refused(self):
        for field, value in (('schema_version', 'reviewed-training-loader-package-v1'), ('prior_run_id', 'a' * 32),
                              ('prior_review', 'foreign/path'), ('source_hashes', {'owned_command_job.py': 'a' * 64})):
            report, raw, values, earlier = fixture(); values['claim'][field] = value; repack(report, raw, values)
            with self.subTest(field=field), self.assertRaises(ValueError): self.validate(report, raw, earlier)

    def test_authority_and_limits_are_not_relaxed(self):
        for field, value in (('authorized_ui_attempts', True), ('model_downloads_authorized', True),
            ('accepted_accuracy_reruns_authorized', True), ('process_bytes', 4 * 1024**3), ('ui_deadline_seconds', 691)):
            report, raw, values, earlier = fixture(); values['authority'][field] = value; repack(report, raw, values)
            with self.subTest(field=field), self.assertRaises(ValueError): self.validate(report, raw, earlier)

    def test_package_tree_and_recorded_product_binding(self):
        report, raw, values, earlier = fixture(); values['tree']['directories'] = ['foreign']; repack(report, raw, values)
        with self.assertRaises(ValueError): self.validate(report, raw, earlier)
        report, raw, values, earlier = fixture(); earlier['source']['files']['modules/example.ts']['sha256'] = 'f' * 64
        with self.assertRaises(ValueError): self.validate(report, raw, earlier)

    def test_failure_and_uncertain_native_retirement_never_pass(self):
        for field, value in (('root_exit_code', 1), ('cleanup_confirmed', False), ('all_owned_handles_close_acknowledged', False),
                              ('forced_owned_job_termination', True)):
            report, raw, values, earlier = fixture(); values['native'][field] = value; repack(report, raw, values)
            with self.subTest(field=field), self.assertRaises(ValueError): self.validate(report, raw, earlier)

    def test_ui_requires_all_ordered_phases_and_one_real_case(self):
        _, raw, _, _ = fixture(); ui = evidence.first.decode(raw['playwright'])
        for field, value in (('expected', 0), ('skipped', 1), ('flaky', 1), ('unexpected', 1)):
            v = copy.deepcopy(ui); v['stats'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): evidence.ui_result(encoded(v), 'source.' + 'c' * 64)
        v = copy.deepcopy(ui); rows = v['suites'][0]['specs'][0]['tests'][0]['results'][0]['attachments']
        body = evidence.first.decode(base64.b64decode(rows[0]['body'])); body['phases'].pop(); rows[0] = attachment(rows[0]['name'], body)
        with self.assertRaises(ValueError): evidence.ui_result(encoded(v), 'source.' + 'c' * 64)

    def test_ui_denies_path_or_duplicate_attachment_and_wrong_source(self):
        _, raw, _, _ = fixture(); ui = evidence.first.decode(raw['playwright'])
        for duplicate in (False, True):
            v = copy.deepcopy(ui); rows = v['suites'][0]['specs'][0]['tests'][0]['results'][0]['attachments']
            if duplicate: rows.append(copy.deepcopy(rows[0]))
            else: rows[0]['path'] = 'not-followed'
            with self.subTest(duplicate=duplicate), self.assertRaises(ValueError): evidence.ui_result(encoded(v), 'source.' + 'c' * 64)
        with self.assertRaises(ValueError): evidence.ui_result(raw['playwright'], 'source.' + 'd' * 64)

    def test_ui_denies_pid_absence_as_native_worker_proof(self):
        _, raw, _, _ = fixture(); ui = evidence.first.decode(raw['playwright'])
        rows = ui['suites'][0]['specs'][0]['tests'][0]['results'][0]['attachments']
        c = evidence.first.decode(base64.b64decode(rows[1]['body'])); c.update(physicalWorkersNativeObserved=0, physicalWorkersPidAbsenceObserved=1)
        rows[1] = attachment(rows[1]['name'], c)
        with self.assertRaises(ValueError): evidence.ui_result(encoded(ui), 'source.' + 'c' * 64)

    def test_readiness_is_bounded_ordered_and_requires_core_success(self):
        _, raw, _, _ = fixture(); self.assertEqual(evidence.readiness(raw['probes']), 12)
        for changed in (raw['probes'] * 100, b'\n'.join(raw['probes'].splitlines()[:-1]), b'{"probe":1,"probe":1}\n'):
            with self.assertRaises(ValueError): evidence.readiness(changed)
        rows = [evidence.first.decode(v) for v in raw['probes'].splitlines()]; rows[-1]['exitCode'] = 1
        with self.assertRaises(ValueError): evidence.readiness(b''.join(encoded(v).replace(b'\n', b'') + b'\n' for v in rows))

    def test_current_source_allows_exact_nine_report_paths_only(self):
        self.assertEqual(len(evidence.QUALIFICATION_ONLY), 9)
        before = {'modules/example.ts': 'a'}
        for name in evidence.QUALIFICATION_ONLY: evidence.current_source(before, {**before, name: 'b'})
        for name in ('modules/example.ts', 'docs/operations/roadmap-supporting-work.json', 'unknown.py'):
            with self.subTest(name=name), self.assertRaises(ValueError): evidence.current_source(before, {**before, name: 'b'})

    def test_recipe_never_accepts_paths_or_prior_consumed_runs(self):
        for run in ('../escape', 'a/b', 'A' * 32, evidence.PACKAGE_RUN, evidence.INPUT_RUN, evidence.PRIOR_RUN):
            with self.subTest(run=run), self.assertRaises(ValueError): evidence.recipe(run)
        for _, path in evidence.recipe('d' * 32).values():
            self.assertFalse(Path(path).is_absolute()); self.assertNotIn('..', Path(path).parts)

    def test_real_bounded_regular_file_read_denies_linked_or_oversized_evidence(self):
        with tempfile.TemporaryDirectory(prefix='training-ui-file-') as directory:
            p = Path(directory).resolve() / 'proof'; p.write_bytes(b'{}')
            self.assertEqual(evidence.first.raw_file(p), b'{}')
            with self.assertRaises(ValueError): evidence.first.raw_file(p, 1)
            os.link(p, p.with_name('other'))
            with self.assertRaises(ValueError): evidence.first.raw_file(p)


if __name__ == '__main__': unittest.main()
