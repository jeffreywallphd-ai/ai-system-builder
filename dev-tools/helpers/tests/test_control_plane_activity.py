"""Closed numeric effort fixtures; no live host, timer, model or transcript."""
import copy
import json
import subprocess
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import test_control_plane_usage as counters
import test_control_plane_usage_scopes as fixture
from control_plane import usage, usage_activity as activity, usage_phases as phases, usage_scopes as scopes
from control_plane import usage_local as local
from control_plane.contracts import ControlError

T0 = '2026-11-24T12:00:00.000Z'


def stamp(milliseconds):
    return (scopes.marker_time(T0) + timedelta(milliseconds=milliseconds)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


class ActivityTests(unittest.TestCase):
    state = fixture.ScopedUsageTests.state
    mark = fixture.ScopedUsageTests.mark
    enable = fixture.ScopedUsageTests.enable

    def setUp(self):
        fixture.ScopedUsageTests.setUp(self)
        self.enable()
        with patch.object(scopes, 'marker_now', return_value=T0): self.mark()

    def event(self, sequence=0, start=0, end=1000, duration=800, **changes):
        context = self.state()['phase_contexts'][self.agent]
        value = {'producer_ref':'6'*64, 'agent_ref':self.agent, 'session_ref':'7'*64, 'sequence':sequence,
                 'started_at':stamp(start), 'ended_at':stamp(end), 'scope':'own', 'purpose':'implementation',
                 'measurement':'estimated', 'duration_ms':duration, 'clock_ref':None,
                 'monotonic_start_ms':None, 'monotonic_end_ms':None,
                 'attribution':{'work_ref':context['work_ref'], 'context_ref':context['ref']}}
        return {**value, **changes}

    def call(self, *events, **options):
        return activity.import_observations(self.root, {'schema_version':activity.IMPORT_SCHEMA, 'events':list(events)},
                                            at=options.pop('at', stamp(10000)), **options)

    def test_explicit_estimate_unknown_and_zero_are_distinct_and_tokens_never_change(self):
        raw = counters.UsageTests.event(self)
        usage.import_observations(self.root, {'schema_version':usage.IMPORT_SCHEMA,'events':[raw]}, at=counters.AT)
        before = self.state()
        self.call(self.event(), self.event(1,1000,2000,None,measurement='unavailable'), self.event(2,2000,2000,0))
        after = self.state()
        for key in before:
            if key not in {'revision','state_digest','scope_metrics'}: self.assertEqual(after[key],before[key],key)
        for key in ('definitions','tokens'): self.assertEqual(after['scope_metrics'][key],before['scope_metrics'][key])
        report = activity.summary(self.root)
        self.assertEqual(report['own_time']['estimated_ms'],800)
        self.assertIsNone(report['own_time']['measured_ms'])
        self.assertEqual(report['own_time']['unavailable_intervals'],1)
        self.assertFalse(report['live_capture'])
        self.assertEqual(report['implementation_phases']['pre_review']['estimated_ms'],800)
        self.assertEqual(report['repository_unattributed']['intervals'],0)

    def test_operator_claimed_measured_source_is_refused_and_genuine_clock_fixture_uses_private_seam(self):
        measured = self.event(measurement='measured',duration_ms=800,clock_ref='8'*64,
                              monotonic_start_ms=100,monotonic_end_ms=900)
        before = self.path.read_bytes()
        for source in (None, True, 'host-reported'):
            with self.assertRaisesRegex(ControlError,'qualified numeric host'): self.call(measured,_source=source)
            self.assertEqual(self.path.read_bytes(),before)
        # This is a real monotonic clock around inert local arithmetic, solely
        # an adapter-seam fixture. It grants no live Codex capture qualification.
        start = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
        mono_start = time.perf_counter_ns()//1_000_000
        sum(range(20000))
        mono_end = time.perf_counter_ns()//1_000_000
        end = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
        measured.update(started_at=start,ended_at=end,duration_ms=mono_end-mono_start,
                        monotonic_start_ms=mono_start,monotonic_end_ms=mono_end)
        self.call(measured,at=end,_source=activity._QUALIFIED_NUMERIC_HOST)
        self.assertEqual(activity.summary(self.root)['own_time']['measured_ms'],mono_end-mono_start)
        self.assertIsNone(activity.summary(self.root)['own_time']['estimated_ms'])

    def test_replay_and_old_sequence_do_not_recount_or_reclassify_after_marker_change(self):
        first,last=self.event(),self.event(1,1000,2000,900)
        self.call(first,last)
        with patch.object(scopes,'marker_now',return_value=stamp(2000)): self.mark('review-start','e')
        before=self.path.read_bytes()
        self.assertEqual(self.call(last)['duplicates'],1)
        self.assertEqual(self.call(first)['older_sequences_not_recounted'],1)
        self.assertEqual(self.path.read_bytes(),before)
        conflict=copy.deepcopy(last);conflict['duration_ms']=850
        with self.assertRaises(ControlError):self.call(conflict)
        self.assertEqual(self.path.read_bytes(),before)
        self.assertEqual(activity.summary(self.root)['implementation_phases']['pre_review']['estimated_ms'],1700)

    def test_own_agent_overlap_across_sessions_and_producers_is_refused_but_adjacent_is_valid(self):
        self.call(self.event())
        before=self.path.read_bytes()
        for changes in ({'session_ref':'8'*64},{'producer_ref':'9'*64,'session_ref':'8'*64}):
            with self.assertRaises(ControlError):self.call(self.event(start=500,end=1500,**changes))
            self.assertEqual(self.path.read_bytes(),before)
        self.call(self.event(start=1000,end=2000,session_ref='8'*64))
        self.assertEqual(activity.summary(self.root)['own_time']['estimated_ms'],1600)

    def test_parallel_agents_add_own_effort_while_inclusive_and_unknown_stay_separate(self):
        child=usage.digest(['synthetic-host','synthetic-run','child'])
        with patch.object(scopes,'marker_now',return_value=T0):self.mark(marker='e',agent=child)
        context=self.state()['phase_contexts'][child]
        other=self.event(agent_ref=child,attribution={'context_ref':context['ref'],'work_ref':context['work_ref']})
        self.call(self.event(),other,self.event(scope='includes-descendants'),self.event(scope='unknown'))
        report=activity.summary(self.root)
        self.assertEqual(report['own_time']['estimated_ms'],1600)
        self.assertEqual(report['unaggregated_scopes']['includes-descendants']['estimated_ms'],800)
        self.assertEqual(report['unaggregated_scopes']['unknown']['estimated_ms'],800)
        known=self.state()['scope_metrics']['activity']['scoped']['totals']
        self.assertEqual(len(known),1)
        self.assertEqual(activity.rollup(next(iter(known.values())))['estimated_ms'],1600)

    def test_crossing_stale_missing_and_conflicting_context_remain_unknown(self):
        with patch.object(scopes,'marker_now',return_value=stamp(500)):self.mark('review-start','e')
        stale=self.event(1,1000,2000);stale['attribution']['context_ref']='f'*64
        missing=self.event(2,2000,3000);missing['attribution']={'context_ref':None,'work_ref':None}
        self.call(self.event(),stale,missing)
        report=activity.summary(self.root)
        self.assertEqual(report['repository_unattributed']['estimated_ms'],2400)
        self.assertEqual(report['implementation_phases']['unknown']['estimated_ms'],2400)
        self.assertEqual(self.state()['scope_metrics']['activity']['scoped']['totals'],{})

    def test_time_phase_does_not_require_token_feed_and_review_fixes_are_separate(self):
        # No usable token fence: time intent is still an explicit exact marker.
        old=self.state()['phase_contexts'][self.agent]
        with patch.object(scopes,'marker_now',return_value=T0):
            phases.transition(self.root,work_ref='b'*64,candidate_ref='c'*64,marker_id='e'*64,operation='associate',
                targets=[{'agent':self.agent,'source_ref':None,'fence':None}],expected={self.agent:old['ref']},planning_context=self.context)
        self.assertEqual(self.state()['phase_contexts'][self.agent]['phase'],'unknown')
        self.call(self.event())
        with patch.object(scopes,'marker_now',return_value=stamp(1000)):self.mark('correction-resume','f',review_ref='9'*64)
        self.call(self.event(1,1000,2000,900))
        report=activity.summary(self.root)['implementation_phases']
        self.assertEqual(report['pre_review']['estimated_ms'],800)
        self.assertEqual(report['review_fixes']['estimated_ms'],900)

    def test_v3_phase_status_exposes_only_opaque_exact_time_context_refs(self):
        with patch.object(local,'_config',return_value={'destination':None}), \
             patch.object(local,'_repository',return_value=('a'*64,self.root)):
            value=phases.status(self.root)
        self.assertEqual(value['state'],'available')
        context=value['contexts'][0]
        self.assertEqual(context['agent_ref'],self.agent)
        self.assertEqual(context['marked_at'],T0)
        self.assertEqual(context['time_phase'],'pre_review')
        self.assertNotIn('synthetic-parent',json.dumps(value))

    def test_marker_race_after_validation_rechecks_locked_live_context(self):
        event=self.event(); original=activity._event; fired=[]
        def raced(*args):
            value=original(*args)
            if not fired:
                fired.append(True)
                with patch.object(scopes,'marker_now',return_value=stamp(500)): self.mark('review-start','e')
            return value
        with patch.object(activity,'_event',side_effect=raced): self.call(event)
        report=activity.summary(self.root)
        self.assertEqual(report['repository_unattributed']['estimated_ms'],800)
        self.assertEqual(report['implementation_phases']['unknown']['estimated_ms'],800)

    def test_legacy_store_is_not_migrated_by_activity_import(self):
        legacy=self.root/'legacy';legacy.mkdir();usage.enable(legacy)
        path=legacy/usage.BASE/'state.json';before=path.read_bytes()
        with self.assertRaises(ControlError):activity.import_observations(legacy,
            {'schema_version':activity.IMPORT_SCHEMA,'events':[self.event()]},at=stamp(10000))
        self.assertEqual(path.read_bytes(),before)
        self.assertEqual(activity.summary(legacy)['status'],'disabled')

    def test_activity_mismatch_does_not_turn_tests_into_initial_implementation(self):
        with patch.object(scopes,'marker_now',return_value=T0):self.mark('activity','e',activity='tests')
        self.call(self.event(),self.event(1,1000,2000,purpose='tests'))
        report=activity.summary(self.root)
        self.assertIsNone(report['implementation_phases']['pre_review']['estimated_ms'])
        self.assertEqual(report['implementation_phases']['unknown']['estimated_ms'],800)
        self.assertEqual(report['repository_unattributed']['estimated_ms'],800)

    def test_invalid_clock_sequence_duration_shape_and_batch_failure_preserve_all_bytes(self):
        invalid=[]
        for changes in ({'sequence':1},{'duration_ms':1001},{'duration_ms':True},{'measurement':'unavailable'},
                        {'clock_ref':'8'*64},{'started_at':stamp(1001)},{'ended_at':stamp(10001)},
                        {'extra':'content'},{'attribution':{'context_ref':'a'*64,'work_ref':None}}):
            invalid.append(self.event(**changes))
        measured=self.event(measurement='measured',duration_ms=800,clock_ref='8'*64,
                            monotonic_start_ms=1000,monotonic_end_ms=1200);invalid.append(measured)
        before=self.path.read_bytes()
        for event in invalid:
            with self.assertRaises(ControlError):self.call(event,_source=activity._QUALIFIED_NUMERIC_HOST)
            self.assertEqual(self.path.read_bytes(),before)
        with self.assertRaises(ControlError):self.call(self.event(),self.event(1,500,1500))
        self.assertEqual(self.path.read_bytes(),before)

    def test_clock_reset_and_clock_session_change_are_refused(self):
        first=self.event(measurement='measured',duration_ms=800,clock_ref='8'*64,monotonic_start_ms=1000,monotonic_end_ms=1800)
        self.call(first,_source=activity._QUALIFIED_NUMERIC_HOST);before=self.path.read_bytes()
        for changes in ({'clock_ref':'9'*64,'monotonic_start_ms':1800,'monotonic_end_ms':2600},
                        {'monotonic_start_ms':1700,'monotonic_end_ms':2500}):
            with self.assertRaises(ControlError):self.call({**first,'sequence':1,'started_at':stamp(1000),'ended_at':stamp(2000),**changes},_source=activity._QUALIFIED_NUMERIC_HOST)
            self.assertEqual(self.path.read_bytes(),before)

    def test_capacity_and_interrupted_write_preserve_existing_cursors_and_tokens(self):
        self.call(self.event());before=self.path.read_bytes()
        with patch.object(usage,'MAX_STREAMS',1):
            with self.assertRaises(ControlError):self.call(self.event(start=1000,end=2000,session_ref='8'*64))
        self.assertEqual(self.path.read_bytes(),before)
        with patch.object(usage,'MAX_BYTES',len(before)):
            with self.assertRaises(ControlError):self.call(self.event(1,1000,2000))
        self.assertEqual(self.path.read_bytes(),before)
        with patch.object(usage,'atomic_write',side_effect=OSError('inert interruption')):
            with self.assertRaises(OSError):self.call(self.event(1,1000,2000))
        self.assertEqual(self.path.read_bytes(),before)

    def test_retention_preserves_old_quarters_lifetime_coarse_and_unattributed(self):
        first=self.event(started_at='2001-01-01T00:00:00.000Z',ended_at='2001-01-01T00:00:01.000Z',attribution={'context_ref':None,'work_ref':None})
        last=self.event(1,start=0,end=86400000,duration=1000)
        self.call(first,last,at='2028-11-25T12:00:00.000Z')
        state=self.state()['scope_metrics']['activity']
        self.assertEqual(state['daily'],{})
        self.assertEqual(activity.rollup(state['older_quarters'])['estimated_ms'],800)
        self.assertEqual(activity.rollup(state['totals'])['estimated_ms'],1800)
        self.assertEqual(activity.summary(self.root)['repository_unattributed']['estimated_ms'],800)
        self.assertEqual(activity.rollup(state['totals'])['coarse_intervals'],1)

    def test_public_cli_accepts_estimates_and_refuses_measured_without_any_source_override(self):
        path=self.root/'.local-codex/activity.json'
        def call(event):
            path.write_text(json.dumps({'schema_version':activity.IMPORT_SCHEMA,'events':[event]}),encoding='utf-8')
            return subprocess.run([sys.executable,str(counters.HELPERS/'development_control_plane.py'),'--repo',str(self.root),
                                   'usage','activity-import','--from','.local-codex/activity.json'],capture_output=True,text=True,timeout=30)
        self.assertEqual(call(self.event()).returncode,0)
        measured=self.event(1,1000,2000,800,measurement='measured',clock_ref='8'*64,monotonic_start_ms=1000,monotonic_end_ms=1800)
        before=self.path.read_bytes();result=call(measured)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('activity.measured-source-unavailable',result.stdout)
        self.assertEqual(self.path.read_bytes(),before)


if __name__=='__main__':unittest.main()
