"""Outcome-scoped cooperative work, current evidence, review and completion."""
from __future__ import annotations

import platform
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import catalog
from .candidate import changed, roadmap_authority, snapshot
from .common import digest, fields, identifier, inside, now, relative, refuse, text
from .execution import execute
from .contracts import ControlError
from .records import Records
from .storage import confined_path


def validate_spec(spec: dict) -> dict:
    fields(spec, {"schema_version", "work_id", "title", "kind", "authority_ref", "outcome", "write_scope", "acceptance", "roadmap"}, {"schema_version", "work_id", "title", "kind", "authority_ref", "outcome", "write_scope", "acceptance"})
    if spec["schema_version"] != "development-work-v1" or spec["kind"] not in {"lightweight", "roadmap"}:
        refuse("work.schema", "Use a supported work kind and schema.")
    identifier(spec["work_id"])
    text(spec["title"], limit=200)
    text(spec["authority_ref"], limit=200)
    outcome = fields(spec["outcome"], {"user", "problem", "journey", "success", "baseline", "quality", "internal_rationale"}, {"problem", "success", "quality"})
    for value in outcome.values():
        text(value)
    if not outcome.get("internal_rationale") and not all(outcome.get(k) for k in ("user", "journey", "baseline")):
        refuse("work.outcome", "Identify the user, journey and baseline, or explain the internal-only outcome.")
    scopes = spec["write_scope"]
    if not isinstance(scopes, list) or not 1 <= len(scopes) <= 64:
        refuse("work.scope", "Declare a bounded write scope.")
    for scope in scopes:
        relative(scope)
        if inside(scope, [".git", ".local-codex", "artifacts", "docs/tmp"]) or scope.startswith(".git/"):
            refuse("work.protected-scope", "Work cannot authorize controller storage or Git metadata mutation.")
    acceptance = spec["acceptance"]
    if not isinstance(acceptance, list) or not 1 <= len(acceptance) <= 64:
        refuse("work.acceptance", "Declare bounded acceptance criteria.")
    seen = set()
    for c in acceptance:
        fields(c, {"id", "description", "check_ids"}, {"id", "description", "check_ids"})
        identifier(c["id"])
        text(c["description"])
        if c["id"] in seen or not isinstance(c["check_ids"], list) or not 1 <= len(c["check_ids"]) <= 16:
            refuse("work.acceptance", "Criteria require unique identities and named checks.")
        seen.add(c["id"])
        for check_id in c["check_ids"]:
            identifier(check_id)
    if (spec["kind"] == "roadmap") != bool(spec.get("roadmap")):
        refuse("work.authority", "Substantial work must bind its active approved roadmap.")
    return spec


def stamp():
    return datetime.now(timezone.utc)


def expiry(minutes):
    if type(minutes) is not int or not 1 <= minutes <= 240:
        refuse("claim.duration", "Claim duration must be 1–240 minutes.")
    return (stamp() + timedelta(minutes=minutes)).isoformat(timespec="seconds").replace("+00:00", "Z")


def owned(w, invocation, claim_id):
    c = w.get("claim") or {}
    if c.get("invocation_id") != invocation or c.get("claim_id") != claim_id:
        refuse("claim.not-owner", "The invocation does not own this work claim.")
    if stamp() >= datetime.fromisoformat(c["expires_at"].replace("Z", "+00:00")):
        refuse("claim.expired", "The claim expired; explicit recovery is required.")
    if w["status"] == "complete":
        refuse("work.terminal", "Completed work requires a successor correction task.")


def get_work(state, work_id):
    try:
        return state["work_items"][identifier(work_id)]
    except KeyError:
        refuse("work.not-found", "The work item is unavailable.")


