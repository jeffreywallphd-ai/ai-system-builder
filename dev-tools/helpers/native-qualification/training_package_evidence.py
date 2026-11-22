"""Read-only offline package evidence; never builds, extracts or launches code."""
from pathlib import Path
import json
import os
import re
import stat
import sys

import training_first_phase_evidence as first
import training_package_inputs as byte_inputs

ROOT = Path(__file__).resolve().parents[3]
MAX_PACKAGE_MEMBER = 256 * byte_inputs.MIB
REPORT = 'docs/operations/headless-local-training-package-qualification.json'
QUALIFICATION_ONLY = frozenset((REPORT,
    'dev-tools/helpers/native-qualification/training_package_evidence.py',
    'dev-tools/helpers/native-qualification/tests/test_training_package_evidence.py',
    'dev-tools/helpers/control_plane/catalog.py',
    'dev-tools/helpers/tests/test_control_plane_training_package_evidence.py',
    'dev-tools/helpers/native-qualification/README.md',
    'docs/diagnostics/ai-development-control-plane.md',
    'docs/architecture/runtime-model.md',
    'docs/security/ai-development-control-plane-threat-model.md'))
SCOPE = {key: False for key in ('application_executed', 'training_executed', 'accuracy_qualified',
    'headless_qualified', 'independent_coding_installation', 'parent_pass', 'native_effect_allowed', 'automatic_retry_allowed')}
REQUIRED_PACKAGE = ('ai-system-builder.exe', 'resources/app/package.json',
    'resources/app/.vite/build/main.cjs', 'resources/app/.vite/build/main_window_preload.cjs',
    'resources/app/.vite/build/system_runtime_preload.cjs', 'resources/app/.vite/renderer/main_window/index.html',
    'resources/app/.vite/renderer/system_runtime/index.html', 'resources/worker/main.py')


def need(value):
    if not value:
        raise ValueError('Offline training package evidence is unavailable or inconsistent.')


def recipe(run):
    # Reuse the closed run validation, never a path supplied by an artifact.
    first.recipe(run)
    packet = f'{first.PACKET}/native-package-{run}'
    result = {}
    for name, leaf in (
        ('reference_plan', 'reference-plan.json'), ('plan', 'native-package-execution-plan.json'),
        ('metadata_script', 'prepare-package-bytes.py'), ('script', 'deploy-package-and-run.py'),
        ('metadata_effect', 'metadata-effect-review.json'), ('metadata', 'metadata-preparation-result.json'),
        ('metadata_review', 'metadata-result-independent-review.json'),
        ('effect', 'native-package-effect-review.json'), ('review', 'native-package-result-independent-review.json'),
        ('observation', 'native-package-operator-result.json'), ('source', 'source-manifest.json'),
        ('electron', 'electron-manifest.json'), ('trailer', 'config-trailer.bin'),
        ('owner_snapshot', 'owner-source-snapshot.json'), ('execution_snapshot', 'execution-source-snapshot.json')):
        result[name] = ('coding', packet + '/' + leaf)
    phase = f'.local-codex/native-training-host-v1/runs/{run}/training-package'
    for name, leaf in (('native', 'native-result.json'), ('stdout', 'stdout.log'), ('stderr', 'stderr.log'),
                       ('tree', 'package-tree.json'), ('package', 'package-result.json'), ('inputs', 'package-inputs.json'),
                       ('phase_source', 'source-inputs.json'), ('phase_electron', 'electron-inputs.json')):
        result[name] = ('primary', phase + '/' + leaf)
    return result


def source_selection(files):
    fixed = {'package.json', 'package-lock.json', 'dev-tools/scripts/native/build_windows_ocr.cjs',
             'dev-tools/scripts/native/build_windows_ocr.py'}
    return {name for name in files if name.startswith(('apps/desktop/', 'modules/')) or name in fixed
            or ('/' not in name and name.startswith('tsconfig') and name.endswith('.json'))}


