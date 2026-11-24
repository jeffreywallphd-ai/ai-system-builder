"""Opted-in exact-session numeric response capture; no transcript output or daemon.

Only canonical session headers and bounded tails of explicitly selected files
are examined locally. Message/tool rows are never decoded. The existing usage
file remains the only counter/sequence authority; no raw-event archive exists.
"""
from __future__ import annotations

import json
import copy
import os
import re
import stat
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import usage, usage_capture
from .common import fields, now
from .contracts import ControlError
from .storage import atomic_write, exclusive_lock

CONFIG = ".local-codex/token-capture/local.json"
PROTOCOL = "codex-local-response-usage-v1"
MAX_THREADS = 16
MAX_HEADER = 256 * 1024
MAX_TAIL = 1024 * 1024
MAX_LINE = 64 * 1024
MAX_DIRECTORY = 4096
MAX_SECONDS = 2.0
COUNTERS = {*usage.METRICS, "total_tokens"}
RECORD = {"thread_id", "turn_id", "session_id", "root_turn_id", "response_id", "usage", "turn_token_usage", "thread_token_usage"}
# Canonical Serde outer tag only. A quoted/nested token-looking string in a
# message/tool row cannot select that row or enter the JSON decoder.
RECORD_PREFIX = re.compile(rb'^\s*\{\s*"timestamp"\s*:\s*"[^"\r\n]+"\s*,\s*(?:"ordinal"\s*:\s*(?:[0-9]+|null)\s*,\s*)?"type"\s*:\s*"token_usage_record"\s*,\s*"payload"\s*:\s*\{')


def _need(condition, code="local-capture.invalid"):
    usage._need(condition, code, "Selected numeric capture is unavailable; original counters were preserved.")


def _uuid(value):
    _need(isinstance(value, str) and len(value) == 36)
    try: parsed = uuid.UUID(value)
    except ValueError: raise ControlError("local-capture.thread-id", "Select a known canonical thread reference.", {}, [])
    _need(str(parsed) == value and parsed.version == 7, "local-capture.thread-id")
    return parsed


def _regular(path, *, directory=False):
    # Check the lexical path before resolving; inside-root links are refused too.
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        _need(not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400, "local-capture.reparse")
    info = path.lstat()
    _need(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "local-capture.file-type")


def _repository(root):
    root = Path(root)
    _need(root.is_absolute() and len(str(root)) <= 400 and not str(root).startswith(("\\\\", "//")), "local-capture.repository")
    _regular(root, directory=True)
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_NO_REPLACE_OBJECTS="1")
    result = subprocess.run(["git", "-c", "core.hooksPath=" + ("NUL" if os.name == "nt" else "/dev/null"),
                             "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"],
                            cwd=root, env=environment, capture_output=True, timeout=1)
    _need(result.returncode == 0 and len(result.stdout) < 2048, "local-capture.repository")
    values = result.stdout.decode("utf-8").splitlines()
    _need(len(values) == 2 and all(len(value) <= 400 and Path(value).is_absolute() and not value.startswith(("\\\\", "//")) for value in values), "local-capture.repository")
    _need(Path(values[1]).resolve() == root.resolve(), "local-capture.repository")
    _regular(Path(values[0]), directory=True)
    common = Path(values[0]).resolve()
    return usage.digest(str(common).casefold() if os.name == "nt" else str(common)), common.parent


def _source_path(identity):
    parsed = _uuid(identity)
    created = datetime.fromtimestamp((parsed.int >> 80) / 1000, timezone.utc)
    home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    _need(home.is_absolute() and not str(home).startswith("\\\\"), "local-capture.home")
    _regular(home, directory=True)
    sessions = home / "sessions"
    _regular(sessions, directory=True)
    # The official recorder uses local creation dates. Check at most the three
    # possible adjacent UTC dates, never recurse or open unrelated session files.
    candidates = []
    for day in sorted({(created + timedelta(days=offset)).strftime("%Y/%m/%d") for offset in (-1, 0, 1)}):
        folder = sessions / day
        try: _regular(folder, directory=True)
        except FileNotFoundError: continue
        with os.scandir(folder) as entries:
            for index, entry in enumerate(entries):
                _need(index < MAX_DIRECTORY, "local-capture.directory-cap")
                if re.fullmatch(r"rollout-[0-9T\-]+-" + re.escape(identity) + r"(?:_[0-9a-f\-]{36})?\.jsonl(?:\.zst)?", entry.name):
                    candidates.append(Path(entry.path))
    _need(len(candidates) == 1 and candidates[0].suffix == ".jsonl", "local-capture.source-selection")
    _regular(candidates[0])
    return candidates[0]


