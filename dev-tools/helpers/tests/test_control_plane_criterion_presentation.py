"""Lossless presentation cannot change or qualify canonical acceptance."""
from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane.criterion_presentation import BLOCKER_REFERENCE, REFERENCE, apply_presentations
from control_plane.projection import project


class CriterionPresentationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="criterion-presentation-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.description = "Models load safely. Memory, staging and cleanup stay bounded."
        self.row = {
            "roadmap_id": "fixture", "increment_id": "one", "criterion_id": "bounded",
            "source_description_sha256": hashlib.sha256(self.description.encode()).hexdigest(),
            "requirements": [
                {"text": "Models load safely."},
                {"text": "Memory,", "children": [{"text": "staging and cleanup stay bounded."}]}
            ]
        }
        self.state = {
            "schemaVersion": 1, "slug": "fixture", "name": "Fixture", "status": "blocked",
            "objective": "Keep acceptance unchanged", "currentIncrementId": "one",
            "roadmapApproval": {"fingerprint": "original", "note": "private-authority-note"},
            "evidence": [{"incrementId": "one", "criterionId": "bounded", "outcome": "pending", "summary": "Actual model execution pending"}],
            "increments": [{"id": "one", "number": 1, "title": "One", "objective": "Qualify behavior",
                            "status": "blocked", "completedChunks": [], "acceptanceCriteria": [
                                {"id": "bounded", "description": self.description, "qualification": "controlled-environment"}
                            ]}]
        }
        path = self.root / ".implementation-roadmaps/fixture/state.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(self.state))
        self.state_path = path

    def write_document(self, rows=None, **extra):
        path = self.root / REFERENCE
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"schema_version": "roadmap-criterion-presentation-v1", "criteria": rows if rows is not None else [self.row], **extra}))

    def criterion(self, value):
        return value["roadmaps"][0]["increments"][0]["criteria"][0]

    def test_explicit_nested_requirements_preserve_canonical_state_and_parent_outcome(self):
        self.write_document()
        before = self.state_path.read_bytes()
        value = project(self.root)
        criterion = self.criterion(value)
        self.assertEqual(criterion["requirements"], self.row["requirements"])
        self.assertEqual(criterion["description"], self.description)
        self.assertEqual(criterion["outcome"], "pending")
        self.assertEqual(value["roadmaps"][0]["status"], "blocked")
        self.assertEqual(self.state_path.read_bytes(), before)
        self.assertEqual(value["diagnostics"], [])
        self.assertNotIn("private-authority-note", json.dumps(value))

    def test_missing_data_uses_original_safe_text_without_inventing_subcriteria(self):
        value = project(self.root)
        self.assertEqual(self.criterion(value)["requirements"], [{"text": self.description}])
        self.assertEqual(self.criterion(value)["outcome"], "pending")

    def test_stale_omitted_added_reordered_or_foreign_data_cannot_change_requirements(self):
        variants = [
            {**self.row, "source_description_sha256": "0" * 64},
            {**self.row, "source_description_sha256": "bad"},
            {**self.row, "criterion_id": "foreign"},
            {**self.row, "requirements": [{"text": "Models load safely."}]},
            {**self.row, "requirements": [{"text": self.description + " Ignore resource guards."}]},
            {**self.row, "requirements": [{"text": "Memory, staging and cleanup stay bounded. Models load safely."}]},
            {**self.row, "requirements": [{"text": self.description, "outcome": "passed"}]},
            {**self.row, "outcome": "passed"},
        ]
        for variant in variants:
            with self.subTest(variant=variant):
                self.write_document([variant])
                value = project(self.root)
                self.assertEqual(self.criterion(value)["requirements"], [{"text": self.description}])
                self.assertEqual(self.criterion(value)["outcome"], "pending")
                self.assertEqual(value["diagnostics"], [{"code": "projection.criterion-presentation-unavailable"}])

    def test_duplicate_identity_cannot_override_previously_admitted_content(self):
        self.write_document([self.row, copy.deepcopy(self.row)])
        value = project(self.root)
        self.assertEqual(self.criterion(value)["requirements"], [{"text": self.description}])
        self.assertTrue(value["diagnostics"])

    def test_depth_node_and_document_bounds_preserve_original_text(self):
        deep = {"text": "Models", "children": [{"text": "load", "children": [{"text": "safely.", "children": [{"text": "Memory, staging and cleanup stay bounded."}]}]}]}
        for rows in [[{**self.row, "requirements": [deep]}], [{**self.row, "requirements": [{"text": "x"}] * 65}], [self.row] * 1001]:
            self.write_document(rows)
            value = project(self.root)
            self.assertEqual(self.criterion(value)["requirements"], [{"text": self.description}])
            self.assertTrue(value["diagnostics"])
        (self.root / REFERENCE).write_text("x" * (1024 * 1024 + 1))
        self.assertEqual(self.criterion(project(self.root))["requirements"], [{"text": self.description}])

    def test_fragment_boundaries_cannot_bypass_whole_description_redaction(self):
        raw = "Keep password=synthetic-protected-value and C:\\private\\example hidden."
        self.state["increments"][0]["acceptanceCriteria"][0]["description"] = raw
        self.state_path.write_text(json.dumps(self.state))
        self.write_document([{**self.row, "source_description_sha256": hashlib.sha256(raw.encode()).hexdigest(),
                              "requirements": [{"text": "Keep password="}, {"text": "synthetic-protected-value and C:\\private\\example hidden."}]}])
        value = project(self.root)
        public = json.dumps(value)
        self.assertNotIn("synthetic-protected-value", public)
        self.assertNotIn("C:\\\\private", public)
        self.assertEqual(self.criterion(value)["requirements"], [{"text": self.criterion(value)["description"]}])


    def test_increment_proposal_exposes_only_bounded_safe_public_fields(self):
        increment = self.state['increments'][0]
        increment.update({
            'workPackages': [{'id': 'one-package', 'title': '<img src=x> review',
                              'outcome': 'Keep password=synthetic-private and C:\\private\\example hidden.',
                              'authority': 'private-package-authority'}],
            'deliverables': ['Safe deliverable', {'private': 'must-not-serialize'}],
            'verification': ['Run bounded checks'], 'rollback': 'Restore the secure path',
            'dependsOn': ['prior-increment', 'C:\\private\\example'],
            'excluded': ['External provider'], 'research': {'private': 'private-research-sentinel'},
        })
        self.state['status'] = 'roadmap-review'
        self.state['roadmapApproval'] = None
        increment['status'] = 'pending'
        self.state_path.write_text(json.dumps(self.state))
        value = project(self.root)
        public = json.dumps(value)
        projected = value['roadmaps'][0]['increments'][0]
        self.assertTrue(projected['chunk_plan_pending_approval'])
        self.assertFalse(projected['chunk_plan_pending_start'])
        self.assertEqual(projected['proposal']['deliverables'], ['Safe deliverable'])
        self.assertEqual(projected['proposal']['verification'], ['Run bounded checks'])
        self.assertEqual(projected['proposal']['depends_on'][0], 'prior-increment')
        for private in ['synthetic-private', 'private-package-authority', 'must-not-serialize', 'private-research-sentinel']:
            self.assertNotIn(private, public)
        self.assertNotIn('C:\\\\private', public)
        self.assertNotIn('authority', projected['proposal']['work_packages'][0])
        self.state['roadmapApproval'] = {'fingerprint': 'supplied-approval'}
        self.state['status'] = 'executing'
        self.state_path.write_text(json.dumps(self.state))
        approved = project(self.root)['roadmaps'][0]['increments'][0]
        self.assertFalse(approved['chunk_plan_pending_approval'])
        self.assertTrue(approved['chunk_plan_pending_start'])
        increment['status'] = 'verifying'
        self.state_path.write_text(json.dumps(self.state))
        active = project(self.root)['roadmaps'][0]['increments'][0]
        self.assertFalse(active['chunk_plan_pending_start'])

    def test_proposal_collections_and_strings_are_bounded_and_malformed_values_ignored(self):
        increment = self.state['increments'][0]
        increment.update({'workPackages': [{'id': 'p', 'title': 'x' * 500, 'outcome': 'y' * 2000}] * 45,
                          'deliverables': ['z' * 2000] * 45, 'verification': {'private': 'hidden'},
                          'excluded': [None, 4], 'rollback': ['private-malformed-rollback'], 'dependsOn': ['a' * 100] * 45})
        self.state_path.write_text(json.dumps(self.state))
        proposal = project(self.root)['roadmaps'][0]['increments'][0]['proposal']
        self.assertEqual(len(proposal['work_packages']), 40)
        self.assertLessEqual(len(proposal['work_packages'][0]['title']), 240)
        self.assertLessEqual(len(proposal['work_packages'][0]['outcome']), 1600)
        self.assertEqual(len(proposal['deliverables']), 40)
        self.assertTrue(all(len(text) <= 1600 for text in proposal['deliverables']))
        self.assertEqual(proposal['verification'], [])
        self.assertEqual(proposal['excluded'], [])
        self.assertEqual(proposal['rollback'], '')
        self.assertEqual(len(proposal['depends_on']), 40)
        self.assertTrue(all(len(text) <= 80 for text in proposal['depends_on']))

    def test_versioned_presentations_are_lossless_when_current_and_fall_back_on_drift(self):
        from control_plane.common import safe_text
        root = Path(__file__).resolve().parents[3]
        document = json.loads((root / REFERENCE).read_text(encoding='utf-8'))
        roadmaps = []
        state_bytes = {}
        count = 0
        for path in sorted((root / '.implementation-roadmaps').glob('*/state.json')):
            state_bytes[path] = path.read_bytes()
            state = json.loads(state_bytes[path])
            increments = [{'id': i['id'], 'criteria': [{'id': c['id'], 'description': safe_text(c['description'], 1500)}
                                                     for c in i['acceptanceCriteria']]} for i in state['increments']]
            count += sum(len(i['criteria']) for i in increments)
            roadmaps.append({'id': state['slug'], 'increments': increments})
        diagnostics = []
        apply_presentations(root, roadmaps, diagnostics)
        identities = [(row['roadmap_id'], row['increment_id'], row['criterion_id']) for row in document['criteria']]
        self.assertEqual(len(set(identities)), len(identities))
        by_identity = {identity: row for identity, row in zip(identities, document['criteria'])}
        for roadmap in roadmaps:
            for increment in roadmap['increments']:
                for criterion in increment['criteria']:
                    self.assertTrue(criterion['requirements'])
                    key = (roadmap['id'], increment['id'], criterion['id'])
                    row = by_identity.get(key)
                    if row and row['source_description_sha256'] == hashlib.sha256(criterion['description'].encode()).hexdigest():
                        self.assertEqual(criterion['requirements'], row['requirements'])
                    else:
                        self.assertEqual(criterion['requirements'], [{'text': criterion['description']}])
                    # Complete source clauses may end in commas; logical grouping
                    # receives independent semantic review rather than punctuation inference.
        self.assertTrue(all(path.read_bytes() == before for path, before in state_bytes.items()))

    def test_execution_inventory_includes_current_records_after_the_old_200_cap(self):
        from unittest.mock import patch
        from control_plane.records import Records
        records = Records.empty()
        for number in range(209):
            identity = 'work-' + str(number).zfill(4)
            records['work_items'][identity] = {
                'spec': {'work_id': identity, 'title': 'Owned work', 'kind': 'lightweight', 'outcome': {'success': 'Safe recorded outcome'}},
                'status': 'active', 'events': [{'at': '2026-10-23T00:' + str(number // 60).zfill(2) + ':' + str(number % 60).zfill(2) + 'Z'}],
            }
        with patch.object(Records, 'load', return_value=records):
            value = project(self.root)
        works = [row for row in value['work_items'] if row['source'] == 'execution']
        self.assertEqual(len(works), 209)
        self.assertEqual(works[0]['id'], 'work-0208')
        self.assertEqual(value['inventory'], {'execution_records_total': 209, 'execution_records_shown': 209, 'execution_records_truncated': False})
        self.assertEqual(value['diagnostics'], [])
        for number in range(209, 1002):
            identity = 'work-' + str(number).zfill(4)
            records['work_items'][identity] = {
                'spec': {'work_id': identity, 'title': 'Owned work', 'kind': 'lightweight', 'outcome': {'success': 'Safe recorded outcome'}},
                'status': 'active', 'events': [{'at': '2026-10-23T00:' + str(number // 60).zfill(2) + ':' + str(number % 60).zfill(2) + 'Z'}],
            }
        with patch.object(Records, 'load', return_value=records):
            value = project(self.root)
        works = [row for row in value['work_items'] if row['source'] == 'execution']
        self.assertEqual(len(works), 1000)
        self.assertEqual(works[0]['id'], 'work-1001')
        self.assertEqual(value['inventory'], {'execution_records_total': 1002, 'execution_records_shown': 1000, 'execution_records_truncated': True})
        self.assertIn({'code': 'projection.execution-records-truncated', 'total': 1002, 'shown': 1000}, value['diagnostics'])

    def test_agent_work_is_pending_and_human_actions_remain_separate_without_a_pass(self):
        from control_plane.common import digest
        row = self.blocker_fixture()
        issue = self.state['blockers'][0]
        issue.update(actionOwner='agent', responsibleRole='Coding agent',
                     completionCondition='The required safe restart tests pass.')
        self.state['status'] = 'executing'
        self.state['increments'][0]['status'] = 'verifying'
        self.state_path.write_text(json.dumps(self.state))
        row['blockers'][0]['source_blocker_digest'] = digest(issue)
        row['blockers'][0]['plain_language'] = {
            'needed': 'Finish the safe restart tests.', 'prevents': 'A new low-memory run must wait for file safety tests.',
            'action': 'Finish the code and run the safe restart tests.', 'responsible_role': 'Coding agent',
            'user_action': 'None. The coding agent will continue.', 'done_when': 'The required tests pass and have an independent review.'}
        self.write_blocker_map([row])
        before = self.state_path.read_bytes()
        value = project(self.root)
        roadmap = value['roadmaps'][0]
        criterion = self.criterion(value)
        self.assertEqual(roadmap['status'], 'executing')
        self.assertEqual(roadmap['blocker_count'], 0)
        self.assertEqual(roadmap['blockers'], [])
        self.assertEqual(len(roadmap['pending_work']), 1)
        self.assertEqual(criterion['blockers'], [])
        self.assertEqual(criterion['pending_work'][0]['action_owner'], 'agent')
        self.assertEqual(criterion['pending_work'][0]['plain_language']['user_action'], 'None. The coding agent will continue.')
        self.assertEqual(criterion['outcome'], 'pending')
        self.assertEqual(self.state_path.read_bytes(), before)
        self.assertEqual(value['diagnostics'], [])
        # A source change invalidates explanations; the pending technical work remains visible.
        issue['completionCondition'] = 'A changed test requirement.'
        self.state_path.write_text(json.dumps(self.state))
        value = project(self.root)
        self.assertEqual(self.criterion(value)['pending_work'], [])
        self.assertEqual(len(value['roadmaps'][0]['pending_work']), 1)
        self.assertEqual(self.criterion(value)['outcome'], 'pending')
        self.assertTrue(value['diagnostics'])

    def test_only_actual_open_blockers_expose_safe_summary_and_action(self):
        self.state['blockers'] = [
            {'id': 'actual-gap', 'kind': 'technical', 'status': 'open', 'actionOwner': 'human',
             'summary': 'Resource qualification remains pending password=synthetic-blocker-secret.',
             'requiredAction': 'Collect safe evidence without C:\\private\\example.',
             'authorityRef': 'private-blocker-authority', 'resolution': 'private-resolution'},
            {'id': 'old-gap', 'kind': 'technical', 'status': 'resolved', 'summary': 'Resolved private history', 'requiredAction': 'Old private action'},
        ]
        self.state_path.write_text(json.dumps(self.state))
        value = project(self.root)
        roadmap = value['roadmaps'][0]
        self.assertEqual(roadmap['blocker_count'], 1)
        self.assertEqual(len(roadmap['blockers']), 1)
        self.assertEqual(set(roadmap['blockers'][0]), {'id', 'kind', 'summary', 'required_action', 'action_owner'})
        for private in ['synthetic-blocker-secret', 'private-blocker-authority', 'private-resolution', 'Resolved private history', 'Old private action', 'C:\\\\private']:
            self.assertNotIn(private, json.dumps(value))
        self.state['blockers'] = [self.state['blockers'][0]] * 45
        self.state_path.write_text(json.dumps(self.state))
        value = project(self.root)
        self.assertEqual(value['roadmaps'][0]['blocker_count'], 45)
        self.assertEqual(len(value['roadmaps'][0]['blockers']), 40)

    def test_many_earlier_agent_items_cannot_hide_a_later_human_request(self):
        agent = {'id': 'agent-task', 'kind': 'technical', 'status': 'open', 'actionOwner': 'agent',
                 'summary': 'Agent code remains.', 'requiredAction': 'Complete the approved code.'}
        human = {'id': 'human-action', 'kind': 'dependency', 'status': 'open', 'actionOwner': 'human',
                 'summary': 'Arrange a permitted review.', 'requiredAction': 'Supply a permitted independent review.'}
        self.state['blockers'] = [dict(agent, id='agent-' + str(n)) for n in range(45)] + [human]
        self.state_path.write_text(json.dumps(self.state))
        roadmap = project(self.root)['roadmaps'][0]
        self.assertEqual(roadmap['blocker_count'], 1)
        self.assertEqual(roadmap['blockers'][0]['id'], 'human-action')
        self.assertEqual(roadmap['pending_work_count'], 45)
        self.assertEqual(len(roadmap['pending_work']), 39)

    def test_execution_byte_admission_keeps_response_bounded_and_reports_actual_inventory(self):
        from unittest.mock import patch
        from control_plane.records import Records
        records = Records.empty()
        for number in range(1000):
            identity = 'work-' + str(number).zfill(4)
            records['work_items'][identity] = {
                'spec': {'work_id': identity, 'title': 'Owned work', 'kind': 'lightweight',
                         'outcome': {'problem': 'x' * 1000, 'success': 'y' * 1000, 'constraints': 'z' * 1000}},
                'status': 'active', 'created_at': f'2026-10-23T{number // 3600:02}:{number // 60 % 60:02}:{number % 60:02}Z',
                'events': [{'at': '2026-10-23T00:00:00Z'}],
            }
        with patch.object(Records, 'load', return_value=records):
            value = project(self.root)
        shown = value['inventory']['execution_records_shown']
        self.assertGreater(shown, 200)
        self.assertLess(shown, 1000)
        self.assertLess(len(json.dumps(value).encode()), 2 * 1024 * 1024)
        self.assertEqual(value['inventory']['execution_records_total'], 1000)
        self.assertTrue(value['inventory']['execution_records_truncated'])
        self.assertEqual(value['work_items'][0]['id'], 'work-0999')
        self.assertIn({'code': 'projection.execution-records-truncated', 'total': 1000, 'shown': shown}, value['diagnostics'])

    def test_unrendered_execution_notes_do_not_displace_public_work_summaries(self):
        from unittest.mock import patch
        from control_plane.records import Records
        records = Records.empty()
        for number in range(300):
            identity = 'work-' + str(number).zfill(4)
            records['work_items'][identity] = {
                'spec': {'work_id': identity, 'title': 'Owned work', 'kind': 'lightweight',
                         'outcome': {key: key + ':' + 'x' * 990 for key in
                                     ('user', 'journey', 'baseline', 'problem', 'success', 'quality', 'internal_rationale')}},
                'status': 'complete', 'created_at': f'2026-10-23T00:{number // 60:02}:{number % 60:02}Z',
                'events': [{'at': '2026-10-23T00:00:00Z'}],
            }
        original = json.dumps(records, sort_keys=True)
        with patch.object(Records, 'load', return_value=records):
            value = project(self.root)
        works = [row for row in value['work_items'] if row['source'] == 'execution']
        self.assertEqual(value['inventory'], {'execution_records_total': 300, 'execution_records_shown': 300,
                                              'execution_records_truncated': False})
        self.assertEqual(works[0]['id'], 'work-0299')
        self.assertEqual(works[-1]['id'], 'work-0000')
        self.assertTrue(all(set(row['outcome']) == {'success', 'problem'} for row in works))
        self.assertLess(len(json.dumps(value).encode()), 2 * 1024 * 1024)
        self.assertEqual(json.dumps(records, sort_keys=True), original)

    def test_current_repository_response_deduplicates_linked_criteria_without_losing_canonical_detail(self):
        value = project(Path(__file__).resolve().parents[3])
        self.assertLess(len(json.dumps(value).encode()), 2 * 1024 * 1024)
        for work in value['work_items']:
            if work['source'] != 'roadmap-chunk':
                continue
            roadmap = next(row for row in value['roadmaps'] if row['id'] == work['roadmap_id'])
            increment = next(row for row in roadmap['increments'] if row['id'] == work['increment_id'])
            for criterion in work['criteria']:
                self.assertLessEqual(set(criterion), {'id', 'outcome', 'qualification', 'evaluation_mode'})
                original = next(row for row in increment['criteria'] if row['id'] == criterion['id'])
                self.assertTrue(original['description'])
                self.assertTrue(original['requirements'])
                self.assertEqual(criterion['outcome'], original['outcome'])


    def blocker_fixture(self):
        from control_plane.common import digest
        blocker = {'id': 'provider-qualification', 'kind': 'controlled-environment', 'status': 'open', 'actionOwner': 'human',
                   'summary': 'Private provider qualification needs operator credentials.',
                   'requiredAction': 'Supply an authorized private test repository and credential through the approved secret store.',
                   'authorityRef': 'private-authority-sentinel'}
        self.state['blockers'] = [blocker]
        self.state_path.write_text(json.dumps(self.state))
        return {'roadmap_id': 'fixture', 'increment_id': 'one', 'criterion_id': 'bounded',
                'source_description_sha256': hashlib.sha256(self.description.encode()).hexdigest(),
                'blockers': [{'blocker_id': blocker['id'], 'source_blocker_digest': digest(blocker),
                              'prevents': 'Executing the private provider publication test requires an authorized private repository and credential.'}]}

    def write_blocker_map(self, rows):
        path = self.root / BLOCKER_REFERENCE
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'schema_version': 'roadmap-criterion-blockers-v1', 'criteria': rows}))

    def test_criterion_blockers_are_explicit_current_and_independent_from_outcome(self):
        row = self.blocker_fixture()
        self.state['increments'][0]['acceptanceCriteria'].append({'id': 'unaffected', 'description': 'Independent work remains independent.'})
        self.state_path.write_text(json.dumps(self.state))
        self.write_blocker_map([row])
        before = self.state_path.read_bytes()
        value = project(self.root)
        criteria = value['roadmaps'][0]['increments'][0]['criteria']
        self.assertEqual(len(criteria[0]['blockers']), 1)
        self.assertEqual(criteria[0]['blockers'][0]['prevents'], row['blockers'][0]['prevents'])
        self.assertEqual(criteria[0]['blockers'][0]['summary'], self.state['blockers'][0]['summary'])
        self.assertEqual(criteria[0]['blockers'][0]['required_action'], self.state['blockers'][0]['requiredAction'])
        self.assertEqual(criteria[0]['outcome'], 'pending')
        self.assertEqual(criteria[1]['blockers'], [])
        self.assertEqual(value['diagnostics'], [])
        self.assertNotIn('private-authority-sentinel', json.dumps(value))
        self.assertEqual(self.state_path.read_bytes(), before)

    def test_missing_stale_foreign_duplicate_or_oversized_map_keeps_parent_obstacle_visible(self):
        row = self.blocker_fixture()
        value = project(self.root)
        self.assertEqual(self.criterion(value)['blockers'], [])
        self.assertEqual(value['roadmaps'][0]['blocker_count'], 1)
        self.assertEqual(len(value['roadmaps'][0]['blockers']), 1)
        self.assertIn({'code': 'projection.criterion-blockers-unavailable'}, value['diagnostics'])
        variants = [
            [{**row, 'source_description_sha256': '0' * 64}],
            [{**row, 'criterion_id': 'foreign'}],
            [{**row, 'roadmap_id': 'foreign'}],
            [{**row, 'increment_id': 'foreign'}],
            [{**row, 'blockers': [{**row['blockers'][0], 'source_blocker_digest': '0' * 64}]}],
            [{**row, 'blockers': [{**row['blockers'][0], 'blocker_id': 'foreign'}]}],
            [{**row, 'blockers': [{**row['blockers'][0], 'prevents': 'x' * 801}]}],
            [{**row, 'blockers': [{**row['blockers'][0], 'outcome': 'passed'}]}],
            [{**row, 'blockers': row['blockers'] * 2}],
            [row, copy.deepcopy(row)],
            [row] * 1001,
        ]
        for rows in variants:
            with self.subTest(rows=len(rows)):
                self.write_blocker_map(rows)
                value = project(self.root)
                self.assertEqual(self.criterion(value)['blockers'], [])
                self.assertEqual(self.criterion(value)['outcome'], 'pending')
                self.assertEqual(len(value['roadmaps'][0]['blockers']), 1)
                self.assertIn({'code': 'projection.criterion-blockers-unavailable'}, value['diagnostics'])

    def test_resolved_or_changed_canonical_blocker_is_never_reused_as_stale_detail(self):
        row = self.blocker_fixture()
        self.write_blocker_map([row])
        self.state['blockers'][0]['summary'] = 'Changed actual source obstacle.'
        self.state_path.write_text(json.dumps(self.state))
        value = project(self.root)
        self.assertEqual(self.criterion(value)['blockers'], [])
        self.assertEqual(value['roadmaps'][0]['blockers'][0]['summary'], 'Changed actual source obstacle.')
        self.state['blockers'][0]['status'] = 'resolved'
        self.state_path.write_text(json.dumps(self.state))
        value = project(self.root)
        self.assertEqual(self.criterion(value)['blockers'], [])
        self.assertEqual(value['roadmaps'][0]['blockers'], [])
        self.assertIn({'code': 'projection.criterion-blockers-unavailable'}, value['diagnostics'])

    def test_blocker_operation_text_is_inert_bounded_and_sanitized(self):
        row = self.blocker_fixture()
        row['blockers'][0]['prevents'] = '<img src=x> password=synthetic-protected and C:\\private\\example remain private.'
        self.write_blocker_map([row])
        value = project(self.root)
        public = json.dumps(value)
        self.assertNotIn('synthetic-protected', public)
        self.assertNotIn('C:\\\\private', public)
        self.assertIn('<img src=x>', self.criterion(value)['blockers'][0]['prevents'])

    def test_plain_blocker_copy_is_optional_bound_and_retains_canonical_technical_facts(self):
        row = self.blocker_fixture()
        explanation = {'needed': 'Verify the supplied test access.',
                       'prevents': 'Access is authorized but the real test has not passed.',
                       'action': 'Run the authorized synthetic test through the secure credential path.'}
        row['blockers'][0]['plain_language'] = explanation
        self.write_blocker_map([row])
        before = self.state_path.read_bytes()
        value = project(self.root)
        criterion = self.criterion(value)
        blocker = criterion['blockers'][0]
        self.assertEqual(blocker['plain_language'], explanation)
        self.assertEqual(value['roadmaps'][0]['blockers'][0]['plain_language'], explanation)
        self.assertEqual(blocker['summary'], self.state['blockers'][0]['summary'])
        self.assertEqual(blocker['required_action'], self.state['blockers'][0]['requiredAction'])
        self.assertEqual(criterion['outcome'], 'pending')
        self.assertEqual(value['roadmaps'][0]['status'], 'blocked')
        self.assertEqual(value['diagnostics'], [])
        self.assertEqual(self.state_path.read_bytes(), before)
        self.state['blockers'][0]['summary'] = 'Current canonical obstacle changed.'
        self.state_path.write_text(json.dumps(self.state))
        value = project(self.root)
        self.assertNotIn('plain_language', value['roadmaps'][0]['blockers'][0])
        self.assertEqual(self.criterion(value)['blockers'], [])
        self.assertTrue(value['diagnostics'])

    def test_malformed_plain_copy_keeps_canonical_parent_obstacle_and_sanitizes_valid_text(self):
        row = self.blocker_fixture()
        valid = {'needed': 'Verification remains pending.', 'prevents': 'The test has not run.', 'action': 'Run the allowed check.'}
        variants = [None, [], {}, {**valid, 'unknown': 'not allowed'}, {k: v for k, v in valid.items() if k != 'action'},
                    {**valid, 'needed': 'x' * 401}, {**valid, 'prevents': 'x' * 801},
                    {**valid, 'action': 'x' * 801}, {**valid, 'action': ''}, {**valid, 'needed': 42}]
        for copy_value in variants:
            with self.subTest(copy_value=type(copy_value).__name__):
                row['blockers'][0]['plain_language'] = copy_value
                self.write_blocker_map([row])
                value = project(self.root)
                parent = value['roadmaps'][0]['blockers'][0]
                self.assertNotIn('plain_language', parent)
                self.assertEqual(parent['summary'], self.state['blockers'][0]['summary'])
                self.assertEqual(parent['required_action'], self.state['blockers'][0]['requiredAction'])
                self.assertEqual(self.criterion(value)['blockers'], [])
                self.assertTrue(value['diagnostics'])
        row['blockers'][0]['plain_language'] = {**valid, 'needed': '<img src=x> password=synthetic-copy-secret C:\\private\\fixture'}
        self.write_blocker_map([row])
        public = json.dumps(project(self.root))
        self.assertNotIn('synthetic-copy-secret', public)
        self.assertNotIn('C:\\\\private', public)
        self.assertIn('<img src=x>', public)

    def test_conflicting_shared_blocker_copy_falls_back_without_hiding_technical_obstacles(self):
        row = self.blocker_fixture()
        row['blockers'][0]['plain_language'] = {'needed': 'Verify access.', 'prevents': 'Verification is pending.', 'action': 'Run the allowed check.'}
        second = copy.deepcopy(row)
        second['criterion_id'] = 'second'
        second['blockers'][0]['plain_language']['needed'] = 'A conflicting explanation.'
        self.state['increments'][0]['acceptanceCriteria'].append({'id': 'second', 'description': self.description})
        self.state_path.write_text(json.dumps(self.state))
        self.write_blocker_map([row, second])
        value = project(self.root)
        self.assertNotIn('plain_language', value['roadmaps'][0]['blockers'][0])
        for criterion in value['roadmaps'][0]['increments'][0]['criteria']:
            self.assertEqual(len(criterion['blockers']), 1)
            self.assertNotIn('plain_language', criterion['blockers'][0])
        self.assertEqual(value['diagnostics'], [{'code': 'projection.criterion-blockers-unavailable'}])


if __name__ == "__main__":
    unittest.main()
