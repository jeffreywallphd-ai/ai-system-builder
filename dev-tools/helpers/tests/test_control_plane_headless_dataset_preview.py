"""Exact preview checks retain ordinary fallback for unrelated source owners."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog


class DatasetPreviewRoutingTests(unittest.TestCase):
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