def _decode(raw):
    def unique(pairs):
        value = {}
        for key, child in pairs:
            _need(key not in value, "local-capture.duplicate-key")
            value[key] = child
        return value
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))


def _counts(value):
    fields(value, COUNTERS | {"cache_write_input_tokens"}, COUNTERS)
    for number in value.values(): usage._integer(number)
    _need(value["total_tokens"] == value["input_tokens"] + value["output_tokens"], "local-capture.non-consumption")
    _need(value["cached_input_tokens"] + value.get("cache_write_input_tokens", 0) <= value["input_tokens"] and
          value["reasoning_output_tokens"] <= value["output_tokens"], "local-capture.subset")
    return {key: value[key] for key in usage.METRICS}


def _stamp(value):
    _need(isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z", value), "local-capture.time")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    _need(2000 <= parsed.year <= 2200, "local-capture.time")
    return parsed.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_source(root, identity, workspace, primary, clock, *, minimum_offset=0, establish=False, cut_position=None):
    path = _source_path(identity)
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        header = stream.readline(MAX_HEADER + 1)
        _need(len(header) <= MAX_HEADER and header.endswith(b"\n"), "local-capture.header-cap")
        meta_row = _decode(header)
        _need(isinstance(meta_row, dict) and meta_row.get("type") == "session_meta", "local-capture.header")
        meta = meta_row.get("payload", {})
        _need(isinstance(meta, dict) and meta.get("id") == identity, "local-capture.identity")
        raw_cwd = meta.get("cwd")
        _need(isinstance(raw_cwd, str) and 1 <= len(raw_cwd) <= 400, "local-capture.workspace")
        cwd = Path(raw_cwd)
        _need(cwd.is_absolute() and not str(cwd).startswith(("\\\\", "//")), "local-capture.workspace")
        _regular(cwd, directory=True)
        _need(cwd.resolve().is_relative_to(primary.resolve()), "local-capture.workspace")
        _need(_repository(cwd)[0] == workspace, "local-capture.workspace")
        parent = meta.get("parent_thread_id")
        if parent is not None: _uuid(parent)
        _need(parent != identity, "local-capture.parent")
        header_digest = usage.digest(header.hex())
        source_id = usage.digest([before.st_dev, before.st_ino, header_digest, identity])
        del meta, meta_row, header
        _need(type(minimum_offset) is int and 0 <= minimum_offset <= before.st_size, "local-capture.source-truncated")
        tail_start = max(0, before.st_size - MAX_TAIL)
        start = max(tail_start, minimum_offset)
        stream.seek(start)
        payload = stream.read(before.st_size - start)
        if start and start != minimum_offset:
            prefix, separator, payload = payload.partition(b"\n")
            start += len(prefix) + len(separator)
        # Never decode the partial row being concurrently appended.
        complete = payload.rpartition(b"\n")[0]
        incomplete = not payload.endswith(b"\n")
        latest = boundary = None; selected = 0; foreign = 0; oversized = 0
        offset = start
        for raw_line in complete.splitlines(keepends=True):
            record_offset = offset; offset += len(raw_line)
            raw = raw_line.rstrip(b"\r\n")
            if len(raw) > MAX_LINE:
                oversized += 1; continue
            if not RECORD_PREFIX.match(raw): continue
            row = _decode(raw)
            fields(row, {"timestamp", "ordinal", "type", "payload"}, {"timestamp", "type", "payload"})
            record = row["payload"]
            fields(record, RECORD, RECORD)
            _uuid(record["thread_id"])
            if record["thread_id"] != identity:
                foreign += 1; continue  # inherited fork history never becomes own use
            _uuid(record["session_id"])
            for label in ("turn_id", "root_turn_id", "response_id"):
                _need(isinstance(record[label], str) and 1 <= len(record[label]) <= 200 and
                      re.fullmatch(r"[A-Za-z0-9._:-]+", record[label]), "local-capture.record-id")
            _counts(record["usage"]); _counts(record["turn_token_usage"])
            counts = _counts(record["thread_token_usage"])
            ended = _stamp(row["timestamp"])
            _need(usage._time(ended) <= clock, "local-capture.future")
            if latest and not establish:
                _need(ended >= latest["at"] and all(counts[key] >= latest["counts"][key] for key in usage.METRICS), "local-capture.nonmonotonic")
            latest = {"at": ended, "counts": counts, "offset": record_offset}; selected += 1
            if cut_position is not None and boundary is None and record_offset >= cut_position: boundary = dict(latest)
        stream.seek(0)
        _need(usage.digest(stream.readline(MAX_HEADER + 1).hex()) == header_digest, "local-capture.header-changed")
        after = os.fstat(stream.fileno())
        current = path.stat()
        _need((before.st_dev, before.st_ino) == (after.st_dev, after.st_ino) == (current.st_dev, current.st_ino) and
              after.st_size >= before.st_size and current.st_size >= before.st_size, "local-capture.source-changed")
    return {"identity": identity, "parent": parent, "source_id": source_id, "latest": latest, "boundary": boundary, "snapshot_end": before.st_size,
            "records_selected": selected, "inherited_records_ignored": foreign, "oversized_rows_skipped": oversized,
            "partial_append": incomplete, "tail_only": start > 0}


def _config(root):
    path = usage_capture._file(root, CONFIG)
    _regular(path)
    value = usage_capture._read(path, usage_capture.MAX_CONFIG_BYTES)
    keys = {"schema_version", "workspace_id", "destination", "threads"}
    fields(value, keys, keys)
    _need(value["schema_version"] == "local-token-capture-v1" and isinstance(value["workspace_id"], str) and re.fullmatch("[0-9a-f]{64}", value["workspace_id"]))
    _need(value["destination"] is None or isinstance(value["destination"], str) and 1 <= len(value["destination"]) <= 400)
    _need(isinstance(value["threads"], list) and 1 <= len(value["threads"]) <= MAX_THREADS, "local-capture.selection-cap")
    seen = set()
    for binding in value["threads"]:
        fields(binding, {"thread_id", "parent_id", "source_id", "counter_epoch", "minimum_offset", "purpose", "purpose_basis"},
               {"thread_id", "parent_id", "source_id", "counter_epoch", "minimum_offset", "purpose", "purpose_basis"})
        _uuid(binding["thread_id"])
        if binding["parent_id"] is not None: _uuid(binding["parent_id"])
        _need(binding["thread_id"] not in seen and isinstance(binding["source_id"], str) and re.fullmatch("[0-9a-f]{64}", binding["source_id"]))
        seen.add(binding["thread_id"]); usage._label(binding["counter_epoch"])
        usage._integer(binding["minimum_offset"])
        _need(binding["purpose"] in usage.PURPOSES and binding["purpose_basis"] in {"declared", "inferred", "unavailable"})
    return value


def _unavailable(code):
    return {"schema_version": "token-capture-status-v1", "adapter_ready": True, "live_capture": False,
            "state": "unavailable", "reason_code": code, "work_may_continue": True,
            "source_assurance": "local-host-response-usage-not-billing", "unreported_agents": "unknown"}


def _event(workspace, binding, source):
    latest = source["latest"]
    return {"producer": PROTOCOL, "run_id": workspace, "agent_id": binding["thread_id"], "parent_agent_id": binding["parent_id"],
            "counter_epoch": usage.digest([binding["source_id"], binding["counter_epoch"]]), "counter_mode": "cumulative",
            "sequence": 0, "from_zero": False, "started_at": latest["at"], "ended_at": latest["at"], "scope": "own",
            "purpose": binding["purpose"], "purpose_basis": binding["purpose_basis"], "provenance": "host-reported",
            "model": None, "outcome": "unavailable", "counts": {key: {"value": value, "status": "measured"} for key, value in latest["counts"].items()}}


def poll(root: Path, *, at=None, attribution_unknown=False):
    """Read at most16 selected bounded tails once; errors never gate contributor work."""
    try:
        root = root.resolve(); config = _config(root)
        deadline = time.monotonic() + MAX_SECONDS
        workspace, primary = _repository(root)
        _need(workspace == config["workspace_id"], "local-capture.workspace")
        destination = Path(config["destination"]) if config["destination"] else root
        _need(_repository(destination)[0] == workspace, "local-capture.destination")
        clock = usage._time(at or now()); sources = []
        state = usage._load(destination)
        for binding in config["threads"]:
            _need(time.monotonic() < deadline, "local-capture.time-cap")
            agent = usage.digest([PROTOCOL, workspace, binding["thread_id"]])
            context = state["phase_contexts"].get(agent) if state else None
            cut = context["fence"] if context and not context["settled"] and context["source_ref"] == binding["source_id"] else None
            source = _read_source(root, binding["thread_id"], workspace, primary, clock, minimum_offset=binding["minimum_offset"], cut_position=cut)
            _need(source["source_id"] == binding["source_id"] and source["parent"] == binding["parent_id"], "local-capture.source-replaced")
            sources.append((binding, source, context))
        _need(time.monotonic() < deadline, "local-capture.time-cap")
        cursors = copy.deepcopy(state["streams"]) if state else {}
        active = dict(state["active_epochs"]) if state else {}
        events = []; duplicates = missing = 0; identities = []
        for binding, source, context in sources:
            if source["latest"] is None: missing += 1; continue
            points = [source["latest"]]
            if source["boundary"] and source["boundary"]["offset"] != source["latest"]["offset"]:
                points.insert(0, source["boundary"])
            for point in points:
                event = _event(workspace, binding, {"latest": point})
                if context and context["active"] and context["activity"] is not None:
                    event["purpose"] = context["activity"]; event["purpose_basis"] = "declared"
                identity = usage._event(event, clock)
                row = cursors.get(identity["stream"])
                if row:
                    _need(active.get(usage._family(identity["agent"], "own")) == identity["stream"], "local-capture.retired-epoch")
                    _need(row["mode"] == "cumulative" and row["scope"] == "own" and row["parent"] == identity["parent"], "local-capture.stream-collision")
                    previous = {metric: row["baselines"][metric]["value"] for metric in usage.METRICS}
                    _need(all(row["baselines"][key]["status"] == "measured" and row["baselines"][key]["provenance"] == "host-reported" for key in usage.METRICS))
                    if point["offset"] != source["latest"]["offset"] and all(point["counts"][key] <= previous[key] for key in usage.METRICS):
                        continue  # a bounded cutpoint already consumed on an earlier poll
                    if point["counts"] == previous: duplicates += 1; continue
                    _need(all(point["counts"][key] >= previous[key] for key in usage.METRICS), "local-capture.counter-decrease")
                    event.update(sequence=row["sequence"] + 1, started_at=row["ended_at"])
                active[usage._family(identity["agent"], "own")] = identity["stream"]
                cursors[identity["stream"]] = {"mode": "cumulative", "scope": "own", "parent": identity["parent"],
                    "sequence": event["sequence"], "ended_at": point["at"],
                    "baselines": {key: {**value, "provenance": "host-reported"} for key, value in event["counts"].items()}}
                event["attribution"] = {"work_ref": context["work_ref"] if context else None,
                    "context_ref": context["ref"] if context and not attribution_unknown else None, "source_ref": source["source_id"], "position": point["offset"]}
                events.append(event)
            identities.append(identity)
        accepted = stale_sequences = 0
        if events:
            if state is None: usage.enable(destination)
            imported = usage.import_observations(destination, {"schema_version": usage.IMPORT_V2, "events": events}, at=at)
            accepted = imported["accepted"]
            duplicates += imported["duplicates"]
            stale_sequences = imported["older_sequences_not_recounted"]
        state = usage._load(destination)
        fresh = stale = baseline = 0; latest_actual = None
        for identity in identities:
            row = state["streams"].get(identity["stream"]) if state else None
            if not row: missing += 1; continue
            known = sum(stats["known_measured"][index] for stats in row["totals"].values() for index in (0, 1))
            if not known: baseline += 1; continue
            latest_actual = max(latest_actual or row["ended_at"], row["ended_at"])
            if clock - timedelta(seconds=usage_capture.RECENT_SECONDS) <= usage._time(row["ended_at"]) <= clock: fresh += 1
            else: stale += 1
        status = "recent-actual-events" if fresh else "stale-actual-events" if stale else "baseline-only" if baseline else "adapter-ready"
        return {"schema_version": "token-capture-status-v1", "adapter_ready": True, "live_capture": fresh > 0, "state": status,
                "work_may_continue": True, "source_assurance": "local-host-response-usage-not-billing", "threads_selected": len(sources),
                "recent_actual_threads": fresh, "stale_actual_threads": stale, "baseline_only_threads": baseline,
                "missing_selected_threads": missing, "last_actual_event_at": latest_actual, "unreported_agents": "unknown",
                "observations_accepted": accepted, "duplicate_counter_snapshots": duplicates,
                "stale_sequences_not_recounted": stale_sequences, "scopes": ["own"],
                "bounded_tail_only": any(source["tail_only"] for _, source, _ in sources),
                "oversized_rows_skipped": sum(source["oversized_rows_skipped"] for _, source, _ in sources),
                "partial_append_threads": sum(source["partial_append"] for _, source, _ in sources)}
    except (ControlError, OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError, subprocess.SubprocessError) as error:
        return _unavailable(error.code if isinstance(error, ControlError) else "local-capture.source-unavailable")


def _enable_locked(root: Path, *, thread_ids, destination=None, counter_epoch=None, at=None):
    """Explicit selected numeric retention; pin sources, preserve existing selections."""
    root = root.resolve(); workspace, primary = _repository(root)
    if counter_epoch is not None: usage._label(counter_epoch)
    _need(isinstance(thread_ids, list) and 1 <= len(thread_ids) <= MAX_THREADS and len(set(thread_ids)) == len(thread_ids), "local-capture.selection-cap")
    clock = usage._time(at or now())
    path = usage_capture._file(root, CONFIG)
    config = _config(root) if path.exists() else {"schema_version": "local-token-capture-v1", "workspace_id": workspace, "destination": None, "threads": []}
    _need(config["workspace_id"] == workspace, "local-capture.workspace")
    if destination is not None:
        _need(_repository(Path(destination))[0] == workspace, "local-capture.destination")
        config["destination"] = str(Path(destination).resolve())
    selected = {row["thread_id"]: row for row in config["threads"]}
    for identity in thread_ids:
        previous = selected.get(identity)
        epoch = counter_epoch if counter_epoch is not None else previous["counter_epoch"] if previous else "initial"
        establishing = previous is None or previous["counter_epoch"] != epoch
        source = _read_source(root, identity, workspace, primary, clock,
                              minimum_offset=previous["minimum_offset"] if previous and not establishing else 0, establish=establishing)
        if previous:
            _need(source["parent"] == previous["parent_id"], "local-capture.parent")
            _need(source["source_id"] == previous["source_id"] or previous["counter_epoch"] != epoch, "local-capture.source-replaced")
        selected[identity] = {"thread_id": identity, "parent_id": source["parent"], "source_id": source["source_id"], "counter_epoch": epoch,
                              "minimum_offset": source["latest"]["offset"] if establishing and source["latest"] else previous["minimum_offset"] if previous else 0,
                              "purpose": previous["purpose"] if previous else "mixed", "purpose_basis": previous["purpose_basis"] if previous else "unavailable"}
    _need(len(selected) <= MAX_THREADS, "local-capture.selection-cap")
    config["threads"] = list(selected.values())
    payload = usage._encoded(config)
    _need(len(payload) <= usage_capture.MAX_CONFIG_BYTES, "local-capture.config-cap")
    atomic_write(path, payload)
    return poll(root, at=at)


def enable(root: Path, *, thread_ids, destination=None, counter_epoch=None, at=None):
    root = root.resolve()
    path = usage_capture._file(root, CONFIG)
    # Serialize startup selection additions; never overwrite another agent's
    # concurrently authorized selection. The one-byte lock creates no log.
    lock = path.parent / "local.lock"
    def check_lock():
        try:
            _regular(lock)
            _need(lock.stat().st_size <= 1, "local-capture.lock-cap")
        except FileNotFoundError:
            pass
    check_lock()
    with exclusive_lock(lock, timeout_seconds=0.2):
        _regular(lock)
        _need(lock.stat().st_size == 1, "local-capture.lock-cap")
        return _enable_locked(root, thread_ids=thread_ids, destination=destination, counter_epoch=counter_epoch, at=at)


def session_start(root: Path, *, session=None, at=None):
    try:
        identity = session or os.environ.get("CODEX_THREAD_ID")
        _need(identity is not None, "capture.session-reference-unavailable")
        return enable(root, thread_ids=[identity], at=at)
    except (ControlError, OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError, subprocess.SubprocessError) as error:
        return _unavailable(error.code if isinstance(error, ControlError) else "local-capture.source-unavailable")


def configured_boundary(root: Path, *, attribution_unknown=False):
    """No configuration means no source lookup, source read or store creation."""
    try:
        if not usage_capture._file(root.resolve(), CONFIG).exists(): return None
        return poll(root, attribution_unknown=attribution_unknown)
    except (ControlError, OSError, ValueError, TypeError):
        return _unavailable("local-capture.configuration-unavailable")
