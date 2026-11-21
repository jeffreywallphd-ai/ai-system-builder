"""Only exact private training Dataset byte sources borrow existing Model checks."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelTrainingDatasetRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/application/use-cases/model/headless-model-training-dataset.use-case.ts"
    test = "modules/application/use-cases/model/tests/headless-model-training-dataset.unit.test.ts"

    def selected(self, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_sources_select_actual_byte_fixtures_and_strict_source_test_types(self):
        for path in [self.source, self.test]:
            selected = self.selected([path])
            unit = selected["headless-model-metadata-owner-unit"]["argv"]
            types = selected["headless-model-metadata-owner-types"]["argv"]
            self.assertIn(self.test, unit)
            self.assertIn(self.source, types)
            self.assertIn(self.test, types)
            self.assertIn("--strict", types)
            self.assertNotIn("focused-tests", selected)
            self.assertNotIn("completion-all", selected)

    def test_explicit_and_unknown_fallback_remain(self):
        self.assertIn("focused-tests", self.selected([self.source], ("focused-tests",)))
        for neighbor in ["modules/application/use-cases/model/unknown-training-dataset.ts",
                         "modules/application/ports/storage/unknown-training-byte-source.ts"]:
            self.assertIn("focused-tests", self.selected([self.source, neighbor]))

    def test_shared_storage_and_ordinary_training_do_not_borrow_private_profile(self):
        for path in ["modules/application/ports/storage/artifact-object-storage.port.ts",
                     "modules/application/use-cases/dataset-version/dataset-version-read.use-cases.ts",
                     "modules/application/use-cases/model/train-model.use-case.ts"]:
            self.assertNotIn("headless-model-metadata-owner-unit", self.selected([path]))


if __name__ == "__main__":
    unittest.main()
