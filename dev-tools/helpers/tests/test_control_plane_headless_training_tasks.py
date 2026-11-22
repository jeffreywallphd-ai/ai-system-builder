"""Exercise private task metadata commands; never start an app, worker or model."""
from pathlib import Path
import os
import re
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingTaskLedgerRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore.ts"
    test = "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-task-store.unit.test.ts"
    old_test = "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts"
    unit = "headless-training-task-ledger-unit"
    types = "headless-training-task-ledger-types"

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "b" * 64)["selected"]}

    def test_exact_owned_sources_select_actual_training_and_related_model_commands(self):
        for path in (self.source, self.test):
            rows = self.selected([path])
            for key in (self.unit, self.types):
                self.assertIn(self.test, rows[key]["argv"])
                self.assertIn(self.old_test, rows[key]["argv"])
            self.assertIn("--strict", rows[self.types]["argv"])
            self.assertNotIn("focused-tests", rows)
            self.assertNotIn("completion-all", rows)
        paired = self.selected([self.source, "modules/adapters/persistence/system-builder/README.md"])
        self.assertIn(self.unit, paired)
        self.assertNotIn("focused-tests", paired)

    def test_shared_unknown_missing_and_explicit_generic_fallback_remain(self):
        self.assertNotIn(self.unit, self.selected(["modules/adapters/persistence/system-builder/README.md"]))
        self.assertNotIn(self.unit, self.selected(["modules/adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository.ts"]))
        self.assertIn("focused-tests", self.selected([self.source], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.source, "modules/adapters/persistence/system-builder/unknown-training-tasks.ts"]))
        required = catalog.PUBLISHED_FORM_CHECKS[self.unit]["automatic_required_files"]
        self.assertLessEqual(len(required), 16)
        for missing in required:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in required:
                    target = root / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("// inert availability fixture\n", encoding="utf8")
                self.assertIn(self.unit, self.selected([self.source], root=root))
                (root / missing).unlink()
                rows = self.selected([self.source], root=root)
                self.assertNotIn(self.unit, rows)
                self.assertIn("focused-tests", rows)

    def test_both_registered_commands_really_execute_owned_metadata_and_strict_types(self):
        rows = self.selected([self.source])
        environment = {**os.environ, "HF_HUB_OFFLINE": "1"}
        environment.pop("NODE_TEST_CONTEXT", None)
        environment.pop("AISB_RUN_FIXED_NATIVE_QUALIFICATION", None)
        for check_id in (self.unit, self.types):
            with self.subTest(check_id=check_id):
                result = subprocess.run(rows[check_id]["argv"], cwd=self.root, env=environment,
                                        capture_output=True, text=True, timeout=120, check=False)
                self.assertLess(len(result.stdout) + len(result.stderr), 2 * 1024 * 1024)
                self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-12000:])
                if check_id == self.unit:
                    counts = {name: int(value) for name, value in re.findall(r"(?m)^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", result.stdout)}
                    self.assertGreaterEqual(counts.get("tests", 0), 31)
                    self.assertEqual(counts.get("tests"), counts.get("pass"))
                    for name in ("fail", "cancelled", "skipped", "todo"):
                        self.assertEqual(counts.get(name), 0)
                    for title in ("Training plan ledger reserves", "accepted exact Model task receipts", "real SQLite reopen",
                                  "isolated binding decoding", "point reads never enumerate"):
                        self.assertIn(title, result.stdout)


if __name__ == "__main__":
    unittest.main()
