"""Read-only sparse leaf views; parent reports never sum already folded views."""
from __future__ import annotations

from . import usage, usage_activity as activity, usage_scopes as scopes

ANCHORS = {"_planning_ancestry", "_planning_story_ancestry"}


def nodes(value):
    for key in ("roadmaps", "work_item_roadmaps"):
        for parent in value.get(key, []):
            yield parent
            for increment in parent.get("increments", []):
                yield increment
                yield from increment.get("stories", [])
            for history in parent.get("merged_history", []):
                yield history
                for increment in history.get("increments", []):
                    yield increment
                    yield from increment.get("stories", [])


def strip_anchors(value):
    for node in nodes(value):
        for key in ANCHORS: node.pop(key, None)


def _pair(tokens, time, *, purpose=None, phase=None):
    return {"tokens": usage._rollup(tokens, purpose=purpose, phase=phase),
            "time": activity.rollup(time, purpose=purpose, phase=phase)}


def _fold(target, groups, factory):
    for group, stats in groups.items(): scopes.add_group(target, group, stats, factory)


def attach(root, value, maximum):
    """Only visible canonical anchors select scopes; callers provide no lineage."""
    from .usage_local import _repository
    state = usage._load(usage.reporting_root(root))
    if not scopes.enabled(state):
        strip_anchors(value)
        value.pop("planning_metrics", None)
        return value
    repository_ref, _ = _repository(root.resolve())
    source = state["scope_metrics"]; entries = []; routes = {}

    def target(node, roadmap, increment=None, story=None):
        ancestry = node.pop("_planning_ancestry", None)
        if ancestry is None: return None
        definition = {"repository_ref": repository_ref, "roadmap_id": roadmap,
                      "increment_id": increment, "story_id": story, "ancestry_digest": ancestry}
        scopes.validate_definition(definition)
        ref = usage.digest(definition)
        entry = {"node": node, "ref": ref, "tokens": scopes.empty_buckets(), "activity": scopes.empty_buckets(), "observed": False}
        entries.append(entry)
        return entry

    if not value.get("pagination") or value["pagination"]["view"] == "roadmaps":
        for parent in value["roadmaps"]:
            top = target(parent, parent["id"])
            if top: routes[top["ref"]] = [top]
            for increment in parent["increments"]:
                current = target(increment, parent["id"], increment["id"])
                ancestors = [entry for entry in (top, current) if entry is not None]
                if current: routes[current["ref"]] = ancestors
                known_stories = increment.pop("_planning_story_ancestry", {})
                displayed = {story["id"]: story for story in increment.get("stories", [])}
                for identity, ancestry in known_stories.items():
                    node = displayed.get(identity)
                    story = target(node, parent["id"], increment["id"], identity) if node is not None else None
                    definition = {"repository_ref": repository_ref, "roadmap_id": parent["id"],
                                  "increment_id": increment["id"], "story_id": identity, "ancestry_digest": ancestry}
                    scopes.validate_definition(definition)
                    routes[usage.digest(definition)] = [*ancestors, *([story] if story else [])]
    strip_anchors(value)
    for name, source_buckets, factory in (("tokens", source["tokens"], usage._stats),
                                          ("activity", source["activity"]["scoped"], activity.stats)):
        for bucket in scopes.BUCKETS:
            cells = {None: source_buckets[bucket]} if bucket in {"totals", "older_quarters"} else source_buckets[bucket]
            for stamp, leaves in cells.items():
                for ref, groups in leaves.items():
                    for entry in routes.get(ref, []):
                        target_groups = entry[name][bucket] if stamp is None else entry[name][bucket].setdefault(stamp, {})
                        _fold(target_groups, groups, factory); entry["observed"] = True
    known_tokens = {}; known_time = {}
    for groups in source["tokens"]["totals"].values(): _fold(known_tokens, groups, usage._stats)
    for groups in source["activity"]["scoped"]["totals"].values(): _fold(known_time, groups, activity.stats)
    global_report = {"schema_version": "planning-metrics-summary-v1", "status": "enabled", "coverage": "partial-or-unavailable",
        "time_unit": "agent-effort-ms", "live_activity_capture": False,
        "repository_unattributed": _pair(scopes.residual(state["totals"], source["tokens"]["totals"]),
            scopes.residual(source["activity"]["totals"], source["activity"]["scoped"]["totals"], factory=activity.stats, validate=activity.validate_groups)),
        "all_scoped_usage": _pair(known_tokens, known_time), "retention": state["retention"]}
    patches = []; size = len(usage._encoded(global_report))
    for entry in entries:
        if not entry["observed"]: continue
        tokens, time = entry["tokens"], entry["activity"]
        report = {"schema_version": "planning-scope-report-v1", "status": "recorded", "coverage": "partial-or-unavailable",
                  "phases": {phase: _pair(tokens["totals"], time["totals"], purpose="implementation", phase=phase) for phase in usage.PHASES},
                  "all_purposes": _pair(tokens["totals"], time["totals"]), "trends": {},
                  "direct_scope": _pair(source["tokens"]["totals"].get(entry["ref"], {}), source["activity"]["scoped"]["totals"].get(entry["ref"], {}))}
        for period, limit in (("daily", 7), ("weekly", 8), ("quarterly", 8)):
            stamps = sorted(set(tokens[period]) | set(time[period]))[-limit:]
            report["trends"][period] = [{"period": stamp,
                "implementation": _pair(tokens[period].get(stamp, {}), time[period].get(stamp, {}), purpose="implementation", phase="pre_review"),
                "review_fixes": _pair(tokens[period].get(stamp, {}), time[period].get(stamp, {}), purpose="implementation", phase="review_fixes")} for stamp in stamps]
        size += len(usage._encoded(report))
        if size > maximum:
            value["planning_metrics"] = {"status": "omitted", "coverage": "unavailable"}
            value["diagnostics"].append({"code": "projection.optional-metrics-omitted"})
            return value
        patches.append((entry["node"], report))
    for node, report in patches: node["scoped_metrics"] = report
    value["planning_metrics"] = global_report
    return value
