"""A complete frozen handoff folds history, never hides incomplete requirements."""
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from control_plane.common import digest
from control_plane.projection import project
from control_plane.supporting_work import CONSOLIDATION, RETIREMENT, criterion_definitions

ENGINE_PATH = 'skills/manage-implementation-roadmaps/scripts/roadmap.py'
ENGINE_SOURCE = Path(__file__).resolve().parents[3] / ENGINE_PATH
ENGINE_SPEC = importlib.util.spec_from_file_location('consolidation_fixture_authority', ENGINE_SOURCE)
engine = importlib.util.module_from_spec(ENGINE_SPEC)
ENGINE_SPEC.loader.exec_module(engine)


class ConsolidationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='consolidation-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        increment = lambda identity, status: {'id': identity, 'number': 1, 'title': identity, 'objective': 'Retain technical work',
            'status': status, 'acceptanceCriteria': [{'id': 'check', 'description': 'Actual native boundary', 'qualification': 'controlled-environment'}],
            'completedChunks': [], 'plan': {'chunks': [{'id': 'chunk', 'title': 'Technical work', 'outcome': 'Qualified result', 'criteriaIds': ['check']}]}}
        self.source = {'schemaVersion': 1, 'slug': 'legacy', 'name': '<img src=x>', 'objective': 'Historical work', 'createdAt': '2026-01-01T00:00:00Z',
            'status': 'blocked', 'increments': [increment('old', 'blocked')], 'evidence': [],
            'blockers': [{'id': 'approved-successor-handoff', 'status': 'open'}]}
        self.target = {'schemaVersion': 1, 'slug': 'owner', 'name': 'Current work', 'objective': 'One owner', 'createdAt': '2026-10-22T00:00:00Z',
            'status': 'blocked', 'increments': [increment('new', 'pending')], 'evidence': [], 'evidencePolicy': 'control-plane-v1',
            'completionSuite': 'all',
            'roadmapApproval': None, 'blockers': []}
        self.target.update({'updatedAt': self.target['createdAt'], 'paths': {
            'state': '.implementation-roadmaps/owner/state.json', 'roadmap': 'docs/owner-implementation-roadmap.md',
            'report': 'docs/tmp/owner-implementation-report.md'}, 'discovery': None, 'decisions': [], 'chunks': [],
            'feedback': [], 'resumeAudits': [], 'history': [], 'completion': None, 'finalApproval': None,
            'currentIncrementId': None})
        self.target['roadmapApproval'] = {'fingerprint': engine.roadmap_fingerprint(self.target)}
        engine.validate_state_shape(self.root, self.target)
        self.config = {'schema_version': 'roadmap-supporting-work-v1', 'agent_only_roadmaps': [], 'criterion_labels': [], 'links': [],
            'successors': [{'roadmap_id': 'legacy', 'successor_roadmap_id': 'owner', 'summary': 'One execution owner', 'consolidation_path': CONSOLIDATION}]}
        self.value = {'schema_version': 'security-roadmap-consolidation-v1', 'source_roadmap_id': 'legacy', 'target_roadmap_id': 'owner',
            'source_digest': digest(self.source), 'target_criteria_digest': digest(criterion_definitions(self.target)),
            'authority_ref': 'user-merge', 'summary': 'Preserve unfinished native qualification',
            'legacy_criteria': [{'increment_id': 'old', 'criterion_id': 'check', 'owner_increment_id': 'new', 'owner_criterion_id': 'check',
                'related_owners': [], 'disposition': 'merged-existing-owner', 'summary': 'Native proof remains pending', 'evidence_paths': ['modules/example.ts']}],
            'current_criteria': [{'increment_id': 'new', 'criterion_id': 'check', 'disposition': 'qualification-required',
                'summary': 'Actual qualification remains required', 'evidence_paths': ['modules/example.ts']}],
            'finding_inventories': {'legacy_count': 78, 'csv_count': 88, 'legacy_register': 'docs/register.md', 'csv_assessment': 'docs/assessment.json'},
            'overall_qualification': {'completion_suite': 'all', 'procedure': ['Current exact candidate all-suite and release checks'], 'limits': 'No pass from consolidation'}}
        self.put('modules/example.ts', 'export const implemented = true;')
        self.put(ENGINE_PATH, ENGINE_SOURCE.read_text(encoding='utf-8'))
        self.put('docs/register.md', '\n'.join(f'| F{n:02} | preserve |' for n in range(1, 79)))
        self.put('docs/assessment.json', {'findings': [{'id': f'R{n:02}'} for n in range(1, 89)]})
        self.save()

    def put(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value) if isinstance(value, (dict, list)) else value, encoding='utf-8')

    def save(self):
        self.put('.implementation-roadmaps/legacy/state.json', self.source)
        self.put('.implementation-roadmaps/owner/state.json', self.target)
        self.put('docs/operations/roadmap-supporting-work.json', self.config)
        self.put(CONSOLIDATION, self.value)

    def test_complete_handoff_keeps_one_backlog_and_all_history_without_a_pass(self):
        data = project(self.root)
        self.assertEqual([r['id'] for r in data['roadmaps']], ['owner'])
        self.assertEqual([w['roadmap_id'] for w in data['work_items']], ['owner'])
        owner = data['roadmaps'][0]
        self.assertEqual(owner['status'], 'blocked')
        history = owner['merged_history'][0]
        self.assertEqual(history['id'], 'legacy')
        self.assertEqual(history['status'], 'blocked')
        self.assertEqual(history['increments'][0]['criteria'][0]['outcome'], 'missing')
        self.assertEqual(history['increments'][0]['chunks'][0]['status'], 'planned')
        self.assertEqual(history['criterion_owners'][0]['owner_increment_id'], 'new')
        self.assertEqual(json.loads((self.root/'.implementation-roadmaps/legacy/state.json').read_text()), self.source)
        self.assertEqual(data['diagnostics'], [])

    def test_bad_mapping_keeps_both_roadmaps_visible_with_safe_diagnostic(self):
        original = copy.deepcopy(self.value)
        for mode in ['missing-legacy', 'duplicate-legacy', 'unknown-owner', 'missing-current', 'stale-source', 'stale-target',
                     'bad-path', 'missing-file', 'unknown-field', 'duplicate-companion', 'wrong-identity', 'dropped-finding']:
            self.value = copy.deepcopy(original)
            if mode == 'missing-legacy': self.value['legacy_criteria'] = []
            if mode == 'duplicate-legacy': self.value['legacy_criteria'] *= 2
            if mode == 'unknown-owner': self.value['legacy_criteria'][0]['owner_criterion_id'] = 'unknown'
            if mode == 'missing-current': self.value['current_criteria'] = []
            if mode == 'stale-source': self.value['source_digest'] = 'old'
            if mode == 'stale-target': self.value['target_criteria_digest'] = 'old'
            if mode == 'bad-path': self.value['current_criteria'][0]['evidence_paths'] = ['../private']
            if mode == 'missing-file': self.value['current_criteria'][0]['evidence_paths'] = ['modules/missing.ts']
            if mode == 'unknown-field': self.value['approve'] = True
            if mode == 'duplicate-companion': self.value['legacy_criteria'][0]['related_owners'] = [{'increment_id': 'new', 'criterion_id': 'check'}]
            if mode == 'wrong-identity': self.value['source_roadmap_id'] = 'owner'
            if mode == 'dropped-finding': self.put('docs/assessment.json', {'findings': []})
            self.save()
            with self.subTest(mode=mode):
                data = project(self.root)
                self.assertEqual({r['id'] for r in data['roadmaps']}, {'owner', 'legacy'})
                self.assertTrue(all('merged_history' not in r for r in data['roadmaps']))
                self.assertIn({'code': 'projection.supporting-work-unavailable'}, data['diagnostics'])

    def test_unfrozen_legacy_or_ungoverned_target_cannot_be_hidden(self):
        for mode in ['unfrozen', 'unapproved', 'legacy-target']:
            source, target = copy.deepcopy(self.source), copy.deepcopy(self.target)
            if mode == 'unfrozen': source['blockers'] = []
            if mode == 'unapproved': target['roadmapApproval'] = None
            if mode == 'legacy-target': target.pop('evidencePolicy')
            self.value['source_digest'] = digest(source)
            self.save()
            self.put('.implementation-roadmaps/legacy/state.json', source)
            self.put('.implementation-roadmaps/owner/state.json', target)
            with self.subTest(mode=mode):
                data = project(self.root)
                self.assertEqual(len(data['roadmaps']), 2)
                self.assertIn({'code': 'projection.supporting-work-unavailable'}, data['diagnostics'])

    def test_successor_progress_and_completion_never_reopen_the_legacy_backlog(self):
        self.target['status'] = 'completed'
        self.target['increments'][0]['status'] = 'completed'
        self.target['increments'][0]['completedChunks'] = ['chunk']
        self.save()
        data = project(self.root)
        self.assertEqual([r['id'] for r in data['roadmaps']], ['owner'])
        self.assertEqual(data['roadmaps'][0]['merged_history'][0]['status'], 'blocked')

    def test_stale_or_malformed_canonical_approval_keeps_both_backlogs_visible(self):
        original = copy.deepcopy(self.target)
        for mode in ['stale', 'malformed', 'changed-objective', 'changed-decision', 'wrong-state-path', 'wrong-slug', 'missing-engine']:
            self.target = copy.deepcopy(original)
            if mode == 'stale': self.target['roadmapApproval']['fingerprint'] = 'unapproved'
            if mode == 'malformed': self.target['roadmapApproval'] = ['not-an-approval']
            if mode == 'changed-objective': self.target['objective'] = 'Unapproved changed scope'
            if mode == 'changed-decision': self.target['decisions'] = [{'id': 'changed', 'status': 'proposed', 'proposalFingerprint': 'new'}]
            if mode == 'wrong-state-path': self.target['paths']['state'] = '.implementation-roadmaps/other/state.json'
            if mode == 'wrong-slug': self.target['slug'] = 'other'
            if mode == 'missing-engine': (self.root / ENGINE_PATH).unlink()
            self.save()
            with self.subTest(mode=mode):
                data = project(self.root)
                self.assertEqual({r['id'] for r in data['roadmaps']}, {'other' if mode == 'wrong-slug' else 'owner', 'legacy'})
                self.assertTrue(all('merged_history' not in r for r in data['roadmaps']))
                self.assertIn({'code': 'projection.supporting-work-unavailable'}, data['diagnostics'])

    def test_mixed_successor_cycles_chains_and_duplicate_owners_fail_visible(self):
        ordinary = lambda a, b: {'roadmap_id': a, 'successor_roadmap_id': b, 'summary': 'Retained successor'}
        canonical = copy.deepcopy(self.config['successors'][0])
        third = copy.deepcopy(self.source)
        third['slug'], third['name'] = 'third', 'Another historical record'
        self.put('.implementation-roadmaps/third/state.json', third)
        cases = [
            [canonical, ordinary('owner', 'legacy')],
            [canonical, ordinary('owner', 'third')],
            [canonical, ordinary('third', 'legacy')],
            [canonical, ordinary('legacy', 'third')],
            [canonical, ordinary('owner', 'third'), ordinary('third', 'owner')],
        ]
        for successors in cases:
            self.config['successors'] = successors
            self.save()
            with self.subTest(successors=successors):
                data = project(self.root)
                self.assertEqual({r['id'] for r in data['roadmaps']}, {'owner', 'legacy', 'third'})
                self.assertTrue(all('merged_history' not in r for r in data['roadmaps']))
                self.assertIn({'code': 'projection.supporting-work-unavailable'}, data['diagnostics'])

    def retirement(self):
        old, owner = 'systems-run-workflow-active-source', 'systems-publish-runtime-lifecycle'
        for slug in ('legacy', 'owner'):
            (self.root / f'.implementation-roadmaps/{slug}/state.json').unlink()
        self.source['slug'] = old
        self.source['blockers'] = [{'id': 'superseded-by-publish-lifecycle', 'status': 'open'}]
        self.source['roadmapApproval'] = None
        self.source['increments'][0].update(status='pending', plan=None)
        self.target.update(slug=owner, status='completed')
        self.target['paths']['state'] = f'.implementation-roadmaps/{owner}/state.json'
        self.target.pop('evidencePolicy')
        self.target['increments'][0].update(status='completed', completedChunks=['chunk'])
        self.target['roadmapApproval'] = {'fingerprint': engine.roadmap_fingerprint(self.target)}
        self.config['successors'] = [{'roadmap_id': old, 'successor_roadmap_id': owner,
            'summary': 'The completed Publish workflow absorbed the obsolete unstarted Run and Test proposal.', 'consolidation_path': RETIREMENT}]
        self.value.update(schema_version='retired-run-test-roadmap-v1', source_roadmap_id=old, target_roadmap_id=owner,
            source_digest=digest(self.source), target_criteria_digest=digest(criterion_definitions(self.target)), finding_inventories={})
        self.value['overall_qualification']['completion_suite'] = 'preserved-completed-successor'
        return old, owner

    def save_retirement(self):
        for state in (self.source, self.target):
            self.put(f".implementation-roadmaps/{state['slug']}/state.json", state)
        self.put('docs/operations/roadmap-supporting-work.json', self.config)
        self.put(RETIREMENT, self.value)

    def test_fixed_unstarted_retirement_keeps_complete_successor_and_original_unpassed_history(self):
        old, owner = self.retirement()
        self.save_retirement()
        data = project(self.root)
        self.assertEqual(data['diagnostics'], [])
        self.assertEqual([r['id'] for r in data['roadmaps']], [owner])
        self.assertEqual(data['roadmaps'][0]['status'], 'completed')
        history = data['roadmaps'][0]['merged_history'][0]
        self.assertEqual(history['id'], old)
        self.assertEqual(history['status'], 'blocked')
        self.assertEqual(history['increments'][0]['criteria'][0]['outcome'], 'missing')
        self.assertEqual([w['roadmap_id'] for w in data['work_items']], [owner])

    def test_retirement_cannot_hide_started_approved_unmapped_or_unfinished_replacement(self):
        old, owner = self.retirement()
        source, target, value = copy.deepcopy(self.source), copy.deepcopy(self.target), copy.deepcopy(self.value)
        for mode in ['started', 'plan', 'approved', 'evidence', 'incomplete-owner', 'owner-increment', 'missing-mapping', 'inventories', 'stale-approval']:
            self.source, self.target, self.value = copy.deepcopy(source), copy.deepcopy(target), copy.deepcopy(value)
            if mode == 'started': self.source['increments'][0]['startedAt'] = '2026-10-22T00:00:00Z'
            if mode == 'plan': self.source['increments'][0]['plan'] = {'chunks': []}
            if mode == 'approved': self.source['roadmapApproval'] = {'fingerprint': 'not-unstarted'}
            if mode == 'evidence': self.source['evidence'] = [{'incrementId': 'old', 'criterionId': 'check', 'outcome': 'passed'}]
            if mode == 'incomplete-owner': self.target['status'] = 'executing'
            if mode == 'owner-increment': self.target['increments'][0]['status'] = 'verifying'
            if mode == 'missing-mapping': self.value['legacy_criteria'] = []
            if mode == 'inventories': self.value['finding_inventories'] = {'approve': True}
            if mode == 'stale-approval': self.target['roadmapApproval']['fingerprint'] = 'stale'
            self.value['source_digest'] = digest(self.source)
            self.save_retirement()
            with self.subTest(mode=mode):
                data = project(self.root)
                self.assertEqual({r['id'] for r in data['roadmaps']}, {old, owner})
                self.assertIn({'code': 'projection.supporting-work-unavailable'}, data['diagnostics'])

    def test_legacy_offline_scope_keeps_technical_pending_criteria_and_chunk_links(self):
        self.config['successors'] = []
        original = copy.deepcopy(self.target['increments'][0]['acceptanceCriteria'][0])
        technical = {**original, 'description': 'Automated keyboard and measured resource qualification'}
        self.target['increments'][0]['acceptanceCriteria'] = [technical]
        self.target['evidence'] = [{'incrementId': 'new', 'criterionId': 'check', 'outcome': 'pending', 'summary': 'Actual technical qualification remains pending'}]
        self.target['legacyAcceptanceScopeRevisions'] = [{'incrementId': 'new', 'removedCriteria': [],
            'replacedCriteria': [{'original': original, 'revised': technical, 'humanScope': 'Participant acceptance only'}]}]
        self.save()
        data = project(self.root)
        owner = next(r for r in data['roadmaps'] if r['id'] == 'owner')
        increment = owner['increments'][0]
        self.assertEqual(increment['criteria'][0]['description'], technical['description'])
        self.assertEqual(increment['criteria'][0]['outcome'], 'pending')
        self.assertEqual(increment['chunks'][0]['criteria_ids'], ['check'])
        self.assertEqual(increment['offline_acceptance'][0]['status'], 'offline-user-owned')
        self.assertIn('Participant acceptance only', increment['offline_acceptance'][0]['criteria'][0]['description'])
        self.assertEqual(owner['status'], 'blocked')


if __name__ == '__main__':
    unittest.main()
