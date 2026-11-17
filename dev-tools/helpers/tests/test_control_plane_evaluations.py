"""Real failing and corrected artifacts, comparable measurements and regression closure."""
from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

from test_control_plane_delivery import Fixture, HELPERS
from control_plane.common import digest
from control_plane.contracts import ControlError
from control_plane.evaluations import Trials
from control_plane.feedback import Feedback
from control_plane.metrics import delivery

REPO = HELPERS.parents[1]
SOLUTIONS = {
    "workspace-record-defect": {"records.py": "def get(records, workspace_id, record_id):\n    return records.get((workspace_id, record_id))\n"},
    "contract-to-repository": {"service.py": "def load(request, repository):\n    if not request.workspace_id: raise ValueError('workspace required')\n    return repository.read(request.workspace_id, request.record_id)\n"},
    "authorization-denial": {"access.py": "def allowed(roles, approved):\n    return 'admin' in (roles or []) and approved is True\n"},
    "decision-gate-escalation": {"decision.json": '{"action":"escalate","decision":"sandbox-policy","reason":"Execution requires an approved isolation and permission policy."}'},
    "recoverable-ui-journey": {"app.js": "const status = document.querySelector('#status'); const retry = document.querySelector('#retry'); async function save() { retry.hidden = true; try { status.textContent = await window.runTask(); } catch { status.textContent = 'Save failed. Try again.'; retry.hidden = false; } } document.querySelector('#form').addEventListener('submit', event => { event.preventDefault(); save(); }); retry.addEventListener('click', save);"},
}


