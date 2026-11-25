"""Local IO evidence keeps whole owning features and conservative fallback."""
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingIoRetirementRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    unit = "headless-training-io-retirement-unit"
    typed = "headless-training-io-retirement-types"

    def select(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "a"*64)["selected"]}

    def support(self):
        return set(catalog.TRAINING_IO_RETIREMENT_SCOPE + catalog.TRAINING_IO_RETIREMENT_OWNER_SCOPE
            + tuple("dev-tools/helpers/tests/" + name.split(".")[0] + ".py" for name in catalog.TRAINING_IO_RETIREMENT_CONTROLLER_FILTERS)
            + tuple(name for identity in (self.unit, "headless-training-runtime-unit")
                for name in catalog.PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))

    def test_whole_writer_storage_and_strict_receiver_are_selected_without_models_or_full_suite(self):
        definition = catalog.PUBLISHED_FORM_CHECKS[self.unit]
        self.assertTrue(set(definition["automatic_sources"]) <= set(definition["sources"]))
        for source in definition["automatic_sources"]:
            rows = self.select([source]); command = rows[self.unit]["argv"]
            for name in ("contained-stream-retirement", "training-result-file-byte-storage", "filesystem-artifact-storage",
                         "context-result-byte-storage", "ingestion-file-byte-storage"):
                self.assertTrue(any(arg.endswith("/"+name+".integration.test.ts") for arg in command))
            self.assertIn("--test-concurrency=1", command); self.assertIn("--strict", rows[self.typed]["argv"])
            self.assertNotIn("focused-tests", rows)
            self.assertFalse(any(value in arg for row in rows.values() for arg in row["argv"]
                for value in ("test:all", "model-blocker", "qualify_windows")))
        source = definition["automatic_sources"][0]
        self.assertIn("focused-tests", self.select([source], ("focused-tests",)))
        self.assertIn("focused-tests", self.select([source, "modules/adapters/unknown.ts"]))

    def test_each_required_source_is_regular_or_generic_fallback_remains(self):
        definition = catalog.PUBLISHED_FORM_CHECKS[self.unit]; source = definition["automatic_sources"][0]
        with tempfile.TemporaryDirectory(prefix="training-io-route-") as temporary:
            root = Path(temporary)
            for name in definition["automatic_required_files"]:
                target = root/name; target.parent.mkdir(parents=True, exist_ok=True); target.write_text("// Presence only.\n")
            for name in definition["automatic_required_files"]:
                target = root/name; target.unlink()
                for directory in (False, True):
                    if directory: target.mkdir()
                    rows = self.select([source], root=root)
                    self.assertNotIn(self.unit, rows); self.assertNotIn(self.typed, rows); self.assertIn("focused-tests", rows)
                    if directory: target.rmdir()
                target.write_text("// Presence only.\n")

    def test_closed_complete_routing_keeps_whole_related_controller_modules_and_unknown_fallback(self):
        core, owners = catalog.TRAINING_IO_RETIREMENT_SCOPE, catalog.TRAINING_IO_RETIREMENT_OWNER_SCOPE
        expected = [sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
            *[part for name in catalog.TRAINING_IO_RETIREMENT_CONTROLLER_FILTERS for part in ("-k", name)]]
        for scope in (core, core+owners, *[core+(name,) for name in owners]):
            row = self.select(scope, ("control-plane",))["control-plane"]
            self.assertEqual(row["argv"], expected); self.assertEqual(row["timeout"], 600)
        rows = self.select(core+owners, ("control-plane", "headless-context-result-bytes", "headless-training-runtime-unit"))
        self.assertNotIn("focused-tests", rows)
        default = next(row["argv"] for row in catalog.definitions(self.root) if row["id"] == "control-plane")
        for scope, required in (((), ("control-plane",)), (core[:-1], ("control-plane",)),
            ((owners[0],), ("control-plane",)), (core+owners+("docs/unknown.md",), ("control-plane",)),
            (core+owners, ("control-plane", "focused-tests"))):
            self.assertEqual(self.select(scope, required)["control-plane"]["argv"], default)
        original = catalog._automatic_files_available
        for missing in self.support():
            def available(root, check):
                return False if missing in check.get("automatic_required_files", ()) else original(root, check)
            with self.subTest(missing=missing), patch.object(catalog, "_automatic_files_available", side_effect=available):
                self.assertEqual(self.select(core+owners, ("control-plane",))["control-plane"]["argv"], default)

    def test_registered_command_executes_all_real_owning_feature_files(self):
        row = self.select([catalog.TRAINING_IO_RETIREMENT_OWNER_SCOPE[0]])[self.unit]
        result = subprocess.run(row["argv"], cwd=self.root, text=True, capture_output=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout[-6000:]+result.stderr[-3000:])
        self.assertIn("lost close acknowledgement", result.stdout)
        self.assertIn("retirement is captured once", result.stdout)
        count = re.search(r"^# tests (\d+)$", result.stdout, re.M)
        passes = re.search(r"^# pass (\d+)$", result.stdout, re.M)
        self.assertIsNotNone(count); self.assertIsNotNone(passes); self.assertGreaterEqual(int(count.group(1)), 50)
        self.assertEqual(count.group(1), passes.group(1))
        for counter in ("fail", "cancelled", "skipped", "todo"):
            self.assertRegex(result.stdout, rf"(?m)^# {counter} 0$")


if __name__ == "__main__": unittest.main()
