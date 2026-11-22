"""Read-only Desktop training evidence; no app, model, native or approval action."""
from pathlib import Path
import base64
import json
import importlib.util
import os
import re
import sys
import training_first_phase_evidence as first
import training_package_evidence as package

PACKAGE_RUN = 'ceab8eb0df6f45a9bcbcf4b7252c67f6'
INPUT_RUN = '30430b9443254741986db4c15aae266d'
PRIOR_RUN = '65f21a80323e4b19b0bee230ccaf78ee'
GUARD = 'dev-tools/helpers/native-qualification/owned_command_job.py'

ROOT = Path(__file__).resolve().parents[3]
REPORT = 'docs/operations/headless-local-training-ui-qualification.json'
QUALIFICATION_ONLY = frozenset((REPORT,
    'dev-tools/helpers/native-qualification/training_ui_evidence.py',
    'dev-tools/helpers/native-qualification/tests/test_training_ui_evidence.py',
    'dev-tools/helpers/control_plane/catalog.py',
    'dev-tools/helpers/tests/test_control_plane_training_ui_evidence.py',
    'dev-tools/helpers/native-qualification/README.md',
    'docs/diagnostics/ai-development-control-plane.md',
    'docs/architecture/runtime-model.md',
    'docs/security/ai-development-control-plane-threat-model.md'))
TITLE = 'packaged desktop trains one local adapter, reviews privately, saves and reopens it'
PHASES = ['workspace-and-inputs-visible', 'configuration-bounded', 'training-accepted',
    'private-review-pending', 'candidate-unregistered', 'explicit-save-completed',
    'record-reopened', 'renderer-reload-preserved-record']
SCOPE = {key: False for key in ('accuracy_qualified', 'headless_qualified',
    'independent_coding_installation', 'parent_pass', 'native_effect_allowed', 'automatic_retry_allowed')}
SCOPE.update(application_executed=True, training_executed=True)


def need(value):
    if not value:
        raise ValueError('Desktop training UI evidence is unavailable or inconsistent.')


def integer(value, minimum, maximum):
    need(type(value) is int and minimum <= value <= maximum)
    return value


def ui_result(raw, source_identity):
    """A single passing real case and inline proof; never follow attachment paths."""
    value = first.decode(raw)
    need(type(value) is dict and not value.get('errors'))
    stats = value['stats']
    for name, expected in (('expected', 1), ('unexpected', 0), ('flaky', 0), ('skipped', 0)):
        need(type(stats[name]) is int and stats[name] == expected)
    specs = []
    def visit(suites, depth=0):
        need(type(suites) is list and len(suites) <= 8 and depth <= 4)
        for suite in suites:
            need(type(suite) is dict and type(suite.get('specs', [])) is list)
            specs.extend(suite.get('specs', [])); need(len(specs) <= 1)
            visit(suite.get('suites', []), depth + 1)
    visit(value['suites'])
    need(len(specs) == 1 and specs[0]['title'] == TITLE and specs[0]['ok'] is True)
    tests = specs[0]['tests']
    need(type(tests) is list and len(tests) == 1 and tests[0]['projectName'] == 'packaged-desktop'
         and tests[0]['status'] == 'expected')
    results = tests[0]['results']
    need(type(results) is list and len(results) == 1 and results[0]['status'] == 'passed'
         and type(results[0]['retry']) is int and results[0]['retry'] == 0 and not results[0].get('errors'))
    attachments = results[0]['attachments']
    need(type(attachments) is list and 2 <= len(attachments) <= 8)
    def attachment(name, maximum):
        rows = [row for row in attachments if type(row) is dict and row.get('name') == name]
        need(len(rows) == 1)
        row = rows[0]
        need(row.get('contentType') == 'application/json' and 'path' not in row
             and type(row.get('body')) is str and len(row['body']) <= maximum * 2)
        body = base64.b64decode(row['body'], validate=True)
        need(len(body) <= maximum)
        return first.decode(body)
    report = attachment('training-host-ui', 4096)
    need(set(report) == {'schemaVersion', 'host', 'status', 'inputProfile', 'phases', 'nextPhase',
                         'parentQualificationGranted', 'scope'}
         and report['schemaVersion'] == 'training-host-ui-outcome-v1'
         and report['host'] == 'packaged-desktop' and report['status'] == 'passed'
         and report['inputProfile'] == 'generated-tiny-qwen2-v1' and first.same(report['phases'], PHASES)
         and report['nextPhase'] == 'complete' and report['parentQualificationGranted'] is False
         and type(report['scope']) is str and 1 <= len(report['scope']) <= 512)
    cleanup = attachment('desktop-owned-worker-cleanup', 8192)
    need(cleanup['sourceRevision'] == source_identity and cleanup['status'] == 'passed'
         and type(cleanup['mainExitCode']) is int and cleanup['mainExitCode'] == 0
         and cleanup['willQuitAcknowledged'] is True and type(cleanup['physicalWorkersAlive']) is int
         and cleanup['physicalWorkersAlive'] == 0 and type(cleanup['failures']) is int and cleanup['failures'] == 0
         and cleanup['failureTypes'] == [] and cleanup['failureStages'] == [])
    for name in ('mainPid', 'launchedPid'): integer(cleanup[name], 1, 0xffffffff)
    observed = integer(cleanup['physicalWorkersObserved'], 1, 4)
    need(integer(cleanup['physicalWorkersNativeObserved'], 1, 4) == observed
         and integer(cleanup['physicalWorkersPidAbsenceObserved'], 0, 0) == 0)
    need(type(cleanup['cleanupMilliseconds']) in (int, float)
         and 0 <= cleanup['cleanupMilliseconds'] <= 690000)
    return report, cleanup


