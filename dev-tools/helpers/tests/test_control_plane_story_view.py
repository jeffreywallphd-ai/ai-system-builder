"""Story ownership, plain copy and exact paged task joins on real canonical plans."""
import copy
import json
from unittest import mock
import unittest

import test_control_plane_story_tasks as tasks
from test_control_plane_roadmap import fixtures, roadmap
from control_plane.common import digest
from control_plane.projection import project, review_page, expanded_review_work_items
from control_plane.user_presentation import TASK_REFERENCE, UNAVAILABLE, apply_user_descriptions
from control_plane import catalog
from control_plane.story_views import attach_task_support


class StoryViewTests(unittest.TestCase):
    def setUp(self):
        self.journey = self.new_journey()
        self.root = self.journey.root

    def new_journey(self, *, split=False):
        # Reuse real Work/receipt fixtures, with a second fixed story that has
        # no assigned task yet. Empty stories must never look complete.
        original = fixtures.increment_definition
        def definition(*args, **kwargs):
            result = original(*args, **kwargs)
            result['workPackages'].append({'id': 'empty-story', 'title': 'Second fixed story',
                                            'outcome': 'A separate unchanged approved outcome.'})
            return result
        original_apply = fixtures.RoadmapEngineTest.apply
        def apply(engine, event):
            if split and event['type'] == 'story-tasks-assigned':
                event = copy.deepcopy(event); event['assignments'][1]['storyId'] = 'empty-story'
            return original_apply(engine, event)
        journey = tasks.StoryTaskWorkTests('runTest')
        with mock.patch.object(fixtures, 'increment_definition', side_effect=definition), \
             mock.patch.object(fixtures.RoadmapEngineTest, 'apply', new=apply):
            journey.setUp()
        if split: journey.spec['task_targets'][1]['story_id'] = 'empty-story'
        self.addCleanup(journey.doCleanups)
        return journey

    def view(self, compact=False):
        value = project(self.root, compact_work_items=compact)
        self.assertEqual(len(value['roadmaps']), 1, value['diagnostics'])
        return value

    def copy_document(self, value):
        parent = value['roadmaps'][0]
        records = []
        for increment in parent['increments']:
            for kind, rows in (('story', increment['stories']), ('task', increment['chunks'])):
                for row in rows:
                    records.append({'record_type': kind, 'roadmap_id': parent['id'], 'increment_id': increment['id'],
                        'record_id': row['id'], 'source_definition_digest': row['definition_digest'],
                        'user_description': {'title': 'Clear ' + row['id'], 'purpose': 'Explain this exact approved outcome.',
                                             'scope': ['Parent technical checks remain separate.']}})
        return {'schema_version': 'roadmap-user-task-descriptions-v1', 'records': records}

    def apply_copy(self, value, document):
        self.journey.put(TASK_REFERENCE, json.dumps(document))
        return apply_user_descriptions(self.root, copy.deepcopy(value))

    def test_counts_and_reviewed_work_do_not_qualify_the_parent_or_empty_story(self):
        proof = self.journey.finish()
        self.journey.record('chunk-1', proof)
        value = self.view()
        increment = value['roadmaps'][0]['increments'][0]
        self.assertEqual([(s['tasks_complete'], s['tasks_planned']) for s in increment['stories']], [(1, 2), (0, 0)])
        self.assertEqual(increment['chunks'][0]['story_id'], 'work-1')
        self.assertEqual(increment['chunks'][0]['work_support']['status'], 'reviewed-local-snapshot')
        self.assertEqual(increment['chunks'][0]['work_support']['current_qualification'], 'not-asserted')
        self.assertEqual(increment['chunks'][1]['work_support']['status'], 'not-recorded')
        self.assertTrue(all(c['outcome'] == 'missing' for c in increment['criteria']))
        self.assertEqual(increment['status'], 'implementing')

    def test_task_pages_keep_only_selected_relationships_and_complete_original_counts(self):
        value = self.view(compact=True)
        with mock.patch('control_plane.projection.PAGE_SIZES',
                        {'roadmaps': 3, 'work_items': 1, 'evaluations': 25, 'feedback': 25}):
            page = review_page(value, view='work_items', page=1)
        rows = expanded_review_work_items(page)
        self.assertEqual(len(rows), 1)
        increment = page['work_item_roadmaps'][0]['increments'][0]
        self.assertTrue(increment['partial_task_view'])
        self.assertEqual(increment['stories'][0]['task_ids'], [rows[0]['chunk_id']])
        self.assertEqual(increment['stories'][0]['tasks_planned'], 2)
        self.assertEqual(len(increment['stories']), 1)
        self.assertEqual(rows[0]['story_id'], 'work-1')

    def test_one_work_across_two_stories_retains_one_task_owner_and_pending_parent(self):
        journey = self.new_journey(split=True)
        proof = journey.finish(); journey.record('chunk-1', proof); journey.record('second-task', proof)
        increment = project(journey.root)['roadmaps'][0]['increments'][0]
        self.assertEqual([s['task_ids'] for s in increment['stories']], [['chunk-1'], ['second-task']])
        self.assertEqual([(s['tasks_complete'], s['tasks_planned']) for s in increment['stories']], [(1, 1), (1, 1)])
        self.assertEqual({task['work_support']['work_id'] for task in increment['chunks']}, {proof['workId']})
        self.assertTrue(all(c['outcome'] == 'missing' for c in increment['criteria']))

    def test_plain_copy_preserves_identity_results_and_removes_execution_narratives(self):
        proof = self.journey.finish(); self.journey.record('chunk-1', proof)
        original = self.view()
        before = (self.root / self.journey.engine.state['paths']['state']).read_bytes()
        value = self.apply_copy(original, self.copy_document(original))
        increment = value['roadmaps'][0]['increments'][0]
        self.assertTrue(increment['chunks'][0]['verification_recorded'])
        self.assertNotIn('summary', increment['chunks'][0]); self.assertNotIn('tests', increment['chunks'][0])
        self.assertEqual(increment['chunks'][0]['title'], 'Clear chunk-1')
        self.assertEqual(increment['proposal']['work_packages'][0]['title'], 'Clear work-1')
        task = next(row for row in value['work_items'] if row.get('source') == 'roadmap-chunk')
        self.assertEqual(task['story_id'], 'work-1')
        self.assertEqual(task['outcome'], 'Explain this exact approved outcome.')
        self.assertEqual((self.root / self.journey.engine.state['paths']['state']).read_bytes(), before)
        self.assertEqual(increment['chunks'][0]['status'], 'completed')
        self.assertTrue(all(c['outcome'] == 'missing' for c in increment['criteria']))

    def test_missing_stale_duplicate_and_unsafe_task_copy_use_neutral_text(self):
        original = self.view()
        document = self.copy_document(original)
        for mutate in (lambda d: d['records'].clear(),
                       lambda d: d['records'][0].update(source_definition_digest='0' * 64),
                       lambda d: d['records'].append(copy.deepcopy(d['records'][0])),
                       lambda d: d['records'][0]['user_description'].update(title='C:\\Users\\private\\secret')):
            variant = copy.deepcopy(document); mutate(variant)
            value = self.apply_copy(original, variant)
            story = value['roadmaps'][0]['increments'][0]['stories'][0]
            self.assertEqual(story['outcome'], UNAVAILABLE)
            self.assertEqual(story['task_ids'], ['chunk-1', 'second-task'])

    def test_tampered_adopted_ownership_is_unavailable_instead_of_guessed(self):
        state = copy.deepcopy(self.journey.engine.state)
        state['storyTaskTracking']['revisions'][-1]['assignments'][0]['storyId'] = 'empty-story'
        self.journey.put(state['paths']['state'], json.dumps(state))
        value = project(self.root)
        self.assertFalse(value['roadmaps'])
        self.assertIn({'code': 'projection.roadmap-unavailable'}, value['diagnostics'])

    def test_reviewed_task_snapshot_cannot_be_decorated_onto_a_foreign_parent(self):
        proof = self.journey.finish(); self.journey.record('chunk-1', proof)
        parent = self.view()['roadmaps'][0]
        parent['id'] = 'foreign-parent'
        task = parent['increments'][0]['chunks'][0]; task['_work_proof'] = proof
        attach_task_support([parent], self.journey.work.records.load()['work_items'])
        self.assertEqual(task['work_support']['status'], 'unverified-support')

    def test_unadopted_view_keeps_legacy_fields_without_guessed_stories(self):
        state = self.journey.engine.state
        state.pop('storyTaskTracking'); state['history'].pop(); self.journey.save()
        increment = self.view()['roadmaps'][0]['increments'][0]
        self.assertNotIn('stories', increment)
        self.assertNotIn('story_id', increment['chunks'][0])


