"""Model execution checks keep legacy, shared and unknown impact coverage."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelExecutionRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    exact = ["modules/hosts/shared/composition/headlessModelDownloadExecution.ts",
             "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
             "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts"]
    shared = ["modules/contracts/headless/headless-plan-step-wire.ts", "modules/hosts/README.md",
              "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts"]

    def selected(self, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_execution_sources_select_focused_profiles_and_both_new_tests(self):
        for path in self.exact:
            rows = self.selected([path])
            for key in ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types"):
                for test in self.exact[1:]:
                    self.assertIn(test, rows[key]["argv"])
            self.assertIn("modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
                          rows["headless-model-metadata-owner-unit"]["argv"])
            self.assertNotIn("focused-tests", rows)
            self.assertNotIn("completion-all", rows)

    def test_shared_files_do_not_borrow_automatic_model_execution(self):
        for path in self.shared:
            self.assertNotIn("headless-model-metadata-owner-unit", self.selected([path]))

    def test_owned_task_controls_select_real_owner_fixture_and_strict_companion(self):
        source = "modules/hosts/shared/composition/headlessModelDownloadTasks.ts"
        rows = self.selected([source])
        unit = rows["headless-model-metadata-owner-unit"]["argv"]
        types = rows["headless-model-metadata-owner-types"]["argv"]
        fixture = "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts"
        self.assertIn(fixture, unit)
        self.assertIn(fixture, types)
        self.assertIn(source, types)
        self.assertNotIn("focused-tests", rows)
        self.assertNotIn("completion-all", rows)
        self.assertIn("focused-tests", self.selected([source], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([source, "modules/hosts/shared/composition/unknown-model-control.ts"]))

    def test_explicit_related_closure_and_unknown_fallback(self):
        required = ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types", "headless-context-pack-contract",
                    "headless-data-task-status", "headless-approved-dataset-task-wiring")
        rows = self.selected(self.exact + self.shared, required)
        self.assertTrue(set(required).issubset(rows))
        self.assertNotIn("focused-tests", rows)
        self.assertIn("focused-tests", self.selected(self.exact, ("focused-tests",)))
        self.assertIn("focused-tests", self.selected(self.exact + ["modules/hosts/shared/composition/unknown-model-execution.ts"]))


if __name__ == "__main__":
    unittest.main()
