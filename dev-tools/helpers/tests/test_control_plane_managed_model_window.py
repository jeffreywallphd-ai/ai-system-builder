"""The Managed Model display profile selects one local feature, not a system suite."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ManagedModelWindowRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]

    def select(self, paths, required=("architecture",), root=None):
        return {c["id"]: c for c in catalog.plan(root or self.root, list(paths), list(required), "c" * 64)["selected"]}

    def test_fixed_feature_uses_only_its_driver_and_related_fixture_tests(self):
        for name in catalog.MANAGED_MODEL_WINDOW_REQUIRED[:2]:
            checks = self.select([name])
            self.assertIn("headless-managed-model-window-unit", checks)
            actual = checks["headless-managed-model-window-journey"]
            self.assertEqual(actual["argv"][1:], ["--import", "tsx", catalog.MANAGED_MODEL_WINDOW_REQUIRED[0]])
            self.assertEqual(actual["timeout"], 900)
            for broad in ("focused-tests", "completion-all", "headless-model-window-desktop-journey", "headless-bounded-text-feature"):
                self.assertNotIn(broad, checks)

    def test_unknown_or_explicit_generic_impact_cannot_borrow_controller_narrowing(self):
        self.assertIn("-k", self.select(catalog.MANAGED_MODEL_WINDOW_SCOPE)["control-plane"]["argv"])
        for paths, required in (([*catalog.MANAGED_MODEL_WINDOW_SCOPE, "modules/ui/shared/unknown.ts"], ("architecture",)),
                                (catalog.MANAGED_MODEL_WINDOW_SCOPE, ("focused-tests",))):
            checks = self.select(paths, required)
            self.assertIn("focused-tests", checks)
            self.assertNotIn("-k", checks["control-plane"]["argv"])

    def test_missing_and_directory_dependencies_refuse_the_complete_profile(self):
        with tempfile.TemporaryDirectory(prefix="managed-model-routing-") as temporary:
            root = Path(temporary)
            configuration = "dev-tools/config/contributor-check-profiles.json"
            target = root / configuration; target.parent.mkdir(parents=True)
            target.write_bytes((self.root / configuration).read_bytes())
            for name in (*catalog.MANAGED_MODEL_WINDOW_REQUIRED, catalog.MANAGED_MODEL_WINDOW_CONTROLLER,
                         "dev-tools/helpers/tests/test_control_plane_focused.py"):
                target = root / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_text("// inert\n")
            for name in catalog.MANAGED_MODEL_WINDOW_REQUIRED:
                target = root / name; target.unlink()
                for directory in (False, True):
                    if directory:
                        target.mkdir()
                    checks = self.select(catalog.MANAGED_MODEL_WINDOW_SCOPE, root=root)
                    self.assertNotIn("headless-managed-model-window-unit", checks)
                    self.assertNotIn("headless-managed-model-window-journey", checks)
                    self.assertNotIn("-k", checks["control-plane"]["argv"])
                    if directory:
                        target.rmdir()
                target.write_text("// inert\n")


if __name__ == "__main__":
    unittest.main()
