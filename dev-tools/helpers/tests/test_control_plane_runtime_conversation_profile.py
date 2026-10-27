"""Published conversation selection stays exact and separate from actual inference."""
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


class RuntimeConversationProfileTests(unittest.TestCase):
    def setUp(self):
        self.actual = HELPERS.parents[1]
        self.config = "dev-tools/config/contributor-check-profiles.json"
        self.profile = json.loads((self.actual / self.config).read_bytes())["profiles"]["system-runtime-conversation-ui"]
        self.temp = tempfile.TemporaryDirectory(prefix="runtime-conversation-profile-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def configure(self, profile):
        p = self.root / self.config
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"system-runtime-conversation-ui": profile}}), encoding="utf8")

    def test_exact_ui_and_preload_tests_use_fixed_runners(self):
        expected = ['apps/desktop/src/system-runtime/tests/SystemRuntimeApp.interaction.ui.test.tsx', 'apps/desktop/src/system-runtime-preload/tests/systemRuntimePreloadApi.unit.test.ts']
        self.assertEqual(self.profile["test_paths"], expected)
        self.assertEqual(self.profile["source_paths"], ['dev-tools/config/contributor-check-profiles.json', 'apps/desktop/src/system-runtime/SystemRuntimeApp.tsx', 'apps/desktop/src/system-runtime-preload/systemRuntimePreloadApi.ts'])
        # This unit verifies runner classification, not whole-repository scanning.
        # Retain the real config and real test bytes; supply only file membership.
        with patch("run_focused_checks.snapshot", return_value={"files": {name: "unit-fixture" for name in expected}}):
            commands = profile_commands(self.actual, "system-runtime-conversation-ui")
        self.assertEqual(commands, [["node", "--import", "tsx", "--test", "--", expected[1]], ["node", "dev-tools/helpers/run_vitest_checks.mjs", "--", expected[0]]])
        self.assertFalse(any("playwright" in p or ".e2e.spec." in p or ".ai." in p for command in commands for p in command))

    def test_ui_source_and_test_automatically_select_the_profile(self):
        self.configure(self.profile)
        for path in ['apps/desktop/src/system-runtime/SystemRuntimeApp.tsx', 'apps/desktop/src/system-runtime-preload/systemRuntimePreloadApi.ts', 'apps/desktop/src/system-runtime/tests/SystemRuntimeApp.interaction.ui.test.tsx', 'apps/desktop/src/system-runtime-preload/tests/systemRuntimePreloadApi.unit.test.ts']:
            with self.subTest(path=path):
                selected = catalog.plan(self.root, [path], ["documentation"], "candidate")["selected"]
                self.assertIn("system-runtime-conversation-ui", {check["id"] for check in selected})
                self.assertNotIn("focused-tests", {check["id"] for check in selected})

    def test_unknown_and_explicit_generic_checks_are_retained(self):
        self.configure(self.profile)
        for paths, required, focused in [
            (self.profile["source_paths"] + self.profile["test_paths"], ["system-runtime-conversation-ui"], False),
            ([self.profile["test_paths"][0]], ["system-runtime-conversation-ui", "focused-tests"], True),
            ([self.profile["test_paths"][0], "apps/desktop/src/unrelated.ts"], ["system-runtime-conversation-ui"], True),
        ]:
            with self.subTest(paths=paths, required=required):
                selected = catalog.plan(self.root, paths, required, "candidate")["selected"]
                self.assertEqual("focused-tests" in {c["id"] for c in selected}, focused)
                self.assertEqual(next(c for c in selected if c["id"] == "system-runtime-conversation-ui")["argv"][-2:], ["--profile", "system-runtime-conversation-ui"])

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
                    profile_commands(self.root, "system-runtime-conversation-ui")


if __name__ == "__main__":
    unittest.main()
