"""Closed activity schema shared by all v3 readers; capture is separately admitted."""
from __future__ import annotations

import copy
import re
from pathlib import Path

from . import usage, usage_scopes as scopes
from .common import fields
from .storage import exclusive_lock

IMPORT_SCHEMA = "contributor-activity-import-v1"
MAX_EVENTS = 64
# A repository-owned host adapter must be separately qualified before using this
# private seam. No installed live adapter currently supplies it. JSON/CLI cannot.
_QUALIFIED_NUMERIC_HOST = object()


def stats():
    return {"measured_ms": 0, "estimated_ms": 0, "measured_intervals": 0, "estimated_intervals": 0,
            "unavailable_intervals": 0, "intervals": 0, "coarse": 0, "attribution_basis": [0, 0, 0]}


def empty():
    return {**scopes.empty_buckets(), "scoped": scopes.empty_buckets(), "cursors": {}, "last_updated": None}


def validate_groups(value):
    usage._need(isinstance(value, dict) and len(value) <= len(usage.SCOPES) * (len(usage.PURPOSES) - 1 + len(usage.PHASES)))
    for group, row in value.items():
        usage._need(isinstance(group, str) and len(group) <= 100)
        parts = group.split("|")
        usage._need(len(parts) == 3 and parts[0] in usage.SCOPES and parts[1] in usage.PURPOSES
                    and parts[2] in (usage.PHASES if parts[1] == "implementation" else {"not_applicable"}))
        example = stats(); fields(row, set(example), set(example))
        for key, value in row.items():
            if key == "attribution_basis":
                usage._need(isinstance(value, list) and len(value) == 3)
                for count in value: usage._integer(count)
            else: usage._integer(value)
        usage._need(row["measured_intervals"] + row["estimated_intervals"] + row["unavailable_intervals"] == row["intervals"]
                    and sum(row["attribution_basis"]) == row["intervals"] and row["coarse"] <= row["intervals"])
        usage._need(row["measured_intervals"] > 0 or row["measured_ms"] == 0)
        usage._need(row["estimated_intervals"] > 0 or row["estimated_ms"] == 0)


def validate_state(state):
    value = state["scope_metrics"]["activity"]
    names = scopes.BUCKETS | {"scoped", "cursors", "last_updated"}
    fields(value, names, names)
    validate_groups(value["totals"]); validate_groups(value["older_quarters"])
    for period in usage.DEFAULT_RETENTION:
        usage._need(isinstance(value[period], dict) and len(value[period]) <= state["retention"][period])
        for stamp, groups in value[period].items():
            if period == "quarterly":
                usage._need(isinstance(stamp, str) and re.fullmatch(r"20\d\d-Q[1-4]|21\d\d-Q[1-4]|2200-Q[1-4]", stamp) is not None)
            else:
                parsed = usage._time(stamp + "T00:00:00Z")
                usage._need(period != "weekly" or parsed.weekday() == 0)
            validate_groups(groups)
    scopes.validate_known(value["scoped"], value, state["scope_metrics"]["definitions"], state["retention"],
                          factory=stats, validate=validate_groups)
    cursors = value["cursors"]
    usage._need(isinstance(cursors, dict) and len(cursors) <= usage.MAX_STREAMS)
    names = {"agent_ref", "session_ref", "producer_ref", "scope", "sequence", "ended_at", "last_digest",
             "clock_ref", "monotonic_end_ms"}
    for key, cursor in cursors.items():
        usage._hash(key); fields(cursor, names, names)
        for field in ("agent_ref", "session_ref", "producer_ref", "last_digest"): usage._hash(cursor[field])
        usage._need(cursor["scope"] in usage.SCOPES); usage._integer(cursor["sequence"])
        scopes.marker_time(cursor["ended_at"])
        usage._need((cursor["clock_ref"] is None) == (cursor["monotonic_end_ms"] is None))
        if cursor["clock_ref"] is not None:
            usage._hash(cursor["clock_ref"]); usage._integer(cursor["monotonic_end_ms"])
        usage._need(key == usage.digest([cursor[field] for field in ("producer_ref", "agent_ref", "session_ref", "scope")]))
    if value["last_updated"] is not None: scopes.marker_time(value["last_updated"])
    # Bound complete subtotals as well as individual cells.
    for scope in usage.SCOPES:
        total = stats()
        for group, row in value["totals"].items():
            if group.split("|")[0] == scope: usage._merge(total, row)


