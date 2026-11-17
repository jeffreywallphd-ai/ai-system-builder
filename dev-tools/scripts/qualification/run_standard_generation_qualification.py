"""Prospective Standard-only comparison over the current guarded inference runtime.

No downloads, native staging inspection, offload admission or historical pass transfer.
Plan first; review its exact source/operator/algorithm identities before --execute.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys
import time
import types
import uuid

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[3]
sys.path.insert(0, str(SCRIPT.parent)); sys.path.insert(0, str(ROOT))
import run_standalone_model_tests as diagnostics
import run_installed_generation_qualification as original
import run_trained_context_qualification as owned
from model_qualification_lock import QualificationBusy, slot

OUTPUT = '.local-codex/standard-generation-qualification'
ALGORITHMS = {name: original.BASELINE_FILES[name] for name in ('constrained_json_decoder.py', 'example_generation.py')}
DEVICES, MODES, VARIANTS = ('cuda', 'cpu'), ('unchecked', 'constrained'), ('baseline', 'candidate')
RSS_LIMIT = 4 * 1024**3


def host_limits(profile, host_profile):
    if host_profile == 'legacy-reference-v1': return {}
    if host_profile != 'windows-lightweight-v1' or profile not in original.MODEL_PROFILES:
        raise ValueError('Unsupported host profile.')
    larger = profile == 'qwen15-bfloat16'
    return {'devices': ['cpu', 'cuda'], 'deadline_seconds_by_device': {'cpu':2400 if larger else 1200, 'cuda':1200},
        'cooperative_stop_seconds_by_device': {'cpu':2160 if larger else 1080, 'cuda':1080},
        'primary_delivery_budget_seconds': {'cpu':1800 if larger else 600, 'cuda':300},
        'reserved_vram_budget_bytes': {'cpu':0, 'cuda':6 * 1024**3},
        'intended_use': 'reviewed-proposals-only' if not larger else 'measured-task-proposals',
        'automatic_label_quality_floor': 23,
        'scope': 'Prospective absolute host budgets; original1.20 comparison and23of24 automation gates remain separate and unchanged.'}


def checked_host_limits(plan):
    limits = host_limits(plan['model_profile'], plan.get('host_profile', 'legacy-reference-v1'))
    if limits:
        for key, expected in [('host_limits', limits), ('cooperative_stop_seconds_by_device', limits['cooperative_stop_seconds_by_device'])]:
            if json.dumps(plan.get(key), sort_keys=True, allow_nan=False) != json.dumps(expected, sort_keys=True):
                raise ValueError('Host limits changed.')
    elif 'host_limits' in plan or 'cooperative_stop_seconds_by_device' in plan:
        raise ValueError('Legacy host limits cannot be overridden.')
    return limits


def identity():
    return {**diagnostics.bindings(), 'standard_operator_sha256': owned.sha256_file(SCRIPT),
            'qualification_lock_sha256': owned.sha256_file(SCRIPT.with_name('model_qualification_lock.py')),
            'current_runtime_sha256': owned.sha256_file(ROOT / 'modules/adapters/runtime/python/worker/tasks/local_text_generation.py'),
            'baseline_commit': original.BASELINE, 'baseline_algorithms': ALGORITHMS}


def run_folder(run_id):
    if not re.fullmatch(r'[a-f0-9]{32}', run_id):
        raise ValueError('Invalid Standard experiment identity.')
    return diagnostics.safe_directory(ROOT / OUTPUT / run_id)


def prepare_baseline(folder):
    diagnostics.safe_directory(folder)
    base = folder / 'baseline'; base.mkdir(exist_ok=False)
    for name, digest in ALGORITHMS.items():
        content = subprocess.check_output(['git', 'show', f'{original.BASELINE}:modules/adapters/runtime/python/worker/tasks/{name}'], cwd=ROOT, timeout=10)
        if len(content) > 2 * 1024**2 or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError('Historical algorithm integrity failed.')
        with (base / name).open('xb') as output: output.write(content)


def verify_baseline(folder):
    for name, digest in ALGORITHMS.items():
        file = original.checked_path((folder / 'baseline' / name).relative_to(ROOT).as_posix())
        if file.stat().st_size > 2 * 1024**2 or owned.sha256_file(file) != digest:
            raise ValueError('Historical algorithm substitution refused.')


def selected_production(variant, folder):
    generation, runtime, *rest = diagnostics.production()
    package_name = 'modules.adapters.runtime.python.worker.tasks'
    package = sys.modules[package_name]
    if variant not in VARIANTS or Path(runtime.__file__).resolve() != ROOT / 'modules/adapters/runtime/python/worker/tasks/local_text_generation.py':
        raise ValueError('Current shared runtime required.')
    if variant == 'baseline':
        for name, digest in ALGORITHMS.items():
            file = original.checked_path((folder / 'baseline' / name).relative_to(ROOT).as_posix())
            if file.stat().st_size > 2 * 1024**2 or owned.sha256_file(file) != digest:
                raise ValueError('Historical algorithm substitution refused.')
            module_name = package_name + '.' + name.removesuffix('.py')
            spec = importlib.util.spec_from_file_location(module_name, file)
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module; setattr(package, name.removesuffix('.py'), module)
            spec.loader.exec_module(module)
            if name == 'constrained_json_decoder.py':
                runtime.ConstrainedJsonDecoder = module.ConstrainedJsonDecoder
                runtime.ConstrainedJsonDecoderError = module.ConstrainedJsonDecoderError
        generation = sys.modules[package_name + '.example_generation']
    decoder = sys.modules[package_name + '.constrained_json_decoder']
    if (generation is not package.example_generation or decoder is not package.constrained_json_decoder
            or generation.get_or_create_local_text_generator is not runtime.get_or_create_local_text_generator
            or generation._GENERATOR_CACHE is not runtime._GENERATOR_CACHE
            or generation._RESOLVED_MODEL_REFERENCES is not runtime._RESOLVED_MODEL_REFERENCES
            or runtime.ConstrainedJsonDecoder is not decoder.ConstrainedJsonDecoder
            or runtime.ConstrainedJsonDecoderError is not decoder.ConstrainedJsonDecoderError
            or generation.ConstrainedJsonDecoderError is not decoder.ConstrainedJsonDecoderError):
        raise ValueError('Mixed algorithm/runtime bindings refused.')
    return generation, runtime, *rest


def inspect_algorithms(folder, variant):
    generation, runtime, *_ = selected_production(variant, folder)
    corpus = original.heldout_plan()
    schema = generation.build_task_structured_output_schema(corpus['task_type'], {'labelSet': corpus['labels']})
    return {'variant': variant, 'schema_sha256': hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest(),
            'current_runtime_sha256': owned.sha256_file(Path(runtime.__file__)),
            'algorithms': {name: owned.sha256_file(Path(sys.modules['modules.adapters.runtime.python.worker.tasks.' + name.removesuffix('.py')].__file__)) for name in ALGORITHMS},
            'empty_generator_cache': not runtime._GENERATOR_CACHE}


def plan_experiment(profile, host_profile='legacy-reference-v1', remaining_selection=None):
    manifest = diagnostics.find_manifest(profile)
    corpus = original.heldout_plan()
    folder = diagnostics.safe_directory(ROOT / OUTPUT, create=True) / uuid.uuid4().hex
    folder.mkdir(exist_ok=False); prepare_baseline(folder)
    source = identity()
    schemas = {}
    for variant in VARIANTS:
        observed = subprocess.run([sys.executable, '-s', '-B', str(SCRIPT), '--inspect', folder.name, '--variant', variant],
            cwd=ROOT, capture_output=True, text=True, timeout=60)
        if observed.returncode or len(observed.stdout) > 65536:
            raise ValueError('Model-free algorithm inspection failed.')
        schemas[variant] = json.loads(observed.stdout)
        if (schemas[variant]['current_runtime_sha256'] != source['current_runtime_sha256']
                or schemas[variant]['empty_generator_cache'] is not True):
            raise ValueError('Nonmatching common runtime inspection.')
    plan = {'schema_version': 'standard-generation-protocol-v1', 'created_at': diagnostics.now(), 'bindings': source,
            'model_profile': profile, 'model': original.MODEL, 'revision': original.REVISION, 'precision': original.MODEL_PRECISION,
            'manifest': manifest, 'memory_mode': 'standard', 'overflow_policy': 'none', 'diagnostic_case_limit': 24,
            'devices': list(DEVICES), 'modes': list(MODES), 'repeats': 3, 'schemas': schemas,
            'sampling': corpus['effective_sampling'], 'corpus_sha256': diagnostics.CORPUS_SHA256,
            'rss_ceiling_bytes': RSS_LIMIT, 'deadline_seconds': 1200, 'cooperative_stop_seconds': 1080,
            'absolute_quality_floor': .95, 'maximum_lost_correct_cases': 0, 'median_delivery_ratio_target': 1.20,
            'primary_timing': 'Model load through all first24/warm24 requests, attempts, repairs, evidence and one unload; common imports, input verification, algorithm selection and CUDA runtime initialization excluded identically. Launcher-to-confirmed-native-exit timing is separate.',
            'scope': 'Exposed fixed synthetic classification regression; no prompt tuning, unseen population claim, historical release/runtime pass, offload or whole-host qualification.'}
    limits = host_limits(profile, host_profile)
    if limits:
        plan.update(schema_version='standard-generation-protocol-v2', host_profile=host_profile, host_limits=limits, devices=limits['devices'],
                    deadline_seconds=max(limits['deadline_seconds_by_device'].values()),
                    cooperative_stop_seconds=max(limits['cooperative_stop_seconds_by_device'].values()),
                    cooperative_stop_seconds_by_device=limits['cooperative_stop_seconds_by_device'])
    if remaining_selection is not None:
        from run_model_blocker_tests import remaining_selection as checked_selection
        if remaining_selection != checked_selection(remaining_selection['reference_bundle'],profile):
            raise ValueError('Remaining evidence selection changed.')
        plan['remaining_selection'] = remaining_selection
        plan['scope'] = 'Unresolved current candidates only; historical passes/baselines stay references, not current qualification. Original regression population, sampling and budgets retained.'
    if identity() != source: raise ValueError('Source changed during planning.')
    diagnostics.save(folder, 'plan.json', plan)
    diagnostics.save(folder, 'report.json', {'schema_version': 'standard-generation-report-v1', 'status': 'planned-not-executed', 'qualification_complete': False})
    result = {'run_id': folder.name, 'plan_sha256': owned.sha256_file(folder / 'plan.json'), 'bindings': source}
    print(json.dumps(result))
    return result


def load_plan(folder):
    file = original.checked_path((folder / 'plan.json').relative_to(ROOT).as_posix())
    if file.stat().st_size > 65536: raise ValueError('Oversized protocol.')
    plan = json.loads(file.read_text(encoding='utf-8'))
    verify_baseline(folder)
    limits = checked_host_limits(plan)
    if (plan['schema_version'] != ('standard-generation-protocol-v2' if limits else 'standard-generation-protocol-v1') or plan['bindings'] != identity()
            or plan['devices'] != (limits['devices'] if limits else list(DEVICES)) or plan['modes'] != list(MODES) or type(plan['repeats']) is not int or plan['repeats'] != 3
            or plan['absolute_quality_floor'] != .95 or plan['maximum_lost_correct_cases'] != 0 or plan['median_delivery_ratio_target'] != 1.20
            or plan['rss_ceiling_bytes'] != RSS_LIMIT or plan['deadline_seconds'] != (max(limits['deadline_seconds_by_device'].values()) if limits else 1200) or plan['diagnostic_case_limit'] != 24
            or plan['cooperative_stop_seconds'] != (max(limits['cooperative_stop_seconds_by_device'].values()) if limits else 1080)
            or plan['memory_mode'] != 'standard' or plan['overflow_policy'] != 'none' or plan['corpus_sha256'] != diagnostics.CORPUS_SHA256):
        raise ValueError('Protocol/source substitution refused.')
    original.configure_model_profile(plan['model_profile'])
    if (plan['model'], plan['revision'], plan['precision']) != (original.MODEL, original.REVISION, original.MODEL_PRECISION):
        raise ValueError('Cross-model profile refused.')
    if plan['sampling'] != original.heldout_plan()['effective_sampling']: raise ValueError('Sampling changed.')
    if 'remaining_selection' in plan:
        from run_model_blocker_tests import remaining_selection
        if plan['remaining_selection'] != remaining_selection(plan['remaining_selection']['reference_bundle'],plan['model_profile']):
            raise ValueError('Remaining evidence selection changed.')
    return plan


def read_measurements(folder, rows):
    result = []
    for row in rows:
        if row.get('device') not in DEVICES or row.get('mode') not in MODES or row.get('variant') not in VARIANTS or type(row.get('replicate')) is not int or row['replicate'] not in (1, 2, 3):
            raise ValueError('Invalid measurement identity.')
        hydrated = dict(row)
        if row.get('measurement_sha256'):
            expected = f"{row['device']}-{row['mode']}-{row['replicate']}-{row['variant']}"
            if row.get('directory') != expected: raise ValueError('Foreign measurement reference.')
            file = original.checked_path((folder / expected / 'cohort.json').relative_to(ROOT).as_posix())
            if file.stat().st_size > 2 * 1024**2 or owned.sha256_file(file) != row['measurement_sha256']:
                raise ValueError('Changed measurement bytes.')
            hydrated['measurement'] = json.loads(file.read_text(encoding='utf-8'))
            if hydrated['measurement'].get('plan_sha256') != owned.sha256_file(folder / 'plan.json'):
                raise ValueError('Cross-protocol measurement refused.')
        result.append(hydrated)
    return result


def finite(value, *, positive=False):
    return type(value) in (int, float) and math.isfinite(value) and (value > 0 if positive else value >= 0)


def replay_measurement(value, plan, variant, device, replicate, mode):
    if (value.get('status') != 'measured' or value.get('bindings') != plan['bindings']
            or value.get('model') != plan['model'] or value.get('revision') != plan['revision']
            or value.get('model_profile') != plan['model_profile'] or value.get('precision') != plan['precision']
            or value.get('actual_precision') != 'torch.' + plan['precision']
            or value.get('device') != device or value.get('mode') != mode or value.get('replicate') != replicate
            or value.get('variant') != variant or value.get('memory_mode') != 'standard'
            or value.get('schema_sha256') != plan['schemas'][variant]['schema_sha256']
            or value.get('effective_sampling') != plan['sampling'] or value.get('diagnostic_overflow', False)
            or value.get('runtime_vram_floor_observed') is not True
            or any(value.get(key) is not True for key in ('cleanup_passed', 'generator_cache_empty', 'retained_leases_empty', 'placement_observed'))
            or value.get('actual_tensor_devices') != ['cuda:0' if device == 'cuda' else 'cpu']
            or type(value.get('tensor_placement_mismatch_count')) is not int or value['tensor_placement_mismatch_count'] != 0):
        raise ValueError('Incomplete model/placement/cleanup evidence.')
    vram_fields = ('runtime_allocated_vram_floor_bytes', 'runtime_reserved_vram_floor_bytes',
                   'remaining_allocated_vram_bytes', 'remaining_reserved_vram_bytes', 'peak_allocated_vram_bytes', 'peak_reserved_vram_bytes')
    for key in vram_fields:
        if type(value.get(key)) is not int or value[key] < 0: raise ValueError('Invalid VRAM observation.')
    if device == 'cpu' and any(value[key] != 0 for key in vram_fields): raise ValueError('Unexpected accelerator use in CPU profile.')
    if (value['remaining_allocated_vram_bytes'] > value['runtime_allocated_vram_floor_bytes']
            or value['remaining_reserved_vram_bytes'] > value['runtime_reserved_vram_floor_bytes']
            or value['remaining_allocated_vram_bytes'] > value['remaining_reserved_vram_bytes']
            or value['runtime_allocated_vram_floor_bytes'] > value['runtime_reserved_vram_floor_bytes']):
        raise ValueError('VRAM cleanup drift.')
    if (value['peak_allocated_vram_bytes'] > value['peak_reserved_vram_bytes']
            or value['peak_allocated_vram_bytes'] < max(value['runtime_allocated_vram_floor_bytes'], value['remaining_allocated_vram_bytes'])
            or value['peak_reserved_vram_bytes'] < max(value['runtime_reserved_vram_floor_bytes'], value['remaining_reserved_vram_bytes'])):
        raise ValueError('VRAM peak observation inconsistent.')
    elapsed = value.get('model_delivery_seconds')
    deadline = checked_host_limits(plan).get('deadline_seconds_by_device', {}).get(device, 1200)
    if not finite(elapsed, positive=True) or elapsed > deadline: raise ValueError('Invalid delivery duration.')
    expected = original.heldout_plan()['heldout']; phases = {}; correct_total = 0; phase_seconds = 0
    for phase in ('first', 'warm'):
        cases = value.get('phases', {}).get(phase, {}).get('cases', [])
        if not isinstance(cases, list) or any(not isinstance(row, dict) for row in cases) or [row.get('id') for row in cases] != [row['id'] for row in expected]:
            raise ValueError('Fixed case membership incomplete.')
        flags = []; invalid_accepted_count = 0
        for row, oracle in zip(cases, expected):
            accepted, label = row.get('accepted'), row.get('predicted_label')
            invalid = row.get('invalid_accepted', False)
            if (type(invalid) is not bool or type(accepted) is not bool
                    or (row.get('status') == 'invalid-accepted') != invalid
                    or invalid and (not accepted or label is not None or row.get('status') != 'invalid-accepted')
                    or not invalid and ((accepted and label not in original.heldout_plan()['labels']) or (not accepted and label is not None))):
                raise ValueError('Invalid accepted output.')
            invalid_accepted_count += invalid
            correct = accepted and not invalid and label == oracle['label']
            if type(row.get('correct')) is not bool or row['correct'] != correct: raise ValueError('Claimed semantic correctness differs.')
            for key in ('attempts', 'invalid_attempts', 'operational_errors', 'repairs'):
                if type(row.get(key)) is not int or not 0 <= row[key] <= (1 if key == 'repairs' else 2): raise ValueError('Invalid attempt counts.')
            if row['attempts'] < 1 or row['operational_errors'] != 0 or row['invalid_attempts'] > row['attempts'] or not finite(row.get('seconds')):
                raise ValueError('Operational or measurement failure.')
            if accepted and row['invalid_attempts'] >= row['attempts']:
                raise ValueError('Accepted output has no successful invocation.')
            if row['repairs'] > row['attempts'] - 1: raise ValueError('Unmatched repair count.')
            flags.append(correct)
        reported_phase = value['phases'][phase]
        duration = reported_phase.get('seconds')
        if not finite(duration, positive=True) or duration + 1e-6 < sum(row['seconds'] for row in cases) or type(reported_phase.get('correct')) is not int or reported_phase['correct'] != sum(flags):
            raise ValueError('Phase aggregate or timing differs.')
        for key, count in original.phase_counts(cases).items():
            if reported_phase.get(key) != count: raise ValueError('Attempt aggregate differs.')
        if reported_phase.get('invalid_accepted', 0) != invalid_accepted_count or type(reported_phase.get('invalid_accepted', 0)) is not int:
            raise ValueError('Invalid acceptance aggregate differs.')
        phases[phase] = {'correct': sum(flags), 'flags': flags, 'invalid_accepted': invalid_accepted_count, **original.phase_counts(cases)}
        phase_seconds += duration
        correct_total += sum(flags)
    load, cleanup, whole = (value.get(key) for key in ('load_seconds', 'cleanup_seconds', 'whole_delivery_seconds'))
    if not all(finite(v) for v in (load, cleanup, whole)) or elapsed + 1e-6 < load + cleanup + phase_seconds or whole + 1e-6 < elapsed:
        raise ValueError('Delivery boundary inconsistent.')
    return {'phases': phases, 'correct_accepted_per_minute': 60 * correct_total / elapsed, 'model_delivery_seconds': elapsed}


def assess_pairs(rows, plan, device, mode):
    result = {'device': device, 'mode': mode, 'status': 'pending', 'measurement_complete': False, 'quality_passed': False, 'throughput_target_met': False, 'pairs': []}
    if len(rows) != 6 or any(type(r.get('replicate')) is not int for r in rows) or {(r.get('replicate'), r.get('variant')) for r in rows} != {(n, v) for n in (1, 2, 3) for v in VARIANTS}:
        return result
    quality = True; ratios = []
    try:
        for replicate in (1, 2, 3):
            pair = {}
            for variant in VARIANTS:
                row = next(r for r in rows if r['replicate'] == replicate and r['variant'] == variant)
                observation = row['observation']
                if (type(observation.get('physical_exit_code')) is not int or observation['physical_exit_code'] != 0
                        or type(observation.get('peak_rss_bytes')) is not int or not 0 < observation['peak_rss_bytes'] <= RSS_LIMIT
                        or row.get('source_stable') is not True):
                    raise ValueError('Native/resource/source evidence failed.')
                pair[variant] = replay_measurement(row['measurement'], plan, variant, device, replicate, mode)
                if not finite(row.get('launcher_delivery_seconds'), positive=True) or row['launcher_delivery_seconds'] + 1e-6 < row['measurement']['whole_delivery_seconds']:
                    raise ValueError('Launcher boundary inconsistent.')
            phases = []
            for phase in ('first', 'warm'):
                before, after = pair['baseline']['phases'][phase], pair['candidate']['phases'][phase]
                lost = sum(a and not b for a, b in zip(before['flags'], after['flags']))
                quality = quality and after['correct'] >= 23 and lost == 0 and after['invalid_accepted'] == 0
                phases.append({'phase': phase, 'baseline_correct': before['correct'], 'candidate_correct': after['correct'], 'lost_correct': lost,
                    'baseline_invalid_rate': before['invalid_output_rate'], 'candidate_invalid_rate': after['invalid_output_rate'],
                    'baseline_repairs': before['repairs'], 'candidate_repairs': after['repairs'],
                    'candidate_nominal_95_count_interval': original.exact_binomial_interval(after['correct'], 24)})
            baseline_rate = pair['baseline']['correct_accepted_per_minute']
            ratio = pair['candidate']['correct_accepted_per_minute'] / baseline_rate if baseline_rate > 0 else None
            ratios.append(ratio); result['pairs'].append({'replicate': replicate, 'phases': phases, 'delivery_ratio': ratio})
        median = statistics.median(ratios) if all(r is not None for r in ratios) else None
        result.update(measurement_complete=True, quality_passed=bool(quality), median_delivery_ratio=median,
                      throughput_target_met=median is not None and median >= 1.20, status='measured-quality-passed' if quality else 'failed-quality')
    except (ValueError, KeyError, TypeError, StopIteration):
        result.update(status='incomplete-or-failed-evidence')
    return result


def child(args):
    # Native observation is attached before any directory, admission or input
    # check can fail. A refusal must remain an observed worker exit.
    print(json.dumps({'kind': 'ready', 'pid': os.getpid(), 'parent_pid': os.getppid(), 'rss_bytes': owned.rss(os.getpid())}), flush=True)
    if sys.stdin.readline().strip() != 'run': raise ValueError('Invalid owned acknowledgement.')
    with slot('worker'):
        child_with_slot(args)


def child_with_slot(args):
    folder = run_folder(os.environ.get('AISB_STANDARD_RUN_ID', ''))
    if args.device not in DEVICES or args.profile not in MODES or args.variant not in VARIANTS or type(args.count) is not int or args.count not in (1, 2, 3) or args.phase != 'timing' or args.samples != '8' or args.run_id != f'{args.device}-{args.profile}-{args.count}-{args.variant}':
        raise ValueError('Foreign cohort refused.')
    if owned.sha256_file(folder / 'plan.json') != os.environ.get('AISB_STANDARD_PLAN_SHA256'): raise ValueError('Plan changed.')
    plan = load_plan(folder)
    if 'remaining_selection' in plan and args.run_id not in plan['remaining_selection']['selected_cohorts']:
        raise ValueError('Cohort is excluded by the reviewed remaining-only plan.')
    if args.model_manifest != plan['manifest']: raise ValueError('Manifest changed.')
    cohort = diagnostics.safe_directory(folder / args.run_id)
    factory = diagnostics.production
    def selected():
        diagnostics.production = factory
        try: return selected_production(args.variant, folder)
        finally: diagnostics.production = selected
    diagnostics.production = selected
    try: diagnostics.measure(args, cohort, plan)
    finally: diagnostics.production = factory
    value = json.loads((cohort / 'cohort.json').read_text(encoding='utf-8'))
    value.update(schema_version='standard-generation-cohort-v1', variant=args.variant, plan_sha256=os.environ['AISB_STANDARD_PLAN_SHA256'])
    diagnostics.save(cohort, 'cohort.json', value)
    verify_baseline(folder)
    if identity() != plan['bindings'] or owned.sha256_file(folder / 'plan.json') != value['plan_sha256']:
        raise ValueError('Source/protocol changed during cohort.')
    print(json.dumps({'kind': 'result', 'report': 'cohort.json'}), flush=True)


def execute(folder, approved_plan_sha256):
    if os.name != 'nt': raise ValueError('Named Windows execution required; other hosts remain pending.')
    plan = load_plan(folder)
    if not re.fullmatch(r'[a-f0-9]{64}', approved_plan_sha256 or '') or owned.sha256_file(folder / 'plan.json') != approved_plan_sha256:
        raise ValueError('Exact reviewed plan digest required.')
    if json.loads((folder / 'report.json').read_text())['status'] != 'planned-not-executed': raise ValueError('Experiment already attempted; preserve it.')
    # Exclusive intent survives a crash before the first progress publication.
    with (folder / 'execution.json').open('x', encoding='utf-8') as intent:
        json.dump({'started_at': diagnostics.now(), 'reviewed_plan_sha256': approved_plan_sha256}, intent)
        intent.flush(); os.fsync(intent.fileno())
    report = {'schema_version': 'standard-generation-report-v1', 'started_at': diagnostics.now(), 'status': 'running',
              'qualification_complete': False, 'plan_sha256': owned.sha256_file(folder / 'plan.json'), 'bindings': plan['bindings'], 'measurements': [], 'comparisons': []}
    owned.SCRIPT = SCRIPT
    original_finish, original_rss = owned.finish_owned_child, owned.rss
    row = None
    def redacted_finish(process, readers, native_thread, native_result, stderr, output, error):
        if row is not None: row['suppressed_stderr_characters'] = sum(len(line) for line in stderr)
        return original_finish(process, readers, native_thread, native_result, [], output, error)
    owned.finish_owned_child = redacted_finish
    try:
        for device in plan.get('devices', DEVICES):
          for mode in MODES:
            for replicate in (1, 2, 3):
              for variant in (VARIANTS if replicate % 2 else VARIANTS[::-1]):
                verify_baseline(folder)
                if identity() != plan['bindings'] or owned.sha256_file(folder / 'plan.json') != approved_plan_sha256:
                    raise ValueError('Source/protocol changed; stop scheduling.')
                name = f'{device}-{mode}-{replicate}-{variant}'
                if 'remaining_selection' in plan and name not in plan['remaining_selection']['selected_cohorts']:
                    continue
                cohort = folder / name; cohort.mkdir(exist_ok=False)
                row = {'device': device, 'mode': mode, 'replicate': replicate, 'variant': variant, 'directory': name, 'status': 'running'}
                report['measurements'].append(row); diagnostics.save(folder, 'report.json', report)
                print(json.dumps({'run': folder.name, 'cohort': name, 'status': 'starting'}), flush=True)
                os.environ['AISB_STANDARD_RUN_ID'] = folder.name; os.environ['AISB_STANDARD_PLAN_SHA256'] = report['plan_sha256']
                last_progress = time.monotonic()
                def sampled(pid):
                    nonlocal last_progress
                    value = original_rss(pid)
                    if time.monotonic() - last_progress >= 30:
                        last_progress = time.monotonic()
                        try:
                            progress = json.loads((cohort / 'cohort.json').read_text())
                            print(json.dumps({'cohort': name, 'recorded_cases': sum(len(p.get('cases', [])) for p in progress.get('phases', {}).values()), 'rss_bytes': value}), flush=True)
                        except (OSError, ValueError, TypeError, AttributeError): pass
                    return value
                owned.rss = sampled
                began = time.perf_counter()
                try:
                    row['observation'] = owned.run_child(types.SimpleNamespace(samples=8, model_manifest=plan['manifest']), cohort, replicate,
                        'measure', variant, device, 'timing', mode,
                        execution_seconds=plan.get('host_limits', {}).get('deadline_seconds_by_device', {}).get(device, 1200))
                    file = original.checked_path((cohort / 'cohort.json').relative_to(ROOT).as_posix())
                    if file.stat().st_size > 2 * 1024**2: raise ValueError('Oversized measurement.')
                    measured = json.loads(file.read_text())
                    if measured.get('plan_sha256') != report['plan_sha256']: raise ValueError('Unbound cohort.')
                    row['measurement_sha256'] = owned.sha256_file(file); row['status'] = measured['status']
                    row['progress'] = diagnostics.phase_progress(measured.get('phases', {}))
                except BaseException as error:
                    row.update(status='interrupted' if isinstance(error, KeyboardInterrupt) else 'failed-supervision', error_type=diagnostics.failure(error))
                    if getattr(error, 'owned_child_failure', None): row['lifecycle'] = error.owned_child_failure
                    if not isinstance(error, Exception) or isinstance(error, owned.UnconfirmedChildExit): raise
                finally:
                    owned.rss = original_rss
                    row['launcher_delivery_seconds'] = time.perf_counter() - began
                    row['source_stable'] = identity() == plan['bindings'] and owned.sha256_file(folder / 'plan.json') == approved_plan_sha256
                    diagnostics.save(folder, 'report.json', report)
                if not row['source_stable']: raise ValueError('Source changed; stop scheduling.')
                # A confirmed process exit alone does not establish model cleanup.
                # Stop this matrix as well as any later profile when evidence is unknown.
                if (row.get('observation', {}).get('physical_exit_code') != 0 or row.get('status') == 'failed-supervision'
                        or any(measured.get(key) is not True for key in ('cleanup_passed','generator_cache_empty','retained_leases_empty'))):
                    raise ValueError('Model cleanup/native completion unconfirmed; stop scheduling.')
                print(json.dumps({'cohort': name, 'status': row['status']}), flush=True)
            matching = [row for row in report['measurements'] if row['device'] == device and row['mode'] == mode]
            report['comparisons'].append(assess_pairs(read_measurements(folder, matching), plan, device, mode)); diagnostics.save(folder, 'report.json', report)
        original.verified_model(plan['manifest'])
        verify_baseline(folder)
        report['source_stable'] = identity() == plan['bindings'] and owned.sha256_file(folder / 'plan.json') == approved_plan_sha256
        report['qualification_complete'] = report['source_stable'] and len(report['comparisons']) == 4 and all(c['measurement_complete'] and c['quality_passed'] for c in report['comparisons']) and any(c['throughput_target_met'] for c in report['comparisons'])
        report['status'] = 'qualified-fixed-task-profile' if report['qualification_complete'] else 'not-qualified-see-cohorts'
    except BaseException as error:
        report.update(status='aborted', error_type=diagnostics.failure(error), qualification_complete=False)
        if isinstance(error, owned.UnconfirmedChildExit):
            report.update(status='aborted-unconfirmed-native-exit', cleanup_pending=error.evidence)
    finally:
        owned.finish_owned_child, owned.rss = original_finish, original_rss
        report['finished_at'] = diagnostics.now(); diagnostics.save(folder, 'report.json', report)
        diagnostics.save(folder, 'evidence-index.json', {'schema_version': 'standard-generation-evidence-v1',
            'files': {p.relative_to(folder).as_posix(): owned.sha256_file(p) for p in folder.rglob('*.json') if p.name != 'evidence-index.json'}})
    print(json.dumps({'run_id': folder.name, 'status': report['status'], 'qualification_complete': report['qualification_complete']}), flush=True)
    return 0 if report['qualification_complete'] else 2 if report['status'] == 'aborted-unconfirmed-native-exit' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-profile', choices=original.MODEL_PROFILES)
    parser.add_argument('--host-profile', choices=('legacy-reference-v1','windows-lightweight-v1'), default='legacy-reference-v1')
    parser.add_argument('--execute'); parser.add_argument('--inspect')
    parser.add_argument('--plan-sha256')
    parser.add_argument('--child', choices=('measure',))
    for name in ('run-id', 'variant', 'device', 'phase', 'profile', 'samples', 'model-manifest'): parser.add_argument('--' + name)
    parser.add_argument('--count', type=int)
    args = parser.parse_args()
    if args.child: child(args); return 0
    if args.inspect:
        print(json.dumps(inspect_algorithms(run_folder(args.inspect), args.variant))); return 0
    if args.execute:
        try:
            # The bundle calls execute() under its own coordinator. This branch
            # owns admission only for the independently supported Standard CLI.
            with slot('coordinator'):
                with slot('worker'):
                    pass
                return execute(run_folder(args.execute), args.plan_sha256)
        except QualificationBusy:
            print(json.dumps({'status': 'operator-refused', 'reason_code': 'model-test-busy',
                              'next_step': 'Retry after the other model test exits. Do not delete lock files.'}), flush=True)
            return 1
    if not args.model_profile: parser.error('--model-profile is required to plan; --execute uses that frozen plan')
    plan_experiment(args.model_profile, args.host_profile); return 0


if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'status': 'operator-failed', 'error_type': diagnostics.failure(error)}), flush=True)
        raise SystemExit(1) from None
