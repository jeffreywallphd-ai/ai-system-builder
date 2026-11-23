"""Execute the fixed saved-training host checks; preserve conservative fallback."""
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


class TrainingHostApprovalRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    test_file = "modules/hosts/shared/composition/tests/headless-model-training-host-review.unit.test.ts"
    profiles = ("headless-training-host-review-unit", "headless-training-host-review-types", "headless-training-host-review-server-build")

    def select(self, paths, root=None, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "a" * 64)["selected"]}

    def test_exact_fixture_selects_real_host_storage_compatibility_strict_and_server_build(self):
        rows = self.select([self.test_file, *catalog.TRAINING_HOST_REVIEW_CODE])
        for name in self.profiles:
            self.assertIn(name, rows)
        for path in catalog.TRAINING_HOST_REVIEW_TESTS:
            self.assertIn(path, rows[self.profiles[0]]["argv"])
            self.assertIn(path, rows[self.profiles[1]]["argv"])
        self.assertIn("--strict", rows[self.profiles[1]]["argv"])
        self.assertEqual(rows[self.profiles[2]]["argv"][-3:], ["node_modules/typescript/bin/tsc", "-p", "apps/server/tsconfig.json"])
        for name in ("focused-tests", "completion-all", "completion-standardande2e"):
            self.assertNotIn(name, rows)
        self.assertFalse(any("model-blocker" in arg or "test:all" in arg for row in rows.values() for arg in row["argv"]))

    def test_shared_unknown_explicit_and_missing_or_nonregular_inputs_keep_fallback(self):
        shared = catalog.TRAINING_HOST_REVIEW_CODE[0]
        self.assertNotIn(self.profiles[0], self.select([shared]))
        self.assertIn("focused-tests", self.select([shared]))
        self.assertIn("focused-tests", self.select([self.test_file], required=("focused-tests",)))
        self.assertIn("focused-tests", self.select([self.test_file, "modules/hosts/shared/composition/unknown-training-review.ts"]))
        required = catalog.PUBLISHED_FORM_CHECKS[self.profiles[0]]["automatic_required_files"]
        self.assertLessEqual(len(required), 16)
        boundary = Path(tempfile.gettempdir()).resolve()
        directory = Path(tempfile.mkdtemp(prefix="treview-", dir=boundary)).resolve()
        before = directory.stat()
        try:
            for relative in required:
                target = directory / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert availability fixture\n", encoding="utf8")
            self.assertIn(self.profiles[0], self.select([self.test_file], directory))
            for relative in required:
                target = directory / relative
                target.unlink()
                for nonregular in (False, True):
                    if nonregular: target.mkdir()
                    rows = self.select([self.test_file], directory)
                    for name in self.profiles: self.assertNotIn(name, rows)
                    self.assertIn("focused-tests", rows)
                    if nonregular: target.rmdir()
                target.write_text("// inert availability fixture\n", encoding="utf8")
        finally:
            after = directory.lstat()
            if (directory.parent != boundary or directory.is_symlink() or directory.resolve() != directory or
                    (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)):
                raise RuntimeError("Owned training-review fixture changed; cleanup refused.")
            shutil.rmtree(directory)

    def test_fixed_commands_execute_actual_assertions_strict_consumers_and_existing_server_build(self):
        rows = self.select([self.test_file])
        environment = dict(os.environ)
        for key in ("NODE_TEST_CONTEXT", "AISB_RUN_FIXED_NATIVE_QUALIFICATION"):
            environment.pop(key, None)
        environment.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
        for name in self.profiles:
            with self.subTest(profile=name):
                result = subprocess.run(rows[name]["argv"], cwd=self.root, env=environment,
                                        text=True, capture_output=True, timeout=120)
                self.assertEqual(result.returncode, 0, result.stdout[-10000:] + result.stderr[-4000:])
                if name == self.profiles[0]:
                    counts = {key: int(value) for key, value in re.findall(r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", result.stdout, re.MULTILINE)}
                    self.assertGreaterEqual(counts.get("tests", 0), 59)
                    self.assertEqual(counts.get("tests"), counts.get("pass"))
                    for key in ("fail", "cancelled", "skipped", "todo"):
                        self.assertEqual(counts.get(key), 0)
                    for title in ("Core/Desktop", "SQLite/Managed", "two saved training steps", "legacy training binding"):
                        self.assertIn(title, result.stdout)


if __name__ == "__main__": unittest.main()
