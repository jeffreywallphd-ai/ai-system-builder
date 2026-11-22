"""Execute real local Model/Context inspection and original-actor regressions."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingLocalModelFilesRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/application/use-cases/model/headless-model-training-local-files.use-case.ts"
    unit = "headless-training-local-files-unit"
    types = "headless-training-local-files-types"

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_unit_and_type_commands_are_selected_together(self):
        for path in [self.source,
                     "modules/application/ports/model/model-training-files.port.ts",
                     "modules/adapters/model/local/localSafeModelDirectoryInspector.ts",
                     "modules/adapters/model/local/createLocalTrainingModelFilesAdapter.ts",
                     "modules/adapters/model/local/createLocalContextEmbeddingModelFilesAdapter.ts",
                     "modules/application/use-cases/model/tests/headless-model-training-local-files.unit.test.ts",
                     "modules/adapters/model/local/tests/local-training-model-files.unit.test.ts"]:
            selected = self.selected([path])
            self.assertEqual(selected[self.unit]["argv"], ["node", "--import", "tsx", "--test", "--test-reporter=tap", "--", *catalog.TRAINING_LOCAL_MODEL_TESTS])
            self.assertIn("--noEmit", selected[self.types]["argv"])
            self.assertNotIn("focused-tests", selected)
            self.assertNotIn("completion-all", selected)

    def test_explicit_unknown_and_shared_fallback_are_not_removed(self):
        self.assertIn("focused-tests", self.selected([self.source], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.source, "modules/unknown/new.ts"]))
        shared = "dev-tools/helpers/control_plane/storage.py"
        self.assertTrue(set(self.selected([shared])).issubset(self.selected([self.source, shared])))
        self.assertNotIn(self.unit, self.selected(["modules/adapters/model/local/README.md"]))

    def test_shared_barrels_and_borrowed_tests_cannot_activate_this_feature(self):
        for path in ["modules/application/ports/model/index.ts", "modules/adapters/model/local/index.ts"]:
            selected = self.selected([path])
            self.assertNotIn(self.unit, selected)
            self.assertIn("focused-tests", selected)
            self.assertIn(self.unit, self.selected([path, self.source]))
        for path in ["modules/application/use-cases/model/tests/headless-model-training-model.unit.test.ts",
                     "modules/adapters/model/local/tests/context-embedding-model-files.unit.test.ts"]:
            self.assertNotIn(self.unit, self.selected([path]))

    def test_each_missing_or_nonregular_input_preserves_generic_coverage(self):
        check = catalog.PUBLISHED_FORM_CHECKS[self.unit]
        with tempfile.TemporaryDirectory(prefix="local-model-routing-") as folder:
            root = Path(folder)
            for name in check["automatic_required_files"]:
                self.assertNotIn(self.unit, self.selected([self.source], root=root))
                self.assertIn("focused-tests", self.selected([self.source], root=root))
                target = root / name; target.parent.mkdir(parents=True, exist_ok=True); target.mkdir()
                self.assertNotIn(self.unit, self.selected([self.source], root=root))
                target.rmdir(); target.write_text("// Presence only; no execution evidence.\n")
            self.assertIn(self.unit, self.selected([self.source], root=root))

    def test_fixed_commands_execute_actual_model_context_and_type_assertions(self):
        selected = self.selected([self.source])
        with tempfile.TemporaryDirectory(prefix="local-model-command-") as folder:
            env = {**os.environ, "TEMP": folder, "TMP": folder, "TMPDIR": folder}
            result = subprocess.run(selected[self.unit]["argv"], cwd=self.root, env=env, timeout=120,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf8", errors="replace")
            self.assertEqual(result.returncode, 0, result.stdout[-5000:])
            count = re.search(r"(?m)^# tests ([0-9]+)\s*$", result.stdout)
            self.assertIsNotNone(count, result.stdout[-5000:]); self.assertGreaterEqual(int(count[1]), 58)
            for marker in ("fail", "skipped", "cancelled"):
                self.assertRegex(result.stdout, rf"(?m)^# {marker} 0\s*$")
            typed = subprocess.run(selected[self.types]["argv"], cwd=self.root, env=env, timeout=120,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf8", errors="replace")
            self.assertEqual(typed.returncode, 0, typed.stdout[-5000:])
            print(json.dumps({"check": self.unit, "actual_feature_cases": int(count[1]), "types_passed": True,
                              "scope": "private cooperative layout preparation only; no model or native qualification"}))


if __name__ == "__main__": unittest.main()
