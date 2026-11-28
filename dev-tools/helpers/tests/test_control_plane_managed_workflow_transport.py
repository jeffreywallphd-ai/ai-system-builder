"""Exact Managed read integration stays feature-scoped and starts no models."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ManagedWorkflowTransportRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]

    def select(self, paths, required=("architecture",), root=None):
        return {c["id"]: c for c in catalog.plan(root or self.root, list(paths), list(required), "b" * 64)["selected"]}

    def test_known_transport_impact_selects_exact_real_tests_and_strict_types(self):
        for source in catalog.MANAGED_WORKFLOW_TRANSPORT_REQUIRED:
            checks = self.select([source])
            self.assertIn("managed-workflow-transport-unit", checks)
            self.assertIn("managed-workflow-transport-types", checks)
            self.assertIn("managed-workflow-mcp-types", checks)
            self.assertNotIn("focused-tests", checks)
            self.assertNotIn("completion-all", checks)
            self.assertNotIn("headless-bounded-text-feature", checks)
            self.assertIn("--strict", checks["managed-workflow-transport-types"]["argv"])
            for test in catalog.MANAGED_WORKFLOW_TRANSPORT_TESTS:
                self.assertIn(test, checks["managed-workflow-transport-unit"]["argv"])

    def test_controller_scope_keeps_unknown_and_explicit_generic_fallback(self):
        checks = self.select(catalog.MANAGED_WORKFLOW_TRANSPORT_SCOPE)
        self.assertIn("-k", checks["control-plane"]["argv"])
        self.assertNotIn("focused-tests", checks)
        mixed = self.select([*catalog.MANAGED_WORKFLOW_TRANSPORT_SCOPE, "modules/contracts/headless/unknown.ts"])
        self.assertIn("focused-tests", mixed)
        self.assertNotIn("-k", mixed["control-plane"]["argv"])
        explicit = self.select(catalog.MANAGED_WORKFLOW_TRANSPORT_SCOPE, ("focused-tests",))
        self.assertIn("focused-tests", explicit)
        self.assertNotIn("-k", explicit["control-plane"]["argv"])

    def test_missing_or_directory_source_keeps_conservative_coverage(self):
        with tempfile.TemporaryDirectory(prefix="managed-read-routing-") as temporary:
            root = Path(temporary)
            names = (*catalog.MANAGED_WORKFLOW_TRANSPORT_REQUIRED, catalog.MANAGED_WORKFLOW_TRANSPORT_CONTROLLER,
                     "dev-tools/helpers/tests/test_control_plane_focused.py")
            for name in names:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert\n")
            for name in catalog.MANAGED_WORKFLOW_TRANSPORT_REQUIRED:
                target = root / name
                target.unlink()
                for directory in (False, True):
                    if directory:
                        target.mkdir()
                    checks = self.select(catalog.MANAGED_WORKFLOW_TRANSPORT_SCOPE, root=root)
                    self.assertNotIn("managed-workflow-transport-unit", checks)
                    self.assertNotIn("managed-workflow-transport-types", checks)
                    self.assertNotIn("managed-workflow-mcp-types", checks)
                    self.assertNotIn("-k", checks["control-plane"]["argv"])
                    if directory:
                        target.rmdir()
                target.write_text("// inert\n")


if __name__ == "__main__":
    unittest.main()
