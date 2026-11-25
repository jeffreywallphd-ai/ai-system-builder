"""Original-session readiness keeps exact whole-feature checks and fallback."""
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingSessionExitRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    check = "headless-training-session-exit-ready-unit"
    target = "modules/adapters/runtime/python/worker/tests/test_original_training_session_exit.py"

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "a"*64)["selected"]}

    def support(self):
        return set(catalog.TRAINING_SESSION_EXIT_SCOPE + catalog.TRAINING_SESSION_EXIT_OWNER_SCOPE
            + tuple("dev-tools/helpers/tests/"+name.split(".")[0]+".py" for name in catalog.TRAINING_SESSION_EXIT_CONTROLLER_FILTERS)
            + tuple(name for identity in (self.check, "headless-training-runtime-unit", "headless-training-runtime-worker-unit", "headless-training-exit-barrier-unit")
                for name in catalog.PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))

    def test_exact_sources_keep_whole_new_and_legacy_commands_without_models_or_full_suite(self):
        definition = catalog.PUBLISHED_FORM_CHECKS[self.check]
        for source in definition["automatic_sources"]:
            rows = self.selected([source]); command = rows[self.check]["argv"]
            self.assertEqual(command, [sys.executable, "-B", "-m", "unittest", "-v", self.target,
                "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py"])
            self.assertNotIn("focused-tests", rows)
            self.assertFalse(any(value in arg for row in rows.values() for arg in row["argv"]
                for value in ("test:all", "model-blocker", "qualify_windows")))
        # Broad app/HTTP edits retain their existing profiles. This new proof
        # must not acquire automatic coverage of every route/client change.
        for source in ("modules/adapters/runtime/python/worker/app.py", "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts"):
            rows = self.selected([source]); self.assertNotIn(self.check, rows)
            self.assertIn("focused-tests", self.selected([source], ("architecture", "focused-tests")))
        self.assertIn("focused-tests", self.selected([self.target], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.target, "modules/adapters/unknown.py"]))

    def test_each_regular_required_file_is_mandatory(self):
        definition = catalog.PUBLISHED_FORM_CHECKS[self.check]; source = definition["automatic_sources"][0]
        with tempfile.TemporaryDirectory(prefix="session-exit-route-") as temporary:
            root = Path(temporary)
            for name in definition["automatic_required_files"]:
                target = root/name; target.parent.mkdir(parents=True, exist_ok=True); target.write_text("# Presence only.\n")
            for name in definition["automatic_required_files"]:
                target = root/name; target.unlink()
                for directory in (False, True):
                    if directory: target.mkdir()
                    rows = self.selected([source], root=root)
                    self.assertNotIn(self.check, rows); self.assertIn("focused-tests", rows)
                    if directory: target.rmdir()
                target.write_text("# Presence only.\n")

    def test_only_closed_complete_scope_gets_whole_related_controller_modules(self):
        core, owners = catalog.TRAINING_SESSION_EXIT_SCOPE, catalog.TRAINING_SESSION_EXIT_OWNER_SCOPE
        expected = [sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
            *[part for name in catalog.TRAINING_SESSION_EXIT_CONTROLLER_FILTERS for part in ("-k", name)]]
        for scope in (core, core+owners, *[core+(name,) for name in owners]):
            row = self.selected(scope, ("control-plane",))["control-plane"]
            self.assertEqual(row["argv"], expected); self.assertEqual(row["timeout"], 600)
        rows = self.selected(core+owners, ("control-plane", "headless-training-runtime-unit", "headless-training-runtime-worker-unit", "headless-training-exit-barrier-unit"))
        self.assertNotIn("focused-tests", rows)
        default = next(row["argv"] for row in catalog.definitions(self.root) if row["id"] == "control-plane")
        for scope, required in (((), ("control-plane",)), (core[:-1], ("control-plane",)),
            ((owners[0],), ("control-plane",)), (core+owners+("docs/unknown.md",), ("control-plane",)),
            (core+owners, ("control-plane", "focused-tests"))):
            self.assertEqual(self.selected(scope, required)["control-plane"]["argv"], default)
        original = catalog._automatic_files_available
        for missing in self.support():
            def available(root, check):
                return False if missing in check.get("automatic_required_files", ()) else original(root, check)
            with self.subTest(missing=missing), patch.object(catalog, "_automatic_files_available", side_effect=available):
                self.assertEqual(self.selected(core+owners, ("control-plane",))["control-plane"]["argv"], default)

    def test_registered_command_executes_genuine_local_proof_and_legacy_compatibility(self):
        command = self.selected([self.target])[self.check]["argv"]
        result = subprocess.run(command, cwd=self.root, capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout[-2000:]+result.stderr[-6000:])
        self.assertIn("test_same_original_executor_and_genuine_file_proof", result.stderr)
        self.assertIn("test_legacy_session_never_looks_up", result.stderr)
        match = re.search(r"Ran (\d+) tests", result.stderr); self.assertIsNotNone(match)
        self.assertGreaterEqual(int(match.group(1)), 68); self.assertRegex(result.stderr, r"(?m)^OK$")
        self.assertNotRegex(result.stderr, r"skipped|FAILED|ERROR|FAIL:")


if __name__ == "__main__": unittest.main()
