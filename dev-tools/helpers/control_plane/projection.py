"""Public review contract derived only from versioned JSON, never Markdown."""
from __future__ import annotations

from pathlib import Path
from datetime import datetime, timezone
import json

from .common import digest, now, read_json, safe_text
from .contracts import ControlError
from .records import Records
from .metrics import delivery
from .storage import confined_path
from .supporting_work import enrich
from .criterion_presentation import apply_presentations, canonical_blocker_source, apply_blocker_presentations

REVIEW_MAX_BYTES = 2 * 1024 * 1024


def encode_review_projection(value: dict) -> bytes:
    """The exact JSON encoding used for review admission and HTTP delivery."""
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode("utf-8")


def bound_review_projection(value: dict) -> dict:
    """Bound final display bytes without discarding canonical roadmap detail.

    User descriptions can expand a previously admitted technical projection.
    Retain the newest execution records that fit; canonical rows are never
    candidates for truncation. Failed admission leaves the input unchanged.
    """
    def stamped(content):
        public = {k: v for k, v in content.items()
                  if k not in {"source_digest", "generated_at", "repository_id"}}
        return {**content, "source_digest": digest(public)}

    result = stamped(value)
    if len(encode_review_projection(result)) <= REVIEW_MAX_BYTES:
        return result
    works = value["work_items"]
    executions = [row for row in works if row.get("source") == "execution"]
    inventory = value["inventory"]
    total = inventory["execution_records_total"]
    if (type(total) is not int or total < len(executions)
            or not 0 < len(executions) <= 1000):
        raise ValueError("Review projection exceeds its bound.")
    # Match the projection's original creation-date order and stable ID ties.
    executions.sort(key=lambda row: row["id"])
    executions.sort(key=lambda row: creation_time(row.get("created_at")) or "", reverse=True)
    diagnostics = [row for row in value["diagnostics"]
                   if row.get("code") != "projection.execution-records-truncated"]

    def narrowed(shown):
        keep = {id(row) for row in executions[:shown]}
        content = {**value,
                   "work_items": [row for row in works
                                  if row.get("source") != "execution" or id(row) in keep],
                   "inventory": {**inventory, "execution_records_shown": shown,
                                 "execution_records_truncated": shown < total},
                   "diagnostics": [*diagnostics, {"code": "projection.execution-records-truncated",
                                                 "total": total, "shown": shown}]}
        return stamped(content)

    result = narrowed(0)
    if len(encode_review_projection(result)) > REVIEW_MAX_BYTES:
        raise ValueError("Review projection exceeds its bound.")
    # All-record admission already failed. Each remaining candidate therefore
    # keeps the same truncation diagnostic, making encoded size monotonic.
    low, high = 0, len(executions) - 1
    while low < high:
        middle = (low + high + 1) // 2
        candidate = narrowed(middle)
        if len(encode_review_projection(candidate)) <= REVIEW_MAX_BYTES:
            low, result = middle, candidate
        else:
            high = middle - 1
    return result


def creation_time(value):
    """Normalize authoritative dates for sorting; never infer from file mtime."""
    if not isinstance(value, str) or len(value) > 80:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
    except (ValueError, OverflowError):
        return None


def active_increment_binding(work, current_time):
    """Advisory display only: disclose no claim identity, path or authority."""
    claim = work.get("claim")
    spec = work.get("spec", {})
    binding = spec.get("roadmap")
    if (work.get("status") not in ("active", "verifying") or spec.get("kind") != "roadmap"
            or not isinstance(claim, dict) or not isinstance(binding, dict)
            or set(binding) != {"state_path", "increment_id"}
            or not all(isinstance(binding[k], str) for k in binding)
            or binding["increment_id"] == "overall"
            or not all(isinstance(claim.get(k), str) and claim[k]
                       for k in ("claim_id", "invocation_id"))
            or type(claim.get("fence")) is not int or claim["fence"] < 1):
        return None
    expires = creation_time(claim.get("expires_at"))
    if not current_time or not expires or expires <= current_time:
        return None
    return binding["state_path"], binding["increment_id"]


def increment_proposal(increment):
    """Public, bounded proposal content only; never research/authority or execution."""
    def strings(key, limit=1600):
        value = increment.get(key, [])
        return [safe_text(item, limit) for item in value[:40] if isinstance(item, str)] if isinstance(value, list) else []

    packages = increment.get("workPackages", [])
    return {
        "work_packages": [{"id": safe_text(row.get("id", ""), 80), "title": safe_text(row.get("title", ""), 240),
                           "outcome": safe_text(row.get("outcome", ""), 1600)}
                          for row in packages[:40] if isinstance(row, dict) and
                          all(isinstance(row.get(key, ""), str) for key in ("id", "title", "outcome"))] if isinstance(packages, list) else [],
        "depends_on": strings("dependsOn", 80), "deliverables": strings("deliverables"), "verification": strings("verification"), "excluded": strings("excluded"),
        "rollback": safe_text(increment.get("rollback", ""), 4000) if isinstance(increment.get("rollback", ""), str) else "",
    }


