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

    def test_deferred_start_sources_select_strict_original_host_checks(self):
        for path in (catalog.TRAINING_START_OWNER, catalog.TRAINING_START_TEST):
            rows = self.select([path])
            for name in self.profiles: self.assertIn(name, rows)
            self.assertNotIn("focused-tests", rows)
            self.assertIn(catalog.TRAINING_START_OWNER, rows[self.profiles[1]]["argv"])
            self.assertIn(catalog.TRAINING_START_TEST, rows[self.profiles[0]]["argv"])
        rows = self.select(catalog.TRAINING_START_SCOPE)
        self.assertIn("test_control_plane_headless_training_host_approval.", rows["control-plane"]["argv"])
        for paths, required in (([*catalog.TRAINING_START_SCOPE, "modules/hosts/shared/composition/unknown.ts"], ("architecture",)),
                                (catalog.TRAINING_START_SCOPE, ("focused-tests",))):
            rows = self.select(paths, required=required)
            self.assertNotIn("-k", rows["control-plane"]["argv"])

    def test_missing_start_source_keeps_full_controller_and_generic_coverage(self):
        required = catalog.PUBLISHED_FORM_CHECKS[self.profiles[0]]["automatic_required_files"]
        with tempfile.TemporaryDirectory(prefix="start-routing-") as temporary:
            root = Path(temporary)
            for relative in (*required, catalog.TRAINING_START_CONTROLLER_TEST):
                path = root / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("// inert\n", encoding="utf8")
            for relative in (catalog.TRAINING_START_OWNER, catalog.TRAINING_START_TEST):
                path = root / relative; path.unlink()
                for directory in (False, True):
                    if directory: path.mkdir()
                    rows = self.select(catalog.TRAINING_START_SCOPE, root)
                    self.assertNotIn(self.profiles[0], rows); self.assertIn("focused-tests", rows)
                    self.assertNotIn("-k", rows["control-plane"]["argv"])
                    if directory: path.rmdir()
                path.write_text("// inert\n", encoding="utf8")

    def test_real_training_requires_explicit_selection_and_fixture_edits_only_run_controlled_tests(self):
        for path in (catalog.TRAINING_BOUNDED_FEATURE, catalog.TRAINING_SHARED_FIXTURE):
            rows = self.select([path])
            self.assertNotIn("headless-training-bounded-feature", rows)
            self.assertNotIn("focused-tests", rows)
        rows = self.select([catalog.TRAINING_BOUNDED_FEATURE])
        self.assertIn("headless-training-bounded-feature-types", rows)
        self.assertIn("--noEmit", rows["headless-training-bounded-feature-types"]["argv"])
        rows = self.select([catalog.TRAINING_BOUNDED_FEATURE], required=("headless-training-bounded-feature",))
        self.assertEqual(rows["headless-training-bounded-feature"]["argv"], [sys.executable, "-B", catalog.TRAINING_FRESH_GUARD])
        self.assertNotIn(".test.", catalog.TRAINING_BOUNDED_FEATURE)

    def test_bounded_training_controller_scope_preserves_unknown_and_missing_fallback(self):
        rows = self.select(catalog.TRAINING_BOUNDED_SCOPE)
        self.assertIn("-k", rows["control-plane"]["argv"])
        self.assertNotIn("headless-training-bounded-feature", rows)
        self.assertNotIn("-k", self.select([*catalog.TRAINING_BOUNDED_SCOPE, "modules/hosts/unknown.ts"])["control-plane"]["argv"])
        self.assertNotIn("-k", self.select(catalog.TRAINING_BOUNDED_SCOPE, required=("focused-tests",))["control-plane"]["argv"])
        required = catalog.PUBLISHED_FORM_CHECKS["headless-training-execution-unit"]["automatic_required_files"] + (
            catalog.TRAINING_SHARED_FIXTURE, catalog.TRAINING_BOUNDED_FEATURE, catalog.TRAINING_START_CONTROLLER_TEST) + catalog.TRAINING_BOUNDED_SOURCE_REPAIR
        self.assertLessEqual(len(required), 32)
        with tempfile.TemporaryDirectory(prefix="bounded-routing-") as temporary:
            root = Path(temporary)
            for relative in required:
                path = root / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("// inert\n", encoding="utf8")
            self.assertIn("-k", self.select(catalog.TRAINING_BOUNDED_SCOPE, root)["control-plane"]["argv"])
            for relative in required:
                path = root / relative; path.unlink()
                for nonregular in (False, True):
                    if nonregular: path.mkdir()
                    if nonregular and relative == catalog.TRAINING_START_CONTROLLER_TEST:
                        # A malformed verification-policy source refuses planning
                        # during policy hashing; it must not select narrower tests.
                        with self.assertRaises(OSError): self.select(catalog.TRAINING_BOUNDED_SCOPE, root)
                    else:
                        self.assertNotIn("-k", self.select(catalog.TRAINING_BOUNDED_SCOPE, root)["control-plane"]["argv"])
                    if nonregular: path.rmdir()
                path.write_text("// inert\n", encoding="utf8")

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

    def test_evaluation_profiles_execute_controlled_original_owner_and_codec_checks_only(self):
        rows = self.select([catalog.TRAINING_EVALUATION_TEST])
        profiles = ("headless-training-evaluation-unit", "headless-training-evaluation-types")
        for name in profiles: self.assertIn(name, rows)
        self.assertNotIn("focused-tests", rows); self.assertNotIn("headless-training-bounded-feature", rows)
        environment = dict(os.environ); environment.pop("NODE_TEST_CONTEXT", None)
        environment.pop("AISB_RUN_FIXED_NATIVE_QUALIFICATION", None)
        for name in profiles:
            result = subprocess.run(rows[name]["argv"], cwd=self.root, env=environment, text=True, capture_output=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout[-6000:] + result.stderr[-2000:])
            if name.endswith("-unit"):
                counts = {key: int(value) for key, value in re.findall(r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", result.stdout, re.MULTILINE)}
                self.assertGreaterEqual(counts.get("tests", 0), 26); self.assertEqual(counts.get("tests"), counts.get("pass"))
                for key in ("fail", "cancelled", "skipped", "todo"): self.assertEqual(counts.get(key), 0)
                for title in ("Core original review preserves lower", "SQLite original review preserves higher", "awaited policy"):
                    self.assertIn(title, result.stdout)

    def test_evaluation_scope_keeps_conservative_unknown_explicit_missing_and_nonregular_fallback(self):
        rows = self.select(catalog.TRAINING_EVALUATION_SCOPE)
        self.assertIn("-k", rows["control-plane"]["argv"])
        for paths, required in (([*catalog.TRAINING_EVALUATION_SCOPE, "modules/hosts/unknown-evaluation.ts"], ("architecture",)),
                                (catalog.TRAINING_EVALUATION_SCOPE, ("focused-tests",))):
            rows = self.select(paths, required=required); self.assertIn("focused-tests", rows)
            self.assertNotIn("-k", rows["control-plane"]["argv"])
        required = catalog.TRAINING_EVALUATION_REQUIRED + (catalog.TRAINING_START_CONTROLLER_TEST,)
        self.assertLessEqual(len(required), 16)
        with tempfile.TemporaryDirectory(prefix="evaluation-routing-") as temporary:
            root = Path(temporary)
            for relative in required:
                path = root / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("// inert\n", encoding="utf8")
            self.assertIn("-k", self.select(catalog.TRAINING_EVALUATION_SCOPE, root)["control-plane"]["argv"])
            for relative in required:
                path = root / relative; path.unlink()
                for nonregular in (False, True):
                    if nonregular: path.mkdir()
                    if nonregular and relative == catalog.TRAINING_START_CONTROLLER_TEST:
                        with self.assertRaises(OSError): self.select(catalog.TRAINING_EVALUATION_SCOPE, root)
                    else:
                        rows = self.select(catalog.TRAINING_EVALUATION_SCOPE, root)
                        if relative == catalog.TRAINING_START_CONTROLLER_TEST:
                            # A missing controller disables its narrow filter,
                            # not the independently available software checks.
                            self.assertIn("headless-training-evaluation-unit", rows)
                        else:
                            self.assertNotIn("headless-training-evaluation-unit", rows)
                        self.assertIn("focused-tests", rows)
                        self.assertNotIn("-k", rows["control-plane"]["argv"])
                    if nonregular: path.rmdir()
                path.write_text("// inert\n", encoding="utf8")


if __name__ == "__main__": unittest.main()