def recipe(run):
    first.recipe(run)  # Canonical bounded run identity, never an arbitrary path.
    need(run not in (PACKAGE_RUN, INPUT_RUN, PRIOR_RUN))
    folder = f'{first.PACKET}/native-ui-repeat-{run}'
    result = {name: ('coding', folder + '/' + leaf) for name, leaf in (
        ('plan', 'repeat-execution-plan.json'), ('effect', 'effect-review.json'),
        ('review', 'native-ui-result-independent-review.json'), ('observation', 'operator-result.json'),
        ('metadata', 'metadata-result.json'), ('tree', 'retained-package-files.json'),
        ('owner_snapshot', 'owner-source-snapshot.json'), ('execution_snapshot', 'execution-source-snapshot.json'))}
    result['script'] = ('coding', first.PACKET + '/run-reviewed-workflow-only-desktop-ui-v3.py')
    result['authority'] = ('coding', first.PACKET + '/training-ui-loader-repeat-authority-20261122.json')
    phase = f'.local-codex/native-training-host-v1/runs/{run}/training-ui'
    for name, leaf in (('native', 'native-result.json'), ('playwright', 'playwright-result.json'),
                       ('stdout', 'stdout.log'), ('stderr', 'stderr.log'), ('probes', 'readiness-probes.jsonl')):
        result[name] = ('primary', phase + '/' + leaf)
    key = first.sha(('packaged-desktop\0' + TITLE).encode())[:16]
    result['cleanup'] = ('primary', f'artifacts/qualification/visual-composer/runs/training-ui-{run}-01/owned-host/cleanup-{key}.json')
    result['manifest'] = first.recipe(run)['manifest']
    family = '.local-codex/native-training-host-v1/'
    result['claim'] = ('primary', family + 'reviewed-training-ui-loader-repeat-20261122.json')
    result['used'] = ('primary', family + 'reviewed-training-ui-loader-repeat-used-20261122.json')
    result['package_report'] = ('coding', package.REPORT)
    result.update({'package_' + name: path for name, path in package.recipe(PACKAGE_RUN, True).items()})
    return result