class StoryViewRoutingTests(unittest.TestCase):
    def test_complete_known_view_scope_runs_real_suites_and_keeps_unknown_fallback(self):
        paths = ['dev-tools/helpers/control_plane/projection.py', 'dev-tools/review-site/app.js',
                 'dev-tools/helpers/tests/test_control_plane_story_view.py']
        selected = {check['id']: check for check in catalog.plan(tasks.REPO, paths, ['review-site'], 'fixture')['selected']}
        self.assertIn('story-task-view', selected); self.assertNotIn('control-plane', selected)
        self.assertNotIn('focused-tests', selected)
        self.assertIn('--test-skip-pattern=^contributor control plane passes focused behavioral qualification$', selected['review-site']['argv'])
        for name in ('story_view', 'user_presentation', 'review_wire'):
            self.assertIn('test_control_plane_' + name + '.', selected['story-task-view']['argv'])
        unknown = {check['id']: check for check in catalog.plan(tasks.REPO, paths + ['dev-tools/helpers/control_plane/unrelated.py'],
                   ['review-site'], 'fixture')['selected']}
        self.assertIn('control-plane', unknown)
        self.assertNotEqual(unknown['review-site']['argv'], selected['review-site']['argv'])
        explicit = {check['id'] for check in catalog.plan(tasks.REPO, paths, ['review-site', 'control-plane'], 'fixture')['selected']}
        self.assertIn('control-plane', explicit)


if __name__ == '__main__':
    unittest.main()
