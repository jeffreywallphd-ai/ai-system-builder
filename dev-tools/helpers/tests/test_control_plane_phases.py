"""Causal phase/counter tests with inert numeric sources; no host/model calls."""
import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch
import test_control_plane_local_usage as fixture
import test_control_plane_usage as counters
from control_plane import usage, usage_local as local, usage_phases as phases
from control_plane.contracts import ControlError

PARENT, CHILD = fixture.PARENT, fixture.CHILD
T0,T1,T2,T3 = fixture.T0,fixture.T1,fixture.T2,fixture.T3
T4,T5 = '2026-11-24T10:04:00Z','2026-11-24T10:05:00Z'


class PhaseTests(unittest.TestCase):
    def setUp(self):
        fixture.LocalUsageTests.setUp(self)
        patch.object(local.os,'environ',{**local.os.environ,'CODEX_THREAD_ID':PARENT}).start()
        self.work = {'spec':{'work_id':'phase-work'},'spec_digest':'a'*64,'status':'active',
                     'baseline':{'source_digest':'b'*64},'receipts':[],'reviews':[]}
        self.records = {'work_items':{'phase-work':self.work}}

    def ready(self):
        self.write_line(PARENT,self.record());self.enable()
        config=json.loads((self.root/local.CONFIG).read_text(encoding='utf-8'))
        config['threads'][0].update(purpose='implementation',purpose_basis='declared')
        (self.root/local.CONFIG).write_text(json.dumps(config),encoding='utf-8')

    def mark(self,operation,marker='first',**extra):
        request={'schema_version':'usage-phase-command-v1','operation':operation,'work_id':'phase-work',
                 'marker_id':marker,'agents':[PARENT],**extra}
        with patch('control_plane.records.Records.load',return_value=self.records):
            return phases.command(self.root,request)

    def amount(self,phase):
        return usage.summary(self.root)['implementation_phases'][phase]['measured']['input_tokens']

    def two(self,first=110,last=150,at1=T1,at2=T2):
        self.write_line(PARENT,self.record(at=at1,counts=self.counts(first,20,10,5)))
        self.write_line(PARENT,self.record(at=at2,counts=self.counts(last,20,10,5)))
        return self.poll(T5)

    def test_first_after_source_fence_is_mixed_later_span_is_pre_review_same_timestamps(self):
        self.ready();self.assertEqual(self.mark('associate')['state'],'recorded')
        self.two(at1=T1,at2=T1)
        self.assertEqual(self.amount('mixed'),10);self.assertEqual(self.amount('pre_review'),40)
        self.assertEqual(self.measured()['input_tokens'],50)
        before=self.state();self.poll(T5);self.assertEqual(self.state(),before)

    def test_unbound_new_implementation_is_unknown_and_not_legacy_or_initial(self):
        self.ready();self.two()
        self.assertEqual(self.amount('unknown'),50)
        self.assertIsNone(self.amount('pre_review'));self.assertIsNone(self.amount('legacy_unknown'))

    def test_review_start_stops_initial_but_does_not_invent_fix_cause(self):
        self.ready();self.mark('associate');self.two()
        self.assertEqual(self.mark('review-start','review-one')['state'],'recorded')
        self.two(170,200,T3,T4)
        self.assertEqual(self.amount('pre_review'),40)
        self.assertEqual(self.amount('post_review_other'),30);self.assertIsNone(self.amount('review_fixes'))

    def test_real_changes_requested_requires_correction_resume_and_records_are_not_mutated(self):
        self.ready();self.mark('associate');self.two();self.mark('review-start','begin')
        self.work['reviews']=[{'review_digest':'c'*64,'disposition':'changes-requested'}]
        before=copy.deepcopy(self.records)
        result=self.mark('correction-resume','fix-round',review_ref='c'*64)
        self.assertEqual(result['state'],'recorded');self.assertEqual(self.records,before)
        self.two(170,200,T3,T4)
        self.assertEqual(self.amount('unknown'),20)  # multiple transitions before a response
        self.assertEqual(self.amount('review_fixes'),30);self.assertEqual(self.amount('pre_review'),40)

    def test_advisory_fix_has_explicit_source_and_finding_refs_without_fake_rejection(self):
        self.ready();self.mark('associate');self.two()
        missing=self.mark('correction-resume','bad-advisory',advisory_ref='d'*64,finding_refs=['finding-one'])
        self.assertEqual(missing['state'],'unavailable')
        result=self.mark('correction-resume','real-advisory',advisory_ref='d'*64,source_ref='b'*64,finding_refs=['finding-one'])
        self.assertEqual(result['state'],'recorded');self.assertEqual(self.work['reviews'],[])
        self.two(170,200,T3,T4);self.assertEqual(self.amount('review_fixes'),30)

    def test_new_work_resets_initial_but_correction_successor_inherits_fix_only_explicitly(self):
        self.ready();self.mark('associate');self.two();self.mark('review-start','begin')
        self.work['reviews']=[{'review_digest':'c'*64,'disposition':'changes-requested'}]
        self.mark('close','close')
        successor=copy.deepcopy(self.work);successor.update(spec={'work_id':'successor'},spec_digest='d'*64,reviews=[])
        self.records['work_items']['successor']=successor
        result=self.mark('associate','next',work_id='successor',correction_of='phase-work',review_ref='c'*64)
        self.assertEqual(result['state'],'recorded')
        self.two(170,200,T3,T4);self.assertEqual(self.amount('review_fixes'),30)
        streams=usage._load(self.root)['streams'];self.assertEqual(len(streams),1)
        self.assertEqual(next(iter(streams.values()))['sequence'],4)

    def test_new_feature_work_and_accepted_review_do_not_become_fixes(self):
        self.ready();self.mark('associate');self.two()
        self.work['reviews']=[{'review_digest':'c'*64,'disposition':'accepted'}]
        self.mark('review-decision','accepted',review_ref='c'*64)
        self.assertEqual(self.mark('correction-resume','not-a-fix',review_ref='c'*64)['state'],'unavailable')
        self.mark('close','done')
        added=copy.deepcopy(self.work);added.update(spec={'work_id':'added-scope'},spec_digest='d'*64,reviews=[])
        self.records['work_items']['added-scope']=added
        self.mark('associate','addition',work_id='added-scope')
        self.two(170,200,T3,T4)
        self.assertEqual(self.amount('pre_review'),70);self.assertIsNone(self.amount('review_fixes'))

    def test_conflicting_live_work_is_mixed_not_last_writer_pre_review(self):
        self.ready();self.mark('associate');self.two()
        other=copy.deepcopy(self.work);other.update(spec={'work_id':'parallel'},spec_digest='d'*64)
        self.records['work_items']['parallel']=other
        self.mark('associate','overlap',work_id='parallel');self.two(170,200,T3,T4)
        self.assertEqual(self.amount('mixed'),60);self.assertEqual(self.amount('pre_review'),40)

    def test_marker_between_capture_read_and_import_uses_live_locked_context(self):
        self.ready();self.mark('associate')
        self.write_line(PARENT,self.record(at=T1,counts=self.counts(110,20,10,5)))
        self.write_line(PARENT,self.record(at=T2,counts=self.counts(150,20,10,5)))
        actual=usage.import_observations;fired=[]
        def raced(root,manifest,**options):
            if not fired:
                fired.append(True);state=usage._load(root);agent,context=next(iter(state['phase_contexts'].items()))
                phases.transition(root,work_ref=context['work_ref'],candidate_ref='b'*64,marker_id='f'*64,operation='review-start',
                    targets=[{'agent':agent,'source_ref':context['source_ref'],'fence':self.paths[PARENT].stat().st_size}],expected={agent:context['ref']})
            return actual(root,manifest,**options)
        with patch.object(usage,'import_observations',side_effect=raced): self.poll(T5)
        self.assertEqual(self.measured()['input_tokens'],50);self.assertEqual(self.amount('unknown'),50)
        self.assertIsNone(self.amount('pre_review'))

    def test_idempotent_and_conflicting_markers_and_stale_expected_context(self):
        self.ready();result=self.mark('associate');self.assertEqual(result['state'],'recorded')
        before=self.state();self.assertTrue(self.mark('associate')['duplicate_marker']);self.assertEqual(self.state(),before)
        self.assertEqual(self.mark('review-start',marker='first')['state'],'unavailable');self.assertEqual(self.state(),before)
        self.assertEqual(self.mark('review-start','stale',expected_contexts={PARENT:None})['state'],'unavailable')

    def test_activity_is_orthogonal_and_reviewer_child_does_not_inherit_author_phase(self):
        self.ready();self.mark('associate',activity='tests');self.two()
        self.assertNotEqual(self.poll(T5)['state'],'unavailable')
        self.assertIsNone(self.amount('pre_review'))
        self.assertEqual(usage.summary(self.root)['purpose']['tests']['measured']['input_tokens'],50)
        self.mark('activity','code',activity='implementation');self.two(170,200,T3,T4)
        self.assertEqual(self.amount('pre_review'),30)

    def test_v1_summary_is_readonly_migration_preserves_totals_and_exact_latest_replay(self):
        root=self.root/'legacy';root.mkdir();usage.enable(root)
        event=counters.UsageTests.event(None)
        manifest={'schema_version':usage.IMPORT_SCHEMA,'events':[event]}
        usage.import_observations(root,manifest,at=counters.AT)
        path=root/usage.BASE/'state.json';state=json.loads(path.read_text(encoding='utf-8'))
        def legacy(groups):
            result={}
            for key,stats in groups.items():
                stats.pop('phase_basis');result['|'.join(key.split('|')[:3])]=stats
            return result
        state['totals']=legacy(state['totals']);state['older_quarters']=legacy(state['older_quarters'])
        for period in usage.DEFAULT_RETENTION:
            for stamp in state[period]:state[period][stamp]=legacy(state[period][stamp])
        for row in state['streams'].values():row['totals']=legacy(row['totals'])
        for row in state['recent']:row.pop('implementation_phase');row['stats'].pop('phase_basis')
        state.pop('phase_contexts');state.pop('phase_markers');state['schema_version']=usage.V1_SCHEMA
        state['state_digest']=usage.digest({key:value for key,value in state.items() if key!='state_digest'})
        path.write_bytes(usage._encoded(state));before=path.read_bytes()
        summary=usage.summary(root)
        self.assertEqual(summary['implementation_phases']['legacy_unknown']['measured']['input_tokens'],100)
        self.assertEqual(path.read_bytes(),before)
        self.assertEqual(usage.import_observations(root,manifest,at=counters.AT)['duplicates'],1)
        self.assertEqual(path.read_bytes(),before)
        event=copy.deepcopy(event);event['sequence']=1
        usage.import_observations(root,{'schema_version':usage.IMPORT_SCHEMA,'events':[event]},at=counters.AT)
        updated=usage.summary(root)
        self.assertEqual(updated['known_own_subtotal']['measured']['input_tokens'],200)
        self.assertEqual(updated['implementation_phases']['legacy_unknown']['measured']['input_tokens'],100)
        self.assertEqual(updated['implementation_phases']['unknown']['measured']['input_tokens'],100)
        self.assertEqual(json.loads(path.read_text())['schema_version'],usage.SCHEMA)

    def test_integrity_valid_malformed_v1_containers_and_stats_refuse_before_migration(self):
        usage.enable(self.root);path=self.root/usage.BASE/'state.json'
        def legacy():
            state=usage._empty(usage.DEFAULT_RETENTION)
            state.pop('phase_contexts');state.pop('phase_markers');state['schema_version']=usage.V1_SCHEMA
            return state
        malformed=[{'totals':[]},{'daily':[]},{'streams':[]},{'recent':[None]},
                   {'daily':{'2026-11-24':[]}},
                   {'totals':{'own|implementation|host-reported':[]}},
                   {'totals':{'own|implementation|host-reported':{'intervals':1}}}]
        for change in malformed:
            with self.subTest(change=change):
                state=legacy();state.update(change);state['state_digest']=usage.digest(state)
                path.write_bytes(usage._encoded(state));before=path.read_bytes()
                self.assertEqual(usage.summary(self.root)['status'],'unavailable')
                with self.assertRaises(ControlError):usage.enable(self.root)
                self.assertEqual(path.read_bytes(),before)

    def test_phase_counts_conserve_every_metric_period_and_agent_and_prune_with_history(self):
        self.ready();self.mark('associate');self.two()
        value=usage.summary(self.root)
        for owner in [value,*value['agents'],*[row for rows in value['trends'].values() for row in rows]]:
            groups=owner['implementation_phases']
            for metric in usage.METRICS:
                self.assertEqual(sum(row['measured'][metric] or 0 for row in groups.values()),value['purpose']['implementation']['measured'][metric])
        self.assertEqual(value['storage']['retention'],usage.DEFAULT_RETENTION)

    def test_invalid_payload_and_atomic_marker_failure_preserve_numeric_state_and_redact(self):
        self.ready();self.mark('associate');before=self.state()
        result=self.mark('later','private',prompt='private-payload')
        self.assertEqual(result['state'],'unavailable');self.assertNotIn('private-payload',json.dumps(result))
        with patch('control_plane.storage.os.replace',side_effect=OSError('private-path')): result=self.mark('review-start','io-failure')
        self.assertEqual(result['state'],'unavailable');self.assertEqual(self.state(),before)
        self.assertNotIn('private-path',json.dumps(result))

    def test_missing_boundary_poll_invalidates_phase_while_numeric_capture_continues(self):
        self.ready();self.mark('associate');self.two()
        with patch.object(local,'poll',return_value={'state':'unavailable','work_may_continue':True}):
            result=self.mark('review-start','missing-counter')
        self.assertEqual(result['state'],'recorded')
        self.two(170,200,T3,T4);self.assertEqual(self.amount('unknown'),50)
        self.assertEqual(self.amount('pre_review'),40);self.assertEqual(self.measured()['input_tokens'],100)

    def test_old_marker_after_bounded_ring_rotation_refuses_stale_context_without_recount(self):
        self.ready();self.mark('associate');self.two()
        with patch.object(phases,'MAX_MARKERS',2):
            for index in range(3):
                context=next(iter(usage._load(self.root)['phase_contexts'].values()))
                self.mark('activity','rotate-'+str(index),activity='implementation',expected_contexts={PARENT:context['ref']})
            state=usage._load(self.root);self.assertEqual(len(state['phase_markers']),2)
            before=self.state()
            result=self.mark('associate','first',expected_contexts={PARENT:None})
            self.assertEqual(result['reason_code'],'phase.stale-context');self.assertEqual(self.state(),before)
            result=self.mark('associate','first')
            self.assertEqual(result['reason_code'],'phase.expected-context-required');self.assertEqual(self.state(),before)

    def test_evicted_advisory_cannot_restore_fixes_and_opaque_status_refs_are_readonly(self):
        self.ready();self.mark('associate');self.two()
        original=next(iter(usage._load(self.root)['phase_contexts'].values()))['ref']
        with patch.object(phases,'MAX_MARKERS',2):
            self.mark('correction-resume','advisory',source_ref='b'*64,advisory_ref='d'*64,finding_refs=['one'],expected_contexts={PARENT:original})
            for operation,identifier in [('later','later'),('activity','activity')]:
                context=next(iter(usage._load(self.root)['phase_contexts'].values()))
                self.mark(operation,identifier,expected_contexts={PARENT:context['ref']})
            before=self.state();result=self.mark('correction-resume','advisory',source_ref='b'*64,advisory_ref='d'*64,finding_refs=['one'],expected_contexts={PARENT:original})
            self.assertEqual(result['reason_code'],'phase.stale-context');self.assertEqual(self.state(),before)
            result=phases.status(self.root)
            self.assertEqual(self.state(),before);self.assertNotIn(PARENT,json.dumps(result))

    def test_other_agent_rotation_between_command_read_and_lock_cannot_replay_advisory(self):
        self.ready()
        with patch.object(phases,'MAX_MARKERS',2):
            self.mark('associate')
            self.assertEqual(self.mark('correction-resume','old-advisory',advisory_ref='d'*64,
                source_ref='b'*64,finding_refs=['real-finding'])['state'],'recorded')
            agent,context=next(iter(usage._load(self.root)['phase_contexts'].items()))
            self.mark('later','later-current',expected_contexts={PARENT:context['ref']})
            prior=usage._load(self.root)['phase_contexts'][agent].copy();actual=phases.transition;fired=[]
            def raced(*args,**options):
                if not fired:
                    fired.append(True)
                    for index in range(2):
                        other='f'*64;live=usage._load(self.root)['phase_contexts'].get(other)
                        actual(self.root,work_ref='e'*64,candidate_ref='b'*64,marker_id=usage.digest(['other-marker',index]),
                            operation='associate',targets=[{'agent':other,'source_ref':'d'*64,'fence':0}],
                            expected={other:live['ref'] if live else None})
                return actual(*args,**options)
            with patch.object(phases,'transition',side_effect=raced):
                result=self.mark('correction-resume','old-advisory',advisory_ref='d'*64,
                    source_ref='b'*64,finding_refs=['real-finding'])
            self.assertTrue(fired);self.assertEqual(result['reason_code'],'phase.expected-context-required')
            self.assertEqual(usage._load(self.root)['phase_contexts'][agent],prior)

    def test_context_cap_refuses_and_closed_context_can_compact_without_changing_counts(self):
        self.ready();self.mark('associate');numeric=self.measured()
        with patch.object(phases,'MAX_CONTEXTS',1):
            agent='f'*64
            with self.assertRaises(ControlError): phases.transition(self.root,work_ref='a'*64,candidate_ref='b'*64,marker_id='c'*64,
                operation='associate',targets=[{'agent':agent,'source_ref':'d'*64,'fence':0}],expected={agent:None})
            self.assertEqual(self.measured(),numeric)
            self.mark('close','closed')
            phases.transition(self.root,work_ref='a'*64,candidate_ref='b'*64,marker_id='c'*64,operation='associate',
                targets=[{'agent':agent,'source_ref':'d'*64,'fence':0}],expected={agent:None})
            self.assertEqual(len(usage._load(self.root)['phase_contexts']),1);self.assertEqual(self.measured(),numeric)

    def test_checkout_work_identity_is_distinct_and_no_raw_identifiers_reach_state_or_summary(self):
        self.ready();self.mark('associate');self.two()
        first=phases.work_reference(self.root,self.work,'a'*64)
        second=phases.work_reference(self.root/'other-checkout',self.work,'a'*64)
        self.assertNotEqual(first,second)
        public=self.state().decode()+json.dumps(usage.summary(self.root))
        for forbidden in (PARENT,'phase-work','other-checkout','private-header-never-output'):
            self.assertNotIn(forbidden,public)

    def test_reviewer_activity_stays_review_and_parent_marker_does_not_bind_child(self):
        self.ready();self.source(CHILD,PARENT);self.write_line(CHILD,self.record(CHILD));self.enable(CHILD)
        config=json.loads((self.root/local.CONFIG).read_text(encoding='utf-8'))
        for row in config['threads']:
            if row['thread_id']==CHILD: row['purpose']='review';row['purpose_basis']='declared'
        (self.root/local.CONFIG).write_text(json.dumps(config),encoding='utf-8')
        self.mark('associate');self.two()
        self.write_line(CHILD,self.record(CHILD,T3,self.counts(150,30,20,8)));self.poll(T5)
        summary=usage.summary(self.root)
        self.assertEqual(summary['purpose']['review']['measured']['input_tokens'],50)
        self.assertEqual(self.amount('pre_review'),40)
        self.assertEqual(len(usage._load(self.root)['phase_contexts']),1)

    def test_invocation_labels_are_not_host_thread_associations(self):
        self.ready()
        with patch.object(local.os,'environ',{**local.os.environ,'CODEX_THREAD_ID':'author-invocation-label'}):
            result=self.mark('associate',agents=None)
        self.assertEqual(result['state'],'unavailable');self.assertEqual(usage._load(self.root)['phase_contexts'],{})

    def test_marker_capacity_failure_invalidates_clean_label_but_preserves_all_numeric_totals(self):
        self.ready();self.mark('associate');self.two();before=self.measured()
        with patch.object(usage,'MAX_BYTES',len(self.state())+1): result=self.mark('review-start','cap-failure')
        self.assertEqual(result['state'],'unavailable');self.assertTrue(result['attribution_invalidated'])
        self.assertEqual(self.measured(),before)
        self.two(170,200,T3,T4);self.assertEqual(self.amount('unknown'),50);self.assertEqual(self.amount('pre_review'),40)


for name in ('write_line','source','counts','record','enable','poll','state','measured'):
    setattr(PhaseTests,name,getattr(fixture.LocalUsageTests,name))

if __name__=='__main__': unittest.main()
