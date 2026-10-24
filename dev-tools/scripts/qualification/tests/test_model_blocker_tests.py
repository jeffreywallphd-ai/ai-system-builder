"""Model-free adversarial coverage, lifecycle and one-command handoff tests."""
import copy
from contextlib import nullcontext
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1]/'run_model_blocker_tests.py'
spec=importlib.util.spec_from_file_location('blocker_runner_subject',MODULE)
runner=importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)


class BlockerRunnerTests(unittest.TestCase):
    def test_remaining_diagnosis_distinguishes_memory_quality_and_pending_prerequisites(self):
        cohorts = [
            {'status':'denied-memory','variant':'candidate',
             'memory_denial':{'device':'cpu','observed':True,'maximum_shortfall_bytes':700}},
            {'status':'denied-memory','variant':'baseline',
             'memory_denial':{'device':'cuda','observed':True,'maximum_shortfall_bytes':900}},
            {'status':'measured','variant':'candidate','user_accepted_absolute_floor_met':False,'invalid_accepted_count':2},
            {'status':'measured','variant':'candidate','user_accepted_absolute_floor_met':True}]
        result = runner.remaining_diagnosis([{'cohorts':cohorts}])
        self.assertEqual(result['memory_denied_cohorts'], 2)
        self.assertEqual(result['cpu_maximum_observed_ram_shortfall_bytes'], 700)
        self.assertEqual(result['candidate_absolute_quality_failures'], 1)
        self.assertEqual(result['invalid_accepted_outputs'], 2)
        self.assertNotIn('qualified', result)
        empty = runner.remaining_diagnosis([])
        self.assertIsNone(empty['cpu_maximum_observed_ram_shortfall_bytes'])

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=runner.ROOT/'.local-codex')
        self.addCleanup(self.temp.cleanup); self.folder=Path(self.temp.name)
        self.config=runner.registry()
        # Exercise the real inventory validator against stable public metadata.
        # Unit lifecycle tests must not depend on a live roadmap remaining open.
        metadata = {}
        for owner in self.config['owners']:
            increments = {}
            for ref in owner['criteria']:
                increment, criterion = ref.split('/')
                increments.setdefault(increment, {'id':increment, 'status':'verifying', 'acceptanceCriteria':[]})['acceptanceCriteria'].append(
                    {'id':criterion, 'description':'Synthetic qualification requirement.', 'qualification':{'status':'pending'}})
            metadata[owner['id']] = {'status':'executing', 'increments':list(increments.values()),
                'blockers':[{'id':owner['id']+'-synthetic', 'kind':'technical', 'status':'open',
                    'summary':'Synthetic unresolved requirement.', 'requiredAction':'Synthetic action.'}]}
        metadata['system-builder-canvas-reliability'] = {'status':'completed', 'increments':[], 'blockers':[]}
        self.metadata = metadata
        state_root = runner.ROOT/'.implementation-roadmaps'
        original_glob, original_read = Path.glob, runner.read
        def glob(path, pattern):
            if path == state_root and pattern == '*/state.json':
                return iter(state_root/name/'state.json' for name in sorted(metadata))
            return original_glob(path, pattern)
        def read(path, *args, **kwargs):
            path = Path(path)
            if path.parent.parent == state_root and path.name == 'state.json':
                return copy.deepcopy(metadata[path.parent.name])
            return original_read(path, *args, **kwargs)
        self.enterContext(patch.object(Path, 'glob', glob))
        self.enterContext(patch.object(runner, 'read', side_effect=read))
        self.enterContext(patch.object(runner, 'folded_history', return_value=[]))

    def test_inventory_excludes_validated_folded_history_but_not_an_unknown_owner(self):
        retired = 'synthetic-retired-roadmap'
        self.metadata[retired] = {'status':'blocked', 'increments':[], 'blockers':[{'status':'open'}]}
        handoff = {'source':retired, 'owner':'security-findings-refresh', 'consolidation_sha256':'a'*64}
        with patch.object(runner, 'folded_history', return_value=[handoff]):
            rows = runner.inventory(self.config)
        self.assertNotIn(retired, {row['roadmap_id'] for row in rows})
        self.assertEqual(next(row for row in rows if row['roadmap_id']==handoff['owner'])['folded_history'], [handoff])
        with self.assertRaisesRegex(ValueError, 'Unmapped or changed'):
            runner.inventory(self.config)

    def test_inventory_accounts_for_every_open_blocker_without_offload_or_provider_calls(self):
        result=runner.inventory(self.config)
        self.assertEqual({r['roadmap_id'] for r in result},{o['id'] for o in self.config['owners']})
        self.assertTrue(all(r['parent_qualification']=='pending' for r in result))
        self.assertEqual(len({b['id'] for r in result for b in r['blockers']}),sum(len(r['blockers']) for r in result))
        routes={r['coverage'] for r in result}
        self.assertIn('blocked-native-offload',routes);self.assertIn('blocked-advanced-provider',routes)
        self.assertFalse(any('command' in o for o in self.config['owners']))

    def inventory_with_metadata(self, change):
        original_read = runner.read
        def read(path, *args, **kwargs):
            value = original_read(path, *args, **kwargs)
            if Path(path).name == 'state.json' and Path(path).parent.parent.name == '.implementation-roadmaps':
                value = copy.deepcopy(value)
                change(Path(path).parent.name, value)
            return value
        with patch.object(runner, 'read', side_effect=read):
            return runner.inventory(self.config)

    def test_registered_pending_criteria_do_not_require_open_human_issues(self):
        owners = {owner['id'] for owner in self.config['owners']}
        criterion_owners = {owner['id'] for owner in self.config['owners'] if owner['criteria']}
        def change(name, state):
            if name in criterion_owners:
                state['blockers'] = []
        result = self.inventory_with_metadata(change)
        self.assertEqual({row['roadmap_id'] for row in result}, owners)
        self.assertTrue(all(row['criteria'] and not row['blockers'] for row in result if row['roadmap_id'] in criterion_owners))
        self.assertTrue(all(row['parent_qualification'] == 'pending' for row in result))

    def test_issue_only_security_owner_without_unresolved_issue_is_denied(self):
        owners = {owner['id'] for owner in self.config['owners'] if not owner['criteria']}
        self.assertTrue(owners)
        def change(name, state):
            if name in owners:
                state['blockers'] = []
        with self.assertRaisesRegex(ValueError, 'Issue-only security coverage'):
            self.inventory_with_metadata(change)

    def test_completed_registered_owner_or_completed_target_is_denied(self):
        owner = self.config['owners'][0]
        targets = {ref.split('/')[0] for ref in owner['criteria']}
        for mode in ('owner', 'targets'):
            def change(name, state):
                if name != owner['id']:
                    return
                if mode == 'owner':
                    state['status'] = 'completed'
                else:
                    for increment in state['increments']:
                        if increment['id'] in targets:
                            increment['status'] = 'completed'
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                self.inventory_with_metadata(change)

    def test_canonical_missing_criterion_is_denied(self):
        owner = self.config['owners'][0]
        increment_id, criterion_id = owner['criteria'][0].split('/')
        def change(name, state):
            if name == owner['id']:
                for increment in state['increments']:
                    if increment['id'] == increment_id:
                        increment['acceptanceCriteria'] = [c for c in increment['acceptanceCriteria'] if c['id'] != criterion_id]
        with self.assertRaisesRegex(ValueError, 'Missing canonical criterion'):
            self.inventory_with_metadata(change)

    def test_unmapped_open_issue_owner_is_still_denied(self):
        unrelated = 'system-builder-canvas-reliability'
        self.assertNotIn(unrelated, {owner['id'] for owner in self.config['owners']})
        def change(name, state):
            if name == unrelated:
                state['status'] = 'ready'
                state['blockers'] = [{'status': 'open'}]
        with self.assertRaisesRegex(ValueError, 'Unmapped or changed'):
            self.inventory_with_metadata(change)

    def test_unmapped_owner_or_missing_criterion_refuses_instead_of_silently_skipping(self):
        for mutate in ('owner','criterion'):
            config=copy.deepcopy(self.config)
            if mutate=='owner': config['owners'].pop()
            else: config['owners'][0]['criteria']=['no-increment/no-criterion']
            with self.subTest(mutate=mutate),self.assertRaises(ValueError):runner.inventory(config)
        for index in range(len(self.config['owners'])):
            config = copy.deepcopy(self.config)
            config['owners'].pop(index)
            with self.subTest(omitted_owner=index), self.assertRaisesRegex(ValueError, 'canonical qualification registry'):
                runner.inventory(config)

    def test_registry_denies_arbitrary_command_paths_duplicate_and_unknown_fields(self):
        for mutate in ('command','path','duplicate','model','host','empty-criteria'):
            config=copy.deepcopy(self.config)
            if mutate=='command':config['owners'][0]['argv']=['arbitrary']
            if mutate=='path':config['owners'][0]['id']='../../outside'
            if mutate=='duplicate':config['owners'].append(config['owners'][0])
            if mutate=='model':config['models']=['remote/model']
            if mutate=='host':config['host_profile']='unbounded'
            if mutate=='empty-criteria':config['owners'][0]['criteria']=[]
            with self.subTest(mutate=mutate),patch.object(runner,'read',return_value=config),self.assertRaises(ValueError):runner.registry()

    def test_read_and_identity_refuse_escape_redirect_and_nonfinite_digest(self):
        with self.assertRaises(ValueError):runner.read(runner.ROOT.parent/'outside.json')
        for identity in ('../escape','x'*32,'a'*31):
            with self.assertRaises(ValueError):runner.folder_for(identity)
        with self.assertRaises(ValueError):runner.digest({'value':float('nan')})

    def test_plan_only_uses_both_fixed_profiles_and_never_executes_models(self):
        with patch.object(runner,'OUTPUT',self.folder.relative_to(runner.ROOT).as_posix()), \
                patch.object(runner,'bindings',return_value={'source':'frozen'}), \
                patch.object(runner.standard,'plan_experiment',side_effect=[{'run_id':'a'*32,'plan_sha256':'1'*64},{'run_id':'b'*32,'plan_sha256':'2'*64}]) as plan, \
                patch.object(runner.standard,'execute') as execute,patch('sys.stdout',io.StringIO()):
            result=runner.plan_bundle()
        self.assertEqual([c.args for c in plan.call_args_list],[(p,'windows-lightweight-v1') for p in runner.PROFILES])
        execute.assert_not_called()
        value=json.loads((self.folder/result['run_id']/'plan.json').read_text())
        self.assertEqual([r['profile'] for r in value['profiles']],runner.PROFILES)

    def test_plan_or_inventory_drift_preserves_failed_preparation(self):
        with patch.object(runner,'OUTPUT',self.folder.relative_to(runner.ROOT).as_posix()), \
                patch.object(runner,'bindings',side_effect=[{'source':1},{'source':2}]), \
                patch.object(runner.standard,'plan_experiment',return_value={'run_id':'a'*32,'plan_sha256':'1'*64}), \
                patch('sys.stdout',io.StringIO()),self.assertRaises(ValueError):runner.plan_bundle()
        summaries=list(self.folder.glob('*/summary.json'))
        self.assertEqual(len(summaries),1);self.assertEqual(json.loads(summaries[0].read_text())['status'],'preflight-failed')
        saved=json.loads(summaries[0].read_text())
        self.assertEqual(saved['failure_log']['stage'],'operator-planning')
        self.assertTrue(any(f['function']=='plan_bundle' for f in saved['failure_log']['source_frames']))

    def bundle_files(self):
        plan={'schema_version':'model-blocker-bundle-v1','created_at':'fixed','bindings':{'source':'frozen'},
            'host_profile':'windows-lightweight-v1','inventory':[],'profiles':[],'scope':'declared'}
        folders={}
        for i,profile in enumerate(runner.PROFILES,1):
            sub=self.folder/str(i);sub.mkdir();runner.save(sub,'plan.json',{})
            runner.save(sub,'report.json',{'status':'planned-not-executed'})
            entry={'profile':profile,'run_id':str(i)*32,'plan_sha256':runner.standard.owned.sha256_file(sub/'plan.json')}
            plan['profiles'].append(entry);folders[entry['run_id']]=sub
        runner.save(self.folder,'plan.json',plan)
        runner.save(self.folder,'summary.json',{'status':'planned-not-executed'})
        runner.save(self.folder,'coverage.json',{'schema_version':'model-blocker-coverage-report-v1','owners':[],'qualification_complete':False})
        return plan,folders

    def test_reviewed_bundle_admits_only_exact_unattempted_matching_model_plans(self):
        plan,folders=self.bundle_files()
        def subplan(folder):
            profile=runner.PROFILES[int(folder.name)-1]
            return {'model_profile':profile,'host_profile':'windows-lightweight-v1','bindings':plan['bindings']['runtime']}
        plan['bindings']={'runtime':{'source':'frozen'}};runner.save(self.folder,'plan.json',plan)
        def load():return runner.load_bundle(self.folder,runner.standard.owned.sha256_file(self.folder/'plan.json'))
        with patch.object(runner,'registry',return_value=self.config),patch.object(runner,'inventory',return_value=[]), \
                patch.object(runner,'bindings',return_value=plan['bindings']),patch.object(runner.standard,'run_folder',side_effect=lambda x:folders[x]), \
                patch.object(runner.standard,'load_plan',side_effect=subplan):
            self.assertEqual(load(),plan)
            with self.assertRaises(ValueError):runner.load_bundle(self.folder,'0'*64)
            runner.save(folders['1'*32],'plan.json',{'substituted':True})
            with self.assertRaises(ValueError):load()
            with self.assertRaises(ValueError):runner.load_bundle(self.folder,runner.standard.owned.sha256_file(self.folder/'plan.json'),template=True)
            runner.save(folders['1'*32],'plan.json',{})
            runner.save(folders['1'*32],'execution.json',{'preserve':'old'})
            with self.assertRaises(ValueError):load()

    def test_bundle_binding_duplicate_profile_and_coverage_changes_are_denied(self):
        plan,folders=self.bundle_files()
        for field in ('source','inventory','models','coverage','status'):
            changed=copy.deepcopy(plan)
            if field=='source':changed['bindings']={'source':'stale'}
            if field=='inventory':changed['inventory']=[{'unknown':'criterion'}]
            if field=='models':changed['profiles'][1]=changed['profiles'][0]
            runner.save(self.folder,'plan.json',changed)
            runner.save(self.folder,'coverage.json',{'schema_version':'model-blocker-coverage-report-v1','owners':[],'qualification_complete':False})
            runner.save(self.folder,'summary.json',{'status':'planned-not-executed'})
            if field=='coverage':runner.save(self.folder,'coverage.json',{'fake':'pass'})
            if field=='status':runner.save(self.folder,'summary.json',{'status':'running'})
            with self.subTest(field=field),patch.object(runner,'registry',return_value=self.config),patch.object(runner,'inventory',return_value=[]), \
                    patch.object(runner,'bindings',return_value=plan['bindings']),self.assertRaises(ValueError):
                runner.load_bundle(self.folder,runner.standard.owned.sha256_file(self.folder/'plan.json'))

    def test_unreviewed_execution_and_subset_flags_are_refused_before_models(self):
        for argv in (['--run'],['--run','--approved-run','a'*32],['--run','--devices','cpu'],['--plan-only','--approved-run','a'*32],['--plan-only','--restart']):
            with self.subTest(argv=argv),patch.object(runner,'plan_bundle') as plan,patch.object(runner,'execute_bundle') as execute, \
                    patch('sys.stderr',io.StringIO()),self.assertRaises(SystemExit):runner.main(argv)
            plan.assert_not_called();execute.assert_not_called()

    def test_standalone_dispatch_preserves_full_arguments_without_loading_weights(self):
        module=types.ModuleType('run_model_blocker_tests'); module.main=lambda argv: 17 if argv==['--run','--plan-only'] else 99
        with patch.dict(sys.modules,{'run_model_blocker_tests':module}), \
                patch.object(sys,'argv',['runner','--run','--all-blocked','--plan-only']):
            self.assertEqual(runner.standard.diagnostics.main(),17)

    def plan(self):
        return {'bindings':{'source':'frozen'},'inventory':runner.inventory(self.config),
                'profiles':[{'profile':p,'run_id':str(i)*32,'plan_sha256':str(i)*64} for i,p in enumerate(runner.PROFILES,1)]}

    def execute_fixture(self, *, code=1, status='not-qualified-see-cohorts', inspect_error=None):
        plan=self.plan();runner.save(self.folder,'plan.json',plan);runner.save(self.folder,'coverage.json',{})
        with patch.object(runner,'load_bundle',return_value=plan),patch.object(runner,'bindings',return_value=plan['bindings']), \
                patch.object(runner,'registry',return_value=self.config), \
                patch.object(runner.standard,'run_folder',return_value=self.folder), \
                patch.object(runner,'read',return_value={'status':status}), \
                patch.object(runner.standard,'execute',return_value=code) as execute, \
                patch.object(runner,'inspect_result',side_effect=inspect_error or [{'safe_for_successor':True,'comparison_profile_qualified':False,'cohorts':[]}]*2), \
                patch('sys.stdout',io.StringIO()):
            result=runner.execute_bundle(self.folder,'a'*64)
        return result,execute.call_count,json.loads((self.folder/'summary.json').read_text())

    @unittest.skipUnless(os.name=='nt','Named Windows execution')
    def test_numeric_failure_can_finish_collection_but_never_parent_qualification(self):
        code,calls,report=self.execute_fixture()
        self.assertEqual((code,calls),(0,2));self.assertFalse(report['qualification_complete'])
        self.assertEqual(report['status'],'evidence-collected-review-required')
        self.assertTrue((self.folder/'evidence-index.json').exists())

    @unittest.skipUnless(os.name=='nt','Named Windows execution')
    def test_uncertain_native_aborted_or_cleanup_unknown_prevents_all_successors(self):
        for native_code,status,error in ((2,'aborted-unconfirmed-native-exit',None),(1,'aborted',None),(1,'not-qualified-see-cohorts',ValueError('private token'))):
            with self.subTest(status=status,error=bool(error)):
                for p in self.folder.iterdir():p.unlink()
                code,calls,report=self.execute_fixture(code=native_code,status=status,inspect_error=error)
                self.assertEqual((code,calls),(1,1));self.assertFalse(report['qualification_complete'])
                self.assertEqual(report['status'],'halted-pending-evidence')
                self.assertEqual(report['failure_log']['stage'],'operator-execution')
                self.assertTrue(any(f['function']=='execute_bundle' for f in report['failure_log']['source_frames']))
                self.assertNotIn('private token',json.dumps(report))

    @unittest.skipUnless(os.name=='nt','Named Windows execution')
    def test_exclusive_bundle_intent_preserves_interrupted_attempt(self):
        runner.save(self.folder,'execution.json',{'preserve':'old attempt'})
        with patch.object(runner,'load_bundle',return_value=self.plan()),patch.object(runner.standard,'execute') as execute,self.assertRaises(FileExistsError):
            runner.execute_bundle(self.folder,'a'*64)
        execute.assert_not_called();self.assertEqual(json.loads((self.folder/'execution.json').read_text()),{'preserve':'old attempt'})

    def test_attempted_template_can_clone_but_never_execute_old_intents(self):
        plan,folders=self.bundle_files()
        plan['bindings']={'runtime':{'source':'frozen'}};runner.save(self.folder,'plan.json',plan)
        runner.save(self.folder,'summary.json',{'status':'halted-pending-evidence'})
        runner.save(self.folder,'execution.json',{'preserve':'original'})
        for sub in folders.values():
            runner.save(sub,'report.json',{'status':'aborted','cleanup_passed':False})
            runner.save(sub,'execution.json',{'preserve':'old-subrun'})
        before={str(p):p.read_bytes() for p in self.folder.rglob('*.json')}
        def subplan(folder):
            return {'model_profile':runner.PROFILES[int(folder.name)-1],'host_profile':'windows-lightweight-v1','bindings':plan['bindings']['runtime']}
        sha=runner.standard.owned.sha256_file(self.folder/'plan.json')
        with patch.object(runner,'registry',return_value=self.config),patch.object(runner,'inventory',return_value=[]), \
                patch.object(runner,'bindings',return_value=plan['bindings']),patch.object(runner.standard,'run_folder',side_effect=lambda x:folders[x]), \
                patch.object(runner.standard,'load_plan',side_effect=subplan):
            with self.assertRaises(runner.AttemptedBundle):runner.load_bundle(self.folder,sha)
            self.assertEqual(runner.load_bundle(self.folder,sha,template=True),plan)
        self.assertEqual(before,{str(p):p.read_bytes() for p in self.folder.rglob('*.json')})

    def test_restart_rederives_exact_protocol_with_fresh_ids_and_preserved_lineage(self):
        old=self.plan()|{'schema_version':'model-blocker-bundle-v1','host_profile':'windows-lightweight-v1','scope':'fixed','remaining_from':'c'*32}
        fresh=copy.deepcopy(old);fresh['created_at']='new-time'
        target=self.folder/'fresh';target.mkdir()
        model={'created_at':'new-time','sampling':{'seed':42},'host_limits':{'rss':123},'precision':'bfloat16'}
        with patch.object(runner,'load_bundle',side_effect=[old,fresh,fresh]) as load, \
                patch.object(runner,'plan_bundle',return_value={'run_id':'b'*32,'plan_sha256':'b'*64}) as prepare, \
                patch.object(runner,'folder_for',return_value=target),patch.object(runner.standard,'run_folder',return_value=self.folder), \
                patch.object(runner.standard,'load_plan',side_effect=[model|{'created_at':'old-time'},model]*2),patch('sys.stdout',io.StringIO()):
            directory,sha=runner.restart_bundle(self.folder,'a'*64)
        self.assertEqual(directory,target)
        prepare.assert_called_once_with('c'*32)
        saved=json.loads((target/'plan.json').read_text())
        self.assertEqual(saved['restart_of'],{'run_id':self.folder.name,'plan_sha256':'a'*64})
        self.assertEqual(sha,runner.standard.owned.sha256_file(target/'plan.json'))
        self.assertTrue(load.call_args_list[0].kwargs['template'])

    def test_restart_protocol_substitution_never_executes_a_model(self):
        old=self.plan()|{'schema_version':'model-blocker-bundle-v1','host_profile':'windows-lightweight-v1','scope':'fixed'}
        target=self.folder/'fresh';target.mkdir()
        with patch.object(runner,'load_bundle',side_effect=[old,copy.deepcopy(old)]), \
                patch.object(runner,'plan_bundle',return_value={'run_id':'b'*32,'plan_sha256':'b'*64}), \
                patch.object(runner,'folder_for',return_value=target),patch.object(runner.standard,'run_folder',return_value=self.folder), \
                patch.object(runner.standard,'load_plan',side_effect=[{'seed':42},{'seed':43}]), \
                patch.object(runner.standard,'execute') as execute,self.assertRaises(ValueError):
            runner.restart_bundle(self.folder,'a'*64)
        execute.assert_not_called()

    def test_cli_explicit_restart_is_one_shot_and_busy_or_reentry_diagnostics_are_safe(self):
        argv=['--run','--approved-run','a'*32,'--plan-sha256','b'*64]
        with patch.object(runner,'folder_for',return_value=self.folder),patch.object(runner,'slot',side_effect=lambda k:nullcontext()), \
                patch.object(runner,'restart_bundle',return_value=(self.folder,'c'*64)) as restart, \
                patch.object(runner,'execute_bundle',return_value=1) as execute:
            self.assertEqual(runner.main(argv+['--restart']),1)
        restart.assert_called_once();execute.assert_called_once_with(self.folder,'c'*64)
        for error,reason in ((runner.AttemptedBundle('private-secret'),'bundle-already-attempted'),
                (runner.QualificationBusy('private-secret'),'standard-test-still-running'),
                (ValueError('private-secret'),'source-plan-or-evidence-changed')):
            output=io.StringIO()
            with patch.object(runner,'folder_for',return_value=self.folder),patch.object(runner,'slot',side_effect=lambda k:nullcontext()), \
                    patch.object(runner,'execute_bundle',side_effect=error),patch('sys.stdout',output):
                self.assertEqual(runner.main(argv),1)
            self.assertEqual(json.loads(output.getvalue())['reason_code'],reason)
            self.assertNotIn('private-secret',output.getvalue())
            if isinstance(error,ValueError) and not isinstance(error,(runner.AttemptedBundle,runner.QualificationBusy)):
                log=json.loads(output.getvalue())['failure_log']
                self.assertEqual(log['stage'],'operator-admission')
                self.assertTrue(any(f['function']=='main' for f in log['source_frames']))

    def test_busy_slot_refuses_before_cloning_or_starting_any_worker(self):
        with patch.object(runner,'folder_for',return_value=self.folder),patch.object(runner,'slot',side_effect=runner.QualificationBusy()), \
                patch.object(runner,'restart_bundle') as restart,patch.object(runner,'execute_bundle') as execute,patch('sys.stdout',io.StringIO()):
            self.assertEqual(runner.main(['--run','--restart','--approved-run','a'*32,'--plan-sha256','b'*64]),1)
        restart.assert_not_called();execute.assert_not_called()


