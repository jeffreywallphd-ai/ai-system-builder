"""System management selection stays exact, bounded and separate from host runs."""
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


class SystemManagementProfileTests(unittest.TestCase):
    def setUp(self):
        self.actual = HELPERS.parents[1]
        self.config = "dev-tools/config/contributor-check-profiles.json"
        self.profile = json.loads((self.actual / self.config).read_bytes())["profiles"]["system-management-ui"]
        self.temp = tempfile.TemporaryDirectory(prefix="system-management-profile-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def configure(self, profile):
        p = self.root / self.config
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"system-management-ui": profile}}), encoding="utf8")

    def test_exact_single_ui_test_uses_the_fixed_vitest_runner(self):
        expected = ['modules/ui/shared/system-builder/tests/SystemManagementWorkspace.interaction.ui.test.tsx']
        self.assertEqual(self.profile["test_paths"], expected)
        self.assertEqual(self.profile["source_paths"], ['dev-tools/config/contributor-check-profiles.json', 'modules/ui/shared/system-builder/SystemManagementWorkspace.tsx', 'modules/ui/shared/README.md'])
        commands = profile_commands(self.actual, "system-management-ui")
        self.assertEqual(commands, [["node", "dev-tools/helpers/run_vitest_checks.mjs", "--", *expected]])
        self.assertFalse(any("playwright" in p or ".e2e.spec." in p or ".ai." in p for command in commands for p in command))

    def test_ui_source_and_test_automatically_select_the_profile(self):
        self.configure(self.profile)
        for path in ["modules/ui/shared/system-builder/SystemManagementWorkspace.tsx", self.profile["test_paths"][0]]:
            with self.subTest(path=path):
                selected = catalog.plan(self.root, [path], ["documentation"], "candidate")["selected"]
                self.assertIn("system-management-ui", {check["id"] for check in selected})
                self.assertNotIn("focused-tests", {check["id"] for check in selected})

    def test_unknown_and_explicit_generic_checks_are_retained(self):
        self.configure(self.profile)
        for paths, required, focused in [
            (self.profile["source_paths"] + self.profile["test_paths"], ["system-management-ui"], False),
            ([self.profile["test_paths"][0]], ["system-management-ui", "focused-tests"], True),
            ([self.profile["test_paths"][0], "apps/desktop/src/unrelated.ts"], ["system-management-ui"], True),
        ]:
            with self.subTest(paths=paths, required=required):
                selected = catalog.plan(self.root, paths, required, "candidate")["selected"]
                self.assertEqual("focused-tests" in {c["id"] for c in selected}, focused)
                self.assertEqual(next(c for c in selected if c["id"] == "system-management-ui")["argv"][-2:], ["--profile", "system-management-ui"])

    def test_unsafe_missing_non_test_and_controlled_inputs_fail_closed(self):
        for name in ["../outside.test.ts", "/outside.test.ts", "modules/ui/shared/missing.unit.test.ts", "modules/ui/shared/unsafe.ai.test.ts", "modules/ui/shared/marked.unit.test.ts", "modules/ui/shared/source.ts"]:
            with self.subTest(name=name):
                profile = copy.deepcopy(self.profile)
                profile["test_paths"] = [name]
                self.configure(profile)
                if name in ["modules/ui/shared/unsafe.ai.test.ts", "modules/ui/shared/marked.unit.test.ts", "modules/ui/shared/source.ts"]:
                    target = self.root / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("// @test-suite ai\n" if "marked" in name else "export {};\n", encoding="utf8")
                files = {} if "missing." in name else {name: "fixture"}
                with patch("run_focused_checks.snapshot", return_value={"files": files}), self.assertRaises(ControlError):
                    profile_commands(self.root, "system-management-ui")


if __name__ == "__main__":
    unittest.main()
