"""Optional, single-pass contributor data support. No commands, approvals or retries.

Canonical Work/Records and the roadmap engine remain the only workflow authority.
Packets are cooperative local witnesses, never qualification or independent review.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import json
import os
import re
import stat
from pathlib import Path

from .candidate import git
from .common import digest, fields, identifier, inside, now, refuse, relative
from .storage import canonical_bytes, confined_path
from .work import Work, get_work, validate_receipt

REQUEST = "contributor-support-request-v1"
PACKET = "contributor-support-packet-v1"
DIRECTORY = ".local-codex/control-plane/support"
MAX_PACKET = 8 * 1024 * 1024
MAX_FILE = 32 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_PATHS = 200
OPERATIONS = {"prepare", "freeze", "export", "transition-before", "transition-after", "checkpoint", "progress", "handoff"}
LIMITS = {"qualification": "not-asserted", "independent_review_created": False,
          "authority_granted": False, "parent_qualified": False, "work_executed": False}


def need_input(*names):
    return {"status": "needs-input", "needed": list(names), "advisories": [
        "Supply the named data and invoke once again when ready; ordinary Work remains available."], **LIMITS}


def _need(condition, code="support.integrity", message="Support facts are missing, changed or inconsistent."):
    if not condition:
        refuse(code, message)


def _hash(value):
    _need(isinstance(value, str) and re.fullmatch("[a-f0-9]{64}", value), "support.digest", "Use an exact SHA-256 digest.")
    return value


def _path(root, name):
    name = relative(name)
    _need(not any(part.startswith("-") or part.lower() in {".git", ".aws", ".agents", ".codex", "credentials", "secrets"}
                  for part in name.split("/")), "support.path", "Use an exact permitted contributor path.")
    path = confined_path(root, name)
    current = root
    for part in name.split("/"):
        current = current / part
        try:
            facts = current.lstat()
        except FileNotFoundError:
            continue
        _need(not stat.S_ISLNK(facts.st_mode) and not getattr(facts, "st_file_attributes", 0) & 0x400,
              "support.link", "Linked or redirected support paths are unavailable.")
    return path


class Files:
    """Bounded explicit selections, with reuse only during this invocation."""
    def __init__(self, root):
        self.root = root
        self.total = 0
        self.cache = {}

    def read(self, name, *, absent=False, maximum=MAX_FILE):
        path = _path(self.root, name)
        if name in self.cache:
            value, raw, stamp = self.cache[name]
            current = path.lstat()
            _need((current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) == stamp,
                  "support.file-drift", "A selected file changed during this invocation.")
            _need(value["bytes"] <= maximum, "support.capacity", "A selected file exceeds this operation's bound.")
            return value, raw
        try:
            before = path.lstat()
        except FileNotFoundError:
            _need(absent, "support.missing", "An explicitly selected file is unavailable.")
            return {"exists": False}, None
        _need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "support.file-type", "A stable single-link regular file is required.")
        self.total += before.st_size
        _need(before.st_size <= maximum and self.total <= MAX_TOTAL, "support.capacity", "The explicit selection exceeds its byte bound.")
        with path.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            raw = stream.read(maximum + 1)
            closed = os.fstat(stream.fileno())
        after = path.lstat()
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
        _need(len(raw) == before.st_size and identity(before) == identity(opened) == identity(closed) == identity(after),
              "support.file-drift", "A selected file changed during its bounded read.")
        value = {"exists": True, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        self.cache[name] = value, raw, identity(after)
        return value, raw


def _json(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            _need(key not in value, "support.json", "Duplicate JSON fields are unavailable.")
            value[key] = item
        return value
    try:
        result = json.loads(raw, object_pairs_hook=unique,
                            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, RecursionError):
        refuse("support.json", "Support JSON is malformed or exceeds the supported nesting.")
    _need(isinstance(result, dict), "support.json", "Support JSON must be an object.")
    return result


def _refs(reader, values):
    _need(isinstance(values, list) and len(values) <= 64, "support.references", "Select at most 64 exact references.")
    result = {}
    for row in values:
        fields(row, {"path", "sha256"}, {"path", "sha256"})
        path = relative(row["path"])
        _need(path not in result, "support.references", "Reference paths must be unique.")
        value, _ = reader.read(path)
        _need(value["sha256"] == _hash(row["sha256"]), "support.reference-drift", "An explicit reference no longer matches its digest.")
        result[path] = value
    return result


def _packet_path(packet_id):
    return DIRECTORY + "/" + identifier(packet_id) + ".json"


def _load_packet(reader, reference, *, operation=None):
    fields(reference, {"packet_id", "packet_digest"}, {"packet_id", "packet_digest"})
    _, raw = reader.read(_packet_path(reference["packet_id"]), maximum=MAX_PACKET)
    packet = _json(raw)
    _need(packet.get("schema_version") == PACKET and packet.get("packet_id") == reference["packet_id"])
    claimed = _hash(reference["packet_digest"])
    _need(packet.get("packet_digest") == claimed == digest({k: v for k, v in packet.items() if k != "packet_digest"}))
    _need(operation is None or packet.get("operation") == operation)
    return packet


def _publish(root, packet_id, operation, work_id, data):
    packet = {"schema_version": PACKET, "packet_id": identifier(packet_id), "operation": operation,
              "work_id": work_id, "created_at": now(), "data": data, **LIMITS}
    packet["packet_digest"] = digest(packet)
    raw = canonical_bytes(packet)
    _need(len(raw) <= MAX_PACKET, "support.capacity", "The complete support packet exceeds its bound; narrow the explicit selection.")
    name = _packet_path(packet_id)
    path = _path(root, name)
    _need(not path.exists(), "support.exists", "Packet identities are immutable; choose a new identifier.")
    path.parent.mkdir(parents=True, exist_ok=True)
    _path(root, name)
    # Exclusive publication; a partial failed write is retained and never adopted.
    with path.open("xb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    return {"status": "prepared", "packet_id": packet_id, "packet_digest": packet["packet_digest"],
            "path": name, "operation": operation, "advisories": data.get("advisories", []), **LIMITS}


def _others(records, work_id):
    return {"other_work_items_digest": digest({k: v for k, v in records["work_items"].items() if k != work_id}),
            "feedback_digest": digest(records["feedback"]), "trials_digest": digest(records["trials"]),
            "top": {k: v for k, v in records.items() if k not in {"work_items", "feedback", "trials", "revision", "updated_at", "state_digest"}}}


def _qualified(work, candidate, plan):
    _need(bool(work["receipts"]), "support.receipt-missing", "A current executed receipt is required for this operation.")
    receipt = work["receipts"][-1]
    validate_receipt(receipt)
    _need(receipt["source_digest"] == candidate["source_digest"] and receipt["spec_digest"] == work["spec_digest"]
          and receipt["plan"]["plan_digest"] == plan["plan_digest"] and receipt["source_stable"],
          "support.receipt-stale", "The qualifying receipt is stale; use the ordinary verification workflow.")
    return receipt


def _review(work, receipt, *, accepted=False):
    _need(bool(work["reviews"]), "support.review-missing", "A real recorded separate-invocation review is required.")
    row = work["reviews"][-1]
    _need(row.get("review_digest") == digest({k: v for k, v in row.items() if k != "review_digest"})
          and row["receipt_digest"] == receipt["receipt_digest"] and row["source_digest"] == receipt["source_digest"]
          and row["invocation_id"] not in work["contributors"]
          and set(row["reviewed_criteria"]) == {a["id"] for a in work["spec"]["acceptance"]})
    _need(not accepted or row["disposition"] == "accepted", "support.review-required", "An accepted current review is required.")
    return row


def _paths(request, work, plan):
    names = request.get("paths")
    if names is None:
        names = plan["changed_paths"]
        if not names:
            names = work["spec"]["write_scope"]
    _need(isinstance(names, list) and all(isinstance(name, str) for name in names)
          and 0 < len(names) <= MAX_PATHS and len(set(names)) == len(names), "support.paths", "Select unique bounded exact source paths.")
    for name in names:
        relative(name)
        _need(inside(name, work["spec"]["write_scope"]), "support.scope", "Selected paths escape the current work scope.")
    return sorted(names)


def _candidate_file(root, candidate, name, facts):
    if name in candidate["files"]:
        _need(facts.get("sha256") == candidate["files"][name], "support.source-drift", "Owned source changed after the candidate snapshot.")
    else:
        from .candidate import managed_projection
        _need(managed_projection(root, name) or not facts["exists"], "support.source-drift", "Owned source differs from the candidate snapshot.")


def _evidence(operation, request, work, records, candidate, plan, reader):
    paths = _paths(request, work, plan)
    owned = {}
    preimages = {}
    for name in paths:
        facts, raw = reader.read(name, absent=True)
        _candidate_file(reader.root, candidate, name, facts)
        owned[name] = facts
        if request.get("include_preimages") and raw is not None:
            preimages[name] = base64.b64encode(raw).decode("ascii")
    data = {"head": candidate["head"], "source_digest": candidate["source_digest"], "spec_digest": work["spec_digest"],
            "authority_digest": work["authority_digest"], "owned": owned, "references": _refs(reader, request.get("references", [])),
            "records_revision": records["revision"], "preserved": _others(records, request["work_id"]), "advisories": []}
    if preimages:
        data["preimages_base64"] = preimages
    if operation == "prepare":
        data["own_work"] = copy.deepcopy(work)
    else:
        data["check_plan"] = plan
    if request.get("before"):
        before = _load_packet(reader, request["before"], operation="prepare")
        _need(before["work_id"] == request["work_id"] and before["data"]["spec_digest"] == work["spec_digest"]
              and before["data"]["authority_digest"] == work["authority_digest"] and before["data"]["preserved"] == data["preserved"])
        _need(before["data"]["head"] == candidate["head"], "support.head-drift", "HEAD changed after preparation; create a fresh preparation packet.")
        for name, expected in before["data"]["references"].items():
            _need(reader.read(name)[0] == expected)
        data["predecessor"] = request["before"]
    if operation == "export":
        receipt = _qualified(work, candidate, plan)
        data["receipt"] = receipt
        if work["reviews"] and work["reviews"][-1]["receipt_digest"] == receipt["receipt_digest"]:
            data["review"] = _review(work, receipt)
        else:
            data["advisories"].append("No current separate review is recorded; this export creates none.")
    return data


def _transition_before(request, work, records, candidate, reader):
    _need(request.get("transition") in {"review", "complete"}, "support.transition", "Select review or complete.")
    return {"transition": request["transition"], "head": candidate["head"], "source_digest": candidate["source_digest"],
            "own_work": copy.deepcopy(work), "revision": records["revision"], "preserved": _others(records, request["work_id"]),
            "references": _refs(reader, request.get("references", []))}


def _transition_after(request, work, records, candidate, plan, reader):
    before = _load_packet(reader, request["before"], operation="transition-before")
    data = before["data"]
    _need(before["work_id"] == request["work_id"] and records["revision"] == data["revision"] + 1
          and candidate["head"] == data["head"] and candidate["source_digest"] == data["source_digest"]
          and _others(records, request["work_id"]) == data["preserved"])
    for name, expected in data["references"].items():
        _need(reader.read(name)[0] == expected)
    receipt = _qualified(work, candidate, plan)
    expected = copy.deepcopy(data["own_work"])
    if data["transition"] == "review":
        _need(len(work["reviews"]) == len(expected["reviews"]) + 1)
        expected["reviews"].append(_review(work, receipt))
    else:
        review = _review(work, receipt, accepted=True)
        completion = fields(work.get("completion"), {"at", "source_digest", "receipt_digest", "review_digest"}, {"at", "source_digest", "receipt_digest", "review_digest"})
        _need({k: v for k, v in completion.items() if k != "at"} == {
            "source_digest": receipt["source_digest"], "receipt_digest": receipt["receipt_digest"], "review_digest": review["review_digest"]})
        _need(expected["status"] != "complete" and expected.get("completion") is None)
        expected.update(status="complete", claim=None, completion=completion)
    _need(work == expected, "support.foreign-transition", "The actual change exceeds the selected canonical transition.")
    return {"transition": data["transition"], "predecessor": request["before"], "proof": "exact-transition-observed",
            "head": candidate["head"], "source_digest": candidate["source_digest"], "receipt_digest": receipt["receipt_digest"],
            "revision_before": data["revision"], "revision_after": records["revision"], "references": data["references"]}


def _git_paths(root, *args):
    # The preflight explicitly compares CRLF-normalized text blobs. Keep that
    # same policy for diff discovery, independent of ignored system Git config.
    return sorted(os.fsdecode(p) for p in git(root, "-c", "core.autocrlf=true", *args, "-z").split(b"\0") if p)


def _checkpoint(request, work, records, candidate, plan, reader):
    receipt = _qualified(work, candidate, plan)
    review = _review(work, receipt, accepted=True)
    _need(work["status"] == "complete" and work.get("completion") == {
        "at": work.get("completion", {}).get("at"), "source_digest": receipt["source_digest"],
        "receipt_digest": receipt["receipt_digest"], "review_digest": review["review_digest"]})
    _need(not any(w.get("claim") for w in records["work_items"].values()), "support.live-claim", "Release live source claims through the ordinary workflow before checkpoint planning.")
    paths = _paths(request, work, plan)
    root = reader.root
    tracked = _git_paths(root, "diff", "HEAD", "--name-only")
    untracked = _git_paths(root, "ls-files", "--others", "--exclude-standard")
    _need(sorted(set(tracked) | set(untracked)) == paths and not set(tracked) & set(untracked),
          "support.checkpoint-scope", "The full tracked and untracked change set must equal the selected owned paths.")
    _need(not git(root, "ls-files", "--unmerged", "-z"), "support.index", "Resolve index conflicts before checkpoint planning.")
    staged = _git_paths(root, "diff", "--cached", "--name-only")
    _need(not set(staged) - set(paths), "support.index", "The index includes unrelated staged work; preserve and isolate it before proceeding.")
    attributes = git(root, "check-attr", "-z", "filter", "working-tree-encoding", "--", *paths).split(b"\0")
    _need(attributes[-1] == b"" and all(attributes[n + 2] == b"unspecified" for n in range(0, len(attributes) - 1, 3)),
          "support.attributes", "Custom filters or encoding require explicit owned-hunk review outside this helper.")
    owned = {}
    for name in paths:
        value, raw = reader.read(name, absent=True)
        _candidate_file(root, candidate, name, value)
        owned[name] = value
        if name in staged:
            if raw is None:
                _need(name not in _git_paths(root, "ls-files", "--cached"), "support.index", "The staged deletion differs from the current owned deletion.")
            else:
                _need(b"\0" not in raw and b"\r" not in raw.replace(b"\r\n", b""), "support.encoding", "Review binary or nonstandard text staging explicitly.")
                _need(git(root, "show", ":" + name) == raw.replace(b"\r\n", b"\n"), "support.index", "A staged blob differs from the current owned bytes.")
    return {"head": candidate["head"], "source_digest": candidate["source_digest"], "owned": owned,
            "receipt_digest": receipt["receipt_digest"], "review_digest": review["review_digest"],
            "staged_paths": staged, "untracked_paths": untracked, "references": _refs(reader, request.get("references", [])),
            "plan": "Review dependency closure and owned hunks, then use the existing authorized checkpoint workflow.",
            "git_mutations_executed": False, "advisories": ["This plan grants no commit, merge, push, main advancement or release authority."]}


def _engine(root):
    # Trusted fixed repository engine, including its current canonical state codec.
    name = "_aisb_deterministic_support_roadmap"
    path = _path(root, "skills/manage-implementation-roadmaps/scripts/roadmap.py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    import sys
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(name, None)
    return module


def _progress_inputs(events, target_id):
    needed, diagnostics = [], []
    for index, event in enumerate(events):
        _need(isinstance(event, dict), "support.event", "Tracking events must be explicit JSON objects.")
        kind = event.get("type")
        _need(kind in {"work-chunks-reconfigured", "chunk-recorded", "story-tasks-assigned"}, "support.event", "Only bounded task tracking events are supported.")
        required = ({"incrementId": str, "assignments": list, "authorityRef": str, "reason": str} if kind == "story-tasks-assigned" else
                    {"incrementId": str, "plan": dict, "authorityRef": str, "reason": str} if kind == "work-chunks-reconfigured" else {"chunkId": str, "summary": str, "areas": list})
        for name, expected in required.items():
            value = event.get(name)
            if not isinstance(value, expected) or not value or isinstance(value, str) and not value.strip():
                needed.append(f"events[{index}].{name}")
        # A supplied different target remains an ownership refusal, even when
        # descriptive fields are missing. No authority value is inferred here.
        if kind in {"work-chunks-reconfigured", "story-tasks-assigned"} and event.get("incrementId"):
            _need(event["incrementId"] == target_id)
        if kind == "work-chunks-reconfigured" and isinstance(event.get("plan"), dict):
            metadata = [name for name in ("recordedAt", "fingerprint", "outlineOnly") if name in event["plan"]]
            if metadata:
                location = f"events[{index}].plan"
                needed.append(location)
                diagnostics.append({"code": "stored-plan-metadata", "path": location, "fields": metadata,
                                    "message": "Remove stored-only recordedAt, fingerprint and outlineOnly from the proposed event plan explicitly; the helper does not rewrite inputs."})
    if needed:
        return {**need_input(*dict.fromkeys(needed)), "input_diagnostics": diagnostics}
    return None


def _progress(request, work, reader):
    binding = work["spec"].get("roadmap")
    if not binding or not request.get("events"):
        return need_input("roadmap-bound work and explicit tracking events")
    events = request["events"]
    _need(isinstance(events, list) and 0 < len(events) <= 8, "support.events", "Select one to eight explicit tracking events.")
    inputs = _progress_inputs(events, binding["increment_id"])
    if inputs is not None:
        return inputs
    engine = _engine(reader.root)
    _path(reader.root, binding["state_path"])
    try:
        _, original = engine.load_state(reader.root, binding["state_path"])
        target_id = binding["increment_id"]
        before = next(i for i in original["increments"] if i["id"] == target_id)
        actual = original
        prepared = []
        for submitted in events:
            _need(isinstance(submitted, dict), "support.event", "Tracking events must be explicit JSON objects.")
            event = copy.deepcopy(submitted)
            _need(event.get("type") in {"work-chunks-reconfigured", "chunk-recorded", "story-tasks-assigned"}, "support.event", "Only bounded task tracking events are supported.")
            target = next(i for i in actual["increments"] if i["id"] == target_id)
            if event["type"] in {"work-chunks-reconfigured", "story-tasks-assigned"}:
                _need(event.get("incrementId") == target_id)
                expected = engine.fingerprint(target.get("plan")) if target.get("plan") else None
                _need("expectedPlanDigest" not in event or event["expectedPlanDigest"] == expected,
                      "support.plan-drift", "Use the whole stored plan digest, not its internal fingerprint field.")
                event["expectedPlanDigest"] = expected
                tracking = engine.current_story_tracking(actual, target_id)
                if tracking or event["type"] == "story-tasks-assigned":
                    tracking_digest = engine.fingerprint(tracking) if tracking else None
                    _need("expectedTrackingDigest" not in event or event["expectedTrackingDigest"] == tracking_digest,
                          "support.story-drift", "Use the current complete story tracking revision digest.")
                    event["expectedTrackingDigest"] = tracking_digest
                    if tracking and event["type"] == "work-chunks-reconfigured" and not event.get("storyAssignments"):
                        return need_input("complete storyAssignments for every replacement task")
            else:
                _need(actual.get("currentIncrementId") == target_id)
                if actual.get("evidencePolicy") == "control-plane-v1" and engine.current_story_tracking(actual, target_id) and not event.get("workProof"):
                    return need_input("exact task-bound workProof; preview supplies no execution or review")
            actual = engine.apply_event(actual, event)
            engine.validate_state_shape(reader.root, actual)
            prepared.append(event)
    except engine.RoadmapError:
        refuse("support.progress-refused", "The canonical engine refused the proposed tracking events; inspect its normal plan/status guidance.")
    target = next(i for i in actual["increments"] if i["id"] == target_id)
    # Preserve approval, obligations and all completed definitions/order. Pure replay
    # cannot assert whether a new chunk is meaningful or actually complete.
    _need(original.get("roadmapApproval") == actual.get("roadmapApproval") and original["evidence"] == actual["evidence"])
    _need({k: v for k, v in before.items() if k not in {"plan", "completedChunks", "status"}} ==
          {k: v for k, v in target.items() if k not in {"plan", "completedChunks", "status"}})
    _need([i for i in original["increments"] if i["id"] != target_id] == [i for i in actual["increments"] if i["id"] != target_id])
    completed = before["completedChunks"]
    _need(target["completedChunks"][:len(completed)] == completed and actual["history"][:len(original["history"])] == original["history"])
    old_done = [c for c in before["plan"]["chunks"] if c["id"] in completed]
    _need([c for c in target["plan"]["chunks"] if c["id"] in completed] == old_done)
    return {"state_path": binding["state_path"], "state_digest": engine.fingerprint(original), "events": prepared,
            "preview": {"increment_id": target_id, "chunks_complete": len(target["completedChunks"]),
                        "chunks_planned": len(target["plan"]["chunks"]), "status": target["status"],
                        "criterion_ids": [c["id"] for c in target["acceptanceCriteria"]],
                        **({"stories": engine.story_progress(actual, target)} if engine.current_story_tracking(actual, target_id) else {})},
            "rendered_roadmap_sha256": hashlib.sha256(engine.render_roadmap(actual).encode()).hexdigest(),
            "references": _refs(reader, request.get("references", [])), "live_state_mutated": False,
            "advisories": ["Review semantic coverage, component evidence and actual authority; apply approved events only through the canonical roadmap CLI."] +
                          (["This pure preview validates no live Work completion proof and grants no task or parent qualification."]
                           if engine.current_story_tracking(actual, target_id) else [])}


def _handoff(work, records, candidate, plan, reader, request):
    opened = {}
    for review in work["reviews"]:
        for closure in review["closures"]:
            opened.pop(closure["finding_id"], None)
        opened.update({f["id"]: {"id": f["id"], "criterion_id": f["criterion_id"], "blocking": f["blocking"], "kind": f["kind"]} for f in review["findings"]})
    receipt = work["receipts"][-1] if work["receipts"] else None
    currentness = "missing"
    if receipt:
        # Integrity is a boundary; a truthful failed receipt is useful handoff data.
        _need(receipt.get("receipt_digest") == digest({k: v for k, v in receipt.items() if k != "receipt_digest"}))
        currentness = "current" if receipt["source_digest"] == candidate["source_digest"] and receipt["plan"]["plan_digest"] == plan["plan_digest"] else "historical"
    claim = work.get("claim")
    roadmap = None
    binding = work["spec"].get("roadmap")
    if binding:
        engine = _engine(reader.root)
        _path(reader.root, binding["state_path"])
        try:
            _, state = engine.load_state(reader.root, binding["state_path"])
        except engine.RoadmapError:
            refuse("support.roadmap-unavailable", "The canonical roadmap loader could not establish current handoff facts.")
        target = next((i for i in state["increments"] if i["id"] == binding["increment_id"]), None)
        roadmap = {"slug": state["slug"], "status": state["status"], "increment_id": binding["increment_id"],
                   "increment_status": target["status"] if target else None,
                   "pending_criteria": target.get("pendingCriteria", []) if target else []}
    return {"head": candidate["head"], "source_digest": candidate["source_digest"], "spec_digest": work["spec_digest"],
            "authority_digest": work["authority_digest"], "status": work["status"], "records_revision": records["revision"],
            "claim": {k: claim[k] for k in ("invocation_id", "expires_at", "fence")} if claim else None,
            "criteria": [a["id"] for a in work["spec"]["acceptance"]], "changed_paths": plan["changed_paths"],
            "selected_checks": [c["id"] for c in plan["selected"]], "open_findings": list(opened.values()),
            "receipt": {"receipt_digest": receipt["receipt_digest"], "qualification": receipt["qualification"],
                        "currentness": currentness, "checks": [{"id": a["check_id"], "status": a["status"]} for a in receipt["attempts"]]} if receipt else None,
            "review": {k: work["reviews"][-1][k] for k in ("review_digest", "receipt_digest", "disposition")} if work["reviews"] else None,
            "roadmap": roadmap, "artifacts": _refs(reader, request.get("references", [])),
            "advisories": ["Use ordinary Work to perform missing checks or obtain actual review; this handoff executes neither."]}


def run(root: Path, operation: str, request: dict) -> dict:
    root = root.resolve()
    _need(operation in OPERATIONS, "support.operation", "Use a documented support operation.")
    allowed = {"schema_version", "work_id", "packet_id", "references"}
    specific = {"prepare": {"paths", "include_preimages"}, "freeze": {"paths", "before"}, "export": {"paths", "before"},
                "transition-before": {"transition"}, "transition-after": {"before"}, "checkpoint": {"paths"},
                "progress": {"events"}, "handoff": set()}
    fields(request, allowed | specific[operation], {"schema_version"})
    _need(request["schema_version"] == REQUEST, "support.schema", "Use contributor-support-request-v1.")
    missing = [key for key in ("work_id",) if not request.get(key)]
    if operation != "handoff" and not request.get("packet_id"):
        missing.append("packet_id")
    if operation == "transition-after" and not request.get("before"):
        missing.append("before")
    if operation == "transition-before" and not request.get("transition"):
        missing.append("transition")
    if missing:
        return need_input(*missing)
    if "include_preimages" in request:
        _need(type(request["include_preimages"]) is bool, "support.schema", "include_preimages must be boolean.")
    controller = Work(root)
    records = controller.records.load()
    work = get_work(records, request["work_id"])
    candidate, plan = controller.context(work)
    reader = Files(root)
    if operation in {"prepare", "freeze", "export"}:
        data = _evidence(operation, request, work, records, candidate, plan, reader)
    elif operation == "transition-before":
        data = _transition_before(request, work, records, candidate, reader)
    elif operation == "transition-after":
        data = _transition_after(request, work, records, candidate, plan, reader)
    elif operation == "checkpoint":
        data = _checkpoint(request, work, records, candidate, plan, reader)
    elif operation == "progress":
        data = _progress(request, work, reader)
        if data.get("status") == "needs-input":
            return data
    else:
        data = _handoff(work, records, candidate, plan, reader, request)
    # Detect concurrent Records changes without another whole-source/evidence scan.
    _need(digest(controller.records.load()) == digest(records), "support.records-drift", "Contributor records changed during support preparation.")
    if request.get("packet_id"):
        return _publish(root, request["packet_id"], operation, request["work_id"], data)
    return {"status": "advisory", "data": data, **LIMITS}


def run_from(root: Path, operation: str, name: str) -> dict:
    _need(relative(name).startswith(".local-codex/"), "support.private-input", "Support requests belong in ignored local storage.")
    _, raw = Files(root.resolve()).read(name, maximum=64 * 1024)
    return run(root, operation, _json(raw))
