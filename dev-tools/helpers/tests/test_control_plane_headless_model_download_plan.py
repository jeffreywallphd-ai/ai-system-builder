"""Exact Model plan/approval work gets focused checks; shared files retain fallback."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog

class ModelDownloadPlanRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    exact = [
        "modules/contracts/headless/headless-model-download-plan.ts",
        "modules/contracts/headless/tests/headless-model-download-plan.unit.test.ts",
        "modules/application/use-cases/model/headless-model-download-preview.use-case.ts",
        "modules/application/use-cases/model/tests/headless-model-download-preview.unit.test.ts",
        "modules/ui/shared/headless/tests/HeadlessModelDownloadApproval.interaction.ui.test.tsx"
]
    borrowed = [
        "modules/ui/shared/headless/HeadlessPlanApprovalDialog.tsx",
        "modules/ui/README.md",
        "modules/hosts/shared/composition/headlessPlanReview.ts",
        "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
        "modules/contracts/headless/managed-browser-plan-approval.ts"
]

    def selected(self, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(self.root, paths, list(required), "c" * 64)["selected"]}

    def test_exact_new_components_select_model_unit_types_and_all_three_feature_tests(self):
        for path in self.exact:
            rows = self.selected([path])
            for key in ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types"):
                self.assertIn(key, rows)
                for target in (self.exact[1], self.exact[3], self.exact[4]):
                    self.assertIn(target, rows[key]["argv"])
            self.assertNotIn("focused-tests", rows)
            self.assertNotIn("completion-all", rows)

    def test_borrowed_shared_files_do_not_automatically_borrow_model_coverage(self):
        for path in self.borrowed:
            rows = self.selected([path])
            self.assertNotIn("headless-model-metadata-owner-unit", rows)
            self.assertIn("focused-tests", self.selected([path, "modules/ui/shared/headless/unknown-model-plan.tsx"]))

    def test_explicit_scoped_closure_keeps_related_context_browser_and_unknown_fallback(self):
        required = ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types",
                    "headless-context-pack-contract", "headless-context-pack-browser")
        rows = self.selected(self.exact + self.borrowed, required)
        self.assertNotIn("focused-tests", rows)
        self.assertTrue(set(required).issubset(rows))
        self.assertIn("focused-tests", self.selected(self.exact, ("focused-tests",)))
        self.assertIn("focused-tests", self.selected(self.exact + ["modules/ui/shared/headless/unknown-model-plan.tsx"]))

if __name__ == "__main__":
    unittest.main()