def _event(value, clock, source):
    names = {"producer_ref", "agent_ref", "session_ref", "sequence", "started_at", "ended_at", "scope", "purpose",
             "measurement", "duration_ms", "clock_ref", "monotonic_start_ms", "monotonic_end_ms", "attribution"}
    fields(value, names, names)
    for key in ("producer_ref", "agent_ref", "session_ref"): usage._hash(value[key])
    usage._integer(value["sequence"])
    start, end = scopes.marker_time(value["started_at"]), scopes.marker_time(value["ended_at"])
    usage._need(start <= end <= clock, "activity.time", "Closed activity spans must be ordered and not in the future.")
    usage._need(value["scope"] in usage.SCOPES and value["purpose"] in usage.PURPOSES)
    usage._need(value["measurement"] in {"measured", "estimated", "unavailable"})
    elapsed = round((end - start).total_seconds() * 1000)
    measured = value["measurement"] == "measured"
    if value["measurement"] == "unavailable":
        usage._need(value["duration_ms"] is None)
    else:
        usage._integer(value["duration_ms"])
        usage._need(value["duration_ms"] <= elapsed + int(measured), "activity.duration")
    clock_fields = ("clock_ref", "monotonic_start_ms", "monotonic_end_ms")
    if measured:
        usage._need(source is _QUALIFIED_NUMERIC_HOST, "activity.measured-source-unavailable",
                    "Measured activity needs a qualified numeric host source; operator manifests may supply estimates or unknown durations.")
        usage._hash(value["clock_ref"])
        for key in clock_fields[1:]: usage._integer(value[key])
        usage._need(value["monotonic_end_ms"] - value["monotonic_start_ms"] == value["duration_ms"], "activity.clock")
    else:
        usage._need(all(value[key] is None for key in clock_fields), "activity.clock")
    fields(value["attribution"], {"work_ref", "context_ref"}, {"work_ref", "context_ref"})
    for ref in value["attribution"].values():
        if ref is not None: usage._hash(ref)
    usage._need((value["attribution"]["work_ref"] is None) == (value["attribution"]["context_ref"] is None))
    return copy.deepcopy(value)


def _context(state, event):
    context = state["phase_contexts"].get(event["agent_ref"])
    refs = event["attribution"]
    if (not context or not context["active"] or not context.get("planning_valid") or not context.get("marked_at")
            or refs["context_ref"] != context["ref"] or refs["work_ref"] != context["work_ref"]
            or scopes.marker_time(event["started_at"]) < scopes.marker_time(context["marked_at"])
            or context["activity"] is not None and context["activity"] != event["purpose"]):
        return None, "unknown", "unavailable"
    phase = context["time_phase"]
    if phase in {"mixed", "unknown"}: return None, phase, "unavailable"
    return context.get("scope_ref"), phase, "declared"


def _prune(value, floors):
    for period, floor in floors.items():
        for stamp in list(value[period]):
            if stamp >= floor: continue
            if period == "quarterly":
                for group, row in value[period][stamp].items(): scopes.add_group(value["older_quarters"], group, row, stats)
            del value[period][stamp]
    scopes.prune_known(value["scoped"], floors, stats)


