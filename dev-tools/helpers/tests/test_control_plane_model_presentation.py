"""Saved Model display needs exact feature evidence, never a model execution."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelPresentationRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]

    def select(self, paths, required=("architecture",), root=None):
        return {c["id"]: c for c in catalog.plan(root or self.root, list(paths), list(required), "b" * 64)["selected"]}

    def test_known_sources_select_original_reader_rendering_and_strict_production_types(self):
        for source in catalog.MODEL_PRESENTATION_REQUIRED:
            checks = self.select([source])
            for name in ("headless-model-record-presentation-unit", "headless-model-record-presentation-types"):
                self.assertIn(name, checks)
            self.assertNotIn("focused-tests", checks)
            self.assertNotIn("completion-all", checks)
            self.assertNotIn("headless-bounded-text-feature", checks)
            self.assertIn("--strict", checks["headless-model-record-presentation-types"]["argv"])
            for index in (1, 4, 6, 11, 12):
                self.assertIn(catalog.MODEL_PRESENTATION_REQUIRED[index], checks["headless-model-record-presentation-unit"]["argv"])

    def test_exact_controller_scope_preserves_unknown_and_explicit_fallback(self):
        checks = self.select(catalog.MODEL_PRESENTATION_SCOPE)
        self.assertIn("-k", checks["control-plane"]["argv"])
        self.assertNotIn("focused-tests", checks)
        mixed = self.select([*catalog.MODEL_PRESENTATION_SCOPE, "modules/hosts/shared/composition/unknown.ts"])
        self.assertIn("focused-tests", mixed)
        self.assertNotIn("-k", mixed["control-plane"]["argv"])
        explicit = self.select(catalog.MODEL_PRESENTATION_SCOPE, ("focused-tests",))
        self.assertIn("focused-tests", explicit)
        self.assertNotIn("-k", explicit["control-plane"]["argv"])

    def test_missing_or_directory_dependency_refuses_the_complete_profile(self):
        with tempfile.TemporaryDirectory(prefix="model-presentation-routing-") as temporary:
            root = Path(temporary)
            for name in (*catalog.MODEL_PRESENTATION_REQUIRED, catalog.MODEL_PRESENTATION_CONTROLLER,
                         "dev-tools/helpers/tests/test_control_plane_focused.py"):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert\n")
            for name in catalog.MODEL_PRESENTATION_REQUIRED:
                target = root / name
                target.unlink()
                for directory in (False, True):
                    if directory:
                        target.mkdir()
                    checks = self.select(catalog.MODEL_PRESENTATION_SCOPE, root=root)
                    self.assertNotIn("headless-model-record-presentation-unit", checks)
                    self.assertNotIn("headless-model-record-presentation-types", checks)
                    self.assertNotIn("-k", checks["control-plane"]["argv"])
                    if directory:
                        target.rmdir()
                target.write_text("// inert\n")


if __name__ == "__main__":
    unittest.main()
