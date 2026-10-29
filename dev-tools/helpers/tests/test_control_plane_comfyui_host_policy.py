"""The restrictive ComfyUI composition check owns only its finite feature scope."""
from pathlib import Path
import copy
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
from control_plane.contracts import ControlError
from control_plane.common import read_json
import run_focused_checks

CONFIG = "dev-tools/config/contributor-check-profiles.json"
SOURCE = "modules/hosts/shared/resolveComfyUiAutoInstall.ts"
TEST = "modules/hosts/shared/resolveComfyUiAutoInstall.unit.test.ts"
LOWER_TEST = "modules/adapters/runtime/comfyui/tests/createComfyUiRuntimeSupervisor.unit.test.ts"
SELF = "dev-tools/helpers/tests/test_control_plane_comfyui_host_policy.py"
PROFILE = "comfyui-host-policy"


class ComfyUiHostPolicyProfileTests(unittest.TestCase):
    def profile(self):
        return read_json(HELPERS.parents[1] / CONFIG)["profiles"][PROFILE]

    def fixture(self, root, profile):
        target = root / CONFIG
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {PROFILE: profile}}), encoding="utf8")

    def test_exact_bounded_commands_and_borrowed_supervisor_coverage(self):
        root = HELPERS.parents[1]
        profile = self.profile()
        self.assertEqual(profile["test_paths"], [TEST, LOWER_TEST, SELF])
        self.assertEqual(catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE], [SOURCE, TEST])
        self.assertEqual(run_focused_checks.profile_commands(root, PROFILE), [
            ["node", "--import", "tsx", "--test", "--", LOWER_TEST, TEST],
            [sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane_comfyui_host_policy.py"],
        ])
        for borrowed in [LOWER_TEST, "modules/hosts/server/composition/composeServerHost.ts", "modules/hosts/desktop/composition/composeDesktopComfyUiImageRuntimeFeature.ts"]:
            self.assertIn(borrowed, profile["source_paths"])
            self.assertNotIn(borrowed, catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE])

    def test_finite_coverage_preserves_unknown_explicit_and_incomplete_fallback(self):
        for source in [SOURCE, TEST]:
            for incomplete, required, unknown, generic in [
                (False, ["documentation"], False, False),
                (True, ["documentation"], False, True),
                (False, ["focused-tests"], False, True),
                (False, ["documentation"], True, True),
            ]:
                with self.subTest(source=source, incomplete=incomplete, required=required, unknown=unknown), tempfile.TemporaryDirectory(prefix="comfy-host-profile-") as directory:
                    root = Path(directory)
                    profile = copy.deepcopy(self.profile())
                    if incomplete:
                        profile["source_paths"].remove(source)
                        if source in profile["test_paths"]:
                            profile["test_paths"].remove(source)
                    self.fixture(root, profile)
                    paths = [source, CONFIG] + (["modules/unknown/unowned.ts"] if unknown else [])
                    selected = {row["id"] for row in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertIn(PROFILE, selected)
                    self.assertEqual("focused-tests" in selected, generic)

    def test_unrelated_host_change_keeps_generic_tests(self):
        with tempfile.TemporaryDirectory(prefix="comfy-host-unknown-") as directory:
            root = Path(directory)
            self.fixture(root, self.profile())
            selected = {row["id"] for row in catalog.plan(root, ["modules/hosts/shared/unknown.ts"], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertNotIn(PROFILE, selected)
            self.assertIn("focused-tests", selected)

    def test_unsafe_and_ai_paths_never_become_commands(self):
        for test in ["../outside.test.ts", "modules/host/source.ts", "modules/model/example.ai.test.ts", "modules/runtime/tests/test_context_generation_ai_e2e.py"]:
            with self.subTest(test=test), tempfile.TemporaryDirectory(prefix="comfy-host-denial-") as directory:
                root = Path(directory)
                self.fixture(root, {"test_paths": [test], "source_paths": [test]})
                with patch.object(run_focused_checks, "snapshot", return_value={"files": {test: "synthetic"}}):
                    with self.assertRaises(ControlError):
                        run_focused_checks.profile_commands(root, PROFILE)


if __name__ == "__main__":
    unittest.main()
