"""Read-only scoped implementation support; never a completion authority."""
from __future__ import annotations
import re
import importlib.util
from pathlib import Path
from .common import digest, fields, identifier, read_json, safe_text, text
from .contracts import ControlError
from .storage import confined_path
from .work import validate_receipt

REFERENCE = 'docs/operations/roadmap-supporting-work.json'
CONSOLIDATION = 'docs/security/security-roadmap-consolidation.json'
RETIREMENT = 'docs/operations/retired-run-test-roadmap.json'
ROADMAP_ENGINE = 'skills/manage-implementation-roadmaps/scripts/roadmap.py'


def criterion_definitions(state):
    return [{'increment_id': i['id'], 'criteria': i['acceptanceCriteria']} for i in state['increments']]


def _approved_owner(root, state, identity):
    """Use the existing canonical authority; projection never invents approval."""
    try:
        script = confined_path(root, ROADMAP_ENGINE)
        spec = importlib.util.spec_from_file_location('aisb_consolidation_authority', script)
        if spec is None or spec.loader is None:
            raise ValueError('canonical roadmap authority unavailable')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.validate_state_shape(root, state)
        if (state['slug'] != identity or state['paths']['state'] != f'.implementation-roadmaps/{identity}/state.json'
            or not module.approval_is_current(state)):
            raise ValueError('current canonical owner approval required')
    except Exception as error:
        raise ValueError('current canonical owner approval required') from error


def _consolidation(root, successor):
    """Validate a complete handoff before folding history; never supplies a pass."""
    path = successor.get('consolidation_path')
    if path not in {CONSOLIDATION, RETIREMENT}:
        raise ValueError('unsupported consolidation source')
    retirement = path == RETIREMENT
    value = read_json(confined_path(root, path), maximum=1024*1024)
    keys = {'schema_version', 'source_roadmap_id', 'target_roadmap_id', 'source_digest', 'target_criteria_digest',
            'authority_ref', 'summary', 'legacy_criteria', 'current_criteria', 'finding_inventories', 'overall_qualification'}
    fields(value, keys, keys)
    if (value['schema_version'] != ('retired-run-test-roadmap-v1' if retirement else 'security-roadmap-consolidation-v1')
        or value['source_roadmap_id'] != successor['roadmap_id']
        or value['target_roadmap_id'] != successor['successor_roadmap_id']):
        raise ValueError('consolidation identity mismatch')
    identifier(value['authority_ref']); text(value['summary'], limit=1500)
    source = read_json(confined_path(root, f".implementation-roadmaps/{identifier(value['source_roadmap_id'])}/state.json"))
    target = read_json(confined_path(root, f".implementation-roadmaps/{identifier(value['target_roadmap_id'])}/state.json"))
    if (digest(source) != value['source_digest'] or digest(criterion_definitions(target)) != value['target_criteria_digest']
        or source.get('evidencePolicy') is not None
        or (not retirement and target.get('evidencePolicy') != 'control-plane-v1')
        or not any(b.get('id') == ('superseded-by-publish-lifecycle' if retirement else 'approved-successor-handoff')
                   and b.get('status') == 'open' for b in source.get('blockers', []))):
        raise ValueError('consolidation requires unchanged frozen legacy and approved governed owner')
    if retirement and (source.get('slug') != 'systems-run-workflow-active-source'
        or target.get('slug') != 'systems-publish-runtime-lifecycle' or source.get('roadmapApproval') is not None
        or source.get('evidence') or source.get('chunks') or source.get('currentIncrementId') is not None
        or any(i.get('status') != 'pending' or i.get('plan') is not None or i.get('completedChunks') or i.get('startedAt') for i in source['increments'])
        or target.get('status') != 'completed' or not target['increments']
        or any(i.get('status') != 'completed' for i in target['increments'])):
        raise ValueError('retirement requires the exact unstarted draft and completed Publish owner')
    _approved_owner(root, target, value['target_roadmap_id'])
    owners = {(i['id'], c['id']) for i in target['increments'] for c in i['acceptanceCriteria']}
    unfinished = {(i['id'], c['id']) for i in source['increments'] if i['status'] != 'completed' for c in i['acceptanceCriteria']}
    seen, rows = set(), []
    for row in _list(value['legacy_criteria'], 200):
        keys = {'increment_id', 'criterion_id', 'owner_increment_id', 'owner_criterion_id', 'related_owners', 'disposition', 'summary', 'evidence_paths'}
        fields(row, keys, keys)
        old = identifier(row['increment_id']), identifier(row['criterion_id'])
        owner = identifier(row['owner_increment_id']), identifier(row['owner_criterion_id'])
        if old not in unfinished or old in seen or owner not in owners or row['disposition'] != 'merged-existing-owner':
            raise ValueError('incomplete or duplicate consolidation owner')
        related, related_seen = [], {owner}
        for companion in _list(row['related_owners'], 100):
            fields(companion, {'increment_id', 'criterion_id'}, {'increment_id', 'criterion_id'})
            identity = identifier(companion['increment_id']), identifier(companion['criterion_id'])
            if identity not in owners or identity in related_seen:
                raise ValueError('invalid related acceptance owner')
            related_seen.add(identity)
            related.append({'increment_id': identity[0], 'criterion_id': identity[1]})
        seen.add(old); _assessment_paths(root, row)
        rows.append({**{k: safe_text(row[k], 1500 if k == 'summary' else 100) for k in keys - {'evidence_paths', 'related_owners'}}, 'related_owners': related})
    if seen != unfinished:
        raise ValueError('every unfinished legacy criterion needs one owner')
    seen = set()
    for row in _list(value['current_criteria'], 200):
        keys = {'increment_id', 'criterion_id', 'disposition', 'summary', 'evidence_paths'}
        fields(row, keys, keys)
        owner = identifier(row['increment_id']), identifier(row['criterion_id'])
        if owner not in owners or owner in seen or row['disposition'] not in {'implementation-required', 'qualification-required', 'partial-implementation'}:
            raise ValueError('current criterion validity required')
        seen.add(owner); _assessment_paths(root, row)
    if seen != owners:
        raise ValueError('every current criterion requires assessment')
    overall = value['overall_qualification']
    fields(overall, {'completion_suite', 'procedure', 'limits'}, {'completion_suite', 'procedure', 'limits'})
    expected_suite = 'preserved-completed-successor' if retirement else 'all'
    if overall['completion_suite'] != expected_suite or (not retirement and target.get('completionSuite') != 'all'):
        raise ValueError('consolidation cannot relax final qualification')
    procedures = _list(overall['procedure'], 20)
    if not procedures:
        raise ValueError('retain overall qualification procedure')
    for procedure in procedures:
        text(procedure, limit=1500)
    text(overall['limits'], limit=1500)
    inventories = value['finding_inventories']
    if retirement:
        fields(inventories, set(), set())
        return {'summary': safe_text(value['summary'], 1500), 'criterion_owners': rows}
    fields(inventories, {'legacy_count', 'csv_count', 'legacy_register', 'csv_assessment'}, {'legacy_count', 'csv_count', 'legacy_register', 'csv_assessment'})
    if inventories['legacy_count'] != 78 or inventories['csv_count'] != 88:
        raise ValueError('finding inventories must remain complete')
    for name in ('legacy_register', 'csv_assessment'):
        confined_path(root, inventories[name])
    register_path = confined_path(root, inventories['legacy_register'])
    with register_path.open('rb') as stream:
        register_bytes = stream.read(1024*1024 + 1)
    if len(register_bytes) > 1024*1024:
        raise ValueError('bounded finding register required')
    register = register_bytes.decode('utf-8')
    legacy_ids = re.findall(r'(?m)^\|\s*(F\d{2})\s*\|', register)
    assessment = read_json(confined_path(root, inventories['csv_assessment']), maximum=2*1024*1024)
    findings = _list(assessment.get('findings'), 200)
    if (len(legacy_ids) != 78 or set(legacy_ids) != {f'F{n:02}' for n in range(1, 79)}
        or len(findings) != 88 or any(not isinstance(r, dict) for r in findings)
        or {r.get('id') for r in findings} != {f'R{n:02}' for n in range(1, 89)}):
        raise ValueError('finding identities cannot be dropped or duplicated')
    return {'summary': safe_text(value['summary'], 1500), 'criterion_owners': rows}


