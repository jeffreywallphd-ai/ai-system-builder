"""Bounded Codex-v2 numeric export receiver; never reads conversations or starts a host.

The desktop host must supply the selected numeric notifications. This adapter
does not discover private stores, subscribe through undocumented endpoints, or
turn availability of a file/process into a claim of live measurement.
"""
from __future__ import annotations

import copy
import os
import stat
from datetime import timedelta
from pathlib import Path

from . import usage
from .common import fields, now, read_json
from .contracts import ControlError
from .storage import confined_path

CONFIG = ".local-codex/token-capture/config.json"
PREFIX = ".local-codex/token-capture/"
PROTOCOL = "codex-app-server-v2-six-token-fields"
MAX_CONFIG_BYTES = 32 * 1024
RECENT_SECONDS = 900
COUNTERS = {"totalTokens", "inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteInputTokens", "reasoningOutputTokens"}
MAPPING = dict(zip(usage.METRICS, ("inputTokens", "outputTokens", "cachedInputTokens", "reasoningOutputTokens")))


def _need(condition, code="capture.invalid", message="The numeric capture input is unsupported; original usage was preserved."):
    usage._need(condition, code, message)


def _file(root, name):
    _need(isinstance(name, str) and name.startswith(PREFIX) and name.endswith(".json")
          and len(name) <= 240 and "\\" not in name and len(name.split("/")) <= 8, "capture.path")
    try:
        path = confined_path(root, name)
        current = root
        for index, part in enumerate(name.split("/")):
            _need(part not in {"", ".", ".."})
            current = current / part
            if current.exists() or current.is_symlink():
                info = current.lstat()
                _need(not current.is_symlink() and not getattr(info, "st_file_attributes", 0) & 0x400, "capture.link")
                _need(stat.S_ISREG(info.st_mode) if index == len(name.split("/")) - 1 else stat.S_ISDIR(info.st_mode), "capture.file-type")
        return path
    except ControlError:
        raise ControlError("capture.path", "Numeric capture files must be regular contained ignored JSON files.", {}, [])


def _read(path, maximum):
    before = path.stat()
    value = read_json(path, maximum=maximum)
    after = path.stat()
    _need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
          (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "capture.file-changed")
    return value


def _config(root, path, session):
    value = _read(_file(root, path), MAX_CONFIG_BYTES)
    keys = {"schema_version", "protocol", "source_version", "counter_semantics", "session_id", "feed_path", "threads"}
    fields(value, keys, keys)
    _need(value["schema_version"] == "codex-token-capture-config-v1" and value["protocol"] == PROTOCOL
          and value["counter_semantics"] == "cumulative-provider-counters", "capture.protocol")
    usage._label(session); usage._label(value["session_id"]); usage._label(value["source_version"])
    _need(value["session_id"] == session, "capture.session-mismatch")
    _file(root, value["feed_path"])
    _need(isinstance(value["threads"], list) and 1 <= len(value["threads"]) <= 64)
    selected = {}
    for row in value["threads"]:
        keys = {"thread_id", "parent_thread_id", "counter_epoch", "scope", "purpose", "purpose_basis"}
        fields(row, keys, keys)
        for key in ("thread_id", "counter_epoch"): usage._label(row[key])
        if row["parent_thread_id"] is not None: usage._label(row["parent_thread_id"])
        _need(row["thread_id"] not in selected and row["thread_id"] != row["parent_thread_id"], "capture.thread-binding")
        _need(row["scope"] in usage.SCOPES and row["purpose"] in usage.PURPOSES
              and row["purpose_basis"] in {"declared", "inferred", "unavailable"})
        selected[row["thread_id"]] = row
    for identity in selected:
        seen, current = set(), identity
        while current in selected:
            _need(current not in seen, "capture.parent-cycle")
            seen.add(current); current = selected[current]["parent_thread_id"]
    return value, selected


