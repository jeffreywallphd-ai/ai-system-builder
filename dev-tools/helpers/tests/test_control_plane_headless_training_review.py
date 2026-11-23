"""Execute private metadata/approval fixtures without model or runtime effects."""
from pathlib import Path
import os
import re
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingReviewRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    sources = (
        "modules/adapters/persistence/system-builder/headlessModelTrainingReviewBindings.ts",
        "modules/hosts/shared/composition/headlessModelTrainingReview.ts",
        "modules/adapters/persistence/system-builder/tests/structured-headless-model-training-review.unit.test.ts",
        "modules/hosts/shared/composition/tests/headless-model-training-review.unit.test.ts",
    )

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "b" * 64)["selected"]}

    def test_exact_sources_select_actual_metadata_storage_fixtures_and_strict_consumers(self):
        for source in self.sources:
            rows = self.selected([source])
            for key in ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types"):
                for test in self.sources[2:]:
                    self.assertIn(test, rows[key]["argv"])
            # These existing legacy fixtures use their normal Node runner.
            # Their old test-source type assumptions are not a new strict pass.
            for legacy in (
                "modules/adapters/persistence/ingestion/tests/structured-headless-local-file-plan-step-store.unit.test.ts",
                "modules/adapters/persistence/ingestion/tests/headless-reviewed-dataset-hosts.integration.test.ts",
                "modules/hosts/shared/composition/tests/headless-context-execution.unit.test.ts",
                "modules/hosts/shared/composition/tests/headless-context-result-execution.unit.test.ts",
            ):
                self.assertIn(legacy, rows["headless-model-metadata-owner-unit"]["argv"])
                self.assertNotIn(legacy, rows["headless-model-metadata-owner-types"]["argv"])
            for source in self.sources[:2]:
                self.assertIn(source, rows["headless-model-metadata-owner-types"]["argv"])
            self.assertNotIn("focused-tests", rows)
            self.assertNotIn("completion-all", rows)

    def test_shared_unknown_and_explicit_generic_fallback_is_preserved(self):
        self.assertIn("focused-tests", self.selected(self.sources, ("focused-tests",)))
        self.assertIn("focused-tests", self.selected((*self.sources, "modules/hosts/shared/composition/unknown-training-review.ts")))
        self.assertNotIn("headless-model-metadata-owner-unit", self.selected([
            "modules/adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository.ts"]))

    def test_missing_feature_fixture_cannot_borrow_automatic_coverage(self):
        required = catalog.PUBLISHED_FORM_CHECKS["headless-model-metadata-owner-unit"]["automatic_required_files"]
        self.assertLessEqual(len(required), 16)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in required:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert routing fixture\n", encoding="utf-8")
            self.assertIn("headless-model-metadata-owner-unit", self.selected(self.sources, root=root))
            (root / self.sources[-1]).unlink()
            rows = self.selected(self.sources, root=root)
            self.assertNotIn("headless-model-metadata-owner-unit", rows)
            self.assertIn("focused-tests", rows)

    def test_real_core_sqlite_original_compiler_and_approval_assertions_execute(self):
        owner = self.selected([self.sources[0]])["headless-model-metadata-owner-unit"]
        environment = {**os.environ, "HF_HUB_OFFLINE": "1"}
        environment.pop("NODE_TEST_CONTEXT", None)
        environment.pop("AISB_RUN_FIXED_NATIVE_QUALIFICATION", None)
        result = subprocess.run([owner["argv"][0], "--import", "tsx", "--test", "--", *self.sources[2:]],
                                cwd=self.root, env=environment, capture_output=True, text=True, timeout=90, check=False)
        self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-12000:])
        counts = {name: int(value) for name, value in re.findall(r"(?m)^(?:# |ℹ )(tests|pass|fail|cancelled|skipped|todo) (\d+)$", result.stdout)}
        self.assertGreaterEqual(counts.get("tests", 0), 20)
        self.assertEqual(counts.get("tests"), counts.get("pass"))
        for name in ("fail", "cancelled", "skipped", "todo"):
            self.assertEqual(counts.get(name), 0)
        for expected in ("SQLite", "original input reader", "each-change approvals", "factory-to-policy handoff",
                         "current compiler binding survives JSON member reordering", "original metadata producer encoding",
                         "JSON-order compatibility never omits facts", "stored approval preserves original training digest"):
            self.assertIn(expected, result.stdout)


if __name__ == "__main__":
    unittest.main()
