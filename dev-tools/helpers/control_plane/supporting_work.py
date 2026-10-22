"""Read-only scoped implementation support; never a completion authority."""
from __future__ import annotations
import re
from pathlib import Path
from .common import digest, fields, identifier, read_json, safe_text, text
from .contracts import ControlError
from .storage import confined_path
from .work import validate_receipt

REFERENCE = 'docs/operations/roadmap-supporting-work.json'

def _list(value, maximum=500):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError('invalid supporting-work list')
    return value

def _identity(row):
    for key in ('roadmap_id', 'increment_id', 'criterion_id'):
        identifier(row.get(key))
    return row['roadmap_id'], row['increment_id'], row['criterion_id']

def _sha(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
        raise ValueError('invalid supporting-work digest')

def _recorded_support(link, works):
    """Validate historical completion lineage, deliberately not source currentness."""
    work = works.get(link['work_id'])
    if not work:
        return 'record-unavailable'
    try:
        if work.get('status') != 'complete' or digest(work['spec']) != work['spec_digest']:
            return 'unverified-support'
        complete = work['completion']
        if complete['receipt_digest'] != link['receipt_digest'] or complete['review_digest'] != link['review_digest']:
            return 'unverified-support'
        receipt = next(r for r in work['receipts'] if r['receipt_digest'] == link['receipt_digest'])
        review = next(r for r in work['reviews'] if r['review_digest'] == link['review_digest'])
        validate_receipt(receipt)
        expected = {a['id'] for a in work['spec']['acceptance']}
        if (not receipt['source_stable'] or receipt['spec_digest'] != work['spec_digest']
            or receipt['work_id'] != link['work_id'] or complete['source_digest'] != receipt['source_digest']
            or review['source_digest'] != receipt['source_digest'] or review['work_id'] != link['work_id']
            or review['disposition'] != 'accepted' or review['receipt_digest'] != receipt['receipt_digest']
            or review['review_digest'] != digest({k:v for k,v in review.items() if k != 'review_digest'})
            or review['invocation_id'] in work['contributors'] or set(review['reviewed_criteria']) != expected
            or not set(link['work_criteria']).issubset(expected)):
            return 'unverified-support'
        return 'reviewed-local-snapshot'
    except (ControlError, KeyError, TypeError, ValueError, StopIteration):
        return 'unverified-support'

def enrich(root: Path, roadmaps: list, records: dict, diagnostics: list) -> None:
    try:
        path = confined_path(root, REFERENCE)
        if not path.exists():
            return
        document = read_json(path, maximum=1024*1024)
        keys = {'schema_version','agent_only_roadmaps','criterion_labels','successors','links'}
        fields(document, keys, keys)
        if document['schema_version'] != 'roadmap-supporting-work-v1':
            raise ValueError('unsupported supporting-work schema')
        roadmap_index = {r['id']:r for r in roadmaps}
        criteria = {(r['id'], i['id'], c['id']):c for r in roadmaps for i in r['increments'] for c in i['criteria']}
        agent_only = _list(document['agent_only_roadmaps'], 200)
        if len(agent_only) != len(set(agent_only)) or any(identifier(k) not in roadmap_index for k in agent_only):
            raise ValueError('unknown agent-only roadmap')
        labels, links, successors = [], [], []
        seen_labels, seen_links, seen_successors = set(), set(), set()
        for label in _list(document['criterion_labels']):
            fields(label, {'roadmap_id','increment_id','criterion_id','title'}, {'roadmap_id','increment_id','criterion_id','title'})
            key = _identity(label)
            if key not in criteria or key in seen_labels:
                raise ValueError('unknown or duplicate criterion label')
            text(label['title'], limit=200); seen_labels.add(key); labels.append((key,label))
        for link in _list(document['links']):
            keys = {'roadmap_id','increment_id','criterion_id','work_id','work_criteria','receipt_digest','review_digest','scope','limitations'}
            fields(link, keys, keys)
            key = _identity(link); identifier(link['work_id'])
            unique = (*key, link['work_id'])
            if key not in criteria or unique in seen_links:
                raise ValueError('unknown or duplicate supporting-work target')
            chosen = _list(link['work_criteria'], 100)
            if not chosen or len(chosen) != len(set(chosen)):
                raise ValueError('supporting-work criterion selection required')
            for item in chosen: identifier(item)
            _sha(link['receipt_digest']); _sha(link['review_digest']); text(link['scope'], limit=500)
            limits = _list(link['limitations'], 12)
            if not limits: raise ValueError('supporting-work limits required')
            for item in limits: text(item, limit=1500)
            seen_links.add(unique); links.append((key,link))
        for successor in _list(document['successors'], 200):
            fields(successor, {'roadmap_id','successor_roadmap_id','summary'}, {'roadmap_id','successor_roadmap_id','summary'})
            a,b = successor['roadmap_id'], successor['successor_roadmap_id']
            if a not in roadmap_index or b not in roadmap_index or a == b or a in seen_successors:
                raise ValueError('unknown or duplicate successor')
            text(successor['summary'], limit=1500); seen_successors.add(a); successors.append(successor)
        # Publish the allowlisted decoration only after complete configuration admission.
        for r in roadmaps:
            if r['id'] in agent_only:
                for increment in r['increments']:
                    for criterion in increment['criteria']:
                        criterion['evaluation_mode'] = 'agent-executable-technical'
        for key,label in labels:
            criteria[key]['title'] = safe_text(label['title'], 200)
        checked = {}
        for key,link in links:
            cache_key = (link['work_id'],link['receipt_digest'],link['review_digest'],tuple(link['work_criteria']))
            if cache_key not in checked: checked[cache_key] = _recorded_support(link, records['work_items'])
            status = checked[cache_key]
            criteria[key].setdefault('supporting_work', []).append({
                'work_id': link['work_id'], 'scope': safe_text(link['scope'], 500),
                'status': status, 'current_qualification': 'not-asserted',
                'receipt_digest': link['receipt_digest'], 'review_digest': link['review_digest'],
                'limitations': [safe_text(item,1500) for item in link['limitations']],
            })
        for successor in successors:
            roadmap_index[successor['roadmap_id']]['successor'] = {'id': successor['successor_roadmap_id'], 'summary': safe_text(successor['summary'],1500)}
    except (ControlError, ValueError, KeyError, TypeError):
        diagnostics.append({'code':'projection.supporting-work-unavailable'})