def package_rows(files):
    need(type(files) is dict and 1 <= len(files) <= 4096)
    rows = {byte_inputs.relative_name(name): byte_inputs._row(row, MAX_PACKAGE_MEMBER)
            for name, row in files.items()}
    names = {name.lower() for name in rows}
    need(len(names) == len(rows) and sum(row['bytes'] for row in rows.values()) <= 1024 * byte_inputs.MIB)
    need(all('/'.join(name.split('/')[:i]).lower() not in names
             for name in rows for i in range(1, len(name.split('/')))))
    return rows


def validate(report, raw):
    need(type(report) is dict and set(report) == {'schema_version', 'status', 'run_id', 'source_commit',
        'owner_source_digest', 'execution_source_digest', 'artifacts', 'scope'})
    need(report['schema_version'] == 'headless-local-training-package-qualification-v1'
         and report['status'] == 'qualified-recorded-source-offline-package-only'
         and type(report['source_commit']) is str and re.fullmatch('[a-f0-9]{40}', report['source_commit'])
         and first.same(report['scope'], SCOPE))
    need(set(raw) == set(recipe(report['run_id'])) == set(report['artifacts']))
    for name, value in raw.items():
        need(type(value) is bytes and first.sha(value) == report['artifacts'][name])
    values = {name: first.decode(value) for name, value in raw.items()
              if name not in ('metadata_script', 'script', 'trailer', 'stdout', 'stderr')}
    plan, review, effect, observation = (values[name] for name in ('plan', 'review', 'effect', 'observation'))
    schemas = {'reference_plan': 'current-offline-package-reference-plan-v1',
        'plan': 'current-training-native-package-plan-v1', 'effect': 'training-native-package-effect-review-v1',
        'review': 'independent-native-package-result-review-v1', 'observation': 'current-primary-offline-training-package-v1',
        'metadata': 'current-training-package-metadata-v1', 'metadata_effect': 'training-package-metadata-effect-review-v1',
        'metadata_review': 'independent-package-metadata-result-review-v1'}
    for name, schema in schemas.items():
        record = values[name]
        need(record['schema_version'] == schema and record['run_id'] == report['run_id'])
        if name != 'metadata_effect':
            need(record['source_commit'] == report['source_commit']
                 and record['execution_source_digest'] == report['execution_source_digest'])
    for role, key in (('owner', 'owner_source_digest'), ('execution', 'execution_source_digest')):
        source = values[role + '_snapshot']
        need(source['schema_version'] == 'source-snapshot-v1' and source['head'] == report['source_commit']
             and source['source_digest'] == report[key]
             and first.sha((json.dumps(source['files'], indent=2, sort_keys=True) + '\n').encode()) == report[key])
    need(review['disposition'] == 'accepted-offline-package-and-confirmed-retirement-only'
         and type(review['native_effect_allowance']) is int and review['native_effect_allowance'] == 0
         and review['application_launch_allowed'] is False and review['training_or_accuracy_qualified'] is False
         and review['parent_pass'] is False)
    for key, name in (('effect_review_sha256', 'effect'), ('script_sha256', 'script'), ('plan_sha256', 'plan'),
        ('native_result_sha256', 'native'), ('package_result_sha256', 'package'),
        ('package_tree_sha256', 'tree'), ('operator_observation_sha256', 'observation')):
        need(review[key] == report['artifacts'][name])
    need(effect['disposition'] == 'accepted' and effect['role'] == plan['phase'] == 'training-package'
         and type(effect['native_effect_allowance']) is int and effect['native_effect_allowance'] == 1
         and effect['operator_deployment_allowed'] is True
         and effect['script_sha256'] == report['artifacts']['script'] and effect['plan_sha256'] == report['artifacts']['plan'])
    need(first.same(plan['context'], {'run_id': report['run_id'], 'phase': 'training-package',
        'input_manifest_sha256': plan['input_manifest_sha256'], 'source_manifest_sha256': report['artifacts']['source'],
        'electron_manifest_sha256': report['artifacts']['electron'], 'package_inputs_sha256': report['artifacts']['inputs'],
        'source_digest': report['execution_source_digest']})
        and type(plan['deadline_seconds']) is int and plan['deadline_seconds'] == 420
        and first.same(plan['limits'], {'process_bytes': 2 * 1024**3, 'job_bytes': 4 * 1024**3, 'process_count': 32}))
    need(type(plan['native_effect_allowance']) is int and plan['native_effect_allowance'] == 0
         and plan['operator_deployment_allowed'] is False and plan['metadata_prepared'] is True
         and all(values[name]['owner_source_digest'] == report['owner_source_digest']
                 for name in ('plan', 'reference_plan', 'review', 'metadata_review')))
    need(plan['metadata_result_sha256'] == report['artifacts']['metadata']
         and plan['metadata_result_review_sha256'] == report['artifacts']['metadata_review'])
    metadata, metadata_review, metadata_effect = (values[name] for name in ('metadata', 'metadata_review', 'metadata_effect'))
    need(metadata_review['disposition'] == 'accepted-metadata-preparation-only'
         and metadata_review['reference_plan_sha256'] == report['artifacts']['reference_plan']
         and metadata_review['metadata_result_sha256'] == report['artifacts']['metadata']
         and metadata_review['script_sha256'] == report['artifacts']['metadata_script']
         and metadata_review['effect_review_sha256'] == report['artifacts']['metadata_effect']
         and metadata_effect['disposition'] == 'accepted' and metadata_effect['metadata_preparation_allowed'] is True
         and type(metadata_effect['native_effect_allowance']) is int and metadata_effect['native_effect_allowance'] == 0
         and metadata_effect['plan_sha256'] == report['artifacts']['reference_plan']
         and metadata_effect['script_sha256'] == report['artifacts']['metadata_script'])
    need(metadata['status'] == 'prepared-review-required'
         and type(metadata['native_effects']) is int and metadata['native_effects'] == 0
         and all(metadata[key] is False for key in ('operator_deployed', 'forge_imported', 'automatic_retry_allowed', 'parent_pass'))
         and all(metadata[key] is True for key in ('original_inputs_unchanged', 'empty_candidate_cache',
                                                   'empty_packager_temp', 'package_output_absent'))
         and metadata['metadata_effect_review_sha256'] == report['artifacts']['metadata_effect']
         and type(metadata_review['native_effect_allowance']) is int and metadata_review['native_effect_allowance'] == 0
         and metadata_review['parent_pass'] is False)
    need(metadata['source_manifest_sha256'] == report['artifacts']['source'] == report['artifacts']['phase_source']
         and metadata['electron_manifest_sha256'] == report['artifacts']['electron'] == report['artifacts']['phase_electron']
         and metadata['package_inputs_sha256'] == report['artifacts']['inputs']
         and metadata['config_trailer_sha256'] == first.sha(raw['trailer']))
    inputs = values['inputs']
    need(inputs['schema_version'] == 'fixed-offline-training-package-inputs-v1' and inputs['run_id'] == report['run_id']
         and inputs['source_digest'] == report['execution_source_digest']
         and inputs['source_manifest_sha256'] == report['artifacts']['source']
         and inputs['electron_manifest_sha256'] == report['artifacts']['electron']
         and inputs['config_trailer_sha256'] == first.sha(raw['trailer']) and first.same(inputs['zip'], metadata['zip']))
    first.native_result(values['native'], raw['stdout'], raw['stderr'])
    source, electron = values['source'], values['electron']
    need(source['schema_version'] == 'training-source-copy-references-v1'
         and source['source_commit'] == report['source_commit'] and source['source_digest'] == report['execution_source_digest']
         and source['candidate_not_created'] is True)
    source_rows = byte_inputs.validated_files(source['files'], 'source')
    need(set(source_rows) == source_selection(values['execution_snapshot']['files'])
         and all(row['sha256'] == values['execution_snapshot']['files'][name] for name, row in source_rows.items())
         and type(source['file_count']) is int and source['file_count'] == len(source_rows)
         and source['total_bytes'] == sum(row['bytes'] for row in source_rows.values()))
    need(electron['schema_version'] == 'installed-electron-distribution-references-v1'
         and electron['version'] == '42.11.18' and electron['platform'] == 'win32' and electron['arch'] == 'x64'
         and electron['distribution_relative'] == 'node_modules/electron/dist')
    electron_rows = byte_inputs.validated_files(electron['files'], 'electron')
    need(electron['file_count'] == len(electron_rows) and electron['total_bytes'] == sum(row['bytes'] for row in electron_rows.values()))
    package, tree = values['package'], values['tree']
    rows = package_rows(tree['files'])
    need(tree['schema_version'] == 'actual-offline-training-package-tree-v1' and tree['parent_pass'] is False
         and tree['source_digest'] == report['execution_source_digest'] and first.same(rows, review['package_files'])
         and all(name in rows and rows[name]['bytes'] > 0 for name in REQUIRED_PACKAGE))
    need(package['schemaVersion'] == 'training-offline-package-v1' and package['status'] == 'packaged-offline'
         and package['sourceDigest'] == report['execution_source_digest']
         and package['sourceFiles'] == source['file_count'] and package['sourceBytes'] == source['total_bytes']
         and package['electronVersion'] == '42.11.18' and package['electronInputFiles'] == electron['file_count']
         and package['originalOcrHookRetained'] is True and package['accuracyExecuted'] is False
         and package['applicationExecuted'] is False and package['parentPass'] is False
         and package['optionalOcrQualification'] == tree['optional_ocr_qualification'] == 'not-asserted')
    need(type(package['packageFiles']) is int and package['packageFiles'] == tree['file_count'] == len(rows)
         and package['packageBytes'] == tree['total_bytes'] == sum(row['bytes'] for row in rows.values())
         and package['manifestSha256'] == report['artifacts']['tree']
         and package['applicationSha256'] == tree['application_sha256'] == rows['ai-system-builder.exe']['sha256']
         and package['workerMainSha256'] == tree['worker_main_sha256'] == rows['resources/worker/main.py']['sha256'])
    worker = {name.removeprefix('modules/adapters/runtime/python/worker/'): row
              for name, row in source_rows.items() if name.startswith('modules/adapters/runtime/python/worker/')}
    need(worker and package['workerSourceFiles'] == tree['worker_source_files'] == len(worker)
         and all(rows.get('resources/worker/' + name) == row for name, row in worker.items()))
    need(observation['status'] == 'packaged-review-required' and observation['native_retirement_confirmed'] is True
         and all(observation[key] is False for key in ('training_executed', 'application_executed', 'accuracy_executed',
                                                       'automatic_retry_allowed', 'parent_pass')))
    need(observation['native_effect_review_sha256'] == report['artifacts']['effect']
         and observation['native_result_sha256'] == report['artifacts']['native']
         and observation['package_result_sha256'] == report['artifacts']['package']
         and observation['package_tree_sha256'] == report['artifacts']['tree']
         and observation['package_files'] == review['package_file_count'] == package['packageFiles']
         and observation['package_bytes'] == review['package_bytes'] == package['packageBytes']
         and observation['application_sha256'] == review['application_sha256'] == package['applicationSha256']
         and observation['worker_main_sha256'] == review['worker_main_sha256'] == package['workerMainSha256'])
    return values


