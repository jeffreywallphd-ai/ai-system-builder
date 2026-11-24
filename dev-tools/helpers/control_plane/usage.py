"""Optional numeric-only contributor usage; no provider calls or Work authority.

One atomic bounded file owns cursors, recent detail and UTC trend aggregates.
The normalized import is an adapter seam, not an authenticated host integration.
"""
from __future__ import annotations

import copy
import json
import re
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .common import digest, fields, now, read_json, refuse
from .contracts import ControlError
from .storage import atomic_write, confined_path, exclusive_lock

V1_SCHEMA = "contributor-token-usage-v1"
SCHEMA = "contributor-token-usage-v2"
IMPORT_SCHEMA = "contributor-token-import-v1"
IMPORT_V2 = "contributor-token-import-v2"
MAX_BYTES = 4 * 1024 * 1024
MAX_INPUT_BYTES = 128 * 1024
MAX_STREAMS = 4096
MAX_RECENT = 128
MAX_EVENTS = 64
MAX_NUMBER = 2**53 - 1
METRICS = ("input_tokens", "output_tokens", "cached_input_tokens", "reasoning_output_tokens")
PURPOSES = {"planning", "research", "implementation", "tests", "review", "bookkeeping", "mixed", "unclassified"}
SCOPES = {"own", "includes-descendants", "unknown"}
PROVENANCE = {"host-reported", "operator-declared", "unavailable"}
PHASES = ("pre_review", "review_fixes", "post_review_other", "mixed", "unknown", "legacy_unknown")
DEFAULT_RETENTION = {"daily": 400, "weekly": 156, "quarterly": 40}
RETENTION_BOUNDS = {"daily": (90, 730), "weekly": (13, 520), "quarterly": (4, 80)}
BASE = ".local-codex/control-plane/usage"


def _need(condition, code="usage.invalid", message="Usage input is unsupported; no usage totals were changed."):
    if not condition:
        refuse(code, message)


def _integer(value, maximum=MAX_NUMBER):
    _need(type(value) is int and 0 <= value <= maximum)
    return value


def _label(value):
    _need(isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}", value) is not None)
    return value


def _time(value):
    _need(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value) is not None)
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        refuse("usage.time", "Usage timestamps must be real UTC instants.")


def _encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def _path(root, leaf):
    # Do not accept even an in-repository junction as an alternate usage store.
    for relative in (".local-codex", ".local-codex/control-plane", BASE, BASE + "/" + leaf):
        path = confined_path(root, relative)
        if path.exists() or path.is_symlink():
            info = path.lstat()
            _need(not path.is_symlink() and not getattr(info, "st_file_attributes", 0) & 0x400,
                  "usage.link", "Usage storage links are unsupported.")
            _need(stat.S_ISDIR(info.st_mode) if relative != BASE + "/" + leaf else stat.S_ISREG(info.st_mode))
    return confined_path(root, BASE + "/" + leaf)


def _directory_clean(root):
    directory = _path(root, "state.json").parent
    if not directory.exists():
        return
    # A killed atomic writer may leave one unpublished temporary file. Preserve
    # it, refuse another publication and avoid unbounded crash-file accumulation.
    for index, path in enumerate(directory.iterdir()):
        _need(index < 4 and path.name in {"state.json", "writer.lock"}, "usage.unpublished",
              "Usage publication needs recovery; preserved files were not removed and imports were not counted.")


def _retention(value):
    fields(value, set(DEFAULT_RETENTION), set(DEFAULT_RETENTION))
    for key, limits in RETENTION_BOUNDS.items():
        _need(type(value[key]) is int and limits[0] <= value[key] <= limits[1])
    return dict(value)


def _empty(retention):
    return {"schema_version": SCHEMA, "revision": 0, "retention": _retention(retention), "streams": {}, "active_epochs": {},
            "totals": {}, "daily": {}, "weekly": {}, "quarterly": {}, "older_quarters": {},
            "recent": [], "recent_rotated": 0, "last_updated": None, "phase_contexts": {}, "phase_markers": []}