class RawResultReplayTests(unittest.TestCase):
    def archived_bundle(self):
        bundle = self.folder/'archive';bundle.mkdir()
        source = self.plan['bindings']['source']
        self.plan['bindings'] = {'source':source}
        # Existing exact fixture model bytes/rows form a fully indexed archive.
        plan = {'bindings':{'runtime':self.plan['bindings']},'profiles':[
            {'profile':p,'run_id':self.entry['run_id'],'plan_sha256':self.entry['plan_sha256']} for p in runner.PROFILES]}
        runner.save(bundle,'plan.json',plan)
        runner.save(bundle,'summary.json',{'status':'evidence-collected-review-required'})
        runner.save(bundle,'coverage.json',{});runner.save(bundle,'execution.json',{})
        runner.save(bundle,'evidence-index.json',{'files':{n:runner.standard.owned.sha256_file(bundle/n)
            for n in ('plan.json','summary.json','coverage.json','execution.json')}})
        assessment={'bundle_id':'b'*32,'source_identity':source,
            'bundle_index_sha256':runner.standard.owned.sha256_file(bundle/'evidence-index.json'),
            'plan_sha256':runner.standard.owned.sha256_file(bundle/'plan.json'),
            'summary_sha256':runner.standard.owned.sha256_file(bundle/'summary.json'),
            'profiles':[{'profile':'qwen05-float32','run_id':self.entry['run_id'],'plan_sha256':self.entry['plan_sha256'],
                         'report_sha256':runner.standard.owned.sha256_file(self.folder/'report.json'),
                         'evidence_index_sha256':runner.standard.owned.sha256_file(self.folder/'evidence-index.json')}]}
        return bundle, assessment

    def test_remaining_selection_replays_past_passes_without_transferring_them(self):
        passed_row=next(r for r in self.report['measurements'] if r['directory']=='cpu-unchecked-1-candidate')
        passed_file=self.folder/passed_row['directory']/'cohort.json'
        passed_value=json.loads(passed_file.read_text())
        for phase in ('first','warm'):
            case=passed_value['phases'][phase]['cases'][0]
            case.update(correct=False,predicted_label='support')
            passed_value['phases'][phase]['correct']=22
        runner.save(passed_file.parent,'cohort.json',passed_value)
        passed_row['measurement_sha256']=runner.standard.owned.sha256_file(passed_file)
        # One candidate failed completely; all other candidates meet22 + budgets.
        row=next(r for r in self.report['measurements'] if r['directory']=='cpu-constrained-1-candidate')
        file=self.folder/row['directory']/'cohort.json'
        value=json.loads(file.read_text());value.update(status='denied-memory',phases={})
        runner.save(file.parent,'cohort.json',value)
        row.update(status='denied-memory',measurement_sha256=runner.standard.owned.sha256_file(file))
        self.publish();bundle, assessment=self.archived_bundle()
        original_read=runner.read
        def read(path, maximum=8*1024**2):
            return assessment if Path(path).name=='model-blocker-evidence-assessment.json' else original_read(path,maximum)
        with patch.object(runner,'read',side_effect=read),patch.object(runner,'folder_for',return_value=bundle), \
             patch.object(runner.standard,'run_folder',return_value=self.folder):
            selection=runner.remaining_selection('b'*32,'qwen05-float32')
            self.assertEqual(selection['selected_cohorts'],['cpu-constrained-1-candidate'])
            self.assertEqual(len(selection['previously_accepted_cohorts']),11)
            self.assertIn('cpu-unchecked-1-candidate',selection['previously_accepted_cohorts'])
            self.assertFalse(any('baseline' in n for n in selection['selected_cohorts']))
            self.assertNotIn('qualification_complete',selection)
            with self.assertRaises(ValueError):runner.remaining_selection('c'*32,'qwen05-float32')
            runner.save(file.parent,'cohort.json',{'forged':'passed'})
            with self.assertRaises(ValueError):runner.remaining_selection('b'*32,'qwen05-float32')

    def test_remaining_plan_cli_is_separate_from_execution_and_keeps_exact_reference(self):
        with patch.object(runner,'plan_bundle') as plan,patch('sys.stdout',io.StringIO()):
            self.assertEqual(runner.main(['--plan-only','--remaining-from','b'*32]),0)
        plan.assert_called_once_with('b'*32)
        with patch.object(runner,'execute_bundle') as execute,patch('sys.stderr',io.StringIO()),self.assertRaises(SystemExit):
            runner.main(['--run','--remaining-from','b'*32,'--approved-run','a'*32,'--plan-sha256','1'*64])
        execute.assert_not_called()

    def setUp(self):
        temp=tempfile.TemporaryDirectory(dir=runner.ROOT/'.local-codex');self.addCleanup(temp.cleanup)
        self.folder=Path(temp.name)
        sibling=MODULE.parent/'tests/test_standard_generation_qualification.py'
        spec=importlib.util.spec_from_file_location('blocker_replay_fixture',sibling)
        fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)
        self.plan=fixtures.fixture();limits=runner.standard.host_limits('qwen05-float32','windows-lightweight-v1')
        self.plan.update(schema_version='standard-generation-protocol-v2',host_profile='windows-lightweight-v1',host_limits=limits,
            cooperative_stop_seconds_by_device=limits['cooperative_stop_seconds_by_device'],devices=['cpu','cuda'])
        runner.save(self.folder,'plan.json',self.plan);runner.save(self.folder,'execution.json',{'attempted':True})
        sha=runner.standard.owned.sha256_file(self.folder/'plan.json')
        rows=[]
        for device in ('cpu','cuda'):
          for mode in runner.standard.MODES:
            for replicate in (1,2,3):
              for variant in runner.standard.VARIANTS:
                value=fixtures.measurement(self.plan,variant,seconds=40 if variant=='baseline' else 20)
                value.update(device=device,mode=mode,replicate=replicate,plan_sha256=sha)
                if device=='cpu':
                    value['actual_tensor_devices']=['cpu']
                    for k in ('runtime_allocated_vram_floor_bytes','runtime_reserved_vram_floor_bytes','remaining_allocated_vram_bytes',
                              'remaining_reserved_vram_bytes','peak_allocated_vram_bytes','peak_reserved_vram_bytes'):value[k]=0
                name=f'{device}-{mode}-{replicate}-{variant}';folder=self.folder/name;folder.mkdir()
                runner.save(folder,'cohort.json',value)
                rows.append({'device':device,'mode':mode,'replicate':replicate,'variant':variant,'directory':name,'status':'measured',
                    'source_stable':True,'launcher_delivery_seconds':value['whole_delivery_seconds']+1,
                    'observation':{'physical_exit_code':0,'peak_rss_bytes':1024**3},
                    'measurement_sha256':runner.standard.owned.sha256_file(folder/'cohort.json')})
        hydrated=runner.standard.read_measurements(self.folder,rows)
        comparisons=[runner.standard.assess_pairs([r for r in hydrated if r['device']==d and r['mode']==m],self.plan,d,m)
                     for d in self.plan['devices'] for m in runner.standard.MODES]
        self.report={'bindings':self.plan['bindings'],'plan_sha256':sha,'source_stable':True,'measurements':rows,
            'comparisons':comparisons,'qualification_complete':True,'status':'qualified-fixed-task-profile'}
        self.entry={'profile':'qwen05-float32','run_id':'a'*32,'plan_sha256':sha}
        self.publish()

    def publish(self):
        runner.save(self.folder,'report.json',self.report)
        names=['plan.json','execution.json','report.json']+[r['directory']+'/cohort.json' for r in self.report['measurements']]
        runner.save(self.folder,'evidence-index.json',{'files':{n:runner.standard.owned.sha256_file(self.folder/n) for n in names}})

    def inspect(self):
        with patch.object(runner.standard,'run_folder',return_value=self.folder),patch.object(runner.standard,'load_plan',return_value=self.plan):
            return runner.inspect_result(self.entry)

    def test_all_raw_cases_and_budgets_are_replayed_without_weight_loading(self):
        result=self.inspect()
        self.assertEqual(len(result['cohorts']),24);self.assertTrue(result['safe_for_successor'])
        self.assertTrue(all(c['host_budget_met'] for c in result['cohorts']))
        self.assertEqual(result['host_limits']['intended_use'],'reviewed-proposals-only')
        self.assertEqual(result['protocol_version'],'standard-generation-protocol-v2')
        self.assertFalse(result['historical_protocol_qualified'])
        self.assertNotIn('legacy_profile_qualified',result)
        self.assertNotIn('parent_qualified',result)

    def test_forged_qualification_unknown_cleanup_native_failure_or_hash_cannot_pass(self):
        pristine=copy.deepcopy(self.report)
        for kind in ('qualification','cleanup','native','hash'):
            self.report=copy.deepcopy(pristine)
            if kind=='qualification':self.report['qualification_complete']=False
            if kind=='native':self.report['measurements'][0]['observation']['physical_exit_code']=7
            if kind=='cleanup':
                path=self.folder/self.report['measurements'][0]['directory']/'cohort.json'
                value=json.loads(path.read_text());value['cleanup_passed']=False;runner.save(path.parent,'cohort.json',value)
                self.report['measurements'][0]['measurement_sha256']=runner.standard.owned.sha256_file(path)
            self.publish()
            if kind=='hash':runner.save(self.folder,'report.json',{'substituted':True})
            with self.subTest(kind=kind),self.assertRaises((ValueError,KeyError)):self.inspect()
            if kind=='cleanup':
                value['cleanup_passed']=True;runner.save(path.parent,'cohort.json',value)


if __name__=='__main__':unittest.main()
