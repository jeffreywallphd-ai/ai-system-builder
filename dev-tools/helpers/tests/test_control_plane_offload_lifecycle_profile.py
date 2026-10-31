"""Finite model-free lifecycle ownership and generic-fallback routing."""
from pathlib import Path
import copy
import json
import sys
import tempfile
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
import run_focused_checks

ROOT = HELPERS.parents[1]
PROFILE = "offload-resource-lifecycle"
CONFIG = "dev-tools/config/contributor-check-profiles.json"
CORE = "modules/adapters/runtime/python/worker/tasks/offload_recovery.py"
UNIT = "modules/adapters/runtime/python/worker/tests/test_offload_recovery.py"
ENTRY = "dev-tools/scripts/qualification/run_offload_resource_qualification.py"
GUARD = "dev-tools/helpers/tests/test_control_plane_offload_lifecycle_profile.py"
TESTS = [
    UNIT,
    "modules/adapters/runtime/python/worker/tests/test_local_model_offload.py",
    "modules/adapters/runtime/python/worker/tests/test_bounded_generator.py",
    "dev-tools/scripts/qualification/tests/test_offload_resource_qualification.py",
    "modules/adapters/runtime/python/worker/tests/test_windows_offload_core.py",
    "modules/adapters/runtime/python/worker/tests/test_windows_offload_backend.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_core_qualification.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_core_fixture.py",
    "modules/adapters/runtime/python/worker/tests/test_windows_offload_journal.py",
]


class OffloadLifecycleProfileTests(unittest.TestCase):
    def profile(self): return json.loads((ROOT / CONFIG).read_bytes())["profiles"][PROFILE]

    def fixture(self, root, profile):
        for name in set(profile["source_paths"] + profile["test_paths"]):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((ROOT / name).read_bytes())
        (root / CONFIG).write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {PROFILE: profile}}))

    def test_fixed_profile_executes_only_nine_model_free_files(self):
        self.assertEqual(self.profile()["test_paths"], TESTS)
        expected = [run_focused_checks.python_test_command(ROOT, name) for name in sorted(TESTS)]
        self.assertEqual(run_focused_checks.profile_commands(ROOT, PROFILE), expected)
        for command in expected:
            self.assertEqual(command[:5], [sys.executable, "-B", "-m", "unittest", "discover"])
        self.assertNotIn("modules/adapters/runtime/python/worker/tests/test_bounded_model_loader.py", TESTS)

    def test_full_unknown_explicit_and_borrowed_coverage_preserve_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root, self.profile())
            for paths, required, selected, generic in [
                ([CORE, ENTRY, CONFIG, "dev-tools/README.md"], ["documentation"], True, False),
                ([GUARD], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/windows_offload_core_fixture.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_core_fixture.py"], ["documentation"], True, False),

                (["modules/adapters/runtime/python/worker/tasks/windows_offload_core.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_backend.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_windows_offload_core.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_windows_offload_backend.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_journal.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_windows_offload_journal.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_journal.py"], ["focused-tests"], True, True),
                (["dev-tools/scripts/qualification/qualify_windows_offload_core.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_core_qualification.py"], ["documentation"], True, False),

                ([CORE], ["focused-tests"], True, True),
                ([CORE, "modules/unknown/current.ts"], ["documentation"], True, True),
                (["dev-tools/README.md"], ["documentation"], False, False),
            ]:
                with self.subTest(paths=paths):
                    ids = {row["id"] for row in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertEqual(PROFILE in ids, selected)
                    self.assertEqual("focused-tests" in ids, generic)

    def test_missing_source_declaration_does_not_suppress_generic_gate(self):
        for source in (CORE, "modules/adapters/runtime/python/worker/tasks/windows_offload_journal.py"):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); profile = copy.deepcopy(self.profile())
                profile["source_paths"].remove(source); self.fixture(root, profile)
                ids = {row["id"] for row in catalog.plan(root, [source], ["documentation"], "synthetic")["selected"]}
                self.assertIn(PROFILE, ids); self.assertIn("focused-tests", ids)

    def test_missing_new_test_declaration_keeps_generic_coverage(self):
        test = "modules/adapters/runtime/python/worker/tests/test_windows_offload_journal.py"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); profile = copy.deepcopy(self.profile())
            profile["source_paths"].remove(test); profile["test_paths"].remove(test)
            self.fixture(root, profile)
            ids = {row["id"] for row in catalog.plan(root, [test], ["documentation"], "synthetic")["selected"]}
            self.assertIn(PROFILE, ids); self.assertIn("focused-tests", ids)

    def test_borrowed_quality_and_native_sources_do_not_trigger_lifecycle_execution(self):
        for name in ("dev-tools/scripts/qualification/run_model_blocker_tests.py", "dev-tools/scripts/native/probe_windows_guarded_tree.py", "dev-tools/scripts/qualification/offload_guarded_restart.py"):
            with self.subTest(name=name):
                ids = {row["id"] for row in catalog.plan(ROOT, [name], ["documentation"], "synthetic")["selected"]}
                self.assertNotIn(PROFILE, ids)


if __name__ == "__main__": unittest.main()
