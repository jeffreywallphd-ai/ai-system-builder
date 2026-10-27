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
        ]
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
        ])
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


if __name__ == "__main__":
    unittest.main()
