"""Fixed original-session profiles and conservative missing-fixture fallback."""
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingRuntimeRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    node_test = "modules/adapters/runtime/python/tests/approved-training-runtime-session.unit.test.ts"
    worker_test = "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py"
    native_node = "modules/adapters/runtime/python/supervisor/windowsOriginalWorkerLaunch.ts"
    native_python = "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py"
    sealed_fixture = "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json"
    observed_source = "modules/adapters/runtime/python/client/originalTrainingModelSource.ts"
    observed_test = "modules/adapters/runtime/python/tests/original-training-model-source.unit.test.ts"
    profiles = ("headless-training-runtime-unit", "headless-training-runtime-types", "headless-training-runtime-worker-unit")

    def select(self, paths, root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, paths, ["architecture"], "a" * 64)["selected"]}

    def test_actual_profiles_select_narrow_executors_and_strict_consumers(self):
        rows = self.select([self.node_test, self.worker_test])
        self.assertTrue(set(self.profiles) <= set(rows))
        self.assertIn(self.node_test, rows[self.profiles[0]]["argv"])
        self.assertIn("--strict", rows[self.profiles[1]]["argv"])
        self.assertIn(self.node_test, rows[self.profiles[1]]["argv"])
        self.assertIn(self.worker_test, rows[self.profiles[2]]["argv"])
        self.assertIn("modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py", rows[self.profiles[2]]["argv"])
        for name in ("completion-all", "completion-standardande2e", "focused-tests"):
            self.assertNotIn(name, rows)
        self.assertFalse(any("model-blocker" in arg or "test:all" in arg for row in rows.values() for arg in row["argv"]))

    def test_native_source_changes_select_actual_controller_and_worker_fixtures(self):
        rows = self.select([self.native_node, self.native_python])
        self.assertTrue(set(self.profiles) <= set(rows))
        self.assertIn("headless-context-existing-runtime", rows)
        self.assertIn("modules/adapters/runtime/python/tests/createPythonRuntimeSupervisor.unit.test.ts",
                      rows["headless-context-existing-runtime"]["argv"])
        self.assertIn("modules/adapters/runtime/python/tests/createPythonRuntimeSupervisor.unit.test.ts", rows[self.profiles[1]]["argv"])
        self.assertIn(self.worker_test, rows[self.profiles[2]]["argv"])
        self.assertNotIn("focused-tests", rows)
        for row in rows.values():
            self.assertNotIn(self.native_python, row["argv"])  # Never execute the real controller as a test.
            self.assertFalse(any("test:all" in arg or "model-blocker" in arg for arg in row["argv"]))

    def test_observed_source_uses_actual_file_owner_tests_and_strict_consumers_only(self):
        for source in (self.observed_source, self.observed_test):
            rows = self.select([source])
            self.assertTrue(set(self.profiles[:2]) <= set(rows))
            self.assertIn(self.observed_test, rows[self.profiles[0]]["argv"])
            self.assertIn(self.observed_test, rows[self.profiles[1]]["argv"])
            self.assertIn("--strict", rows[self.profiles[1]]["argv"])
            self.assertNotIn(self.profiles[2], rows)
            self.assertNotIn("focused-tests", rows)
            for row in rows.values():
                self.assertNotIn(self.native_python, row["argv"])
                self.assertFalse(any("test:all" in arg or "model-blocker" in arg for arg in row["argv"]))

    def test_missing_observed_source_or_fixture_and_explicit_generic_keep_conservative_checks(self):
        for missing in (self.observed_source, self.observed_test):
            boundary = Path(tempfile.gettempdir()).resolve()
            directory = Path(tempfile.mkdtemp(prefix="trsource-", dir=boundary)).resolve(); before = directory.stat()
            try:
                for relative in catalog.PUBLISHED_FORM_CHECKS[self.profiles[0]]["automatic_required_files"]:
                    target = directory / relative; target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes((self.root / relative).read_bytes())
                (directory / missing).unlink()
                rows = self.select([self.observed_source], directory)
                for name in self.profiles[:2]: self.assertNotIn(name, rows)
                self.assertIn("focused-tests", rows)
            finally:
                after = directory.lstat()
                if (directory.parent != boundary or directory.is_symlink() or directory.resolve() != directory or
                        (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)):
                    raise RuntimeError("Owned source route fixture changed; cleanup refused.")
                shutil.rmtree(directory)
        selected = catalog.plan(self.root, [self.observed_source], ["focused-tests"], "a" * 64)["selected"]
        self.assertIn("focused-tests", {row["id"] for row in selected})
        self.assertIn("focused-tests", self.select([self.observed_source.replace("originalTrainingModelSource", "unknown")]))

    def test_incomplete_profile_preserves_generic_source_fallback(self):
        boundary = Path(tempfile.gettempdir()).resolve()
        directory = Path(tempfile.mkdtemp(prefix="trroute-", dir=boundary)).resolve()
        before = directory.stat()
        try:
            # Copy only known fixed profile inputs; do not inspect/remove old runs.
            for name in self.profiles:
                for relative in catalog.PUBLISHED_FORM_CHECKS[name].get("automatic_required_files", ()):
                    target = directory / relative; target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes((self.root / relative).read_bytes())
            missing = directory / self.node_test; missing.unlink()
            source = "modules/adapters/runtime/python/client/approvedTrainingTaskSession.ts"
            rows = self.select([source], directory)
            self.assertNotIn(self.profiles[0], rows)
            self.assertNotIn(self.profiles[1], rows)
            self.assertIn("focused-tests", rows)
        finally:
            after = directory.lstat()
            if (directory.parent != boundary or directory.is_symlink() or directory.resolve() != directory or
                    (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)):
                raise RuntimeError("Owned route fixture changed; cleanup refused.")
            shutil.rmtree(directory)

    def test_missing_native_source_and_unknown_source_keep_generic_fallback(self):
        boundary = Path(tempfile.gettempdir()).resolve()
        directory = Path(tempfile.mkdtemp(prefix="trnative-", dir=boundary)).resolve(); before = directory.stat()
        try:
            for name in (*self.profiles, "headless-context-existing-runtime"):
                for relative in catalog.PUBLISHED_FORM_CHECKS[name].get("automatic_required_files", ()):
                    target = directory / relative; target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes((self.root / relative).read_bytes())
            (directory / self.native_python).unlink()
            rows = self.select([self.native_node, self.native_python], directory)
            self.assertIn("focused-tests", rows)
            for name in (*self.profiles, "headless-context-existing-runtime"): self.assertNotIn(name, rows)
            self.assertIn("focused-tests", self.select(["modules/adapters/runtime/python/supervisor/unknown.ts"]))
        finally:
            after = directory.lstat()
            if (directory.parent != boundary or directory.is_symlink() or directory.resolve() != directory or
                    (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)):
                raise RuntimeError("Owned native route fixture changed; cleanup refused.")
            shutil.rmtree(directory)

    def test_exact_registered_node_profiles_execute_without_model_effects(self):
        rows = self.select([self.node_test])
        for name in self.profiles[:2]:
            with self.subTest(profile=name):
                result = subprocess.run(rows[name]["argv"], cwd=self.root, text=True, capture_output=True, timeout=90)
                self.assertEqual(result.returncode, 0, result.stdout[-6000:] + result.stderr[-2000:])
                if name.endswith("-unit"):
                    self.assertIn("# fail 0", result.stdout)
                    self.assertIn("foundation reserves before installed startup", result.stdout)
                    self.assertIn("original reserved training source observes complete actual SHA256 bytes", result.stdout)
                    tests = re.search(r"^# tests (\d+)$", result.stdout, re.M)
                    passes = re.search(r"^# pass (\d+)$", result.stdout, re.M)
                    self.assertIsNotNone(tests); self.assertIsNotNone(passes)
                    self.assertGreater(int(tests.group(1)), 0)
                    self.assertEqual(tests.group(1), passes.group(1))
                    for counter in ("fail", "cancelled", "skipped", "todo"):
                        self.assertRegex(result.stdout, rf"(?m)^# {counter} 0$")

    def test_exact_registered_worker_profile_executes_only_inert_feature_tests(self):
        row = self.select([self.native_python])[self.profiles[2]]
        result = subprocess.run(row["argv"], cwd=self.root, text=True, capture_output=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout[-6000:] + result.stderr[-2000:])
        self.assertIn("Ran ", result.stderr); self.assertIn("OK", result.stderr)
        self.assertNotIn("FAILED", result.stderr)

    def test_shared_sealing_fixture_selects_both_real_consumers_and_strict_tests(self):
        rows = self.select([self.sealed_fixture])
        required = {self.profiles[2], "headless-approved-training-owner-unit", "headless-approved-training-owner-types"}
        self.assertTrue(required <= set(rows)); self.assertNotIn("focused-tests", rows)
        self.assertIn(self.worker_test, rows[self.profiles[2]]["argv"])
        self.assertIn("modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts",
                      rows["headless-approved-training-owner-types"]["argv"])
        self.assertIn("--strict", rows["headless-approved-training-owner-types"]["argv"])
        for name in ("headless-approved-training-owner-unit", "headless-approved-training-owner-types"):
            result = subprocess.run(rows[name]["argv"], cwd=self.root, text=True, capture_output=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stdout[-6000:] + result.stderr[-2000:])
            if name.endswith("-unit"):
                self.assertIn("# fail 0", result.stdout)
                self.assertIn("actual approved training producer matches the shared Python sealing fixture", result.stdout)
        self.assertIn("focused-tests", self.select([self.sealed_fixture.replace("approved_training_staged_input", "unknown")]))

    def test_missing_shared_fixture_preserves_generic_fallback_for_all_consumers(self):
        boundary = Path(tempfile.gettempdir()).resolve()
        directory = Path(tempfile.mkdtemp(prefix="trseal-", dir=boundary)).resolve(); before = directory.stat()
        try:
            for name in (self.profiles[2], "headless-approved-training-owner-unit"):
                for relative in catalog.PUBLISHED_FORM_CHECKS[name].get("automatic_required_files", ()):
                    target = directory / relative; target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes((self.root / relative).read_bytes())
            (directory / self.sealed_fixture).unlink()
            rows = self.select([self.sealed_fixture], directory)
            self.assertIn("focused-tests", rows)
            for name in (self.profiles[2], "headless-approved-training-owner-unit", "headless-approved-training-owner-types"):
                self.assertNotIn(name, rows)
        finally:
            after = directory.lstat()
            if (directory.parent != boundary or directory.is_symlink() or directory.resolve() != directory or
                    (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)):
                raise RuntimeError("Owned seal route fixture changed; cleanup refused.")
            shutil.rmtree(directory)


if __name__ == "__main__": unittest.main()