def readiness(raw):
    need(type(raw) is bytes and 0 < len(raw) <= 65536)
    lines = raw.splitlines()
    kinds = ['input-inspection', 'environment', 'pip-version', 'worker', 'gpu-nvidia', 'gpu-rocm',
             'torch', 'backend-cuda', 'environment', 'pip-version', 'training', 'context']
    need(len(lines) == len(kinds))
    for index, (line, kind) in enumerate(zip(lines, kinds), 1):
        row = first.decode(line)
        need(type(row) is dict and set(row) == {'probe', 'kind', 'exitCode', 'spawnErrorCode',
            'stderrErrorType', 'missingModules', 'stdoutBytes', 'stderrBytes', 'stdoutSha256',
            'stderrSha256', 'runtimeFacts'} and type(row['probe']) is int and row['probe'] == index
            and row['kind'] == kind and row['stderrErrorType'] is None and row['missingModules'] == [])
        for name in ('stdoutBytes', 'stderrBytes'): integer(row[name], 0, 65536)
        for name in ('stdoutSha256', 'stderrSha256'):
            need(type(row[name]) is str and re.fullmatch('[a-f0-9]{64}', row[name]))
        if kind in ('gpu-nvidia', 'gpu-rocm'):
            # Optional supplier utilities are observations, not backend qualification.
            need((type(row['exitCode']) is int and row['spawnErrorCode'] is None) or
                 (row['exitCode'] is None and row['spawnErrorCode'] in ('ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT')))
        else:
            need(type(row['exitCode']) is int and row['exitCode'] == 0 and row['spawnErrorCode'] is None)
        if kind == 'torch':
            need(first.same(row['runtimeFacts'], {'validJson': True, 'installed': True, 'pinnedVersion': True,
                'hasCudaVersion': True, 'hasHipVersion': False, 'cudaAvailable': True,
                'importErrorPresent': False, 'importErrorCategory': None}))
        else: need(row['runtimeFacts'] is None)
    return len(lines)


def current_source(before, current):
    need(type(before) is dict and type(current) is dict)
    need({name for name in before.keys() | current.keys() if before.get(name) != current.get(name)} <= QUALIFICATION_ONLY)


