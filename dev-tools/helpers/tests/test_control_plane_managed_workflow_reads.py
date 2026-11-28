"""Managed workflow read components cannot opt into physical qualification."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ManagedWorkflowReadRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]

    def select(self, paths, required=("architecture",), root=None):
        return {c["id"]: c for c in catalog.plan(root or self.root, list(paths), list(required), "b" * 64)["selected"]}

    def test_component_sources_select_units_types_and_actual_server_build_without_models(self):
        for source in catalog.MANAGED_WORKFLOW_READ_REQUIRED[:2]:
            checks = self.select([source])
            for name in ("managed-workflow-read-unit", "managed-workflow-read-types", "managed-workflow-read-server-build"):
                self.assertIn(name, checks)
            self.assertNotIn("focused-tests", checks)
            self.assertNotIn("headless-bounded-text-feature", checks)
            self.assertNotIn("headless-training-bounded-feature", checks)
            self.assertNotIn("completion-all", checks)
            self.assertIn("--strict", checks["managed-workflow-read-types"]["argv"])
            self.assertEqual(checks["managed-workflow-read-server-build"]["argv"][-2:], ["-p", "apps/server/tsconfig.json"])

    def test_exact_controller_scope_is_focused_and_unknown_or_requested_fallback_is_preserved(self):
        checks = self.select(catalog.MANAGED_WORKFLOW_READ_SCOPE)
        self.assertIn("-k", checks["control-plane"]["argv"])
        self.assertNotIn("focused-tests", checks)
        mixed = self.select([*catalog.MANAGED_WORKFLOW_READ_SCOPE, "modules/hosts/server/composition/other.ts"])
        self.assertIn("focused-tests", mixed)
        self.assertNotIn("-k", mixed["control-plane"]["argv"])
        explicit = self.select(catalog.MANAGED_WORKFLOW_READ_SCOPE, ("focused-tests",))
        self.assertIn("focused-tests", explicit)
        self.assertNotIn("-k", explicit["control-plane"]["argv"])

    def test_missing_or_directory_dependencies_cannot_borrow_the_complete_component_profile(self):
        names = (*catalog.MANAGED_WORKFLOW_READ_REQUIRED, catalog.MANAGED_WORKFLOW_READ_CONTROLLER,
                 "dev-tools/helpers/tests/test_control_plane_focused.py")
        with tempfile.TemporaryDirectory(prefix="managed-workflow-routing-") as temporary:
            root = Path(temporary)
            for name in names:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert\n")
            for name in catalog.MANAGED_WORKFLOW_READ_REQUIRED:
                target = root / name
                target.unlink()
                for directory in (False, True):
                    if directory:
                        target.mkdir()
                    checks = self.select(catalog.MANAGED_WORKFLOW_READ_SCOPE, root=root)
                    self.assertNotIn("managed-workflow-read-unit", checks)
                    self.assertNotIn("managed-workflow-read-types", checks)
                    self.assertNotIn("-k", checks["control-plane"]["argv"])
                    if directory:
                        target.rmdir()
                target.write_text("// inert\n")

    def test_fixed_component_commands_execute_without_a_runtime_or_model(self):
        checks = self.select([catalog.MANAGED_WORKFLOW_READ_REQUIRED[1]])
        environment = dict(os.environ)
        environment.pop("NODE_TEST_CONTEXT", None)
        environment.pop("AISB_RUN_FIXED_NATIVE_QUALIFICATION", None)
        for name in ("managed-workflow-read-unit", "managed-workflow-read-types"):
            run = subprocess.run(checks[name]["argv"], cwd=self.root, env=environment, capture_output=True, timeout=90)
            self.assertEqual(run.returncode, 0, (run.stdout + run.stderr).decode(errors="replace")[-3000:])


if __name__ == "__main__":
    unittest.main()
