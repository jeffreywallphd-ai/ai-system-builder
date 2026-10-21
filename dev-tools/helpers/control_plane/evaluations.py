"""Prepared real-artifact trials, protected grading and honest run measurements."""
from __future__ import annotations

import hashlib
import platform
import sys
from pathlib import Path

from .common import digest, fields, finite, identifier, now, read_json, relative, refuse, text
from .execution import execute
from .records import Records
from .storage import atomic_write, canonical_bytes, confined_path


class Trials:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.runtime = Path(__file__).resolve().parents[3]
        self.records = Records(self.root)

    def suite(self):
        s = read_json(confined_path(self.root, "dev-tools/agent-evals/coding-tasks.json"), maximum=128 * 1024)
        if s.get("schema_version") != "coding-evaluation-suite-v1" or not isinstance(s.get("tasks"), list) or not 1 <= len(s["tasks"]) <= 32:
            refuse("evaluation.suite", "A supported bounded coding-task suite is required.")
        return s

    def policy(self):
        files = {"suite": digest(self.suite())}
        for p in sorted((self.runtime / "dev-tools/agent-evals").glob("grade*.*")):
            files[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((self.runtime / "dev-tools/helpers/control_plane").glob("*.py")):
            files[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
        return digest(files)

    def workspace(self, trial_id):
        return confined_path(self.root, ".local-codex/control-plane/trials/" + identifier(trial_id) + "/workspace")

    def source(self, trial):
        workspace = self.workspace(trial["trial_id"])
        files = {}
        for p in sorted(workspace.rglob("*")):
            if p.is_symlink():
                refuse("evaluation.symlink", "Trial source symlinks are unsupported.")
            if p.is_file():
                name = p.relative_to(workspace).as_posix()
                if name not in trial["allowed_paths"] or p.stat().st_size > 128 * 1024:
                    refuse("evaluation.scope", "Trial changes escape the prepared source boundary.")
                files[name] = hashlib.sha256(p.read_bytes()).hexdigest()
        if set(files) != set(trial["allowed_paths"]):
            refuse("evaluation.missing-source", "A required trial artifact is missing.")
        return digest(files)

    def prepare(self, task_id, trial_id):
        identifier(task_id); identifier(trial_id)
        tasks = [t for t in self.suite()["tasks"] if t["id"] == task_id]
        if len(tasks) != 1:
            refuse("evaluation.task", "Choose an available task identity.")
        task = tasks[0]
        if task["grader"] != task_id or not isinstance(task["files"], dict) or not 1 <= len(task["files"]) <= 16:
            refuse("evaluation.task", "The task has an unsupported grader or source set.")
        workspace = self.workspace(trial_id)
        policy = self.policy()
        def transition(s):
            if trial_id in s["trials"] or workspace.exists():
                refuse("evaluation.exists", "Trial identities and prepared workspaces cannot be overwritten.")
            for name, content in task["files"].items():
                relative(name); text(content, limit=64000)
                if name.startswith("."):
                    refuse("evaluation.path", "Trial files cannot replace hidden controller metadata.")
                atomic_write(confined_path(workspace, name), content.encode())
            trial = {"schema_version": "coding-trial-v1", "trial_id": trial_id, "task_id": task_id, "task_digest": digest(task), "policy_digest": policy, "environment": {"python": sys.version.split()[0], "platform": platform.platform(), "permission_profile": "operator-host-existing-sandbox"}, "allowed_paths": sorted(task["files"]), "status": "prepared", "evidence_kind": "unavailable", "attempts": [], "created_at": now()}
            trial["initial_source"] = self.source(trial)
            s["trials"][trial_id] = trial
            return {"trial_id": trial_id, "task_id": task_id, "workspace": workspace.relative_to(self.root).as_posix(), "prompt": task["prompt"], "allowed_paths": trial["allowed_paths"], "policy_digest": policy}
        return self.records.mutate(transition)

    def grade(self, trial_id):
        trial = self.records.load()["trials"].get(identifier(trial_id))
        if not trial:
            refuse("evaluation.not-found", "The trial is unavailable.")
        policy = self.policy()
        if trial["policy_digest"] != policy:
            refuse("evaluation.policy-drift", "The task or grader policy changed since preparation.", "Prepare a new trial under the current policy.")
        source = self.source(trial)
        if trial.get("run"):
            refuse("evaluation.run-frozen", "Run accounting freezes this graded candidate; prepare a new trial for later changes or grading.")
        result = execute(self.root, {"id": "coding-task-grader", "argv": [sys.executable, "-B", str(self.runtime / "dev-tools/agent-evals/grade_coding_task.py"), "--task", trial["task_id"], "--workspace", str(self.workspace(trial_id))], "timeout": 15})
        stable = self.source(trial) == source and self.policy() == policy
        # A clean process exit alone does not prove that the trusted grader ran
        # every assertion (an artifact can accidentally exit during import).
        proof = result.get("output", {}).get("stdout", {})
        grader_finished = proof.get("sha256") == hashlib.sha256(b"grader.passed\n").hexdigest() and proof.get("bytes") == len(b"grader.passed\n")
        attempt = {"at": now(), "source_digest": source, "policy_digest": policy, "execution": result, "status": "passed" if stable and grader_finished and result["status"] == "passed" else "failed", "source_stable": stable, "grader_completed": grader_finished}
        attempt["attempt_digest"] = digest(attempt)
        def transition(s):
            current = s["trials"][trial_id]
            if digest(current) != digest(trial):
                refuse("evaluation.concurrent-change", "Trial state changed during grading.")
            current["attempts"].append(attempt)
            current["result"] = attempt
            current["status"] = "graded"
            current["evidence_kind"] = current.get("run", {}).get("evidence_kind", "artifact-conformance")
            return {"trial_id": trial_id, "status": attempt["status"], "attempt_digest": attempt["attempt_digest"], "evidence_kind": current["evidence_kind"]}
        return self.records.mutate(transition)

    def record_run(self, manifest):
        keys = {"schema_version", "trial_id", "model", "harness", "instruction_digest", "context_digest", "permission_profile", "duration_ms", "retries", "input_tokens", "output_tokens", "cost_usd", "evidence_kind", "infrastructure_status", "work_id"}
        fields(manifest, keys, keys - {"work_id"})
        if manifest["schema_version"] != "agent-run-v1" or manifest["evidence_kind"] not in {"operator-hosted-live", "deterministic-conformance", "replay", "unavailable"} or manifest["infrastructure_status"] not in {"ok", "failed", "unavailable"}:
            refuse("run.schema", "Provide a supported run manifest with explicit evidence kind.")
        for key in ("model", "harness", "permission_profile"):
            text(manifest[key], limit=160)
        import re
        for key in ("instruction_digest", "context_digest"):
            if not isinstance(manifest[key], str) or not re.fullmatch(r"[a-f0-9]{64}", manifest[key]):
                refuse("run.digest", "Record digests of instructions and context, never their private contents.")
        for key in ("duration_ms", "input_tokens", "output_tokens", "cost_usd"):
            finite(manifest[key])
        if type(manifest["retries"]) is not int or not 0 <= manifest["retries"] <= 100:
            refuse("run.retries", "Retries must be a bounded non-negative count.")
        def transition(s):
            trial = s["trials"].get(identifier(manifest["trial_id"]))
            if not trial or trial["policy_digest"] != self.policy():
                refuse("run.trial-stale", "The prepared trial is missing or stale.")
            if trial.get("run"):
                refuse("run.immutable", "Run metadata cannot be overwritten; prepare a separate trial.")
            if not trial.get("result") or self.source(trial) != trial["result"]["source_digest"] or not trial["result"]["source_stable"]:
                refuse("run.ungraded", "Grade the actual stable candidate before recording its run measurements.")
            run = {**manifest, "recorded_at": now(), "assurance": "operator-supplied", "accepted_work": False, "graded_attempt": trial["result"]["attempt_digest"], "source_digest": trial["result"]["source_digest"]}
            if manifest.get("work_id"):
                from .work import Work, get_work
                w = get_work(s, manifest["work_id"])
                if w["status"] != "complete":
                    refuse("run.work-unqualified", "Accepted-work accounting requires completed reviewed work.")
                Work(self.root).current_receipt(w)
                run["accepted_work"] = True
                run["work_receipt"] = w["completion"]["receipt_digest"]
            run["run_digest"] = digest(run)
            trial["run"] = run
            trial["evidence_kind"] = manifest["evidence_kind"]
            return {"trial_id": trial["trial_id"], "run_digest": run["run_digest"], "assurance": run["assurance"]}
        return self.records.mutate(transition)

    def compare(self, trial_ids):
        if not 2 <= len(trial_ids) <= 100 or len(set(trial_ids)) != len(trial_ids):
            refuse("comparison.trials", "Compare two to one hundred distinct trials.")
        state = self.records.load()
        trials = [state["trials"].get(identifier(i)) for i in trial_ids]
        if any(not t or not t.get("run") or not t.get("attempts") for t in trials):
            refuse("comparison.unavailable", "Every compared trial needs executed grading and a run manifest.")
        identities = {(t["task_id"], t["task_digest"], t["policy_digest"], digest(t["environment"]), t["run"]["harness"], t["run"]["instruction_digest"], t["run"]["context_digest"], t["run"]["permission_profile"], t["run"]["evidence_kind"]) for t in trials}
        if len(identities) != 1 or any(t["policy_digest"] != self.policy() for t in trials):
            refuse("comparison.incomparable", "Task, grading, environment, harness, instructions, context, permissions or evidence kind differ.")
        rows = []
        for t in trials:
            r = t["run"]
            if self.source(t) != t["result"]["source_digest"] or r["graded_attempt"] != t["result"]["attempt_digest"] or r["source_digest"] != t["result"]["source_digest"] or any(a["attempt_digest"] != digest({k: v for k, v in a.items() if k != "attempt_digest"}) for a in t["attempts"]) or r["run_digest"] != digest({k: v for k, v in r.items() if k != "run_digest"}):
                refuse("comparison.stale", "Trial artifacts or recorded measurements changed after grading.")
            qualified = t["result"]["status"] == "passed" and r["infrastructure_status"] == "ok"
            rows.append({"trial_id": t["trial_id"], "model": r["model"], "qualified": qualified, "grading_status": t["result"]["status"], "infrastructure_status": r["infrastructure_status"], "first_attempt_passed": t["attempts"][0]["status"] == "passed", "attempt_count": len(t["attempts"]), "grading_duration_ms": sum(a["execution"]["duration_ms"] for a in t["attempts"]), "duration_ms": r["duration_ms"], "cost_usd": r["cost_usd"], "retries": r["retries"], "accepted_work": r["accepted_work"], "work_id": r.get("work_id")})
        accepted = [r for r in rows if r["qualified"] and r["accepted_work"]]
        accepted_count = len({r["work_id"] for r in accepted})
        def per_accepted(key):
            # Charge all attempted delivery, including failures, against accepted outcomes.
            return sum(r[key] for r in rows) / accepted_count if accepted_count and all(r[key] is not None for r in rows) else None
        return {"schema_version": "agent-comparison-v1", "evidence_kind": trials[0]["evidence_kind"], "trial_count": len(rows), "attempt_count": sum(r["attempt_count"] for r in rows), "qualified_trial_count": sum(r["qualified"] for r in rows), "infrastructure_failure_count": sum(r["infrastructure_status"] == "failed" for r in rows), "infrastructure_unavailable_count": sum(r["infrastructure_status"] == "unavailable" for r in rows), "first_attempt_pass_count": sum(r["first_attempt_passed"] for r in rows), "accepted_work_count": accepted_count, "all_safety_and_correctness_passed": all(r["grading_status"] == "passed" for r in rows), "all_trials_qualified": all(r["qualified"] for r in rows), "time_per_accepted_work_ms": per_accepted("duration_ms"), "cost_per_accepted_work_usd": per_accepted("cost_usd"), "rows": rows, "measurement_assurance": "operator-supplied; artifacts independently graded"}
