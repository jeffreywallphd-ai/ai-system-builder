"""Finite Security status qualification must not hide unrelated or explicit test impact."""
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
    "apps/thin-client/src/features/security/hooks/tests/useThinClientSecurity.unit.test.ts",
    "apps/thin-client/src/features/security/components/SecurityStatusPanel.unit.test.tsx",
    "apps/thin-client/src/features/security/hooks/tests/useThinClientSecurity.recovery.ui.test.tsx",
    "apps/thin-client/src/security/tests/paired-device-token-store.unit.test.ts",
    "apps/thin-client/src/security/tests/securityApiClient.unit.test.ts",
    "apps/thin-client/src/security/tests/security-errors.unit.test.ts"
]

class SecurityStatusProfile(unittest.TestCase):
    def test_controller_fixture_deadline_is_fixed_without_other_guard_changes(self):
        from control_plane.execution import MAX_OUTPUT
        checks = {row["id"]: row for row in catalog.definitions(ROOT)}
        self.assertEqual(checks["control-plane"]["timeout"], 600)
        self.assertEqual(checks["control-plane"]["argv"], [sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py"])
        self.assertEqual(MAX_OUTPUT, 2 * 1024 * 1024)
        for name in catalog.QUALIFICATION_PROFILES:
            self.assertEqual(checks[name]["timeout"], 300)
        for name in ["documentation", "agent-support", "architecture"]:
            self.assertEqual(checks[name]["timeout"], 120)
        for name in ["completion-all", "completion-standardande2e"]:
            self.assertEqual(checks[name]["timeout"], 1800)
        with tempfile.TemporaryDirectory(prefix="security-profile-") as directory:
            root = Path(directory)
            self.fixture(root, {**self.profile(), "timeout": 36000})
            with self.assertRaises(ControlError):
                catalog.plan(root, [TESTS[0]], ["security-status-ui"], "synthetic-candidate")

    def profile(self):
        return json.loads((ROOT / CONFIG).read_bytes())["profiles"]["security-status-ui"]

    def fixture(self, root, profile):
        path = root / CONFIG
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"security-status-ui": profile}}))

    def test_exact_six_synthetic_ui_api_files_use_one_fixed_vitest_command(self):
        self.assertEqual(self.profile()["test_paths"], TESTS)
        commands = run_focused_checks.profile_commands(ROOT, "security-status-ui")
        self.assertEqual(commands, [["node", "dev-tools/helpers/run_vitest_checks.mjs", "--", *sorted(TESTS)]])
        self.assertTrue(set(catalog.QUALIFICATION_PROFILE_PATTERNS["security-status-ui"]).issubset(self.profile()["source_paths"]))

    def test_auto_selection_preserves_unknown_and_explicit_generic_tests(self):
        with tempfile.TemporaryDirectory(prefix="security-profile-") as directory:
            root = Path(directory)
            self.fixture(root, self.profile())
            hook = "apps/thin-client/src/features/security/hooks/useThinClientSecurity.ts"
            for paths, required, generic in [
                ([hook, CONFIG], ["documentation"], False),
                ([hook], ["focused-tests"], True),
                ([hook, "modules/unknown/changed.ts"], ["documentation"], True),
            ]:
                with self.subTest(paths=paths):
                    plan = catalog.plan(root, paths, required, "synthetic-candidate")
                    ids = {check["id"] for check in plan["selected"]}
                    self.assertIn("security-status-ui", ids)
                    self.assertEqual("focused-tests" in ids, generic)
                    self.assertEqual(ids.intersection(catalog.QUALIFICATION_PROFILES), {"security-status-ui"})
            ids = {check["id"] for check in catalog.plan(root, ["apps/desktop/src/renderer/unrelated.ts"], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertNotIn("security-status-ui", ids)

    def test_incomplete_declared_source_coverage_retains_generic_tests(self):
        with tempfile.TemporaryDirectory(prefix="security-profile-") as directory:
            root = Path(directory)
            profile = self.profile()
            hook = "apps/thin-client/src/features/security/hooks/useThinClientSecurity.ts"
            profile["source_paths"] = [path for path in profile["source_paths"] if path != hook]
            self.fixture(root, profile)
            ids = {check["id"] for check in catalog.plan(root, [hook], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertIn("focused-tests", ids)

    def test_unsafe_and_ai_tests_are_not_executable_profile_entries(self):
        for path in ["../outside.test.ts", "apps/settings/source.ts", "modules/model/example.ai.test.ts", "modules/runtime/tests/test_context_generation_ai_e2e.py"]:
            with self.subTest(path=path), tempfile.TemporaryDirectory(prefix="security-profile-") as directory:
                root = Path(directory)
                self.fixture(root, {"test_paths": [path], "source_paths": TESTS})
                with patch.object(run_focused_checks, "snapshot", return_value={"files": {path: "synthetic"}}):
                    with self.assertRaises(ControlError):
                        run_focused_checks.profile_commands(root, "security-status-ui")

    def test_missing_valid_test_paths_and_missing_candidate_members_are_denied(self):
        path = "apps/desktop/valid-missing.test.ts"
        for exists in (False, True):
            with self.subTest(file_exists=exists), tempfile.TemporaryDirectory(prefix="security-profile-") as directory:
                root = Path(directory)
                self.fixture(root, {"test_paths": [path], "source_paths": [path]})
                if exists:
                    target = root / path
                    target.parent.mkdir(parents=True)
                    target.write_text('import { test } from "vitest"; test("inert", () => {});')
                with patch.object(run_focused_checks, "snapshot", return_value={"files": {}}):
                    with self.assertRaises(ControlError):
                        run_focused_checks.profile_commands(root, "security-status-ui")

if __name__ == "__main__":
    unittest.main()