def _counter(value, *, consumption):
    fields(value, COUNTERS, COUNTERS)
    for count in value.values(): usage._integer(count)
    _need(value["cachedInputTokens"] + value["cacheWriteInputTokens"] <= value["inputTokens"]
          and value["reasoningOutputTokens"] <= value["outputTokens"], "capture.subset")
    if consumption:
        # Core fill_to_context_window can emit totalTokens with zero input and
        # output. Reject synthetic context budgets rather than count them.
        _need(value["totalTokens"] == value["inputTokens"] + value["outputTokens"], "capture.non-consumption-counter")
    return {metric: value[source] for metric, source in MAPPING.items()}


def _frames(root, config, selected, source, clock):
    feed = _read(_file(root, source or config["feed_path"]), usage.MAX_INPUT_BYTES)
    keys = {"schema_version", "session_id", "source_version", "events"}
    fields(feed, keys, keys)
    _need(feed["schema_version"] == "codex-token-feed-v1" and feed["session_id"] == config["session_id"]
          and feed["source_version"] == config["source_version"], "capture.feed-binding")
    _need(isinstance(feed["events"], list) and len(feed["events"]) <= usage.MAX_EVENTS)
    result = []
    for row in feed["events"]:
        fields(row, {"observed_at", "notification"}, {"observed_at", "notification"})
        stamp = usage._time(row["observed_at"])
        _need(2000 <= stamp.year <= 2200 and stamp <= clock, "capture.time")
        notification = row["notification"]
        fields(notification, {"method", "params", "jsonrpc"}, {"method", "params"})
        _need(notification["method"] == "thread/tokenUsage/updated" and notification.get("jsonrpc", "2.0") == "2.0", "capture.notification")
        params = notification["params"]
        fields(params, {"threadId", "turnId", "tokenUsage"}, {"threadId", "turnId", "tokenUsage"})
        usage._label(params["threadId"]); usage._label(params["turnId"])
        _need(params["threadId"] in selected, "capture.unselected-thread")
        counters = params["tokenUsage"]
        fields(counters, {"total", "last", "modelContextWindow"}, {"total", "last", "modelContextWindow"})
        if counters["modelContextWindow"] is not None: usage._integer(counters["modelContextWindow"])
        _counter(counters["last"], consumption=False)  # validate, never sum this context snapshot
        result.append((selected[params["threadId"]], row["observed_at"], _counter(counters["total"], consumption=True)))
    return result


def _event(config, binding, stamp, counts):
    return {"producer": "codex-appserver-v2", "run_id": config["session_id"], "agent_id": binding["thread_id"],
            "parent_agent_id": binding["parent_thread_id"], "counter_epoch": usage.digest([PROTOCOL, config["source_version"], binding["counter_epoch"]]), "sequence": 0,
            "counter_mode": "cumulative", "from_zero": False, "started_at": stamp, "ended_at": stamp,
            "scope": binding["scope"], "purpose": binding["purpose"], "purpose_basis": binding["purpose_basis"],
            "provenance": "host-reported", "model": None, "outcome": "unavailable",
            "counts": {key: {"value": value, "status": "measured"} for key, value in counts.items()}}


def _cursor(config, binding, clock):
    raw = _event(config, binding, clock, dict.fromkeys(usage.METRICS, 0))
    return usage._event(raw, usage._time(clock))


