"""Private Model review coverage must be exact and must preserve shared fallback."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelReviewBindingRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/adapters/persistence/system-builder/headlessModelDownloadReviewBindings.ts"
    test = "modules/adapters/persistence/system-builder/tests/structured-headless-model-download-review.unit.test.ts"
    shared = ["modules/adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository.ts",
              "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore.ts",
              "modules/adapters/persistence/system-builder/README.md"]

    def selected(self, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_binding_source_or_test_selects_both_focused_profiles(self):
        for path in (self.source, self.test):
            rows = self.selected([path])
            for key in ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types"):
                self.assertIn(self.test, rows[key]["argv"])
            self.assertIn("modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
                          rows["headless-model-metadata-owner-unit"]["argv"])
            self.assertNotIn("focused-tests", rows)
            self.assertNotIn("completion-all", rows)

    def test_shared_review_files_do_not_automatically_borrow_model_coverage(self):
        for path in self.shared:
            self.assertNotIn("headless-model-metadata-owner-unit", self.selected([path]))

    def test_explicit_exact_closure_and_unknown_fallback_remain(self):
        required = ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types", "headless-context-pack-contract")
        rows = self.selected([self.source, self.test, *self.shared], required)
        self.assertTrue(set(required).issubset(rows))
        self.assertNotIn("focused-tests", rows)
        self.assertIn("focused-tests", self.selected([self.source], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.source, "modules/adapters/persistence/system-builder/unknown-model-review.ts"]))


if __name__ == "__main__":
    unittest.main()