def _migrate_v1(value):
    """In-memory only; preserve numeric fields, replay digests and stream identity."""
    def groups(source):
        result = {}
        for key, stats in source.items():
            parts = key.split("|")
            _need(len(parts) == 3)
            _need(set(stats) == set(_stats()) - {"phase_basis"})
            stats["phase_basis"] = [0, 0, stats["intervals"]]
            result[key + "|" + ("legacy_unknown" if parts[1] == "implementation" else "not_applicable")] = stats
        return result
    value["totals"] = groups(value["totals"]); value["older_quarters"] = groups(value["older_quarters"])
    for period in DEFAULT_RETENTION:
        for stamp in value[period]: value[period][stamp] = groups(value[period][stamp])
    for row in value["streams"].values(): row["totals"] = groups(row["totals"])
    for row in value["recent"]:
        row["implementation_phase"] = "legacy_unknown" if row["purpose"] == "implementation" else "not_applicable"
        row["stats"]["phase_basis"] = [0, 0, row["stats"]["intervals"]]
    value.update(schema_version=SCHEMA, phase_contexts={}, phase_markers=[])
    return value


def _load(root):
    path = _path(root, "state.json")
    if not path.exists():
        return None
    value = read_json(path, maximum=MAX_BYTES)
    legacy = value.get("schema_version") == V1_SCHEMA
    required = (set(_empty(DEFAULT_RETENTION)) - {"active_epochs"} - ({"phase_contexts", "phase_markers"} if legacy else set())) | {"state_digest"}
    fields(value, required | {"active_epochs"}, required)
    _need(value["schema_version"] in {SCHEMA, V1_SCHEMA} and value["state_digest"] == digest({k: v for k, v in value.items() if k != "state_digest"}),
          "usage.integrity", "Usage storage integrity is unavailable; original bytes were preserved.")
    from .usage_phases import validate_state
    if not legacy: validate_state(value)
    _integer(value["revision"]); _integer(value["recent_rotated"])
    _retention(value["retention"])
    _need(isinstance(value["streams"], dict) and len(value["streams"]) <= MAX_STREAMS)
    _need(isinstance(value["recent"], list) and len(value["recent"]) <= MAX_RECENT)
    for key in ("daily", "weekly", "quarterly"):
        _need(isinstance(value[key], dict) and len(value[key]) <= value["retention"][key])
    _need(all(isinstance(value[k], dict) for k in ("totals", "older_quarters")))
    _validate_groups(value["totals"], legacy=legacy); _validate_groups(value["older_quarters"], legacy=legacy)
    for period in DEFAULT_RETENTION:
        for stamp, groups in value[period].items():
            if period == "quarterly":
                _need(isinstance(stamp, str) and re.fullmatch(r"20\d\d-Q[1-4]|21\d\d-Q[1-4]|2200-Q[1-4]", stamp) is not None)
            else:
                parsed = _time(stamp + "T00:00:00Z")
                _need(period != "weekly" or parsed.weekday() == 0)
            _validate_groups(groups, legacy=legacy)
    row_fields = {"agent", "parent", "mode", "scope", "sequence", "baselines", "totals", "first_at", "ended_at",
                  "last_digest", "model", "source", "purpose_basis"}
    for key, row in value["streams"].items():
        _hash(key); fields(row, row_fields, row_fields)
        for name in ("agent", "last_digest", "source"):
            _hash(row[name])
        for name in ("parent", "model"):
            if row[name] is not None: _hash(row[name])
        _need(row["mode"] in {"delta", "cumulative"} and row["scope"] in SCOPES and row["purpose_basis"] in {"declared", "inferred", "unavailable"})
        _integer(row["sequence"]); _need(_time(row["first_at"]) <= _time(row["ended_at"]))
        _validate_groups(row["totals"], legacy=legacy)
        _need(isinstance(row["baselines"], dict) and set(row["baselines"]) <= set(METRICS))
        for baseline in row["baselines"].values():
            fields(baseline, {"value", "status", "at", "provenance"}, {"value", "status", "at", "provenance"})
            _integer(baseline["value"]); _time(baseline["at"])
            _need(baseline["status"] in {"measured", "estimated"} and baseline["provenance"] in PROVENANCE - {"unavailable"})
    families = {}
    for identity, row in value["streams"].items():
        families.setdefault(_family(row["agent"], row["scope"]), []).append(identity)
    if "active_epochs" not in value:
        # An earlier draft without this index is unambiguous only when each
        # family has one epoch. Never guess which of multiple epochs was latest.
        _need(all(len(identities) == 1 for identities in families.values()), "usage.epoch-index-unavailable",
              "Usage has ambiguous historical epochs; original counters were preserved and need explicit recovery.")
        value["active_epochs"] = {family: identities[0] for family, identities in families.items()}
    active = value["active_epochs"]
    _need(isinstance(active, dict) and set(active) == set(families))
    for family, identity in active.items():
        _hash(family); _hash(identity); _need(identity in families[family])
    for row in value["recent"]:
        names = {"agent", "sequence", "ended_at", "purpose", "purpose_basis", "outcome", "stats"}
        if not legacy: names.add("implementation_phase")
        fields(row, names, names); _hash(row["agent"]); _integer(row["sequence"]); _time(row["ended_at"])
        _need(row["purpose"] in PURPOSES and row["purpose_basis"] in {"declared", "inferred", "unavailable"}
              and row["outcome"] in {"succeeded", "failed", "cancelled", "unavailable"})
        _validate_stats(row["stats"], legacy=legacy)
        if not legacy: _need(row["implementation_phase"] in (PHASES if row["purpose"] == "implementation" else {"not_applicable"}))
    if value["last_updated"] is not None: _time(value["last_updated"])
    if legacy: value = _migrate_v1(value)
    return value