def capture(root: Path, *, session, config_path=CONFIG, source=None, at=None):
    """One atomic numeric batch. A host callback may invoke this at event boundaries."""
    root = root.resolve(); stamp = at or now(); clock = usage._time(stamp)
    config, selected = _config(root, config_path, session)
    frames = _frames(root, config, selected, source, clock)
    state = usage._load(root)
    cursors = copy.deepcopy(state["streams"]) if state else {}
    active = copy.deepcopy(state["active_epochs"]) if state else {}
    normalized, duplicates, baselines = [], 0, 0
    for binding, observed, counts in frames:
        event = _event(config, binding, observed, counts)
        identity = usage._event(event, clock)
        row = cursors.get(identity["stream"])
        if row:
            _need(active.get(usage._family(identity["agent"], binding["scope"])) == identity["stream"], "capture.retired-epoch")
            _need(row["mode"] == "cumulative" and row["scope"] == binding["scope"] and
                  row.get("parent") == identity["parent"] and
                  all(row["baselines"].get(metric, {}).get("status") == "measured" and
                      row["baselines"][metric]["provenance"] == "host-reported" for metric in usage.METRICS), "capture.stream-collision")
            previous = {metric: row["baselines"][metric]["value"] for metric in usage.METRICS}
            if counts == previous:
                duplicates += 1
                continue
            _need(all(counts[key] >= previous[key] for key in usage.METRICS), "capture.counter-decrease")
            event.update(sequence=row["sequence"] + 1, started_at=row["ended_at"])
        else:
            baselines += 1
            active[usage._family(identity["agent"], binding["scope"])] = identity["stream"]
        # Core import independently validates time, ancestry, active epochs,
        # source provenance, subset deltas, overflow and the complete batch.
        normalized.append(event)
        cursors[identity["stream"]] = {"sequence": event["sequence"], "ended_at": observed, "mode": "cumulative", "scope": binding["scope"], "parent": identity["parent"],
                                      "baselines": {metric: {**count, "provenance": "host-reported"} for metric, count in event["counts"].items()}}
    if normalized:
        if state is None: usage.enable(root)
        result = usage.import_observations(root, {"schema_version": usage.IMPORT_SCHEMA, "events": normalized}, at=stamp)
        accepted = result["accepted"]
    else:
        accepted = 0
    return {"schema_version": "token-capture-receipt-v1", "adapter": PROTOCOL, "source_events_validated": len(frames),
            "observations_accepted": accepted, "duplicate_counter_snapshots": duplicates, "initial_baselines": baselines,
            "status": _status(root, config, selected, clock), "billing_assurance": "not-attested"}


def _status(root, config, selected, clock):
    state = usage._load(root)
    fresh = stale = baseline = missing = 0
    latest = None
    for binding in selected.values():
        identity = _cursor(config, binding, clock.strftime("%Y-%m-%dT%H:%M:%SZ"))
        row = state["streams"].get(identity["stream"]) if state else None
        if not row:
            missing += 1; continue
        _need(state["active_epochs"].get(usage._family(identity["agent"], binding["scope"])) == identity["stream"], "capture.retired-epoch")
        _need(row["mode"] == "cumulative" and row["scope"] == binding["scope"] and row["parent"] == identity["parent"] and
              all(row["baselines"].get(metric, {}).get("status") == "measured" and row["baselines"][metric]["provenance"] == "host-reported"
                  for metric in usage.METRICS), "capture.stream-collision")
        known = sum(stats["known_measured"][index] for stats in row["totals"].values() for index in (0, 1))
        if not known:
            baseline += 1; continue
        latest = max(latest or row["ended_at"], row["ended_at"])
        if clock - timedelta(seconds=RECENT_SECONDS) <= usage._time(row["ended_at"]) <= clock: fresh += 1
        else: stale += 1
    status = "recent-actual-events" if fresh else "stale-actual-events" if stale else "baseline-only" if baseline else "adapter-ready"
    return {"schema_version": "token-capture-status-v1", "adapter_ready": True, "live_capture": fresh > 0,
            "source_assurance": "configured-export-not-authenticated",
            "state": status, "work_may_continue": True, "threads_selected": len(selected), "recent_actual_threads": fresh,
            "stale_actual_threads": stale, "baseline_only_threads": baseline, "missing_selected_threads": missing,
            "last_actual_event_at": latest, "unreported_agents": "unknown", "scopes": sorted({row["scope"] for row in selected.values()})}


def session_start(root: Path, *, session=None, config_path=CONFIG, at=None):
    """Nonblocking session initialization/validation; never claims a missing host bridge."""
    try:
        session = session or os.environ.get("CODEX_THREAD_ID")
        _need(bool(session), "capture.session-reference-unavailable")
        path = _file(root.resolve(), config_path)
        _need(path.exists(), "capture.host-bridge-not-configured")
        return capture(root, session=session, config_path=config_path, at=at)["status"]
    except (ControlError, OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError) as error:
        return {"schema_version": "token-capture-status-v1", "adapter_ready": True, "live_capture": False,
                "state": "unavailable", "reason_code": error.code if isinstance(error, ControlError) else "capture.source-unavailable",
                "work_may_continue": True, "required_source": "Selected-session numeric host export/callback; no conversation or credential access."}
