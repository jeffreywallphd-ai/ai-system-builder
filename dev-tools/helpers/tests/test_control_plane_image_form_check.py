"""A form change selects its exact regression without hiding other test impact."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
from control_plane.contracts import ControlError
from run_focused_checks import _commands_for_snapshot

ROOT = HELPERS.parents[1]
THIN_FORM = "apps/thin-client/src/features/image-generation/components/ImageGenerationFeature.tsx"
THIN_TEST = "apps/thin-client/src/features/image-generation/tests/image-generation-feature.unit.test.tsx"
DESKTOP_FORM = "apps/desktop/src/renderer/features/image-generation/components/ImageGenerationForm.tsx"
DESKTOP_TEST = "apps/desktop/src/renderer/features/image-generation/tests/image-generation-feature.unit.test.tsx"


class ImageFormCheckTests(unittest.TestCase):
    def selected(self, paths, required):
        return {item["id"]: item for item in catalog.plan(ROOT, paths, required, "a" * 64)["selected"]}

    def test_each_host_uses_only_its_exact_component_test(self):
        for check, form, test in (
            ("thin-image-form-ui", THIN_FORM, THIN_TEST),
            ("desktop-image-form-ui", DESKTOP_FORM, DESKTOP_TEST),
        ):
            with self.subTest(check=check):
                selected = self.selected([form, test], ["architecture"])
                self.assertEqual(set(selected), {"architecture", check})
                self.assertEqual(selected[check]["argv"], [sys.executable, "-B",
                    "dev-tools/helpers/run_focused_checks.py", "--regression-test", test])
                files = {THIN_TEST: "thin", DESKTOP_TEST: "desktop"}
                self.assertEqual(_commands_for_snapshot(ROOT, [test], files, exact=True),
                    [["node", "dev-tools/helpers/run_vitest_checks.mjs", "--", test]])

    def test_related_readme_retains_its_own_checks(self):
        selected = self.selected([THIN_FORM, THIN_TEST, "apps/thin-client/README.md"], ["documentation"])
        self.assertEqual(set(selected), {"architecture", "documentation", "security-status-ui", "thin-image-form-ui"})

    def test_unrelated_paths_keep_generic_coverage(self):
        sibling = THIN_FORM.replace("ImageGenerationFeature.tsx", "UnmappedForm.tsx")
        only_sibling = self.selected([sibling], ["architecture"])
        self.assertIn("focused-tests", only_sibling)
        self.assertNotIn("thin-image-form-ui", only_sibling)
        both = self.selected([THIN_FORM, sibling], ["thin-image-form-ui"])
        self.assertIn("focused-tests", both)

    def test_explicit_generic_check_is_not_removed(self):
        selected = self.selected([DESKTOP_FORM, DESKTOP_TEST], ["focused-tests"])
        self.assertIn("desktop-image-form-ui", selected)
        self.assertIn("focused-tests", selected)

    def test_missing_exact_test_fails_instead_of_passing_empty(self):
        with self.assertRaises(ControlError):
            _commands_for_snapshot(ROOT, [THIN_TEST], {DESKTOP_TEST: "desktop"}, exact=True)


if __name__ == "__main__":
    unittest.main()
