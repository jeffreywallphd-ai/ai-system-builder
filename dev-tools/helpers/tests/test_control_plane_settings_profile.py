"""Finite Settings qualification must not hide unrelated or explicit test impact."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
from control_plane.contracts import ControlError
import run_focused_checks

ROOT = HELPERS.parents[1]
CONFIG = "dev-tools/config/contributor-check-profiles.json"
TESTS = [
    "apps/desktop/src/renderer/features/settings/tests/settings-panel.unit.test.tsx",
    "apps/desktop/src/renderer/features/settings/tests/settings-page.unit.test.tsx",
    "apps/desktop/src/renderer/features/settings/tests/settings-recovery.ui.test.tsx",
    "apps/desktop/src/renderer/lib/application-settings-api.unit.test.ts",
    "apps/thin-client/src/pages/tests/settings-recovery.ui.test.tsx",
    "apps/thin-client/src/features/settings/tests/api-application-settings-client.unit.test.ts",
    "modules/ui/shared/settings/tests/SettingField.unit.test.tsx",
    "apps/thin-client/src/features/page-dashboard/tests/summary-clients.unit.test.ts",
    "modules/application/use-cases/tests/settings.use-cases.unit.test.ts",
]

class SettingsProfile(unittest.TestCase):
    def profile(self):
        return json.loads((ROOT / CONFIG).read_bytes())["profiles"]["settings-ui"]

    def fixture(self, root, profile):
        path = root / CONFIG
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"settings-ui": profile}}))

    def test_exact_settings_and_related_files_use_fixed_literal_runners(self):
        self.assertEqual(self.profile()["test_paths"], TESTS)
        commands = run_focused_checks.profile_commands(ROOT, "settings-ui")
        node_files = ['modules/application/use-cases/tests/settings.use-cases.unit.test.ts']
        ui_files = sorted(set(TESTS) - set(node_files))
        self.assertEqual(commands, [["node", "--import", "tsx", "--test", "--", *node_files], ["node", "dev-tools/helpers/run_vitest_checks.mjs", "--", *ui_files]])
        self.assertTrue(set(catalog.QUALIFICATION_PROFILE_PATTERNS["settings-ui"]).issubset(self.profile()["source_paths"]))

    def test_auto_selection_preserves_unknown_and_explicit_generic_tests(self):
        with tempfile.TemporaryDirectory(prefix="settings-profile-") as directory:
            root = Path(directory)
            self.fixture(root, self.profile())
            hook = "apps/desktop/src/renderer/features/settings/hooks/useApplicationSettings.ts"
            for paths, required, generic in [
                ([hook, CONFIG], ["documentation"], False),
                ([hook], ["focused-tests"], True),
                ([hook, "modules/unknown/changed.ts"], ["documentation"], True),
            ]:
                with self.subTest(paths=paths):
                    plan = catalog.plan(root, paths, required, "synthetic-candidate")
                    ids = {check["id"] for check in plan["selected"]}
                    self.assertIn("settings-ui", ids)
                    self.assertEqual("focused-tests" in ids, generic)
                    self.assertEqual(ids.intersection(catalog.QUALIFICATION_PROFILES), {"settings-ui"})
            ids = {check["id"] for check in catalog.plan(root, ["apps/desktop/src/renderer/unrelated.ts"], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertNotIn("settings-ui", ids)

    def test_incomplete_declared_source_coverage_retains_generic_tests(self):
        with tempfile.TemporaryDirectory(prefix="settings-profile-") as directory:
            root = Path(directory)
            profile = self.profile()
            hook = "apps/desktop/src/renderer/features/settings/hooks/useApplicationSettings.ts"
            profile["source_paths"] = [path for path in profile["source_paths"] if path != hook]
            self.fixture(root, profile)
            ids = {check["id"] for check in catalog.plan(root, [hook], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertIn("focused-tests", ids)

    def test_unsafe_and_ai_tests_are_not_executable_profile_entries(self):
        for path in ["../outside.test.ts", "apps/settings/source.ts", "modules/model/example.ai.test.ts", "modules/runtime/tests/test_context_generation_ai_e2e.py"]:
            with self.subTest(path=path), tempfile.TemporaryDirectory(prefix="settings-profile-") as directory:
                root = Path(directory)
                self.fixture(root, {"test_paths": [path], "source_paths": TESTS})
                with patch.object(run_focused_checks, "snapshot", return_value={"files": {path: "synthetic"}}):
                    with self.assertRaises(ControlError):
                        run_focused_checks.profile_commands(root, "settings-ui")

    def test_missing_valid_test_paths_and_missing_candidate_members_are_denied(self):
        path = "apps/desktop/valid-missing.test.ts"
        for exists in (False, True):
            with self.subTest(file_exists=exists), tempfile.TemporaryDirectory(prefix="settings-profile-") as directory:
                root = Path(directory)
                self.fixture(root, {"test_paths": [path], "source_paths": [path]})
                if exists:
                    target = root / path
                    target.parent.mkdir(parents=True)
                    target.write_text('import { test } from "vitest"; test("inert", () => {});')
                with patch.object(run_focused_checks, "snapshot", return_value={"files": {}}):
                    with self.assertRaises(ControlError):
                        run_focused_checks.profile_commands(root, "settings-ui")


    def test_new_shared_and_thin_sources_preserve_exact_profile_and_fallback(self):
        import copy
        self.assertEqual(len(self.profile()['test_paths']), 9)
        self.assertEqual(list(catalog.QUALIFICATION_PROFILE_PATTERNS['settings-ui'])[-10:], ['modules/ui/shared/settings/SettingField.tsx', 'modules/ui/shared/settings/SecretSettingField.tsx', 'modules/ui/shared/settings/ModelDefaultSettingField.tsx', 'modules/ui/shared/settings/index.ts', 'apps/thin-client/src/pages/SettingsPage.tsx', 'apps/thin-client/src/features/settings/hooks/useThinClientSettings.ts', 'apps/thin-client/src/features/settings/api/apiApplicationSettingsClient.ts', 'apps/thin-client/src/pages/tests/settings-recovery.ui.test.tsx', 'apps/thin-client/src/features/settings/tests/api-application-settings-client.unit.test.ts', 'modules/ui/shared/settings/tests/SettingField.unit.test.tsx'])
        for source in ['modules/ui/shared/settings/SettingField.tsx', 'modules/ui/shared/settings/SecretSettingField.tsx', 'modules/ui/shared/settings/ModelDefaultSettingField.tsx', 'modules/ui/shared/settings/index.ts', 'apps/thin-client/src/pages/SettingsPage.tsx', 'apps/thin-client/src/features/settings/hooks/useThinClientSettings.ts', 'apps/thin-client/src/features/settings/api/apiApplicationSettingsClient.ts', 'apps/thin-client/src/pages/tests/settings-recovery.ui.test.tsx', 'apps/thin-client/src/features/settings/tests/api-application-settings-client.unit.test.ts', 'modules/ui/shared/settings/tests/SettingField.unit.test.tsx']:
            for incomplete, required, generic in [(False,['documentation'],False),(False,['focused-tests'],True),(True,['documentation'],True)]:
                with self.subTest(source=source,incomplete=incomplete,required=required), tempfile.TemporaryDirectory(prefix='settings-new-profile-') as directory:
                    root=Path(directory);profile=copy.deepcopy(self.profile())
                    if incomplete:
                        profile['source_paths'].remove(source)
                        if source in profile['test_paths']:profile['test_paths'].remove(source)
                    self.fixture(root,profile)
                    ids={c['id'] for c in catalog.plan(root,[source],required,'synthetic-candidate')['selected']}
                    self.assertIn('settings-ui',ids);self.assertEqual('focused-tests' in ids,generic)

if __name__ == "__main__":
    unittest.main()
