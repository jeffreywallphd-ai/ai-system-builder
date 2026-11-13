"""Keep the delegated provider check exact and retain fallback for other host changes."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog


class HeadlessReadRoutingTests(unittest.TestCase):
    def plan(self, paths, *required):
        return {row["id"]: row for row in catalog.plan(HELPERS.parents[1], paths, ["architecture", *required], "a" * 64)["selected"]}

    def test_owned_provider_and_contract_use_the_exact_check(self):
        host_test = "modules/hosts/desktop/composition/tests/desktop-headless-reads.unit.test.ts"
        checks = self.plan([host_test, "modules/hosts/desktop/composition/composeDesktopHeadlessReads.ts"])
        self.assertEqual(set(checks), {"headless-desktop-read-provider", "architecture"})
        self.assertEqual(checks["headless-desktop-read-provider"]["argv"], [
            "node", "--import", "tsx", "--test", "--", host_test,
            "modules/contracts/headless/tests/headless-read-request.unit.test.ts",
        ])

    def test_broad_composition_and_unrelated_changes_keep_existing_tests(self):
        other = "modules/hosts/desktop/composition/composeDesktopArtifactFeature.ts"
        check = "headless-desktop-read-provider"
        auto = "modules/hosts/desktop/composition/composeDesktopHeadlessReads.ts"
        self.assertNotIn(check, self.plan([other]))
        for root in ("modules/hosts/desktop/composition/composeDesktopHost.ts",
                     "modules/hosts/shared/composition/composeSystemBuilder.ts"):
            with self.subTest(root=root):
                self.assertIn("focused-tests", self.plan([root]))
                self.assertIn(check, self.plan([root, auto]))
                self.assertIn("focused-tests", self.plan([root, auto]))
                self.assertNotIn("focused-tests", self.plan([root, auto], check))
                self.assertIn("focused-tests", self.plan([other, root, auto], check))

    def test_activation_keeps_generic_for_broad_or_unrelated_desktop_changes_without_opt_in(self):
        check = "headless-desktop-activation"
        activation = "apps/desktop/src/main/desktopHeadlessPairingIpc.ts"
        main = "apps/desktop/src/main/index.ts"
        other = "apps/desktop/src/main/revealModelPath.ts"
        self.assertEqual(set(self.plan([activation])), {check, "architecture"})
        self.assertIn("focused-tests", self.plan([activation, main]))
        self.assertIn("focused-tests", self.plan([activation, main], "headless-desktop-read-provider"))
        self.assertNotIn("focused-tests", self.plan([activation, main], check))
        self.assertIn("focused-tests", self.plan([activation, main, other], check))

    def test_mcp_checks_are_exact_and_preserve_other_transport_coverage(self):
        mcp = "modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts"
        self.assertEqual(set(self.plan([mcp])), {"architecture", "headless-desktop-pinned-mcp"})
        other = "modules/adapters/transport/headless-loopback/other-source.ts"
        self.assertIn("focused-tests", self.plan([mcp, other], "headless-desktop-activation"))
        barrel = "modules/contracts/headless/index.ts"
        self.assertIn("focused-tests", self.plan([mcp, barrel]))
        self.assertNotIn("focused-tests", self.plan([mcp, barrel], "headless-desktop-activation"))
