"""Source-bound user descriptions. Never a workflow or qualification authority."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

from .common import digest, fields, identifier, read_json, safe_text, text
from .contracts import ControlError
from .projection import bound_review_projection, project
from .storage import confined_path

REFERENCE = 'docs/operations/roadmap-user-descriptions.json'
UNAVAILABLE = 'The agent must update this description. The technical requirements and recorded result remain unchanged.'


def _hash(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def _hash_field(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
        raise ValueError('exact source hash required')
    return value


def _strings(value, maximum=64, minimum=1):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ValueError('bounded nonempty text list required')
    return [text(item, limit=1500) for item in value]


def _copy(value, kind):
    keys = {'purpose', 'owner', 'next_action', 'completion_proof', 'requirements'} if kind == 'criteria' else (
        {'title', 'purpose', 'scope'} if kind == 'headings' else {'owner', 'sentences'})
    fields(value, keys, keys)
    result = {}
    for key, item in value.items():
        if key == 'owner':
            if item != 'agent':
                raise ValueError('description ownership is not human-action authority')
            result[key] = item
        elif key in {'requirements', 'scope', 'sentences'}:
            result[key] = _strings(item, minimum=0 if key == 'scope' else 1)
        else:
            result[key] = text(item, limit=240 if key == 'title' else 2000)
    # Check the complete joined explanation too: separate safe fragments must
    # not combine into a secret/path disclosure at a list or field boundary.
    order = ('purpose', 'requirements', 'next_action', 'completion_proof') if kind == 'criteria' else (
        ('title', 'purpose', 'scope') if kind == 'headings' else ('sentences',))
    fragments = [fragment for key in order for fragment in (result[key] if isinstance(result[key], list) else [result[key]])]
    joined = ' '.join(fragments)
    compact = ''.join(fragments)
    joined.encode('utf-8', errors='strict')
    if len(joined) > 16000 or safe_text(joined, 16000) != joined or safe_text(compact, 16000) != compact:
        raise ValueError('unsafe user description')
    return result


def _roadmaps(value):
    for roadmap in value['roadmaps']:
        yield roadmap
        yield from roadmap.get('merged_history', [])


def _sources(root, roadmaps):
    criteria, headings = {}, {}
    for roadmap in roadmaps:
        identity = identifier(roadmap['id'])
        state = read_json(confined_path(root, f'.implementation-roadmaps/{identity}/state.json'), maximum=2*1024*1024)
        if state.get('slug') != identity or state.get('schemaVersion') != 1:
            raise ValueError('canonical source identity required')
        headings[('roadmap', identity)] = digest({'title': state['name'], 'objective': state['objective']})
        for increment in state['increments']:
            increment_id = identifier(increment['id'])
            headings[('increment', identity, increment_id)] = digest({'title': increment['title'], 'objective': increment['objective']})
            for criterion in increment['acceptanceCriteria']:
                key = identity, increment_id, identifier(criterion['id'])
                if key in criteria:
                    raise ValueError('ambiguous canonical criterion')
                criteria[key] = (_hash(criterion['description']), criterion.get('qualification', 'local'))
    return criteria, headings


def _admit(document, sources, known, diagnostics):
    fields(document, {'schema_version', 'criteria', 'headings', 'support'}, {'schema_version', 'criteria', 'headings', 'support'})
    if document['schema_version'] != 'roadmap-user-descriptions-v1':
        raise ValueError('unsupported description schema')
    admitted = {}
    for family in ('criteria', 'headings', 'support'):
        rows = document[family]
        if not isinstance(rows, list) or len(rows) > 1000:
            raise ValueError('bounded description rows required')
        accepted, seen = {}, set()
        for row in rows:
            key = None
            try:
                if not isinstance(row, dict):
                    raise ValueError('description row object required')
                if family == 'criteria':
                    keys = {'roadmap_id', 'increment_id', 'criterion_id', 'source_description_sha256', 'qualification', 'user_description'}
                    fields(row, keys, keys)
                    key = tuple(identifier(row[k]) for k in ('roadmap_id', 'increment_id', 'criterion_id'))
                    actual = (_hash_field(row['source_description_sha256']), row['qualification'])
                    if key not in known['criteria'] or sources[0].get(key) != actual:
                        raise ValueError('criterion source or qualification changed')
                elif family == 'headings':
                    keys = {'record_type', 'roadmap_id', 'source_title_objective_digest', 'user_description'}
                    if row.get('record_type') == 'increment':
                        keys.add('increment_id')
                    fields(row, keys, keys)
                    if row['record_type'] not in {'roadmap', 'increment'}:
                        raise ValueError('unknown heading type')
                    key = (row['record_type'], identifier(row['roadmap_id']))
                    if row['record_type'] == 'increment':
                        key += (identifier(row['increment_id']),)
                    if key not in known['headings'] or sources[1].get(key) != _hash_field(row['source_title_objective_digest']):
                        raise ValueError('heading source changed')
                else:
                    keys = {'kind', 'source_text_sha256', 'user_description'}
                    fields(row, keys, keys)
                    if row['kind'] not in {'support-scope', 'support-limitation'}:
                        raise ValueError('unknown support description')
                    key = row['kind'], _hash_field(row['source_text_sha256'])
                    if key not in known['support']:
                        raise ValueError('foreign support description')
                if key in seen:
                    raise ValueError('duplicate description')
                seen.add(key)
                accepted[key] = _copy(row['user_description'], family)
            except (ControlError, ValueError, KeyError, TypeError):
                if key is not None:
                    # A duplicate cannot leave the earlier row admitted.
                    seen.add(key)
                    accepted.pop(key, None)
                diagnostics.add('projection.user-description-unavailable')
        admitted[family] = accepted
    return admitted


def apply_user_descriptions(root: Path, value: dict) -> dict:
    """Replace display prose only; canonical source and technical CLI stay intact."""
    roadmaps = list(_roadmaps(value))
    criteria, headings, support = {}, {}, set()
    for roadmap in roadmaps:
        headings[('roadmap', roadmap['id'])] = roadmap
        for increment in roadmap['increments']:
            headings[('increment', roadmap['id'], increment['id'])] = increment
            for criterion in increment['criteria']:
                criteria[(roadmap['id'], increment['id'], criterion['id'])] = criterion
                for row in criterion.get('supporting_work', []):
                    support.add(('support-scope', _hash(row['scope'])))
                    support.update(('support-limitation', _hash(item)) for item in row['limitations'])
    warnings = set()
    try:
        sources = _sources(root, roadmaps)
        document = read_json(confined_path(root, REFERENCE), maximum=1024*1024)
        admitted = _admit(document, sources, {'criteria': criteria, 'headings': headings, 'support': support}, warnings)
    except (ControlError, ValueError, KeyError, TypeError, OSError):
        warnings.add('projection.user-description-unavailable')
        admitted = {'criteria': {}, 'headings': {}, 'support': {}}
    for key, criterion in criteria.items():
        copy = admitted['criteria'].get(key)
        criterion['description'] = copy['purpose'] if copy else UNAVAILABLE
        criterion['requirements'] = [{'text': item} for item in copy['requirements']] if copy else [{'text': UNAVAILABLE}]
        criterion['user_instructions'] = {k: copy[k] for k in ('owner', 'next_action', 'completion_proof')} if copy else {'owner': 'agent', 'next_action': UNAVAILABLE, 'completion_proof': UNAVAILABLE}
        # Raw diagnostic narratives remain in canonical records/the CLI. This
        # display fact does not reinterpret their qualification outcome.
        criterion['evidence_recorded'] = bool(criterion.get('evidence_summary'))
        criterion['evidence_summary'] = ''
        if not copy:
            warnings.add('projection.user-description-unavailable')
        for row in criterion.get('supporting_work', []):
            explanation = admitted['support'].get(('support-scope', _hash(row['scope'])))
            row['scope'] = ' '.join(explanation['sentences']) if explanation else UNAVAILABLE
            row['limitations'] = [' '.join(explanation['sentences']) if (explanation := admitted['support'].get(('support-limitation', _hash(item)))) else UNAVAILABLE for item in row['limitations']]
            if row['scope'] == UNAVAILABLE or UNAVAILABLE in row['limitations']:
                warnings.add('projection.user-description-unavailable')
    for key, item in headings.items():
        copy = admitted['headings'].get(key)
        item['title'] = copy['title'] if copy else 'Description update needed'
        item['objective'] = copy['purpose'] if copy else UNAVAILABLE
        item['user_scope'] = copy['scope'] if copy else []
        if not copy:
            warnings.add('projection.user-description-unavailable')
    # The Work items view reuses parent headings; maintain the same names after
    # formatting without altering work IDs, statuses, dates or criterion links.
    for item in value['work_items']:
        if item.get('source') == 'roadmap-chunk':
            parent = headings.get(('roadmap', item['roadmap_id']))
            increment = headings.get(('increment', item['roadmap_id'], item['increment_id']))
            if parent: item['roadmap_title'] = parent['title']
            if increment: item['increment_title'] = increment['title']
    value['diagnostics'].extend({'code': code} for code in sorted(warnings))
    value['presentation_view'] = 'user-v1'
    value['source_digest'] = digest({k: v for k, v in value.items() if k not in {'source_digest', 'generated_at', 'repository_id'}})
    return value


def user_project(root: Path) -> dict:
    return bound_review_projection(apply_user_descriptions(root, project(root)))
