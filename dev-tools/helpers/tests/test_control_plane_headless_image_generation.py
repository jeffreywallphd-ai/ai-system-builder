"""Fixed image owner checks with conservative unknown/missing-source fallback."""
from pathlib import Path
import os
import re
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ImageGenerationOwnerRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    profiles = ("headless-image-generation-owner-unit", "headless-image-generation-owner-types")

    def select(self, paths, root=None, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "a" * 64)["selected"]}

    def test_original_owner_edits_select_related_authority_lifecycle_contract_and_strict_checks(self):
        for path in catalog.IMAGE_GENERATION_OWNER_REQUIRED[:2]:
            rows = self.select([path])
            for name in self.profiles: self.assertIn(name, rows)
            self.assertNotIn("focused-tests", rows)
            for test in catalog.IMAGE_GENERATION_OWNER_REQUIRED[1::2]: self.assertIn(test, rows[self.profiles[0]]["argv"])
            self.assertIn("--strict", rows[self.profiles[1]]["argv"])
            self.assertNotIn("headless-training-bounded-feature", rows)
            self.assertFalse(any("test:all" in arg for row in rows.values() for arg in row["argv"]))

    def test_shared_unknown_and_explicit_generic_changes_do_not_borrow_the_narrow_scope(self):
        rows = self.select(catalog.IMAGE_GENERATION_OWNER_SCOPE)
        self.assertIn("-k", rows["control-plane"]["argv"])
        self.assertNotIn("focused-tests", rows)
        self.assertIn("focused-tests", self.select([catalog.IMAGE_GENERATION_OWNER_REQUIRED[2]]))
        for paths, required in (([*catalog.IMAGE_GENERATION_OWNER_SCOPE, "modules/application/use-cases/unknown-image.ts"], ("architecture",)),
                                (catalog.IMAGE_GENERATION_OWNER_SCOPE, ("focused-tests",))):
            rows = self.select(paths, required=required)
            self.assertIn("focused-tests", rows); self.assertNotIn("-k", rows["control-plane"]["argv"])

    def test_missing_and_nonregular_inputs_disable_controller_narrowing_and_preserve_coverage(self):
        required = catalog.IMAGE_GENERATION_OWNER_REQUIRED + (catalog.IMAGE_GENERATION_OWNER_CONTROLLER,)
        self.assertLessEqual(len(required), 16)
        with tempfile.TemporaryDirectory(prefix="image-owner-routing-") as directory:
            root = Path(directory)
            for name in required:
                target = root / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_text("// inert\n", encoding="utf8")
            self.assertIn("-k", self.select(catalog.IMAGE_GENERATION_OWNER_SCOPE, root)["control-plane"]["argv"])
            for name in required:
                target = root / name; target.unlink()
                for nonregular in (False, True):
                    with self.subTest(path=name, directory=nonregular):
                        if nonregular: target.mkdir()
                        if nonregular and name == catalog.IMAGE_GENERATION_OWNER_CONTROLLER:
                            with self.assertRaises(OSError): self.select(catalog.IMAGE_GENERATION_OWNER_SCOPE, root)
                        else:
                            rows = self.select(catalog.IMAGE_GENERATION_OWNER_SCOPE, root)
                            self.assertNotIn("-k", rows["control-plane"]["argv"])
                            if name != catalog.IMAGE_GENERATION_OWNER_CONTROLLER:
                                self.assertIn("focused-tests", rows)
                                for profile in self.profiles: self.assertNotIn(profile, rows)
                            else: self.assertIn(self.profiles[0], rows)
                        if nonregular: target.rmdir()
                target.write_text("// inert\n", encoding="utf8")

    def test_fixed_commands_execute_actual_regressions_and_strict_consumers(self):
        rows = self.select(catalog.IMAGE_GENERATION_OWNER_REQUIRED[:2])
        environment = dict(os.environ)
        environment.pop("NODE_TEST_CONTEXT", None); environment.pop("AISB_RUN_FIXED_NATIVE_QUALIFICATION", None)
        environment.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
        for profile in self.profiles:
            result = subprocess.run(rows[profile]["argv"], cwd=self.root, env=environment, text=True, capture_output=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout[-6000:] + result.stderr[-3000:])
            if profile.endswith("-unit"):
                counts = {key: int(value) for key, value in re.findall(r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$", result.stdout, re.MULTILINE)}
                self.assertGreaterEqual(counts.get("tests", 0), 22); self.assertEqual(counts.get("tests"), counts.get("pass"))
                for key in ("fail", "cancelled", "skipped", "todo"): self.assertEqual(counts.get(key), 0)
                self.assertIn("image caller scope", result.stdout); self.assertIn("accepted-reply mutation", result.stdout)


if __name__ == "__main__": unittest.main()
