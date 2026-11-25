"""Opt-in exclusive planning scopes within the existing atomic numeric store."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from pathlib import Path

from . import usage
from .common import fields, identifier
from .storage import exclusive_lock

SCHEMA = "contributor-token-usage-v3"
BUCKETS = {"totals", "daily", "weekly", "quarterly", "older_quarters"}
PLANNING_FIELDS = {"scope_ref", "assignment_ref", "tasks_ref", "approval_ref", "planning_valid", "marked_at", "time_phase"}


def enabled(state):
    return state is not None and state.get("schema_version") == SCHEMA


def empty_buckets():
    return {key: {} for key in BUCKETS}


def marker_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def marker_time(value):
    import re
    usage._need(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z", value) is not None)
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        usage._need(False)
    usage._need(2000 <= result.year <= 2200)
    return result


def validate_definition(value):
    names = {"repository_ref", "roadmap_id", "increment_id", "story_id", "ancestry_digest"}
    fields(value, names, names)
    usage._hash(value["repository_ref"]); usage._hash(value["ancestry_digest"])
    identifier(value["roadmap_id"])
    for key in ("increment_id", "story_id"):
        if value[key] is not None: identifier(value[key])
    usage._need(value["story_id"] is None or value["increment_id"] is not None)
    return value


def validate_context(value):
    names = {"definition", "assignment_ref", "tasks_ref", "approval_ref", "valid"}
    fields(value, names, names)
    usage._need(type(value["valid"]) is bool)
    if value["definition"] is not None: validate_definition(value["definition"])
    for key in ("assignment_ref", "tasks_ref", "approval_ref"):
        if value[key] is not None: usage._hash(value[key])
    usage._need(value["valid"] or all(value[key] is None for key in names - {"valid"}))
    usage._need((value["assignment_ref"] is None) == (value["tasks_ref"] is None))
    if value["definition"] is not None:
        usage._need(value["approval_ref"] is not None)
        if value["definition"]["story_id"] is not None: usage._need(value["tasks_ref"] is not None)
    return value


def register(state, context):
    validate_context(context)
    value = context["definition"]
    if value is None: return None
    key = usage.digest(value); definitions = state["scope_metrics"]["definitions"]
    usage._need(key in definitions or len(definitions) < usage.MAX_STREAMS, "usage.scope-capacity")
    usage._need(key not in definitions or definitions[key] == value, "usage.scope-conflict")
    definitions[key] = copy.deepcopy(value)
    return key


def add_group(groups, key, stats, factory=usage._stats):
    usage._merge(groups.setdefault(key, factory()), stats)


def add_known(groups, ref, group, stats, factory=usage._stats):
    add_group(groups.setdefault(ref, {}), group, stats, factory)


def residual(raw, known, *, factory=usage._stats, validate=usage._validate_groups):
    """Old/unassigned data remains explicit without duplicating every raw cell."""
    validate(raw)
    allocated = {}
    for groups in known.values():
        validate(groups)
        for group, stats in groups.items(): add_group(allocated, group, stats, factory)
    usage._need(set(allocated) <= set(raw), "usage.scope-conservation")
    result = copy.deepcopy(raw)
    for group, stats in allocated.items():
        for key, amount in stats.items():
            if isinstance(amount, list):
                for index, count in enumerate(amount):
                    result[group][key][index] -= count
                    usage._need(result[group][key][index] >= 0, "usage.scope-conservation")
            else:
                result[group][key] -= amount
                usage._need(result[group][key] >= 0, "usage.scope-conservation")
    validate(result)
    return result


def validate_known(value, raw, definitions, retention, *, factory=usage._stats, validate=usage._validate_groups):
    fields(value, BUCKETS, BUCKETS)
    def cells(known, source):
        usage._need(isinstance(known, dict) and len(known) <= usage.MAX_STREAMS and set(known) <= set(definitions))
        residual(source, known, factory=factory, validate=validate)
    cells(value["totals"], raw["totals"]); cells(value["older_quarters"], raw["older_quarters"])
    for period in usage.DEFAULT_RETENTION:
        usage._need(isinstance(value[period], dict) and len(value[period]) <= retention[period]
                    and set(value[period]) <= set(raw[period]))
        for stamp, known in value[period].items(): cells(known, raw[period][stamp])


def validate_state(state):
    value = state["scope_metrics"]
    fields(value, {"definitions", "tokens", "activity"}, {"definitions", "tokens", "activity"})
    definitions = value["definitions"]
    usage._need(isinstance(definitions, dict) and len(definitions) <= usage.MAX_STREAMS)
    for key, definition in definitions.items():
        usage._hash(key); validate_definition(definition)
        usage._need(usage.digest(definition) == key, "usage.scope-integrity")
    validate_known(value["tokens"], state, definitions, state["retention"])
    for context in state["phase_contexts"].values():
        if context.get("scope_ref") is not None:
            usage._need(context["scope_ref"] in definitions and context.get("planning_valid") is True)
    from . import usage_activity
    usage_activity.validate_state(state)


def enable(root: Path):
    """Explicit deployment boundary; generic enable/import/lifecycle stays v2."""
    root = root.resolve(); usage._directory_clean(root)
    with exclusive_lock(usage._path(root, "writer.lock"), timeout_seconds=0.2):
        state = usage._load(root)
        usage._need(state is not None, "usage.disabled", "Enable optional numeric retention before scoped reporting.")
        if not enabled(state):
            from . import usage_activity
            state = copy.deepcopy(state)
            state.update(schema_version=SCHEMA, scope_metrics={"definitions": {}, "tokens": empty_buckets(),
                                                               "activity": usage_activity.empty()})
            state["revision"] += 1
            usage._publish(root, state)
    return summary(root)


def classify(state, event):
    if not enabled(state): return None
    context = state["phase_contexts"].get(event["agent"]); attribution = event.get("attribution")
    if (not context or not attribution or not context["active"] or not context["settled"]
            or not context.get("planning_valid") or context.get("scope_ref") is None
            or context["phase"] in {"unknown", "mixed"}
            or attribution["context_ref"] != context["ref"] or attribution["work_ref"] != context["work_ref"]
            or context["source_ref"] is None or attribution["source_ref"] != context["source_ref"]
            or context["fence"] is None or attribution["position"] is None or attribution["position"] < context["fence"]):
        return None
    return context["scope_ref"]


def prune_known(value, floors, factory=usage._stats):
    for period, floor in floors.items():
        for stamp in list(value[period]):
            if stamp >= floor: continue
            if period == "quarterly":
                for ref, groups in value[period][stamp].items():
                    for group, stats in groups.items(): add_known(value["older_quarters"], ref, group, stats, factory)
            del value[period][stamp]


def record(state, event, group, stats, ref, floors):
    if not enabled(state): return
    target = state["scope_metrics"]["tokens"]; prune_known(target, floors)
    if ref is None: return
    usage._need(ref in state["scope_metrics"]["definitions"], "usage.scope-integrity")
    add_known(target["totals"], ref, group, stats)
    for period, stamp in usage._periods(usage._time(event["ended_at"])).items():
        if stamp >= floors[period]: add_known(target[period].setdefault(stamp, {}), ref, group, stats)
        elif period == "quarterly": add_known(target["older_quarters"], ref, group, stats)


def summary(root: Path, *, limit=16):
    usage._need(type(limit) is int and 1 <= limit <= 128)
    try:
        state = usage._load(root.resolve())
        if not enabled(state): return {"status": "disabled", "coverage": "unavailable", "scopes": []}
        value = state["scope_metrics"]; tokens = value["tokens"]["totals"]
        unknown = residual(state["totals"], tokens)
        refs = sorted(tokens)[:limit]
        return {"schema_version": "planning-token-summary-v1", "status": "enabled", "coverage": "partial-or-unavailable",
                "scopes_observed": len(tokens), "scopes_shown": len(refs),
                "scopes": [{"scope_ref": ref, **value["definitions"][ref], "own_usage": usage._rollup(tokens[ref]),
                            "implementation_phases": {phase: usage._rollup(tokens[ref], purpose="implementation", phase=phase)
                                                      for phase in usage.PHASES}} for ref in refs],
                "repository_unattributed": usage._rollup(unknown), "retention": state["retention"],
                "maximum_bytes": usage.MAX_BYTES, "work_may_continue": True}
    except (usage.ControlError, OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError, ImportError, AttributeError):
        return {"status": "unavailable", "coverage": "unavailable", "scopes": [], "work_may_continue": True}


def report_summary(root: Path, *, limit=16):
    try:
        return summary(usage.reporting_root(root), limit=limit)
    except usage.READER_ERRORS:
        return {"status": "unavailable", "coverage": "unavailable", "scopes": [], "work_may_continue": True}
