"""Execute actual inert training bridge tests; preserve conservative routing."""
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


class TrainingExecutionRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/hosts/shared/composition/headlessModelTrainingExecution.ts"
    test = "modules/hosts/shared/composition/tests/headless-model-training-execution.unit.test.ts"
    wire = "modules/contracts/headless/headless-plan-step-wire.ts"
    wire_test = "modules/contracts/headless/tests/headless-model-step-execution.unit.test.ts"
    related = (
        wire_test,
        "modules/application/use-cases/model/tests/headless-approved-training-owner.unit.test.ts",
        "modules/adapters/persistence/system-builder/tests/structured-headless-training-plan-step.unit.test.ts",
        "modules/hosts/shared/composition/tests/headless-model-download-execution.unit.test.ts",
        "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
        "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
        "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
        "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
    )
    unit = "headless-training-execution-unit"
    types = "headless-training-execution-types"

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "a" * 64)["selected"]}

    def test_new_exact_fixture_selects_actual_bridge_contract_related_and_strict_commands(self):
        rows = self.selected([self.test])
        self.assertEqual(rows[self.unit]["argv"], ["node", "--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", "--", self.test, *self.related])
        self.assertEqual(rows[self.types]["argv"], ["node", "node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--skipLibCheck",
            "--target", "ES2021", "--module", "commonjs", "--moduleResolution", "node", "--esModuleInterop", "--lib", "ES2021,DOM", self.source, self.test, self.wire_test])
        for name in ("focused-tests", "completion-all", "completion-standardande2e"):
            self.assertNotIn(name, rows)
        self.assertNotIn("focused-tests", self.selected([self.test, self.source, self.wire, self.wire_test, "modules/hosts/README.md"]))

    def test_shared_source_unknown_and_explicit_generic_impact_stay_conservative(self):
        for name in (self.source, self.wire, "modules/hosts/README.md"):
            selected = self.selected([name])
            self.assertNotIn(self.unit, selected)
            self.assertIn("focused-tests", selected)
        self.assertIn("focused-tests", self.selected([self.test], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.test, "modules/hosts/shared/composition/unknown-training.ts"]))

    def test_missing_or_nonregular_support_cannot_mask_generic_coverage(self):
        required = catalog.PUBLISHED_FORM_CHECKS[self.unit]["automatic_required_files"]
        self.assertLessEqual(len(required), 16)
        for missing in required:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(prefix="tbridge-presence-") as directory:
                root = Path(directory)
                for name in required:
                    path = root / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("// Availability fixture only.\n", encoding="utf8")
                self.assertIn(self.unit, self.selected([self.test], root=root))
                path = root / missing
                path.unlink()
                for nonregular in (False, True):
                    if nonregular:
                        path.mkdir()
                    rows = self.selected([self.test], root=root)
                    self.assertNotIn(self.unit, rows)
                    self.assertNotIn(self.types, rows)
                    self.assertIn("focused-tests", rows)

    def test_fixed_commands_execute_actual_core_sqlite_app_contract_and_related_cases(self):
        rows = self.selected([self.test])
        boundary = Path(tempfile.gettempdir()).resolve()
        owned = Path(tempfile.mkdtemp(prefix="tbchk-", dir=boundary)).resolve()
        before = owned.lstat()
        try:
            env = {**os.environ, "TEMP": str(owned), "TMP": str(owned), "TMPDIR": str(owned),
                   "NODE_OPTIONS": "--preserve-symlinks --preserve-symlinks-main", "TSX_DISABLE_CACHE": "1", "HF_HUB_OFFLINE": "1"}
            env.pop("NODE_TEST_CONTEXT", None)
            env.pop("AISB_RUN_FIXED_NATIVE_QUALIFICATION", None)
            for check in (self.unit, self.types):
                with self.subTest(check=check):
                    result = subprocess.run(rows[check]["argv"], cwd=self.root, env=env, timeout=180,
                                            capture_output=True, text=True, encoding="utf-8", errors="replace")
                    self.assertLess(len(result.stdout) + len(result.stderr), 2 * 1024 * 1024)
                    self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-12000:])
                    if check == self.unit:
                        counts = {name: int(value) for name, value in re.findall(r"(?m)^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", result.stdout)}
                        self.assertGreaterEqual(counts.get("tests", 0), 60)
                        self.assertEqual(counts.get("tests"), counts.get("pass"))
                        for name in ("fail", "cancelled", "skipped", "todo"):
                            self.assertEqual(counts.get(name), 0)
                        for title in ("Core: approved training bridge composes real readers", "SQLite: approved training bridge composes real readers",
                                      "lost acceptance retains the original private task", "training task references require their own explicit opt-in",
                                      "Core: training step uses actual approval", "exact approved Model step admits one original source",
                                      "approved Context", "an exact approved plan exclusively issues both file effects"):
                            self.assertIn(title, result.stdout)
        finally:
            after = owned.lstat()
            if (owned.parent == boundary and owned.name.startswith("tbchk-") and owned.resolve() == owned
                    and not owned.is_symlink() and (after.st_dev, after.st_ino) == (before.st_dev, before.st_ino)):
                shutil.rmtree(owned)
            else:
                raise RuntimeError("Disposable bridge-test directory identity changed; cleanup refused.")


if __name__ == "__main__":
    unittest.main()