def validate(report, raw):
    need(type(report) is dict and set(report) == {'schema_version', 'status', 'run_id', 'source_commit',
        'owner_source_digest', 'execution_source_digest', 'artifacts', 'scope', 'package_run_id',
        'input_origin_run_id', 'guard_profile', 'quality_checks_excluded'}
        and report['schema_version'] == 'headless-local-training-ui-qualification-v2'
        and report['status'] == 'qualified-recorded-source-desktop-training-ui-only'
        and report['package_run_id'] == PACKAGE_RUN and report['input_origin_run_id'] == INPUT_RUN
        and report['guard_profile'] == 'loader' and report['quality_checks_excluded'] is True
        and type(report['source_commit']) is str and re.fullmatch('[a-f0-9]{40}', report['source_commit'])
        and first.same(report['scope'], SCOPE))
    need(type(raw) is dict and set(raw) == set(recipe(report['run_id'])) == set(report['artifacts']))
    for name, value in raw.items(): need(type(value) is bytes and first.sha(value) == report['artifacts'][name])
    names = ('plan', 'effect', 'review', 'observation', 'metadata', 'tree', 'owner_snapshot',
             'execution_snapshot', 'native', 'cleanup', 'manifest', 'claim', 'used', 'authority', 'package_report')
    values = {name: first.decode(raw[name]) for name in names}
    plan, effect, review, observation = (values[name] for name in ('plan', 'effect', 'review', 'observation'))
    for name, schema in (('plan', 'guarded-training-ui-repeat-plan-v1'),
        ('effect', 'guarded-training-ui-repeat-effect-review-v1'), ('review', 'independent-native-ui-result-review-v1'),
        ('observation', 'guarded-training-ui-repeat-outcome-v1'), ('metadata', 'reviewed-training-ui-repeat-metadata-v1')):
        need(values[name]['schema_version'] == schema and values[name]['run_id'] == report['run_id'])
    for name in ('plan', 'review', 'observation'):
        need(values[name]['source_commit'] == report['source_commit']
             and values[name]['owner_source_digest'] == report['owner_source_digest']
             and values[name]['execution_source_digest'] == report['execution_source_digest'])
    need(plan['work_id'] == review['work_id'] == observation['work_id'] == 'training-workflow-only-desktop-ui'
         and first.same(plan['claim'], review['claim'])
         and plan['roadmap_approval_fingerprint'] == review['roadmap_approval_fingerprint'])
    for role, key in (('owner', 'owner_source_digest'), ('execution', 'execution_source_digest')):
        source = values[role + '_snapshot']
        need(source['schema_version'] == 'source-snapshot-v1' and source['head'] == report['source_commit']
             and source['source_digest'] == report[key] and type(source['files']) is dict
             and first.sha((json.dumps(source['files'], indent=2, sort_keys=True) + '\n').encode()) == report[key]
             and plan['source_snapshot_sha256'][role] == report['artifacts'][role + '_snapshot'])
    need(effect['disposition'] == 'accepted' and effect['role'] == 'training-ui'
         and type(effect['native_effect_allowance']) is int and effect['native_effect_allowance'] == 1
         and effect['metadata_reservation_and_copy_allowed'] is True and effect['v2_deployment_allowed'] is True
         and effect['script_sha256'] == report['artifacts']['script'] and effect['plan_sha256'] == report['artifacts']['plan'])
    need(review['disposition'] == 'accepted-desktop-training-ui-and-confirmed-retirement-only'
         and type(review['native_effect_allowance']) is int and review['native_effect_allowance'] == 0
         and all(review[key] is False for key in ('accuracy_qualified', 'headless_qualified', 'parent_pass',
             'automatic_retry_allowed', 'additional_ui_attempt_allowed', 'application_launch_allowed',
             'cleanup_authorized', 'model_quality_testing_allowed')))
    refs = {'effect_review_sha256': 'effect', 'script_sha256': 'script', 'plan_sha256': 'plan',
        'native_result_sha256': 'native', 'playwright_result_sha256': 'playwright', 'cleanup_sha256': 'cleanup',
        'metadata_result_sha256': 'metadata', 'observation_sha256': 'observation',
        'readiness_probe_ledger_sha256': 'probes', 'claim_sha256': 'claim', 'used_sha256': 'used',
        'stdout_sha256': 'stdout', 'stderr_sha256': 'stderr'}
    need(all(review[key] == report['artifacts'][name] for key, name in refs.items()))
    need(type(plan['deadline_seconds']) is int and plan['deadline_seconds'] == 690
         and first.same(plan['limits'], {'process_bytes': 2 * 1024**3, 'job_bytes': 4 * 1024**3, 'active_limit': 32})
         and plan['guard_profile'] == 'loader' and plan['quality_checks_excluded'] is True
         and plan['accuracy_executed'] is plan['headless_qualified'] is plan['parent_pass'] is plan['automatic_retry_allowed'] is False)
    context = plan['context']
    need(context['run_id'] == report['run_id'] and context['phase'] == 'training-ui'
         and re.fullmatch(r'source\.[a-f0-9]{64}', context['source_identity'])
         and context['input_manifest_sha256'] == plan['input_manifest_sha256'] == report['artifacts']['manifest'])
    earlier = package.validate(values['package_report'], {name: raw['package_' + name]
        for name in package.recipe(PACKAGE_RUN, True)})
    need(values['package_report']['run_id'] == PACKAGE_RUN
         and plan['package_report_sha256'] == report['artifacts']['package_report']
         and context['application_sha256'] == earlier['package']['applicationSha256']
         and context['worker_main_sha256'] == earlier['package']['workerMainSha256']
         and plan['package_reference_source_commit'] == values['package_report']['source_commit']
         and first.same(values['tree'], {'files': earlier['tree']['files'], 'directories': earlier['tree']['directories']})
         and plan['retained_package_tree_sha256'] == report['artifacts']['tree']
         and all(values['execution_snapshot']['files'].get(name) == row['sha256'] for name, row in earlier['source']['files'].items()))
    claim, used, direction, metadata = (values[key] for key in ('claim', 'used', 'authority', 'metadata'))
    need(claim['schema_version'] == 'reviewed-training-ui-loader-repeat-v1'
         and used['schema_version'] == 'reviewed-training-ui-loader-repeat-used-v1'
         and claim['run_id'] == used['run_id'] == report['run_id'] and claim['prior_run_id'] == PRIOR_RUN
         and claim['review_digest'] == used['effect_review_digest'] == report['artifacts']['effect']
         and used['claim_sha256'] == metadata['claim_sha256'] == report['artifacts']['claim']
         and claim['automatic_retry_allowed'] is used['automatic_retry_allowed'] is False
         and first.same(claim['proof_hashes'], plan['proof_hashes'])
         and first.same(plan['proof_hashes'], earlier['plan']['proof_hashes'])
         and first.same(plan['proof_bindings'], earlier['plan']['proof_bindings'])
         and first.same(claim['source_hashes'], {'owned_command_job.py': values['execution_snapshot']['files'][GUARD]})
         and review['guard_implementation_sha256'] == values['execution_snapshot']['files'][GUARD])
    authority = 'user-allow-one-new-guarded-desktop-training-attempt-after-review-20261122'
    prior = '.local-codex/h/' + first.PACKET + '/native-ui-repeat-' + PRIOR_RUN + '/native-ui-result-independent-review.json'
    need(claim['prior_review'] == plan['prior_failure_review_relative'] == prior)
    need(direction['schema_version'] == 'qualification-user-direction-attestation-v1'
         and direction['authority_ref'] == claim['authority_ref'] == authority
         and type(direction['authorized_ui_attempts']) is int and direction['authorized_ui_attempts'] == 1
         and all(direction[key] is False for key in ('model_downloads_authorized',
             'accepted_accuracy_reruns_authorized', 'automatic_retry_authorized'))
         and direction['old_failure_and_stop_records_must_remain'] is True
         and direction['record_is_operator_attestation_not_machine_authenticated_user_identity'] is True
         and first.same({key: direction[key] for key in ('process_bytes', 'job_bytes', 'active_limit')}, plan['limits'])
         and type(direction['ui_deadline_seconds']) is int and direction['ui_deadline_seconds'] == 690
         and plan['user_authority_sha256'] == report['artifacts']['authority'])
    need(metadata['source_commit'] == report['source_commit'] and metadata['package_files'] == 242
         and metadata['package_bytes'] == 386291566 and metadata['model_files'] == 6 and metadata['model_bytes'] == 24240
         and metadata['input_manifest_sha256'] == report['artifacts']['manifest']
         and metadata['old_proof_and_stops_preserved'] is True and metadata['native_executed'] is metadata['parent_pass'] is False)
    first.native_result(values['native'], raw['stdout'], raw['stderr'])
    ui, cleanup = ui_result(raw['playwright'], context['source_identity'])
    need(first.same(values['cleanup'], {'schemaVersion': 'owned-host-outcome-v1', 'kind': 'cleanup', **cleanup})
         and readiness(raw['probes']) == review['readiness_probe_count'])
    need(observation['status'] == 'passed-review-required' and observation['source_identity'] == context['source_identity']
         and first.same(observation['ordered_phases'], PHASES) and observation['guard_profile'] == 'loader'
         and all(observation[key] is True for key in ('native_retirement_confirmed', 'desktop_and_workers_retired',
             'training_executed', 'application_executed', 'quality_checks_excluded'))
         and all(observation[key] is False for key in ('accuracy_executed', 'headless_qualified', 'automatic_retry_allowed', 'parent_pass'))
         and observation['physical_workers'] == cleanup['physicalWorkersObserved']
         and all(observation[key] == report['artifacts'][name] for key, name in (
             ('effect_review_sha256', 'effect'), ('metadata_result_sha256', 'metadata'), ('claim_sha256', 'claim'),
             ('used_sha256', 'used'), ('native_result_sha256', 'native'), ('playwright_result_sha256', 'playwright'))))
    return values, earlier


