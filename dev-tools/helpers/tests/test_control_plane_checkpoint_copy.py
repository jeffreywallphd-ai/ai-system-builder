"""Checkpoint-copy feature coverage must not launch physical Native checks."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class CheckpointCopyRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    unit = "checkpoint-copy-unit"
    types = "checkpoint-copy-types"

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "synthetic")["selected"]}

    def test_exact_sources_execute_only_the_resolver_and_its_strict_type_check(self):
        definition = catalog.PUBLISHED_FORM_CHECKS[self.unit]
        for source in definition["automatic_sources"]:
            rows = self.selected([source])
            self.assertEqual(rows[self.unit]["argv"], ["node", "--import", "tsx", "--test", "--test-concurrency=1", "--",
                catalog.CHECKPOINT_COPY_OWNER_SCOPE[1]])
            self.assertIn(self.types, rows)
            self.assertNotIn("focused-tests", rows)
            self.assertFalse(any("native.integration" in arg or "qualify_windows" in arg or "test:all" in arg
                for row in rows.values() for arg in row["argv"]))
        rows = self.selected(catalog.CHECKPOINT_COPY_OWNER_SCOPE)
        self.assertNotIn("focused-tests", rows)

    def test_unknown_sources_and_explicit_generic_requests_keep_their_fallback(self):
        source = catalog.CHECKPOINT_COPY_OWNER_SCOPE[0]
        self.assertIn("focused-tests", self.selected([source], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([source, "modules/adapters/model/local/unknown.ts"]))
        other = "modules/adapters/model/local/createLocalModelFilesDeleteAdapter.ts"
        self.assertNotIn(self.unit, self.selected([other]))

    def test_every_required_file_must_be_present_and_regular(self):
        source = catalog.CHECKPOINT_COPY_OWNER_SCOPE[0]
        with tempfile.TemporaryDirectory(prefix="checkpoint-routing-") as temporary:
            root = Path(temporary)
            for name in catalog.CHECKPOINT_COPY_REQUIRED:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("# Presence only.\n")
            for name in catalog.CHECKPOINT_COPY_REQUIRED:
                target = root / name
                target.unlink()
                for directory in (False, True):
                    if directory: target.mkdir()
                    if directory and Path(name).parent.as_posix() in (
                            "dev-tools/helpers/control_plane", "dev-tools/helpers/tests"):
                        # Policy source hashing also refuses a directory that
                        # occupies an executable .py source identity.
                        with self.assertRaises(OSError): self.selected([source], root=root)
                    else:
                        rows = self.selected([source], root=root)
                        self.assertNotIn(self.unit, rows)
                        self.assertNotIn(self.types, rows)
                        self.assertIn("focused-tests", rows)
                    if directory: target.rmdir()
                target.write_text("# Presence only.\n")

    def test_only_complete_known_scope_specializes_the_controller(self):
        core, owners = catalog.CHECKPOINT_COPY_SCOPE, catalog.CHECKPOINT_COPY_OWNER_SCOPE
        expected = [sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py",
            "-k", "test_control_plane_checkpoint_copy.", "-k", "test_control_plane_focused."]
        for scope in (core, core + owners, *[core + (name,) for name in owners]):
            rows = self.selected(scope, ("control-plane",))
            self.assertEqual(rows["control-plane"]["argv"], expected)
            self.assertEqual(rows["control-plane"]["timeout"], 600)
        default = next(row["argv"] for row in catalog.definitions(self.root) if row["id"] == "control-plane")
        for scope, required in (((), ("control-plane",)), (core[:-1], ("control-plane",)),
                (core[1:], ("control-plane",)), (core + owners + ("docs/unknown.md",), ("control-plane",)),
                (core + owners, ("control-plane", "focused-tests"))):
            self.assertEqual(self.selected(scope, required)["control-plane"]["argv"], default)

    def test_missing_support_keeps_the_full_controller(self):
        default = next(row["argv"] for row in catalog.definitions(self.root) if row["id"] == "control-plane")
        original = catalog._automatic_files_available
        for missing in catalog.CHECKPOINT_COPY_REQUIRED:
            def available(root, check):
                return False if missing in check.get("automatic_required_files", ()) else original(root, check)
            with self.subTest(missing=missing), patch.object(catalog, "_automatic_files_available", side_effect=available):
                rows = self.selected(catalog.CHECKPOINT_COPY_SCOPE + catalog.CHECKPOINT_COPY_OWNER_SCOPE, ("control-plane",))
                self.assertEqual(rows["control-plane"]["argv"], default)

    def test_existing_focused_suite_and_its_runner_are_independent_mandatory_support(self):
        # Name these independently of REQUIRED, so omitting either from that
        # declaration cannot silently shrink the selected controller coverage.
        related = ("dev-tools/helpers/tests/test_control_plane_focused.py",
            "dev-tools/helpers/run_focused_checks.py")
        default = next(row["argv"] for row in catalog.definitions(self.root) if row["id"] == "control-plane")
        with tempfile.TemporaryDirectory(prefix="checkpoint-closure-") as temporary:
            root = Path(temporary)
            for name in set(catalog.CHECKPOINT_COPY_REQUIRED + related):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("# Presence only.\n")
            for name in related:
                target = root / name
                target.unlink()
                for directory in (False, True):
                    if directory: target.mkdir()
                    if directory and Path(name).parent.as_posix() == "dev-tools/helpers/tests":
                        with self.assertRaises(OSError):
                            self.selected(catalog.CHECKPOINT_COPY_SCOPE, ("control-plane",), root=root)
                    else:
                        rows = self.selected(catalog.CHECKPOINT_COPY_SCOPE, ("control-plane",), root=root)
                        self.assertEqual(rows["control-plane"]["argv"], default, name)
                        self.assertNotIn(self.unit, rows)
                        self.assertNotIn(self.types, rows)
                    if directory: target.rmdir()
                target.write_text("# Presence only.\n")

    def test_registered_command_executes_the_real_filesystem_regressions(self):
        row = self.selected([catalog.CHECKPOINT_COPY_OWNER_SCOPE[0]])[self.unit]
        result = subprocess.run(row["argv"], cwd=self.root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf8", errors="replace", timeout=row["timeout"])
        self.assertEqual(result.returncode, 0, result.stdout[-2000:])
        self.assertIn("preserves checkpoints created during copy races", result.stdout)
        self.assertIn("preserves every racing checkpoint", result.stdout)


if __name__ == "__main__":
    unittest.main()
