"""Exact private training-proposal metadata checks retain shared/unknown fallback."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelTrainingPlanRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    sources = ["modules/contracts/headless/headless-model-training-plan.ts",
               "modules/application/use-cases/model/headless-model-training-plan.use-case.ts",
               "modules/contracts/headless/tests/headless-model-training-plan.unit.test.ts",
               "modules/application/use-cases/model/tests/headless-model-training-plan.unit.test.ts"]

    def selected(self, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_metadata_sources_select_both_real_owner_tests_and_strict_types(self):
        for path in self.sources:
            selected = self.selected([path])
            for key in ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types"):
                for test in self.sources[2:]:
                    self.assertIn(test, selected[key]["argv"])
            for source in self.sources[:2]:
                self.assertIn(source, selected["headless-model-metadata-owner-types"]["argv"])
            self.assertNotIn("focused-tests", selected)
            self.assertNotIn("completion-all", selected)

    def test_explicit_and_unknown_fallback_remain(self):
        self.assertIn("focused-tests", self.selected(self.sources, ("focused-tests",)))
        self.assertIn("focused-tests", self.selected(self.sources + ["modules/application/use-cases/model/unknown-training-proposal.ts"]))
        self.assertIn("focused-tests", self.selected(self.sources + ["modules/contracts/headless/unknown-training-proposal.ts"]))

    def test_shared_metadata_index_and_unrelated_runtime_do_not_borrow_automatic_model_support(self):
        for path in ["modules/contracts/headless/index.ts", "modules/application/ports/runtime/runtime-task-registry.port.ts",
                     "modules/application/use-cases/model/train-model.use-case.ts"]:
            self.assertNotIn("headless-model-metadata-owner-unit", self.selected([path]))


if __name__ == "__main__":
    unittest.main()