def _publish(root, state):
    # Valid per-purpose fields can still overflow a combined scope subtotal.
    # Nonnegative lifetime bounds also bound every contained period/agent view.
    for scope in SCOPES:
        _rollup(state["totals"], scope=scope)
    state.pop("state_digest", None)
    state["state_digest"] = digest(state)
    payload = _encoded(state)
    _need(len(payload) <= MAX_BYTES, "usage.capacity",
          "Usage storage reached its 4 MiB limit; this import was not counted. Existing aggregates were preserved.")
    _directory_clean(root)
    atomic_write(_path(root, "state.json"), payload)


def enable(root: Path, retention=None):
    root = root.resolve()
    retention = _retention(retention or DEFAULT_RETENTION)
    _directory_clean(root)
    with exclusive_lock(_path(root, "writer.lock"), timeout_seconds=0.2):
        state = _load(root)
        if state:
            _need(state["retention"] == retention, "usage.retention-frozen",
                  "Existing usage retention cannot be changed by enable; retained aggregates were preserved.")
        else:
            _publish(root, _empty(retention))
    return summary(root)


def _stats():
    return {"measured": [0] * 4, "estimated": [0] * 4, "known_measured": [0] * 4,
            "known_estimated": [0] * 4, "unavailable": [0] * 4, "purpose_basis": [0] * 3, "phase_basis": [0] * 3, "intervals": 0, "coarse": 0}


def _hash(value):
    _need(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None)


def _family(agent, scope):
    return digest([agent, scope])


def _validate_stats(value, *, legacy=False):
    examples = _stats()
    if legacy: examples.pop("phase_basis")
    fields(value, set(examples), set(examples))
    for key, example in examples.items():
        if isinstance(example, list):
            _need(isinstance(value[key], list) and len(value[key]) == len(example))
            for count in value[key]: _integer(count)
        else:
            _integer(value[key])
    _need(value["coarse"] <= value["intervals"] and sum(value["purpose_basis"]) == value["intervals"])
    if not legacy: _need(sum(value["phase_basis"]) == value["intervals"])
    for index in range(4):
        _need(value["known_measured"][index] + value["known_estimated"][index] + value["unavailable"][index] == value["intervals"])


def _validate_groups(groups, *, legacy=False):
    _need(isinstance(groups, dict) and len(groups) <= len(SCOPES) * (len(PURPOSES) if legacy else len(PURPOSES) - 1 + len(PHASES)) * len(PROVENANCE))
    for group, stats in groups.items():
        _need(isinstance(group, str) and len(group) <= 100)
        parts = group.split("|")
        _need(len(parts) == (3 if legacy else 4) and parts[0] in SCOPES and parts[1] in PURPOSES and parts[2] in PROVENANCE)
        if not legacy: _need(parts[3] in (PHASES if parts[1] == "implementation" else {"not_applicable"}))
        _validate_stats(stats, legacy=legacy)


