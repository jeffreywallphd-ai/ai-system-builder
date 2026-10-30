"""Windows identity profile: fixed model-free units, separate native evidence."""
from pathlib import Path
import copy
import json
import sys
import tempfile
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
import run_focused_checks

ROOT = HELPERS.parents[1]
PROFILE = "windows-file-identity"
CONFIG = "dev-tools/config/contributor-check-profiles.json"
CORE = "modules/adapters/model/local/native/windows/model_file_identity.cc"
UNIT = "modules/adapters/model/local/tests/windows-model-file-identity.unit.test.ts"
BUILD_UNIT = "dev-tools/scripts/native/tests/test_build_windows_model_file_identity.py"
NATIVE = "modules/adapters/model/local/tests/windows-model-file-identity.native.integration.test.ts"
GUARD = "dev-tools/helpers/tests/test_control_plane_windows_identity_profile.py"


class WindowsIdentityProfileTests(unittest.TestCase):
    def profile(self):
        return json.loads((ROOT / CONFIG).read_bytes())["profiles"][PROFILE]

    def fixture(self, root, profile):
        for name in set(profile["source_paths"] + profile["test_paths"]):
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / name).read_bytes())
        (root / CONFIG).write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {PROFILE: profile}}))

    def test_exact_runner_has_only_two_model_free_unit_files(self):
        profile = self.profile()
        self.assertEqual(profile["test_paths"], [UNIT, BUILD_UNIT])
        self.assertEqual(run_focused_checks.profile_commands(ROOT, PROFILE), [
            ["node", "--import", "tsx", "--test", "--", UNIT],
            [sys.executable, "-B", "-m", "unittest", "discover", "-s",
             "dev-tools/scripts/native/tests", "-p", "test_build_windows_model_file_identity.py"],
        ])
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE]), 8)
        self.assertIn(CORE, catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE])
        self.assertIn(GUARD, catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE])
        self.assertNotIn(NATIVE, profile["test_paths"])

    def test_native_builder_also_selects_the_required_dependency_audit(self):
        builder = "dev-tools/scripts/native/build_windows_model_file_identity.py"
        ids = {c["id"] for c in catalog.plan(ROOT, [builder], ["documentation"], "synthetic-candidate")["selected"]}
        self.assertIn(PROFILE, ids)
        self.assertIn("dependencies", ids)
        self.assertNotIn("focused-tests", ids)

    def test_known_explicit_unknown_and_borrowed_changes_keep_their_guards(self):
        with tempfile.TemporaryDirectory(prefix="windows-identity-profile-") as directory:
            root = Path(directory)
            self.fixture(root, self.profile())
            cases = [
                ([CORE, CONFIG, "dev-tools/README.md"], ["documentation"], True, False),
                ([GUARD], ["documentation"], True, False),
                ([CORE], ["focused-tests"], True, True),
                ([CORE, "modules/unknown/current.ts"], ["documentation"], True, True),
                (["dev-tools/README.md"], ["documentation"], False, False),
            ]
            for paths, required, selected, generic in cases:
                with self.subTest(paths=paths, required=required):
                    ids = {c["id"] for c in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertEqual(PROFILE in ids, selected)
                    self.assertEqual("focused-tests" in ids, generic)

    def test_incomplete_declaration_does_not_replace_generic_tests(self):
        with tempfile.TemporaryDirectory(prefix="windows-identity-profile-") as directory:
            root = Path(directory)
            profile = self.profile()
            self.fixture(root, profile)
            broken = copy.deepcopy(profile)
            broken["source_paths"].remove(CORE)
            self.fixture(root, broken)
            ids = {c["id"] for c in catalog.plan(root, [CORE], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertIn(PROFILE, ids)
            self.assertIn("focused-tests", ids)

    def test_unrelated_runtime_and_recovery_do_not_select_this_profile(self):
        self.assertNotIn(CONFIG, catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE])
        for name in ["dev-tools/scripts/qualification/offload_guarded_restart.py",
                     "dev-tools/scripts/qualification/run_optional_generation_qualification.py",
                     "modules/adapters/runtime/python/worker/tests/test_bounded_model_loader_native.py"]:
            with self.subTest(name=name):
                ids = {c["id"] for c in catalog.plan(ROOT, [name], ["documentation"], "synthetic-candidate")["selected"]}
                self.assertNotIn(PROFILE, ids)


if __name__ == "__main__":
    unittest.main()
