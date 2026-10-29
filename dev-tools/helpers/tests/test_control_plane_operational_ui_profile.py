"""Finite operational UI qualification must not hide unrelated or explicit test impact."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
from control_plane.contracts import ControlError
import run_focused_checks

ROOT = HELPERS.parents[1]
CONFIG = "dev-tools/config/contributor-check-profiles.json"
TESTS = [
    "apps/desktop/src/renderer/features/python-runtime/tests/use-python-runtime-footer.unit.test.tsx",
    "apps/desktop/src/renderer/features/python-runtime/tests/python-runtime-controls.recovery.ui.test.tsx",
    "apps/desktop/src/renderer/features/python-runtime/tests/desktop-python-runtime-client.unit.test.ts",
    "modules/ui/shared/notifications/tests/NotificationCenter.interaction.ui.test.tsx",
    "modules/ui/shared/notifications/tests/notification-center-actions.ui.test.tsx",
    "modules/ui/shared/notifications/tests/notificationState.unit.test.ts",
    "modules/ui/shared/notifications/tests/TaskObservationProvider.interaction.ui.test.tsx",
    "modules/ui/shared/notifications/tests/taskObservation.unit.test.ts",
    "modules/ui/shared/notifications/tests/TransientNotificationPublisher.interaction.ui.test.tsx",
    "modules/ui/shared/notifications/tests/ModelDownloadNotificationBridge.interaction.ui.test.tsx",
    "modules/ui/shared/notifications/tests/model-download-notification-boundaries.ui.test.tsx",
    "modules/ui/shared/notifications/tests/notificationMigrationGuard.unit.test.ts",
    "modules/ui/shared/context-management/tests/context-task-notification-boundaries.unit.test.tsx",
    "apps/desktop/src/renderer/features/models/tests/model-training-notification-bridge.unit.test.tsx",
    "apps/desktop/src/renderer/features/models/tests/model-training-observation.unit.test.tsx",
    "apps/desktop/src/renderer/features/models/tests/desktop-training-preload.ui.test.tsx",
    "apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-notification-bridge.unit.test.tsx",
    "apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-feature.unit.test.tsx",
    "apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-low-memory.ui.test.tsx",
    "apps/desktop/src/renderer/features/image-generation/tests/image-generation-ownership.unit.test.tsx",
    "apps/desktop/src/renderer/features/image-generation/tests/use-image-generation-feature.unit.test.tsx",
    "apps/thin-client/src/features/image-generation/tests/use-image-generation-feature.unit.test.tsx",
    "apps/desktop/src/renderer/tests/app-shell-visible-page.ui.test.tsx",
    "apps/desktop/src/renderer/tests/app-navigation.ui.test.tsx",
    "apps/desktop/src/renderer/tests/page-section-loading.unit.test.tsx",
    "apps/thin-client/src/tests/app-shell-visible-page.ui.test.tsx",
    "apps/thin-client/src/tests/app-routing.ui.test.tsx",
    "modules/ui/shared/page-dashboard/tests/PageDashboard.interaction.ui.test.tsx",
    "modules/ui/shared/page-dashboard/tests/dashboardMetrics.unit.test.ts",
    "apps/thin-client/src/features/page-dashboard/tests/summary-clients.unit.test.ts",
    "apps/desktop/src/renderer/features/runtime-readiness/tests/runtime-readiness-ui-wording.unit.test.ts",
    "apps/desktop/src/renderer/features/runtime-readiness/tests/runtime-readiness-client-boundary.unit.test.ts",
    "apps/desktop/src/renderer/features/runtime-readiness/tests/desktop-runtime-readiness-client.unit.test.ts",
    "apps/desktop/src/renderer/features/runtime-readiness/components/runtimeSetupViewModel.unit.test.ts",
    "apps/thin-client/src/features/runtime-readiness/tests/thin-client-runtime-readiness-client.unit.test.ts",
    "apps/thin-client/src/features/runtime-readiness/components/runtimeSetupViewModel.unit.test.ts",
    "dev-tools/scripts/qualification/tests/operational-ui-oracles.unit.test.ts",
    "dev-tools/scripts/qualification/tests/operational-desktop-case.unit.test.ts",
    "dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts",
    "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts",
    "dev-tools/helpers/tests/test_control_plane_operational_ui_profile.py"
]
TESTS += [
    "dev-tools/scripts/qualification/tests/native-data-context-admission.unit.test.ts",
    "dev-tools/scripts/qualification/tests/asset-authoring-journey-oracles.unit.test.ts",
    "dev-tools/scripts/qualification/tests/native-asset-system-admission.unit.test.ts",
    "dev-tools/scripts/qualification/tests/native-lifecycle-ocr-admission.unit.test.ts",
    "dev-tools/scripts/qualification/tests/runtime-lifecycle-oracles.unit.test.ts",
    "dev-tools/scripts/qualification/tests/qualification-reporting.unit.test.ts",
    "dev-tools/scripts/qualification/tests/qualification-report-wiring.unit.test.ts",
    "dev-tools/helpers/tests/test_control_plane_ui_run_evidence_profile.py",
]
TESTS += [
    "dev-tools/scripts/qualification/tests/owned-task-qualification-profile.unit.test.ts",
    "dev-tools/scripts/qualification/tests/desktop-owned-cleanup-failures.unit.test.ts",
    "dev-tools/scripts/qualification/tests/meaningful-journey-reporting.unit.test.ts",
    "dev-tools/scripts/qualification/tests/desktop-restart-cleanup.unit.test.ts",
    "dev-tools/scripts/qualification/tests/desktop-owned-cleanup.unit.test.ts",
    "dev-tools/scripts/qualification/tests/task-visibility-measurement.unit.test.ts",
    "dev-tools/scripts/qualification/tests/meaningful-system-oracles.unit.test.ts"
]

# Fixed literal Node groups retain the twelve-file Windows argument bound.
EXPECTED_COMMANDS = [
    [
        "node",
        "--import",
        "tsx",
        "--test",
        "--",
        "apps/desktop/src/renderer/features/runtime-readiness/tests/desktop-runtime-readiness-client.unit.test.ts",
        "apps/desktop/src/renderer/features/runtime-readiness/tests/runtime-readiness-client-boundary.unit.test.ts",
        "apps/desktop/src/renderer/features/runtime-readiness/tests/runtime-readiness-ui-wording.unit.test.ts",
        "apps/desktop/src/renderer/tests/app-navigation.ui.test.tsx",
        "apps/desktop/src/renderer/tests/app-shell-visible-page.ui.test.tsx",
        "apps/desktop/src/renderer/tests/page-section-loading.unit.test.tsx",
        "apps/thin-client/src/features/runtime-readiness/tests/thin-client-runtime-readiness-client.unit.test.ts",
        "dev-tools/scripts/qualification/tests/asset-authoring-journey-oracles.unit.test.ts",
        "dev-tools/scripts/qualification/tests/desktop-owned-cleanup.unit.test.ts",
        "dev-tools/scripts/qualification/tests/desktop-restart-cleanup.unit.test.ts",
        "dev-tools/scripts/qualification/tests/meaningful-system-oracles.unit.test.ts",
        "dev-tools/scripts/qualification/tests/owned-task-qualification-profile.unit.test.ts"
    ],
    [
        "node",
        "--import",
        "tsx",
        "--test",
        "--",
        "dev-tools/scripts/qualification/tests/qualification-report-wiring.unit.test.ts",
        "dev-tools/scripts/qualification/tests/qualification-reporting.unit.test.ts",
        "dev-tools/scripts/qualification/tests/runtime-lifecycle-oracles.unit.test.ts",
        "dev-tools/scripts/qualification/tests/task-visibility-measurement.unit.test.ts",
        "modules/ui/shared/notifications/tests/ModelDownloadNotificationBridge.interaction.ui.test.tsx",
        "modules/ui/shared/notifications/tests/NotificationCenter.interaction.ui.test.tsx",
        "modules/ui/shared/notifications/tests/TransientNotificationPublisher.interaction.ui.test.tsx",
        "modules/ui/shared/notifications/tests/model-download-notification-boundaries.ui.test.tsx",
        "modules/ui/shared/notifications/tests/notificationMigrationGuard.unit.test.ts",
        "modules/ui/shared/notifications/tests/notificationState.unit.test.ts",
        "modules/ui/shared/notifications/tests/taskObservation.unit.test.ts",
        "modules/ui/shared/page-dashboard/tests/dashboardMetrics.unit.test.ts"
    ],
    [
        "node",
        "dev-tools/helpers/run_vitest_checks.mjs",
        "--",
        "apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-feature.unit.test.tsx",
        "apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-low-memory.ui.test.tsx",
        "apps/desktop/src/renderer/features/dataset-preparation/tests/dataset-preparation-notification-bridge.unit.test.tsx",
        "apps/desktop/src/renderer/features/image-generation/tests/image-generation-ownership.unit.test.tsx",
        "apps/desktop/src/renderer/features/image-generation/tests/use-image-generation-feature.unit.test.tsx",
        "apps/desktop/src/renderer/features/models/tests/desktop-training-preload.ui.test.tsx",
        "apps/desktop/src/renderer/features/models/tests/model-training-notification-bridge.unit.test.tsx",
        "apps/desktop/src/renderer/features/models/tests/model-training-observation.unit.test.tsx",
        "apps/desktop/src/renderer/features/python-runtime/tests/desktop-python-runtime-client.unit.test.ts",
        "apps/desktop/src/renderer/features/python-runtime/tests/python-runtime-controls.recovery.ui.test.tsx",
        "apps/desktop/src/renderer/features/python-runtime/tests/use-python-runtime-footer.unit.test.tsx",
        "apps/desktop/src/renderer/features/runtime-readiness/components/runtimeSetupViewModel.unit.test.ts",
        "apps/thin-client/src/features/image-generation/tests/use-image-generation-feature.unit.test.tsx",
        "apps/thin-client/src/features/page-dashboard/tests/summary-clients.unit.test.ts",
        "apps/thin-client/src/features/runtime-readiness/components/runtimeSetupViewModel.unit.test.ts",
        "apps/thin-client/src/tests/app-routing.ui.test.tsx",
        "apps/thin-client/src/tests/app-shell-visible-page.ui.test.tsx",
        "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts",
        "dev-tools/scripts/qualification/tests/desktop-owned-cleanup-failures.unit.test.ts",
        "dev-tools/scripts/qualification/tests/meaningful-journey-reporting.unit.test.ts",
        "dev-tools/scripts/qualification/tests/native-asset-system-admission.unit.test.ts",
        "dev-tools/scripts/qualification/tests/native-data-context-admission.unit.test.ts",
        "dev-tools/scripts/qualification/tests/native-lifecycle-ocr-admission.unit.test.ts",
        "dev-tools/scripts/qualification/tests/operational-desktop-case.unit.test.ts",
        "dev-tools/scripts/qualification/tests/operational-ui-oracles.unit.test.ts",
        "dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts",
        "modules/ui/shared/context-management/tests/context-task-notification-boundaries.unit.test.tsx",
        "modules/ui/shared/notifications/tests/TaskObservationProvider.interaction.ui.test.tsx",
        "modules/ui/shared/notifications/tests/notification-center-actions.ui.test.tsx",
        "modules/ui/shared/page-dashboard/tests/PageDashboard.interaction.ui.test.tsx"
    ]
]
EXPECTED_COMMANDS.append([sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane_operational_ui_profile.py"])
EXPECTED_COMMANDS.append([sys.executable, "-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane_ui_run_evidence_profile.py"])

class OperationalUiProfile(unittest.TestCase):
    def test_native_data_sources_retain_exact_coverage_and_unknown_fallback(self):
        source = "dev-tools/scripts/qualification/visual-composer/e2e/provided-dataset-version-journey.ts"
        core = "dev-tools/scripts/qualification/tests/operational-desktop-case.unit.test.ts"
        admission = "dev-tools/scripts/qualification/tests/native-data-context-admission.unit.test.ts"
        oracle = "dev-tools/scripts/qualification/tests/asset-authoring-journey-oracles.unit.test.ts"
        declaration = "dev-tools/scripts/qualification/visual-composer/owned-native-process-exit.d.mts"
        collection = "dev-tools/scripts/qualification/tests/provided-dataset-host-launch-plan.unit.test.mjs"
        self.assertEqual(self.profile()["test_paths"][41:43], [admission, oracle])
        self.assertEqual(len(self.profile()["test_paths"]), 56)
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]), 22)
        self.assertIn(declaration, self.profile()["source_paths"])
        self.assertNotIn(declaration, catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"])
        self.assertIn(collection, self.profile()["source_paths"])
        self.assertNotIn(collection, catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"])
        with tempfile.TemporaryDirectory(prefix="operational-native-data-") as directory:
            root = Path(directory)
            self.fixture(root, self.profile())
            # This source also activates the existing browser profile. Keep that
            # independent group selected; the fixture must provide its schema.
            configuration = {"schema_version":"contributor-check-profiles-v1","profiles":{
                "operational-ui":self.profile(),
                "dataset-version-browser":{"test_paths":["modules/ui/shared/dataset-version/tests/datasetVersionReplay.unit.test.ts"],"source_paths":[source]},
            }}
            (root / CONFIG).write_text(json.dumps(configuration))
            for paths, required, generic in [([core, source, admission, declaration, collection], ["documentation"], False),
                ([core, source], ["focused-tests"], True), ([core, source, "modules/unknown/unreviewed.ts"], ["documentation"], True)]:
                with self.subTest(paths=paths, required=required):
                    ids = {c["id"] for c in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertIn("operational-ui", ids)
                    self.assertIn("dataset-version-browser", ids)
                    self.assertEqual("focused-tests" in ids, generic)
            for missing in [source, declaration, collection]:
                profile = self.profile()
                profile["source_paths"].remove(missing)
                configuration["profiles"]["operational-ui"] = profile
                (root / CONFIG).write_text(json.dumps(configuration))
                self.assertIn("focused-tests", {c["id"] for c in catalog.plan(root, [core,source,declaration,collection], ["documentation"], "synthetic-candidate")["selected"]})

    def test_native_desktop_helper_is_exact_borrowed_coverage(self):
        helper = "dev-tools/scripts/qualification/visual-composer/e2e/native-desktop-zoom.ts"
        core = "dev-tools/scripts/qualification/tests/operational-desktop-case.unit.test.ts"
        self.assertEqual(len(self.profile()["test_paths"]), 56)
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]), 22)
        self.assertIn(helper, self.profile()["source_paths"])
        self.assertNotIn(helper, catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"])
        with tempfile.TemporaryDirectory(prefix="operational-native-desktop-") as directory:
            root = Path(directory)
            self.fixture(root, self.profile())
            for paths, required, operational, generic in [
                ([core, helper, CONFIG], ["documentation"], True, False),
                ([helper], ["documentation"], False, True),
                ([core, helper], ["focused-tests"], True, True),
                ([core, helper, "dev-tools/scripts/qualification/visual-composer/e2e/unreviewed.ts"], ["documentation"], True, True),
            ]:
                with self.subTest(paths=paths, required=required):
                    ids = {check["id"] for check in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertEqual("operational-ui" in ids, operational)
                    self.assertEqual("focused-tests" in ids, generic)
            incomplete = self.profile()
            incomplete["source_paths"].remove(helper)
            (root / CONFIG).write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"operational-ui": incomplete}}))
            ids = {check["id"] for check in catalog.plan(root, [core, helper], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertIn("focused-tests", ids)

    def test_native_zoom_type_coverage_is_borrowed_and_preserves_fallback(self):
        declaration = "dev-tools/scripts/qualification/visual-composer/native-browser-zoom.d.mts"
        core = "dev-tools/scripts/qualification/visual-composer/e2e/critical-surface-accessibility.ts"
        self.assertEqual(len(self.profile()["test_paths"]), 56)
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]), 22)
        self.assertIn(declaration, self.profile()["source_paths"])
        self.assertNotIn(declaration, catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"])
        with tempfile.TemporaryDirectory(prefix="operational-native-profile-") as directory:
            root = Path(directory)
            self.fixture(root, self.profile())
            for paths, required, operational, generic in [
                ([core, declaration, CONFIG], ["documentation"], True, False),
                ([declaration], ["documentation"], False, True),
                ([core, declaration], ["focused-tests"], True, True),
                ([core, declaration, "dev-tools/scripts/qualification/visual-composer/unreviewed.mts"], ["documentation"], True, True),
            ]:
                with self.subTest(paths=paths, required=required):
                    ids = {check["id"] for check in catalog.plan(root, paths, required, "synthetic-candidate")["selected"]}
                    self.assertEqual("operational-ui" in ids, operational)
                    self.assertEqual("focused-tests" in ids, generic)
            incomplete = self.profile()
            incomplete["source_paths"].remove(declaration)
            (root / CONFIG).write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"operational-ui": incomplete}}))
            ids = {check["id"] for check in catalog.plan(root, [core, declaration], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertIn("focused-tests", ids)

    def test_exact_menu_sources_keep_unknown_incomplete_and_explicit_generic_guards(self):
        menu = ["modules/ui/shared/hooks/useNavigationMenu.ts", "apps/desktop/src/renderer/components/layout/AppShell.tsx", "apps/thin-client/src/components/layout/AppShell.tsx"]
        borrowed = ["modules/ui/shared/index.ts", "modules/ui/shared/hooks/README.md", CONFIG, "dev-tools/helpers/control_plane/catalog.py", "dev-tools/helpers/tests/test_control_plane_operational_ui_profile.py"]
        with tempfile.TemporaryDirectory(prefix="operational-menu-profile-") as directory:
            root = Path(directory); self.fixture(root, self.profile())
            for paths, required, generic in [(menu + borrowed, ["documentation"], False), (menu, ["focused-tests"], True), (menu + ["modules/ui/shared/hooks/unreviewed.ts"], ["documentation"], True)]:
                with self.subTest(paths=paths, required=required):
                    plan = catalog.plan(root, paths, required, "synthetic-candidate"); ids = {check["id"] for check in plan["selected"]}
                    self.assertIn("operational-ui", ids); self.assertEqual("focused-tests" in ids, generic)
            for missing in [menu[0], borrowed[0], borrowed[1]]:
                profile = self.profile(); profile["source_paths"].remove(missing); (root / CONFIG).write_text(json.dumps({"schema_version":"contributor-check-profiles-v1","profiles":{"operational-ui":profile}}))
                self.assertIn("focused-tests", {check["id"] for check in catalog.plan(root, menu + borrowed, ["documentation"], "synthetic-candidate")["selected"]})

    def test_menu_borrowed_files_alone_do_not_activate_operational_profile(self):
        with tempfile.TemporaryDirectory(prefix="operational-menu-profile-") as directory:
            root = Path(directory); self.fixture(root, self.profile())
            for source in ["modules/ui/shared/index.ts", "modules/ui/shared/hooks/README.md", "dev-tools/helpers/control_plane/catalog.py", "dev-tools/helpers/tests/test_control_plane_operational_ui_profile.py", "dev-tools/README.md"]:
                with self.subTest(source=source):
                    ids = {check["id"] for check in catalog.plan(root, [source], ["documentation"], "synthetic-candidate")["selected"]}
                    self.assertNotIn("operational-ui", ids)

    def test_shared_borrowed_files_do_not_activate_operational_checks_in_other_profiles(self):
        for name, source, test in [
            ("system-build-publication-ui", "dev-tools/scripts/qualification/visual-composer/e2e/guided-system-lifecycle.ts", "modules/ui/shared/system-builder/tests/SystemBuildPublish.interaction.ui.test.tsx"),
            ("system-runtime-conversation-ui", "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-visual-composer.e2e.spec.ts", "apps/desktop/src/system-runtime/tests/SystemRuntimeApp.interaction.ui.test.tsx"),
            ("system-runtime-conversation-ui", "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-visual-composer.e2e.spec.ts", "apps/desktop/src/system-runtime/tests/SystemRuntimeApp.interaction.ui.test.tsx"),
            ("asset-authoring-ui", "dev-tools/scripts/qualification/visual-composer/e2e/asset-authoring-journey.ts", "modules/ui/shared/notifications/tests/TransientNotificationPublisher.interaction.ui.test.tsx"),
            ("system-canvas-authoring-ui", "dev-tools/scripts/qualification/visual-composer/e2e/browse-authoring-journey.ts", "dev-tools/scripts/qualification/tests/meaningful-system-oracles.unit.test.ts"),
            ("dataset-version-browser", "dev-tools/scripts/qualification/visual-composer/e2e/manual-context-host-journey.ts", "modules/ui/shared/dataset-version/tests/datasetVersionReplay.unit.test.ts"),
            ("dataset-version-browser", "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-dataset-versions.e2e.spec.ts", "modules/ui/shared/dataset-version/tests/datasetVersionReplay.unit.test.ts"),
            ("asset-authoring-ui", "dev-tools/scripts/qualification/visual-composer/e2e/isolated-desktop-case.ts", "modules/ui/shared/notifications/tests/TransientNotificationPublisher.interaction.ui.test.tsx"),
            ("asset-authoring-ui", "dev-tools/README.md", "modules/ui/shared/notifications/tests/TransientNotificationPublisher.interaction.ui.test.tsx"),
            ("asset-authoring-ui", "modules/ui/shared/notifications/tests/TransientNotificationPublisher.interaction.ui.test.tsx", "modules/ui/shared/notifications/tests/TransientNotificationPublisher.interaction.ui.test.tsx"),
            ("desktop-startup-ui", "apps/desktop/src/renderer/README.md", "apps/desktop/src/renderer/tests/app-lazy-pages.ui.test.tsx"),
        ]:
            with self.subTest(profile=name), tempfile.TemporaryDirectory(prefix="operational-profile-") as directory:
                root = Path(directory)
                path = root / CONFIG
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {name: {"test_paths": [test], "source_paths": [source]}}}))
                ids = {check["id"] for check in catalog.plan(root, [source], [name], "synthetic-candidate")["selected"]}
                self.assertEqual(ids.intersection(catalog.QUALIFICATION_PROFILES), {name})

    def profile(self):
        return json.loads((ROOT / CONFIG).read_bytes())["profiles"]["operational-ui"]

    def fixture(self, root, profile):
        path = root / CONFIG
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"schema_version": "contributor-check-profiles-v1", "profiles": {"operational-ui": profile}}))

    def test_exact_operational_files_keep_their_literal_node_and_vitest_runners(self):
        self.assertEqual(self.profile()["test_paths"], TESTS)
        commands = run_focused_checks.profile_commands(ROOT, "operational-ui")
        self.assertEqual(commands, EXPECTED_COMMANDS)
        self.assertTrue(set(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]).issubset(self.profile()["source_paths"]))

    def test_auto_selection_preserves_unknown_and_explicit_generic_tests(self):
        with tempfile.TemporaryDirectory(prefix="operational-profile-") as directory:
            root = Path(directory)
            self.fixture(root, self.profile())
            hook = "apps/desktop/src/renderer/features/python-runtime/hooks/usePythonRuntimeFooter.ts"
            for paths, required, generic in [
                ([hook, CONFIG], ["documentation"], False),
                (["modules/ui/shared/notifications/tests/notificationMigrationInventory.ts"], ["documentation"], False),
                (["dev-tools/scripts/qualification/visual-composer/technical-accessibility-observation.ts"], ["documentation"], False),
                (["dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts"], ["documentation"], False),
                (["dev-tools/scripts/qualification/visual-composer/e2e/technical-accessibility.ts"], ["documentation"], False),
                (["dev-tools/scripts/qualification/visual-composer/e2e/critical-surface-accessibility.ts"], ["documentation"], False),
                (["dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts"], ["documentation"], False),
                ([hook], ["focused-tests"], True),
                ([hook, "modules/unknown/changed.ts"], ["documentation"], True),
            ]:
                with self.subTest(paths=paths):
                    plan = catalog.plan(root, paths, required, "synthetic-candidate")
                    ids = {check["id"] for check in plan["selected"]}
                    self.assertIn("operational-ui", ids)
                    self.assertEqual("focused-tests" in ids, generic)
                    self.assertEqual(ids.intersection(catalog.QUALIFICATION_PROFILES), {"operational-ui"})
            ids = {check["id"] for check in catalog.plan(root, ["apps/desktop/src/renderer/unrelated.ts"], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertNotIn("operational-ui", ids)

    def test_incomplete_declared_source_coverage_retains_generic_tests(self):
        with tempfile.TemporaryDirectory(prefix="operational-profile-") as directory:
            root = Path(directory)
            profile = self.profile()
            hook = "apps/desktop/src/renderer/features/python-runtime/hooks/usePythonRuntimeFooter.ts"
            profile["source_paths"] = [path for path in profile["source_paths"] if path != hook]
            self.fixture(root, profile)
            ids = {check["id"] for check in catalog.plan(root, [hook], ["documentation"], "synthetic-candidate")["selected"]}
            self.assertIn("focused-tests", ids)

    def test_unsafe_and_ai_tests_are_not_executable_profile_entries(self):
        for path in ["../outside.test.ts", "apps/settings/source.ts", "modules/model/example.ai.test.ts", "modules/runtime/tests/test_context_generation_ai_e2e.py"]:
            with self.subTest(path=path), tempfile.TemporaryDirectory(prefix="operational-profile-") as directory:
                root = Path(directory)
                self.fixture(root, {"test_paths": [path], "source_paths": TESTS})
                with patch.object(run_focused_checks, "snapshot", return_value={"files": {path: "synthetic"}}):
                    with self.assertRaises(ControlError):
                        run_focused_checks.profile_commands(root, "operational-ui")

    def test_missing_valid_test_paths_and_missing_candidate_members_are_denied(self):
        path = "apps/desktop/valid-missing.test.ts"
        for exists in (False, True):
            with self.subTest(file_exists=exists), tempfile.TemporaryDirectory(prefix="operational-profile-") as directory:
                root = Path(directory)
                self.fixture(root, {"test_paths": [path], "source_paths": [path]})
                if exists:
                    target = root / path
                    target.parent.mkdir(parents=True)
                    target.write_text('import { test } from "vitest"; test("inert", () => {});')
                with patch.object(run_focused_checks, "snapshot", return_value={"files": {}}):
                    with self.assertRaises(ControlError):
                        run_focused_checks.profile_commands(root, "operational-ui")

if __name__ == "__main__":
    unittest.main()