def check(root=ROOT):
    primary, coding = first.roots(root)
    report = first.decode(first.raw_file(root / REPORT))
    raw = {name: first.raw_file((coding if role == 'coding' else primary) / path,
        8 * 1024**2 if name in ('stdout', 'stderr', 'package_stdout', 'package_stderr') else 1024**2)
        for name, (role, path) in recipe(report['run_id']).items()}
    values, earlier = validate(report, raw)
    sys.path.insert(0, str(root / 'dev-tools/helpers'))
    try:
        from control_plane.candidate import snapshot
        for role, path in (('owner', coding), ('execution', primary)):
            current_source(values[role + '_snapshot']['files'], snapshot(path)['files'])
    finally: sys.path.pop(0)
    guard = primary / GUARD
    need(first.sha(first.raw_file(guard)) == values['execution_snapshot']['files'][GUARD])
    spec = importlib.util.spec_from_file_location('retained_primary_training_ui_guard', guard)
    job = importlib.util.module_from_spec(spec); sys.modules[spec.name] = job; spec.loader.exec_module(job)
    prior_review = coding / first.PACKET / ('native-ui-repeat-' + PRIOR_RUN) / 'native-ui-result-independent-review.json'
    need(first.same(job._training_ui_repeat_evidence(values['plan']['proof_hashes'], prior_review, 'loader'),
                    values['plan']['proof_bindings']))
    # Do not call the older package's deliberately stale current-all-repository check.
    # Verify its recorded facts and unchanged selected product bytes directly.
    for name, expected in earlier['source']['files'].items():
        package.byte_inputs._stream_reference(primary / name, expected, package.byte_inputs.MAX_SOURCE_FILE)
    for run in (PACKAGE_RUN, report['run_id']):
        package_root = primary / '.local-codex/q' / run[:8] / 'o/ai-system-builder-win32-x64'
        files, directories = package.walk_package(package_root)
        need(first.same(files, earlier['tree']['files']) and directories == earlier['tree']['directories'])
        package.packaged_identity(package_root, files)
    original = primary / first.recipe(INPUT_RUN)['manifest'][1]
    manifest = primary / recipe(report['run_id'])['manifest'][1]
    need(first.raw_file(original) == raw['manifest'])
    model = values['manifest']
    need(model['schemaVersion'] == 'tiny-training-input-v1' and model['inputProfile'] == 'generated-tiny-qwen2-v1')
    rows = package.byte_inputs.validated_files(model['files'], 'source')
    need(set(rows) == {'config.json', 'generation_config.json', 'model.safetensors', 'special_tokens_map.json',
                       'tokenizer.json', 'tokenizer_config.json'} and sum(row['bytes'] for row in rows.values()) == 24240)
    for folder in (original.parent, manifest.parent):
        package.byte_inputs._directory(folder)
        need({entry.name for entry in os.scandir(folder)} == set(rows) | {'input.json'})
        for name, expected in rows.items(): package.byte_inputs._stream_reference(folder / name, expected, 1024**2)
    for name in ('offline-package.mjs', 'playwright.config.mjs', 'global-setup.mjs', 'package-tree.mjs'):
        path = primary / '.local-codex/native-training-host-operator/v2' / report['run_id'] / 'training-ui' / name
        need(first.sha(first.raw_file(path)) == values['plan']['reviewed_file_hashes'][name])
    return {'status': report['status'], 'ordered_phases': len(PHASES), 'readiness_probes': 12,
        'native_retirement_confirmed': True, 'quality_scoring_executed': False,
        'native_effect_allowed': False, 'parent_pass': False}


if __name__ == '__main__':
    try:
        need(len(sys.argv) == 1)
        print(json.dumps(check()))
    except Exception:
        print(json.dumps({'status': 'training-ui-evidence-unavailable', 'parent_pass': False}))
        raise SystemExit(1)
