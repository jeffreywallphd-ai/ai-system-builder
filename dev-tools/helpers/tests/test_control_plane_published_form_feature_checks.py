"""Keep form feature verification bounded to the files named by the check."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane.catalog import plan


ROOT = Path(__file__).resolve().parents[3]
DESKTOP = "published-form-desktop-bridge"
EDITOR = "published-form-editor-interactions"
BROWSER = "published-form-browser-client"
BROWSER_PAGE = "apps/thin-client/src/pages/SystemBuilderPage.tsx"
HOST = "published-form-host-composition"
HOST_REGISTRATION = "published-form-host-registration"
PRELOAD = "apps/desktop/src/preload/exposedApi.ts"
FORM_VIEW = "modules/ui/shared/system-builder/SystemFormComposerView.tsx"
DESKTOP_HOST = "modules/hosts/desktop/composition/composeDesktopHost.ts"
SERVER_HOST = "modules/hosts/server/composition/composeServerHost.ts"
UNRELATED = "apps/desktop/src/renderer/features/image-generation/Unrelated.tsx"
BRIDGE_TEST = "apps/desktop/src/preload/tests/publishedSystemFormBridge.unit.test.ts"
BUILD_TEST = "apps/desktop/tests/desktop-webpack-tsconfig.unit.test.ts"
REGISTRATION_TESTS = [
    "modules/hosts/desktop/composition/tests/published-form-host-registration.unit.test.ts",
    "modules/hosts/server/composition/tests/published-form-host-registration.unit.test.ts",
]


def chosen(paths, required):
    return {check["id"]: check for check in plan(ROOT, paths, required, "candidate")["selected"]}


class PublishedFormFeatureChecksTest(unittest.TestCase):
    def test_desktop_opt_in_runs_bridge_and_actual_desktop_target(self):
        selected = chosen([PRELOAD, FORM_VIEW], [DESKTOP, EDITOR])
        self.assertNotIn("focused-tests", selected)
        self.assertEqual(selected[DESKTOP]["argv"][-2:], [BRIDGE_TEST, BUILD_TEST])
        self.assertTrue(selected[EDITOR]["argv"][-1].endswith("SystemBuilderWorkspace.interaction.ui.test.tsx"))
        self.assertNotIn(HOST, selected)
        self.assertNotIn(BROWSER, selected)
        self.assertNotIn("completion-standardande2e", selected)
        self.assertNotIn("completion-all", selected)

    def test_generic_coverage_is_preserved_for_unowned_and_explicit_paths(self):
        selected = chosen([PRELOAD], ["architecture"])
        self.assertIn("focused-tests", selected)
        self.assertNotIn(DESKTOP, selected)
        self.assertIn("focused-tests", chosen([PRELOAD, UNRELATED], [DESKTOP]))
        self.assertIn("focused-tests", chosen([PRELOAD, FORM_VIEW], [DESKTOP]))
        self.assertIn("focused-tests", chosen([PRELOAD], [DESKTOP, "focused-tests"]))

    def test_browser_and_host_require_their_own_exact_checks(self):
        browser = "apps/thin-client/src/features/system-builder/api/thinClientSystemPublishedFormClient.ts"
        host = "modules/hosts/shared/composition/composePublishedSystemForms.ts"
        selected = chosen([browser, host], [BROWSER, HOST])
        self.assertNotIn("focused-tests", selected)
        self.assertTrue(selected[BROWSER]["argv"][-1].endswith("thinClientSystemPublishedFormClient.unit.test.ts"))
        self.assertTrue(selected[HOST]["argv"][-1].endswith("submit-released-system-form.use-case.unit.test.ts"))
        self.assertIn("focused-tests", chosen([browser, host], [BROWSER]))
        self.assertIn("focused-tests", chosen([DESKTOP_HOST, host], [HOST]))
        self.assertIn("focused-tests", chosen([SERVER_HOST, host], [HOST]))
        self.assertNotIn("focused-tests", chosen([browser, BROWSER_PAGE], [BROWSER]))
        self.assertIn("focused-tests", chosen([browser, BROWSER_PAGE, "apps/thin-client/src/pages/UnrelatedPage.tsx"], [BROWSER]))

    def test_host_roots_need_actual_registration_coverage(self):
        selected = chosen([DESKTOP_HOST, SERVER_HOST, *REGISTRATION_TESTS], [HOST_REGISTRATION])
        self.assertNotIn("focused-tests", selected)
        self.assertEqual(selected[HOST_REGISTRATION]["argv"][-2:], REGISTRATION_TESTS)
        self.assertNotIn(HOST, selected)
        self.assertNotIn(HOST_REGISTRATION, chosen([DESKTOP_HOST], ["architecture"]))
        self.assertIn("focused-tests", chosen([DESKTOP_HOST, UNRELATED], [HOST_REGISTRATION]))


if __name__ == "__main__":
    unittest.main()
