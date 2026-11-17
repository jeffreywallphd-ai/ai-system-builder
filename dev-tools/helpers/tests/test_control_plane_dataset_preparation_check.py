"""Explicit Dataset Preparation checks must not change default test selection."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
from control_plane.contracts import ControlError
from run_focused_checks import _commands_for_snapshot

ROOT = HELPERS.parents[1]
CHECK = "dataset-preparation-core-unit"
WORKER = "modules/adapters/runtime/python/worker/"
DRIVER = WORKER + "tasks/prepare_training_dataset.py"
TEST = WORKER + "tests/test_prepare_training_dataset_task.py"


class DatasetPreparationCheckTests(unittest.TestCase):
    def plan(self, paths, required):
        plan = catalog.plan(ROOT, paths, required, "a" * 64)
        return plan, {row["id"]: row for row in plan["selected"]}

    def test_default_driver_check_is_unchanged(self):
        plan, checks = self.plan([DRIVER, TEST], ["architecture"])
        self.assertEqual(set(checks), {"architecture", "focused-tests"})
        self.assertNotIn(CHECK, plan["coverage"][DRIVER])

    def test_explicit_check_owns_only_the_driver_and_exact_test(self):
        plan, checks = self.plan([DRIVER, TEST], [CHECK])
        self.assertEqual(set(checks), {"architecture", CHECK})
        self.assertIn(CHECK, plan["coverage"][DRIVER])
        self.assertIn(CHECK, plan["coverage"][TEST])
        self.assertEqual(checks[CHECK]["argv"], [sys.executable, "-B",
            "dev-tools/helpers/run_focused_checks.py", "--regression-test", TEST])
        files = {TEST: "fixture", WORKER + "tests/test_semantic_curation.py": "other"}
        self.assertEqual(_commands_for_snapshot(ROOT, [TEST], files, exact=True), [[
            sys.executable, "-B", "-m", "unittest", "discover", "-s", WORKER + "tests",
            "-p", "test_prepare_training_dataset_task.py",
        ]])

    def test_unknown_sources_and_explicit_generic_checks_keep_fallback(self):
        sibling = WORKER + "tasks/unmapped_dataset_action.py"
        for paths, required in (([DRIVER, sibling], [CHECK]), ([DRIVER], [CHECK, "focused-tests"])):
            with self.subTest(paths=paths, required=required):
                _, checks = self.plan(paths, required)
                self.assertIn("focused-tests", checks)
                self.assertIn(CHECK, checks)

    def test_missing_exact_worker_test_fails_closed(self):
        with self.assertRaises(ControlError):
            _commands_for_snapshot(ROOT, [TEST], {DRIVER: "fixture"}, exact=True)


if __name__ == "__main__":
    unittest.main()