def validate_receipt(receipt):
    if receipt.get("receipt_digest") != digest({k: v for k, v in receipt.items() if k != "receipt_digest"}):
        refuse("receipt.integrity", "The execution receipt failed its integrity check.")
    if receipt.get("qualification") != "passed" or not receipt.get("attempts") or any(a["status"] != "passed" for a in receipt["attempts"]):
        refuse("receipt.not-qualified", "Executed checks did not qualify this candidate.")
    selected = [c["id"] for c in receipt["plan"]["selected"]]
    if [a["check_id"] for a in receipt["attempts"]] != selected:
        refuse("receipt.incomplete", "Receipt attempts do not cover the exact selected checks.")


class Work:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.records = Records(self.root)

    def start(self, spec, invocation, minutes=120):
        validate_spec(spec)
        identifier(invocation)
        authority = roadmap_authority(self.root, spec.get("roadmap"))
        self.check_completion_phase(spec)
        for scope in spec["write_scope"]:
            confined_path(self.root, scope)
        baseline = snapshot(self.root)
        catalog.plan(self.root, [], sorted({c for a in spec["acceptance"] for c in a["check_ids"]}), baseline["source_digest"])
        claim = {"invocation_id": invocation, "claim_id": str(uuid.uuid4()), "expires_at": expiry(minutes), "fence": 1}
        def transition(s):
            if spec["work_id"] in s["work_items"]:
                refuse("work.exists", "Work identities are immutable; resume or create a successor.")
            for w in s["work_items"].values():
                if w.get("claim") and w["status"] != "complete":
                    refuse("claim.scope-overlap", "This checkout already has an active claim.", "Serialize work in this checkout, or use a separately authorized isolated checkout.")
            s["work_items"][spec["work_id"]] = {"spec": spec, "spec_digest": digest(spec), "authority_digest": authority, "baseline": baseline, "status": "active", "contributors": [invocation], "claim": claim, "receipts": [], "reviews": [], "events": [{"at": now(), "code": "work.started"}]}
            return {"work_id": spec["work_id"], "claim": claim}
        return self.records.mutate(transition)

    def check_completion_phase(self, spec):
        required = {c for a in spec["acceptance"] for c in a["check_ids"]}
        overall = (spec.get("roadmap") or {}).get("increment_id") == "overall"
        if any(c.startswith("completion-") for c in required) and not overall:
            refuse("verification.aggregate-too-early", "Aggregate qualification runs only after every roadmap increment is implemented.")
        if overall:
            from .common import read_json
            s = read_json(confined_path(self.root, spec["roadmap"]["state_path"]))
            expected = "completion-" + s.get("completionSuite", "standardande2e")
            if expected not in required or any(c.startswith("completion-") and c != expected for c in required):
                refuse("verification.completion-suite", "Overall qualification must execute the roadmap's configured completion suite.")

    def context(self, w):
        if digest(w["spec"]) != w["spec_digest"] or roadmap_authority(self.root, w["spec"].get("roadmap")) != w["authority_digest"]:
            refuse("work.definition-drift", "Approved scope, acceptance or authority changed.")
        self.check_completion_phase(w["spec"])
        current = snapshot(self.root)
        paths = changed(self.records.baseline(w)["files"], current["files"])
        if any(not inside(p, w["spec"]["write_scope"]) for p in paths):
            refuse("work.scope-escape", "Candidate changes escape the declared work scope.")
        required = sorted({c for a in w["spec"]["acceptance"] for c in a["check_ids"]})
        return current, catalog.plan(self.root, paths, required, current["source_digest"])

    def plan(self, work_id):
        return self.context(get_work(self.records.load(), work_id))[1]

    def verify(self, work_id, invocation, claim_id):
        w = get_work(self.records.load(), work_id)
        owned(w, invocation, claim_id)
        before_work = digest(w)
        current, plan = self.context(w)
        attempts = [execute(self.root, c, paths=plan["changed_paths"]) for c in plan["selected"]]
        try:
            after, after_plan = self.context(w)
            stable = after["source_digest"] == current["source_digest"] and after_plan["plan_digest"] == plan["plan_digest"]
        except ControlError:
            # Preserve executed failure evidence even if a check escaped scope or
            # changed authority; the unqualified receipt cannot support completion.
            stable = False
        receipt = {"schema_version": "execution-receipt-v1", "work_id": work_id, "spec_digest": w["spec_digest"], "authority_digest": w["authority_digest"], "source_digest": current["source_digest"], "head": current["head"], "plan": plan, "environment": {"python": platform.python_version(), "platform": platform.system()}, "attempts": attempts, "source_stable": stable, "qualification": "passed" if stable and all(a["status"] == "passed" for a in attempts) else "failed", "recorded_at": now()}
        receipt["receipt_digest"] = digest(receipt)
        def transition(s):
            work = get_work(s, work_id)
            owned(work, invocation, claim_id)
            if digest(work) != before_work:
                refuse("work.concurrent-change", "Work changed while checks were running.")
            work["receipts"].append(receipt)
            work["status"] = "verifying"
            work["events"].append({"at": now(), "code": "verification." + receipt["qualification"]})
            return {"work_id": work_id, "receipt_digest": receipt["receipt_digest"], "qualification": receipt["qualification"], "checks": [{"id": a["check_id"], "status": a["status"]} for a in attempts]}
        return self.records.mutate(transition)

    def current_receipt(self, w):
        if not w["receipts"]:
            refuse("receipt.missing", "Execute the selected checks before qualification.")
        receipt = w["receipts"][-1]
        validate_receipt(receipt)
        current, plan = self.context(w)
        if receipt["source_digest"] != current["source_digest"] or receipt["plan"]["plan_digest"] != plan["plan_digest"] or receipt["spec_digest"] != w["spec_digest"] or not receipt["source_stable"]:
            refuse("receipt.stale", "Source, scope, acceptance or verification policy changed.", "Run fresh candidate verification.")
        return receipt

    def review(self, request):
        fields(request, {"schema_version", "work_id", "invocation_id", "assurance", "disposition", "receipt_digest", "findings", "closures", "reviewed_criteria"}, {"schema_version", "work_id", "invocation_id", "assurance", "disposition", "receipt_digest", "findings", "closures", "reviewed_criteria"})
        if request["schema_version"] != "technical-review-v1" or request["assurance"] not in {"operator-attested", "host-attested"} or request["disposition"] not in {"accepted", "changes-requested"}:
            refuse("review.schema", "Provide a supported separate-invocation review attestation.")
        invocation = identifier(request["invocation_id"])
        def transition(s):
            w = get_work(s, request["work_id"])
            if invocation in w["contributors"]:
                refuse("review.self-review", "A contributor invocation cannot supply the independent disposition.")
            if w["status"] == "complete":
                refuse("work.terminal", "Completed work requires a successor task.")
            receipt = self.current_receipt(w)
            if not isinstance(request["reviewed_criteria"], list) or set(request["reviewed_criteria"]) != {a["id"] for a in w["spec"]["acceptance"]}:
                refuse("review.coverage", "The disposition must cover every acceptance criterion.")
            if w["reviews"] and w["reviews"][-1]["disposition"] == "changes-requested" and w["reviews"][-1]["source_digest"] == receipt["source_digest"]:
                refuse("review.uncorrected", "A blocking disposition requires a corrected source candidate.")
            if receipt["receipt_digest"] != request["receipt_digest"]:
                refuse("review.stale", "Review must bind the current qualifying receipt.")
            if any(r["receipt_digest"] == request["receipt_digest"] for r in w["reviews"]):
                refuse("review.immutable-round", "This exact submission already has a disposition.", "Correct named findings and verify the new candidate.")
            if not isinstance(request["findings"], list) or not isinstance(request["closures"], list) or len(request["findings"]) > 64 or len(request["closures"]) > 64:
                refuse("review.bounds", "Review findings and closures must be bounded arrays.")
            opened = {}
            used_ids = {f["id"] for r in w["reviews"] for f in r["findings"]}
            for r in w["reviews"]:
                for c in r["closures"]:
                    opened.pop(c["finding_id"], None)
                opened.update({f["id"]: f for f in r["findings"]})
            for c in request["closures"]:
                fields(c, {"finding_id", "receipt_digest"}, {"finding_id", "receipt_digest"})
                if c["finding_id"] not in opened or c["receipt_digest"] != receipt["receipt_digest"]:
                    refuse("review.closure", "Closure must name an open finding and fresh qualifying evidence.")
                opened.pop(c["finding_id"])
            for f in request["findings"]:
                fields(f, {"id", "criterion_id", "description", "blocking", "kind"}, {"id", "criterion_id", "description", "blocking", "kind"})
                identifier(f["id"])
                text(f["description"])
                if f["criterion_id"] not in {a["id"] for a in w["spec"]["acceptance"]} or type(f["blocking"]) is not bool or f["kind"] not in {"substantive", "cleanup"} or f["id"] in opened or f["id"] in used_ids:
                    refuse("review.finding", "Findings need unique identities, an acceptance criterion, class and explicit blocking state.")
                if f["kind"] == "cleanup" and f["blocking"]:
                    refuse("review.cleanup", "Cosmetic cleanup cannot block delivery.")
                opened[f["id"]] = f
            blocking = any(f["blocking"] for f in opened.values())
            if (request["disposition"] == "accepted" and blocking) or (request["disposition"] == "changes-requested" and not blocking):
                refuse("review.disposition", "Disposition must agree with substantive blocking findings.")
            record = {**request, "recorded_at": now(), "source_digest": receipt["source_digest"]}
            record["review_digest"] = digest(record)
            w["reviews"].append(record)
            return {"work_id": request["work_id"], "review_digest": record["review_digest"], "disposition": record["disposition"], "identity_assurance": request["assurance"]}
        return self.records.mutate(transition)

    def complete(self, work_id, invocation, claim_id):
        def transition(s):
            w = get_work(s, work_id)
            owned(w, invocation, claim_id)
            receipt = self.current_receipt(w)
            review = (w["reviews"] or [{}])[-1]
            if review.get("disposition") != "accepted" or review.get("receipt_digest") != receipt["receipt_digest"] or review.get("review_digest") != digest({k: v for k, v in review.items() if k != "review_digest"}):
                refuse("completion.review-required", "Completion requires a current accepted separate-invocation review.")
            if any(f["work_id"] == work_id and f["status"] != "closed" for f in s["feedback"].values()):
                refuse("completion.feedback-open", "Outcome feedback needs regression evidence before completion.")
            w["status"] = "complete"
            w["claim"] = None
            w["completion"] = {"at": now(), "source_digest": receipt["source_digest"], "receipt_digest": receipt["receipt_digest"], "review_digest": review["review_digest"]}
            return {"work_id": work_id, "status": "complete"}
        return self.records.mutate(transition)

    def claim(self, work_id, invocation, claim_id=None, *, action="renew", minutes=120):
        identifier(invocation)
        def transition(s):
            w = get_work(s, work_id)
            if w["status"] == "complete":
                refuse("work.terminal", "Completed work requires a successor task.")
            if action == "recover":
                c = w.get("claim") or {}
                if c and stamp() < datetime.fromisoformat(c["expires_at"].replace("Z", "+00:00")):
                    refuse("claim.live-owner", "A live owner cannot be displaced.")
                for other_id, other in s["work_items"].items():
                    if other_id != work_id and other.get("claim") and other["status"] != "complete":
                        refuse("claim.scope-overlap", "Recovery requires exclusive ownership of this checkout.")
                w["claim"] = {"invocation_id": invocation, "claim_id": str(uuid.uuid4()), "expires_at": expiry(minutes), "fence": c.get("fence", 0) + 1}
                if invocation not in w["contributors"]:
                    w["contributors"].append(invocation)
            else:
                owned(w, invocation, claim_id)
                if action == "release":
                    w["claim"] = None
                else:
                    w["claim"]["expires_at"] = expiry(minutes)
            w["events"].append({"at": now(), "code": "claim." + action})
            return {"work_id": work_id, "claim": w["claim"]}
        return self.records.mutate(transition)
