"""The public Settings credential fixture has bounded source-only checks."""
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
CONFIG = "dev-tools/config/contributor-check-profiles.json"
SOURCE = "dev-tools/scripts/qualification/visual-composer/visual-composer-global-setup.mjs"
IDENTITY_TEST = "dev-tools/scripts/qualification/tests/settings-public-identity.unit.test.mjs"
ROUTING_TEST = "dev-tools/helpers/tests/test_control_plane_settings_public_identity_profile.py"
LIFECYCLE_TEST = "dev-tools/scripts/qualification/tests/visual-composer-host-lifecycle.unit.test.mjs"


class PublicSettingsIdentityProfile(unittest.TestCase):
    def profile(self):
        return json.loads((ROOT / CONFIG).read_bytes())["profiles"]["host-setup-policy"]

    def fixture(self, root, profile):
        for name in set(profile["source_paths"] + profile["test_paths"]):
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / name).read_bytes())
        (root / CONFIG).write_text(json.dumps({
            "schema_version": "contributor-check-profiles-v1",
            "profiles": {"host-setup-policy": profile},
        }), encoding="utf8")

    def test_known_ownership_does_not_hide_explicit_unknown_or_incomplete_impact(self):
        profile = self.profile()
        with tempfile.TemporaryDirectory(prefix="settings-identity-profile-") as directory:
            root = Path(directory)
            self.fixture(root, profile)
            for paths, required, generic in (
                ([SOURCE, IDENTITY_TEST, ROUTING_TEST], ["documentation"], False),
                ([SOURCE], ["focused-tests"], True),
                ([SOURCE, "modules/unknown/new.ts"], ["documentation"], True),
            ):
                with self.subTest(paths=paths, required=required):
                    ids = {c["id"] for c in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertIn("host-setup-policy", ids)
                    self.assertNotIn("operational-ui", ids)
                    self.assertEqual("focused-tests" in ids, generic)
            incomplete = copy.deepcopy(profile)
            incomplete["source_paths"].remove(SOURCE)
            self.fixture(root, incomplete)
            ids = {c["id"] for c in catalog.plan(root, [SOURCE], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertIn("focused-tests", ids)

    def test_profile_runs_real_fixture_and_existing_lifecycle_tests_without_host_effects(self):
        profile = self.profile()
        self.assertEqual(set(profile["test_paths"]), {IDENTITY_TEST, ROUTING_TEST, LIFECYCLE_TEST})
        self.assertTrue(set(catalog.QUALIFICATION_PROFILE_PATTERNS["host-setup-policy"]).issubset(profile["source_paths"]))
        # The registered runner requires a real source snapshot. Use this
        # repository rather than pretending the routing-only fixture is Git.
        commands = run_focused_checks.profile_commands(ROOT, "host-setup-policy")
        self.assertEqual(len(commands), 2)
        node = next(c for c in commands if "--test" in c)
        python = next(c for c in commands if "unittest" in c)
        self.assertEqual(node, ["node", "--test", "--", IDENTITY_TEST, LIFECYCLE_TEST])
        self.assertEqual(python, [sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", Path(ROUTING_TEST).name])
        text = json.dumps(commands)
        for forbidden in ("playwright", "npm", "test:all", "test:standardande2e", "--native", "package"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
