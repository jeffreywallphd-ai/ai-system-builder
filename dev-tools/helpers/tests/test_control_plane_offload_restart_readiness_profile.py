"""The restart-readiness profile runs only the pure arithmetic/admission tests."""
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
PROFILE = "offload-restart-readiness"
CONFIG = "dev-tools/config/contributor-check-profiles.json"
CORE = "dev-tools/scripts/qualification/offload_guarded_restart.py"
TEST = "dev-tools/scripts/qualification/tests/test_offload_guarded_restart.py"
GUARD = "dev-tools/helpers/tests/test_control_plane_offload_restart_readiness_profile.py"
README = "dev-tools/README.md"


class OffloadReadinessProfileTests(unittest.TestCase):
    def profile(self):
        return json.loads((ROOT / CONFIG).read_bytes())["profiles"][PROFILE]

    def fixture(self, root, profile):
        for name in set(profile["source_paths"] + profile["test_paths"]):
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / name).read_bytes())
        (root / CONFIG).write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {PROFILE: profile}}))

    def test_exact_runner_contains_only_pure_guard_tests(self):
        profile = self.profile()
        self.assertEqual(profile["test_paths"], [TEST])
        self.assertEqual(run_focused_checks.profile_commands(ROOT, PROFILE), [
            [sys.executable, "-B", "-m", "unittest", "discover", "-s",
             "dev-tools/scripts/qualification/tests", "-p", "test_offload_guarded_restart.py"]
        ])
        self.assertEqual(catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE], [CORE, TEST, GUARD])

    def test_complete_explicit_unknown_and_borrowed_impact_keep_their_guards(self):
        with tempfile.TemporaryDirectory(prefix="offload-readiness-profile-") as directory:
            root = Path(directory)
            self.fixture(root, self.profile())
            cases = [
                ([CORE, CONFIG, README], ["documentation"], True, False),
                ([GUARD], ["documentation"], True, False),
                ([CORE], ["focused-tests"], True, True),
                ([CORE, "modules/unknown/current.ts"], ["documentation"], True, True),
                ([README], ["documentation"], False, False),
            ]
            for paths, required, selected, generic in cases:
                with self.subTest(paths=paths, required=required):
                    ids = {c["id"] for c in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertEqual(PROFILE in ids, selected)
                    self.assertEqual("focused-tests" in ids, generic)

    def test_incomplete_profile_retains_generic_verification(self):
        with tempfile.TemporaryDirectory(prefix="offload-readiness-profile-") as directory:
            root = Path(directory)
            profile = self.profile()
            self.fixture(root, profile)
            broken = copy.deepcopy(profile)
            broken["source_paths"].remove(CORE)
            self.fixture(root, broken)
            ids = {c["id"] for c in catalog.plan(root, [CORE], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertIn(PROFILE, ids)
            self.assertIn("focused-tests", ids)

    def test_profile_does_not_capture_unrelated_native_or_model_sources(self):
        self.assertNotIn(CONFIG, catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE])
        self.assertNotIn(README, catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE])
        for path in [
            "modules/adapters/model/local/tests/windows-model-file-identity.native.integration.test.ts",
            "dev-tools/scripts/qualification/run_optional_generation_qualification.py",
            "modules/adapters/runtime/python/worker/tests/test_bounded_model_loader_native.py",
        ]:
            with self.subTest(path=path):
                ids = {c["id"] for c in catalog.plan(ROOT, [path], ["documentation"], "synthetic-candidate")["selected"]}
                self.assertNotIn(PROFILE, ids)
        self.assertEqual(len(self.profile()["test_paths"]), 1)


if __name__ == "__main__":
    unittest.main()
