"""Register AND execute the real worker regression file before its next changes."""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelTrainingWorkerRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/adapters/runtime/python/worker/tasks/train_model.py"
    test = "modules/adapters/runtime/python/worker/tests/test_train_model_task.py"
    helper = "dev-tools/helpers/run_focused_checks.py"
    unit = "model-training-worker-unit"
    other_source = "modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py"
    minimum_cases = 45
    command_timeout = 600

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_worker_paths_select_only_the_fixed_existing_pinned_helper(self):
        for path in [self.source, self.test]:
            selected = self.selected([path])
            self.assertEqual(selected[self.unit]["argv"], [sys.executable, "-B", self.helper, "--regression-test", self.test])
            self.assertEqual(selected[self.unit]["timeout"], self.command_timeout)
            self.assertNotIn("focused-tests", selected)
            self.assertNotIn("completion-all", selected)

    def test_shared_worker_readme_borrows_only_an_already_selected_training_profile(self):
        readme = "modules/adapters/runtime/python/worker/README.md"
        self.assertNotIn("focused-tests", self.selected([self.source, self.test, readme]))
        self.assertNotIn(self.unit, self.selected([readme]))
        self.assertIn("focused-tests", self.selected([self.source, readme], ("focused-tests",)))

    def test_explicit_unknown_and_shared_fallback_are_preserved(self):
        self.assertIn("focused-tests", self.selected([self.source], ("focused-tests",)))
        for shared in ["modules/adapters/runtime/python/worker/models.py",
                       self.other_source,
                       "modules/adapters/runtime/python/worker/tasks/model_serialization.py"]:
            self.assertNotIn(self.unit, self.selected([shared]))
        self.assertIn("focused-tests", self.selected([self.source, "modules/adapters/runtime/python/worker/tasks/unknown_training.py"]))

    def test_missing_or_nonregular_worker_inputs_cannot_suppress_generic_coverage(self):
        with tempfile.TemporaryDirectory(prefix="worker-profile-presence-") as directory:
            root = Path(directory)
            for name in [self.source, self.test, self.helper]:
                selected = self.selected([self.source, self.test], root=root)
                self.assertNotIn(self.unit, selected)
                self.assertIn("focused-tests", selected)
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.mkdir()
                selected = self.selected([self.source, self.test], root=root)
                self.assertNotIn(self.unit, selected)
                target.rmdir()
                target.write_text("# Synthetic presence only, not execution evidence.\n")
            self.assertIn(self.unit, self.selected([self.source, self.test], root=root))

    def test_registered_command_executes_actual_worker_assertions_with_isolated_test_settings(self):
        self.test_exact_worker_paths_select_only_the_fixed_existing_pinned_helper()
        argv = self.selected([self.source, self.test])[self.unit]["argv"]
        boundary = Path(tempfile.gettempdir()).resolve()
        owned = Path(tempfile.mkdtemp(prefix="training-worker-check-", dir=boundary)).resolve()
        before = owned.lstat()
        try:
            env = {**os.environ, "TEMP": str(owned), "TMP": str(owned), "TMPDIR": str(owned),
                   "PYTEST_ADDOPTS": "--definitely-not-an-allowed-ambient-argument",
                   "PYTEST_PLUGINS": "nonexistent_ambient_plugin_must_not_load"}
            result = subprocess.run(argv, cwd=self.root, env=env, timeout=self.command_timeout, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            self.assertEqual(result.returncode, 0, result.stdout[-3000:])
            counts = re.findall(r"\b([0-9]+) passed\b", result.stdout)
            if not counts:
                counts = re.findall(r"\bRan ([0-9]+) tests? in ", result.stdout)
                self.assertRegex(result.stdout, r"(?m)^OK\s*$")
            self.assertTrue(counts, result.stdout[-3000:])
            self.assertGreaterEqual(int(counts[-1]), self.minimum_cases)
            self.assertNotRegex(result.stdout, r"\b[1-9][0-9]* (?:failed|skipped|error|deselected|xfailed|xpassed)\b|\bskipped=[1-9][0-9]*")
            print(json.dumps({"check": self.unit, "worker_feature_cases_passed": int(counts[-1]),
                              "scope": "synthetic training controls; no model or native qualification"}))
        finally:
            after = owned.lstat()
            if (owned.parent == boundary and owned.name.startswith("training-worker-check-") and owned.resolve() == owned
                    and not owned.is_symlink() and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)):
                shutil.rmtree(owned)
            else:
                raise RuntimeError("The owned regression folder changed; cleanup was refused.")


class ModelTrainingImageWorkerRoutingTests(ModelTrainingWorkerRoutingTests):
    source = "modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py"
    test = "modules/adapters/runtime/python/worker/tests/test_train_model_multimodal_task.py"
    unit = "model-training-image-worker-unit"
    other_source = ModelTrainingWorkerRoutingTests.source
    minimum_cases = 7
    command_timeout = 120


if __name__ == "__main__":
    unittest.main()
