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
    "modules/adapters/runtime/python/worker/tests/test_windows_offload_sources.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_core_qualification.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_core_fixture.py",
    "modules/adapters/runtime/python/worker/tests/test_windows_offload_journal.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_journal_fixture.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_journal_qualification.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_read_binding_fixture.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_read_binding_qualification.py",
    "modules/adapters/runtime/python/worker/tests/test_windows_offload_execution.py",
    "modules/adapters/runtime/python/worker/tests/test_windows_offload_execution_child.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_read_session_fixture.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_read_session_qualification.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_sources_fixture.py",
    "dev-tools/scripts/qualification/tests/test_offload_supplier_boundary.py",
    "modules/adapters/runtime/python/worker/tests/test_bounded_model_inputs.py",
    "modules/adapters/runtime/python/worker/tests/test_windows_offload_source_session.py",
    "modules/adapters/runtime/python/worker/tests/test_windows_offload_source_session_child.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_source_session_qualification.py",
    "dev-tools/scripts/qualification/tests/test_windows_offload_source_session_fixture.py",
]

SOURCE_SESSION = [
    "modules/adapters/runtime/python/worker/tasks/windows_offload_native_session.py",
    "modules/adapters/runtime/python/worker/tasks/windows_offload_source_session.py",
    "modules/adapters/runtime/python/worker/tasks/windows_offload_source_session_child.py",
    "dev-tools/scripts/qualification/qualify_windows_offload_source_session.py",
    "dev-tools/scripts/qualification/windows_offload_source_session_fixture.py",
    *TESTS[-4:],
]


