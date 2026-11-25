"""Bounded declared Work/phase context; never Work or review authority."""
from __future__ import annotations
import copy
import os
import subprocess
from pathlib import Path
from . import usage
from .common import fields, now
from .contracts import ControlError
from .storage import exclusive_lock
from . import usage_scopes

MAX_CONTEXTS = 16
MAX_MARKERS = 64
CONTEXT_FIELDS = {"work_ref", "candidate_ref", "review_ref", "ref", "phase", "basis", "source_ref", "fence",
                  "settled", "dirty", "active", "review_started", "activity"}


def validate_state(state):
    contexts, markers = state["phase_contexts"], state["phase_markers"]
    usage._need(isinstance(contexts, dict) and len(contexts) <= MAX_CONTEXTS)
    usage._need(isinstance(markers, list) and len(markers) <= MAX_MARKERS)
    for agent, context in contexts.items():
        usage._hash(agent)
        allowed = CONTEXT_FIELDS | (usage_scopes.PLANNING_FIELDS if usage_scopes.enabled(state) else set())
        fields(context, allowed, CONTEXT_FIELDS)
        planning = usage_scopes.PLANNING_FIELDS.intersection(context)
        if planning:
            usage._need(planning == usage_scopes.PLANNING_FIELDS)
            for key in ("scope_ref", "assignment_ref", "tasks_ref", "approval_ref"):
                if context[key] is not None: usage._hash(context[key])
            usage._need(type(context["planning_valid"]) is bool)
            usage._need(context["time_phase"] in set(usage.PHASES) - {"legacy_unknown"})
            if context["marked_at"] is not None: usage_scopes.marker_time(context["marked_at"])
            usage._need((context["assignment_ref"] is None) == (context["tasks_ref"] is None))
            if context["planning_valid"]:
                usage._need(context["marked_at"] is not None)
                usage._need(context["scope_ref"] is None or context["approval_ref"] is not None)
            else:
                usage._need(all(context[key] is None for key in ("scope_ref", "assignment_ref", "tasks_ref", "approval_ref", "marked_at"))
                            and context["time_phase"] == "unknown")
        for key in ("work_ref", "candidate_ref", "review_ref", "ref", "source_ref"):
            if context[key] is not None: usage._hash(context[key])
        usage._need(context["work_ref"] is not None and context["ref"] is not None)
        usage._need(context["phase"] in set(usage.PHASES) - {"legacy_unknown"} and context["basis"] in {"declared", "inferred", "unavailable"})
        for key in ("settled", "dirty", "active", "review_started"): usage._need(type(context[key]) is bool)
        if context["fence"] is not None: usage._integer(context["fence"])
        usage._need(context["activity"] is None or context["activity"] in usage.PURPOSES)
    seen = set()
    for marker in markers:
        fields(marker, {"id", "digest"}, {"id", "digest"})
        usage._hash(marker["id"]); usage._hash(marker["digest"])
        usage._need(marker["id"] not in seen); seen.add(marker["id"])


def classify(state, event):
    """Called only under the numeric import lock, after duplicate rejection."""
    context = state["phase_contexts"].get(event["agent"])
    attribution = event.get("attribution")
    if event["purpose"] != "implementation":
        if context and attribution and context["active"] and attribution["context_ref"] == context["ref"] and attribution["work_ref"] == context["work_ref"] and context["fence"] is not None and attribution["position"] is not None and context["source_ref"] == attribution["source_ref"] and attribution["position"] >= context["fence"]:
            context["settled"] = True; context["dirty"] = False
        return "not_applicable", "unavailable"
    if not context or not attribution or not context["active"]: return "unknown", "unavailable"
    if attribution["context_ref"] != context["ref"] or attribution["work_ref"] != context["work_ref"]:
        return "unknown", "unavailable"  # live-lock revalidation, never stale pre-review
    if context["phase"] in {"mixed", "unknown"}: return context["phase"], "unavailable"
    position = attribution["position"]
    if context["source_ref"] is None or context["source_ref"] != attribution["source_ref"] or context["fence"] is None or position is None:
        return "unknown", "unavailable"
    if position < context["fence"]: return "mixed", "unavailable"
    if not context["settled"]:
        # The first completed response after the observed source cut can have
        # been in flight. Do not pretend to split its internal consumption.
        context["settled"] = True
        result = "unknown" if context["dirty"] else "mixed"
        context["dirty"] = False
        return result, "unavailable"
    return context["phase"], context["basis"]


