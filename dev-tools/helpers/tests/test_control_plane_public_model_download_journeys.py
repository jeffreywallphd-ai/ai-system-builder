"""Controlled public host feature routing cannot claim provider/model qualification."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class PublicDownloadJourneyRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    identity = "headless-public-model-download-journeys"

    def select(self, root, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(root, list(paths), list(required), "a" * 64)["selected"]}

    def test_explicit_feature_source_selects_original_sequential_profile_and_strict_types(self):
        profile = catalog.PUBLISHED_FORM_CHECKS[self.identity]
        selected = self.select(self.root, profile["automatic_sources"])
        self.assertIn(self.identity, selected)
        self.assertIn("--test-concurrency=1", selected[self.identity]["argv"])
        self.assertEqual(selected[self.identity]["timeout"], 240)
        self.assertIn("--strict", selected[self.identity + "-types"]["argv"])
        for forbidden in ("completion-all", "headless-training-bounded-feature", "headless-bounded-text-feature"):
            self.assertNotIn(forbidden, selected)

    def test_default_fixture_changes_select_pure_checks_without_starting_host_journeys(self):
        worker = catalog.PUBLISHED_FORM_CHECKS["headless-public-model-download-worker-fixture-unit"]
        for source in worker["automatic_sources"]:
            selected = self.select(self.root, [source])
            self.assertNotIn(self.identity, selected)
            self.assertIn("headless-public-model-download-worker-fixture-unit", selected)

    def test_only_complete_known_change_set_receives_related_controller_collection(self):
        profile = catalog.PUBLISHED_FORM_CHECKS[self.identity]
        paths = list(profile["sources"])
        argv = self.select(self.root, paths, ["control-plane"])["control-plane"]["argv"]
        self.assertIn("test_control_plane_public_model_download_journeys.", argv)
        self.assertIn("test_control_plane_model_download_public_roots.", argv)
        for paths, required in [(paths + ["modules/hosts/shared/unknown.ts"], ["control-plane"]),
                                (paths, ["focused-tests"]),
                                ([p for p in paths if p != profile["automatic_sources"][0]], ["control-plane"])]:
            self.assertNotIn("-k", self.select(self.root, paths, required)["control-plane"]["argv"])

    def test_missing_or_directory_support_refuses_the_feature_profile(self):
        profile = catalog.PUBLISHED_FORM_CHECKS[self.identity]
        with tempfile.TemporaryDirectory(prefix="public-download-profile-") as folder:
            root = Path(folder)
            config = "dev-tools/config/contributor-check-profiles.json"
            (root / config).parent.mkdir(parents=True)
            (root / config).write_bytes((self.root / config).read_bytes())
            for name in profile["automatic_required_files"]:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("// controlled inert support\n")
            source = profile["automatic_sources"][0]
            self.assertIn(self.identity, self.select(root, [source]))
            for name in profile["automatic_required_files"]:
                path = root / name
                path.unlink()
                for directory in (False, True):
                    if directory:
                        path.mkdir()
                    self.assertNotIn(self.identity, self.select(root, [source]))
                    if directory:
                        path.rmdir()
                path.write_text("// controlled inert support\n")


if __name__ == "__main__":
    unittest.main()
