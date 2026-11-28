"""Text workflow source checks never opt into actual model execution."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TextWorkflowRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]

    def select(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "a" * 64)["selected"]}

    def test_source_edits_run_original_software_cases_and_strict_types_without_models(self):
        for path in catalog.TEXT_WORKFLOW_REQUIRED[:3]:
            checks = self.select([path])
            self.assertIn("headless-text-workflow-unit", checks)
            self.assertIn("headless-text-workflow-types", checks)
            self.assertNotIn("headless-bounded-text-feature", checks)
            self.assertNotIn("focused-tests", checks)
            self.assertNotIn(catalog.TEXT_WORKFLOW_FEATURE, checks["headless-text-workflow-unit"]["argv"])
            self.assertIn("--strict", checks["headless-text-workflow-types"]["argv"])

    def test_physical_model_execution_requires_explicit_check_selection(self):
        checks = self.select([], ("headless-bounded-text-feature",))
        self.assertEqual(set(checks), {"headless-bounded-text-feature"})
        self.assertIn(catalog.TEXT_WORKFLOW_FEATURE, checks["headless-bounded-text-feature"]["argv"])
        self.assertLessEqual(checks["headless-bounded-text-feature"]["timeout"], 300)

    def test_worker_tokenization_has_exact_software_coverage_without_physical_execution(self):
        for name in catalog.TEXT_TOKENIZATION_REQUIRED:
            checks = self.select([name])
            self.assertIn("headless-text-tokenization-unit", checks)
            self.assertNotIn("headless-bounded-text-feature", checks)
            self.assertNotIn("focused-tests", checks)
            self.assertEqual(checks["headless-text-tokenization-unit"]["argv"][-1],
                             "modules.adapters.runtime.python.worker.tests.test_local_text_generation")
        checks = self.select(catalog.TEXT_TOKENIZATION_SCOPE)
        self.assertIn("headless-text-tokenization-unit", checks)
        self.assertIn("-k", checks["control-plane"]["argv"])
        self.assertNotIn("headless-bounded-text-feature", checks)

    def test_complete_controller_scope_is_focused_but_unknown_and_explicit_fallback_remain(self):
        checks = self.select(catalog.TEXT_WORKFLOW_SCOPE)
        self.assertIn("-k", checks["control-plane"]["argv"])
        self.assertNotIn("headless-bounded-text-feature", checks)
        self.assertNotIn("focused-tests", checks)
        mixed = self.select([*catalog.TEXT_WORKFLOW_SCOPE, "modules/hosts/shared/unknown-text.ts"])
        self.assertIn("focused-tests", mixed)
        self.assertNotIn("-k", mixed["control-plane"]["argv"])
        self.assertIn("focused-tests", self.select(catalog.TEXT_WORKFLOW_SCOPE, ("focused-tests",)))

    def test_missing_source_or_directory_never_borrows_the_complete_profile(self):
        names = (*catalog.TEXT_WORKFLOW_REQUIRED, *catalog.TEXT_TOKENIZATION_REQUIRED, catalog.TEXT_WORKFLOW_CONTROLLER,
                 "dev-tools/helpers/tests/test_control_plane_focused.py")
        with tempfile.TemporaryDirectory(prefix="text-workflow-routing-") as temporary:
            root = Path(temporary)
            for name in names:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert\n")
            for name in catalog.TEXT_WORKFLOW_REQUIRED:
                target = root / name
                target.unlink()
                for directory in (False, True):
                    if directory:
                        target.mkdir()
                    checks = self.select(catalog.TEXT_WORKFLOW_SCOPE, root=root)
                    self.assertNotIn("headless-text-workflow-unit", checks)
                    self.assertNotIn("-k", checks["control-plane"]["argv"])
                    if directory:
                        target.rmdir()
                target.write_text("// inert\n")

    def test_fixed_commands_execute_only_the_controlled_cases_and_compile_the_physical_driver(self):
        checks = self.select([catalog.TEXT_WORKFLOW_FIXTURE])
        environment = dict(os.environ)
        environment.pop("NODE_TEST_CONTEXT", None)
        environment.pop("AISB_RUN_FIXED_NATIVE_QUALIFICATION", None)
        for name in ("headless-text-workflow-unit", "headless-text-workflow-types"):
            result = subprocess.run(checks[name]["argv"], cwd=self.root, env=environment,
                                    capture_output=True, timeout=90)
            self.assertEqual(result.returncode, 0, (result.stdout + result.stderr).decode(errors="replace")[-4000:])
        source = (self.root / catalog.TEXT_WORKFLOW_FEATURE).read_text()
        self.assertIn('startWithoutInstalling', source)
        self.assertIn('processMemoryBytes: 2 * GiB, jobMemoryBytes: 4 * GiB', source)
        self.assertIn('HF_HUB_OFFLINE: "1"', source)
        self.assertIn('modelQualityTested: false', source)
        self.assertNotIn('ensureModelDownloaded(', source)

    def test_missing_tokenization_support_preserves_conservative_coverage(self):
        names = (*catalog.TEXT_WORKFLOW_REQUIRED, *catalog.TEXT_TOKENIZATION_REQUIRED, catalog.TEXT_WORKFLOW_CONTROLLER,
                 "dev-tools/helpers/tests/test_control_plane_focused.py")
        with tempfile.TemporaryDirectory(prefix="text-tokenization-routing-") as temporary:
            root = Path(temporary)
            configuration = Path("dev-tools/config/contributor-check-profiles.json")
            (root / configuration).parent.mkdir(parents=True)
            (root / configuration).write_bytes((self.root / configuration).read_bytes())
            for name in names:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert\n")
            for name in catalog.TEXT_TOKENIZATION_REQUIRED:
                target = root / name
                target.unlink()
                for directory in (False, True):
                    if directory:
                        target.mkdir()
                    checks = self.select(catalog.TEXT_TOKENIZATION_SCOPE, root=root)
                    self.assertNotIn("headless-text-tokenization-unit", checks)
                    self.assertIn("focused-tests", checks)
                    self.assertNotIn("-k", checks["control-plane"]["argv"])
                    if directory:
                        target.rmdir()
                target.write_text("// inert\n")


if __name__ == "__main__":
    unittest.main()
