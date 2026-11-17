"""Desktop startup selection stays exact, bounded and separate from host runs."""
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


class DesktopStartupProfileTests(unittest.TestCase):
    def setUp(self):
        self.actual = HELPERS.parents[1]
        self.config = "dev-tools/config/contributor-check-profiles.json"
        self.profile = json.loads((self.actual / self.config).read_bytes())["profiles"]["desktop-startup-ui"]
        self.temp = tempfile.TemporaryDirectory(prefix="desktop-startup-profile-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def configure(self, profile):
        p = self.root / self.config
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"desktop-startup-ui": profile}}), encoding="utf8")

    def test_exact_lazy_renderer_and_packaging_test_identity(self):
        expected = ["apps/desktop/src/renderer/tests/app-lazy-pages.ui.test.tsx", "apps/desktop/tests/forge-packaging-boundaries.unit.test.ts"]
        self.assertEqual(self.profile["test_paths"], expected)
        self.assertEqual(self.profile["source_paths"], [
            self.config, "apps/desktop/src/renderer/index.html", "apps/desktop/src/renderer/startup.ts",
            "apps/desktop/src/renderer/startup/desktopStartup.ts", "apps/desktop/src/renderer/styles/startup.css",
            "apps/desktop/src/renderer/main.tsx", "apps/desktop/src/main/index.ts", "apps/desktop/src/renderer/README.md",
        ])
        commands = profile_commands(self.actual, "desktop-startup-ui")
        self.assertEqual(sorted(p for command in commands for p in command if p in expected), sorted(expected))
        self.assertTrue(all(command[:4] == ["node", "--import", "tsx", "--test"] for command in commands))

    def test_unknown_and_explicit_generic_checks_are_retained(self):
        self.configure(self.profile)
        for paths, required, focused in [
            (self.profile["source_paths"] + self.profile["test_paths"], ["desktop-startup-ui"], False),
            ([self.profile["test_paths"][0]], ["desktop-startup-ui", "focused-tests"], True),
            ([self.profile["test_paths"][0], "apps/desktop/src/unrelated.ts"], ["desktop-startup-ui"], True),
        ]:
            with self.subTest(paths=paths, required=required):
                selected = catalog.plan(self.root, paths, required, "candidate")["selected"]
                self.assertEqual("focused-tests" in {c["id"] for c in selected}, focused)
                self.assertEqual(next(c for c in selected if c["id"] == "desktop-startup-ui")["argv"][-2:], ["--profile", "desktop-startup-ui"])

    def test_unsafe_missing_non_test_and_controlled_inputs_fail_closed(self):
        for name in ["../outside.test.ts", "/outside.test.ts", "apps/desktop/missing.unit.test.ts", "apps/desktop/unsafe.ai.test.ts", "apps/desktop/marked.unit.test.ts", "apps/desktop/source.ts"]:
            with self.subTest(name=name):
                profile = copy.deepcopy(self.profile)
                profile["test_paths"] = [name]
                self.configure(profile)
                if name in ["apps/desktop/unsafe.ai.test.ts", "apps/desktop/marked.unit.test.ts", "apps/desktop/source.ts"]:
                    target = self.root / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("// @test-suite ai\n" if "marked" in name else "export {};\n", encoding="utf8")
                files = {} if "missing." in name else {name: "fixture"}
                with patch("run_focused_checks.snapshot", return_value={"files": files}), self.assertRaises(ControlError):
                    profile_commands(self.root, "desktop-startup-ui")


if __name__ == "__main__":
    unittest.main()