def _assessment_paths(root, row):
    text(row['summary'], limit=1500)
    paths = _list(row['evidence_paths'], 20)
    if not paths or len(paths) != len(set(paths)):
        raise ValueError('current source evidence required')
    for path in paths:
        if (not isinstance(path, str) or not (path == 'AGENTS.md' or path.startswith(('modules/', 'apps/', 'dev-tools/', 'docs/', 'skills/'))
            or re.fullmatch(r'\.implementation-roadmaps/[a-z0-9-]+/state\.json', path)) or not confined_path(root, path).is_file()):
            raise ValueError('bounded existing evidence required')

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
        merged = []
        for successor in _list(document['successors'], 200):
            fields(successor, {'roadmap_id','successor_roadmap_id','summary','consolidation_path'}, {'roadmap_id','successor_roadmap_id','summary'})
            a,b = successor['roadmap_id'], successor['successor_roadmap_id']
            if a not in roadmap_index or b not in roadmap_index or a == b or a in seen_successors:
                raise ValueError('unknown or duplicate successor')
            text(successor['summary'], limit=1500); seen_successors.add(a); successors.append(successor)
            if successor.get('consolidation_path'):
                merged.append((a, b, _consolidation(root, successor)))
        graph = {row['roadmap_id']: row['successor_roadmap_id'] for row in successors}
        for start in graph:
            visited, current = set(), start
            while current in graph:
                if current in visited:
                    raise ValueError('successor graph cannot cycle')
                visited.add(current)
                current = graph[current]
        folded = {a for a, _, _ in merged}
        if any(b in graph for _, b, _ in merged) or any(b in folded for b in graph.values()):
            raise ValueError('consolidation cannot chain through another successor')
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
        for a, b, consolidation in merged:
            legacy = roadmap_index[a]
            legacy['execution_role'] = 'merged-history'
            roadmap_index[b].setdefault('merged_history', []).append({
                'id': legacy['id'], 'title': legacy['title'], 'status': legacy['status'],
                'created_at': legacy['created_at'], 'increments': legacy['increments'],
                **consolidation, 'evidence_policy': 'declarative-legacy',
            })
    except (ControlError, ValueError, KeyError, TypeError, OSError, UnicodeError):
        diagnostics.append({'code':'projection.supporting-work-unavailable'})