def transition(root, *, work_ref, candidate_ref, marker_id, operation, targets, review_ref=None, activity=None,
               initial_reviewed=False, expected=None, supersedes=None, external_without_expected=False,
               planning_context=None):
    """Atomic marker with observed source fences; ids/refs are already opaque."""
    for value in (work_ref, candidate_ref, marker_id): usage._hash(value)
    if review_ref is not None: usage._hash(review_ref)
    usage._need(operation in {"associate", "review-start", "review-decision", "correction-resume", "later", "activity", "close"})
    usage._need(activity is None or activity in usage.PURPOSES)
    usage._need(isinstance(targets, list) and 1 <= len(targets) <= MAX_CONTEXTS)
    for target in targets:
        fields(target, {"agent", "source_ref", "fence"}, {"agent", "source_ref", "fence"})
        usage._hash(target["agent"])
        if target["source_ref"] is not None: usage._hash(target["source_ref"])
        if target["fence"] is not None: usage._integer(target["fence"])
    usage._need(len({target["agent"] for target in targets}) == len(targets))
    body = {"work_ref": work_ref, "candidate_ref": candidate_ref, "operation": operation, "review_ref": review_ref,
            "activity": activity, "agents": [target["agent"] for target in targets], "sources": [target["source_ref"] for target in targets]}
    if planning_context is not None:
        usage_scopes.validate_context(planning_context)
        body["planning_context"] = planning_context
    fingerprint = usage.digest(body)
    usage._directory_clean(root)
    with exclusive_lock(usage._path(root, "writer.lock"), timeout_seconds=0.2):
        state = usage._load(root); usage._need(state is not None, "phase.capture-unavailable")
        usage._need(planning_context is None or usage_scopes.enabled(state), "phase.scoped-disabled")
        state = copy.deepcopy(state)
        previous = next((value for value in state["phase_markers"] if value["id"] == marker_id), None)
        if previous:
            usage._need(previous["digest"] == fingerprint, "phase.marker-conflict")
            return {"state": "recorded", "duplicate_marker": True, "work_may_continue": True}
        # Replay eligibility shares the live writer lock with ring rotation.
        # A retained request may have been evicted since the command pre-read.
        usage._need(not external_without_expected or len(state["phase_markers"]) < MAX_MARKERS,
                    "phase.expected-context-required", "Read usage phase-status and refresh expected_contexts; no phase was inferred.")
        expected = expected or {}
        scope_ref = usage_scopes.register(state, planning_context) if planning_context is not None else None
        for target in targets:
            agent = target["agent"]; old = state["phase_contexts"].get(agent)
            usage._need(expected.get(agent) == (old["ref"] if old else None), "phase.stale-context")
            if not old and len(state["phase_contexts"]) >= MAX_CONTEXTS:
                retired = next((key for key, context in state["phase_contexts"].items() if not context["active"]), None)
                usage._need(retired is not None, "phase.context-cap")
                del state["phase_contexts"][retired]
            same = old is not None and old["work_ref"] == work_ref
            overlap = old is not None and old["active"] and not same and old["work_ref"] != supersedes
            reviewed = initial_reviewed or same and old["review_started"] or operation in {"review-start", "review-decision", "correction-resume", "later"}
            if operation == "associate": phase = "post_review_other" if reviewed else "pre_review"
            elif operation == "correction-resume":
                usage._need(review_ref is not None, "phase.correction-reference")
                phase = "review_fixes"
            elif operation in {"review-start", "review-decision", "later"}: phase = "post_review_other"
            elif operation == "activity": phase = old["phase"] if same else "unknown"
            else: phase = "unknown"
            time_phase = old.get("time_phase", phase) if operation == "activity" and same else phase
            if overlap: phase = time_phase = "mixed"
            valid_cut = target["source_ref"] is not None and target["fence"] is not None
            if not valid_cut: phase = "unknown"
            state["phase_contexts"][agent] = {"work_ref": work_ref, "candidate_ref": candidate_ref, "review_ref": review_ref,
                "ref": usage.digest([marker_id, fingerprint, agent]), "phase": phase, "basis": "declared" if valid_cut else "unavailable",
                "source_ref": target["source_ref"], "fence": target["fence"], "settled": False,
                "dirty": bool(old and not old["settled"]), "active": operation != "close", "review_started": bool(reviewed),
                "activity": activity if activity is not None else old["activity"] if same else None}
            if usage_scopes.enabled(state):
                valid = bool(planning_context and planning_context["valid"])
                state["phase_contexts"][agent].update(scope_ref=scope_ref,
                    assignment_ref=planning_context["assignment_ref"] if planning_context else None,
                    tasks_ref=planning_context["tasks_ref"] if planning_context else None,
                    approval_ref=planning_context["approval_ref"] if planning_context else None,
                    planning_valid=valid, marked_at=usage_scopes.marker_now() if valid else None,
                    time_phase=time_phase if valid else "unknown")
        state["phase_markers"].append({"id": marker_id, "digest": fingerprint})
        state["phase_markers"] = state["phase_markers"][-MAX_MARKERS:]
        state["revision"] += 1
        validate_state(state); usage._publish(root, state)
    return {"state": "recorded", "duplicate_marker": False, "contexts_updated": len(targets), "work_may_continue": True,
            "attribution": "declared-and-partial"}


