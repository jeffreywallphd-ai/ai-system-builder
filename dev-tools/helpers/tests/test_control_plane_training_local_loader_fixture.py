"""Execute the actual inert Tiny-loader fixture assertions; no model/native run."""
import unittest
import json
import tempfile
from pathlib import Path
import test_control_plane_model_training_worker as training_worker_routing


class TrainingLocalLoaderFixtureRoutingTests(training_worker_routing.ModelTrainingWorkerRoutingTests):
    source = "dev-tools/scripts/qualification/visual-composer/training-qualification-worker.py"
    test = "dev-tools/scripts/qualification/tests/test_training_qualification_worker.py"
    unit = "training-local-loader-fixture-unit"
    other_source = training_worker_routing.ModelTrainingWorkerRoutingTests.source
    minimum_cases = 56

    def test_missing_or_nonregular_worker_inputs_cannot_suppress_generic_coverage(self):
        # The inherited fixture used module paths. These developer-script paths
        # also select an existing source-owned operational profile when missing;
        # supply its real bounded config so that fallback can be inspected.
        with tempfile.TemporaryDirectory(prefix="training-fixture-presence-") as directory:
            root = Path(directory)
            config = root / "dev-tools/config/contributor-check-profiles.json"
            policy = json.loads((self.root / "dev-tools/config/contributor-check-profiles.json").read_text(encoding="utf-8"))
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({"schema_version": policy["schema_version"],
                                          "profiles": {"operational-ui": policy["profiles"]["operational-ui"]}}))
            for name in [self.source, self.test, self.helper]:
                selected = self.selected([self.source, self.test], root=root)
                self.assertNotIn(self.unit, selected)
                self.assertIn("operational-ui", selected)
                self.assertIn("focused-tests", self.selected([self.source, self.test], ("focused-tests",), root=root))
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.mkdir()
                self.assertNotIn(self.unit, self.selected([self.source, self.test], root=root))
                target.rmdir()
                target.write_text("# Synthetic presence only, not execution evidence.\n")
            selected = self.selected([self.source, self.test], root=root)
            self.assertIn(self.unit, selected)
            self.assertNotIn("operational-ui", selected)

    def test_exact_fixture_scope_avoids_unrelated_operational_checks(self):
        self.assertNotIn("operational-ui", self.selected([self.source, self.test]))
        self.assertIn("operational-ui", self.selected([self.source], ("operational-ui",)))

    def test_another_operational_source_keeps_its_existing_profile(self):
        other = "dev-tools/scripts/qualification/visual-composer/training-host-global-setup.mjs"
        self.assertIn("operational-ui", self.selected([self.source, self.test, other]))

    def test_developer_readme_borrows_only_a_selected_fixture_profile(self):
        readme = "dev-tools/README.md"
        self.assertNotIn("focused-tests", self.selected([self.source, self.test, readme]))
        self.assertNotIn(self.unit, self.selected([readme]))
        self.assertIn("focused-tests", self.selected([self.source, readme], ("focused-tests",)))


if __name__ == "__main__":
    unittest.main()
