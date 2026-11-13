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

    def test_composer_witness_routing_is_opt_in_and_exact(self):
        check = "headless-composer-draft-witnesses"
        inventory = "modules/ui/shared/notifications/tests/notificationMigrationInventory.ts"
        unrelated = "modules/ui/shared/system-builder/SystemFormComposerView.tsx"
        self.assertNotIn(check, self.plan([inventory]))
        scoped = self.plan([inventory], check)
        self.assertIn("operational-ui", scoped)
        self.assertNotIn("focused-tests", scoped)
        self.assertEqual(scoped[check]["argv"][-2:], [
            "modules/ui/shared/notifications/tests/notificationMigrationGuard.unit.test.ts",
            "dev-tools/helpers/tests/ui-coverage-census.unit.test.mjs",
        ])
        self.assertIn("focused-tests", self.plan([inventory, unrelated], check))

    def test_semantic_edit_check_is_exact_and_preserves_unrelated_fallback(self):
        source = "modules/application/use-cases/system-builder/headless-semantic-edit.use-case.ts"
        unrelated = "modules/application/use-cases/system-builder/published-system-form-runtime.use-case.ts"
        check = "headless-system-builder-semantic-edits"
        self.assertIn("focused-tests", self.plan([source]))
        self.assertEqual(set(self.plan([source], check)), {"architecture", check})
        self.assertIn("focused-tests", self.plan([source, unrelated], check))
        shared = "modules/hosts/shared/composition/composeSystemBuilder.ts"
        self.assertIn("focused-tests", self.plan([shared]))
        self.assertNotIn("focused-tests", self.plan([shared, source], check))

    def test_scoped_committed_change_check_has_exact_ownership(self):
        source = "modules/application/use-cases/system-builder/headless-committed-changes.use-case.ts"
        check = "headless-system-builder-semantic-edits"
        self.assertIn("focused-tests", self.plan([source]))
        self.assertEqual(set(self.plan([source], check)), {"architecture", check})
        self.assertIn("modules/application/use-cases/system-builder/tests/headless-committed-changes.unit.test.ts",
                      self.plan([source], check)[check]["argv"])

    def test_journal_check_runs_ordinary_and_delegated_storage_fixtures(self):
        source = "modules/adapters/persistence/system-builder/structuredSystemChangeJournal.ts"
        check = "headless-desktop-activation"
        selected = self.plan([source], check)
        self.assertNotIn("focused-tests", selected)
        self.assertIn("modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts", selected[check]["argv"])
        self.assertIn("modules/adapters/persistence/system-builder/tests/structured-system-builder-repository.unit.test.ts", selected[check]["argv"])
        port = "modules/application/ports/system-builder/headless-operation-store.port.ts"
        semantic = "headless-system-builder-semantic-edits"
        self.assertIn("focused-tests", self.plan([port], check))
        semantic_plan = self.plan([port], semantic)
        self.assertNotIn("focused-tests", semantic_plan)
        self.assertIn("modules/application/use-cases/system-builder/tests/headless-committed-changes.unit.test.ts", semantic_plan[semantic]["argv"])

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
        host = "modules/hosts/desktop/composition/composeDesktopHost.ts"
        self.assertIn("focused-tests", self.plan([activation, host]))
        self.assertNotIn("focused-tests", self.plan([activation, host], check))
        feed = "modules/hosts/desktop/composition/registerDesktopSystemChangePoll.ts"
        self.assertIn("focused-tests", self.plan([feed]))
        self.assertNotIn("focused-tests", self.plan([feed], check))
        self.assertIn("modules/hosts/desktop/composition/tests/desktop-system-change-poll.unit.test.ts", self.plan([feed], check)[check]["argv"])

    def test_mcp_checks_are_exact_and_preserve_other_transport_coverage(self):
        mcp = "modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts"
        self.assertEqual(set(self.plan([mcp])), {"architecture", "headless-desktop-pinned-mcp"})
        other = "modules/adapters/transport/headless-loopback/other-source.ts"
        self.assertIn("focused-tests", self.plan([mcp, other], "headless-desktop-activation"))
        barrel = "modules/contracts/headless/index.ts"
        self.assertIn("focused-tests", self.plan([mcp, barrel]))
        self.assertNotIn("focused-tests", self.plan([mcp, barrel], "headless-desktop-activation"))

    def test_packaged_headless_check_is_opt_in_and_exact(self):
        fixture = "dev-tools/scripts/qualification/visual-composer/e2e/headless-desktop-fixture.ts"
        unrelated = "modules/contracts/headless/some-other-source.ts"
        check = "headless-packaged-desktop-journey"
        self.assertNotIn(check, self.plan([fixture]))
        selected = self.plan([fixture], check)
        self.assertNotIn("focused-tests", selected)
        self.assertEqual(selected[check]["argv"][-2:], [
            "--project=packaged-desktop", "packaged-desktop-headless.e2e.spec.ts",
        ])
        self.assertIn("focused-tests", self.plan([fixture, unrelated], check))