def current_source(previous, current):
    changed = {name for name in previous.keys() | current.keys() if previous.get(name) != current.get(name)}
    need(changed <= QUALIFICATION_ONLY)


def walk_package(root):
    byte_inputs._directory(root)
    queue, files, directories, total = [root], {}, [], 0
    while queue:
        parent = queue.pop()
        byte_inputs._directory(parent)
        with os.scandir(parent) as entries:
            for entry in entries:
                path = parent / entry.name
                name = byte_inputs.relative_name(path.relative_to(root).as_posix())
                info = path.lstat()
                need(len(name.split('/')) <= 24 and not getattr(info, 'st_file_attributes', 0) & 0x400)
                if stat.S_ISDIR(info.st_mode):
                    need(len(directories) < 1024)
                    directories.append(name); queue.append(path)
                else:
                    total += info.st_size
                    need(len(files) < 4096 and total <= 1024 * byte_inputs.MIB)
                    files[name] = byte_inputs._stream_reference(path, None, MAX_PACKAGE_MEMBER)
    package_rows(files)
    return files, sorted(directories)


def packaged_identity(root, rows):
    need(rows['ai-system-builder.exe']['bytes'] >= byte_inputs.MIB)
    with (root / 'ai-system-builder.exe').open('rb') as source:
        need(source.read(2) == b'MZ')
    package = first.decode(first.raw_file(root / 'resources/app/package.json', 65536))
    need(package['name'] == 'ai-system-builder' and package['version'] == '0.1.0'
         and package['main'] == '.vite/build/main.cjs')


