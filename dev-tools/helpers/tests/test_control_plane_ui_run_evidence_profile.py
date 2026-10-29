"""Borrowed report ownership must not weaken unknown or explicit test impact."""
from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_control_plane_operational_ui_profile as operational

catalog = operational.catalog
CONFIG = operational.CONFIG
ROOT = operational.ROOT
V = "dev-tools/scripts/qualification/visual-composer/"
BORROWED = [V + "qualification-reporting.ts", V + "e2e/reference-browse-performance.ts",
            V + "e2e/packaged-desktop-cold-canvas.e2e.spec.ts", V + "e2e/structured-output-controls-journey.ts",
            V + "e2e/thin-client-browse.e2e.spec.ts", CONFIG]
CORE = "dev-tools/scripts/qualification/tests/operational-desktop-case.unit.test.ts"


class UiRunEvidenceProfile(unittest.TestCase):
    @staticmethod
    def profile():
        return json.loads((ROOT / CONFIG).read_bytes())["profiles"]["operational-ui"]

    def test_closed_extension_preserves_prior_members_and_auto_triggers(self):
        profile = self.profile()
        self.assertEqual(len(profile["test_paths"]), 49)
        self.assertEqual(profile["test_paths"][-3:], [
            "dev-tools/scripts/qualification/tests/qualification-reporting.unit.test.ts",
            "dev-tools/scripts/qualification/tests/qualification-report-wiring.unit.test.ts",
            "dev-tools/helpers/tests/test_control_plane_ui_run_evidence_profile.py",
        ])
        self.assertEqual(profile["test_paths"], operational.TESTS)
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]), 22)
        for source in BORROWED:
            self.assertIn(source, profile["source_paths"])
            self.assertNotIn(source, catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"])

    def test_borrowed_sources_need_explicit_or_owned_activation(self):
        with tempfile.TemporaryDirectory(prefix="reporting-profile-") as directory:
            root = Path(directory)
            operational.OperationalUiProfile.fixture(self, root, self.profile())
            for paths, required, selected, generic in [
                (BORROWED, ["operational-ui"], True, False),
                ([BORROWED[0]], ["documentation"], False, True),
                ([CORE, *BORROWED], ["documentation"], True, False),
                ([CORE, *BORROWED], ["focused-tests"], True, True),
                ([CORE, *BORROWED, V + "unknown-report.ts"], ["documentation"], True, True),
            ]:
                with self.subTest(paths=paths, required=required):
                    ids = {check["id"] for check in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertEqual("operational-ui" in ids, selected)
                    self.assertEqual("focused-tests" in ids, generic)

    def test_missing_report_source_coverage_keeps_generic_gate(self):
        for missing in BORROWED:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(prefix="reporting-incomplete-") as directory:
                root = Path(directory)
                profile = self.profile(); profile["source_paths"].remove(missing)
                operational.OperationalUiProfile.fixture(self, root, profile)
                ids = {check["id"] for check in catalog.plan(root, [CORE, *BORROWED], ["documentation"], "synthetic-candidate")["selected"]}
                self.assertIn("operational-ui", ids)
                self.assertIn("focused-tests", ids)


if __name__ == "__main__":
    unittest.main()