def import_observations(root: Path, manifest, *, at=None, _source=None):
    """Optional closed spans; public operator imports never claim measured time."""
    fields(manifest, {"schema_version", "events"}, {"schema_version", "events"})
    usage._need(manifest["schema_version"] == IMPORT_SCHEMA and isinstance(manifest["events"], list)
                and 1 <= len(manifest["events"]) <= MAX_EVENTS and len(usage._encoded(manifest)) <= usage.MAX_INPUT_BYTES)
    clock = scopes.marker_time(at or scopes.marker_now())
    events = [_event(value, clock, _source) for value in manifest["events"]]
    root = root.resolve(); usage._directory_clean(root)
    accepted = duplicates = older = 0
    with exclusive_lock(usage._path(root, "writer.lock"), timeout_seconds=0.2):
        state = usage._load(root)
        usage._need(scopes.enabled(state), "activity.scoped-disabled", "Explicitly deploy compatible scoped usage before importing activity.")
        state = copy.deepcopy(state); value = state["scope_metrics"]["activity"]
        floors = usage._floors(clock, state["retention"])
        for event in events:
            key = usage.digest([event[field] for field in ("producer_ref", "agent_ref", "session_ref", "scope")])
            previous = value["cursors"].get(key); fingerprint = usage.digest(event)
            if previous and event["sequence"] <= previous["sequence"]:
                if event["sequence"] == previous["sequence"]:
                    usage._need(fingerprint == previous["last_digest"], "activity.replay-conflict")
                    duplicates += 1
                else: older += 1
                continue
            usage._need(event["sequence"] == (previous["sequence"] + 1 if previous else 0), "activity.sequence")
            usage._need(previous is not None or len(value["cursors"]) < usage.MAX_STREAMS, "activity.cursor-capacity")
            if previous:
                usage._need(scopes.marker_time(event["started_at"]) >= scopes.marker_time(previous["ended_at"]), "activity.overlap")
                usage._need(event["clock_ref"] == previous["clock_ref"], "activity.clock-session")
                if previous["monotonic_end_ms"] is not None:
                    usage._need(event["monotonic_start_ms"] >= previous["monotonic_end_ms"], "activity.clock")
            if event["scope"] == "own":
                usage._need(all(cursor["agent_ref"] != event["agent_ref"] or cursor["scope"] != "own"
                                or scopes.marker_time(cursor["ended_at"]) <= scopes.marker_time(event["started_at"])
                                for cursor in value["cursors"].values()), "activity.own-overlap",
                            "Own-agent spans must be chronological and nonoverlapping across sessions; no duration was inferred.")
            ref, phase, basis = _context(state, event)
            group = "|".join((event["scope"], event["purpose"], phase if event["purpose"] == "implementation" else "not_applicable"))
            row = stats(); row["intervals"] = 1; row["attribution_basis"][("declared", "inferred", "unavailable").index(basis)] = 1
            row["coarse"] = int(event["started_at"][:10] != event["ended_at"][:10])
            status = event["measurement"]
            row[{"measured": "measured_intervals", "estimated": "estimated_intervals", "unavailable": "unavailable_intervals"}[status]] = 1
            if status != "unavailable": row[status + "_ms"] = event["duration_ms"]
            scopes.add_group(value["totals"], group, row, stats); _prune(value, floors)
            if ref is not None: scopes.add_known(value["scoped"]["totals"], ref, group, row, stats)
            for period, stamp in usage._periods(scopes.marker_time(event["ended_at"])).items():
                target = value[period].setdefault(stamp, {}) if stamp >= floors[period] else value["older_quarters"] if period == "quarterly" else None
                if target is not None: scopes.add_group(target, group, row, stats)
                if ref is not None:
                    known = value["scoped"][period].setdefault(stamp, {}) if stamp >= floors[period] else value["scoped"]["older_quarters"] if period == "quarterly" else None
                    if known is not None: scopes.add_known(known, ref, group, row, stats)
            value["cursors"][key] = {field: event[field] for field in ("agent_ref", "session_ref", "producer_ref", "scope", "sequence", "ended_at", "clock_ref")}
            value["cursors"][key].update(last_digest=fingerprint, monotonic_end_ms=event["monotonic_end_ms"])
            accepted += 1
        if accepted:
            value["last_updated"] = at or clock.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            state["revision"] += 1; usage._publish(root, state)
    return {"status": "recorded", "accepted": accepted, "duplicates": duplicates,
            "older_sequences_not_recounted": older, "live_capture": False, "work_may_continue": True}


def rollup(groups, *, scope="own", purpose=None, phase=None):
    result = stats()
    for group, row in groups.items():
        own, activity, implementation_phase = group.split("|")
        if own == scope and (purpose is None or purpose == activity) and (phase is None or phase == implementation_phase):
            usage._merge(result, row)
    return {"measured_ms": result["measured_ms"] if result["measured_intervals"] else None,
            "estimated_ms": result["estimated_ms"] if result["estimated_intervals"] else None,
            "unavailable_intervals": result["unavailable_intervals"], "intervals": result["intervals"],
            "coarse_intervals": result["coarse"], "attribution": dict(zip(("declared", "inferred", "unavailable"), result["attribution_basis"]))}


def summary(root: Path):
    try:
        state = usage._load(root.resolve())
        if not scopes.enabled(state): return {"status": "disabled", "coverage": "unavailable", "live_capture": False}
        value = state["scope_metrics"]["activity"]
        return {"status": "enabled", "coverage": "partial-or-unavailable", "unit": "agent-effort-ms", "live_capture": False,
                "last_updated": value["last_updated"], "own_time": rollup(value["totals"]),
                "implementation_phases": {phase: rollup(value["totals"], purpose="implementation", phase=phase) for phase in usage.PHASES},
                "repository_unattributed": rollup(scopes.residual(value["totals"], value["scoped"]["totals"], factory=stats, validate=validate_groups)),
                "unaggregated_scopes": {scope: rollup(value["totals"], scope=scope) for scope in usage.SCOPES - {"own"}},
                "retention": state["retention"], "work_may_continue": True}
    except (usage.ControlError, OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError, ImportError, AttributeError):
        return {"status": "unavailable", "coverage": "unavailable", "live_capture": False, "work_may_continue": True}


def report_summary(root: Path):
    try:
        return summary(usage.reporting_root(root))
    except usage.READER_ERRORS:
        return {"status": "unavailable", "coverage": "unavailable", "live_capture": False, "work_may_continue": True}
