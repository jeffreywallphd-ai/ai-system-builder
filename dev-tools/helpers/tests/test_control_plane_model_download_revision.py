"""Exact download selection uses Model/worker feature checks, never all runtime tests."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelDownloadRevisionRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    owner = "modules/application/use-cases/model/download-model.use-case.ts"
    worker = "modules/adapters/runtime/python/worker/tests/test_model_download_revision.py"

    def selected(self, paths, required=("headless-model-metadata-owner-unit", "headless-context-model-worker")):
        return {row["id"]: row for row in catalog.plan(self.root, paths, list(required), "f" * 64)["selected"]}

    def test_model_pipeline_keeps_exact_node_types_and_related_worker_contract_cases(self):
        paths = [self.owner, self.worker, "modules/application/use-cases/model/model-download-tasks.use-case.ts",
                 "modules/application/ports/model/model-download-completion.port.ts",
                 "modules/application/ports/runtime/python-runtime.port.ts",
                 "modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts",
                 "modules/adapters/runtime/python/worker/models.py", "modules/adapters/runtime/python/worker/app.py",
                 "modules/adapters/runtime/python/worker/tasks/local_text_generation.py"]
        rows = self.selected(paths)
        self.assertNotIn("focused-tests", rows)
        self.assertIn("headless-model-metadata-owner-types", rows)
        self.assertIn("modules/adapters/runtime/python/tests/createPythonRuntimeHttpClient.unit.test.ts",
                      rows["headless-model-metadata-owner-unit"]["argv"])
        self.assertIn("modules.adapters.runtime.python.worker.tests.test_model_download_revision.ModelDownloadRevisionTests",
                      rows["headless-context-model-worker"]["argv"])
        self.assertIn("modules.adapters.runtime.python.worker.tests.test_context_generation.ContextGenerationTests",
                      rows["headless-context-model-worker"]["argv"])
        self.assertNotIn("completion-all", rows)

    def test_shared_sources_alone_do_not_activate_the_model_owner(self):
        rows = self.selected(["modules/adapters/runtime/python/worker/app.py"], ("documentation",))
        self.assertNotIn("headless-model-metadata-owner-unit", rows)
        self.assertIn("focused-tests", rows)

    def test_unknown_or_explicit_generic_impact_retains_fallback(self):
        self.assertIn("focused-tests", self.selected([self.owner], ("focused-tests",)))
        self.assertIn("focused-tests", self.selected([self.owner,
            "modules/adapters/runtime/python/worker/tasks/unknown-download-helper.py"]))

    def test_automatic_revision_fixture_selects_only_declared_feature_ownership(self):
        rows = self.selected([self.worker], ("documentation",))
        self.assertIn("headless-model-metadata-owner-unit", rows)
        self.assertIn("headless-context-model-worker", rows)
        self.assertNotIn("focused-tests", rows)


if __name__ == "__main__":
    unittest.main()
