"""Keep model file acknowledgement checks inside the model deletion boundary."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
import run_focused_checks

ROOT = HELPERS.parents[1]
PROFILE = "model-file-delete-ack"
SOURCE = "modules/application/use-cases/model/delete-model-record.use-case.ts"
UNIT = "modules/application/use-cases/model/tests/delete-model-record.use-case.unit.test.ts"
ADAPTER_UNIT = "modules/adapters/model/local/tests/createLocalModelFilesDeleteAdapter.unit.test.ts"
CONFIG = "dev-tools/config/contributor-check-profiles.json"


class ModelFileDeleteAckProfileTests(unittest.TestCase):
    def check_ids(self, paths, required=("architecture",)):
        return {item["id"] for item in catalog.plan(ROOT, paths, required, "synthetic")["selected"]}

    def test_runner_selects_only_model_deletion_units(self):
        self.assertEqual(run_focused_checks.profile_commands(ROOT, PROFILE), [
            ["node", "--import", "tsx", "--test", "--", ADAPTER_UNIT, UNIT],
        ])

    def test_model_deletion_changes_are_covered_without_the_generic_suite(self):
        selected = self.check_ids([SOURCE, UNIT, CONFIG])
        self.assertIn(PROFILE, selected)
        self.assertNotIn("focused-tests", selected)
        self.assertNotIn("security-authority", selected)

    def test_other_sources_and_explicit_generic_requirements_are_preserved(self):
        other = "modules/application/use-cases/model/update-model-record.use-case.ts"
        self.assertNotIn(PROFILE, self.check_ids([other]))
        self.assertIn("focused-tests", self.check_ids([SOURCE, other]))
        self.assertIn("focused-tests", self.check_ids([SOURCE], ("focused-tests",)))


if __name__ == "__main__":
    unittest.main()