def _merge(target, source):
    for key, value in source.items():
        if isinstance(value, list):
            for index, count in enumerate(value):
                target[key][index] = _integer(target[key][index] + count)
        else:
            target[key] = _integer(target[key] + value)


def _add(groups, group, stats):
    _merge(groups.setdefault(group, _stats()), stats)


def _periods(at):
    week = (at - timedelta(days=at.weekday())).date().isoformat()
    return {"daily": at.date().isoformat(), "weekly": week, "quarterly": f"{at.year:04d}-Q{(at.month - 1) // 3 + 1}"}


def _floors(at, retention):
    quarter = at.year * 4 + (at.month - 1) // 3 - retention["quarterly"] + 1
    return {"daily": (at - timedelta(days=retention["daily"] - 1)).date().isoformat(),
            "weekly": (at - timedelta(days=at.weekday(), weeks=retention["weekly"] - 1)).date().isoformat(),
            "quarterly": f"{quarter // 4:04d}-Q{quarter % 4 + 1}"}


def _prune(state, floors):
    for period, floor in floors.items():
        for key in list(state[period]):
            if key < floor:
                if period == "quarterly":
                    for group, stats in state[period][key].items():
                        _add(state["older_quarters"], group, stats)
                del state[period][key]


EVENT_FIELDS = {"producer", "run_id", "agent_id", "parent_agent_id", "counter_epoch", "sequence", "counter_mode",
                "from_zero", "started_at", "ended_at", "scope", "purpose", "purpose_basis", "provenance", "model",
                "outcome", "counts"}


def _event(raw, clock, *, v2=False):
    fields(raw, EVENT_FIELDS | ({"attribution"} if v2 else set()), EVENT_FIELDS | ({"attribution"} if v2 else set()))
    for key in ("producer", "run_id", "agent_id", "counter_epoch"):
        _label(raw[key])
    if raw["parent_agent_id"] is not None:
        _label(raw["parent_agent_id"])
        _need(raw["parent_agent_id"] != raw["agent_id"], "usage.parent", "An agent cannot be its own usage parent.")
    if raw["model"] is not None:
        _label(raw["model"])
    _integer(raw["sequence"])
    _need(raw["counter_mode"] in {"delta", "cumulative"} and type(raw["from_zero"]) is bool)
    _need(raw["counter_mode"] != "delta" or not raw["from_zero"])
    _need(raw["scope"] in SCOPES and raw["purpose"] in PURPOSES and raw["purpose_basis"] in {"declared", "inferred", "unavailable"})
    _need(raw["provenance"] in PROVENANCE and raw["outcome"] in {"succeeded", "failed", "cancelled", "unavailable"})
    started, ended = _time(raw["started_at"]), _time(raw["ended_at"])
    _need(started <= ended <= clock, "usage.time", "Usage intervals must be ordered and not in the future.")
    _need(2000 <= started.year <= 2200)
    fields(raw["counts"], set(METRICS), set(METRICS))
    for metric, count in raw["counts"].items():
        fields(count, {"value", "status"}, {"value", "status"})
        _need(count["status"] in {"measured", "estimated", "unavailable"})
        if count["status"] == "unavailable":
            _need(count["value"] is None)
        else:
            _integer(count["value"])
            _need(raw["provenance"] != "unavailable")
    for subset, total in (("cached_input_tokens", "input_tokens"), ("reasoning_output_tokens", "output_tokens")):
        part, whole = raw["counts"][subset], raw["counts"][total]
        if part["value"] is not None and whole["value"] is not None and part["status"] == whole["status"]:
            _need(part["value"] <= whole["value"], "usage.subset", "Cache and reasoning counts are subsets, not extra tokens.")
    agent = digest([raw["producer"], raw["run_id"], raw["agent_id"]])
    parent = digest([raw["producer"], raw["run_id"], raw["parent_agent_id"]]) if raw["parent_agent_id"] else None
    stream = digest([agent, raw["counter_epoch"]])
    # No raw external labels or content enter durable state or public output.
    event = {k: raw[k] for k in ("sequence", "counter_mode", "from_zero", "started_at", "ended_at", "scope", "purpose", "purpose_basis", "provenance", "outcome", "counts")}
    event.update(agent=agent, parent=parent, stream=stream, model=digest(raw["model"]) if raw["model"] else None,
                 source=digest(raw["producer"]))
    if v2:
        attribution = raw["attribution"]
        names = {"work_ref", "context_ref", "source_ref", "position"}
        fields(attribution, names, names)
        for key in names - {"position"}:
            if attribution[key] is not None: _hash(attribution[key])
        if attribution["position"] is not None: _integer(attribution["position"])
        event["attribution"] = dict(attribution)
    return event


