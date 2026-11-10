"""Artifact confirmation checks run mounted UI tests, not physical native work."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
from control_plane.contracts import ControlError
from run_focused_checks import profile_commands

ROOT = HELPERS.parents[1]
CONFIG = "dev-tools/config/contributor-check-profiles.json"
PROFILE = "artifact-confirmation-ui"
DESKTOP = "apps/desktop/src/renderer/features/artifact-browser/"
THIN = "apps/thin-client/src/features/artifact-browser/"
SHELL_TEST = "apps/thin-client/tests/thin-client-shell-css.unit.test.ts"
GUARD = "dev-tools/helpers/tests/test_control_plane_artifact_confirmation_profile.py"
CATALOG = "dev-tools/helpers/control_plane/catalog.py"
TESTS = [
    DESKTOP + "tests/use-artifact-browser-feature.unit.test.tsx",
    THIN + "tests/use-artifact-browser-feature.unit.test.tsx",
    SHELL_TEST,
]
SOURCES = [
    DESKTOP + "components/ArtifactBrowserFeature.tsx",
    THIN + "components/ArtifactBrowserFeature.tsx",
    *TESTS,
    CATALOG,
    CONFIG,
    GUARD,
]


class ArtifactConfirmationProfileTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / CONFIG).read_bytes())
        self.profile = self.config["profiles"][PROFILE]
        self.temp = tempfile.TemporaryDirectory(prefix="artifact-confirmation-profile-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def configure(self, value):
        target = self.root / CONFIG
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value), encoding="utf-8")

    def test_exact_three_files_use_their_actual_runners_without_native_activation(self):
        self.assertEqual(self.profile, {"test_paths": TESTS, "source_paths": SOURCES})
        self.assertEqual(profile_commands(ROOT, PROFILE), [
            ["node", "--import", "tsx", "--test", "--", SHELL_TEST],
            ["node", "dev-tools/helpers/run_vitest_checks.mjs", "--", *TESTS[:2]],
        ])
        self.assertEqual(catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE], SOURCES[:5] + [GUARD])
        native = "modules/adapters/model/local/tests/windows-model-file-identity.native.integration.test.ts"
        self.assertIn(native, self.config["profiles"]["functionality-outcomes"]["test_paths"])
        self.assertNotIn(native, TESTS)
        for command in profile_commands(ROOT, PROFILE):
            self.assertFalse(any("native" in part or "playwright" in part or ".ai." in part or "PYTHON" in part for part in command))

    def test_known_sources_select_new_profile_and_unknown_or_explicit_impact_keeps_fallback(self):
        self.configure(self.config)
        for path in SOURCES[:5] + [GUARD]:
            with self.subTest(path=path):
                selected = catalog.plan(self.root, [path], ["documentation"], "synthetic")["selected"]
                ids = {row["id"] for row in selected}
                self.assertIn(PROFILE, ids)
                self.assertNotIn("focused-tests", ids)
                self.assertNotIn("functionality-outcomes", ids)
                self.assertNotIn("windows-file-identity", ids)
        for paths, required in [
            ([SHELL_TEST, "apps/thin-client/src/unreviewed.ts"], ["documentation"]),
            ([SHELL_TEST], ["focused-tests"]),
        ]:
            with self.subTest(paths=paths, required=required):
                ids = {row["id"] for row in catalog.plan(self.root, paths, required, "synthetic")["selected"]}
                self.assertIn(PROFILE, ids)
                self.assertIn("focused-tests", ids)

    def test_incomplete_coverage_keeps_generic_and_missing_profile_or_configuration_refuses(self):
        broken = copy.deepcopy(self.config)
        broken["profiles"][PROFILE]["test_paths"].remove(SHELL_TEST)
        broken["profiles"][PROFILE]["source_paths"].remove(SHELL_TEST)
        self.configure(broken)
        ids = {row["id"] for row in catalog.plan(self.root, [SHELL_TEST], ["documentation"], "synthetic")["selected"]}
        self.assertIn(PROFILE, ids)
        self.assertIn("focused-tests", ids)
        del broken["profiles"][PROFILE]
        self.configure(broken)
        with self.assertRaises(ControlError):
            catalog.plan(self.root, [SHELL_TEST], ["documentation"], "synthetic")
        (self.root / CONFIG).unlink()
        with self.assertRaises(ControlError):
            catalog.plan(self.root, [SHELL_TEST], ["documentation"], "synthetic")

    def test_shared_configuration_and_catalog_do_not_activate_borrowed_profiles(self):
        self.configure(self.config)
        for path in [CONFIG, CATALOG, "docs/diagnostics/artifact-confirmation-accessibility.md"]:
            with self.subTest(path=path):
                ids = {row["id"] for row in catalog.plan(self.root, [path], ["documentation"], "synthetic")["selected"]}
                self.assertNotIn(PROFILE, ids)
        selected = catalog.plan(self.root, [GUARD], ["documentation"], "synthetic")["selected"]
        self.assertIn("control-plane", {row["id"] for row in selected})

    def test_runner_refuses_unsafe_missing_duplicate_and_ai_declared_tests(self):
        for test in ["../outside.test.ts", "/outside.test.ts", "modules/example/missing.test.ts", "modules/example/unsafe.ai.test.ts", "modules/example/marked.test.ts"]:
            with self.subTest(test=test):
                config = copy.deepcopy(self.config)
                config["profiles"][PROFILE]["test_paths"] = [test]
                self.configure(config)
                files = {} if "missing" in test else {test: "synthetic"}
                if "unsafe.ai." in test or "marked.test." in test:
                    target = self.root / test
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("// @test-suite ai\n", encoding="utf-8")
                with patch("run_focused_checks.snapshot", return_value={"files": files}), self.assertRaises(ControlError):
                    profile_commands(self.root, PROFILE)
        config = copy.deepcopy(self.config)
        config["profiles"][PROFILE]["test_paths"] = [TESTS[0], TESTS[0]]
        self.configure(config)
        with self.assertRaises(ControlError):
            profile_commands(self.root, PROFILE)


if __name__ == "__main__":
    unittest.main()