def open_blocker_details(state):
    """Only current public obstacle facts, never resolution/audit/authority notes."""
    rows = state.get('blockers', [])
    if not isinstance(rows, list):
        return []
    result = []
    # Keep explicit human requests visible even when many agent tasks precede them.
    rows = sorted(rows, key=lambda row: 0 if isinstance(row, dict) and row.get("actionOwner") == "human" else 1)
    for row in rows:
        if not isinstance(row, dict) or row.get("status") != "open" or not all(
                isinstance(row.get(key, ""), str) for key in ("id", "kind", "summary", "requiredAction")):
            continue
        result.append({"id": safe_text(row.get("id", ""), 80), "kind": safe_text(row.get("kind", ""), 80),
                       "summary": safe_text(row.get("summary", ""), 1600), "required_action": safe_text(row.get("requiredAction", ""), 1600)})
        if row.get('actionOwner') in {'agent', 'human'}:
            result[-1]['action_owner'] = row['actionOwner']
            for source, target in [('responsibleRole', 'responsible_role'), ('completionCondition', 'done_when')]:
                if isinstance(row.get(source), str):
                    result[-1][target] = safe_text(row[source], 800)
        if len(result) == 40:
            break
    return result


def project(root: Path) -> dict:
    roadmaps, diagnostics, blocker_sources, increment_targets = [], [], {}, {}
    base = confined_path(root, ".implementation-roadmaps")
    if base.is_dir():
        for path in sorted(base.glob("*/state.json"))[:200]:
            try:
                relative_path = path.relative_to(root).as_posix()
                s = read_json(confined_path(root, relative_path), maximum=2 * 1024 * 1024)
                if s.get("schemaVersion") != 1 or not isinstance(s.get("increments"), list):
                    raise ValueError("schema")
                blocker_sources[s["slug"]] = canonical_blocker_source(s)
                roadmap_created = creation_time(s.get("createdAt"))
                increments = []
                for i in s["increments"][:100]:
                    evidence = [e for e in s.get("evidence", []) if e.get("incrementId") == i["id"]]
                    latest = {e["criterionId"]: e for e in evidence}
                    criteria = [{"id": safe_text(c["id"], 80), "description": safe_text(c["description"], 1500), "qualification": safe_text(c.get("qualification", "local")), "outcome": safe_text(latest.get(c["id"], {}).get("outcome", "missing")), "evidence_summary": safe_text(latest.get(c["id"], {}).get("summary", ""), 1600)} for c in i.get("acceptanceCriteria", [])[:100]]
                    completed = set(i.get("completedChunks", []))
                    transferred_ids = {c["id"] for t in s.get("humanAcceptanceTransfers", []) if t.get("incrementId") == i["id"] for c in t.get("criteria", [])}
                    offline = [{"status": "offline-user-owned", "criteria": [{"id": safe_text(c["id"], 80), "description": safe_text(c["description"], 1500)} for c in t.get("criteria", [])[:100]]} for t in s.get("humanAcceptanceTransfers", [])[:100] if t.get("incrementId") == i["id"]]
                    for revision in (s.get("acceptanceScopeRevisions", []) + s.get("legacyAcceptanceScopeRevisions", []))[:100]:
                        if revision.get("incrementId") != i["id"]:
                            continue
                        retired = revision.get("removedCriteria", [])[:100]
                        transferred_ids.update(c["id"] for c in retired)
                        human = [{"id": safe_text(c["id"], 80), "description": safe_text(c["description"], 1500)} for c in retired]
                        human.extend({"id": safe_text(r["original"]["id"], 80), "description": "Human portion only; technical criterion retained: " + safe_text(r["humanScope"], 1400)} for r in revision.get("replacedCriteria", [])[:100])
                        offline.append({"status": "offline-user-owned", "criteria": human})
                    records = {c["chunkId"]: c for c in s.get("chunks", []) if c.get("incrementId") == i["id"]}
                    planned = (i.get("plan") or {}).get("chunks", [])[:100]
                    chunk_created = creation_time((i.get("plan") or {}).get("recordedAt")) or creation_time(i.get("startedAt")) or roadmap_created
                    next_id = next((c["id"] for c in planned if c["id"] not in completed), None)
                    chunks = []
                    for number, c in enumerate(planned, 1):
                        record = records.get(c["id"], {})
                        chunks.append({"id": safe_text(c["id"], 80), "chunk_number": number, "title": safe_text(c["title"]), "outcome": safe_text(c["outcome"], 1400), "created_at": chunk_created, "status": "completed" if c["id"] in completed else "planned", "is_next": s.get("currentIncrementId") == i["id"] and c["id"] == next_id, "criteria_ids": [safe_text(k, 80) for k in c.get("criteriaIds", [])[:100] if k not in transferred_ids], "completed_at": safe_text(record.get("completedAt", ""), 80), "summary": safe_text(record.get("summary", ""), 1000), "tests": [safe_text(t, 400) for t in record.get("tests", [])[:12]]})
                    increments.append({"id": safe_text(i["id"], 80), "number": i["number"], "title": safe_text(i["title"]), "objective": safe_text(i["objective"], 1600), "status": safe_text(i["status"]), "proposal": increment_proposal(i), "chunk_plan_pending_approval": s.get("status") == "roadmap-review" and not s.get("roadmapApproval") and i.get("status") == "pending" and not i.get("plan") and not chunks, "chunk_plan_pending_start": bool(s.get("roadmapApproval")) and i.get("status") == "pending" and not i.get("plan") and not chunks, "criteria": criteria, "offline_acceptance": offline, "chunks_complete": sum(c["status"] == "completed" for c in chunks), "chunks_planned": len(chunks), "chunks": chunks})
                roadmaps.append({"id": safe_text(s["slug"], 80), "title": safe_text(s["name"]), "objective": safe_text(s["objective"], 1800), "created_at": roadmap_created, "status": safe_text(s["status"]), "evidence_policy": s.get("evidencePolicy", "declarative-legacy"), "current_increment": safe_text(s.get("currentIncrementId") or "none"), "increments": increments, "blockers": open_blocker_details(s), "blocker_count": sum(b.get("status") == "open" and b.get("actionOwner") == "human" for b in s.get("blockers", [])), "pending_work_count": sum(b.get("status") == "open" and b.get("actionOwner") == "agent" for b in s.get("blockers", []))})
                # Count every displayed identity before filtering completed or
                # otherwise ineligible rows. If the source exceeds the display
                # bound, uniqueness is unknown: do not infer any activity.
                identities = {}
                if len(s["increments"]) <= 100:
                    for increment in increments:
                        identity = increment["id"]
                        identities[identity] = identities.get(identity, 0) + 1
                for source, increment in zip(s["increments"][:100], increments):
                    increment["actively_worked"] = False
                    if (relative_path == f".implementation-roadmaps/{s['slug']}/state.json"
                            and isinstance(source["id"], str) and source["id"] == increment["id"]
                            and identities.get(increment["id"]) == 1
                            and s["status"] not in {"completed", "complete", "final-approved"}
                            and source["status"] not in {"completed", "complete", "final-approved"}):
                        increment_targets[relative_path, source["id"]] = increment
            except (ControlError, ValueError, KeyError, TypeError):
                diagnostics.append({"code": "projection.roadmap-unavailable"})
    # Stable identifiers break equal-date ties; unknown creation dates stay last.
    roadmaps.sort(key=lambda r: r["id"])
    roadmaps.sort(key=lambda r: r["created_at"] or "", reverse=True)
    try:
        state = Records(root).load()
    except ControlError:
        state = Records.empty()
        diagnostics.append({"code": "projection.local-state-unavailable"})
    current_time = creation_time(now())
    bindings = [binding for work in state["work_items"].values()
                if (binding := active_increment_binding(work, current_time)) is not None]
    # The contributor store permits one source-writing claim per checkout.
    # Activity is an advisory boolean, never a fresh approval or execution pass.
    if len(bindings) == 1 and (target := increment_targets.get(bindings[0])) is not None:
        target["actively_worked"] = True
    apply_presentations(root, roadmaps, diagnostics)
    enrich(root, roadmaps, state, diagnostics)
    apply_blocker_presentations(root, roadmaps, blocker_sources, diagnostics)
    # Responsibility affects display and scheduling, never acceptance. Keep each
    # unfinished issue visible; only an explicit human request is a blocker.
    for roadmap in roadmaps:
        issues = roadmap.get('blockers', [])
        roadmap['pending_work'] = [row for row in issues if row.get('action_owner') == 'agent']
        roadmap['blockers'] = [row for row in issues if row.get('action_owner') != 'agent']
        for increment in roadmap['increments']:
            for criterion in increment['criteria']:
                issues = criterion.get('blockers', [])
                criterion['pending_work'] = [row for row in issues if row.get('action_owner') == 'agent']
                criterion['blockers'] = [row for row in issues if row.get('action_owner') != 'agent']
    # A complete validated consolidation folds frozen delivery history beneath
    # its sole owner; it cannot mark that history or any criterion completed.
    roadmaps = [r for r in roadmaps if r.get('execution_role') != 'merged-history']
    works = []
    for roadmap in roadmaps:
        for increment in roadmap["increments"]:
            for chunk in increment["chunks"]:
                works.append({**chunk, "id": "/".join((roadmap["id"], increment["id"], chunk["id"])), "chunk_id": chunk["id"], "source": "roadmap-chunk", "roadmap_id": roadmap["id"], "roadmap_title": roadmap["title"], "increment_id": increment["id"], "increment_number": increment["number"], "increment_title": increment["title"], "criteria": [{key: c[key] for key in ("id", "outcome", "qualification", "evaluation_mode") if key in c} for c in increment["criteria"] if c["id"] in chunk["criteria_ids"]], "evidence_policy": roadmap["evidence_policy"]})
    execution_total = len(state["work_items"])
    execution_records = sorted(state["work_items"].values(), key=lambda w: w["spec"]["work_id"])
    execution_records.sort(key=lambda w: creation_time(w.get("created_at")) or creation_time((w.get("events") or [{}])[0].get("at")) or "", reverse=True)
    executions = []
    for w in execution_records[:1000]:
        # The browser displays success, falling back to problem. Keep agent-only
        # context and unknown notes in canonical records, outside the response.
        summary = {key: safe_text(w["spec"]["outcome"][key], 1000)
                   for key in ("success", "problem") if key in w["spec"]["outcome"]}
        executions.append({"id": safe_text(w["spec"]["work_id"], 80), "title": safe_text(w["spec"]["title"]), "kind": w["spec"]["kind"], "status": w["status"], "outcome": summary, "roadmap": safe_text((w["spec"].get("roadmap") or {}).get("increment_id", "lightweight")), "receipt_count": len(w.get("receipts", [])), "review_count": len(w.get("reviews", [])), "latest_verification": (w.get("receipts") or [{}])[-1].get("qualification", "unverified"), "latest_review": (w.get("reviews") or [{}])[-1].get("disposition", "missing"), "claim": "active" if w.get("claim") else "none"})
        executions[-1]["metrics"] = delivery(w)
        executions[-1]["source"] = "execution"
        executions[-1]["created_at"] = creation_time(w.get("created_at")) or creation_time((w.get("events") or [{}])[0].get("at"))
    trials = [{"id": safe_text(t["trial_id"], 80), "task_id": safe_text(t["task_id"], 80), "status": t["status"], "evidence_kind": t.get("evidence_kind", "unavailable"), "result": t.get("result", {}).get("status", "ungraded")} for t in list(state["trials"].values())[:200]]
    for projected, trial in zip(trials, list(state["trials"].values())[:200]):
        run = trial.get("run", {})
        projected["attempt_count"] = len(trial.get("attempts", []))
        projected["run"] = {"model": safe_text(run.get("model", "unavailable")), "assurance": safe_text(run.get("assurance", "unavailable")), "infrastructure_status": safe_text(run.get("infrastructure_status", "unavailable")), **{k: run.get(k) for k in ("duration_ms", "retries", "input_tokens", "output_tokens", "cost_usd")}}
    feedback = [{"id": safe_text(f["id"], 80), "work_id": safe_text(f["work_id"], 80), "summary": safe_text(f["summary"]), "status": f["status"], "regression": safe_text(f.get("regression", "unlinked"), 160)} for f in list(state["feedback"].values())[:200]]
    content = {"schema_version": "development-review-v1", "roadmaps": roadmaps, "work_items": works, "evaluations": trials, "feedback": feedback, "diagnostics": diagnostics, "local_revision": state["revision"], "inventory": {"execution_records_total": execution_total, "execution_records_shown": 0, "execution_records_truncated": False}}
    # Keep the existing 2 MiB server bound. Canonical roadmap detail is stored
    # once; newest scoped records also have a byte admission bound, with room
    # for envelope fields and an explicit truncation diagnostic.
    size = len(json.dumps(content).encode("utf-8"))
    shown = 0
    for row in executions:
        addition = len(json.dumps(row).encode("utf-8")) + 2
        if size + addition > REVIEW_MAX_BYTES - 4096:
            break
        works.append(row)
        size += addition
        shown += 1
    content["inventory"].update(execution_records_shown=shown, execution_records_truncated=shown < execution_total)
    if shown < execution_total:
        diagnostics.append({"code": "projection.execution-records-truncated", "total": execution_total, "shown": shown})
    works.sort(key=lambda w: (w.get("roadmap_id", ""), w.get("increment_number", 0), w.get("chunk_number", 0), w["id"]))
    works.sort(key=lambda w: w["created_at"] or "", reverse=True)
    content["generated_at"] = now()
    content["repository_id"] = digest(str(root.resolve()))
    return bound_review_projection(content)
