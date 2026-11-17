"""No weights or inference: adversarial evidence and real fresh-process imports."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import types
import unittest
import uuid
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'run_standard_generation_qualification.py'
spec = importlib.util.spec_from_file_location('standard_qualification_tests_subject', MODULE)
runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)


def fixture():
    runner.original.configure_model_profile('qwen05-float32')
    return {'bindings': {'source': 'source.' + '1' * 64}, 'model_profile': 'qwen05-float32', 'precision': 'float32',
            'model': runner.original.MODEL, 'revision': runner.original.REVISION,
            'sampling': runner.original.heldout_plan()['effective_sampling'],
            'schemas': {'baseline': {'schema_sha256': 'a' * 64}, 'candidate': {'schema_sha256': 'b' * 64}}}


def measurement(plan, variant, *, correct=23, seconds=20, wrong_index=23):
    value = {'status': 'measured', 'bindings': plan['bindings'], 'model_profile': plan['model_profile'],
        'model': plan['model'], 'revision': plan['revision'], 'precision': plan['precision'], 'actual_precision': 'torch.float32',
        'device': 'cuda', 'mode': 'unchecked', 'replicate': 1, 'variant': variant, 'memory_mode': 'standard',
        'schema_sha256': plan['schemas'][variant]['schema_sha256'], 'effective_sampling': plan['sampling'],
        'runtime_vram_floor_observed': True, 'cleanup_passed': True, 'generator_cache_empty': True,
        'retained_leases_empty': True, 'placement_observed': True, 'tensor_placement_mismatch_count': 0,
        'actual_tensor_devices': ['cuda:0'], 'runtime_allocated_vram_floor_bytes': 8,
        'runtime_reserved_vram_floor_bytes': 20, 'remaining_allocated_vram_bytes': 8, 'remaining_reserved_vram_bytes': 20,
        'peak_allocated_vram_bytes': 80, 'peak_reserved_vram_bytes': 100,
        'model_delivery_seconds': seconds, 'load_seconds': .1, 'cleanup_seconds': .1,
        'whole_delivery_seconds': seconds + 2, 'phases': {}}
    for phase in ('first', 'warm'):
        cases = []
        for index, oracle in enumerate(runner.original.heldout_plan()['heldout']):
            is_correct = index != wrong_index if correct == 23 else index < correct
            label = oracle['label'] if is_correct else ('support' if oracle['label'] == 'billing' else 'billing')
            cases.append({'id': oracle['id'], 'accepted': correct > 0, 'correct': is_correct,
                **({'predicted_label': label} if correct else {}), 'attempts': 1, 'invalid_attempts': 0,
                'operational_errors': 0, 'repairs': 0, 'seconds': .01})
        value['phases'][phase] = {'cases': cases, 'correct': sum(row['correct'] for row in cases),
            'seconds': .5, **runner.original.phase_counts(cases)}
    return value


def paired_rows(plan):
    rows = []
    for number in (1, 2, 3):
        for variant in runner.VARIANTS:
            value = measurement(plan, variant, seconds=40 if variant == 'baseline' else 20)
            value['replicate'] = number
            rows.append({'variant': variant, 'replicate': number, 'measurement': value,
                'source_stable': True, 'launcher_delivery_seconds': value['whole_delivery_seconds'] + 1,
                'observation': {'physical_exit_code': 0, 'peak_rss_bytes': 1024**3}})
    return rows


class StandardEntryAdmissionTests(unittest.TestCase):
    def test_cli_execution_denies_busy_coordinator_or_worker_before_execute(self):
        import io
        for kind in ('coordinator', 'worker'):
            with self.subTest(kind=kind), runner.slot(kind), \
                    patch.object(runner.sys, 'argv', [str(MODULE), '--execute', 'a'*32, '--plan-sha256', 'b'*64]), \
                    patch.object(runner, 'execute') as execute, patch.object(runner, 'run_folder') as folder, \
                    patch.object(runner.sys, 'stdout', io.StringIO()) as output:
                self.assertEqual(runner.main(), 1)
            execute.assert_not_called()
            folder.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())['reason_code'], 'model-test-busy')

    def test_cli_execution_keeps_coordinator_and_releases_preflight_worker(self):
        from contextlib import contextmanager
        held = []
        @contextmanager
        def guard(kind):
            held.append(kind)
            try:
                yield
            finally:
                self.assertEqual(held.pop(), kind)
        def execute(folder, digest):
            self.assertEqual(held, ['coordinator'])
            self.assertEqual((folder, digest), ('fixture-folder', 'b'*64))
            raise RuntimeError('fixture execution failure')
        with patch.object(runner.sys, 'argv', [str(MODULE), '--execute', 'a'*32, '--plan-sha256', 'b'*64]), \
                patch.object(runner, 'slot', side_effect=guard), patch.object(runner, 'run_folder', return_value='fixture-folder'), \
                patch.object(runner, 'execute', side_effect=execute):
            with self.assertRaisesRegex(RuntimeError, 'fixture execution failure'):
                runner.main()
        self.assertEqual(held, [])

    def test_planning_does_not_acquire_execution_slots(self):
        with patch.object(runner.sys, 'argv', [str(MODULE), '--model-profile', 'qwen05-float32']), \
                patch.object(runner, 'slot', side_effect=AssertionError('plan must not enter a slot')), \
                patch.object(runner, 'plan_experiment') as plan:
            self.assertEqual(runner.main(), 0)
        plan.assert_called_once_with('qwen05-float32', 'legacy-reference-v1')


class EvidenceReplayTests(unittest.TestCase):
    def test_invalid_baseline_acceptance_is_complete_quality_evidence_not_a_worker_crash(self):
        rows = paired_rows(self.plan)
        value = rows[0]['measurement']
        case = value['phases']['first']['cases'][-1]
        case.pop('predicted_label')
        case.update(invalid_accepted=True, status='invalid-accepted')
        value['phases']['first']['invalid_accepted'] = 1
        self.assertTrue(self.assess(rows)['measurement_complete'])
        rows[1]['measurement']['phases']['first']['cases'][-1] = copy.deepcopy(case)
        rows[1]['measurement']['phases']['first']['invalid_accepted'] = 1
        self.assertFalse(self.assess(rows)['quality_passed'])

    def test_invalid_acceptance_flag_counts_and_unredacted_label_cannot_be_forged(self):
        for change in (lambda p: p['cases'][-1].update(invalid_accepted='yes'),
                       lambda p: p.update(invalid_accepted=True),
                       lambda p: p['cases'][-1].update(invalid_accepted=True, status='invalid-accepted')):
            rows = paired_rows(self.plan)
            change(rows[0]['measurement']['phases']['first'])
            self.assertFalse(self.assess(rows)['measurement_complete'])

    def test_contradictory_invalid_status_and_all_invalid_accepted_attempts_fail(self):
        for absent in (True, False):
            rows = paired_rows(self.plan)
            case = rows[1]['measurement']['phases']['first']['cases'][-1]
            case.pop('predicted_label')
            case.update(accepted=False, status='invalid-accepted')
            if not absent: case['invalid_accepted'] = False
            self.assertFalse(self.assess(rows)['measurement_complete'])
        rows = paired_rows(self.plan)
        rows[1]['measurement']['phases']['first']['cases'][0]['invalid_attempts'] = 1
        phase = rows[1]['measurement']['phases']['first']
        phase.update(runner.original.phase_counts(phase['cases']))
        self.assertFalse(self.assess(rows)['measurement_complete'])

    def setUp(self): self.plan = fixture()

    def assess(self, rows): return runner.assess_pairs(rows, self.plan, 'cuda', 'unchecked')

    def test_complete_fixed_pairs_and_different_arm_schemas_pass(self):
        result = self.assess(paired_rows(self.plan))
        self.assertTrue(result['measurement_complete']); self.assertTrue(result['quality_passed'])
        self.assertEqual(result['median_delivery_ratio'], 2); self.assertTrue(result['throughput_target_met'])
        self.assertEqual(len(result['pairs']), 3)

    def test_one_lost_correct_case_prevents_quality_even_above_floor(self):
        rows = paired_rows(self.plan)
        rows[1]['measurement'] = measurement(self.plan, 'candidate', wrong_index=22)
        result = self.assess(rows)
        self.assertTrue(result['measurement_complete']); self.assertFalse(result['quality_passed'])
        self.assertEqual(result['pairs'][0]['phases'][0]['lost_correct'], 1)

    def test_floor_and_throughput_are_independent(self):
        rows = paired_rows(self.plan)
        for row in rows:
            row['measurement'] = measurement(self.plan, row['variant'], correct=22, seconds=20)
            row['measurement']['replicate'] = row['replicate']
        result = self.assess(rows)
        self.assertFalse(result['quality_passed']); self.assertFalse(result['throughput_target_met'])

    def test_zero_baseline_never_produces_infinite_relative_gain(self):
        rows = paired_rows(self.plan)
        for row in rows:
            if row['variant'] == 'baseline':
                row['measurement'] = measurement(self.plan, 'baseline', correct=0, seconds=40)
                row['measurement']['replicate'] = row['replicate']
        result = self.assess(rows)
        self.assertTrue(result['measurement_complete']); self.assertIsNone(result['median_delivery_ratio'])
        self.assertFalse(result['throughput_target_met'])

    def test_missing_duplicate_or_boolean_replicates_never_complete(self):
        base = paired_rows(self.plan)
        for rows in (base[:-1], base + [base[0]], [base[0]] * 6):
            self.assertFalse(self.assess(rows)['measurement_complete'])
        rows = copy.deepcopy(base); rows[0]['replicate'] = True
        self.assertFalse(self.assess(rows)['measurement_complete'])

    def test_changed_case_membership_or_claimed_correctness_is_rejected(self):
        changes = [lambda v: v['phases']['first']['cases'].pop(),
            lambda v: v['phases']['warm']['cases'][0].update(id='heldout-02'),
            lambda v: v['phases']['first']['cases'][0].update(correct=False),
            lambda v: v['phases']['first']['cases'][0].update(predicted_label='invented'),
            lambda v: v['phases']['first'].update(correct=24)]
        for change in changes:
            rows = paired_rows(self.plan); change(rows[0]['measurement'])
            self.assertFalse(self.assess(rows)['measurement_complete'])

    def test_operational_invalid_counts_nonfinite_and_false_timing_fail(self):
        changes = [lambda v: v['phases']['first']['cases'][0].update(operational_errors=1),
            lambda v: v['phases']['first']['cases'][0].update(attempts=3),
            lambda v: v['phases']['first']['cases'][0].update(repairs=1),
            lambda v: v['phases']['first'].update(seconds=.001),
            lambda v: v.update(model_delivery_seconds=.1),
            lambda v: v.update(whole_delivery_seconds=.1),
            lambda v: v.update(model_delivery_seconds=float('nan'))]
        for change in changes:
            rows = paired_rows(self.plan); change(rows[0]['measurement'])
            self.assertFalse(self.assess(rows)['measurement_complete'])

    def test_exact_model_schema_placement_and_cleanup_cannot_be_substituted(self):
        for key, value in [('status', 'incomplete-budget-stop'), ('model', 'foreign'), ('precision', 'bfloat16'),
            ('actual_precision', 'torch.bfloat16'), ('schema_sha256', 'b'*64), ('memory_mode', 'offload-v1'),
            ('runtime_vram_floor_observed', False), ('generator_cache_empty', False), ('retained_leases_empty', False),
            ('tensor_placement_mismatch_count', 1), ('actual_tensor_devices', ['cpu']),
            ('remaining_reserved_vram_bytes', 21), ('diagnostic_overflow', True)]:
            rows = paired_rows(self.plan); rows[0]['measurement'][key] = value
            self.assertFalse(self.assess(rows)['measurement_complete'], key)

    def test_peak_vram_must_be_observed_finite_consistent_and_not_below_floor(self):
        for key, value in [('peak_allocated_vram_bytes',None),('peak_reserved_vram_bytes',-1),
            ('peak_allocated_vram_bytes',float('nan')),('peak_allocated_vram_bytes',True),
            ('peak_allocated_vram_bytes',7),('peak_reserved_vram_bytes',19),('peak_allocated_vram_bytes',101)]:
            rows=paired_rows(self.plan);rows[0]['measurement'][key]=value
            self.assertFalse(self.assess(rows)['measurement_complete'],key)

    def test_cpu_observations_require_zero_cuda_usage(self):
        value=measurement(self.plan,'baseline');value.update(device='cpu',actual_tensor_devices=['cpu'])
        for key in ('runtime_allocated_vram_floor_bytes','runtime_reserved_vram_floor_bytes',
            'remaining_allocated_vram_bytes','remaining_reserved_vram_bytes','peak_allocated_vram_bytes','peak_reserved_vram_bytes'):
            value[key]=0
        runner.replay_measurement(value,self.plan,'baseline','cpu',1,'unchecked')
        value['peak_reserved_vram_bytes']=1
        with self.assertRaises(ValueError):runner.replay_measurement(value,self.plan,'baseline','cpu',1,'unchecked')

    def test_native_exit_rss_source_and_launcher_boundary_remain_required(self):
        for key, value in [('physical_exit_code', 1), ('physical_exit_code', False), ('peak_rss_bytes', runner.RSS_LIMIT+1), ('peak_rss_bytes', True)]:
            rows = paired_rows(self.plan); rows[0]['observation'][key] = value
            self.assertFalse(self.assess(rows)['measurement_complete'])
        rows = paired_rows(self.plan); rows[0]['source_stable'] = False
        self.assertFalse(self.assess(rows)['measurement_complete'])
        rows = paired_rows(self.plan); rows[0]['launcher_delivery_seconds'] = .1
        self.assertFalse(self.assess(rows)['measurement_complete'])


class OwnedFolderFixture(unittest.TestCase):
    def setUp(self):
        self.parent = runner.diagnostics.safe_directory(runner.ROOT / runner.OUTPUT, create=True)
        self.folder = self.parent / uuid.uuid4().hex; self.folder.mkdir()
        self.addCleanup(self.cleanup)

    def cleanup(self):
        self.assertEqual(self.folder.resolve().parent, self.parent.resolve())
        self.assertFalse(self.folder.is_symlink())
        shutil.rmtree(self.folder)


class BaselineIsolationTests(OwnedFolderFixture):
    def test_tampered_baseline_fails_before_any_import_or_model(self):
        runner.prepare_baseline(self.folder)
        path = self.folder / 'baseline/example_generation.py'; path.write_text('raise RuntimeError("substituted")')
        with self.assertRaises(ValueError): runner.verify_baseline(self.folder)

    def test_only_verified_algorithms_are_extracted_and_fresh_imports_keep_current_runtime(self):
        runner.prepare_baseline(self.folder)
        self.assertEqual({p.name for p in (self.folder/'baseline').iterdir()}, set(runner.ALGORITHMS))
        observations = {}
        for variant in runner.VARIANTS:
            result = subprocess.run([sys.executable, '-s', '-B', str(MODULE), '--inspect', self.folder.name, '--variant', variant],
                cwd=runner.ROOT, capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout)
            observations[variant] = json.loads(result.stdout)
            self.assertTrue(observations[variant]['empty_generator_cache'])
        self.assertEqual(observations['baseline']['algorithms'], runner.ALGORITHMS)
        self.assertEqual(observations['baseline']['current_runtime_sha256'], observations['candidate']['current_runtime_sha256'])

    def test_foreign_measurement_path_denied_before_read(self):
        with self.assertRaises(ValueError):
            runner.read_measurements(self.folder, [{'device':'../../outside', 'mode':'unchecked','variant':'baseline','replicate':1}])

    def test_claimed_hash_cannot_admit_changed_measurement(self):
        child = self.folder/'cuda-unchecked-1-baseline'; child.mkdir()
        (child/'cohort.json').write_text('{}')
        with self.assertRaises(ValueError):
            runner.read_measurements(self.folder, [{'device':'cuda','mode':'unchecked','variant':'baseline','replicate':1,
                'directory':child.name,'measurement_sha256':'0'*64}])


class CleanupObservationTests(unittest.TestCase):
    def test_host_profiles_are_prospective_fixed_and_cannot_override_legacy_bounds(self):
        self.assertEqual(runner.host_limits('qwen15-bfloat16','legacy-reference-v1'),{})
        large=runner.host_limits('qwen15-bfloat16','windows-lightweight-v1')
        small=runner.host_limits('qwen05-float32','windows-lightweight-v1')
        self.assertEqual(large['devices'],['cpu','cuda'])
        self.assertEqual(large['deadline_seconds_by_device'],{'cpu':2400,'cuda':1200})
        self.assertEqual(small['deadline_seconds_by_device'],{'cpu':1200,'cuda':1200})
        self.assertEqual(small['primary_delivery_budget_seconds'],{'cpu':600,'cuda':300})
        self.assertEqual(small['intended_use'],'reviewed-proposals-only')
        with self.assertRaises(ValueError):runner.checked_host_limits({'model_profile':'qwen05-float32','host_limits':small})
        plan={'model_profile':'qwen15-bfloat16','host_profile':'windows-lightweight-v1','host_limits':large,
              'cooperative_stop_seconds_by_device':large['cooperative_stop_seconds_by_device']}
        self.assertEqual(runner.checked_host_limits(plan),large)
        for key in ('deadline_seconds_by_device','reserved_vram_budget_bytes'):
            changed=json.loads(json.dumps(plan));changed['host_limits'][key]['cpu']=False
            with self.assertRaises(ValueError):runner.checked_host_limits(changed)

    def test_runtime_floor_and_both_ownership_caches_are_observed(self):
        runtime = type('Runtime', (), {'_GENERATOR_CACHE': {}})
        loader = type('Loader', (), {'_RETAINED_LEASES': []})
        self.assertTrue(runner.diagnostics.cleanup_snapshot(runtime,loader,8,20,8,20)['cleanup_passed'])
        loader._RETAINED_LEASES.append(object())
        self.assertFalse(runner.diagnostics.cleanup_snapshot(runtime,loader,8,20,8,20)['cleanup_passed'])
        loader._RETAINED_LEASES.clear(); runtime._GENERATOR_CACHE['held']=object()
        self.assertFalse(runner.diagnostics.cleanup_snapshot(runtime,loader,8,20,8,20)['cleanup_passed'])
        with self.assertRaises(ValueError): runner.diagnostics.cleanup_snapshot(runtime,loader,True,20,8,20)


@unittest.skipUnless(os.name == 'nt', 'Named Windows native observation')
class OwnedLifecycleTests(OwnedFolderFixture):
    def test_child_admission_denies_excluded_baseline_and_past_pass_before_measurement(self):
        selected = 'cpu-constrained-2-candidate'
        plan = fixture() | {'manifest':'no-model','remaining_selection':{'selected_cohorts':[selected]}}
        runner.diagnostics.save(self.folder,'plan.json',{})
        digest = runner.owned.sha256_file(self.folder/'plan.json')
        env={'AISB_STANDARD_RUN_ID':'a'*32,'AISB_STANDARD_PLAN_SHA256':digest}
        for name in ('cpu-constrained-2-baseline','cpu-unchecked-1-candidate',selected):
            device,mode,count,variant=name.split('-')
            args=types.SimpleNamespace(device=device,profile=mode,count=int(count),variant=variant,
                run_id=name,phase='timing',samples='8',model_manifest='no-model')
            if name == selected: (self.folder/name).mkdir()
            with patch.dict(os.environ,env),patch.object(runner,'run_folder',return_value=self.folder), \
                 patch.object(runner,'load_plan',return_value=plan), \
                 patch.object(runner.diagnostics,'measure',side_effect=RuntimeError('selected-measure-reached')) as measure:
                with self.assertRaises((ValueError,RuntimeError)) as error:runner.child_with_slot(args)
                if name == selected:
                    measure.assert_called_once()
                    self.assertEqual(str(error.exception),'selected-measure-reached')
                else:
                    measure.assert_not_called()
                    self.assertIn('excluded',str(error.exception))

    def test_remaining_execution_never_starts_passed_cohorts_or_historical_baselines(self):
        selected = 'cpu-constrained-2-candidate'
        plan = fixture() | {'manifest':'no-model','devices':['cpu','cuda'],
                            'remaining_selection':{'selected_cohorts':[selected]}}
        runner.diagnostics.save(self.folder,'plan.json',{})
        runner.diagnostics.save(self.folder,'report.json',{'status':'planned-not-executed'})
        digest = runner.owned.sha256_file(self.folder/'plan.json')
        def denied(args, folder, number, *rest, **kw):
            self.assertEqual(folder.name, selected)
            self.assertEqual(number, 2)
            self.assertEqual(rest[1], 'candidate')
            runner.diagnostics.save(folder,'cohort.json',{'status':'denied-memory','plan_sha256':digest,
                'cleanup_passed':True,'generator_cache_empty':True,'retained_leases_empty':True,'phases':{}})
            return {'physical_exit_code':0,'peak_rss_bytes':1024}
        with patch.object(runner,'load_plan',return_value=plan),patch.object(runner,'verify_baseline'), \
             patch.object(runner,'identity',return_value=plan['bindings']), \
             patch.object(runner.original,'verified_model'),patch.object(runner.owned,'run_child',side_effect=denied) as child:
            self.assertEqual(runner.execute(self.folder,digest),1)
        self.assertEqual(child.call_count,1)
        report=json.loads((self.folder/'report.json').read_text())
        self.assertEqual([r['directory'] for r in report['measurements']],[selected])
        self.assertFalse(report['qualification_complete'])
        self.assertEqual(report['status'],'not-qualified-see-cohorts')

    def test_child_acknowledges_native_supervision_then_locks_before_any_model_work(self):
        from contextlib import contextmanager
        import io
        held=[];output=io.StringIO();input_stream=io.StringIO('run\n')
        @contextmanager
        def guard(kind):
            self.assertEqual(json.loads(output.getvalue())['kind'],'ready')
            self.assertEqual(input_stream.tell(),4)
            self.assertEqual(kind,'worker');held.append(True)
            try:yield
            finally:held.pop()
        with patch.object(runner.sys,'stdin',input_stream),patch.object(runner.sys,'stdout',output),patch.object(runner,'slot',side_effect=guard), \
                patch.object(runner,'child_with_slot',side_effect=lambda args:self.assertTrue(held)) as child:
            runner.child(types.SimpleNamespace())
        child.assert_called_once();self.assertEqual(held,[])

    def test_actual_busy_worker_denial_follows_owned_native_observation_without_models(self):
        folder=self.folder/'entrypoint-busy';folder.mkdir()
        with runner.slot('worker'),patch.object(runner.owned,'SCRIPT',MODULE), \
                patch.dict(os.environ,{'AISB_STANDARD_RUN_ID':'invalid-run-identity'}),self.assertRaises(RuntimeError) as caught:
            runner.owned.run_child(types.SimpleNamespace(samples=8,model_manifest='no-model'),folder,1,'measure',
                'candidate','cpu','timing','unchecked',execution_seconds=2400)
        lifecycle=caught.exception.owned_child_failure
        self.assertEqual(lifecycle['native_exit_code'],1)
        self.assertTrue(lifecycle['native_exit_confirmed'])
        self.assertFalse((folder/'cohort.json').exists())
        self.assertEqual(lifecycle['model_cleanup_status'],'not-observed')

    def test_real_operator_denial_occurs_after_native_observation_without_models(self):
        for deadline in (1200,2400):
            folder=self.folder/('entrypoint-denial-'+str(deadline));folder.mkdir()
            with patch.object(runner.owned,'SCRIPT',MODULE), patch.dict(os.environ,{'AISB_STANDARD_RUN_ID':'invalid-run-identity'}):
                with self.assertRaises(RuntimeError) as caught:
                    runner.owned.run_child(types.SimpleNamespace(samples=8,model_manifest='no-model'),folder,1,'measure',
                        'candidate','cpu','timing','unchecked',execution_seconds=deadline)
            self.assertEqual(caught.exception.owned_child_failure['native_exit_code'],1)
            self.assertTrue(caught.exception.owned_child_failure['native_exit_confirmed'])

    def test_unobserved_model_cleanup_stops_even_with_confirmed_native_zero(self):
        plan=fixture()|{'manifest':'no-model'}
        (self.folder/'plan.json').write_text('{}');(self.folder/'report.json').write_text('{"status":"planned-not-executed"}')
        digest=hashlib.sha256(b'{}').hexdigest()
        def denied(_args,folder,*a,**kw):
            runner.diagnostics.save(folder,'cohort.json',{'status':'failed-cleanup','plan_sha256':digest,'phases':{},
                'cleanup_passed':False,'generator_cache_empty':False,'retained_leases_empty':True})
            return {'physical_exit_code':0,'peak_rss_bytes':100}
        with patch.object(runner,'load_plan',return_value=plan),patch.object(runner,'verify_baseline'), \
                patch.object(runner,'identity',return_value=plan['bindings']),patch.object(runner.owned,'run_child',side_effect=denied) as run:
            self.assertEqual(runner.execute(self.folder,digest),1)
        self.assertEqual(run.call_count,1)
        self.assertEqual(json.loads((self.folder/'report.json').read_text())['status'],'aborted')

    def test_actual_owned_native_success_and_failure_are_distinct_without_models(self):
        with patch.object(runner.owned, 'SCRIPT', Path(__file__).resolve()):
            good = self.folder/'success'; good.mkdir()
            result = runner.owned.run_child(types.SimpleNamespace(samples=8,model_manifest='no-model'),good,1,'measure',
                'candidate','cpu','timing','probe-success',execution_seconds=1200)
            self.assertEqual(result['physical_exit_code'],0)
            self.assertTrue(result['probe_no_model'])
            bad = self.folder/'failure'; bad.mkdir()
            with self.assertRaises(RuntimeError) as caught:
                runner.owned.run_child(types.SimpleNamespace(samples=8,model_manifest='no-model'),bad,1,'measure',
                    'candidate','cpu','timing','probe-failure',execution_seconds=1200)
            lifecycle = caught.exception.owned_child_failure
            self.assertEqual(lifecycle['native_exit_code'],7)
            self.assertTrue(lifecycle['native_exit_confirmed'])

    def test_uncertain_exit_stops_scheduling_and_restores_supervisor_instrumentation(self):
        plan = fixture() | {'manifest':'no-model'}
        (self.folder/'plan.json').write_text('{}')
        (self.folder/'report.json').write_text('{"status":"planned-not-executed"}')
        digest = hashlib.sha256(b'{}').hexdigest()
        old_finish, old_rss = runner.owned.finish_owned_child, runner.owned.rss
        with patch.object(runner,'load_plan',return_value=plan), patch.object(runner,'verify_baseline'), \
                patch.object(runner,'identity',return_value=plan['bindings']), \
                patch.object(runner.owned,'run_child',side_effect=runner.owned.UnconfirmedChildExit(123)) as execute:
            self.assertEqual(runner.execute(self.folder,digest),2)
        self.assertEqual(execute.call_count,1)
        self.assertIs(runner.owned.finish_owned_child,old_finish); self.assertIs(runner.owned.rss,old_rss)
        self.assertEqual(json.loads((self.folder/'report.json').read_text())['status'],'aborted-unconfirmed-native-exit')

    def test_keyboard_interrupt_preserves_row_and_finite_owned_exit_metadata(self):
        plan=fixture()|{'manifest':'no-model'}
        (self.folder/'plan.json').write_text('{}')
        (self.folder/'report.json').write_text('{"status":"planned-not-executed"}')
        error=KeyboardInterrupt();error.owned_child_failure={'native_exit_confirmed':True,'native_exit_code':1,'model_cleanup_status':'not-observed'}
        with patch.object(runner,'load_plan',return_value=plan),patch.object(runner,'verify_baseline'), \
                patch.object(runner,'identity',return_value=plan['bindings']),patch.object(runner.owned,'run_child',side_effect=error) as run:
            self.assertEqual(runner.execute(self.folder,hashlib.sha256(b'{}').hexdigest()),1)
        report=json.loads((self.folder/'report.json').read_text())
        self.assertEqual(run.call_count,1);self.assertEqual(report['status'],'aborted')
        self.assertEqual(report['measurements'][0]['status'],'interrupted')
        self.assertEqual(report['measurements'][0]['lifecycle']['model_cleanup_status'],'not-observed')
        self.assertFalse(report['qualification_complete'])

    def test_exclusive_intent_refuses_reentry_even_if_initial_report_was_not_published(self):
        (self.folder/'plan.json').write_text('{}')
        (self.folder/'report.json').write_text('{"status":"planned-not-executed"}')
        (self.folder/'execution.json').write_text('{"preserve":"crashed-attempt"}')
        with patch.object(runner,'load_plan',return_value=fixture()), patch.object(runner.owned,'run_child') as execute:
            with self.assertRaises(FileExistsError): runner.execute(self.folder,hashlib.sha256(b'{}').hexdigest())
        execute.assert_not_called()
        self.assertEqual(json.loads((self.folder/'execution.json').read_text())['preserve'],'crashed-attempt')


if __name__ == '__main__':
    if '--child' in sys.argv:
        # Fixed model-free native supervisor fixture, never a model entry point.
        profile = sys.argv[sys.argv.index('--profile')+1]
        if profile not in ('probe-success','probe-failure'): raise SystemExit(9)
        print(json.dumps({'kind':'ready','pid':os.getpid(),'parent_pid':os.getppid(),'rss_bytes':runner.owned.rss(os.getpid())}),flush=True)
        if sys.stdin.readline().strip()!='run': raise SystemExit(8)
        if profile=='probe-failure': raise SystemExit(7)
        print(json.dumps({'kind':'result','probe_no_model':True}),flush=True)
    else: unittest.main()
