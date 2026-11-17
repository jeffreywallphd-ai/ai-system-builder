"""Outcome feedback closes only with observed regression and current correction evidence."""
from __future__ import annotations

from pathlib import Path
import sys

from .common import digest, fields, identifier, inside, now, relative, refuse, text
from .evaluations import Trials
from .records import Records
from .work import Work, get_work
from .execution import execute


class Feedback:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.records = Records(self.root)

    def execute_regression(self, w, path, expected):
        before, plan = Work(self.root).context(w)
        if not inside(path, w["spec"]["write_scope"]) or path not in before["files"] or "focused-tests" not in plan["coverage"].get(path, []):
            refuse("feedback.executable-regression", "The named test needs a scoped catalog-covered source change.")
        attempt = execute(self.root, {"id": "feedback-regression", "argv": [sys.executable, "-B", "dev-tools/helpers/run_focused_checks.py", "--regression-test", path], "timeout": 300})
        after, after_plan = Work(self.root).context(w)
        if before["source_digest"] != after["source_digest"] or plan["plan_digest"] != after_plan["plan_digest"] or attempt["status"] != expected:
            refuse("feedback.named-regression-verdict", "The designated stable regression must itself " + ("fail" if expected == "failed" else "pass") + "; another test's verdict cannot substitute.")
        record = {"at": now(), "path": path, "source_digest": before["source_digest"], "test_digest": before["files"][path], "plan_digest": plan["plan_digest"], "execution": attempt}
        record["receipt_digest"] = digest(record)
        return record

    def open(self, request):
        keys = {"schema_version", "id", "work_id", "criterion_id", "summary", "kind", "trial_id", "regression_path", "quality_evidence"}
        fields(request, keys, keys - {"quality_evidence"})
        if request["schema_version"] != "outcome-feedback-v1" or request["kind"] not in {"defect", "usability", "accessibility", "performance"}:
            refuse("feedback.schema", "Use a supported outcome-linked feedback record.")
        identifier(request["id"]); text(request["summary"])
        quality = request.get("quality_evidence", [])
        if not isinstance(quality, list) or len(quality) > 8:
            refuse("feedback.quality-evidence", "Use at most eight bounded quality evidence references.")
        for evidence in quality:
            fields(evidence, {"kind", "environment", "qualification", "evidence_ref"}, {"kind", "environment", "qualification", "evidence_ref"})
            if evidence["kind"] not in {"accessibility", "performance"} or evidence["qualification"] not in {"operator-attested-measurement", "pending", "unavailable"}:
                refuse("feedback.quality-evidence", "Quality evidence needs an explicit kind and assurance.")
            text(evidence["environment"], limit=200); text(evidence["evidence_ref"], limit=200)
        path = relative(request["regression_path"])
        name = Path(path).name
        if not ((".test." in name and name.endswith((".mjs", ".js", ".ts", ".tsx"))) or (name.startswith("test_") and name.endswith(".py"))):
            refuse("feedback.executable-regression", "The durable regression must be an executable repository test, not prose or a supplied result.")
        before_work = get_work(self.records.load(), request["work_id"])
        repository_failure = self.execute_regression(before_work, path, "failed")
        def transition(s):
            if request["id"] in s["feedback"]:
                refuse("feedback.exists", "Feedback identities cannot be overwritten.")
            w = get_work(s, request["work_id"])
            if digest(w) != digest(before_work):
                refuse("feedback.concurrent-change", "Work changed during regression execution.")
            if w["status"] == "complete" or request["criterion_id"] not in {a["id"] for a in w["spec"]["acceptance"]} or not inside(path, w["spec"]["write_scope"]):
                refuse("feedback.scope", "Feedback must bind an active outcome criterion and scoped regression artifact.")
            trial = s["trials"].get(identifier(request["trial_id"]))
            if not trial or not trial.get("result") or trial["result"]["status"] != "failed" or not trial["result"]["source_stable"] or trial["result"]["execution"]["status"] != "failed":
                refuse("feedback.failure-required", "Execute a stable failing regression before opening feedback; unavailable infrastructure is not a reproduced defect.")
            if trial["policy_digest"] != Trials(self.root).policy() or Trials(self.root).source(trial) != trial["result"]["source_digest"]:
                refuse("feedback.stale", "The failing regression is stale.")
            current, plan = Work(self.root).context(w)
            failure = (w["receipts"] or [{}])[-1]
            if current["source_digest"] != repository_failure["source_digest"] or path not in current["files"] or "focused-tests" not in plan["coverage"].get(path, []) or failure.get("source_digest") != current["source_digest"] or failure.get("plan", {}).get("plan_digest") != plan["plan_digest"] or not any(a["check_id"] == "focused-tests" and a["status"] == "failed" for a in failure.get("attempts", [])):
                refuse("feedback.repository-failure-required", "Execute the catalog-covered repository regression in the failing candidate before opening feedback.")
            s["feedback"][request["id"]] = {**request, "status": "open", "opened_at": now(), "regression": request["trial_id"], "failure_index": len(trial["attempts"]) - 1, "failure_digest": trial["result"]["attempt_digest"], "policy_digest": trial["policy_digest"], "repository_failure_receipt": failure["receipt_digest"], "regression_source": current["files"][path]}
            s["feedback"][request["id"]]["named_regression_failure"] = repository_failure
            return {"id": request["id"], "status": "open"}
        return self.records.mutate(transition)

    def close(self, feedback_id):
        state = self.records.load()
        initial = state["feedback"].get(identifier(feedback_id))
        if not initial or initial["status"] != "open":
            refuse("feedback.not-open", "Choose an open feedback record.")
        before_work = get_work(state, initial["work_id"])
        repository_pass = self.execute_regression(before_work, initial["regression_path"], "passed")
        def transition(s):
            f = s["feedback"].get(identifier(feedback_id))
            if not f or f["status"] != "open":
                refuse("feedback.not-open", "Choose an open feedback record.")
            w = get_work(s, f["work_id"])
            if digest(w) != digest(before_work) or digest(f) != digest(initial):
                refuse("feedback.concurrent-change", "Feedback or work changed during regression execution.")
            controller = Work(self.root)
            receipt = controller.current_receipt(w)
            current, plan = controller.context(w)
            trial = s["trials"][f["trial_id"]]
            failing = trial["attempts"][f["failure_index"]]
            passing = trial["result"]
            if failing["attempt_digest"] != f["failure_digest"] or failing["source_digest"] == passing["source_digest"] or len(trial["attempts"]) <= f["failure_index"] + 1 or passing["status"] != "passed" or trial["policy_digest"] != f["policy_digest"] or Trials(self.root).policy() != f["policy_digest"] or Trials(self.root).source(trial) != passing["source_digest"]:
                refuse("feedback.regression-required", "Closure needs fresh passing execution of the same corrected regression under the original policy.")
            path = f["regression_path"]
            baseline = self.records.baseline(w)
            if current["source_digest"] != repository_pass["source_digest"] or path not in current["files"] or current["files"][path] != f["regression_source"] or current["files"][path] == baseline["files"].get(path) or "focused-tests" not in plan["coverage"].get(path, []) or not any(a["check_id"] == "focused-tests" and a["status"] == "passed" for a in receipt["attempts"]):
                refuse("feedback.durable-regression", "Preserve and pass the same added repository regression; changing its assertions requires new failing evidence.")
            review = (w["reviews"] or [{}])[-1]
            if review.get("disposition") != "accepted" or review.get("receipt_digest") != receipt["receipt_digest"]:
                refuse("feedback.review-required", "The correction needs current independent acceptance before feedback closes.")
            f.update(status="closed", closed_at=now(), closure={"receipt_digest": receipt["receipt_digest"], "review_digest": review["review_digest"], "passing_attempt": passing["attempt_digest"], "regression_source": current["files"][path]})
            f["closure_digest"] = digest(f["closure"])
            f["named_regression_pass"] = repository_pass
            return {"id": feedback_id, "status": "closed", "closure_digest": f["closure_digest"]}
        return self.records.mutate(transition)
