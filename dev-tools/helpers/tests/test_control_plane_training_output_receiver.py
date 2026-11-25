"""Closed private receiver routing retains actual whole feature execution."""
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingOutputReceiverRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    target = "modules/adapters/runtime/python/tests/original-training-output-receiver.integration.test.ts"
    source = "modules/adapters/runtime/python/client/originalTrainingOutputReceiver.ts"
    unit = "headless-training-runtime-unit"
    typed = "headless-training-runtime-types"

    def select(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "a"*64)["selected"]}

    def support(self):
        return set(catalog.TRAINING_OUTPUT_RECEIVER_SCOPE + catalog.TRAINING_OUTPUT_RECEIVER_OWNER_SCOPE
            + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in catalog.TRAINING_OUTPUT_RECEIVER_CONTROLLER_FILTERS)
            + tuple(name for identity in (self.unit, "headless-training-output-channel-unit")
                for name in catalog.PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))

    def test_real_receiver_selects_entire_old_and_new_files_and_strict_consumer(self):
        for path in (self.source, self.target):
            rows = self.select([path]); command = rows[self.unit]["argv"]
            self.assertIn(self.target, command); self.assertIn("--test-concurrency=1", command)
            for name in ("approved-training-runtime-session.unit.test.ts", "createPythonRuntimeHttpClient.unit.test.ts",
                         "pythonRuntimeHttpProtocol.unit.test.ts", "original-training-model-source.unit.test.ts"):
                self.assertTrue(any(value.endswith("/" + name) for value in command))
            self.assertIn(self.target, rows[self.typed]["argv"]); self.assertIn("--strict", rows[self.typed]["argv"])
            self.assertNotIn("focused-tests", rows)
            self.assertFalse(any("test:all" in arg or "model-blocker" in arg or "qualify_windows" in arg
                for row in rows.values() for arg in row["argv"]))
        self.assertIn("focused-tests", self.select([self.target], ("focused-tests",)))
        self.assertIn("focused-tests", self.select([self.target, self.target.replace("receiver", "unknown")]))

    def test_all_sixteen_required_files_are_regular_and_missing_support_keeps_generic_fallback(self):
        required = catalog.PUBLISHED_FORM_CHECKS[self.unit]["automatic_required_files"]
        self.assertEqual(len(required), 16)
        with tempfile.TemporaryDirectory(prefix="receiver-route-") as temporary:
            root = Path(temporary)
            for name in required:
                target = root/name; target.parent.mkdir(parents=True, exist_ok=True); target.write_text("// Presence only.\n")
            for name in required:
                target = root/name; target.unlink()
                for directory in (False, True):
                    if directory: target.mkdir()
                    rows = self.select([self.source], root=root)
                    self.assertNotIn(self.unit, rows); self.assertNotIn(self.typed, rows); self.assertIn("focused-tests", rows)
                    if directory: target.rmdir()
                target.write_text("// Presence only.\n")
            self.assertIn(self.unit, self.select([self.source], root=root))

    def test_only_complete_known_scope_gets_whole_related_controller_suites(self):
        core = catalog.TRAINING_OUTPUT_RECEIVER_SCOPE; owners = catalog.TRAINING_OUTPUT_RECEIVER_OWNER_SCOPE
        expected = [sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
            *[part for name in catalog.TRAINING_OUTPUT_RECEIVER_CONTROLLER_FILTERS for part in ("-k", name)]]
        for scope in (core, core+owners, *[core+(owner,) for owner in owners]):
            row = self.select(scope, ("control-plane",))["control-plane"]
            self.assertEqual(row["argv"], expected); self.assertEqual(row["timeout"], 600)
        rows = self.select(core+owners, ("control-plane", self.unit, self.typed))
        self.assertNotIn("focused-tests", rows)
        # Documentation-only coverage needs the explicit related profile; ordinary
        # worker docs without that complete declaration retain generic fallback.
        self.assertIn("focused-tests", self.select(["modules/adapters/runtime/python/worker/README.md"]))
        default = next(row["argv"] for row in catalog.definitions(self.root) if row["id"] == "control-plane")
        for scope, required in (((), ("control-plane",)), (core[:-1], ("control-plane",)),
            ((owners[0],), ("control-plane",)), (core+owners+("docs/unowned.md",), ("control-plane",)),
            (core+owners, ("control-plane", "focused-tests"))):
            self.assertEqual(self.select(scope, required)["control-plane"]["argv"], default)
        original = catalog._automatic_files_available
        for missing in self.support():
            def available(root, check):
                return False if missing in check.get("automatic_required_files", ()) else original(root, check)
            with self.subTest(missing=missing), patch.object(catalog, "_automatic_files_available", side_effect=available):
                self.assertEqual(self.select(core+owners, ("control-plane",))["control-plane"]["argv"], default)

    def test_registered_feature_command_executes_real_publication_and_all_closed_cases(self):
        row = self.select([self.source])[self.unit]
        result = subprocess.run(row["argv"], cwd=self.root, text=True, capture_output=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout[-6000:]+result.stderr[-3000:])
        self.assertIn("maximum 8 KiB wire segments", result.stdout)
        self.assertIn("original session receives checkpoint and candidate bytes", result.stdout)
        self.assertIn("# fail 0", result.stdout)
        tests = re.search(r"^# tests (\d+)$", result.stdout, re.M)
        passes = re.search(r"^# pass (\d+)$", result.stdout, re.M)
        self.assertIsNotNone(tests); self.assertIsNotNone(passes)
        self.assertGreaterEqual(int(tests.group(1)), 34); self.assertEqual(tests.group(1), passes.group(1))
        for counter in ("fail", "cancelled", "skipped", "todo"):
            self.assertRegex(result.stdout, rf"(?m)^# {counter} 0$")


if __name__ == "__main__": unittest.main()
