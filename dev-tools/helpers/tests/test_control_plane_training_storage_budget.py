"""Exact budget accounting scope runs its feature and transaction neighbors."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog, execution


class TrainingStorageBudgetRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]

    def plan(self, paths, required=("focused-tests", "architecture")):
        return {row["id"]: row for row in catalog.plan(self.root, list(paths), list(required), "synthetic-budget-routing")["selected"]}

    def test_exact_feature_and_related_transactions_execute_with_types_and_scoped_controller(self):
        checks = self.plan(catalog.TRAINING_STORAGE_BUDGET_SCOPE)
        self.assertEqual(checks["focused-tests"]["argv"], ["node", "--import", "tsx", catalog.TRAINING_STORAGE_BUDGET_SCOPE[5]])
        self.assertEqual(checks["headless-training-storage-budget-neighbors"]["argv"],
            ["node", "--import", "tsx", "--test", "--test-concurrency=1", "--", *catalog.TRAINING_STORAGE_BUDGET_NEIGHBORS])
        self.assertIn("headless-training-storage-budget-types", checks)
        self.assertIn("test_control_plane_training_storage_budget.", checks["control-plane"]["argv"])
        self.assertIn("test_control_plane_focused.", checks["control-plane"]["argv"])
        self.assertIn("architecture", checks)
        self.assertIn("documentation", checks)
        self.assertIn("agent-support", checks)

    def test_owned_feature_subsets_use_the_same_complete_suite(self):
        for name in catalog.TRAINING_STORAGE_BUDGET_CORE:
            with self.subTest(source=name):
                checks = self.plan([name])
                self.assertIn(catalog.TRAINING_STORAGE_BUDGET_SCOPE[5], checks["focused-tests"]["argv"])
                self.assertIn("headless-training-storage-budget-types", checks)

    def test_unknown_mixed_shared_only_and_missing_support_keep_generic_fallback(self):
        for paths in ([*catalog.TRAINING_STORAGE_BUDGET_SCOPE, "docs/unrelated.md"],
                      [catalog.TRAINING_STORAGE_BUDGET_SCOPE[1]],
                      [catalog.TRAINING_STORAGE_BUDGET_SCOPE[9]], []):
            with self.subTest(paths=paths):
                checks = self.plan(paths)
                self.assertIn("dev-tools/helpers/run_focused_checks.py", checks["focused-tests"]["argv"])
        original = catalog._automatic_files_available
        for missing in catalog.TRAINING_STORAGE_BUDGET_SCOPE + catalog.TRAINING_STORAGE_BUDGET_NEIGHBORS:
            def unavailable(root, check):
                return False if missing in check.get("automatic_required_files", ()) else original(root, check)
            with self.subTest(missing=missing), patch.object(catalog, "_automatic_files_available", side_effect=unavailable):
                checks = self.plan(catalog.TRAINING_STORAGE_BUDGET_SCOPE)
                self.assertIn("dev-tools/helpers/run_focused_checks.py", checks["focused-tests"]["argv"])
                self.assertNotIn("-k", checks["control-plane"]["argv"])

    def test_explicit_general_controller_request_remains_general(self):
        checks = self.plan(catalog.TRAINING_STORAGE_BUDGET_SCOPE, ("focused-tests", "control-plane", "architecture"))
        self.assertNotIn("-k", checks["control-plane"]["argv"])
        self.assertEqual(checks["control-plane"]["timeout"], 600)

    def test_actual_executor_preserves_the_fixed_program_boundary_for_affected_metadata(self):
        check = self.plan(catalog.TRAINING_STORAGE_BUDGET_SCOPE)["focused-tests"]
        result = execution.execute(self.root, check, paths=list(catalog.TRAINING_STORAGE_BUDGET_SCOPE))
        self.assertEqual(result["status"], "passed", result)
        self.assertGreater(result["output"]["stdout"]["bytes"], 500)

    def test_actual_direct_node_test_failure_cannot_report_success(self):
        # Fixed synthetic node:test failure, no supplied command or payload.
        check = {"id": "focused-tests", "argv": ["node", "-e",
            "require('node:test')('synthetic failing pipeline',()=>{throw new Error('synthetic expected failure')})", "--"], "timeout": 15}
        result = execution.execute(self.root, check, paths=["docs/synthetic.md", "dev-tools/synthetic.py"])
        self.assertEqual(result["status"], "failed", result)
        self.assertNotEqual(result["exit_code"], 0)
        self.assertEqual(result["failure_diagnostics"]["failed_tests"], 1)


if __name__ == "__main__": unittest.main()