def work_reference(root, work, workspace):
    owner = str(root.resolve())
    return usage.digest([workspace, owner.casefold() if os.name == "nt" else owner, work["spec"]["work_id"], work["spec_digest"]])


def invalidate(root, work_ref, agents):
    """Best-effort fail-closed metadata only; numeric totals/cursors never move."""
    try:
        with exclusive_lock(usage._path(root, "writer.lock"), timeout_seconds=0.2):
            state = usage._load(root); changed = False
            for agent in agents:
                context = state["phase_contexts"].get(agent)
                if context and context["work_ref"] == work_ref:
                    context.update(phase="unknown", basis="unavailable", source_ref=None, fence=None, settled=False,
                                   ref=usage.digest([context["ref"], "unavailable"]))
                    if usage_scopes.enabled(state) and usage_scopes.PLANNING_FIELDS.intersection(context):
                        context.update(scope_ref=None, assignment_ref=None, tasks_ref=None, approval_ref=None,
                                       planning_valid=False, marked_at=None, time_phase="unknown")
                    changed = True
            if changed:
                state["revision"] += 1; usage._publish(root, state)
            return changed
    except (ControlError, OSError, ValueError, TypeError, KeyError):
        return False


def command(root: Path, request, *, _lifecycle=False):
    """Bounded source/Work association; failure is a nonblocking diagnostic."""
    try:
        allowed = {"schema_version", "operation", "work_id", "marker_id", "agents", "source_ref", "review_ref", "advisory_ref", "finding_refs", "activity", "correction_of", "expected_contexts"}
        fields(request, allowed, {"schema_version", "operation", "work_id", "marker_id"})
        usage._need(request["schema_version"] == "usage-phase-command-v1")
        operation = request["operation"]; associating = operation == "associate"
        usage._label(request["work_id"]); usage._label(request["marker_id"])
        usage._need(operation in {"associate", "review-start", "review-decision", "correction-resume", "later", "activity", "close"})
        from . import usage_local as local
        from .records import Records
        root = root.resolve(); config = local._config(root); workspace, primary = local._repository(root)
        usage._need(workspace == config["workspace_id"], "phase.workspace")
        destination = Path(config["destination"]) if config["destination"] else root
        usage._need(local._repository(destination)[0] == workspace, "phase.destination")
        controller = Records(root); records = controller.load(); work = records["work_items"].get(request["work_id"])
        usage._need(work is not None, "phase.work-unavailable")
        reference = work_reference(root, work, workspace)
        usage._need(work["status"] != "complete" or operation == "close", "phase.work-closed")
        candidate = request.get("source_ref")
        if candidate is None:
            candidate = work["receipts"][-1]["source_digest"] if work["receipts"] else work["baseline"].get("source_digest")
            if candidate is None: candidate = controller.baseline(work)["source_digest"]
        usage._hash(candidate)
        review_ref = request.get("review_ref"); supersedes = None
        if operation == "correction-resume" or request.get("correction_of") is not None:
            origin_id = request.get("correction_of", request["work_id"]); usage._label(origin_id)
            origin = records["work_items"].get(origin_id); usage._need(origin is not None, "phase.correction-reference")
            if request.get("correction_of") is not None: supersedes = work_reference(root, origin, workspace)
            canonical = origin["reviews"][-1] if origin["reviews"] and origin["reviews"][-1]["review_digest"] == review_ref and origin["reviews"][-1]["disposition"] == "changes-requested" else None
            if not canonical:
                usage._need(review_ref is None and request.get("advisory_ref") is not None and request.get("source_ref") is not None, "phase.correction-reference")
                usage._hash(request["advisory_ref"])
                findings = request.get("finding_refs")
                usage._need(isinstance(findings, list) and 1 <= len(findings) <= 8)
                for finding in findings: usage._label(finding)
                review_ref = usage.digest([request["advisory_ref"], candidate, findings])
            operation = "correction-resume"
        elif review_ref is not None:
            usage._hash(review_ref)
            usage._need(bool(work["reviews"]) and work["reviews"][-1]["review_digest"] == review_ref, "phase.review-reference")
        captured = local.poll(root)
        state = usage._load(destination); usage._need(state is not None, "phase.capture-unavailable")
        selected = {binding["thread_id"]: binding for binding in config["threads"]}
        agents = request.get("agents")
        if agents is None:
            if associating: agents = [os.environ.get("CODEX_THREAD_ID")]
            else:
                agents = [identity for identity, binding in selected.items() if (state["phase_contexts"].get(
                    usage.digest([local.PROTOCOL, workspace, identity])) or {}).get("work_ref") == reference]
        usage._need(isinstance(agents, list) and 1 <= len(agents) <= MAX_CONTEXTS and len(set(agents)) == len(agents), "phase.agent-association")
        marker_id = usage.digest([reference, request["marker_id"]])
        declared = request.get("expected_contexts")
        aliases = {identity: "agent-" + usage.digest([local.PROTOCOL, workspace, identity])[:12] for identity in agents if identity in selected}
        if declared is not None:
            usage._need(isinstance(declared, dict) and (set(declared) == set(agents) or set(declared) == set(aliases.values())), "phase.stale-context")
        targets = []; expected = {}
        for identity in agents:
            local._uuid(identity); usage._need(identity in selected, "phase.agent-association")
            agent = usage.digest([local.PROTOCOL, workspace, identity]); context = state["phase_contexts"].get(agent)
            expected[agent] = context["ref"] if context else None
            if declared is not None:
                value = declared[identity] if identity in declared else declared[aliases[identity]]
                if value is not None: usage._hash(value)
                expected[agent] = value  # checked under the writer lock, after replay detection
            if not associating: usage._need(context is not None and context["work_ref"] == reference, "phase.agent-association")
            source_ref = fence = None
            if captured.get("state") != "unavailable":
                source = local._read_source(root, identity, workspace, primary, usage._time(now()), minimum_offset=selected[identity]["minimum_offset"])
                usage._need(source["source_id"] == selected[identity]["source_id"] and source["parent"] == selected[identity]["parent_id"], "phase.source")
                source_ref, fence = source["source_id"], source["snapshot_end"]
            targets.append({"agent": agent, "source_ref": source_ref, "fence": fence})
        planning_context = None
        if usage_scopes.enabled(state):
            from .planning_scopes import resolve
            planning_context = resolve(root, work, workspace)
        result = transition(destination, work_ref=reference, candidate_ref=candidate, marker_id=marker_id, operation=operation,
                            targets=targets, review_ref=review_ref, activity=request.get("activity"), initial_reviewed=bool(work["reviews"]), expected=expected, supersedes=supersedes,
                            external_without_expected=not _lifecycle and declared is None, planning_context=planning_context)
        result["token_capture"] = captured
        return result
    except (ControlError, OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError, subprocess.SubprocessError) as error:
        invalidated = False
        if "expected" in locals() and "reference" in locals() and "destination" in locals() and expected and not (isinstance(error, ControlError) and error.code in {"phase.marker-conflict", "phase.stale-context", "phase.expected-context-required"}):
            # Do not let a known unsuccessful transition retain a clean label.
            # I/O/lock failure can prevent even this write; report that honestly.
            invalidated = invalidate(destination, reference, expected)
        return {"state": "unavailable", "reason_code": error.code if isinstance(error, ControlError) else "phase.unavailable",
                "work_may_continue": True, "attribution_invalidated": invalidated,
                "attribution": "unavailable-refresh-marker-before-relying-on-phase"}


