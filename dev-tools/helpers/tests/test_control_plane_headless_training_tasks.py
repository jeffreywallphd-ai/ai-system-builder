"""Execute actual private training controls; retain missing-input fallback."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingTaskControlsRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    host_test = "modules/hosts/shared/composition/tests/headless-model-training-tasks.unit.test.ts"
    codec_test = "modules/contracts/headless/tests/headless-model-training-task.unit.test.ts"
    unit = "headless-training-task-controls-unit"
    types = "headless-training-task-controls-types"

    def select(self, paths, root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, paths, ["architecture"], "a" * 64)["selected"]}

    def test_exact_new_fixtures_select_actual_contract_host_application_and_strict_consumers(self):
        rows = self.select([self.host_test, self.codec_test])
        self.assertIn(self.unit, rows); self.assertIn(self.types, rows)
        for path in (self.host_test, self.codec_test, "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts"):
            self.assertIn(path, rows[self.unit]["argv"])
            self.assertIn(path, rows[self.types]["argv"])
        self.assertIn("--strict", rows[self.types]["argv"])
        for name in ("focused-tests", "completion-all", "completion-standardande2e"):
            self.assertNotIn(name, rows)
        self.assertFalse(any("model-blocker" in arg or "test:all" in arg for row in rows.values() for arg in row["argv"]))

    def test_missing_required_host_fixture_cannot_borrow_contract_fixture_coverage(self):
        boundary = Path(tempfile.gettempdir()).resolve()
        directory = Path(tempfile.mkdtemp(prefix="ttctrl-", dir=boundary)).resolve(); before = directory.stat()
        try:
            for relative in catalog.PUBLISHED_FORM_CHECKS[self.unit]["automatic_required_files"]:
                target = directory / relative; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((self.root / relative).read_bytes())
            (directory / self.host_test).unlink()
            rows = self.select([self.codec_test], directory)
            self.assertNotIn(self.unit, rows); self.assertNotIn(self.types, rows)
            self.assertIn("focused-tests", rows)
        finally:
            after = directory.lstat()
            if (directory.parent != boundary or directory.is_symlink() or directory.resolve() != directory or
                    (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)):
                raise RuntimeError("Owned training-control fixture changed; cleanup refused.")
            shutil.rmtree(directory)

    def test_registered_fixed_commands_execute_real_assertions_and_strict_consumers(self):
        rows = self.select([self.host_test, self.codec_test])
        env = dict(os.environ); env.pop("NODE_TEST_CONTEXT", None)
        for name in (self.unit, self.types):
            with self.subTest(profile=name):
                result = subprocess.run(rows[name]["argv"], cwd=self.root, env=env, text=True, capture_output=True, timeout=90)
                self.assertEqual(result.returncode, 0, result.stdout[-8000:] + result.stderr[-2000:])
                if name == self.unit:
                    counts = {key: int(value) for key, value in re.findall(r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", result.stdout, re.MULTILINE)}
                    self.assertGreaterEqual(counts.get("tests", 0), 55); self.assertEqual(counts.get("tests"), counts.get("pass"))
                    for key in ("fail", "cancelled", "skipped", "todo"): self.assertEqual(counts.get(key), 0)
                    for title in ("Core: original training book", "SQLite: original training book", "book cancellation remains one original effect",
                                  "book captures original callback receivers", "training summary permits finite workflow facts"):
                        self.assertIn(title, result.stdout)


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


if __name__ == "__main__": unittest.main()