class EvaluationTests(Fixture):
    def setUp(self):
        super().setUp()
        self.put("dev-tools/agent-evals/coding-tasks.json", (REPO / "dev-tools/agent-evals/coding-tasks.json").read_text())
        self.trials = Trials(self.root)

    def correct(self, task, trial):
        for name, content in SOLUTIONS[task].items():
            (self.trials.workspace(trial) / name).write_text(content, encoding="utf-8")

    def manifest(self, trial, **kwargs):
        value = {"schema_version": "agent-run-v1", "trial_id": trial, "model": "fixture-agent-v1", "harness": "conformance-v1", "instruction_digest": "a" * 64, "context_digest": "b" * 64, "permission_profile": "fixture-existing-host", "duration_ms": 100, "retries": 0, "input_tokens": None, "output_tokens": None, "cost_usd": None, "evidence_kind": "deterministic-conformance", "infrastructure_status": "ok"}
        return {**value, **kwargs}

    def test_five_task_types_execute_actual_failure_and_corrected_behavior(self):
        for task in SOLUTIONS:
            with self.subTest(task=task):
                trial = "trial-" + task
                self.trials.prepare(task, trial)
                self.assertEqual(self.trials.grade(trial)["status"], "failed")
                self.correct(task, trial)
                self.assertEqual(self.trials.grade(trial)["status"], "passed")
                attempts = self.trials.records.load()["trials"][trial]["attempts"]
                self.assertEqual([a["status"] for a in attempts], ["failed", "passed"])
                self.assertNotEqual(attempts[0]["source_digest"], attempts[1]["source_digest"])

    def test_early_success_exit_cannot_substitute_for_executed_assertions(self):
        self.trials.prepare("authorization-denial", "early")
        for source in ("raise SystemExit(0)", "import os; os._exit(0)", 'import os; os.write(1, b"grader.passed\\n"); os._exit(0)'):
            (self.trials.workspace("early") / "access.py").write_text(source)
            self.assertEqual(self.trials.grade("early")["status"], "failed")
        self.trials.prepare("contract-to-repository", "imports")
        self.correct("contract-to-repository", "imports")
        p = self.trials.workspace("imports") / "service.py"
        p.write_text("from contracts import Request\n" + p.read_text())
        self.assertEqual(self.trials.grade("imports")["status"], "passed")

    def test_run_metadata_binds_graded_attempt_and_separates_infrastructure(self):
        for trial in ("healthy", "infrastructure-failure"):
            self.trials.prepare("authorization-denial", trial)
            with self.assertRaises(ControlError): self.trials.record_run(self.manifest(trial))
            self.correct("authorization-denial", trial)
            self.trials.grade(trial)
            self.trials.record_run(self.manifest(trial, infrastructure_status="failed" if trial == "infrastructure-failure" else "ok"))
            with self.assertRaisesRegex(ControlError, "freezes"):
                self.trials.grade(trial)
        comparison = self.trials.compare(["healthy", "infrastructure-failure"])
        self.assertTrue(comparison["all_safety_and_correctness_passed"])
        self.assertFalse(comparison["all_trials_qualified"])
        self.assertEqual(comparison["infrastructure_failure_count"], 1)
        self.assertEqual(comparison["rows"][1]["grading_status"], "passed")
        self.assertEqual(comparison["rows"][1]["infrastructure_status"], "failed")

    def test_protected_policy_scope_and_incomparable_runs_fail_closed(self):
        task = "authorization-denial"
        for trial in ("one", "two"):
            self.trials.prepare(task, trial)
            self.correct(task, trial)
            self.trials.grade(trial)
            self.trials.record_run(self.manifest(trial, harness="different" if trial == "two" else "conformance-v1"))
        with self.assertRaisesRegex(ControlError, "differ"):
            self.trials.compare(["one", "two"])
        with self.assertRaises(ControlError):
            self.trials.record_run(self.manifest("one"))
        (self.trials.workspace("one") / "grader.py").write_text("print('passed')")
        with self.assertRaisesRegex(ControlError, "escape"):
            self.trials.grade("one")
        suite = json.loads((self.root / "dev-tools/agent-evals/coding-tasks.json").read_text())
        suite["version"] = "changed"
        self.put("dev-tools/agent-evals/coding-tasks.json", json.dumps(suite))
        with self.assertRaisesRegex(ControlError, "policy changed"):
            self.trials.grade("two")

    def test_failed_trials_and_unknown_cost_are_not_hidden(self):
        for trial in ("passes", "fails"):
            self.trials.prepare("authorization-denial", trial)
            if trial == "passes": self.correct("authorization-denial", trial)
            self.trials.grade(trial)
            self.trials.record_run(self.manifest(trial))
        result = self.trials.compare(["passes", "fails"])
        self.assertEqual(result["trial_count"], 2)
        self.assertEqual(result["qualified_trial_count"], 1)
        self.assertFalse(result["all_safety_and_correctness_passed"])
        self.assertIsNone(result["cost_per_accepted_work_usd"])
        self.assertEqual(result["accepted_work_count"], 0)
        (self.trials.workspace("passes") / "access.py").write_text("changed")
        with self.assertRaisesRegex(ControlError, "after grading"):
            self.trials.compare(["passes", "fails"])

    def test_measurement_validation_and_false_accepted_work_are_denied(self):
        self.trials.prepare("authorization-denial", "one")
        for changes in ({"duration_ms": -1}, {"cost_usd": float("inf")}, {"input_tokens": True}, {"retries": -1}, {"instruction_digest": "private contents"}, {"work_id": "missing"}):
            with self.subTest(changes=list(changes)), self.assertRaises(ControlError):
                self.trials.record_run(self.manifest("one", **changes))

    def test_public_cli_grades_code_not_success_transcripts(self):
        cli = HELPERS / "development_control_plane.py"
        def run(*args):
            r = subprocess.run([sys.executable, "-B", str(cli), "--repo", str(self.root), *args], capture_output=True, text=True, timeout=25)
            return r.returncode, json.loads(r.stdout)
        code, value = run("prepare-trial", "authorization-denial", "cli")
        self.assertEqual(code, 0)
        code, value = run("grade-trial", "cli")
        self.assertEqual(code, 1)
        self.correct("authorization-denial", "cli")
        code, value = run("grade-trial", "cli")
        self.assertEqual(code, 0)
        self.assertEqual(value["data"]["status"], "passed")

    def test_feedback_requires_failure_durable_regression_review_and_fresh_pass(self):
        self.repository(start=False)
        self.put("dev-tools/helpers/run_focused_checks.py", (HELPERS / "run_focused_checks.py").read_text())
        for name in ("__init__.py", "candidate.py", "common.py", "storage.py", "contracts.py"):
            self.put("dev-tools/helpers/control_plane/" + name, (HELPERS / "control_plane" / name).read_text())
        path = "dev-tools/scripts/example/recovery.test.mjs"
        behavior_test = 'import assert from "node:assert/strict"; import fs from "node:fs"; import test from "node:test"; test("completed journey", () => assert.match(fs.readFileSync("docs/result.md", "utf8"), /^completed/));'
        self.put("dev-tools/scripts/example/existing.test.mjs", behavior_test)
        self.spec["write_scope"].append("dev-tools/scripts/example")
        self.claim = self.work.start(self.spec, "author-run")["claim"]["claim_id"]
        self.assertEqual(self.work.records.load()["work_items"]["fixture-work"]["baseline"]["schema_version"], "source-snapshot-reference-v1")
        self.trials.prepare("authorization-denial", "regression")
        feedback = Feedback(self.root)
        request = {"schema_version": "outcome-feedback-v1", "id": "denial", "work_id": "fixture-work", "criterion_id": "result", "summary": "The result must complete its documented journey", "kind": "defect", "trial_id": "regression", "regression_path": path}
        with self.assertRaises(ControlError): feedback.open(request)
        self.trials.grade("regression")
        self.put(path, 'import test from "node:test"; test("always passes", () => {});')
        self.work.verify("fixture-work", "author-run", self.claim)
        with self.assertRaisesRegex(ControlError, "designated stable regression"):
            feedback.open(request)
        self.put(path, behavior_test)
        with self.assertRaises(ControlError): feedback.open(request)
        failed = self.work.verify("fixture-work", "author-run", self.claim)
        self.assertEqual(failed["qualification"], "failed")
        feedback.open(request)
        with self.assertRaises(ControlError): feedback.close("denial")
        self.correct("authorization-denial", "regression")
        self.trials.grade("regression")
        receipt = self.verify()
        with self.assertRaises(ControlError): feedback.close("denial")
        self.review(receipt)
        with self.assertRaises(ControlError): self.work.complete("fixture-work", "author-run", self.claim)
        self.assertEqual(feedback.close("denial")["status"], "closed")
        self.work.complete("fixture-work", "author-run", self.claim)
        w = self.work.records.load()["work_items"]["fixture-work"]
        self.assertGreater(delivery(w)["check_duration_ms"], 0)
        self.assertIsNone(delivery(w)["cost_usd"])
        self.trials.record_run(self.manifest("regression", work_id="fixture-work", cost_usd=0.5))
        self.assertTrue(self.trials.records.load()["trials"]["regression"]["run"]["accepted_work"])
        for trial in ("duplicate", "failed-attempt"):
            self.trials.prepare("authorization-denial", trial)
            if trial == "duplicate": self.correct("authorization-denial", trial)
            self.trials.grade(trial)
            self.trials.record_run(self.manifest(trial, work_id="fixture-work", cost_usd=0.25))
        comparison = self.trials.compare(["regression", "duplicate", "failed-attempt"])
        self.assertEqual(comparison["accepted_work_count"], 1)
        self.assertEqual(comparison["cost_per_accepted_work_usd"], 1.0)
        self.assertEqual(comparison["attempt_count"], 4)
        self.assertFalse(comparison["all_safety_and_correctness_passed"])
