"""Exact real Work ancestry, without inferring a task from titles or activity."""
import copy
import unittest

import test_control_plane_story_view as fixture
import test_control_plane_roadmap as governed
from control_plane import planning_scopes as scopes
from control_plane.common import digest


class PlanningScopeTests(unittest.TestCase):
    new_journey = fixture.StoryViewTests.new_journey

    def start(self, *, split=False, version=None, overall=False):
        journey = self.new_journey(split=split)
        spec = copy.deepcopy(journey.spec)
        if version == 1 or overall:
            spec['schema_version'] = 'development-work-v1'; spec.pop('task_targets')
        if overall: spec['roadmap']['increment_id'] = 'overall'
        journey.work.start(spec, 'fixture-author')
        work = journey.work.records.load()['work_items'][spec['work_id']]
        return journey, work

    def test_two_tasks_in_one_story_map_to_one_exclusive_story(self):
        journey, work = self.start()
        result = scopes.resolve(journey.root, work, 'a'*64)
        self.assertTrue(result['valid'])
        self.assertEqual(result['definition']['story_id'], 'work-1')
        self.assertEqual(result['definition']['increment_id'], 'increment-1')
        self.assertEqual(result['definition']['roadmap_id'], 'task-fixture')
        self.assertEqual(result['approval_ref'], journey.engine.state['roadmapApproval']['fingerprint'])
        self.assertIsNotNone(result['tasks_ref']); self.assertIsNotNone(result['assignment_ref'])
        self.assertNotIn('work_id', result['definition'])

    def test_two_stories_map_only_to_increment_and_never_split_tokens_by_task_count(self):
        journey, work = self.start(split=True)
        result = scopes.resolve(journey.root, work, 'a'*64)
        self.assertTrue(result['valid']); self.assertIsNone(result['definition']['story_id'])
        self.assertEqual(result['definition']['increment_id'], 'increment-1')
        self.assertIsNotNone(result['tasks_ref'])

    def test_legacy_increment_binding_remains_increment_only_without_new_authority_digest(self):
        journey, work = self.start(version=1)
        before = work['authority_digest']
        result = scopes.resolve(journey.root, work, 'a'*64)
        self.assertTrue(result['valid']); self.assertIsNone(result['definition']['story_id'])
        self.assertIsNone(result['tasks_ref']); self.assertIsNone(result['assignment_ref'])
        self.assertEqual(work['authority_digest'], before)

    def test_overall_and_unrelated_work_do_not_invent_an_increment_or_story(self):
        journey = governed.GovernedTests('runTest'); journey.setUp(); self.addCleanup(journey.doCleanups)
        spec = journey.overall_spec(); journey.work.start(spec, 'fixture-author')
        work = journey.work.records.load()['work_items'][spec['work_id']]
        result = scopes.resolve(journey.root, work, 'a'*64)
        self.assertTrue(result['valid']); self.assertIsNone(result['definition']['increment_id'])
        unrelated = copy.deepcopy(journey.spec)
        unrelated.update(schema_version='development-work-v1', kind='lightweight')
        unrelated.pop('roadmap'); unrelated.pop('task_targets', None)
        record = {'spec': unrelated, 'spec_digest': digest(unrelated), 'authority_digest': None}
        record['authority_digest'] = journey.work.authority(unrelated)
        result = scopes.resolve(journey.root, record, 'a'*64)
        self.assertTrue(result['valid']); self.assertIsNone(result['definition'])

    def test_forged_stale_or_pending_authority_is_unknown_and_read_only(self):
        journey, work = self.start()
        original = journey.work.records.path.read_bytes()
        for key in ('spec_digest', 'authority_digest'):
            wrong = copy.deepcopy(work); wrong[key] = 'f'*64
            self.assertEqual(scopes.resolve(journey.root, wrong, 'a'*64), scopes.unavailable())
        wrong = copy.deepcopy(work); wrong['spec']['task_targets'][0]['story_id'] = 'empty-story'
        wrong['spec_digest'] = digest(wrong['spec'])
        self.assertEqual(scopes.resolve(journey.root, wrong, 'a'*64), scopes.unavailable())
        self.assertEqual(journey.work.records.path.read_bytes(), original)
        journal = journey.work.records.journal
        journal.write_text('{}', encoding='utf-8')
        self.assertEqual(scopes.resolve(journey.root, work, 'a'*64), scopes.unavailable())
        self.assertEqual(journal.read_text(encoding='utf-8'), '{}')
        self.assertEqual(journey.work.records.path.read_bytes(), original)

    def test_stable_scope_identity_excludes_expandable_task_and_receipt_history(self):
        journey, work = self.start()
        state = journey.engine.state; increment = state['increments'][0]; story = increment['workPackages'][0]
        before = scopes.definition('a'*64, state, increment, story)
        increment['plan']['chunks'].append({'id': 'later-task'})
        state['history'].append({'type': 'not-an-authority-fixture'})
        self.assertEqual(before, scopes.definition('a'*64, state, increment, story))
        self.assertNotEqual(before, scopes.definition('b'*64, state, increment, story))
        story['outcome'] += ' changed'
        self.assertNotEqual(before, scopes.definition('a'*64, state, increment, story))


if __name__ == '__main__': unittest.main()
