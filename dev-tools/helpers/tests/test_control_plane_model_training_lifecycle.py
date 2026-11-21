"""Exact ordinary training owner checks, with real bounded command execution."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelTrainingLifecycleRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/application/use-cases/model/train-model.use-case.ts"
    test = "modules/application/use-cases/tests/train-model.use-case.unit.test.ts"
    unit = "model-training-lifecycle-unit"
    types = "model-training-lifecycle-types"

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_source_and_test_select_real_unit_and_strict_source_type_command(self):
        for source in [self.source, self.test]:
            selected = self.selected([source])
            self.assertEqual(selected[self.unit]["argv"], ["node", "--import", "tsx", "--test", "--test-concurrency=1", "--", self.test])
            self.assertEqual(selected[self.types]["argv"], ["node", "node_modules/typescript/bin/tsc", "--noEmit", "--strict",
                "--skipLibCheck", "--target", "ES2021", "--module", "commonjs", "--moduleResolution", "node",
                "--esModuleInterop", "--lib", "ES2021,DOM", self.source])
            self.assertNotIn("focused-tests", selected)
            self.assertNotIn("completion-all", selected)

    def test_shared_unknown_and_explicit_generic_selection_stays_intact(self):
        self.assertIn("focused-tests", self.selected([self.source], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.source, "modules/application/use-cases/model/unknown-task.ts"]))
        for shared in ["modules/application/ports/runtime/runtime-task-registry.port.ts", "modules/contracts/model/index.ts",
                       "modules/application/use-cases/model/model-download-tasks.use-case.ts"]:
            selected = self.selected([shared])
            self.assertNotIn(self.unit, selected)
            self.assertNotIn(self.types, selected)

    def test_missing_or_nonregular_training_files_cannot_mask_generic_coverage(self):
        with tempfile.TemporaryDirectory(prefix="training-profile-presence-") as directory:
            root = Path(directory)
            def denied():
                selected = self.selected([self.source, self.test], root=root)
                self.assertNotIn(self.unit, selected)
                self.assertNotIn(self.types, selected)
                self.assertIn("focused-tests", selected)
            denied()
            source = root / self.source; source.parent.mkdir(parents=True); source.write_text("// Synthetic source presence only.\n")
            denied()
            target = root / self.test; target.parent.mkdir(parents=True); target.mkdir()
            denied()
            target.rmdir(); target.write_text("// Synthetic test presence only; execution is still required.\n")
            selected = self.selected([self.source, self.test], root=root)
            self.assertIn(self.unit, selected); self.assertIn(self.types, selected)
            self.assertNotIn("focused-tests", selected)

    def test_fixed_registered_commands_execute_existing_training_feature_tests_and_source_types(self):
        self.test_exact_source_and_test_select_real_unit_and_strict_source_type_command()
        selected = self.selected([self.source, self.test])
        boundary = Path(tempfile.gettempdir()).resolve()
        owned = Path(tempfile.mkdtemp(prefix="training-lifecycle-check-", dir=boundary)).resolve()
        before = owned.lstat()
        try:
            env = {**os.environ, "TEMP": str(owned), "TMP": str(owned), "TMPDIR": str(owned),
                   "NODE_OPTIONS": "--preserve-symlinks --preserve-symlinks-main", "TSX_DISABLE_CACHE": "1"}
            for check in [self.unit, self.types]:
                result = subprocess.run(selected[check]["argv"], cwd=self.root, env=env, timeout=120,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
                self.assertEqual(result.returncode, 0, result.stdout[-2000:])
                if check == self.unit:
                    self.assertRegex(result.stdout, r"(?:# |ℹ )pass [1-9][0-9]*")
                    self.assertNotRegex(result.stdout, r"(?:# |ℹ )fail [1-9][0-9]*")
        finally:
            after = owned.lstat()
            if (owned.parent == boundary and owned.name.startswith("training-lifecycle-check-") and owned.resolve() == owned
                    and not owned.is_symlink() and (after.st_dev, after.st_ino) == (before.st_dev, before.st_ino)):
                shutil.rmtree(owned)
            else:
                raise RuntimeError("The disposable feature-test directory identity changed; cleanup was refused.")


if __name__ == "__main__":
    unittest.main()
