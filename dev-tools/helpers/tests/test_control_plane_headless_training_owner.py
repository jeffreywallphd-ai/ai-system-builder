"""Execute the private training owner profiles without a model, worker or app."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ApprovedTrainingOwnerRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/application/use-cases/model/train-model.use-case.ts"
    port = "modules/application/ports/model/approved-local-model-training.port.ts"
    test = "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts"
    unit = "headless-approved-training-owner-unit"
    types = "headless-approved-training-owner-types"

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "b" * 64)["selected"]}

    def test_exact_private_sources_select_fixed_real_unit_and_strict_test_commands(self):
        for path in (self.source, self.port, self.test):
            rows = self.selected([path])
            self.assertEqual(rows[self.unit]["argv"], ["node", "--import", "tsx", "--test", "--test-reporter=tap",
                "--test-concurrency=1", "--", self.test])
            self.assertEqual(rows[self.types]["argv"], ["node", "node_modules/typescript/bin/tsc", "--noEmit", "--strict",
                "--skipLibCheck", "--target", "ES2021", "--module", "commonjs", "--moduleResolution", "node",
                "--esModuleInterop", "--lib", "ES2021,DOM", self.source, self.test])
            self.assertNotIn("focused-tests", rows)
            self.assertNotIn("completion-all", rows)
        # The shared owner always also exercises unchanged ordinary behavior.
        shared = self.selected([self.source])
        self.assertIn("model-training-lifecycle-unit", shared)
        self.assertIn("model-training-lifecycle-types", shared)

    def test_shared_borrowing_and_explicit_generic_fallback_are_conservative(self):
        for shared in ("modules/application/ports/model/index.ts", "modules/application/use-cases/README.md"):
            self.assertNotIn(self.unit, self.selected([shared]))
            self.assertNotIn("focused-tests", self.selected([self.source, shared]))
        for shared in ("modules/application/ports/runtime/runtime-task-registry.port.ts", "modules/contracts/model/index.ts",
                       "modules/application/use-cases/model/model-download-tasks.use-case.ts"):
            self.assertNotIn(self.unit, self.selected([shared]))
        self.assertIn("focused-tests", self.selected([self.source], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.port, "modules/application/use-cases/model/unknown-owner.ts"]))

    def test_every_missing_or_nonregular_private_file_preserves_generic_coverage(self):
        required = catalog.PUBLISHED_FORM_CHECKS[self.unit]["automatic_required_files"]
        self.assertEqual(set(required), {self.source, self.port, self.test,
            "modules/adapters/runtime/python/worker/tests/fixtures/approved_training_staged_input.json"})
        for missing in required:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(prefix="private-training-presence-") as directory:
                root = Path(directory)
                for name in required:
                    path = root / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("// Availability fixture only; real commands execute separately.\n", encoding="utf8")
                self.assertIn(self.unit, self.selected([self.port], root=root))
                path = root / missing
                path.unlink()
                for nonregular in (False, True):
                    if nonregular:
                        path.mkdir()
                    rows = self.selected([self.port], root=root)
                    self.assertNotIn(self.unit, rows)
                    self.assertNotIn(self.types, rows)
                    self.assertIn("focused-tests", rows)

    def test_registered_private_commands_execute_real_cases_and_strict_types(self):
        rows = self.selected([self.source])
        boundary = Path(tempfile.gettempdir()).resolve()
        owned = Path(tempfile.mkdtemp(prefix="private-training-check-", dir=boundary)).resolve()
        before = owned.lstat()
        try:
            env = {**os.environ, "TEMP": str(owned), "TMP": str(owned), "TMPDIR": str(owned),
                   "NODE_OPTIONS": "--preserve-symlinks --preserve-symlinks-main", "TSX_DISABLE_CACHE": "1", "HF_HUB_OFFLINE": "1"}
            env.pop("NODE_TEST_CONTEXT", None)
            env.pop("AISB_RUN_FIXED_NATIVE_QUALIFICATION", None)
            for check in (self.unit, self.types):
                with self.subTest(check=check):
                    result = subprocess.run(rows[check]["argv"], cwd=self.root, env=env, timeout=120,
                                            capture_output=True, text=True, encoding="utf-8", errors="replace")
                    self.assertLess(len(result.stdout) + len(result.stderr), 2 * 1024 * 1024)
                    self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-12000:])
                    if check == self.unit:
                        counts = {name: int(value) for name, value in re.findall(r"(?m)^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", result.stdout)}
                        self.assertGreaterEqual(counts.get("tests", 0), 30)
                        self.assertEqual(counts.get("tests"), counts.get("pass"))
                        for name in ("fail", "cancelled", "skipped", "todo"):
                            self.assertEqual(counts.get(name), 0)
                        for title in ("stages exact copied data", "retains ack-throws", "ordinary read, cancel, Save and discard",
                                      "original read is held through shutdown", "call accessors", "sparse metadata arrays"):
                            self.assertIn(title, result.stdout)
        finally:
            after = owned.lstat()
            if (owned.parent == boundary and owned.name.startswith("private-training-check-") and owned.resolve() == owned
                    and not owned.is_symlink() and (after.st_dev, after.st_ino) == (before.st_dev, before.st_ino)):
                shutil.rmtree(owned)
            else:
                raise RuntimeError("Disposable feature-test identity changed; cleanup refused.")


if __name__ == "__main__":
    unittest.main()
