"""Read-only first-phase training evidence; no native, model or approval action.

The versioned report pins retained observations and separate reviews. Hashes
coordinate cooperative qualification, not reviewer authentication or file custody.
Never follow paths or commands supplied by a retained artifact.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

from training_package_inputs import _directory, _stream_reference

ROOT = Path(__file__).resolve().parents[3]
REPORT = 'docs/operations/headless-local-training-input-qualification.json'
PACKET = '.local-codex/headless-provider-import-20261117'
QUALIFICATION_ONLY = frozenset((REPORT,
    'dev-tools/helpers/native-qualification/training_first_phase_evidence.py',
    'dev-tools/helpers/native-qualification/tests/test_training_first_phase_evidence.py',
    'dev-tools/helpers/control_plane/catalog.py',
    'dev-tools/helpers/tests/test_control_plane_training_first_phase_evidence.py',
    'dev-tools/helpers/native-qualification/README.md',
    'docs/diagnostics/ai-development-control-plane.md',
    'docs/architecture/runtime-model.md',
    'docs/security/ai-development-control-plane-threat-model.md'))
FALSE_SCOPE = ('training_executed', 'package_or_ui_executed', 'accuracy_qualified',
               'headless_qualified', 'independent_coding_installation', 'parent_pass',
               'native_effect_allowed', 'automatic_retry_allowed')
LIMITS = {'flags': 8968, 'process_bytes': 2 * 1024**3,
          'job_bytes': 4 * 1024**3, 'active_limit': 32}


def need(value):
    if not value:
        raise ValueError('Training first-phase evidence is unavailable or inconsistent.')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def same(value, expected):
    """JSON equality with exact scalar types; bool is never a count."""
    if type(value) is not type(expected):
        return False
    if type(value) is dict:
        return set(value) == set(expected) and all(same(value[key], item) for key, item in expected.items())
    if type(value) is list:
        return len(value) == len(expected) and all(same(a, b) for a, b in zip(value, expected))
    return value == expected


def decode(raw):
    # Bound JSON before parsing, including nesting and duplicate properties.
    need(type(raw) is bytes and len(raw) <= 1024**2)
    text = raw.decode('utf-8')
    depth, quoted, escaped = 0, False, False
    for byte in raw:
        if quoted:
            if escaped:
                escaped = False
            elif byte == 92:
                escaped = True
            elif byte == 34:
                quoted = False
        elif byte == 34:
            quoted = True
        elif byte in (91, 123):
            depth += 1
            need(depth <= 64)
        elif byte in (93, 125):
            depth -= 1
            need(depth >= 0)
    def pairs(rows):
        result = {}
        for key, value in rows:
            need(key not in result)
            result[key] = value
        return result
    # Passing bytes here would let json.loads autodetect UTF-16/32 after the
    # UTF-8 byte scan, bypassing its quote/nesting accounting.
    result = json.loads(text, object_pairs_hook=pairs,
                        parse_constant=lambda _: need(False))
    need(type(result) in (dict, list))
    return result


def raw_file(path, maximum=1024**2):
    # Reuse the tested bounded single-link/stable reader. Its optional writer
    # only receives bytes in memory here, never a filesystem output stream.
    class Memory:
        def __init__(self):
            self.blocks = []
        def write(self, block):
            self.blocks.append(block)
            return len(block)
    target = Memory()
    _stream_reference(path, None, maximum, target)
    return b''.join(target.blocks)


def roots(root):
    root = root.absolute()
    need(root.resolve() == root)
    if root.name == 'h' and root.parent.name == '.local-codex':
        primary, coding = root.parents[1], root
    else:
        primary, coding = root, root / '.local-codex/h'
    for path in (primary, coding):
        _directory(path)
    # This is the one supported physical layout, not a caller-supplied root.
    need((primary / '.git').is_dir())
    gitfile = raw_file(coding / '.git', 4096).decode('utf-8').strip()
    need(gitfile.startswith('gitdir: '))
    gitdir = Path(gitfile[8:])
    need(gitdir.is_absolute() and gitdir.resolve() == gitdir
         and gitdir.parent == primary / '.git/worktrees')
    common = (gitdir / raw_file(gitdir / 'commondir', 4096).decode().strip()).resolve()
    need(common == primary / '.git')
    return primary, coding


def recipe(run):
    need(type(run) is str and re.fullmatch('[a-f0-9]{32}', run))
    first = f'{PACKET}/native-first-phases-{run}'
    ready = f'{PACKET}/native-readiness-{run}'
    phases = f'.local-codex/native-training-host-v1/runs/{run}'
    result = {
        'owner_snapshot': ('coding', first + '/owner-source-snapshot.json'),
        'execution_snapshot': ('coding', first + '/execution-source-snapshot.json'),
    }
    for label, folder, prefix, script in (
            ('input', first, 'input-create', 'deploy-input-and-run.py'),
            ('readiness', ready, 'readiness', 'deploy-readiness-and-run.py')):
        for kind, leaf in (
                ('plan', prefix + '-prospective-plan.json'),
                ('script', script),
                ('effect_review', 'input-create-effect-review-owner-bound.json'
                 if label == 'input' else 'readiness-effect-review.json'),
                ('result_review', prefix + '-result-independent-review.json'),
                ('observation', prefix + '-operator-result.json')):
            result[label + '_' + kind] = ('coding', folder + '/' + leaf)
        phase = phases + '/training-' + ('input-create' if label == 'input' else 'readiness')
        for kind, leaf in (('native', 'native-result.json'), ('stdout', 'stdout.log'), ('stderr', 'stderr.log')):
            result[label + '_' + kind] = ('primary', phase + '/' + leaf)
    result['probes'] = ('primary', phases + '/training-readiness/readiness-probes.jsonl')
    uuid = f'{run[:8]}-{run[8:12]}-{run[12:16]}-{run[16:20]}-{run[20:]}'
    result['manifest'] = ('primary', f'.local-codex/training-inputs/tiny-{uuid}/input.json')
    return result


def native_result(value, stdout, stderr):
    need(type(value) is dict and value['root_exit_code'] == 0
         and type(value['root_exit_code']) is int and same(value['limits'], LIMITS))
    for key in ('command_passed', 'assigned_at_creation', 'resumed_after_membership',
                'cleanup_confirmed', 'all_owned_handles_close_acknowledged'):
        need(value[key] is True)
    for key in ('log_overflow', 'completion_message_overflow', 'job_handle_inherited',
                'forced_owned_job_termination', 'fence_required', 'automatic_retry_allowed',
                'reviewed_retry_possible', 'native_proof_for_old_processes',
                'reported_pids_are_process_identity', 'absence_of_limit_hits_claimed'):
        need(value[key] is False)
    need(value['cleanup_errors'] == value['observed_limit_messages']
         == value['observed_limit_notifications'] == [] and value['reason'] is None)
    accounting, peaks = value['job_accounting'], value['peak_commit']
    need(type(accounting['total']) is int and 1 <= accounting['total'] <= 1024
         and type(accounting['active']) is int and accounting['active'] == 0
         and type(accounting['terminated']) is int and accounting['terminated'] == 0
         and type(value['peak_active_observed']) is int
         and 1 <= value['peak_active_observed'] <= 32)
    for key, limit in (('process_commit_bytes', LIMITS['process_bytes']),
                       ('job_commit_bytes', LIMITS['job_bytes'])):
        need(type(peaks[key]) is int and 0 < peaks[key] <= limit)
    need(value['explicit_inherited_handles'] == 3)
    for name, raw in (('stdout', stdout), ('stderr', stderr)):
        log = value['logs'][name]
        need(log['complete'] is True and type(log['bytes']) is int
             and log['bytes'] == log['observed_bytes'] == len(raw)
             and log['sha256'] == sha(raw) and log['cap_bytes'] == 8 * 1024**2)
        # log.path is an observation only; it is never opened.


def validate_facts(report, raw):
    need(set(report) == {'schema_version', 'status', 'run_id', 'source_commit',
                         'owner_source_digest', 'execution_source_digest', 'artifacts', 'scope'})
    need(report['schema_version'] == 'headless-local-training-input-qualification-v1'
         and report['status'] == 'qualified-recorded-source-first-phases-only'
         and re.fullmatch('[a-f0-9]{40}', report['source_commit'])
         and type(report['scope']) is dict and set(report['scope']) == set(FALSE_SCOPE)
         and all(report['scope'][key] is False for key in FALSE_SCOPE))
    need(set(raw) == set(recipe(report['run_id'])) == set(report['artifacts']))
    for name, payload in raw.items():
        need(type(payload) is bytes and type(report['artifacts'][name]) is str
             and sha(payload) == report['artifacts'][name])
    values = {name: decode(payload) for name, payload in raw.items()
              if name not in ('input_stderr', 'readiness_stdout',
                              'readiness_stderr', 'probes', 'input_script', 'readiness_script')}
    manifest_hash = sha(raw['manifest'])
    for label, disposition in (
            ('input', 'accepted-input-creation-and-confirmed-retirement-only'),
            ('readiness', 'accepted-read-only-readiness-and-confirmed-retirement-only')):
        plan, review, effect, observation = (values[label + '_' + suffix]
                                            for suffix in ('plan', 'result_review', 'effect_review', 'observation'))
        phase = 'training-input-create' if label == 'input' else 'training-readiness'
        prefix = 'input-create' if label == 'input' else 'readiness'
        need(plan['schema_version'] == ('current-training-first-phase-plan-v1' if label == 'input'
                                       else 'current-training-readiness-plan-v1')
             and effect['schema_version'] == 'training-' + prefix + '-effect-review-v1'
             and review['schema_version'] == 'independent-' + prefix + '-result-review-v1'
             and observation['schema_version'] == ('current-primary-training-input-created-v1' if label == 'input'
                                                   else 'current-primary-training-readiness-v1'))
        context = {'run_id': report['run_id'], 'phase': phase}
        if label == 'readiness': context['input_manifest_sha256'] = manifest_hash
        need(plan['phase'] == effect['role'] == phase and same(plan['context'], context)
             and type(plan['deadline_seconds']) is int
             and plan['deadline_seconds'] == (120 if label == 'input' else 300)
             and same(plan['limits'], {'process_bytes': LIMITS['process_bytes'],
                 'job_bytes': LIMITS['job_bytes'], 'process_count': LIMITS['active_limit']})
             and type(plan['native_effect_allowance']) is int and plan['native_effect_allowance'] == 0)
        for record in (plan, review, effect, observation):
            need(record['run_id'] == report['run_id'] and record['source_commit'] == report['source_commit']
                 and record['execution_source_digest'] == report['execution_source_digest'])
        need(review['disposition'] == disposition and review['parent_pass'] is False
             and type(review['native_effect_allowance']) is int and review['native_effect_allowance'] == 0
             and observation['parent_pass'] is False and observation['training_executed'] is False
             and observation['accuracy_executed'] is False)
        for key, suffix in (('script_sha256', 'script'), ('plan_sha256', 'plan'),
                            ('native_result_sha256', 'native'),
                            ('operator_observation_sha256', 'observation'), ('effect_review_sha256', 'effect_review')):
            need(review[key] == report['artifacts'][label + '_' + suffix])
        need(effect['disposition'] == 'accepted' and type(effect['native_effect_allowance']) is int
             and effect['native_effect_allowance'] == 1
             and effect['script_sha256'] == report['artifacts'][label + '_script']
             and effect['plan_sha256'] == report['artifacts'][label + '_plan'])
        native_result(values[label + '_native'], raw[label + '_stdout'], raw[label + '_stderr'])
    for role, key in (('owner', 'owner_source_digest'), ('execution', 'execution_source_digest')):
        source = values[role + '_snapshot']
        need(source['schema_version'] == 'source-snapshot-v1' and source['head'] == report['source_commit']
             and source['source_digest'] == report[key])
        encoded = (json.dumps(source['files'], indent=2, sort_keys=True) + '\n').encode()
        need(sha(encoded) == report[key] and 1 <= len(source['files']) <= 20000)
    need(values['input_observation']['manifest_sha256'] == manifest_hash
         == values['readiness_observation']['input_manifest_sha256']
         == values['readiness_plan']['input_manifest_sha256']
         == values['readiness_result_review']['input_manifest_sha256'])
    manifest, creator = values['manifest'], values['input_stdout']
    files = manifest['files']
    need(type(files) is dict and set(files) == {'config.json', 'generation_config.json', 'model.safetensors',
                                              'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json'})
    for item in files.values():
        need(type(item) is dict and set(item) == {'bytes', 'sha256'} and type(item['bytes']) is int
             and 0 < item['bytes'] <= 1024**2 and re.fullmatch('[a-f0-9]{64}', item['sha256']))
    generator = 'dev-tools/scripts/qualification/visual-composer/training-host-prerequisites.py'
    need(manifest['schemaVersion'] == 'tiny-training-input-v1'
         and manifest['inputProfile'] == 'generated-tiny-qwen2-v1'
         and manifest['modelId'] == 'aisb-testing/tiny-qwen2-v1' and manifest['provider'] == 'unknown'
         and manifest['displayName'] == 'Generated tiny training input'
         and manifest['generatorSha256'] == values['execution_snapshot']['files'][generator])
    need(same(creator, {'schemaVersion': 'tiny-training-input-created-v1', 'modelId': manifest['modelId'],
        'provider': manifest['provider'], 'displayName': manifest['displayName'], 'inputProfile': manifest['inputProfile'],
        'modelRelativeDirectory': recipe(report['run_id'])['manifest'][1].rsplit('/', 1)[0],
        'modelFiles': 6, 'modelBytes': sum(row['bytes'] for row in files.values()), 'manifestSha256': manifest_hash,
        'accuracyExecuted': False, 'launchAuthorized': False})
         and values['input_observation']['model_files'] == 6
         and values['input_observation']['readiness_executed'] is False
         and type(values['readiness_observation']['probe_count']) is int
         and values['readiness_observation']['probe_count'] == 12
         and values['readiness_observation']['package_or_ui_executed'] is False)
    facts = decode(raw['readiness_stdout'])
    need(facts['schemaVersion'] == 'training-host-readiness-v1'
         and facts['status'] == 'inputs-and-dependencies-verified'
         and facts['completed'] == ['inputs', 'worker', 'training', 'context']
         and facts['probeEvidenceClosed'] is True and facts['accuracyExecuted'] is False
         and facts['deniedActions'] == [] and type(facts['probeCount']) is int and facts['probeCount'] == 12)
    review = values['readiness_result_review']
    need(facts['dependencyOutcomes'] == review['dependency_outcomes']
         == values['readiness_observation']['dependency_outcomes'])
    outcomes = facts['dependencyOutcomes']
    need(len(outcomes) == 2 and same(outcomes[0], {'operation': 'worker', 'success': True,
        'detectedBackend': 'cuda', 'selectedBackend': 'cuda', 'verificationSuccess': True, 'recordedStages': 7}
        ) and same(outcomes[1], {'operation': 'model-training', 'success': True, 'detectedBackend': None,
        'selectedBackend': None, 'verificationSuccess': None, 'recordedStages': 3}))
    lines = raw['probes'].splitlines()
    need(len(lines) == 12 and len(raw['probes']) <= 65536)
    rows = [decode(line) for line in lines]
    need(rows == review['finite_probe_rows'] and review['probe_ledger_sha256'] == sha(raw['probes']))
    kinds = ('input-inspection', 'environment', 'pip-version', 'worker', 'gpu-nvidia',
             'gpu-rocm', 'torch', 'backend-cuda', 'environment', 'pip-version', 'training', 'context')
    for index, (row, kind) in enumerate(zip(rows, kinds), 1):
        need(set(row) == {'probe', 'kind', 'exitCode', 'spawnErrorCode', 'stderrErrorType',
                         'missingModules', 'stdoutBytes', 'stderrBytes', 'stdoutSha256',
                         'stderrSha256', 'runtimeFacts'}
             and type(row['probe']) is int and row['probe'] == index and row['kind'] == kind
             and row['stderrErrorType'] is None and row['missingModules'] == [])
        need(row['exitCode'] is None or type(row['exitCode']) is int)
        need((row['exitCode'], row['spawnErrorCode']) ==
             ((255, None) if kind == 'gpu-nvidia' else (None, 'ENOENT') if kind == 'gpu-rocm' else (0, None)))
        for channel in ('stdout', 'stderr'):
            count, fingerprint = row[channel + 'Bytes'], row[channel + 'Sha256']
            need(type(count) is int and 0 <= count <= 4 * 1024**2
                 and re.fullmatch('[a-f0-9]{64}', fingerprint)
                 and (count != 0 or fingerprint == sha(b'')))
        if kind == 'torch':
            need(same(row['runtimeFacts'], {'validJson': True, 'installed': True, 'pinnedVersion': True,
                'hasCudaVersion': True, 'hasHipVersion': False, 'cudaAvailable': True,
                'importErrorPresent': False, 'importErrorCategory': None}))
        else:
            need(row['runtimeFacts'] is None)
    return values


def current_source(previous, current):
    need(type(previous) is dict and type(current) is dict)
    changed = {name for name in previous.keys() | current.keys()
               if previous.get(name) != current.get(name)}
    need(changed <= QUALIFICATION_ONLY)


def check(root=ROOT):
    primary, coding = roots(root)
    report = decode(raw_file(root / REPORT))
    paths = recipe(report['run_id'])
    raw = {name: raw_file((coding if role == 'coding' else primary) / relative)
           for name, (role, relative) in paths.items()}
    values = validate_facts(report, raw)
    # Validate the entire current source against each physical recorded map.
    # Exactly this small qualification-only change may differ; execution source
    # or arbitrary neighbor changes make these observations historical-only.
    helpers = str(root / 'dev-tools/helpers')
    sys.path.insert(0, helpers)
    try:
        from control_plane.candidate import snapshot
        for role, path in (('owner', coding), ('execution', primary)):
            previous = values[role + '_snapshot']['files']
            current = snapshot(path)['files']
            current_source(previous, current)
    finally:
        sys.path.remove(helpers)
    # Actual six files, not just an input-inspection assertion or directory name.
    manifest = values['manifest']
    files = manifest['files']
    need(manifest['schemaVersion'] == 'tiny-training-input-v1'
         and manifest['inputProfile'] == 'generated-tiny-qwen2-v1'
         and set(files) == {'config.json', 'generation_config.json', 'model.safetensors',
                            'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json'}
         and files == values['readiness_result_review']['input_files_unchanged'])
    model = primary / paths['manifest'][1]
    for name, expected in files.items():
        need(set(expected) == {'bytes', 'sha256'} and type(expected['bytes']) is int
             and 0 <= expected['bytes'] <= 1024**2)
        payload = raw_file(model.parent / name)
        need(len(payload) == expected['bytes'] and sha(payload) == expected['sha256'])
    return {'status': 'qualified-recorded-source-first-phases-only', 'phases': 2,
            'probes': 12, 'model_files': 6, 'native_effect_allowed': False, 'parent_pass': False}


if __name__ == '__main__':
    try:
        need(len(sys.argv) == 1)
        print(json.dumps(check()))
    except Exception:
        print(json.dumps({'status': 'evidence-unavailable', 'parent_pass': False}))
        raise SystemExit(1)
