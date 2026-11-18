"""Exact preview checks retain ordinary fallback for unrelated source owners."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog


class DatasetPreviewRoutingTests(unittest.TestCase):
    def test_reviewed_result_publication_runs_exact_atomic_and_host_tests(self):
        sources = ["modules/contracts/headless/headless-dataset-result-plan.ts",
                   "modules/contracts/headless/headless-dataset-task-review.ts",
                   "modules/application/use-cases/ingestion-acquisition/headless-dataset-task-review.use-case.ts",
                   "modules/application/ports/dataset-version/dataset-version-commit-admission.port.ts",
                   "modules/application/services/dataset-version/dataset-version-finalization.service.ts",
                   "modules/adapters/persistence/ingestion/createStructuredHeadlessDatasetResultStore.ts",
                   "modules/adapters/persistence/dataset-version/createStructuredDatasetVersionRepository.ts"]
        selected = self.selected(sources)
        self.assertNotIn("focused-tests", selected)
        command = selected["headless-approved-dataset-task-wiring"]["argv"]
        for name in ["modules/contracts/headless/tests/headless-dataset-result-plan.unit.test.ts",
                     "modules/contracts/headless/tests/headless-dataset-task-review.unit.test.ts",
                     "modules/application/use-cases/ingestion-acquisition/tests/headless-dataset-task-review.unit.test.ts",
                     "modules/application/services/dataset-version/tests/dataset-version-finalization.service.unit.test.ts",
                     "modules/adapters/persistence/ingestion/tests/structured-headless-dataset-result-store.unit.test.ts",
                     "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
                     "modules/adapters/persistence/dataset-version/tests/structured-dataset-version-repository.unit.test.ts"]:
            self.assertIn(name, command)
        self.assertIn("focused-tests", self.selected(sources + ["modules/application/ports/dataset-version/unknown.port.ts"]))
        self.assertIn("focused-tests", self.selected(sources, ["focused-tests"]))

    def test_takeover_policy_and_consent_copy_select_existing_focused_denial_checks(self):
        sources = ["modules/hosts/desktop/composition/composeDesktopUiControl.ts",
                   "modules/ui/shared/takeover/WindowTakeoverControls.tsx"]
        selected = self.selected(sources)
        self.assertNotIn("focused-tests", selected)
        self.assertIn("modules/ui/shared/takeover/tests/window-takeover-controls.interaction.test.tsx",
                      selected["headless-desktop-takeover-controls"]["argv"])
        self.assertIn("focused-tests", self.selected(sources + ["modules/hosts/desktop/composition/unknown-policy.ts"]))
        worker = ["modules/contracts/runtime/dataset-preparation.ts", "modules/adapters/runtime/python/worker/README.md",
                  "modules/adapters/runtime/python/worker/tasks/prepare_training_dataset.py",
                  "modules/adapters/runtime/python/worker/tests/test_prepare_training_dataset_task.py"]
        self.assertNotIn("focused-tests", self.selected(worker, ["architecture", "dataset-preparation-core-unit"]))
        self.assertIn("focused-tests", self.selected(worker + ["modules/adapters/runtime/python/worker/tasks/unknown.py"],
                                                     ["architecture", "dataset-preparation-core-unit"]))

    def test_production_worker_wrapper_runs_its_actual_guard_tests(self):
        source = "dev-tools/scripts/qualification/visual-composer/headless-dataset-runtime-worker.py"
        selected = self.selected([source])
        self.assertNotIn("focused-tests", selected)
        self.assertIn("dev-tools/scripts/qualification/tests/managed-reference-lifecycle.unit.test.mjs",
                      selected["managed-headless-browser-live-fixture"]["argv"])
        self.assertIn("focused-tests", self.selected([source, "dev-tools/scripts/qualification/visual-composer/unmapped.py"]))
        self.assertIn("focused-tests", self.selected([source], ["focused-tests"]))

    def test_approved_tasks_have_exact_authority_and_real_store_checks(self):
        sources = ["modules/contracts/headless/headless-dataset-plan.ts",
                   "modules/adapters/persistence/ingestion/createStructuredHeadlessDatasetPlanTaskStore.ts",
                   "modules/hosts/shared/composition/headlessPlanReview.ts"]
        selected = self.selected(sources)
        self.assertNotIn("focused-tests", selected)
        command = selected["headless-approved-dataset-task-wiring"]["argv"]
        for name in ["modules/contracts/headless/tests/headless-dataset-plan.unit.test.ts",
                     "modules/adapters/persistence/ingestion/tests/headless-approved-dataset-hosts.integration.test.ts",
                     "modules/adapters/persistence/system-builder/tests/structured-headless-operation-store.unit.test.ts",
                     "modules/ui/shared/headless/tests/HeadlessPlanApprovalDialog.interaction.ui.test.tsx"]:
            self.assertIn(name, command)
        self.assertIn("focused-tests", self.selected(sources + ["modules/adapters/persistence/ingestion/unknown-owner.ts"]))
        self.assertIn("focused-tests", self.selected(sources, ["focused-tests"]))
        self.assertIn("headless-approved-dataset-task-wiring", self.selected(
            ["dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts"]))

    def test_exact_data_presentation_runs_authority_and_passive_resource_denials(self):
        sources = ["modules/application/use-cases/ingestion-acquisition/headless-data-presentation.use-case.ts",
                   "modules/hosts/shared/composition/headlessDataPresentation.ts",
                   "modules/hosts/shared/composition/tests/headless-data-presentation.unit.test.ts"]
        selected = self.selected(sources)
        self.assertNotIn("focused-tests", selected)
        command = selected["headless-ui-control-authority"]["argv"]
        for name in [sources[2], "modules/contracts/headless/tests/ui-control-delivery.unit.test.ts",
                     "modules/adapters/persistence/ingestion/tests/structured-headless-dataset-plan-task-store.unit.test.ts"]:
            self.assertIn(name, command)
        self.assertIn("focused-tests", self.selected(sources + ["modules/hosts/shared/composition/unmapped.ts"]))
        self.assertIn("focused-tests", self.selected(sources, ["focused-tests"]))

    def selected(self, paths, required=None):
        return {row["id"]: row for row in catalog.plan(
            HELPERS.parents[1], paths, required or ["architecture"], "a" * 64)["selected"]}

    def test_passive_contract_and_input_owner_have_exact_executable_tests(self):
        paths = ["modules/contracts/headless/headless-dataset-preparation.ts",
                 "modules/contracts/headless/headless-protocol.ts",
                 "modules/contracts/headless/tests/headless-dataset-preparation.unit.test.ts",
                 "modules/application/use-cases/ingestion-acquisition/headless-dataset-preparation.use-case.ts"]
        selected = self.selected(paths)
        self.assertNotIn("focused-tests", selected)
        command = selected["headless-dataset-preview-contract"]["argv"]
        self.assertIn(paths[2], command)
        self.assertIn("modules/application/use-cases/ingestion-acquisition/tests/headless-dataset-preparation.unit.test.ts", command)
        self.assertNotIn("--suite=all", command)
        self.assertIn("focused-tests", self.selected(paths + ["modules/application/use-cases/another-owner.ts"]))
        self.assertIn("focused-tests", self.selected(paths, ["focused-tests"]))

    def test_definition_witness_runs_its_actual_vitest_guard_only(self):
        source = "dev-tools/scripts/qualification/tests/meaningful-journey-reporting.unit.test.ts"
        selected = self.selected([source])
        self.assertNotIn("focused-tests", selected)
        self.assertEqual(selected["headless-data-definition-witnesses"]["argv"][1:],
                         ["dev-tools/helpers/run_vitest_checks.mjs", "--", source])
        self.assertIn("focused-tests", self.selected([source, "dev-tools/scripts/qualification/unmapped.ts"]))

    def test_owned_start_runs_new_denials_and_existing_pipeline_regressions(self):
        source = "modules/application/use-cases/prepare-training-dataset-from-artifacts.use-case.ts"
        port = "modules/application/ports/runtime/local-dataset-preparation-admission.port.ts"
        selected = self.selected([source, port, "modules/application/ports/runtime/index.ts"])
        self.assertNotIn("focused-tests", selected)
        command = selected["headless-dataset-owned-start"]["argv"]
        for name in ["prepare-training-dataset-local-admission.unit.test.ts",
                     "prepare-training-dataset-from-artifacts.use-case.unit.test.ts",
                     "prepare-training-dataset-quality-policy.unit.test.ts",
                     "prepare-training-dataset-source-isolation.integration.test.ts",
                     "prepare-training-dataset-version-finalization.unit.test.ts"]:
            self.assertIn("modules/application/use-cases/tests/" + name, command)
        self.assertIn("focused-tests", self.selected([source, "modules/application/ports/runtime/unknown.port.ts"]))
        self.assertIn("focused-tests", self.selected([source], ["focused-tests"]))


if __name__ == "__main__":
    unittest.main()
