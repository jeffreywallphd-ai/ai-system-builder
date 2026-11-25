"""Real canonical ancestry and optional read-only report/admission boundaries."""
import copy
import json
import unittest
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
from datetime import timedelta

import test_control_plane_story_view as stories
import test_control_plane_usage as counters
import test_control_plane_activity as spans
import test_control_plane_local_usage as local_fixtures
from control_plane import planning_scopes, usage, usage_activity as activity, usage_local, usage_phases, usage_scopes
from control_plane.common import digest
from control_plane import catalog
from control_plane.projection import project, review_content, bound_review_projection, encode_review_projection, REVIEW_MAX_BYTES, _planning_copy
from control_plane.user_presentation import user_project


class ScopedMetricTests(unittest.TestCase):
    new_journey = stories.StoryViewTests.new_journey

    def setUp(self):
        self.journey=self.new_journey();self.root=self.journey.root
        usage.enable(self.root);usage_scopes.enable(self.root)
        self.repository=usage_local._repository(self.root)[0];self.serial=0

    def add(self, level='story', *, foreign=False, stale=False, phase='pre_review', amount=100, duration=800):
        state=self.journey.engine.state;increment=state['increments'][0]
        story=increment['workPackages'][0] if level=='story' else None
        definition=planning_scopes.definition(self.repository,state,increment if level!='roadmap' else None,story)
        if foreign:definition['repository_ref']='f'*64
        if stale:definition['ancestry_digest']='e'*64
        self.serial+=1;name='fixture-'+str(self.serial);agent=usage.digest(['synthetic-host','synthetic-run',name])
        context={'definition':definition,'assignment_ref':'3'*64 if story else None,'tasks_ref':'4'*64 if story else None,
                 'approval_ref':state['roadmapApproval']['fingerprint'],'valid':True}
        with patch.object(usage_scopes,'marker_now',return_value=spans.T0):
            usage_phases.transition(self.root,work_ref='b'*64,candidate_ref='c'*64,marker_id=usage.digest(name),
                operation='correction-resume' if phase=='review_fixes' else 'associate',review_ref='a'*64 if phase=='review_fixes' else None,
                targets=[{'agent':agent,'source_ref':'d'*64,'fence':0}],planning_context=context)
        live=usage._load(self.root)['phase_contexts'][agent]
        events=[]
        for n in (0,1):
            value=counters.UsageTests.event(self,agent_id=name,sequence=n)
            value['counts']['input_tokens']['value']=amount
            value['attribution']={'work_ref':live['work_ref'],'context_ref':live['ref'],'source_ref':'d'*64,'position':n+1}
            events.append(value)
        usage.import_observations(self.root,{'schema_version':usage.IMPORT_V2,'events':events},at=counters.AT)
        event={'producer_ref':'6'*64,'agent_ref':agent,'session_ref':'7'*64,'sequence':0,
               'started_at':spans.stamp(1000),'ended_at':spans.stamp(2000),'scope':'own','purpose':'implementation',
               'measurement':'estimated','duration_ms':duration,'clock_ref':None,'monotonic_start_ms':None,'monotonic_end_ms':None,
               'attribution':{'work_ref':live['work_ref'],'context_ref':live['ref']}}
        activity.import_observations(self.root,{'schema_version':activity.IMPORT_SCHEMA,'events':[event]},at=spans.stamp(10000))

    def configure_destination(self,destination,*,workspace=None):
        config={'schema_version':'local-token-capture-v1','workspace_id':workspace or self.repository,
                'destination':str(destination),'threads':[{'thread_id':local_fixtures.PARENT,'parent_id':None,
                'source_id':'a'*64,'counter_epoch':'fixture-first','minimum_offset':0,'purpose':'implementation','purpose_basis':'declared'}]}
        path=self.root/usage_local.CONFIG;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(config),encoding='utf-8');return path

    def linked_destination(self):
        container=tempfile.TemporaryDirectory(prefix='metrics-linked-',dir=self.root.parent);self.addCleanup(container.cleanup)
        destination=Path(container.name)/'store'
        result=subprocess.run(['git','worktree','add','--detach',str(destination)],cwd=self.root,capture_output=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        return destination

    def test_real_linked_destination_reports_canonical_store_without_session_reads_or_work_reroute(self):
        self.add();self.journey.work.start(self.journey.spec,'owning-author')
        destination=self.linked_destination();owner=self.root
        self.root=destination
        try:usage.enable(destination);usage_scopes.enable(destination);self.add(amount=300,duration=600)
        finally:self.root=owner
        config=self.configure_destination(destination)
        record=self.journey.work.records.path
        before={path:path.read_bytes() for path in (record,config,owner/usage.BASE/'state.json',destination/usage.BASE/'state.json')}
        with patch.object(usage_local,'_source_path',side_effect=AssertionError('Session reads forbidden')), \
             patch.object(usage_local,'_read_source',side_effect=AssertionError('Session reads forbidden')), \
             patch.object(usage_local,'poll',side_effect=AssertionError('Capture forbidden')):
            self.assertEqual(usage.report_summary(owner)['known_own_subtotal']['measured']['input_tokens'],600)
            self.assertEqual(usage_scopes.report_summary(owner)['scopes'][0]['own_usage']['measured']['input_tokens'],300)
            self.assertEqual(activity.report_summary(owner)['own_time']['estimated_ms'],600)
            value=self.view()
        self.assertEqual(value['token_usage']['known_own_subtotal']['measured']['input_tokens'],600)
        self.assertEqual(value['roadmaps'][0]['scoped_metrics']['phases']['pre_review']['tokens']['measured']['input_tokens'],300)
        self.assertEqual(value['roadmaps'][0]['scoped_metrics']['phases']['pre_review']['time']['estimated_ms'],600)
        self.assertEqual(usage.summary(owner)['known_own_subtotal']['measured']['input_tokens'],200)
        self.assertFalse((destination/record.relative_to(owner)).exists())
        for path,raw in before.items():self.assertEqual(path.read_bytes(),raw,str(path))
        for operation in ('summary','scope-summary','activity-summary'):
            result=subprocess.run([sys.executable,str(counters.HELPERS/'development_control_plane.py'),'--repo',str(owner),
                                   'usage',operation],capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertNotIn('Session reads forbidden',result.stdout)
        for path,raw in before.items():self.assertEqual(path.read_bytes(),raw,str(path))

    def test_reporting_destination_does_not_change_explicit_writer_target_or_acknowledgement(self):
        self.add();destination=self.linked_destination();owner=self.root
        self.root=destination
        try:usage.enable(destination);usage_scopes.enable(destination);self.add(amount=300,duration=600)
        finally:self.root=owner
        self.configure_destination(destination);before=(destination/usage.BASE/'state.json').read_bytes()
        self.assertEqual(usage.enable(owner)['known_own_subtotal']['measured']['input_tokens'],200)
        event=counters.UsageTests.event(self,agent_id='explicit-local-import')
        event['counts']['input_tokens']['value']=50
        result=usage.import_observations(owner,{'schema_version':usage.IMPORT_SCHEMA,'events':[event]},at=counters.AT)
        self.assertEqual(result['summary']['known_own_subtotal']['measured']['input_tokens'],250)
        self.assertEqual(usage.report_summary(owner)['known_own_subtotal']['measured']['input_tokens'],600)
        self.assertEqual((destination/usage.BASE/'state.json').read_bytes(),before)

    def test_missing_foreign_or_malformed_destination_is_unavailable_without_stale_local_fallback(self):
        self.add();container=tempfile.TemporaryDirectory(prefix='metrics-foreign-',dir=self.root.parent);self.addCleanup(container.cleanup)
        foreign=Path(container.name)
        self.assertEqual(subprocess.run(['git','init','-q'],cwd=foreign,capture_output=True).returncode,0)
        store=self.root/usage.BASE/'state.json';before=store.read_bytes()
        for destination in (foreign,self.root/'missing-destination',Path('relative-destination')):
            self.configure_destination(destination)
            self.assertEqual(usage.report_summary(self.root)['status'],'unavailable')
            self.assertEqual(usage_scopes.report_summary(self.root)['status'],'unavailable')
            self.assertEqual(activity.report_summary(self.root)['status'],'unavailable')
            value=self.view();self.assertEqual(len(value['roadmaps']),1)
            self.assertEqual(value['token_usage']['status'],'unavailable')
            self.assertNotIn('scoped_metrics',value['roadmaps'][0])
            self.assertEqual(store.read_bytes(),before)
        path=self.configure_destination(self.root);path.write_text('{}',encoding='utf-8')
        self.assertEqual(usage.report_summary(self.root)['status'],'unavailable')
        self.assertEqual(store.read_bytes(),before)

    def test_destination_git_timeout_remains_optional_and_does_not_break_canonical_projection(self):
        self.add();self.configure_destination(self.root)
        with patch.object(usage_local,'_repository',side_effect=subprocess.TimeoutExpired('git',1)):
            self.assertEqual(usage.report_summary(self.root)['status'],'unavailable')
            self.assertEqual(usage_scopes.report_summary(self.root)['status'],'unavailable')
            self.assertEqual(activity.report_summary(self.root)['status'],'unavailable')
            value=self.view()
        self.assertEqual(len(value['roadmaps']),1)
        self.assertEqual(value['token_usage']['status'],'unavailable')

    def test_valid_destination_without_a_store_is_disabled_and_never_falls_back_or_creates_one(self):
        self.add();destination=self.linked_destination();self.configure_destination(destination)
        self.assertEqual(usage.report_summary(self.root)['status'],'disabled')
        self.assertEqual(usage_scopes.report_summary(self.root)['status'],'disabled')
        self.assertEqual(activity.report_summary(self.root)['status'],'disabled')
        self.assertFalse((destination/'.local-codex').exists())
        value=self.view();self.assertEqual(value['token_usage']['status'],'disabled')
        self.assertEqual(len(value['roadmaps']),1)
        self.assertNotIn('scoped_metrics',value['roadmaps'][0])

    def view(self, **options):return project(self.root,**options)

    def test_story_increment_and_roadmap_fold_exclusive_leaves_once_and_direct_is_included_subset(self):
        for level in ('story','increment','roadmap'):self.add(level)
        value=self.view();parent=value['roadmaps'][0];increment=parent['increments'][0];story=increment['stories'][0]
        for node,tokens,milliseconds in ((story,100,800),(increment,200,1600),(parent,300,2400)):
            row=node['scoped_metrics']['phases']['pre_review']
            self.assertEqual(row['tokens']['measured']['input_tokens'],tokens)
            self.assertEqual(row['time']['estimated_ms'],milliseconds)
            self.assertIsNone(row['time']['measured_ms'])
            self.assertEqual(node['scoped_metrics']['direct_scope']['tokens']['measured']['input_tokens'],100)
        self.assertNotIn('scoped_metrics',increment['stories'][1])
        self.assertEqual(value['planning_metrics']['repository_unattributed']['tokens']['measured']['input_tokens'],300)
        self.assertEqual(value['planning_metrics']['all_scoped_usage']['tokens']['measured']['input_tokens'],300)
        self.assertNotIn('_planning_',json.dumps(value))

    def test_review_fixes_never_enter_initial_implementation_and_cache_remains_subset(self):
        self.add();self.add(phase='review_fixes')
        report=self.view()['roadmaps'][0]['scoped_metrics']
        self.assertEqual(report['phases']['pre_review']['tokens']['measured']['input_tokens'],100)
        self.assertEqual(report['phases']['review_fixes']['tokens']['measured']['input_tokens'],100)
        self.assertEqual(report['all_purposes']['tokens']['measured']['input_tokens'],200)
        self.assertEqual(report['all_purposes']['tokens']['measured']['cached_input_tokens'],20)

    def test_foreign_or_changed_ancestry_never_reparents_old_usage(self):
        for change in ({'foreign':True},{'stale':True}):self.add(**change)
        value=self.view();self.assertNotIn('scoped_metrics',value['roadmaps'][0])
        self.assertEqual(value['planning_metrics']['all_scoped_usage']['tokens']['measured']['input_tokens'],200)
        self.assertEqual(value['planning_metrics']['repository_unattributed']['tokens']['measured']['input_tokens'],200)

    def test_user_copy_and_paging_preserve_exact_metrics_and_work_joins(self):
        self.add()
        full=self.view();paged=user_project(self.root,page={'view':'roadmaps','page':1})
        self.assertEqual(full['roadmaps'][0]['scoped_metrics'],paged['roadmaps'][0]['scoped_metrics'])
        self.assertEqual(paged['pagination']['total_records'],1)
        work=self.view(compact_work_items=True,page={'view':'work_items','page':1})
        self.assertNotIn('_planning_',json.dumps(work))
        self.assertEqual(work['pagination']['total_records'],2)
        self.assertTrue(all('scoped_metrics' not in parent for parent in work['work_item_roadmaps']))

    def test_reads_leave_store_bytes_unchanged_and_missing_optional_module_or_bad_store_keeps_canonical_rows(self):
        self.add();path=self.root/usage.BASE/'state.json';before=path.read_bytes();value=self.view()
        self.assertEqual(path.read_bytes(),before)
        with patch('control_plane.planning_metrics.attach',side_effect=ImportError('inert unavailable reader')):
            failed=self.view()
        self.assertEqual(failed['planning_metrics']['status'],'unavailable')
        self.assertEqual(failed['roadmaps'][0]['increments'][0]['chunks'],value['roadmaps'][0]['increments'][0]['chunks'])
        self.assertNotIn('_planning_',json.dumps(failed))
        path.write_text('{}',encoding='utf-8');bad=self.view()
        self.assertEqual(bad['token_usage']['status'],'unavailable')
        self.assertEqual(len(bad['roadmaps']),1)

    def test_v2_readers_keep_original_wire_without_scope_fields_or_guesses(self):
        legacy=self.root/'legacy';legacy.mkdir();usage.enable(legacy)
        value=project(legacy)
        self.assertNotIn('planning_metrics',value)
        self.assertNotIn('scoped_reporting',value['token_usage'])
        self.assertNotIn('_planning_',json.dumps(value))

    def test_legacy_package_shapes_do_not_turn_optional_metrics_into_record_errors(self):
        state=copy.deepcopy(self.journey.engine.state);state.pop('storyTaskTracking');state['history'].pop()
        state['increments'][0]['workPackages']=None
        path=self.root/state['paths']['state'];path.write_text(json.dumps(state),encoding='utf-8')
        value=self.view()
        self.assertEqual(len(value['roadmaps']),1)
        self.assertNotIn('scoped_metrics',value['roadmaps'][0])
        self.assertFalse(any(row.get('code','').startswith('projection.roadmap') for row in value['diagnostics']))
        self.assertIn('actively_worked',value['roadmaps'][0]['increments'][0])

    def test_optional_only_overflow_preserves_every_canonical_row_and_input(self):
        self.add();value=self.view(page={'view':'roadmaps','page':1});before=copy.deepcopy(value)
        value['roadmaps'][0]['scoped_metrics']['extra']='x'*REVIEW_MAX_BYTES
        original=copy.deepcopy(value);bounded=bound_review_projection(value)
        self.assertEqual(value,original)
        self.assertEqual(bounded['planning_metrics']['status'],'omitted')
        self.assertEqual(bounded['pagination'],before['pagination'])
        self.assertEqual(bounded['roadmaps'][0]['increments'][0]['chunks'],before['roadmaps'][0]['increments'][0]['chunks'])
        self.assertNotIn('scoped_metrics',bounded['roadmaps'][0])
        self.assertIn({'code':'projection.optional-metrics-omitted'},bounded['diagnostics'])
        self.assertLessEqual(len(encode_review_projection(bounded)),REVIEW_MAX_BYTES)

    def test_malformed_optional_numeric_field_is_removed_without_hiding_canonical_failure(self):
        self.add();value=self.view();value['roadmaps'][0]['scoped_metrics']['bad']=float('nan')
        self.assertEqual(bound_review_projection(value)['planning_metrics']['status'],'omitted')
        value['roadmaps'][0]['objective']='x'*(REVIEW_MAX_BYTES+1)
        value['pagination']={'view':'roadmaps'}
        original=copy.deepcopy(value)
        with self.assertRaises(ValueError):bound_review_projection(value)
        self.assertEqual(value['roadmaps'][0]['objective'],original['roadmaps'][0]['objective'])

    def test_exact_canonical_byte_boundary_does_not_lose_rows_for_an_omission_note(self):
        self.add();value=_planning_copy(self.view(page={'view':'roadmaps','page':1}),omit=True)
        value.pop('planning_metrics');value['diagnostics']=[row for row in value['diagnostics'] if row['code']!='projection.optional-metrics-omitted']
        value['padding']='';base=bound_review_projection(value)
        value['padding']='x'*(REVIEW_MAX_BYTES-len(encode_review_projection(base)))
        canonical=bound_review_projection(value)
        self.assertEqual(len(encode_review_projection(canonical)),REVIEW_MAX_BYTES)
        value['planning_metrics']={'status':'enabled','oversized':'x'*10000}
        result=bound_review_projection(value)
        self.assertEqual(result['roadmaps'],canonical['roadmaps'])
        self.assertEqual(result['pagination'],canonical['pagination'])
        self.assertNotIn('planning_metrics',result)
        self.assertLessEqual(len(encode_review_projection(result)),REVIEW_MAX_BYTES)

    def test_optional_reports_do_not_evict_legacy_execution_records(self):
        self.add();value=self.view()
        rows=[{'id':'fixture-'+str(n),'source':'execution','title':'Useful execution','outcome':{'success':'x'*1000,'problem':'x'*1000}} for n in range(400)]
        value['work_items'].extend(rows);value['inventory'].update(execution_records_total=400,execution_records_shown=400,execution_records_truncated=False)
        value['planning_metrics']['oversized']='x'*REVIEW_MAX_BYTES
        result=bound_review_projection(value)
        self.assertEqual(sum(row.get('source')=='execution' for row in result['work_items']),400)
        self.assertFalse(result['inventory']['execution_records_truncated'])

    def test_review_content_optional_flag_cannot_change_initial_real_work_admission(self):
        self.journey.work.start(self.journey.spec,'boundary-author')
        flagged=usage.summary(self.root);plain={key:item for key,item in flagged.items() if key!='scoped_reporting'}
        def view(summary,maximum):
            with patch('control_plane.projection.usage_summary',return_value=summary), \
                 patch('control_plane.projection.REVIEW_MAX_BYTES',maximum):return review_content(self.root)
        low,high=4096,REVIEW_MAX_BYTES
        while low<high:
            middle=(low+high)//2
            if view(plain,middle)['inventory']['execution_records_shown']==1:high=middle
            else:low=middle+1
        baseline=view(plain,low);with_optional=view(flagged,low)
        self.assertEqual(baseline['inventory']['execution_records_shown'],1)
        self.assertEqual(with_optional['inventory'],baseline['inventory'])

    def test_optional_note_cannot_change_existing_final_execution_trimming(self):
        self.add();value=_planning_copy(self.view(),omit=True);value.pop('planning_metrics')
        value['token_usage'].pop('scoped_reporting');value['diagnostics']=[]
        chunks=[row for row in value['work_items'] if row.get('source')!='execution']
        executions=[{'id':identity,'source':'execution','created_at':date,'outcome':{'success':'x'*1000,'problem':'x'*1000}}
                    for identity,date in (('newest','2026-11-24'),('older','2026-11-23'))]
        value['work_items']=[*chunks,*executions];value['inventory'].update(execution_records_total=2,execution_records_shown=2,execution_records_truncated=False)
        value['padding']=''
        one=copy.deepcopy(value);one['work_items']=[*chunks,executions[0]]
        one['inventory'].update(execution_records_shown=1,execution_records_truncated=True)
        one['diagnostics']=[{'code':'projection.execution-records-truncated','total':2,'shown':1}]
        value['padding']='x'*(REVIEW_MAX_BYTES-len(encode_review_projection(bound_review_projection(one))))
        baseline=bound_review_projection(value)
        self.assertEqual(baseline['inventory']['execution_records_shown'],1)
        self.assertEqual(len(encode_review_projection(baseline)),REVIEW_MAX_BYTES)
        value['token_usage']['scoped_reporting']=True
        value['planning_metrics']={'status':'enabled','oversized':'x'*REVIEW_MAX_BYTES}
        optional=bound_review_projection(value)
        self.assertEqual(optional['inventory'],baseline['inventory'])
        self.assertEqual(optional['work_items'],baseline['work_items'])

    def test_explicit_feature_dom_check_runs_all_dom_cases_without_whole_controller_wrapper(self):
        root=counters.HELPERS.parents[1]
        result=catalog.plan(root,[],['scoped-roadmaps-view','scoped-metrics','story-task-view'],'fixture')
        selected={row['id']:row for row in result['selected']}
        self.assertEqual(set(selected),{'scoped-roadmaps-view','scoped-metrics','story-task-view'})
        self.assertIn('--test-skip-pattern=^contributor control plane passes focused behavioral qualification$',selected['scoped-roadmaps-view']['argv'])
        self.assertNotIn('--test-name-pattern',selected['scoped-roadmaps-view']['argv'])
        self.assertIn('test_control_plane_scoped_metrics.',selected['scoped-metrics']['argv'])

    def test_scoped_feature_and_exact_task_copy_do_not_duplicate_whole_controller(self):
        root=counters.HELPERS.parents[1]
        paths=[*catalog.SCOPED_METRICS_SCOPE,
               'docs/stories-tasks-control-plane-implementation-roadmap.md',
               'docs/operations/roadmap-user-task-descriptions.json']
        required=['scoped-metrics','story-task-view','story-task-bindings','roadmap','documentation','agent-support','architecture']
        result=catalog.plan(root,paths,required,'fixture')
        selected={row['id']:row for row in result['selected']}
        self.assertNotIn('control-plane',selected)
        self.assertNotIn('focused-tests',selected)
        self.assertIn('--test-skip-pattern=^contributor control plane passes focused behavioral qualification$',selected['review-site']['argv'])
        self.assertNotIn('--test-name-pattern',selected['review-site']['argv'])

    def test_scoped_metadata_never_removes_explicit_generic_or_foreign_source_fallback(self):
        root=counters.HELPERS.parents[1]
        paths=[*catalog.SCOPED_METRICS_SCOPE,'docs/operations/roadmap-user-task-descriptions.json']
        base=['scoped-metrics','story-task-view','story-task-bindings','roadmap','documentation','agent-support','architecture']
        for extra,required in [([],[*base,'control-plane']),
                               (['dev-tools/helpers/control_plane/work.py'],base),
                               (['docs/another-plan-implementation-roadmap.md'],base)]:
            with self.subTest(extra=extra,required=required):
                result=catalog.plan(root,[*paths,*extra],required,'fixture')
                self.assertIn('control-plane',{row['id'] for row in result['selected']})
        available=catalog._automatic_files_available
        def missing_capture_support(check_root,check):
            if 'dev-tools/helpers/control_plane/usage_capture.py' in check.get('automatic_required_files',[]):
                return False
            return available(check_root,check)
        with patch.object(catalog,'_automatic_files_available',side_effect=missing_capture_support):
            result=catalog.plan(root,paths,base,'fixture')
        self.assertIn('control-plane',{row['id'] for row in result['selected']})

    def test_optional_build_uses_existing_byte_cap_and_never_publishes_partial_node_prefix(self):
        self.add();self.add('increment')
        baseline=self.view();maximum=len(encode_review_projection(_planning_copy(baseline,omit=True)))+512
        with patch('control_plane.projection.REVIEW_MAX_BYTES',maximum):
            content=self.view()
        self.assertEqual(content['planning_metrics']['status'],'omitted')
        self.assertTrue(all('scoped_metrics' not in node for node in [content['roadmaps'][0],content['roadmaps'][0]['increments'][0],*content['roadmaps'][0]['increments'][0]['stories']]))

    def test_retained_trends_remain_seven_daily_eight_weekly_eight_quarterly_without_time_inference(self):
        self.add();state=usage._load(self.root);agent,context=next(iter(state['phase_contexts'].items()))
        # A separate inert numeric stream exercises all retained period ranges.
        name='retention-fixture';agent=usage.digest(['synthetic-host','synthetic-run',name])
        definition=next(iter(state['scope_metrics']['definitions'].values()))
        with patch.object(usage_scopes,'marker_now',return_value=spans.T0):
            usage_phases.transition(self.root,work_ref='b'*64,candidate_ref='c'*64,marker_id='9'*64,operation='associate',
                targets=[{'agent':agent,'source_ref':'d'*64,'fence':0}],planning_context={'definition':definition,
                'assignment_ref':'3'*64,'tasks_ref':'4'*64,'approval_ref':'5'*64,'valid':True})
        context=usage._load(self.root)['phase_contexts'][agent];end=usage._time(counters.AT)
        dates={end-timedelta(days=n) for n in range(400)}|{end-timedelta(days=end.weekday(),weeks=n) for n in range(156)}
        quarter=end.year*4+(end.month-1)//3
        dates|={end.replace(year=(quarter-n)//4,month=((quarter-n)%4)*3+1,day=1) for n in range(40)}
        events=[]
        for n,date in enumerate(sorted(dates)):
            stamp=date.strftime('%Y-%m-%dT%H:%M:%SZ');row=counters.UsageTests.event(self,agent_id=name,sequence=n,started_at=stamp,ended_at=stamp)
            row['attribution']={'work_ref':context['work_ref'],'context_ref':context['ref'],'source_ref':'d'*64,'position':n+1};events.append(row)
        for start in range(0,len(events),64):usage.import_observations(self.root,{'schema_version':usage.IMPORT_V2,'events':events[start:start+64]},at=counters.AT)
        value=self.view();trends=value['roadmaps'][0]['scoped_metrics']['trends']
        self.assertEqual({period:len(rows) for period,rows in trends.items()},{'daily':7,'weekly':8,'quarterly':8})
        self.assertIsNone(trends['daily'][0]['implementation']['time']['estimated_ms'])
        self.assertEqual(usage._load(self.root)['retention'],usage.DEFAULT_RETENTION)


if __name__=='__main__':unittest.main()
