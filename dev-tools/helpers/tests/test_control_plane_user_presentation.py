"""User copy has no completion authority and cannot conceal unsafe or stale input."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane.common import digest
from control_plane.user_presentation import REFERENCE, UNAVAILABLE, apply_user_descriptions


def hashed(value):
    return hashlib.sha256(value.encode()).hexdigest()


class UserPresentationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='user-copy-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = {'schemaVersion': 1, 'slug': 'fixture', 'name': 'Technical roadmap', 'objective': 'Technical objective',
            'increments': [{'id': 'one', 'title': 'Technical increment', 'objective': 'Technical increment objective',
                            'acceptanceCriteria': [{'id': 'guard', 'description': 'Technical admission: preserve3.5GiB.', 'qualification': 'controlled-environment'}]}]}
        self.state_path = self.root/'.implementation-roadmaps/fixture/state.json'
        self.state_path.parent.mkdir(parents=True)
        self.state_path.write_text(json.dumps(self.source), encoding='utf-8')
        self.original = self.state_path.read_bytes()
        criterion = {'id': 'guard', 'description': self.source['increments'][0]['acceptanceCriteria'][0]['description'],
                     'requirements': [{'text': 'Technical admission: preserve3.5GiB.'}], 'qualification': 'controlled-environment',
                     'outcome': 'pending', 'evidence_summary': 'Internal diagnostic narrative', 'supporting_work': [
                         {'scope': 'Technical snapshot scope', 'limitations': ['No current qualification'], 'status': 'record-unavailable', 'current_qualification': 'not-asserted'}]}
        self.value = {'roadmaps': [{'id': 'fixture', 'title': self.source['name'], 'objective': self.source['objective'], 'status': 'executing',
                                   'increments': [{'id': 'one', 'title': 'Technical increment', 'objective': 'Technical increment objective', 'criteria': [criterion]}]}],
                      'work_items': [], 'diagnostics': [], 'source_digest': 'old', 'generated_at': 'now', 'repository_id': 'fixture'}
        self.document = {'schema_version': 'roadmap-user-descriptions-v1', 'criteria': [
            {'roadmap_id': 'fixture', 'increment_id': 'one', 'criterion_id': 'guard', 'source_description_sha256': hashed(criterion['description']),
             'qualification': 'controlled-environment', 'user_description': {'purpose': 'Load the model only when enough memory is free.', 'owner': 'agent',
                 'next_action': 'The agent must test the memory check.', 'completion_proof': 'The check must pass and have a separate review.',
                 'requirements': ['Keep the3.5GiB memory requirement.', 'Refuse loading when memory is too low.']}}],
            'headings': [{'record_type': 'roadmap', 'roadmap_id': 'fixture', 'source_title_objective_digest': digest({'title': self.source['name'], 'objective': self.source['objective']}),
                          'user_description': {'title': 'Clear roadmap', 'purpose': 'Make model loading safe.', 'scope': []}},
                         {'record_type': 'increment', 'roadmap_id': 'fixture', 'increment_id': 'one', 'source_title_objective_digest': digest({'title': 'Technical increment', 'objective': 'Technical increment objective'}),
                          'user_description': {'title': 'Test safe loading', 'purpose': 'Test the memory check.', 'scope': ['Preserve the guard.']}}],
            'support': [{'kind': 'support-scope', 'source_text_sha256': hashed('Technical snapshot scope'), 'user_description': {'owner': 'agent', 'sentences': ['Earlier local work was checked.']}},
                        {'kind': 'support-limitation', 'source_text_sha256': hashed('No current qualification'), 'user_description': {'owner': 'agent', 'sentences': ['This does not prove the current software is ready.']}}]}

    def run_copy(self):
        path = self.root/REFERENCE
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.document), encoding='utf-8')
        result = apply_user_descriptions(self.root, copy.deepcopy(self.value))
        self.assertEqual(self.state_path.read_bytes(), self.original)
        self.assertEqual(result['roadmaps'][0]['status'], 'executing')
        self.assertEqual(result['roadmaps'][0]['increments'][0]['criteria'][0]['outcome'], 'pending')
        return result

    def criterion(self, result):
        return result['roadmaps'][0]['increments'][0]['criteria'][0]

    def test_plain_bullets_actions_and_support_do_not_supply_a_pass(self):
        result = self.run_copy();criterion = self.criterion(result)
        self.assertEqual(result['diagnostics'], [])
        self.assertEqual(result['roadmaps'][0]['title'], 'Clear roadmap')
        self.assertEqual([x['text'] for x in criterion['requirements']], self.document['criteria'][0]['user_description']['requirements'])
        self.assertNotIn('Technical admission', json.dumps(result))
        self.assertTrue(criterion['evidence_recorded'])
        self.assertEqual(criterion['evidence_summary'], '')
        support = criterion['supporting_work'][0]
        self.assertEqual(support['status'], 'record-unavailable')
        self.assertEqual(support['current_qualification'], 'not-asserted')
        self.assertEqual(support['scope'], 'Earlier local work was checked.')

    def test_stale_description_and_qualification_refuse_only_the_affected_copy(self):
        for key, value in [('source_description_sha256', '0'*64), ('qualification', 'local')]:
            with self.subTest(key=key):
                original = copy.deepcopy(self.document)
                self.document['criteria'][0][key] = value
                result = self.run_copy()
                self.assertEqual(self.criterion(result)['description'], UNAVAILABLE)
                self.assertEqual(result['roadmaps'][0]['title'], 'Clear roadmap')
                self.document = original

    def test_duplicate_criterion_removes_the_previously_admitted_copy(self):
        self.document['criteria'].append(copy.deepcopy(self.document['criteria'][0]))
        self.assertEqual(self.criterion(self.run_copy())['description'], UNAVAILABLE)

    def test_foreign_identity_cannot_replace_a_real_criterion(self):
        self.document['criteria'][0]['criterion_id'] = 'other'
        result = self.run_copy()
        self.assertEqual(self.criterion(result)['description'], UNAVAILABLE)
        self.assertTrue(result['diagnostics'])

    def test_joined_fragments_cannot_disclose_credentials(self):
        self.document['criteria'][0]['user_description']['requirements'] = ['token:', 'hidden-value']
        result = self.run_copy()
        self.assertNotIn('hidden-value', json.dumps(result))
        self.assertEqual(self.criterion(result)['description'], UNAVAILABLE)

    def test_requirement_bounds_preserve_the_maximum_and_refuse_oversized_text(self):
        self.document['criteria'][0]['user_description']['requirements'] = ['x'*1500]
        self.assertEqual(self.criterion(self.run_copy())['requirements'], [{'text': 'x'*1500}])
        self.document['criteria'][0]['user_description']['requirements'] = ['x'*1501]
        result = self.run_copy()
        self.assertEqual(self.criterion(result)['description'], UNAVAILABLE)
        self.assertTrue(result['diagnostics'])

    def test_nonobject_headings_use_neutral_recovery_instead_of_an_exception(self):
        for row in (None, 1, True, 'heading', []):
            with self.subTest(row=row):
                self.document['headings'] = [row]
                result = self.run_copy()
                self.assertEqual(result['roadmaps'][0]['title'], 'Description update needed')
                self.assertNotEqual(self.criterion(result)['description'], UNAVAILABLE)
                self.assertTrue(result['diagnostics'])

    def test_unicode_codepoint_bounds_match_the_browser_and_refuse_invalid_unicode(self):
        self.document['criteria'][0]['user_description'].update(requirements=['\U0001f600'*1500], next_action='\U0001f600'*2000, completion_proof='\U0001f600'*2000)
        result = self.run_copy()
        self.assertFalse(result['diagnostics'])
        self.assertEqual(len(self.criterion(result)['requirements'][0]['text']), 1500)
        self.assertEqual(len(self.criterion(result)['user_instructions']['next_action']), 2000)
        self.document['criteria'][0]['user_description']['requirements'] = ['\U0001f600'*1501]
        self.assertEqual(self.criterion(self.run_copy())['description'], UNAVAILABLE)
        self.document['criteria'][0]['user_description']['requirements'] = ['\ud800']
        self.assertEqual(self.criterion(self.run_copy())['description'], UNAVAILABLE)

    def test_copy_cannot_assign_human_authority_or_launder_compact_secret_fragments(self):
        for mutation in (lambda: self.document['criteria'][0]['user_description'].update(owner='human'),
                         lambda: self.document['criteria'][0]['user_description'].update(requirements=['tok', 'en: hidden-value'])):
            with self.subTest(mutation=mutation):
                original = copy.deepcopy(self.document);mutation()
                result = self.run_copy()
                self.assertEqual(self.criterion(result)['description'], UNAVAILABLE)
                self.assertEqual(self.criterion(result)['user_instructions']['owner'], 'agent')
                self.assertNotIn('hidden-value', json.dumps(result))
                self.document = original

    def test_missing_schema_unknown_fields_and_row_bounds_fail_closed(self):
        for mutation in [lambda: self.document.update(schema_version='unknown'), lambda: self.document.update(authority='approved'),
                         lambda: self.document.update(headings=self.document['headings']*501)]:
            with self.subTest(mutation=mutation):
                original = copy.deepcopy(self.document);mutation()
                result = self.run_copy()
                self.assertEqual(self.criterion(result)['description'], UNAVAILABLE)
                self.assertEqual(result['roadmaps'][0]['title'], 'Description update needed')
                self.document = original

    def test_stale_heading_and_duplicate_support_cannot_expose_original_prose(self):
        self.document['headings'][0]['source_title_objective_digest'] = '0'*64
        self.document['support'].append(copy.deepcopy(self.document['support'][0]))
        result = self.run_copy()
        self.assertEqual(result['roadmaps'][0]['title'], 'Description update needed')
        self.assertEqual(self.criterion(result)['supporting_work'][0]['scope'], UNAVAILABLE)

    def test_merged_history_uses_its_own_source_and_preserves_its_old_outcome(self):
        legacy = copy.deepcopy(self.source);legacy['slug'] = 'legacy'
        path = self.root/'.implementation-roadmaps/legacy/state.json';path.parent.mkdir();path.write_text(json.dumps(legacy), encoding='utf-8')
        history = copy.deepcopy(self.value['roadmaps'][0]);history['id'] = 'legacy';history['status'] = 'blocked';history['increments'][0]['criteria'][0]['outcome'] = 'passed'
        self.value['roadmaps'][0]['merged_history'] = [history]
        for family in ('criteria', 'headings'):
            for row in copy.deepcopy(self.document[family]):
                row['roadmap_id'] = 'legacy';self.document[family].append(row)
        result = self.run_copy();old = result['roadmaps'][0]['merged_history'][0]
        self.assertEqual(old['title'], 'Clear roadmap')
        self.assertEqual(old['increments'][0]['criteria'][0]['outcome'], 'passed')
        self.assertEqual(old['status'], 'blocked')
        self.assertEqual(json.loads(path.read_text(encoding='utf-8')), legacy)


if __name__ == '__main__':
    unittest.main()
