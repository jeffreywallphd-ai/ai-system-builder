"""Explicit lossless review formatting; never acceptance or completion authority."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

from .common import digest, fields, identifier, read_json, safe_text, text
from .contracts import ControlError
from .storage import confined_path

REFERENCE = "docs/operations/roadmap-criterion-presentation.json"
MAX_ROWS = 1000
MAX_NODES = 64
MAX_DEPTH = 3
BLOCKER_REFERENCE = "docs/operations/roadmap-blocker-presentation.json"


def _identity(row):
    return tuple(identifier(row[key]) for key in ("roadmap_id", "increment_id", "criterion_id"))


def _normalized(value):
    return " ".join(value.split())


def _tree(value, depth=1, budget=None):
    if not isinstance(value, list) or not value or len(value) > MAX_NODES or depth > MAX_DEPTH:
        raise ValueError("bounded nonempty requirement list required")
    budget = [MAX_NODES] if budget is None else budget
    nodes, fragments = [], []
    for row in value:
        budget[0] -= 1
        if budget[0] < 0:
            raise ValueError("requirement node budget exceeded")
        fields(row, {"text", "children"}, {"text"})
        fragment = text(row["text"], limit=1500)
        node = {"text": fragment}
        fragments.append(fragment)
        if "children" in row:
            node["children"], child_fragments = _tree(row["children"], depth + 1, budget)
            fragments.extend(child_fragments)
        nodes.append(node)
    return nodes, fragments


def apply_presentations(root: Path, roadmaps: list, diagnostics: list) -> None:
    """Decorate current safe text only; stale/untrusted formatting falls back."""
    known, ambiguous = {}, set()
    for roadmap in roadmaps:
        for increment in roadmap["increments"]:
            for criterion in increment["criteria"]:
                criterion["requirements"] = [{"text": criterion["description"]}]
                key = (roadmap["id"], increment["id"], criterion["id"])
                if key in known:
                    ambiguous.add(key)
                known[key] = criterion
    try:
        path = confined_path(root, REFERENCE)
        if not path.exists():
            return
        document = read_json(path, maximum=1024 * 1024)
        fields(document, {"schema_version", "criteria"}, {"schema_version", "criteria"})
        rows = document["criteria"]
        if document["schema_version"] != "roadmap-criterion-presentation-v1" or not isinstance(rows, list) or len(rows) > MAX_ROWS:
            raise ValueError("unsupported requirement presentation")
        seen, staged, invalid = set(), {}, False
        for row in rows:
            key = None
            try:
                fields(row, {"roadmap_id", "increment_id", "criterion_id", "source_description_sha256", "requirements"},
                       {"roadmap_id", "increment_id", "criterion_id", "source_description_sha256", "requirements"})
                key = _identity(row)
                if key in seen:
                    staged.pop(key, None)
                    ambiguous.add(key)
                    raise ValueError("duplicate requirement identity")
                seen.add(key)
                if key not in known or key in ambiguous:
                    raise ValueError("foreign or ambiguous requirement identity")
                source = known[key]["description"]
                expected_hash = row["source_description_sha256"]
                if not isinstance(expected_hash, str) or not re.fullmatch("[a-f0-9]{64}", expected_hash):
                    raise ValueError("source description hash required")
                if hashlib.sha256(source.encode("utf-8")).hexdigest() != expected_hash:
                    raise ValueError("source description changed")
                nodes, fragments = _tree(row["requirements"])
                if _normalized(" ".join(fragments)) != _normalized(source):
                    raise ValueError("requirements must retain exact ordered source text")
                staged[key] = nodes
            except (ControlError, ValueError, KeyError, TypeError, RecursionError):
                invalid = True
                if key is not None:
                    staged.pop(key, None)
        for key, nodes in staged.items():
            known[key]["requirements"] = nodes
        if invalid:
            diagnostics.append({"code": "projection.criterion-presentation-unavailable"})
    except (ControlError, ValueError, KeyError, TypeError, RecursionError, OSError):
        diagnostics.append({"code": "projection.criterion-presentation-unavailable"})


def canonical_blocker_source(state):
    """Private current-source index; no caller path or cached annotation authority."""
    descriptions = {}
    for increment in state['increments'][:100]:
        if not isinstance(increment, dict) or not isinstance(increment.get('id'), str) or not isinstance(increment.get('acceptanceCriteria', []), list):
            continue
        for criterion in increment.get('acceptanceCriteria', [])[:100]:
            if isinstance(criterion, dict) and isinstance(criterion.get('id'), str) and isinstance(criterion.get('description'), str):
                descriptions[(increment['id'], criterion['id'])] = hashlib.sha256(criterion['description'].encode('utf-8')).hexdigest()
    blockers, ambiguous = {}, set()
    rows = state.get('blockers', [])
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or row.get('status') != 'open' or not isinstance(row.get('id'), str):
            continue
        if row['id'] in blockers:
            ambiguous.add(row['id'])
        blockers[row['id']] = row
    return {'descriptions': descriptions, 'blockers': blockers, 'ambiguous': ambiguous}


def apply_blocker_presentations(root: Path, roadmaps: list, sources: dict, diagnostics: list) -> None:
    """Attach only exact current open obstacles to explicitly reviewed criteria."""
    known, ambiguous, expected = {}, set(), set()
    for roadmap in roadmaps:
        if roadmap.get('execution_role') == 'merged-history':
            continue
        for increment in roadmap['increments']:
            for criterion in increment['criteria']:
                criterion['blockers'] = []
                key = (roadmap['id'], increment['id'], criterion['id'])
                if key in known:
                    ambiguous.add(key)
                known[key] = criterion
        if roadmap['status'] == 'blocked':
            expected.update((roadmap['id'], blocker_id) for blocker_id in sources.get(roadmap['id'], {}).get('blockers', {}))
    try:
        path = confined_path(root, BLOCKER_REFERENCE)
        if not path.exists():
            if expected:
                diagnostics.append({'code': 'projection.criterion-blockers-unavailable'})
            return
        document = read_json(path, maximum=1024 * 1024)
        fields(document, {'schema_version', 'criteria'}, {'schema_version', 'criteria'})
        if document['schema_version'] != 'roadmap-criterion-blockers-v1' or not isinstance(document['criteria'], list) or len(document['criteria']) > MAX_ROWS:
            raise ValueError('bounded criterion blocker map required')
        staged, seen, invalid = {}, set(), False
        for row in document['criteria']:
            key = None
            try:
                fields(row, {'roadmap_id', 'increment_id', 'criterion_id', 'source_description_sha256', 'blockers'},
                       {'roadmap_id', 'increment_id', 'criterion_id', 'source_description_sha256', 'blockers'})
                key = _identity(row)
                if key in seen:
                    ambiguous.add(key)
                    raise ValueError('duplicate criterion blocker identity')
                seen.add(key)
                if key not in known or key in ambiguous:
                    raise ValueError('foreign or ambiguous criterion identity')
                source = sources[key[0]]
                description_hash = row['source_description_sha256']
                if not isinstance(description_hash, str) or not re.fullmatch('[a-f0-9]{64}', description_hash) or description_hash != source['descriptions'].get((key[1], key[2])):
                    raise ValueError('criterion description changed')
                references = row['blockers']
                if not isinstance(references, list) or not 1 <= len(references) <= 20:
                    raise ValueError('bounded nonempty blocker references required')
                selected, blocker_ids = [], set()
                for reference in references:
                    fields(reference, {'blocker_id', 'source_blocker_digest', 'prevents'}, {'blocker_id', 'source_blocker_digest', 'prevents'})
                    blocker_id = identifier(reference['blocker_id'])
                    if blocker_id in blocker_ids or blocker_id in source['ambiguous'] or blocker_id not in source['blockers']:
                        raise ValueError('foreign, resolved or duplicate blocker')
                    blocker_ids.add(blocker_id)
                    blocker = source['blockers'][blocker_id]
                    if not all(isinstance(blocker.get(field, ''), str) for field in ('kind', 'summary', 'requiredAction')):
                        raise ValueError('malformed canonical blocker details')
                    if reference['source_blocker_digest'] != digest(blocker):
                        raise ValueError('canonical blocker changed')
                    selected.append({'id': safe_text(blocker_id, 80), 'kind': safe_text(blocker.get('kind', ''), 80),
                                     'summary': safe_text(blocker.get('summary', ''), 1600),
                                     'prevents': safe_text(text(reference['prevents'], limit=800), 800),
                                     'required_action': safe_text(blocker.get('requiredAction', ''), 1600)})
                staged[key] = selected
            except (ControlError, ValueError, KeyError, TypeError, RecursionError):
                invalid = True
                if key is not None:
                    staged.pop(key, None)
        mapped = set()
        for key, blockers in staged.items():
            known[key]['blockers'] = blockers
            mapped.update((key[0], blocker['id']) for blocker in blockers)
        if invalid or expected - mapped:
            diagnostics.append({'code': 'projection.criterion-blockers-unavailable'})
    except (ControlError, ValueError, KeyError, TypeError, RecursionError, OSError):
        diagnostics.append({'code': 'projection.criterion-blockers-unavailable'})
