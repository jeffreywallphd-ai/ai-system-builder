"""Exact Assets UI selection preserves verification confinement and fallback."""
from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
from control_plane.contracts import ControlError
from run_focused_checks import profile_commands


class AssetUiProfileTests(unittest.TestCase):
    def setUp(self):
        self.actual = HELPERS.parents[1]
        self.config = "dev-tools/config/contributor-check-profiles.json"
        self.profile = json.loads((self.actual / self.config).read_text())["profiles"]["asset-authoring-ui"]
        self.temp = tempfile.TemporaryDirectory(prefix="asset-ui-profile-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def configure(self, profile):
        p = self.root / self.config
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"asset-authoring-ui": profile}}))

    def test_exact_rendered_feature_tests_without_host_or_model_execution(self):
        expected = [
            "modules/ui/shared/asset-studio/tests/UnifiedAssetStudio.unit.test.tsx",
            "modules/ui/shared/asset-studio/tests/AssetStudioManager.unit.test.tsx",
            "modules/ui/shared/asset-studio/tests/asset-area-tab-consolidation.unit.test.ts",
            "modules/ui/shared/asset-package/tests/AssetPackageManager.unit.test.tsx",
            "modules/ui/shared/asset-package/tests/asset-package-starter-download.ui.test.ts",
            "modules/ui/shared/asset-authoring/tests/AssetDerivedCustomizationEditor.unit.test.tsx",
            "modules/ui/shared/asset-authoring/tests/AssetDerivedCustomizationEditor.interaction.ui.test.tsx",
            "modules/ui/shared/notifications/tests/TransientNotificationPublisher.interaction.ui.test.tsx",
            "modules/adapters/transport/ipc-electron/asset-authoring/tests/register-asset-authoring-ipc.unit.test.ts",
            "apps/desktop/src/renderer/features/asset-authoring/tests/desktop-asset-authoring-client.unit.test.ts",
            "dev-tools/scripts/qualification/tests/asset-authoring-journey-oracles.unit.test.ts",
            "modules/adapters/transport/ipc-electron/tests/guarded-ipc-main-handle-port.unit.test.ts",
            "modules/hosts/desktop/composition/tests/assets-ipc-trust-wiring.unit.test.ts",
            "modules/adapters/transport/api-express/asset-package/tests/asset-package-transport-parity.unit.test.ts",
            "modules/adapters/transport/api-express/asset-studio/tests/asset-studio-transport-parity.unit.test.ts",
            "apps/desktop/src/renderer/features/asset-library/tests/asset-library-feature.unit.test.tsx",
            "apps/thin-client/src/features/asset-library/tests/asset-library-feature.unit.test.tsx",
            "modules/application/use-cases/asset-authoring/tests/asset-authoring.use-cases.unit.test.ts",
            "modules/application/use-cases/asset-authoring/tests/asset-authoring.versioning-conflict-provenance.unit.test.ts",
            "modules/application/use-cases/asset-authoring/tests/asset-override.use-cases.unit.test.ts",
            "modules/application/use-cases/asset-authoring/tests/legacy-workspace-authorization.unit.test.ts",
            "modules/application/services/asset/tests/workspace-asset-authoring-readers.unit.test.ts",
            "modules/adapters/transport/api-express/tests/register-asset-authoring-api-routes.unit.test.ts",
            "modules/hosts/desktop/composition/tests/legacy-authoring-workspace-authority.integration.test.ts",
                    'modules/application/use-cases/asset-package/tests/asset-package-lifecycle.unit.test.ts',
            'modules/application/use-cases/asset-package/tests/asset-package-workspace-authorization.unit.test.ts',
            'modules/hosts/desktop/composition/tests/assets-package-workspace-authorization.integration.test.ts',
            'modules/application/use-cases/asset-package/tests/package-command-snapshots.unit.test.ts',
                    'dev-tools/scripts/architecture/tests/asset-system-fitness.unit.test.mjs',
        ]
        expected.extend(['modules/application/use-cases/asset-studio/tests/asset-studio-workflow.unit.test.ts', 'modules/application/use-cases/asset-studio/tests/asset-studio-asset-draft-workflow.unit.test.ts', 'modules/application/use-cases/asset-studio/tests/studio-workspace-authorization-and-capture.unit.test.ts', 'modules/hosts/desktop/composition/tests/studio-workspace-authority.integration.test.ts'])
        expected.extend(['modules/application/use-cases/asset-authoring/tests/asset-derived-customization-workflow.unit.test.ts', 'modules/application/use-cases/asset-authoring/tests/derived-workspace-authorization-and-capture.unit.test.ts', 'modules/hosts/desktop/composition/tests/derived-workspace-authority.integration.test.ts'])
        self.assertEqual(self.profile["test_paths"], expected)
        self.assertEqual(self.profile["source_paths"], [
            "dev-tools/config/contributor-check-profiles.json",
            "modules/ui/shared/asset-studio/UnifiedAssetStudio.tsx",
            "modules/ui/shared/asset-studio/AssetStudioManager.tsx",
            "modules/ui/shared/asset-studio/README.md",
            "modules/ui/shared/asset-package/AssetPackageManager.tsx",
            "modules/ui/shared/asset-authoring/AssetDerivedCustomizationEditor.tsx",
            "modules/ui/shared/notifications/TransientNotificationPublisher.tsx",
            "modules/adapters/transport/ipc-electron/asset-authoring/registerAssetAuthoringIpc.ts",
            "apps/desktop/src/renderer/features/asset-authoring/api/desktopAssetAuthoringClient.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/asset-authoring-journey.ts",
            "dev-tools/scripts/qualification/visual-composer/asset-authoring-oracles.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-browse.e2e.spec.ts",
            "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-browse.e2e.spec.ts",
            "modules/adapters/transport/ipc-electron/guardedIpcMainHandlePort.ts",
            "modules/adapters/transport/ipc-electron/asset-package/registerAssetPackageIpc.ts",
            "modules/adapters/transport/ipc-electron/asset-studio/registerAssetStudioIpc.ts",
            "modules/hosts/desktop/composition/composeDesktopHost.ts",
            "modules/adapters/transport/README.md",
            "apps/desktop/src/renderer/features/asset-library/components/AssetLibraryFilters.tsx",
            "apps/thin-client/src/features/asset-library/components/AssetLibraryFilters.tsx",
            "modules/application/services/asset/workspace-asset-access.service.ts",
            "modules/application/services/asset/workspace-asset-authoring-readers.ts",
            "modules/application/use-cases/asset-authoring/create-workspace-authored-asset.use-case.ts",
            "modules/application/use-cases/asset-authoring/create-asset-draft.use-case.ts",
            "modules/application/use-cases/asset-authoring/update-asset-draft.use-case.ts",
            "modules/application/use-cases/asset-authoring/publish-asset-draft.use-case.ts",
            "modules/application/use-cases/asset-authoring/create-asset-override.use-case.ts",
            "modules/application/use-cases/asset-authoring/update-asset-override.use-case.ts",
            "modules/application/use-cases/asset-authoring/disable-asset-override.use-case.ts",
            "modules/adapters/transport/api-express/asset-authoring/registerAssetAuthoringApiRoutes.ts",
            "modules/hosts/server/composition/composeServerHost.ts",
            "modules/application/README.md",
            "modules/hosts/README.md",
                    'modules/application/use-cases/asset-package/inspect-asset-package.use-case.ts',
            'modules/application/use-cases/asset-package/admit-asset-package.use-case.ts',
            'modules/application/use-cases/asset-package/manage-asset-package-activation.use-case.ts',
            'modules/hosts/shared/composition/composeAssetPackageLifecycle.ts',
            'modules/hosts/desktop/composition/composeDesktopAssetFeature.ts',
            'modules/contracts/asset-package/asset-package-contracts.ts',
            'modules/adapters/package/aisb/createAisbPackageInspector.ts',
            'modules/application/services/asset-package/capture-package-commands.ts',
                    'dev-tools/scripts/architecture/check-asset-system-fitness.mjs',
        ] + ['modules/application/use-cases/asset-studio/start-asset-studio.use-case.ts', 'modules/application/use-cases/asset-studio/propose-asset-studio-change.use-case.ts', 'modules/application/use-cases/asset-studio/review-asset-studio-proposal.use-case.ts', 'modules/application/use-cases/asset-studio/read-asset-studio-workflows.use-case.ts', 'modules/application/use-cases/asset-studio/asset-studio-asset-draft-workflow.use-case.ts', 'modules/hosts/shared/composition/composeAssetStudioWorkflow.ts', 'modules/application/services/asset-studio/capture-studio-requests.ts'] + ['modules/application/use-cases/asset-authoring/asset-derived-customization-workflow.use-case.ts', 'modules/hosts/shared/composition/composeAssetDerivedCustomization.ts', 'modules/application/services/asset/capture-derived-customization-requests.ts', 'modules/application/services/asset/asset-derived-customization-target-catalog.service.ts'])
        commands = profile_commands(self.actual, "asset-authoring-ui")
        self.assertEqual(sorted(p for command in commands for p in command if p in expected), sorted(expected))
        self.assertTrue(all(command[:4] == ["node", "--import", "tsx", "--test"] or command[:3] == ["node", "dev-tools/helpers/run_vitest_checks.mjs", "--"] for command in commands))

    def test_declared_coverage_never_removes_unknown_or_explicit_generic_checks(self):
        self.configure(self.profile)
        for paths, required, focused in [
            (self.profile["source_paths"] + self.profile["test_paths"], ["asset-authoring-ui"], False),
            ([self.profile["test_paths"][0]], ["asset-authoring-ui", "focused-tests"], True),
            ([self.profile["test_paths"][0], "modules/unrelated/source.ts"], ["asset-authoring-ui"], True),
        ]:
            with self.subTest(paths=paths, required=required):
                selected = catalog.plan(self.root, paths, required, "candidate")["selected"]
                self.assertEqual("focused-tests" in {c["id"] for c in selected}, focused)
                self.assertEqual(next(c for c in selected if c["id"] == "asset-authoring-ui")["argv"][-2:], ["--profile", "asset-authoring-ui"])

    def test_unsafe_missing_and_controlled_tests_are_refused_before_dispatch(self):
        for path in ["../outside.test.ts", "/outside.test.ts", "modules/ui/shared/missing.unit.test.ts", "modules/ui/shared/unsafe.ai.test.ts", "modules/ui/shared/ai-marked.unit.test.ts", "modules/ui/shared/source.ts"]:
            with self.subTest(path=path):
                profile = copy.deepcopy(self.profile)
                profile["test_paths"] = [path]
                self.configure(profile)
                if path in ["modules/ui/shared/unsafe.ai.test.ts", "modules/ui/shared/ai-marked.unit.test.ts", "modules/ui/shared/source.ts"]:
                    target = self.root / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("// @test-suite ai\n" if "ai-marked" in path else "export {};\n")
                files = {} if "missing." in path else {path: "fixture"}
                with patch("run_focused_checks.snapshot", return_value={"files": files}), self.assertRaises(ControlError):
                    profile_commands(self.root, "asset-authoring-ui")

    def test_desktop_read_tests_use_their_fixed_node_and_vitest_runners(self):
        ipc = "modules/adapters/transport/ipc-electron/asset-authoring/tests/register-asset-authoring-ipc.unit.test.ts"
        client = "apps/desktop/src/renderer/features/asset-authoring/tests/desktop-asset-authoring-client.unit.test.ts"
        commands = profile_commands(self.actual, "asset-authoring-ui")
        node = next(command for command in commands if "--test" in command)
        vitest = next(command for command in commands if "dev-tools/helpers/run_vitest_checks.mjs" in command)
        self.assertIn(ipc, node)
        self.assertNotIn(client, node)
        self.assertIn(client, vitest)
        self.assertNotIn(ipc, vitest)
        selected = [p for command in commands for p in command if p in self.profile["test_paths"]]
        self.assertEqual(len(selected), len(set(selected)))

    def test_removing_a_declared_read_test_changes_verification_policy(self):
        self.configure(self.profile)
        before = catalog.policy_digest(self.root, catalog.definitions(self.root))
        changed = copy.deepcopy(self.profile)
        changed["test_paths"].remove("modules/adapters/transport/ipc-electron/asset-authoring/tests/register-asset-authoring-ipc.unit.test.ts")
        self.configure(changed)
        self.assertNotEqual(before, catalog.policy_digest(self.root, catalog.definitions(self.root)))

    def test_authoring_oracles_run_in_node_without_collecting_host_specs(self):
        oracle = "dev-tools/scripts/qualification/tests/asset-authoring-journey-oracles.unit.test.ts"
        commands = profile_commands(self.actual, "asset-authoring-ui")
        node = next(command for command in commands if oracle in command)
        self.assertEqual(node[:4], ["node", "--import", "tsx", "--test"])
        self.assertFalse(any(".e2e.spec." in part or "playwright" in part for command in commands for part in command))
        self.assertIn("dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-browse.e2e.spec.ts", self.profile["source_paths"])
        self.assertIn("dev-tools/scripts/qualification/visual-composer/e2e/thin-client-browse.e2e.spec.ts", self.profile["source_paths"])


    def test_assets_sender_guards_use_only_fixed_node_tests(self):
        expected = ['modules/adapters/transport/ipc-electron/tests/guarded-ipc-main-handle-port.unit.test.ts', 'modules/hosts/desktop/composition/tests/assets-ipc-trust-wiring.unit.test.ts', 'modules/adapters/transport/api-express/asset-package/tests/asset-package-transport-parity.unit.test.ts', 'modules/adapters/transport/api-express/asset-studio/tests/asset-studio-transport-parity.unit.test.ts']
        commands = profile_commands(self.actual, "asset-authoring-ui")
        for path in expected:
            command = next(command for command in commands if path in command)
            self.assertEqual(command[:4], ["node", "--import", "tsx", "--test"])
        self.assertFalse(any("security-authority" in part or "playwright" in part for command in commands for part in command))
        self.configure(self.profile)
        selected = catalog.plan(self.root, self.profile["source_paths"] + self.profile["test_paths"], ["asset-authoring-ui"], "candidate")["selected"]
        self.assertNotIn("focused-tests", {check["id"] for check in selected})


    def test_library_search_ui_stays_in_the_fixed_node_profile(self):
        expected = ['apps/desktop/src/renderer/features/asset-library/tests/asset-library-feature.unit.test.tsx', 'apps/thin-client/src/features/asset-library/tests/asset-library-feature.unit.test.tsx']
        commands = profile_commands(self.actual, "asset-authoring-ui")
        for path in expected:
            command = next(command for command in commands if path in command)
            self.assertEqual(command[:4], ["node", "--import", "tsx", "--test"])
        self.assertFalse(any("playwright" in part or ".e2e.spec." in part for command in commands for part in command))


    def test_legacy_authority_uses_only_fixed_finite_node_tests(self):
        expected = ['modules/application/use-cases/asset-authoring/tests/asset-authoring.use-cases.unit.test.ts', 'modules/application/use-cases/asset-authoring/tests/asset-authoring.versioning-conflict-provenance.unit.test.ts', 'modules/application/use-cases/asset-authoring/tests/asset-override.use-cases.unit.test.ts', 'modules/application/use-cases/asset-authoring/tests/legacy-workspace-authorization.unit.test.ts', 'modules/application/services/asset/tests/workspace-asset-authoring-readers.unit.test.ts', 'modules/adapters/transport/api-express/tests/register-asset-authoring-api-routes.unit.test.ts', 'modules/hosts/desktop/composition/tests/legacy-authoring-workspace-authority.integration.test.ts']
        commands = profile_commands(self.actual, "asset-authoring-ui")
        for path in expected:
            command = next(command for command in commands if path in command)
            self.assertEqual(command[:4], ["node", "--import", "tsx", "--test"])
        self.assertFalse(any("playwright" in part or ".ai." in part or "security-authority" in part for command in commands for part in command))
        self.configure(self.profile)
        selected = catalog.plan(self.root, self.profile["source_paths"] + self.profile["test_paths"], ["asset-authoring-ui"], "candidate")["selected"]
        self.assertNotIn("focused-tests", {check["id"] for check in selected})


    def test_package_authority_and_snapshots_use_only_fixed_finite_node_tests(self):
        expected = ['modules/application/use-cases/asset-package/tests/asset-package-lifecycle.unit.test.ts', 'modules/application/use-cases/asset-package/tests/asset-package-workspace-authorization.unit.test.ts', 'modules/hosts/desktop/composition/tests/assets-package-workspace-authorization.integration.test.ts', 'modules/application/use-cases/asset-package/tests/package-command-snapshots.unit.test.ts', 'dev-tools/scripts/architecture/tests/asset-system-fitness.unit.test.mjs']
        commands = profile_commands(self.actual, "asset-authoring-ui")
        for path in expected:
            command = next(command for command in commands if path in command)
            self.assertEqual(command[:4], ["node", "--import", "tsx", "--test"])
        self.assertFalse(any("playwright" in part or ".ai." in part or "security-authority" in part for command in commands for part in command))



    def test_studio_authority_uses_fixed_finite_node_tests(self):
        expected = ['modules/application/use-cases/asset-studio/tests/asset-studio-workflow.unit.test.ts', 'modules/application/use-cases/asset-studio/tests/asset-studio-asset-draft-workflow.unit.test.ts', 'modules/application/use-cases/asset-studio/tests/studio-workspace-authorization-and-capture.unit.test.ts', 'modules/hosts/desktop/composition/tests/studio-workspace-authority.integration.test.ts']
        commands = profile_commands(self.actual, "asset-authoring-ui")
        for path in expected:
            command = next(command for command in commands if path in command)
            self.assertEqual(command[:4], ["node", "--import", "tsx", "--test"])
        self.assertFalse(any("playwright" in part or ".ai." in part for command in commands for part in command))


    def test_derived_authority_and_resolver_use_fixed_finite_node_tests(self):
        expected = ['modules/application/use-cases/asset-authoring/tests/asset-derived-customization-workflow.unit.test.ts', 'modules/application/use-cases/asset-authoring/tests/derived-workspace-authorization-and-capture.unit.test.ts', 'modules/hosts/desktop/composition/tests/derived-workspace-authority.integration.test.ts', 'modules/adapters/transport/ipc-electron/asset-authoring/tests/register-asset-authoring-ipc.unit.test.ts']
        commands = profile_commands(self.actual, "asset-authoring-ui")
        for path in expected:
            command = next(command for command in commands if path in command)
            self.assertEqual(command[:4], ["node", "--import", "tsx", "--test"])
        self.assertFalse(any("playwright" in part or ".ai." in part for command in commands for part in command))

if __name__ == "__main__":
    unittest.main()