def _ancestry(state, event):
    parents = {row["agent"]: row["parent"] for row in state["streams"].values()}
    _need(event["agent"] not in parents or parents[event["agent"]] == event["parent"], "usage.parent", "Usage parentage changed within one run.")
    parents[event["agent"]] = event["parent"]
    seen, current = set(), event["agent"]
    while current is not None:
        _need(current not in seen, "usage.parent", "Usage parent relationships contain a cycle.")
        seen.add(current)
        current = parents.get(current)


def import_observations(root: Path, manifest, *, at=None):
    """One bounded atomic import. Repeated imports do not repeat consumption."""
    clock = _time(at or now())
    fields(manifest, {"schema_version", "events"}, {"schema_version", "events"})
    _need(manifest["schema_version"] in {IMPORT_SCHEMA, IMPORT_V2} and isinstance(manifest["events"], list) and 1 <= len(manifest["events"]) <= MAX_EVENTS)
    _need(len(_encoded(manifest)) <= MAX_INPUT_BYTES)
    events = [_event(raw, clock, v2=manifest["schema_version"] == IMPORT_V2) for raw in manifest["events"]]
    root = root.resolve()
    _directory_clean(root)
    with exclusive_lock(_path(root, "writer.lock"), timeout_seconds=0.2):
        state = _load(root)
        _need(state is not None, "usage.disabled", "Enable optional local usage retention before importing counters.")
        state = copy.deepcopy(state)
        floors = _floors(clock, state["retention"])
        accepted = duplicates = stale = baseline_fields = gaps = 0
        for event in events:
            identity = event["stream"]
            family = _family(event["agent"], event["scope"])
            row = state["streams"].get(identity)
            event_digest = digest(event)
            if row and event["sequence"] <= row["sequence"]:
                if event["sequence"] == row["sequence"]:
                    _need(row["last_digest"] == event_digest, "usage.conflict", "A usage sequence was replayed with different counters; nothing was imported.")
                    duplicates += 1
                else:
                    stale += 1
                continue
            _ancestry(state, event)
            if row:
                _need(state["active_epochs"].get(family) == identity, "usage.retired-epoch",
                      "A retired counter epoch cannot resume consumption; old counters and totals were preserved.")
                _need(event["counter_mode"] == row["mode"] and event["scope"] == row["scope"] and not event["from_zero"],
                      "usage.epoch", "Counter mode/scope/reset changes require a new explicit epoch.")
                _need(event["started_at"] >= row["ended_at"], "usage.overlap", "Usage intervals overlap; no counters were imported.")
                if event["counter_mode"] == "delta":
                    _need(event["sequence"] == row["sequence"] + 1, "usage.sequence-gap", "Delta usage needs contiguous sequences; preserve and import the missing interval first.")
                elif event["sequence"] != row["sequence"] + 1:
                    gaps += 1
            else:
                _need(len(state["streams"]) < MAX_STREAMS, "usage.stream-capacity", "Usage cursor capacity reached; this import was not counted. Existing aggregates were preserved.")
                _need(event["sequence"] == 0, "usage.sequence", "A new usage epoch begins with sequence zero.")
                _need(all(event["started_at"] >= previous["ended_at"] for previous in state["streams"].values()
                          if previous["agent"] == event["agent"] and previous["scope"] == event["scope"]),
                      "usage.epoch-overlap", "An agent's new usage epoch overlaps already observed consumption.")
                row = {"agent": event["agent"], "parent": event["parent"], "mode": event["counter_mode"], "scope": event["scope"],
                       "sequence": -1, "baselines": {}, "totals": {}, "first_at": event["started_at"]}
                state["streams"][identity] = row
                state["active_epochs"][family] = identity
            stats = _stats(); stats["intervals"] = 1
            stats["purpose_basis"][("declared", "inferred", "unavailable").index(event["purpose_basis"])] = 1
            from .usage_phases import classify
            phase, phase_basis = classify(state, event)
            stats["phase_basis"][("declared", "inferred", "unavailable").index(phase_basis)] = 1
            stats["coarse"] = int(event["started_at"][:10] != event["ended_at"][:10])
            for index, metric in enumerate(METRICS):
                count = event["counts"][metric]
                value, status = count["value"], count["status"]
                if status != "unavailable" and event["counter_mode"] == "cumulative":
                    previous = row["baselines"].get(metric)
                    if previous:
                        _need(value >= previous["value"], "usage.counter-reset", "A cumulative counter decreased; use a new explicit epoch.")
                        if status == previous["status"] and event["provenance"] == previous["provenance"]:
                            value -= previous["value"]
                            stats["coarse"] = max(stats["coarse"], int(previous["at"][:10] != event["ended_at"][:10] or previous["at"] != event["started_at"]))
                        else:
                            value = None
                    elif not event["from_zero"]:
                        value = None
                    row["baselines"][metric] = {**count, "at": event["ended_at"], "provenance": event["provenance"]}
                    if value is None:
                        baseline_fields += 1
                if value is None:
                    stats["unavailable"][index] += 1
                else:
                    stats[status][index] = value
                    stats["known_" + status][index] = 1
            for part, whole in ((2, 0), (3, 1)):
                for status in ("measured", "estimated"):
                    if stats["known_" + status][part] and stats["known_" + status][whole]:
                        _need(stats[status][part] <= stats[status][whole], "usage.subset", "Counter deltas violate cache/reasoning subset semantics; nothing was imported.")
            group = "|".join(event[k] for k in ("scope", "purpose", "provenance")) + "|" + phase
            _add(row["totals"], group, stats)
            _add(state["totals"], group, stats)
            _prune(state, floors)
            for period, key in _periods(_time(event["ended_at"])).items():
                if key >= floors[period]:
                    _add(state[period].setdefault(key, {}), group, stats)
                elif period == "quarterly":
                    _add(state["older_quarters"], group, stats)
            row.update(sequence=event["sequence"], ended_at=event["ended_at"], last_digest=event_digest,
                       model=event["model"], source=event["source"], purpose_basis=event["purpose_basis"])
            state["recent"].append({"agent": event["agent"], "sequence": event["sequence"], "ended_at": event["ended_at"],
                                    "purpose": event["purpose"], "purpose_basis": event["purpose_basis"], "outcome": event["outcome"], "stats": stats, "implementation_phase": phase})
            if len(state["recent"]) > MAX_RECENT:
                state["recent"].pop(0)
                state["recent_rotated"] += 1
            state["last_updated"] = max(state["last_updated"] or event["ended_at"], event["ended_at"])
            accepted += 1
        if accepted:
            state["revision"] += 1
            _publish(root, state)
    warnings = []
    if stale: warnings.append("older-sequences-not-recounted")
    if baseline_fields: warnings.append("initial-or-changed-counter-baseline-unavailable")
    if gaps: warnings.append("cumulative-observation-gaps")
    return {"accepted": accepted, "duplicates": duplicates, "older_sequences_not_recounted": stale,
            "warnings": warnings, "summary": summary(root)}


