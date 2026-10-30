"""Borrowed report ownership must not weaken unknown or explicit test impact."""
from pathlib import Path
import fnmatch
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_control_plane_operational_ui_profile as operational

catalog = operational.catalog
CONFIG = operational.CONFIG
ROOT = operational.ROOT
V = "dev-tools/scripts/qualification/visual-composer/"
BORROWED = [V + "qualification-reporting.ts", V + "e2e/reference-browse-performance.ts",
            V + "e2e/packaged-desktop-cold-canvas.e2e.spec.ts", V + "e2e/structured-output-controls-journey.ts",
            V + "e2e/thin-client-browse.e2e.spec.ts", CONFIG]
CORE = "dev-tools/scripts/qualification/tests/operational-desktop-case.unit.test.ts"
LATE_SOURCES = [V + "e2e/" + name for name in [
    "ingestion-source-journey.ts", "ocr-dataset-journey.ts", "provided-dataset-version-journey.ts",
    "saved-row-review-host-journey.ts", "source-context-host-journey.ts", "manual-context-host-journey.ts",
    "low-memory-dataset-journey.ts",
]]


class UiRunEvidenceProfile(unittest.TestCase):
    def test_native_observer_borrowing_does_not_suppress_explicit_or_unknown_checks(self):
        sources=[V+"owned-native-process-exit.mjs", V+"owned-native-process-exit.d.mts",
                 "dev-tools/scripts/qualification/observe_windows_process_exit.py"]
        with tempfile.TemporaryDirectory(prefix="native-report-profile-") as directory:
            root=Path(directory)
            operational.OperationalUiProfile.fixture(self,root,self.profile())
            for paths,required,generic in [(sources,["operational-ui"],False),
                                           (sources,["operational-ui","focused-tests"],True),
                                           ([*sources,V+"unknown-observer.mjs"],["operational-ui"],True)]:
                ids={c["id"] for c in catalog.plan(root,paths,required,"synthetic-candidate")["selected"]}
                self.assertIn("operational-ui",ids);self.assertEqual("focused-tests" in ids,generic)

    @staticmethod
    def profile():
        return json.loads((ROOT / CONFIG).read_bytes())["profiles"]["operational-ui"]

    def test_closed_extension_preserves_prior_members_and_auto_triggers(self):
        profile = self.profile()
        self.assertEqual(len(profile["test_paths"]), 81)
        self.assertEqual(profile["test_paths"][46:49], [
            "dev-tools/scripts/qualification/tests/qualification-reporting.unit.test.ts",
            "dev-tools/scripts/qualification/tests/qualification-report-wiring.unit.test.ts",
            "dev-tools/helpers/tests/test_control_plane_ui_run_evidence_profile.py",
        ])
        self.assertEqual(profile["test_paths"], operational.TESTS)
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]), 76)
        for source in BORROWED:
            self.assertIn(source, profile["source_paths"])
            self.assertNotIn(source, catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"])

    def test_borrowed_sources_need_explicit_or_owned_activation(self):
        with tempfile.TemporaryDirectory(prefix="reporting-profile-") as directory:
            root = Path(directory)
            operational.OperationalUiProfile.fixture(self, root, self.profile())
            for paths, required, selected, generic in [
                (BORROWED, ["operational-ui"], True, False),
                ([BORROWED[0]], ["documentation"], False, True),
                ([CORE, *BORROWED], ["documentation"], True, False),
                ([CORE, *BORROWED], ["focused-tests"], True, True),
                ([CORE, *BORROWED, V + "unknown-report.ts"], ["documentation"], True, True),
            ]:
                with self.subTest(paths=paths, required=required):
                    ids = {check["id"] for check in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertEqual("operational-ui" in ids, selected)
                    self.assertEqual("focused-tests" in ids, generic)

    def test_missing_report_source_coverage_keeps_generic_gate(self):
        for missing in BORROWED:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(prefix="reporting-incomplete-") as directory:
                root = Path(directory)
                profile = self.profile(); profile["source_paths"].remove(missing)
                operational.OperationalUiProfile.fixture(self, root, profile)
                ids = {check["id"] for check in catalog.plan(root, [CORE, *BORROWED], ["documentation"], "synthetic-candidate")["selected"]}
                self.assertIn("operational-ui", ids)
                self.assertIn("focused-tests", ids)

    def test_late_writers_preserve_adjacent_profiles_and_incomplete_fallback(self):
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]), 76)
        for source in LATE_SOURCES:
            self.assertIn(source, self.profile()["source_paths"])
            self.assertNotIn(source, catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"])
            neighbors = {name for name, patterns in catalog.QUALIFICATION_PROFILE_PATTERNS.items()
                         if name != "operational-ui" and any(fnmatch.fnmatchcase(source, pattern) for pattern in patterns)}
            with self.subTest(source=source), tempfile.TemporaryDirectory(prefix="late-report-profile-") as directory:
                root = Path(directory)
                for incomplete, required, generic in [(False, ["documentation"], False),
                                                       (False, ["focused-tests"], True),
                                                       (True, ["documentation"], True)]:
                    profile = self.profile()
                    if incomplete:
                        profile["source_paths"].remove(source)
                    profiles = {"operational-ui": profile, **{
                        name: {"test_paths": ["dev-tools/scripts/qualification/tests/operational-ui-oracles.unit.test.ts"],
                               "source_paths": [source]} for name in neighbors}}
                    config = root / CONFIG; config.parent.mkdir(parents=True, exist_ok=True)
                    config.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": profiles}))
                    ids = {check["id"] for check in catalog.plan(root, [CORE, source], required, "synthetic-candidate")["selected"]}
                    self.assertIn("operational-ui", ids)
                    self.assertTrue(neighbors.issubset(ids))
                    self.assertEqual("focused-tests" in ids, generic)


    def test_owned_run_sources_keep_exact_borrowed_and_adjacent_coverage(self):
        sources = ['dev-tools/scripts/qualification/visual-composer/qualification-reporting.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/owned-task-journey.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/managed-reference-tasks.e2e.spec.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/desktop-task-cleanup.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/meaningful-system-journeys.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-ingestion.e2e.spec.ts', 'dev-tools/scripts/qualification/visual-composer/e2e/desktop-import-cleanup.ts']
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]), 76)
        self.assertEqual(self.profile()["test_paths"][49:56], ['dev-tools/scripts/qualification/tests/owned-task-qualification-profile.unit.test.ts', 'dev-tools/scripts/qualification/tests/desktop-owned-cleanup-failures.unit.test.ts', 'dev-tools/scripts/qualification/tests/meaningful-journey-reporting.unit.test.ts', 'dev-tools/scripts/qualification/tests/desktop-restart-cleanup.unit.test.ts', 'dev-tools/scripts/qualification/tests/desktop-owned-cleanup.unit.test.ts', 'dev-tools/scripts/qualification/tests/task-visibility-measurement.unit.test.ts', 'dev-tools/scripts/qualification/tests/meaningful-system-oracles.unit.test.ts'])
        self.assertEqual(self.profile()["test_paths"][56:57], ['dev-tools/scripts/qualification/tests/review-site-oracles.unit.test.ts'])
        for source in sources:
            self.assertIn(source, self.profile()["source_paths"])
            self.assertNotIn(source, catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"])
            neighbors = {name for name, patterns in catalog.QUALIFICATION_PROFILE_PATTERNS.items()
                         if name != "operational-ui" and any(fnmatch.fnmatchcase(source, pattern) for pattern in patterns)}
            with self.subTest(source=source), tempfile.TemporaryDirectory(prefix="owned-run-profile-") as directory:
                root = Path(directory)
                for incomplete, required, generic in [(False, ["documentation"], False), (False, ["focused-tests"], True), (True, ["documentation"], True)]:
                    profile = self.profile()
                    if incomplete:
                        profile["source_paths"].remove(source)
                    profiles = {"operational-ui": profile, **{name: {"test_paths": ["dev-tools/scripts/qualification/tests/operational-ui-oracles.unit.test.ts"], "source_paths": [source]} for name in neighbors}}
                    config = root / CONFIG; config.parent.mkdir(parents=True, exist_ok=True)
                    config.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": profiles}))
                    ids = {check["id"] for check in catalog.plan(root, [CORE, source], required, "synthetic-candidate")["selected"]}
                    self.assertIn("operational-ui", ids)
                    self.assertTrue(neighbors.issubset(ids))
                    self.assertEqual("focused-tests" in ids, generic)



    def test_settings_borrowed_regressions_do_not_activate_operational_alone(self):
        core=V+"e2e/settings-host-journey.ts"
        borrowed=[V+"owned-host-shutdown.d.mts",V+"settings-host-launch-plan.d.mts"]
        for path in borrowed:
            with self.subTest(path=path), tempfile.TemporaryDirectory(prefix="settings-borrowed-") as directory:
                root=Path(directory);operational.OperationalUiProfile.fixture(self,root,self.profile())
                for paths,required,active,generic in [([path],["documentation"],False,True),
                    ([core,path],["documentation"],True,False),([core,path],["focused-tests"],True,True)]:
                    ids={c["id"] for c in catalog.plan(root,paths,required,"synthetic-candidate")["selected"]}
                    self.assertEqual("operational-ui" in ids,active);self.assertEqual("focused-tests" in ids,generic)

if __name__ == "__main__":
    unittest.main()
