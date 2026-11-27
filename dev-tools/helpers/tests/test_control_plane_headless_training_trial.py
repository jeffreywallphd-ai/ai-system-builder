"""Inert source tests for the separately approved one-use Tiny test driver."""
from pathlib import Path
import copy
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "dev-tools/helpers"))
from control_plane import catalog
spec = importlib.util.spec_from_file_location("fresh_tiny_guard", REPO / catalog.TRAINING_FRESH_GUARD)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class FreshTinyAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="tiny-admission-", dir=REPO / ".local-codex/t")
        self.root = Path(self.temporary.name).resolve(); self.identity = self.root.stat()
        self.directory = self.root / guard.DIRECTORY; self.directory.mkdir(parents=True)
        self.source = "a" * 64
        self.authorization = {"schema_version": "headless-fresh-tiny-authorization-v1",
            "authorization_ref": "user-approved-fresh-tiny-trial-20261127", "attempts": 1, "nonce": "b" * 32,
            "source_digest": self.source, "guard_work_id": guard.GUARD_WORK, "prior_receipts": list(guard.PRIOR), "limits": dict(guard.LIMITS)}

    def tearDown(self):
        current = self.root.lstat()
        self.assertEqual(self.root.parent, (REPO / ".local-codex/t").resolve())
        self.assertFalse(self.root.is_symlink()); self.assertEqual(self.root.resolve(), self.root)
        self.assertEqual((current.st_dev, current.st_ino), (self.identity.st_dev, self.identity.st_ino))
        self.temporary.cleanup()

    def test_one_use_survives_failure_or_termination_without_releasing_prior_charges(self):
        marker = guard.consume(self.root, self.authorization, self.source, 1024**3)
        used = self.directory / "used.json"; before = used.read_bytes()
        self.assertEqual(marker["prior_retirement"], "unconfirmed"); self.assertEqual(marker["prior_released_bytes"], 0)
        self.assertEqual(marker["retained_logical_bytes"], 2 * guard.RETAINED_DECLARATION)
        self.assertFalse(marker["physical_quota_asserted"])
        with self.assertRaises(FileExistsError): guard.consume(self.root, self.authorization, self.source, 1024**3)
        self.assertEqual(used.read_bytes(), before)
        self.assertFalse((self.directory / "result.json").exists())

    def test_authorization_cannot_change_source_limits_history_or_permissions(self):
        variants = [{**self.authorization, "attempts": n} for n in (True, 0, 2)]
        variants += [{**self.authorization, key: value} for key, value in (
            ("source_digest", "c" * 64), ("guard_work_id", "other"), ("authorization_ref", "other"),
            ("nonce", "invalid"), ("prior_receipts", guard.PRIOR[1:]), ("limits", {**guard.LIMITS, "maximum_duration_ms": 690001}))]
        variants += [{**self.authorization, "command": "synthetic"}]
        for value in variants:
            with self.subTest(value=list(value)):
                with self.assertRaises(guard.AdmissionError): guard.validate_authorization(value, self.source)
        self.assertFalse((self.directory / "used.json").exists())

    def test_retained_plus_fresh_headroom_is_required_before_consumption(self):
        required = guard.MINIMUM_FREE + 3 * guard.RETAINED_DECLARATION
        for free in (True, required - 1, -1):
            with self.assertRaises(guard.AdmissionError): guard.consume(self.root, self.authorization, self.source, free)
            self.assertFalse((self.directory / "used.json").exists())
        guard.consume(self.root, self.authorization, self.source, required)

    def test_closed_bounded_nonaliased_records_and_duplicate_key_denial(self):
        target = self.directory / "authorization.json"
        target.write_text(json.dumps(self.authorization)); self.assertEqual(guard.read_record(self.root, target), self.authorization)
        target.write_text('{"attempts":1,"attempts":2}')
        with self.assertRaises(guard.AdmissionError): guard.read_record(self.root, target)
        target.write_bytes(b"x" * 8193)
        with self.assertRaises(guard.AdmissionError): guard.read_record(self.root, target)
        target.write_text("{}")
        os.link(target, self.directory / "alias.json")
        with self.assertRaises(guard.AdmissionError): guard.read_record(self.root, target)
        with self.assertRaises(guard.AdmissionError): guard.plain(self.root, self.root.parent / "outside", True)

    def canonical_review_fixture(self):
        receipt = {"source_digest": self.source, "receipt_digest": "d" * 64,
            "plan": {"plan_digest": "e" * 64, "selected": [{"id": "headless-training-fresh-trial-guard-unit"}]}}
        work = {"status": "verifying", "contributors": ["author"], "spec": {"acceptance": [{"id": "one-use"}]}, "reviews": []}
        state = {"work_items": {guard.GUARD_WORK: work}}
        # Exercise the actual record producer instead of inventing review fields.
        producer = guard.Work(self.root)
        producer.records = SimpleNamespace(mutate=lambda operation: operation(state))
        request = {"schema_version": "technical-review-v1", "work_id": guard.GUARD_WORK, "invocation_id": "reviewer",
            "assurance": "host-attested", "disposition": "accepted", "receipt_digest": receipt["receipt_digest"],
            "findings": [], "closures": [], "reviewed_criteria": ["one-use"]}
        with patch.object(producer, "current_receipt", return_value=receipt), \
                patch.object(producer, "_usage_boundary", side_effect=lambda result, *args, **kwargs: result):
            result = producer.review(request)
        self.assertNotIn("plan_digest", work["reviews"][0])
        work["status"] = "complete"
        work["completion"] = {"receipt_digest": receipt["receipt_digest"], "review_digest": result["review_digest"]}
        return work, receipt

    def test_current_independent_guard_review_is_required_and_cannot_include_real_execution(self):
        work, receipt = self.canonical_review_fixture()
        guard.reviewed_guard(work, receipt, self.source)
        for variant in ("source", "reviewer", "disposition", "complete", "real-run", "integrity"):
            w, r = copy.deepcopy(work), copy.deepcopy(receipt)
            if variant == "source": r["source_digest"] = "0" * 64
            if variant == "reviewer": w["reviews"][0]["invocation_id"] = "author"
            if variant == "disposition": w["reviews"][0]["disposition"] = "changes-requested"
            if variant == "complete": w["status"] = "active"
            if variant == "real-run": r["plan"]["selected"].append({"id": "headless-training-bounded-feature"})
            if variant == "integrity": w["reviews"][0]["assurance"] = "changed"
            with self.assertRaises(guard.AdmissionError): guard.reviewed_guard(w, r, self.source)

    def test_rewritten_record_is_readable_without_cross_api_ctime_assumptions(self):
        target = self.directory / "record.json"; target.write_text('{"case":1}')
        self.assertEqual(guard.read_record(self.root, target), {"case": 1})
        target.write_text('{"case":2}')
        self.assertEqual(guard.read_record(self.root, target), {"case": 2})

    def test_handle_timestamp_change_during_read_still_denies(self):
        target = self.directory / "record.json"; target.write_text('{"case":1}')
        with target.open("rb") as stream: original = os.fstat(stream.fileno())
        fields = {key: getattr(original, key) for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_nlink")}
        changed = SimpleNamespace(**{**fields, "st_ctime_ns": fields["st_ctime_ns"] + 1})
        with patch.object(guard.os, "fstat", side_effect=[SimpleNamespace(**fields), changed]):
            with self.assertRaisesRegex(guard.AdmissionError, "record-changed"): guard.read_record(self.root, target)

    def test_missing_authorization_denies_main_without_child_effects(self):
        output = io.StringIO()
        with patch.object(guard, "ROOT", self.root), patch.object(guard, "snapshot", return_value={"source_digest": self.source}), \
                patch.object(guard, "execute") as execute, redirect_stdout(output):
            self.assertEqual(guard.main(), 1)
        execute.assert_not_called(); self.assertNotIn(str(self.root), output.getvalue())
        self.assertFalse((self.directory / "used.json").exists())

    def test_main_accepts_canonical_review_and_calls_one_inert_child_only(self):
        work, receipt = self.canonical_review_fixture()
        prior = [{"qualification": "failed", "case": n} for n in (1, 2)]
        for row in prior: row["receipt_digest"] = guard.digest(row)
        references = [row["receipt_digest"] for row in prior]
        (self.directory / "authorization.json").write_text(json.dumps({**self.authorization, "prior_receipts": references}))
        python = self.root / "inert-python"; python.write_text("never executed")
        model = self.root / "inert-model"; model.mkdir()
        state = {"work_items": {guard.GUARD_WORK: work, guard.PRIOR_WORK: {"receipts": prior}, guard.TRIAL_WORK: {
            "status": "active", "claim": {"owned": True}, "spec": {"task_targets": [{"task_id": "run-approved-fine-tuning", "coverage": "task-outcome"}]}}}}
        def inert_child(root, command):
            self.assertEqual(command["argv"], ["node", "--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", "--", guard.RUNNER])
            directory = root / ".local-codex/headless-training-feature"; directory.mkdir()
            row = {"schema": "bounded-training-feature-diagnostic-v3", "phase": "complete", "startup": "stop-complete",
                "sourceFactories": 1, "outputFactories": 1, "startCode": None, "workerRetirementConfirmed": True,
                "ownerClosureConfirmed": True, "modelQualityTested": False, "interpretation": "diagnostic-only-not-qualification", "terminalStatus": "succeeded", "runtimeErrorCode": None,
                "observations": 1, "progressObservations": 0, "checkpoints": 1, "outputFiles": 2,
                "applicationCleanupConfirmed": True, "newRootRemoved": True}
            (directory / ("9" * 32 + ".json")).write_text(json.dumps(row))
            return {"status": "passed", "exit_code": 0, "duration_ms": 1, "output": {}}
        with patch.object(guard, "ROOT", self.root), patch.object(guard, "PRIOR", references), \
                patch.object(guard, "snapshot", return_value={"source_digest": self.source}), \
                patch.object(guard, "Records") as records, patch.object(guard, "Work") as owner, \
                patch.object(guard, "execute", side_effect=inert_child) as execute, \
                patch.object(guard.shutil, "disk_usage", return_value=SimpleNamespace(free=1024**3)), \
                patch.dict(os.environ, {"ASB_HEADLESS_TRAINING_TEST_PYTHON": str(python), "ASB_HEADLESS_TRAINING_TEST_INPUT": str(model)}), \
                redirect_stdout(io.StringIO()):
            records.return_value.load.return_value = state
            owner.return_value.current_receipt.return_value = receipt
            owner.return_value.context.return_value = ({"source_digest": self.source}, {"selected": [{"id": "headless-training-bounded-feature"}]})
            self.assertEqual(guard.main(), 0)
            self.assertEqual(guard.main(), 1)
        execute.assert_called_once()
        result = json.loads((self.directory / "result.json").read_text())
        self.assertEqual(result["status"], "passed"); self.assertEqual(result["prior_released_bytes"], 0)
        self.assertFalse(result["model_quality_tested"])

    def test_only_new_closed_diagnostics_are_disclosed_and_raw_fields_deny(self):
        directory = self.root / ".local-codex/headless-training-feature"; directory.mkdir()
        old = "1" * 32 + ".json"; (directory / old).write_text("not read")
        row = {"schema": "bounded-training-feature-diagnostic-v3", "phase": "approved-start", "startup": "health-ready",
            "sourceFactories": 1, "outputFactories": 1, "startCode": "headless.not-started",
            "workerRetirementConfirmed": False, "ownerClosureConfirmed": False, "modelQualityTested": False,
            "interpretation": "diagnostic-only-not-qualification", "terminalStatus": "succeeded", "runtimeErrorCode": None,
                "observations": 1, "progressObservations": 0, "checkpoints": 1, "outputFiles": 2,
                "applicationCleanupConfirmed": True, "newRootRemoved": True}
        target = directory / ("2" * 32 + ".json"); target.write_text(json.dumps(row))
        self.assertEqual(guard.new_diagnostic(self.root, {old}), row)
        target.write_text(json.dumps({**row, "raw_error": "synthetic protected text"}))
        with self.assertRaises(guard.AdmissionError): guard.new_diagnostic(self.root, {old})

    def test_every_declared_start_failure_is_preserved_but_never_qualifies(self):
        authoring = (REPO / catalog.TRAINING_FRESH_DIAGNOSTIC_PRODUCERS[0]).read_text(encoding="utf8")
        steps = (REPO / catalog.TRAINING_FRESH_DIAGNOSTIC_PRODUCERS[1]).read_text(encoding="utf8")
        literals = re.search(r"const\s+authoringFailures\s*=\s*new\s+Set\(\s*\[(.*?)\]\s*as\s+const\s*\)", authoring, re.S)
        self.assertIsNotNone(literals)
        step_type = steps.split("export type HeadlessPlanStepResult =", 1)[1].split("const invalid", 1)[0]
        declared = set(re.findall(r'"(headless\.[a-z-]+)"', literals[1] + step_type))
        self.assertEqual(guard.START_FAILURE_CODES, declared); self.assertEqual(len(declared), 12)
        directory = self.root / ".local-codex/headless-training-feature"; directory.mkdir()
        target = directory / ("3" * 32 + ".json")
        row = {"schema": "bounded-training-feature-diagnostic-v3", "phase": "complete", "startup": "stop-complete",
            "sourceFactories": 1, "outputFactories": 1, "startCode": None,
            "workerRetirementConfirmed": True, "ownerClosureConfirmed": True, "modelQualityTested": False,
            "interpretation": "diagnostic-only-not-qualification", "terminalStatus": "succeeded", "runtimeErrorCode": None,
                "observations": 1, "progressObservations": 0, "checkpoints": 1, "outputFiles": 2,
                "applicationCleanupConfirmed": True, "newRootRemoved": True}
        for code in sorted(declared):
            with self.subTest(code=code):
                target.write_text(json.dumps({**row, "startCode": code}))
                diagnostic = guard.new_diagnostic(self.root, set())
                self.assertEqual(diagnostic["startCode"], code)
                self.assertFalse(guard.qualified_result({"status": "passed"}, True, diagnostic))
        target.write_text(json.dumps(row)); good = guard.new_diagnostic(self.root, set())
        self.assertTrue(guard.qualified_result({"status": "passed"}, True, good))
        self.assertFalse(guard.qualified_result({"status": "failed"}, True, good))
        self.assertFalse(guard.qualified_result({"status": "passed"}, False, good))
        target.write_text(json.dumps({**row, "startCode": "headless.synthetic-private-error"}))
        with self.assertRaises(guard.AdmissionError): guard.new_diagnostic(self.root, set())

    def test_final_cleanup_and_current_checkpoint_facts_are_required(self):
        directory = self.root / ".local-codex/headless-training-feature"; directory.mkdir()
        target = directory / ("4" * 32 + ".json")
        row = {"schema": "bounded-training-feature-diagnostic-v3", "phase": "complete", "startup": "stop-complete",
            "sourceFactories": 1, "outputFactories": 1, "startCode": None, "workerRetirementConfirmed": True,
            "ownerClosureConfirmed": True, "modelQualityTested": False, "interpretation": "diagnostic-only-not-qualification",
            "terminalStatus": "succeeded", "runtimeErrorCode": None, "observations": 1, "progressObservations": 0,
            "checkpoints": 1, "outputFiles": 2, "applicationCleanupConfirmed": True, "newRootRemoved": True}
        for patch_row in ({"newRootRemoved": False}, {"applicationCleanupConfirmed": False}, {"checkpoints": 0},
                {"terminalStatus": "failed"}, {"runtimeErrorCode": "private_training_failed"}):
            target.write_text(json.dumps({**row, **patch_row}))
            self.assertFalse(guard.qualified_result({"status": "passed"}, True, guard.new_diagnostic(self.root, set())))
        for patch_row in ({"runtimeErrorCode": "private text"}, {"terminalStatus": "private text"},
                {"progressObservations": 2}, {"outputFiles": 33}, {"newRootRemoved": 1}):
            target.write_text(json.dumps({**row, **patch_row}))
            with self.assertRaises(guard.AdmissionError): guard.new_diagnostic(self.root, set())


class FreshTinyRoutingTests(unittest.TestCase):
    def select(self, paths, required=("architecture",)):
        return {c["id"]: c for c in catalog.plan(REPO, list(paths), list(required), "a" * 64)["selected"]}

    def test_source_changes_select_inert_guards_and_types_but_never_the_real_trial(self):
        for name in (catalog.TRAINING_FRESH_GUARD, catalog.TRAINING_FRESH_GUARD_TEST, catalog.TRAINING_BOUNDED_FEATURE):
            rows = self.select([name]); self.assertIn("headless-training-fresh-trial-guard-unit", rows)
            self.assertNotIn("headless-training-bounded-feature", rows); self.assertNotIn("focused-tests", rows)
        selected = self.select([catalog.TRAINING_BOUNDED_FEATURE], ("headless-training-bounded-feature",))
        self.assertEqual(selected["headless-training-bounded-feature"]["argv"], [sys.executable, "-B", catalog.TRAINING_FRESH_GUARD])
        self.assertEqual(selected["headless-training-bounded-feature"]["timeout"], 900)

    def test_only_closed_known_available_scope_narrows_controller_coverage(self):
        scope = catalog.TRAINING_FRESH_GUARD_SCOPE
        rows = self.select(scope); self.assertNotIn("focused-tests", rows); self.assertIn("-k", rows["control-plane"]["argv"])
        without_catalog = [name for name in scope if name != "dev-tools/helpers/control_plane/catalog.py"]
        self.assertIn("-k", self.select(without_catalog)["control-plane"]["argv"])
        self.assertEqual(self.select([catalog.TRAINING_FRESH_GUARD, catalog.TRAINING_FRESH_GUARD_TEST])["control-plane"]["argv"].count("-k"), 2)
        for paths, required in (([*scope, "modules/hosts/unknown.ts"], ("architecture",)), (scope, ("focused-tests",))):
            rows = self.select(paths, required); self.assertIn("focused-tests", rows); self.assertNotIn("-k", rows["control-plane"]["argv"])
        with patch.object(catalog, "_automatic_files_available", return_value=False):
            rows = self.select(scope); self.assertNotIn("-k", rows["control-plane"]["argv"]); self.assertIn("focused-tests", rows)
        original = catalog._automatic_files_available
        for missing in catalog.TRAINING_FRESH_DIAGNOSTIC_PRODUCERS:
            with patch.object(catalog, "_automatic_files_available", side_effect=lambda root, check: False if missing in check.get("automatic_required_files", ()) else original(root, check)):
                rows = self.select(scope); self.assertNotIn("-k", rows["control-plane"]["argv"])
                self.assertNotIn("headless-training-fresh-trial-guard-unit", rows)


if __name__ == "__main__": unittest.main()
