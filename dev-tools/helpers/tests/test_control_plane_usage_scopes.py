"""Exact numeric conservation, compatible migration and bounded failure paths."""
import copy
import json
import unittest
from unittest.mock import patch

import test_control_plane_usage as fixture
from control_plane import usage, usage_activity, usage_phases as phases, usage_scopes as scopes
from control_plane.contracts import ControlError
from control_plane import catalog


class ScopedUsageTests(unittest.TestCase):
    def setUp(self):
        fixture.UsageTests.setUp(self)
        self.agent = usage.digest(['synthetic-host', 'synthetic-run', 'synthetic-parent'])
        self.context = {'definition': {'repository_ref': '1'*64, 'roadmap_id': 'fixture-roadmap',
                        'increment_id': 'fixture-increment', 'story_id': 'fixture-story', 'ancestry_digest': '2'*64},
                        'assignment_ref': '3'*64, 'tasks_ref': '4'*64, 'approval_ref': '5'*64, 'valid': True}
        self.path = self.root / usage.BASE / 'state.json'

    def enable(self):
        usage.enable(self.root)
        scopes.enable(self.root)

    def state(self):
        return usage._load(self.root)

    def mark(self, operation='associate', marker='a', context=None, agent=None, work='b', **extra):
        agent = agent or self.agent
        old = self.state()['phase_contexts'].get(agent)
        return phases.transition(self.root, work_ref=work*64, candidate_ref='c'*64, marker_id=marker*64,
            operation=operation, targets=[{'agent': agent, 'source_ref': 'd'*64, 'fence': 10}],
            expected={agent: old['ref'] if old else None}, planning_context=context or self.context, **extra)

    def event(self, sequence, **extra):
        event = fixture.UsageTests.event(self, sequence=sequence, **extra)
        agent = usage.digest([event[key] for key in ('producer', 'run_id', 'agent_id')])
        context = self.state()['phase_contexts'].get(agent)
        event['attribution'] = {'work_ref': context['work_ref'] if context else None,
            'context_ref': context['ref'] if context else None, 'source_ref': 'd'*64, 'position': 11 + sequence}
        return event

    def call(self, *events, at=fixture.AT):
        return usage.import_observations(self.root, {'schema_version': usage.IMPORT_V2, 'events': list(events)}, at=at)

    def known(self):
        return scopes.summary(self.root)['scopes'][0]['own_usage']['measured']['input_tokens']

    def test_migration_preserves_every_original_cell_cursor_context_and_replay_hash(self):
        usage.enable(self.root)
        event = fixture.UsageTests.event(self)
        usage.import_observations(self.root, {'schema_version': usage.IMPORT_SCHEMA, 'events': [event]}, at=fixture.AT)
        phases.transition(self.root, work_ref='b'*64, candidate_ref='c'*64, marker_id='a'*64,
                          operation='associate', targets=[{'agent': self.agent, 'source_ref': 'd'*64, 'fence': 10}])
        original = self.state()
        scopes.enable(self.root)
        migrated = self.state()
        for key, value in original.items():
            if key not in {'schema_version', 'revision', 'state_digest'}: self.assertEqual(migrated[key], value, key)
        self.assertEqual(migrated['schema_version'], scopes.SCHEMA)
        self.assertEqual(migrated['scope_metrics']['definitions'], {})
        self.assertEqual(scopes.summary(self.root)['repository_unattributed']['measured']['input_tokens'], 100)
        before = self.path.read_bytes()
        scopes.enable(self.root)
        self.assertEqual(before, self.path.read_bytes())
        self.assertEqual(usage.import_observations(self.root, {'schema_version': usage.IMPORT_SCHEMA, 'events': [event]}, at=fixture.AT)['duplicates'], 1)
        self.assertEqual(before, self.path.read_bytes())
        # Replaying an old marker cannot silently attach new planning attribution.
        with self.assertRaises(ControlError): self.mark()
        self.assertEqual(before, self.path.read_bytes())

    def test_default_enable_import_and_phase_never_activate_scopes(self):
        usage.enable(self.root)
        usage.import_observations(self.root, {'schema_version': usage.IMPORT_SCHEMA,
            'events': [fixture.UsageTests.event(self)]}, at=fixture.AT)
        self.assertEqual(self.state()['schema_version'], usage.SCHEMA)
        self.assertEqual(scopes.summary(self.root)['status'], 'disabled')
        with self.assertRaises(ControlError): self.mark()
        self.assertEqual(self.state()['schema_version'], usage.SCHEMA)

    def test_v1_migration_keeps_numeric_history_and_exact_latest_retry(self):
        usage.enable(self.root)
        event = fixture.UsageTests.event(self)
        manifest = {'schema_version': usage.IMPORT_SCHEMA, 'events': [event]}
        usage.import_observations(self.root, manifest, at=fixture.AT)
        state = self.state()
        def legacy(groups):
            result = {}
            for group, stats in groups.items():
                stats.pop('phase_basis'); result['|'.join(group.split('|')[:3])] = stats
            return result
        for key in ('totals', 'older_quarters'): state[key] = legacy(state[key])
        for period in usage.DEFAULT_RETENTION:
            for stamp in state[period]: state[period][stamp] = legacy(state[period][stamp])
        for row in state['streams'].values(): row['totals'] = legacy(row['totals'])
        for row in state['recent']: row.pop('implementation_phase'); row['stats'].pop('phase_basis')
        state.pop('phase_contexts'); state.pop('phase_markers'); state['schema_version'] = usage.V1_SCHEMA
        state['state_digest'] = usage.digest({key: value for key, value in state.items() if key != 'state_digest'})
        self.path.write_bytes(usage._encoded(state)); before = self.path.read_bytes()
        expected = self.state(); self.assertEqual(self.path.read_bytes(), before)
        scopes.enable(self.root)
        migrated = self.state()
        for key, value in expected.items():
            if key not in {'schema_version', 'revision', 'state_digest'}: self.assertEqual(migrated[key], value, key)
        self.assertEqual(usage.summary(self.root)['implementation_phases']['legacy_unknown']['measured']['input_tokens'], 100)
        self.assertEqual(scopes.summary(self.root)['repository_unattributed']['measured']['input_tokens'], 100)
        before = self.path.read_bytes()
        self.assertEqual(usage.import_observations(self.root, manifest, at=fixture.AT)['duplicates'], 1)
        self.assertEqual(self.path.read_bytes(), before)

    def test_first_inflight_unknown_later_scope_once_and_duplicate_keeps_original_allocation(self):
        self.enable(); self.mark()
        first, second = self.event(0), self.event(1)
        self.call(first, second)
        self.assertEqual(self.known(), 100)
        report = scopes.summary(self.root)
        self.assertEqual(report['repository_unattributed']['measured']['input_tokens'], 100)
        self.assertEqual(usage.summary(self.root)['known_own_subtotal']['measured']['input_tokens'], 200)
        before = self.path.read_bytes()
        self.assertEqual(self.call(first)['older_sequences_not_recounted'], 1)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.call(second)['duplicates'], 1)
        self.assertEqual(self.path.read_bytes(), before)

    def test_scope_changes_do_not_reclassify_history_and_wrong_source_stays_unknown(self):
        self.enable(); self.mark(); self.call(self.event(0), self.event(1))
        old = copy.deepcopy(self.state()['scope_metrics']['tokens'])
        changed = copy.deepcopy(self.context); changed['definition']['story_id'] = 'another-story'
        self.mark(marker='e', context=changed)
        crossing = self.event(2)
        self.call(crossing)
        wrong = self.event(3); wrong['attribution']['source_ref'] = 'f'*64
        self.call(wrong)
        self.assertEqual(self.state()['scope_metrics']['tokens'], old)
        self.call(self.event(4))
        self.assertEqual(len(scopes.summary(self.root)['scopes']), 2)
        self.assertEqual(scopes.summary(self.root)['repository_unattributed']['measured']['input_tokens'], 300)

    def test_pre_review_and_review_fixes_remain_separate_with_unchanged_raw_totals(self):
        self.enable(); self.mark(); self.call(self.event(0), self.event(1))
        self.mark('review-start', 'e'); self.call(self.event(2), self.event(3))
        self.mark('correction-resume', 'f', review_ref='6'*64); self.call(self.event(4), self.event(5))
        report = scopes.summary(self.root)['scopes'][0]
        self.assertEqual(report['implementation_phases']['pre_review']['measured']['input_tokens'], 100)
        self.assertEqual(report['implementation_phases']['post_review_other']['measured']['input_tokens'], 100)
        self.assertEqual(report['implementation_phases']['review_fixes']['measured']['input_tokens'], 100)
        self.assertEqual(usage.summary(self.root)['known_own_subtotal']['measured']['input_tokens'], 600)

    def test_own_parent_and_child_are_exclusive_inclusive_and_unknown_do_not_add_to_own(self):
        self.enable(); self.mark(); self.call(self.event(0), self.event(1))
        child = usage.digest(['synthetic-host', 'synthetic-run', 'child'])
        self.mark(marker='e', agent=child)
        self.call(self.event(0, agent_id='child', parent_agent_id='synthetic-parent'),
                  self.event(1, agent_id='child', parent_agent_id='synthetic-parent'))
        self.call(self.event(0, scope='includes-descendants', counter_epoch='inclusive'),
                  self.event(0, scope='unknown', counter_epoch='unscoped'))
        self.assertEqual(self.known(), 200)
        state = self.state(); groups = next(iter(state['scope_metrics']['tokens']['totals'].values()))
        self.assertEqual(usage._rollup(groups, scope='includes-descendants')['measured']['input_tokens'], 100)
        self.assertEqual(usage._rollup(groups, scope='unknown')['measured']['input_tokens'], 100)
        # Cache/reasoning remain subset fields, not additional headline tokens.
        self.assertEqual(scopes.summary(self.root)['scopes'][0]['own_usage']['measured']['cached_input_tokens'], 20)

    def test_unknown_work_and_overlapping_context_never_claim_story(self):
        self.enable(); self.mark(); self.call(self.event(0), self.event(1))
        self.mark(marker='e', work='7')
        self.call(self.event(2), self.event(3))
        self.assertEqual(self.known(), 100)
        phases.invalidate(self.root, '7'*64, [self.agent])
        context = self.state()['phase_contexts'][self.agent]
        self.assertFalse(context['planning_valid']); self.assertIsNone(context['scope_ref'])
        self.call(self.event(4))
        self.assertEqual(self.known(), 100)

    def test_retirement_folds_known_quarters_and_preserves_lifetime_unknown_residual(self):
        usage.enable(self.root, {'daily': 90, 'weekly': 13, 'quarterly': 4}); scopes.enable(self.root)
        self.mark(); self.call(self.event(0, started_at='2001-01-01T00:00:00Z', ended_at='2001-01-01T00:00:00Z'))
        self.call(self.event(1, started_at='2001-01-01T00:00:00Z', ended_at='2001-01-01T00:00:00Z'))
        self.call(self.event(2, started_at='2026-11-23T23:59:00Z', ended_at=fixture.AT))
        state = self.state(); known = state['scope_metrics']['tokens']
        self.assertEqual(usage._rollup(next(iter(known['older_quarters'].values())))['measured']['input_tokens'], 100)
        self.assertEqual(self.known(), 200)
        self.assertEqual(scopes.summary(self.root)['repository_unattributed']['measured']['input_tokens'], 100)
        self.assertEqual(list(known['daily']), ['2026-11-24'])
        self.assertEqual(next(iter(known['totals'].values()))['own|implementation|host-reported|pre_review']['coarse'], 1)

    def test_capacity_and_interrupted_atomic_publish_preserve_original_store(self):
        usage.enable(self.root); before = self.path.read_bytes()
        with patch.object(usage, 'MAX_BYTES', len(before)):
            with self.assertRaises(ControlError): scopes.enable(self.root)
        self.assertEqual(self.path.read_bytes(), before)
        with patch.object(usage, 'atomic_write', side_effect=OSError('inert interrupted publication')):
            with self.assertRaises(OSError): scopes.enable(self.root)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.state()['schema_version'], usage.SCHEMA)

    def test_corrupt_definition_overallocation_and_activity_schema_fail_closed(self):
        self.enable(); self.mark(); self.call(self.event(0), self.event(1))
        original = self.state()
        changes = []
        bad = copy.deepcopy(original); next(iter(bad['scope_metrics']['definitions'].values()))['story_id'] = 'forged'; changes.append(bad)
        bad = copy.deepcopy(original); cell = next(iter(next(iter(bad['scope_metrics']['tokens']['totals'].values())).values())); cell['measured'][0] += 1000; changes.append(bad)
        bad = copy.deepcopy(original); bad['scope_metrics']['activity']['cursors']['a'*64] = {}; changes.append(bad)
        for bad in changes:
            bad['state_digest'] = usage.digest({key: value for key, value in bad.items() if key != 'state_digest'})
            self.path.write_bytes(usage._encoded(bad))
            before = self.path.read_bytes()
            self.assertEqual(scopes.summary(self.root)['status'], 'unavailable')
            with self.assertRaises(ControlError): usage._load(self.root)
            self.assertEqual(before, self.path.read_bytes())

    def test_activity_decoder_does_not_accept_estimates_as_measured_or_inconsistent_counts(self):
        self.enable(); state = self.state(); row = usage_activity.stats()
        row.update(estimated_ms=20, estimated_intervals=1, intervals=1, attribution_basis=[1,0,0])
        state['scope_metrics']['activity']['totals'] = {'own|implementation|pre_review': row}
        scopes.validate_state(state)
        row['measured_ms'] = 1
        with self.assertRaises(ControlError): scopes.validate_state(state)

    def test_scoped_routing_covers_exact_sources_and_preserves_generic_and_missing_support_fallback(self):
        root = fixture.HELPERS.parents[1]
        source = ['dev-tools/helpers/control_plane/usage_scopes.py']
        def plan(paths, required=('documentation',)): return {row['id']: row for row in catalog.plan(root, paths, list(required), 'fixture')['selected']}
        selected = plan(source)
        self.assertIn('scoped-metrics', selected); self.assertNotIn('control-plane', selected)
        self.assertIn('test_control_plane_planning_scopes.', selected['scoped-metrics']['argv'])
        for paths, required in [(source + ['dev-tools/helpers/control_plane/unrelated.py'], ('documentation',)),
                                (source, ('control-plane',)), ([], ('control-plane',))]:
            self.assertIn('control-plane', plan(paths, required))
        original = catalog._automatic_files_available
        missing = 'dev-tools/helpers/control_plane/usage_local.py'
        with patch.object(catalog, '_automatic_files_available', side_effect=lambda repo, check:
                False if missing in check.get('automatic_required_files', ()) else original(repo, check)):
            self.assertIn('control-plane', plan(source))


if __name__ == '__main__': unittest.main()
