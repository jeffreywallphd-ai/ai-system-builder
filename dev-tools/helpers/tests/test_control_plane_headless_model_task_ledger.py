"""Exact Model task-ledger checks keep both legacy and shared fallback coverage."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelTaskLedgerRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore.ts"
    test = "modules/adapters/persistence/system-builder/tests/structured-headless-model-plan-task-store.unit.test.ts"

    def selected(self, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_sources_select_unit_types_and_original_plan_owner(self):
        for path in (self.source, self.test):
            rows = self.selected([path])
            for key in ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types"):
                self.assertIn(self.test, rows[key]["argv"])
            self.assertIn("modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
                          rows["headless-model-metadata-owner-unit"]["argv"])
            self.assertNotIn("focused-tests", rows)
            self.assertNotIn("completion-all", rows)

    def test_shared_sources_do_not_automatically_borrow_model_coverage(self):
        for path in ("modules/adapters/persistence/system-builder/README.md",
                     "modules/adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore.ts"):
            self.assertNotIn("headless-model-metadata-owner-unit", self.selected([path]))

    def test_exact_required_closure_and_unknown_fallback(self):
        required = ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types", "headless-context-pack-contract")
        self.assertTrue(set(required).issubset(self.selected([self.source, self.test], required)))
        self.assertIn("focused-tests", self.selected([self.source], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.source, "modules/adapters/persistence/system-builder/unknown-model-task.ts"]))


if __name__ == "__main__":
    unittest.main()
