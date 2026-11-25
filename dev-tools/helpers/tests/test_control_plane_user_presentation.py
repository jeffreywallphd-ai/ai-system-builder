"""User copy has no completion authority and cannot conceal unsafe or stale input."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane.common import digest
from control_plane.projection import (CHUNK_REFERENCE_FORMAT, PAGE_SIZES, REVIEW_MAX_BYTES, chunk_reference,
    encode_review_projection, expanded_review_work_items, project, review_content, roadmap_chunk_work_items)
from control_plane.records import Records
from control_plane.user_presentation import (REFERENCE, REFERENCE_MAX_BYTES, REFERENCE_MAX_ROWS, SUPPORT_REFERENCE,
    UNAVAILABLE, apply_user_descriptions, compact_user_project, user_project)


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

    def write_companion(self, payload):
        path = self.root/SUPPORT_REFERENCE
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding='utf-8')
        return path

    def test_support_companion_extends_a_full_primary_registry_without_changing_work(self):
        scope = self.criterion(self.value)['supporting_work']
        template = scope[0]
        for index in range(REFERENCE_MAX_ROWS - len(self.document['support'])):
            source = f'Technical support item {index:04d}'
            scope.append({**template, 'scope': source})
            self.document['support'].append({'kind': 'support-scope', 'source_text_sha256': hashed(source),
                'user_description': {'owner': 'agent', 'sentences': ['Local evidence was reviewed.']}})
        self.assertEqual(len(self.document['support']), REFERENCE_MAX_ROWS)
        source = 'Technical activity recorded by the companion'
        scope.append({**template, 'scope': source})
        self.write_companion({'schema_version': 'roadmap-user-support-descriptions-v1', 'support': [
            {'kind': 'support-scope', 'source_text_sha256': hashed(source),
             'user_description': {'owner': 'agent', 'sentences': ['The file preview passed its check.']}}]})
        result = self.run_copy()
        self.assertEqual(result['diagnostics'], [])
        self.assertEqual(result['roadmaps'][0]['title'], 'Clear roadmap')
        rows = self.criterion(result)['supporting_work']
        self.assertEqual(rows[0]['scope'], 'Earlier local work was checked.')
        self.assertEqual(rows[-1]['scope'], 'The file preview passed its check.')
        self.assertEqual(rows[-1]['status'], 'record-unavailable')
        self.assertEqual(rows[-1]['current_qualification'], 'not-asserted')

    def test_companion_cannot_replace_the_primary_text_with_a_duplicate_or_unknown_source(self):
        duplicate = {**self.document['support'][0],
            'user_description': {'owner': 'agent', 'sentences': ['Unproved replacement.']}}
        self.write_companion({'schema_version': 'roadmap-user-support-descriptions-v1', 'support': [
            duplicate, {**duplicate, 'source_text_sha256': '0'*64}]})
        result = self.run_copy()
        self.assertEqual(self.criterion(result)['supporting_work'][0]['scope'], 'Earlier local work was checked.')
        self.assertEqual(self.criterion(result)['supporting_work'][0]['limitations'],
                         ['This does not prove the current software is ready.'])
        self.assertNotIn('Unproved replacement.', json.dumps(result))
        self.assertTrue(result['diagnostics'])
        self.document['support'].append(copy.deepcopy(self.document['support'][0]))
        result = self.run_copy()
        self.assertEqual(self.criterion(result)['supporting_work'][0]['scope'], UNAVAILABLE)
        self.assertNotIn('Unproved replacement.', json.dumps(result))

    def test_duplicate_rows_in_the_companion_quarantine_that_description_only(self):
        source = 'Technical standalone companion scope'
        rows = self.criterion(self.value)['supporting_work']
        rows.append({**rows[0], 'scope': source})
        entry = {'kind': 'support-scope', 'source_text_sha256': hashed(source),
                 'user_description': {'owner': 'agent', 'sentences': ['One extra reviewed result.']}}
        self.write_companion({'schema_version': 'roadmap-user-support-descriptions-v1', 'support': [entry, entry]})
        result = self.run_copy()
        projected = self.criterion(result)['supporting_work']
        self.assertEqual(projected[0]['scope'], 'Earlier local work was checked.')
        self.assertEqual(projected[1]['scope'], UNAVAILABLE)
        self.assertTrue(result['diagnostics'])

    def test_invalid_or_oversized_companion_retains_primary_copy(self):
        schema = 'roadmap-user-support-descriptions-v1'
        for payload in [
            {'schema_version': 'foreign', 'support': []},
            {'schema_version': schema, 'support': [], 'criteria': []},
            {'schema_version': schema, 'support': 'x' * REFERENCE_MAX_BYTES},
            {'schema_version': schema, 'support': [None] * (REFERENCE_MAX_ROWS + 1)},
        ]:
            with self.subTest(schema=payload['schema_version'], fields=list(payload), size=len(payload['support'])):
                self.write_companion(payload)
                result = self.run_copy()
                self.assertEqual(result['roadmaps'][0]['title'], 'Clear roadmap')
                self.assertEqual(self.criterion(result)['supporting_work'][0]['scope'], 'Earlier local work was checked.')
                self.assertTrue(result['diagnostics'])

    def test_compact_user_copy_keeps_exact_references_and_expands_current_plain_headings(self):
        self.run_copy()
        value = copy.deepcopy(self.value)
        value['work_item_format'] = CHUNK_REFERENCE_FORMAT
        roadmap = value['roadmaps'][0]
        roadmap['evidence_policy'] = 'control-plane-v1'
        increment = roadmap['increments'][0]
        increment['number'] = 1
        increment['chunks'] = [{'id': 'piece', 'chunk_number': 1, 'title': 'Piece', 'outcome': 'Build one useful component',
                                'criteria_ids': ['guard'], 'status': 'planned', 'created_at': None}]
        value['work_items'] = [chunk_reference(roadmap_chunk_work_items(value['roadmaps'])[0])]
        original_reference = copy.deepcopy(value['work_items'])
        with patch('control_plane.user_presentation.project', return_value=value) as project:
            result = compact_user_project(self.root)
        project.assert_called_once_with(self.root, compact_work_items=True)
        self.assertEqual(result['work_items'], original_reference)
        expanded = expanded_review_work_items(result)
        self.assertEqual(expanded[0]['roadmap_title'], 'Clear roadmap')
        self.assertEqual(expanded[0]['increment_title'], 'Test safe loading')
        self.assertEqual(expanded[0]['criteria'][0]['outcome'], 'pending')
        self.assertEqual(result['roadmaps'][0]['increments'][0]['criteria'][0]['description'],
                         'Load the model only when enough memory is free.')
        self.assertEqual(self.state_path.read_bytes(), self.original)

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

    def test_admitted_user_copy_expansion_is_bounded_after_formatting(self):
        self.document['criteria'][0]['user_description']['requirements'] = [
            'Read the test results. ' * 64 for _ in range(9)]
        path = self.root/REFERENCE
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.document), encoding='utf-8')
        base = copy.deepcopy(self.value)
        base['padding'] = 'x' * (REVIEW_MAX_BYTES - 45000)
        base['work_items'] = [{'source': 'execution', 'id': f'work-{n:02}',
            'created_at': f'2026-10-29T00:00:{n:02}Z', 'outcome': 'y' * 1000}
            for n in reversed(range(30))]
        base['inventory'] = {'execution_records_total': 30, 'execution_records_shown': 30,
                             'execution_records_truncated': False}
        before = copy.deepcopy(base)
        self.assertLess(len(encode_review_projection(base)), REVIEW_MAX_BYTES)
        expanded = apply_user_descriptions(self.root, copy.deepcopy(base))
        self.assertEqual(expanded['diagnostics'], [])
        self.assertGreater(len(encode_review_projection(expanded)), REVIEW_MAX_BYTES)
        with patch('control_plane.user_presentation.project', side_effect=lambda root: copy.deepcopy(base)):
            result = user_project(self.root)
        self.assertEqual(base, before)
        self.assertLessEqual(len(encode_review_projection(result)), REVIEW_MAX_BYTES)
        self.assertEqual(result['roadmaps'], expanded['roadmaps'])
        self.assertEqual(result['presentation_view'], 'user-v1')
        shown = result['inventory']['execution_records_shown']
        self.assertGreater(shown, 0)
        self.assertLess(shown, 30)
        self.assertEqual([r['id'] for r in result['work_items']], [r['id'] for r in base['work_items'][:shown]])
        self.assertEqual(self.criterion(result)['outcome'], 'pending')
        self.assertEqual(self.criterion(result)['supporting_work'][0]['status'], 'record-unavailable')
        self.assertEqual(self.state_path.read_bytes(), self.original)

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


class CurrentVersionedPresentationTests(unittest.TestCase):
    def test_current_metadata_admits_without_ignored_receipts_or_canonical_mutation(self):
        repository = Path(__file__).resolve().parents[3]
        for name in (REFERENCE, 'docs/operations/roadmap-supporting-work.json'):
            self.assertTrue((repository/name).is_file())
        sources = sorted((repository/'.implementation-roadmaps').glob('*/state.json'))
        self.assertTrue(0 < len(sources) <= 200)
        self.assertTrue(all(p.stat().st_size <= 2 * 1024 * 1024 for p in sources))
        before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
        with patch('control_plane.projection.Records.load', side_effect=lambda: Records.empty()):
            technical = review_content(repository, compact_work_items=True, paginated=True)
            user = apply_user_descriptions(repository, copy.deepcopy(technical))
            # Whole-response clients retain their original exact byte refusal.
            for compact in (False, True):
                raw = review_content(repository, compact_work_items=compact)
                if len(encode_review_projection({**raw, 'source_digest': '0' * 64})) > REVIEW_MAX_BYTES:
                    with self.assertRaisesRegex(ValueError, r'^Review projection exceeds its bound\.$'):
                        project(repository, compact_work_items=compact)
                else:
                    legacy = project(repository, compact_work_items=compact)
                    self.assertEqual(legacy['roadmaps'], technical['roadmaps'])
                    self.assertEqual(expanded_review_work_items(legacy), expanded_review_work_items(technical))
        self.assertEqual(technical['work_item_format'], CHUNK_REFERENCE_FORMAT)
        self.assertEqual(user['work_item_format'], CHUNK_REFERENCE_FORMAT)
        self.assertEqual(technical['diagnostics'], [])
        self.assertEqual(user['diagnostics'], [])

        def canonical_facts(value):
            result = copy.deepcopy(value)
            for key in ('source_digest', 'generated_at', 'repository_id', 'presentation_view'):
                result.pop(key, None)
            def visit(roadmap):
                for heading in [roadmap, *roadmap['increments']]:
                    for key in ('title', 'objective', 'user_scope'):
                        heading.pop(key, None)
                for increment in roadmap['increments']:
                    if 'stories' in increment:
                        for story in increment['stories']:
                            for key in ('title', 'outcome', 'user_scope'): story.pop(key, None)
                        for task in increment['chunks']:
                            for key in ('title', 'outcome', 'summary', 'tests', 'user_scope', 'verification_recorded'):
                                task.pop(key, None)
                        for package in increment.get('proposal', {}).get('work_packages', []):
                            package.pop('title', None); package.pop('outcome', None)
                    for criterion in increment['criteria']:
                        for key in ('description', 'requirements', 'user_instructions', 'evidence_summary', 'evidence_recorded'):
                            criterion.pop(key, None)
                        for support in criterion.get('supporting_work', []):
                            support.pop('scope', None)
                            support.pop('limitations', None)
                for history in roadmap.get('merged_history', []):
                    visit(history)
            for roadmap in [*result['roadmaps'], *result.get('work_item_roadmaps', [])]:
                visit(roadmap)
            for row in result['work_items']:
                row.pop('roadmap_title', None)
                row.pop('increment_title', None)
                if row.get('source') == 'roadmap-chunk' and 'story_id' in row:
                    for key in ('title', 'outcome', 'summary', 'tests', 'user_scope', 'verification_recorded'):
                        row.pop(key, None)
            return result

        self.assertEqual(canonical_facts(user), canonical_facts(technical))
        # Every selected record is reachable with complete technical/user facts.
        with patch('control_plane.projection.Records.load', side_effect=lambda: Records.empty()):
            for view, size in PAGE_SIZES.items():
                seen = []
                for number in range(1, max(1, (len(technical[view]) + size - 1) // size) + 1):
                    page = {'view': view, 'page': number}
                    technical_page = project(repository, compact_work_items=True, page=page)
                    user_page = compact_user_project(repository, page=page)
                    self.assertEqual(user_page['diagnostics'], [])
                    self.assertEqual(canonical_facts(user_page), canonical_facts(technical_page))
                    self.assertLessEqual(len(encode_review_projection(user_page)), REVIEW_MAX_BYTES)
                    self.assertEqual(user_page['pagination']['total_records'], len(technical[view]))
                    seen.extend(row['id'] for row in user_page[view])
                self.assertCountEqual(seen, [row['id'] for row in technical[view]])
        def all_roadmaps(rows):
            for row in rows:
                yield row
                yield from all_roadmaps(row.get('merged_history', []))
        support = [item for roadmap in all_roadmaps(user['roadmaps']) for increment in roadmap['increments']
                   for criterion in increment['criteria'] for item in criterion.get('supporting_work', [])]
        self.assertTrue(support)
        self.assertTrue(all(item['status'] == 'record-unavailable'
                            and item['current_qualification'] == 'not-asserted' for item in support))
        # Includes each original approval and complete canonical requirement/history.
        self.assertEqual({p: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}, before)


if __name__ == '__main__':
    unittest.main()
