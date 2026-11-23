"""Fixed original-session profiles and conservative missing-fixture fallback."""
from pathlib import Path
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
        for name in ("completion-all", "completion-standardande2e", "focused-tests"):
            self.assertNotIn(name, rows)
        self.assertFalse(any("model-blocker" in arg or "test:all" in arg for row in rows.values() for arg in row["argv"]))

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

    def test_exact_registered_node_profiles_execute_without_model_effects(self):
        rows = self.select([self.node_test])
        for name in self.profiles[:2]:
            with self.subTest(profile=name):
                result = subprocess.run(rows[name]["argv"], cwd=self.root, text=True, capture_output=True, timeout=90)
                self.assertEqual(result.returncode, 0, result.stdout[-6000:] + result.stderr[-2000:])
                if name.endswith("-unit"):
                    self.assertIn("# fail 0", result.stdout)
                    self.assertIn("foundation reserves before installed startup", result.stdout)


if __name__ == "__main__": unittest.main()