def check(root=ROOT):
    primary, coding = first.roots(root)
    report = first.decode(first.raw_file(root / REPORT))
    raw = {name: first.raw_file((coding if role == 'coding' else primary) / path,
            8 * byte_inputs.MIB if name in ('stdout', 'stderr') else byte_inputs.MIB)
           for name, (role, path) in recipe(report['run_id']).items()}
    values = validate(report, raw)
    sys.path.insert(0, str(root / 'dev-tools/helpers'))
    try:
        from control_plane.candidate import snapshot
        for role, path in (('owner', coding), ('execution', primary)):
            current_source(values[role + '_snapshot']['files'], snapshot(path)['files'])
    finally:
        sys.path.pop(0)
    # Consume historical first-phase facts, not its intentionally stale current-
    # source check. Preserve its exact nine exclusions and original source HEAD.
    earlier = first.decode(first.raw_file(root / first.REPORT))
    payloads = {name: first.raw_file((coding if role == 'coding' else primary) / path)
                for name, (role, path) in first.recipe(report['run_id']).items()}
    earlier_values = first.validate_facts(earlier, payloads)
    need(first.sha(payloads['manifest']) == values['plan']['input_manifest_sha256'])
    model_manifest = primary / first.recipe(report['run_id'])['manifest'][1]
    for name, expected in earlier_values['manifest']['files'].items():
        byte_inputs._stream_reference(model_manifest.parent / name, expected, byte_inputs.MIB)
    short = primary / '.local-codex/q' / report['run_id'][:8]
    package_root = short / 'o/ai-system-builder-win32-x64'
    actual_files, actual_directories = walk_package(package_root)
    need(first.same(actual_files, values['tree']['files']) and actual_directories == values['tree']['directories'])
    packaged_identity(package_root, actual_files)
    for name, expected in values['source']['files'].items():
        byte_inputs._stream_reference(primary / name, expected, byte_inputs.MAX_SOURCE_FILE)
        if name == 'apps/desktop/forge.config.js':
            original = first.raw_file(primary / name, 65536) + raw['trailer']
            expected = {'bytes': len(original), 'sha256': first.sha(original)}
        byte_inputs._stream_reference(short / 'c' / name, expected, byte_inputs.MAX_SOURCE_FILE)
    for name, expected in values['electron']['files'].items():
        byte_inputs._stream_reference(primary / 'node_modules/electron/dist' / name, expected, byte_inputs.MAX_ELECTRON_FILE)
    need(byte_inputs.verify_electron_zip(short / 'z/electron-v42.11.18-win32-x64.zip', values['electron']['files']) == values['inputs']['zip'])
    for name in ('offline-package.mjs', 'playwright.config.mjs', 'global-setup.mjs', 'package-tree.mjs'):
        path = primary / '.local-codex/native-training-host-operator/v2' / report['run_id'] / 'training-package' / name
        need(first.sha(first.raw_file(path)) == values['plan']['reviewed_file_hashes'][name])
    return {'status': report['status'], 'package_files': len(actual_files),
            'worker_files': values['package']['workerSourceFiles'], 'native_effect_allowed': False, 'parent_pass': False}


if __name__ == '__main__':
    try:
        need(len(sys.argv) == 1)
        print(json.dumps(check()))
    except Exception:
        print(json.dumps({'status': 'package-evidence-unavailable', 'parent_pass': False}))
        raise SystemExit(1)
