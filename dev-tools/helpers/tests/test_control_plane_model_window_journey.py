"""One fixed Desktop feature journey cannot select an entire UI suite."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelWindowJourneyRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]

    def select(self, paths, required=("architecture",), root=None):
        return {c["id"]: c for c in catalog.plan(root or self.root, list(paths), list(required), "b" * 64)["selected"]}

    def test_complete_sources_select_cleanup_types_and_the_fixed_single_case_driver(self):
        for source in catalog.MODEL_WINDOW_JOURNEY_REQUIRED:
            checks = self.select([source])
            for name in ("headless-model-window-profile-unit", "headless-model-window-profile-types", "headless-model-window-desktop-journey"):
                self.assertIn(name, checks)
            self.assertNotIn("focused-tests", checks)
            self.assertNotIn("completion-all", checks)
            self.assertNotIn("headless-bounded-text-feature", checks)
            journey = checks["headless-model-window-desktop-journey"]
            self.assertEqual(journey["argv"][1:], ["--import", "tsx", catalog.MODEL_WINDOW_JOURNEY_REQUIRED[2]])
            self.assertEqual(journey["timeout"], 720)
            self.assertIn("--strict", checks["headless-model-window-profile-types"]["argv"])

    def test_controller_narrowing_never_borrows_unknown_or_explicit_generic_impact(self):
        checks = self.select(catalog.MODEL_WINDOW_JOURNEY_SCOPE)
        self.assertIn("-k", checks["control-plane"]["argv"])
        self.assertNotIn("focused-tests", checks)
        mixed = self.select([*catalog.MODEL_WINDOW_JOURNEY_SCOPE, "modules/ui/shared/unknown.tsx"])
        self.assertIn("focused-tests", mixed)
        self.assertNotIn("-k", mixed["control-plane"]["argv"])
        explicit = self.select(catalog.MODEL_WINDOW_JOURNEY_SCOPE, ("focused-tests",))
        self.assertIn("focused-tests", explicit)
        self.assertNotIn("-k", explicit["control-plane"]["argv"])

    def test_missing_or_directory_dependency_cannot_start_the_complete_profile(self):
        with tempfile.TemporaryDirectory(prefix="model-window-routing-") as temporary:
            root = Path(temporary)
            configuration = "dev-tools/config/contributor-check-profiles.json"
            config_target = root / configuration
            config_target.parent.mkdir(parents=True, exist_ok=True)
            config_target.write_bytes((self.root / configuration).read_bytes())
            for name in (*catalog.MODEL_WINDOW_JOURNEY_REQUIRED, catalog.MODEL_WINDOW_JOURNEY_CONTROLLER,
                         "dev-tools/helpers/tests/test_control_plane_focused.py"):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert\n")
            for name in catalog.MODEL_WINDOW_JOURNEY_REQUIRED:
                target = root / name
                target.unlink()
                for directory in (False, True):
                    if directory:
                        target.mkdir()
                    checks = self.select(catalog.MODEL_WINDOW_JOURNEY_SCOPE, root=root)
                    for identity in ("headless-model-window-profile-unit", "headless-model-window-profile-types", "headless-model-window-desktop-journey"):
                        self.assertNotIn(identity, checks)
                    self.assertNotIn("-k", checks["control-plane"]["argv"])
                    if directory:
                        target.rmdir()
                target.write_text("// inert\n")


if __name__ == "__main__":
    unittest.main()