def status(root):
    """Read only, opaque bounded refs; no source lookup or host content read."""
    try:
        from . import usage_local as local
        config = local._config(root); workspace, _ = local._repository(root)
        destination = Path(config["destination"]) if config["destination"] else root
        usage._need(local._repository(destination)[0] == workspace, "phase.destination")
        state = usage._load(destination)
        return {"state": "available", "work_may_continue": True, "contexts": [
            {"agent_alias": "agent-" + agent[:12], "work_ref": context["work_ref"], "context_ref": context["ref"],
             "phase": context["phase"], "active": context["active"],
             **({"agent_ref": agent, "scope_ref": context.get("scope_ref"), "marked_at": context.get("marked_at"),
                 "time_phase": context.get("time_phase", "unknown"), "planning_valid": context.get("planning_valid", False)}
                if usage_scopes.enabled(state) else {})}
            for agent, context in sorted((state or {}).get("phase_contexts", {}).items())]}
    except (ControlError, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        return {"state": "unavailable", "work_may_continue": True, "contexts": []}


def work_event(root, work_id, action, *, correction_of=None, review_ref=None):
    """No configuration means no metadata/source lookup or mutation."""
    from . import usage_local as local
    if not local.usage_capture._file(root, local.CONFIG).exists(): return None
    operation = {"start": "associate", "review": "review-decision", "complete": "close"}.get(action)
    if action == "verify":
        from .records import Records
        work = Records(root).load()["work_items"].get(work_id)
        if work and work["reviews"]:
            config = local._config(root); workspace, _ = local._repository(root)
            destination = Path(config["destination"]) if config["destination"] else root
            state = usage._load(destination); reference = work_reference(root, work, workspace)
            if state and any(context["work_ref"] == reference and not context["review_started"] for context in state["phase_contexts"].values()):
                operation = "review-decision"; review_ref = work["reviews"][-1]["review_digest"]
    if operation is None: return None
    request = {"schema_version": "usage-phase-command-v1", "operation": operation, "work_id": work_id,
               "marker_id": "work-" + action + ("-" + review_ref[:24] if review_ref else "")}
    if correction_of is not None: request["correction_of"] = correction_of
    if review_ref is not None: request["review_ref"] = review_ref
    return command(root, request, _lifecycle=True)
