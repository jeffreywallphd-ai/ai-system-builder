"""Failure observations expose finite source locations, never child output or authority."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane.execution import execute, failure_diagnostics, MAX_FAILURE_TAIL
from control_plane.contracts import ControlError


class FailureDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.target = "modules/example/tests/owned.unit.test.ts"
        path = self.root / self.target
        path.parent.mkdir(parents=True)
        path.write_text("// Synthetic owned source only.\n")
        self.check = {"argv": ["node", "--test", self.target]}

    def parse(self, value, check=None):
        return failure_diagnostics(self.root, check or self.check, {"stdout": value.encode()})

    def test_only_selected_existing_test_locations_and_fixed_error_metadata_survive(self):
        raw = ("synthetic-private-payload token=synthetic-private-token Bearer synthetic-bearer\n"
               "AssertionError [ERR_ASSERTION]: private prompt must never persist\n"
               f"test at {self.target.replace('/', chr(92))}:2:17132\n"
               "ℹ fail 1\n")
        observed = self.parse(raw)
        self.assertEqual(observed, {"schema_version": "check-failure-diagnostics-v1",
            "test_locations": [{"path": self.target, "line": 2, "column": 17132}],
            "error_kinds": ["AssertionError"], "error_codes": ["ERR_ASSERTION"], "failed_tests": 1})
        for secret in ("synthetic-private", "Bearer", "private prompt", str(self.root)):
            self.assertNotIn(secret, json.dumps(observed))

    def test_absolute_owned_location_and_tap_location_are_normalized_without_local_prefix(self):
        for raw in (f"test at {self.root / self.target}:2:3\n", f"  location: '{self.target}:2:3'\n"):
            self.assertEqual(self.parse(raw)["test_locations"], [{"path": self.target, "line": 2, "column": 3}])

    def test_unknown_outside_traversal_private_oversized_and_invalid_locations_are_not_recorded(self):
        for target in ("modules/example/tests/unknown.test.ts", "../outside.test.ts",
            str(self.root) + "-other/" + self.target, "C:/outside/secret.test.ts", "//server/private.test.ts",
            ".local-codex/private.test.ts", "modules/../example/tests/owned.unit.test.ts", "x" * 10000):
            self.assertEqual(self.parse(f"test at {target}:2:3\n"), {})
        for suffix in ("0:1", "1:0", "10000001:1", "1:10000001", "-1:2", "1:NaN"):
            self.assertEqual(self.parse(f"test at {self.target}:{suffix}\n"), {})

    def test_catalog_candidates_must_be_confined_existing_source_test_files(self):
        for argument in ("modules/example/tests/missing.test.ts", "../outside.test.ts", ".local-codex/private.test.ts"):
            self.assertEqual(self.parse(f"test at {argument}:1:1\n", {"argv": ["node", argument]}), {})
        with patch("control_plane.execution.confined_path", side_effect=ControlError("path.reparse", "Denied.")):
            self.assertEqual(self.parse(f"test at {self.target}:1:1\n"), {})

    def test_actual_inside_repository_directory_alias_cannot_supply_a_location(self):
        alias = self.root / "modules" / "alias"
        original = self.root / "modules" / "example"
        if os.name == "nt":
            import _winapi
            _winapi.CreateJunction(str(original), str(alias))
        else:
            alias.symlink_to(original, target_is_directory=True)
        selected = "modules/alias/tests/owned.unit.test.ts"
        self.assertTrue((self.root / selected).is_file())
        self.assertEqual(self.parse(f"test at {selected}:1:1\n", {"argv": ["node", selected]}), {})

    def test_tail_locations_counts_and_names_are_bounded_and_advisory(self):
        raw = "synthetic-private" * MAX_FAILURE_TAIL + "\n" + "".join(
            f"test at {self.target}:{i}:1\n" for i in range(1, 30))
        result = self.parse(raw + "TypeError ERR_MODULE_NOT_FOUND\n# fail 999999\n")
        self.assertEqual(len(result["test_locations"]), 8)
        self.assertEqual(result["failed_tests"], 100000)
        self.assertEqual(result["error_kinds"], ["TypeError"])
        self.assertNotIn("synthetic-private", json.dumps(result))
        self.assertEqual(self.parse("private TypeErrorPlus unrelated message"), {})

    def test_actual_failed_child_keeps_hashes_and_safe_locations_without_raw_output(self):
        driver = self.root / "driver.py"
        output = f"private-fixture token=private-fixture\ntest at {self.target}:2:3\nAssertionError ERR_ASSERTION\n# fail 1\n"
        driver.write_text("import sys\nsys.stdout.buffer.write(" + repr(output.encode()) + ")\nsys.exit(1)\n")
        result = execute(self.root, {"id": "fixture", "argv": [sys.executable, str(driver), self.target], "timeout": 3})
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["failure_diagnostics"]["test_locations"][0]["path"], self.target)
        self.assertEqual(result["output"]["stdout"]["sha256"], hashlib.sha256(output.encode()).hexdigest())
        self.assertNotIn("private-fixture", json.dumps(result))

    def test_pass_output_timeout_and_output_limit_never_become_qualification_from_diagnostics(self):
        success = execute(self.root, {"id": "fixture", "argv": [sys.executable, "-c", "print('AssertionError ERR_ASSERTION')"], "timeout": 3})
        self.assertEqual(success["status"], "passed")
        self.assertNotIn("failure_diagnostics", success)
        timeout = execute(self.root, {"id": "fixture", "argv": [sys.executable, "-c", "import time; time.sleep(3)"], "timeout": .1})
        self.assertEqual(timeout["status"], "timed-out")
        with patch("control_plane.execution.MAX_OUTPUT", 100):
            limited = execute(self.root, {"id": "fixture", "argv": [sys.executable, "-c", "print('AssertionError '*10000)"], "timeout": 3})
        self.assertEqual(limited["status"], "output-limit")


if __name__ == "__main__":
    unittest.main()