class OffloadLifecycleProfileTests(unittest.TestCase):
    def profile(self): return json.loads((ROOT / CONFIG).read_bytes())["profiles"][PROFILE]

    def fixture(self, root, profile):
        for name in set(profile["source_paths"] + profile["test_paths"]):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((ROOT / name).read_bytes())
        (root / CONFIG).write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {PROFILE: profile}}))

    def test_fixed_profile_executes_only_twenty_five_model_free_files(self):
        self.assertEqual(self.profile()["test_paths"], TESTS)
        expected = [run_focused_checks.python_test_command(ROOT, name) for name in sorted(TESTS)]
        self.assertEqual(run_focused_checks.profile_commands(ROOT, PROFILE), expected)
        for command in expected:
            self.assertEqual(command[:5], [sys.executable, "-B", "-m", "unittest", "discover"])
        self.assertNotIn("modules/adapters/runtime/python/worker/tests/test_bounded_model_loader.py", TESTS)
        self.assertNotIn("modules/adapters/runtime/python/worker/tests/test_bounded_model_loader_native.py", TESTS)

    def test_every_closed_source_session_path_is_owned_and_missing_declarations_keep_fallback(self):
        for name in SOURCE_SESSION:
            with self.subTest(path=name):
                selected={row['id']for row in catalog.plan(ROOT,[name],['documentation'],'synthetic')['selected']}
                self.assertIn(PROFILE,selected);self.assertNotIn('focused-tests',selected)
                with tempfile.TemporaryDirectory()as directory:
                    root=Path(directory);profile=copy.deepcopy(self.profile())
                    profile['source_paths'].remove(name);self.fixture(root,profile)
                    selected={row['id']for row in catalog.plan(root,[name],['documentation'],'synthetic')['selected']}
                    self.assertIn(PROFILE,selected)
                    self.assertEqual('focused-tests'in selected,name not in profile['test_paths'])
        for name in TESTS[-4:]:
            with self.subTest(test=name),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);profile=copy.deepcopy(self.profile())
                profile['test_paths'].remove(name);profile['source_paths'].remove(name);self.fixture(root,profile)
                selected={row['id']for row in catalog.plan(root,[name],['documentation'],'synthetic')['selected']}
                self.assertIn('focused-tests',selected)

    def test_full_unknown_explicit_and_borrowed_coverage_preserve_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root, self.profile())
            for paths, required, selected, generic in [
                ([CORE, ENTRY, CONFIG, "dev-tools/README.md"], ["documentation"], True, False),
                ([GUARD], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/qualify_windows_offload_sources.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/windows_offload_sources_fixture.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_sources_fixture.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_sources.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_source_ledger.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_windows_offload_sources.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_offload_supplier_boundary.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/bounded_model_inputs.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_bounded_model_inputs.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_bounded_model_loader_native.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/windows_offload_core_fixture.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_core_fixture.py"], ["documentation"], True, False),

                (["modules/adapters/runtime/python/worker/tasks/windows_offload_core.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_backend.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_windows_offload_core.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_windows_offload_backend.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_journal.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_windows_offload_journal.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/qualify_windows_offload_journal.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/windows_offload_journal_fixture.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_journal_fixture.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_journal_qualification.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_journal.py"], ["focused-tests"], True, True),
                (["dev-tools/scripts/qualification/qualify_windows_offload_core.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_core_qualification.py"], ["documentation"], True, False),

                (["dev-tools/scripts/qualification/qualify_windows_offload_read_binding.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/windows_offload_read_binding_fixture.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_read_binding_fixture.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_read_binding_qualification.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_execution.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tasks/windows_offload_execution_child.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_windows_offload_execution.py"], ["documentation"], True, False),
                (["modules/adapters/runtime/python/worker/tests/test_windows_offload_execution_child.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/qualify_windows_offload_read_session.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/windows_offload_read_session_fixture.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_read_session_fixture.py"], ["documentation"], True, False),
                (["dev-tools/scripts/qualification/tests/test_windows_offload_read_session_qualification.py"], ["documentation"], True, False),
                ([CORE], ["focused-tests"], True, True),
                ([CORE, "modules/unknown/current.ts"], ["documentation"], True, True),
                (["dev-tools/README.md"], ["documentation"], False, False),
            ]:
                with self.subTest(paths=paths):
                    ids = {row["id"] for row in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertEqual(PROFILE in ids, selected)
                    self.assertEqual("focused-tests" in ids, generic)

    def test_missing_source_declaration_does_not_suppress_generic_gate(self):
        for source in ("dev-tools/scripts/qualification/qualify_windows_offload_sources.py", "dev-tools/scripts/qualification/windows_offload_sources_fixture.py",
                       "modules/adapters/runtime/python/worker/tasks/windows_offload_sources.py",
                       "modules/adapters/runtime/python/worker/tasks/windows_offload_source_ledger.py", CORE,
                       "modules/adapters/runtime/python/worker/tests/test_bounded_model_loader_native.py",
                       "modules/adapters/runtime/python/worker/tasks/windows_offload_journal.py",
                       "dev-tools/scripts/qualification/qualify_windows_offload_journal.py",
                       "dev-tools/scripts/qualification/windows_offload_journal_fixture.py",
                       "dev-tools/scripts/qualification/qualify_windows_offload_read_binding.py",
                       "dev-tools/scripts/qualification/windows_offload_read_binding_fixture.py",
                       "modules/adapters/runtime/python/worker/tasks/windows_offload_execution.py",
                       "modules/adapters/runtime/python/worker/tasks/windows_offload_execution_child.py",
                       "dev-tools/scripts/qualification/qualify_windows_offload_read_session.py",
                       "dev-tools/scripts/qualification/windows_offload_read_session_fixture.py"):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); profile = copy.deepcopy(self.profile())
                profile["source_paths"].remove(source); self.fixture(root, profile)
                ids = {row["id"] for row in catalog.plan(root, [source], ["documentation"], "synthetic")["selected"]}
                self.assertIn(PROFILE, ids); self.assertIn("focused-tests", ids)

    def test_missing_new_test_declaration_keeps_generic_coverage(self):
        for test in ("dev-tools/scripts/qualification/tests/test_windows_offload_sources_fixture.py",
                     "modules/adapters/runtime/python/worker/tests/test_windows_offload_sources.py", "dev-tools/scripts/qualification/tests/test_offload_supplier_boundary.py",
                     "modules/adapters/runtime/python/worker/tests/test_windows_offload_journal.py",
                     "dev-tools/scripts/qualification/tests/test_windows_offload_journal_fixture.py",
                     "dev-tools/scripts/qualification/tests/test_windows_offload_journal_qualification.py",
                     "dev-tools/scripts/qualification/tests/test_windows_offload_read_binding_fixture.py",
                     "dev-tools/scripts/qualification/tests/test_windows_offload_read_binding_qualification.py",
                     "modules/adapters/runtime/python/worker/tests/test_windows_offload_execution.py",
                     "modules/adapters/runtime/python/worker/tests/test_windows_offload_execution_child.py",
                     "dev-tools/scripts/qualification/tests/test_windows_offload_read_session_fixture.py",
                     "dev-tools/scripts/qualification/tests/test_windows_offload_read_session_qualification.py"):
            with self.subTest(test=test), tempfile.TemporaryDirectory() as directory:
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

    def test_shared_worker_readme_does_not_schedule_unrelated_semantic_feature(self):
        ids = {row["id"] for row in catalog.plan(ROOT,
            ["modules/adapters/runtime/python/worker/README.md"], ["documentation"], "synthetic")["selected"]}
        self.assertIn("documentation", ids)
        self.assertNotIn("dataset-semantic-curation", ids)
        for source in ("modules/adapters/runtime/python/worker/tasks/semantic_curation.py",
                       "modules/adapters/runtime/python/worker/tests/test_semantic_curation.py"):
            ids = {row["id"] for row in catalog.plan(ROOT, [source], ["documentation"], "synthetic")["selected"]}
            self.assertIn("dataset-semantic-curation", ids)


if __name__ == "__main__": unittest.main()