def _rollup(groups, *, scope="own", purpose=None, phase=None):
    result = _stats()
    provenance = set()
    for group, stats in groups.items():
        current_scope, current_purpose, current_provenance, current_phase = group.split("|")
        _need(current_scope in SCOPES and current_purpose in PURPOSES and current_provenance in PROVENANCE)
        if current_scope == scope and (purpose is None or current_purpose == purpose) and (phase is None or current_phase == phase):
            _merge(result, stats)
            provenance.add(current_provenance)
    value = {status: {metric: result[status][index] if result["known_" + status][index] else None for index, metric in enumerate(METRICS)}
             for status in ("measured", "estimated")}
    value.update(intervals=result["intervals"], unavailable_fields=dict(zip(METRICS, result["unavailable"])),
                 coarse_intervals=result["coarse"], provenance=sorted(provenance),
                 purpose_attribution=dict(zip(("declared", "inferred", "unavailable"), result["purpose_basis"])),
                 phase_attribution=dict(zip(("declared", "inferred", "unavailable"), result["phase_basis"])))
    return value


def _summary(root, period=None, limit=8):
    _need(period is None or period in DEFAULT_RETENTION)
    _need(type(limit) is int and 1 <= limit <= (RETENTION_BOUNDS[period][1] if period else 80))
    state = _load(root)
    if state is None:
        return {"status": "disabled", "warnings": ["no-authorized-counter-feed"], "coverage": "unavailable"}
    warnings = ["coverage-of-unreported-agents-and-intervals-unknown", "purpose-attribution-is-coarse"]
    try:
        _directory_clean(root)
    except ControlError:
        warnings.append("unpublished-usage-file-preserved-imports-paused")
    agents = {}
    for row in state["streams"].values():
        agent = agents.setdefault(row["agent"], {"parent": row["parent"], "totals": {}, "ended_at": row["ended_at"]})
        for group, stats in row["totals"].items():
            _add(agent["totals"], group, stats)
        agent["ended_at"] = max(agent["ended_at"], row["ended_at"])
    missing_parents = len({row["parent"] for row in agents.values() if row["parent"] and row["parent"] not in agents})
    if missing_parents: warnings.append("reported-parent-counters-missing")
    excluded = sum(_rollup(state["totals"], scope=scope)["intervals"] for scope in SCOPES - {"own"})
    if excluded: warnings.append("inclusive-or-unknown-scope-kept-out-of-own-subtotal")
    used = _path(root, "state.json").stat().st_size
    if used >= MAX_BYTES * 0.9 or len(state["streams"]) >= MAX_STREAMS * 0.9:
        warnings.append("usage-capacity-near-limit-imports-may-be-refused")
    phases = lambda groups: {phase: _rollup(groups, purpose="implementation", phase=phase) for phase in PHASES}
    trends = {key: [{"period": stamp, "usage": _rollup(groups), "implementation_phases": phases(groups)} for stamp, groups in sorted(state[key].items())[-(limit if period else (7 if key == "daily" else 8)):]]
              for key in ([period] if period else DEFAULT_RETENTION)}
    rows = sorted(agents.items(), key=lambda pair: (pair[1]["ended_at"], pair[0]), reverse=True)
    reported_parents = {row["parent"] for row in agents.values() if row["parent"]}
    def observed_role(key, row):
        if key in reported_parents:
            return "parent-and-child" if row["parent"] else "parent"
        return "child" if row["parent"] else "unclassified"
    return {"status": "enabled", "schema_version": "contributor-token-summary-v2", "coverage": "partial-or-unavailable", "revision": state["revision"],
            "implementation_phases": phases(state["totals"]),
            "last_updated": state["last_updated"], "warnings": warnings, "known_own_subtotal": _rollup(state["totals"]),
            "unaggregated_scopes": {scope: _rollup(state["totals"], scope=scope) for scope in sorted(SCOPES - {"own"})},
            "purpose": {purpose: _rollup(state["totals"], purpose=purpose) for purpose in sorted(PURPOSES)
                        if _rollup(state["totals"], purpose=purpose)["intervals"]},
            "agents_observed": len(agents), "missing_reported_parents": missing_parents, "agents_shown": min(16, len(rows)),
            "agents": [{"alias": "agent-" + key[:12], "parent_alias": "agent-" + row["parent"][:12] if row["parent"] else None,
                        "role": observed_role(key, row), "role_basis": "reported-parent-links",
                        "own_usage": _rollup(row["totals"]), "implementation_phases": phases(row["totals"]), "last_updated": row["ended_at"]} for key, row in rows[:16]],
            "trends": trends, "older_quarters": _rollup(state["older_quarters"]),
            "storage": {"bytes": used, "maximum_bytes": MAX_BYTES, "stream_cursors": len(state["streams"]),
                        "maximum_stream_cursors": MAX_STREAMS, "recent_detail": len(state["recent"]),
                        "recent_detail_compacted": state["recent_rotated"], "retention": state["retention"]},
            "time_attribution": "UTC interval-end; multi-day intervals remain coarse", "cost_usd": None}


def summary(root: Path, *, period=None, limit=8):
    """Optional diagnostics can never break status, review or contributor work."""
    try:
        return _summary(root.resolve(), period, limit)
    except (ControlError, OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError):
        return {"status": "unavailable", "coverage": "unavailable", "warnings": ["usage-storage-unavailable-original-bytes-preserved"]}
