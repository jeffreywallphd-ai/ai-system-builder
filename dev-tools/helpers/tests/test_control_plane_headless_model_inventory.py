"""Public Model integration retains exact feature tests and unknown-owner fallback."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class HeadlessModelInventoryRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    owner = "modules/hosts/shared/composition/headlessModelMetadata.ts"
    test = "modules/hosts/shared/composition/tests/headless-model-metadata.unit.test.ts"

    def selected(self, paths, required=("documentation",)):
        plan = catalog.plan(self.root, paths, list(required), "d" * 64)
        return {row["id"]: row for row in plan["selected"]}

    def test_actual_shared_owner_selects_feature_tests_and_strict_hosts(self):
        selected = self.selected([self.owner])
        self.assertNotIn("focused-tests", selected)
        unit = selected["headless-model-metadata-owner-unit"]["argv"]
        types = selected["headless-model-metadata-owner-types"]["argv"]
        self.assertIn(self.test, unit)
        self.assertIn(self.test, types)
        self.assertIn("--strict", types)
        self.assertIn("modules/hosts/desktop/composition/composeDesktopHeadlessReads.ts", types)
        self.assertIn("modules/hosts/server/composition/composeManagedAgentReads.ts", types)
        self.assertIn("modules/application/use-cases/model/tests/model-download-tasks.use-case.unit.test.ts", unit)
        self.assertNotIn("completion-all", selected)

    def test_borrowed_public_sources_keep_focused_companion_checks(self):
        paths = [self.owner, "modules/contracts/headless/headless-read-request.ts",
                 "modules/contracts/headless/headless-read-result.ts",
                 "modules/hosts/desktop/composition/composeDesktopHost.ts",
                 "modules/hosts/server/composition/composeServerHost.ts",
                 "modules/hosts/README.md"]
        self.assertNotIn("focused-tests", self.selected(paths))
        selected = self.selected(paths, ("headless-desktop-read-provider", "managed-headless-agent-server"))
        self.assertIn("headless-desktop-read-provider", selected)
        self.assertIn("managed-headless-agent-server", selected)

    def test_unknown_sources_and_explicit_generic_selection_still_fall_back(self):
        self.assertIn("focused-tests", self.selected([self.owner], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.owner,
            "modules/hosts/shared/composition/unknown-model-helper.ts"]))
        self.assertNotIn("headless-model-metadata-owner-unit", self.selected([
            "modules/contracts/headless/headless-read-result.ts"]))

    def test_route_and_host_catalog_consumers_keep_required_protocol_evidence(self):
        paths = [self.owner,
                 "modules/adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes.ts",
                 "modules/adapters/transport/api-express/headless/tests/managed-headless-agent-routes.integration.test.ts",
                 "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless.e2e.spec.ts",
                 "dev-tools/scripts/qualification/visual-composer/managed-headless-browser-plan-approval.ts"]
        selected = self.selected(paths, ("headless-model-metadata-owner-unit",
            "headless-desktop-pinned-mcp", "managed-headless-agent-routes"))
        self.assertNotIn("focused-tests", selected)
        self.assertIn("managed-headless-agent-routes", selected)
        self.assertIn("headless-desktop-pinned-mcp", selected)


if __name__ == "__main__":
    unittest.main()
