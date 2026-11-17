from __future__ import annotations

import tempfile
import importlib
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from modules.adapters.runtime.python.worker.models import (
    DatasetOutputConfigNaming, DatasetQualityRuntimeConfig, PrepareTrainingDatasetRequest,
)
task = importlib.import_module("modules.adapters.runtime.python.worker.tasks.prepare_training_dataset")


def payload() -> PrepareTrainingDatasetRequest:
    return PrepareTrainingDatasetRequest.model_validate({
        "sourceInputs": [{"artifactId": "doc", "localPath": "synthetic-unread-source", "mediaType": "text/plain"}],
        "recipe": {
            "normalization": {"targetFormat": "markdown", "unsupportedDocumentPolicy": "skip"},
            "chunking": {"strategy": "character", "chunkSize": 4, "chunkOverlap": 1, "preserveDocumentBoundaries": True},
            "generation": {"mode": "qa", "model": {"provider": "transformers", "modelId": "synthetic"}},
            "task": {"taskType": "llm-instruction", "promptStyle": "instruction-response"},
        },
        "split": {"trainRatio": 0.5, "testRatio": 0.5, "shuffle": False},
        "output": {"format": "jsonl"},
    })


class DatasetOutputNameTests(unittest.TestCase):
    def test_model_rejects_unsafe_names_and_nontext_without_coercion(self) -> None:
        for name in [".", "..", "../escape", "a/b", "a\\b", "C:\\private", "a:b", "a<", "a>",
                     'a"', "a|", "a?", "a*", "a\x00b", "a\x1fb", "a.", "x" * 129,
                     "\U0001f600" * 65, "a\x1c", True, 123, ["name"]]:
            with self.subTest(name_type=type(name).__name__), self.assertRaises(ValidationError):
                DatasetOutputConfigNaming.model_validate({"baseName": name})

    def test_entry_revalidates_mutated_or_constructed_names_before_any_effect(self) -> None:
        for name in ["../escape", "C:\\private", "a.", "x" * 129, "\U0001f600" * 65, 123]:
            request = payload()
            request.output.naming = DatasetOutputConfigNaming.model_construct(baseName=name)
            with patch.object(task, "_resolve_task_recipe") as recipe, \
                 patch.object(task, "_build_generated_rows") as build, \
                 patch.object(task.tempfile, "mkstemp") as create:
                with self.assertRaisesRegex(ValueError, "^Dataset output name is invalid\\.$"):
                    task.prepare_training_dataset(request)
                recipe.assert_not_called()
                build.assert_not_called()
                create.assert_not_called()

    def test_valid_names_trim_and_retain_utf16_boundaries_and_blank_defaults(self) -> None:
        for name in ["training dataset", "café 数据", "x" * 128, "\U0001f600" * 64]:
            self.assertEqual(DatasetOutputConfigNaming(baseName="\ufeff " + name + "\t").baseName, name)
        for name in [None, "", " \t\ufeff"]:
            self.assertIsNone(DatasetOutputConfigNaming(baseName=name).baseName)

    def test_entry_captures_name_before_request_mutation_and_uses_it_for_every_emitter(self) -> None:
        request = payload()
        request.output.naming = DatasetOutputConfigNaming(baseName="safe name")
        request.quality = DatasetQualityRuntimeConfig.model_validate({
            "requestedPolicy": {"preset": "recommended"}, "reviewRequired": True,
            "effectivePolicy": {
                "policyId": "policy", "revision": "1", "scope": "workspace", "preset": "recommended",
                "allowedLanguages": ["en"], "requireLicenseMetadata": False, "requireConsentMetadata": False,
                "excludedBenchmarkIds": [], "maxRowsPerSource": 100, "minimumTextCharacters": 1,
                "maximumTextCharacters": 10000, "fuzzyDuplicateSimilarity": 0.95,
                "maxFuzzyCandidatesPerRow": 16, "maxReportSamplesPerReason": 3,
                "mandatoryChecks": {"sourceAssociation": True, "schema": True, "exactDuplicates": True,
                    "fuzzyDuplicates": True, "sensitivePersonalData": True, "secretLikeContent": True, "splitLeakage": True},
            },
        })

        def mutate(*_args, **_kwargs):
            request.output.naming.baseName = "../changed"
            return ([{"sourceArtifactId": "doc", "chunkIndex": 0, "instruction": "Question", "response": "Answer"}], [], 1, 0, 1, [], None)

        # The remainder of this real task still validates/curates/partitions and
        # emits its real dataset and quality/lineage report files in a private fixture.
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(task, "_build_generated_rows", side_effect=mutate), \
             patch.object(task.tempfile, "mkstemp", wraps=task.tempfile.mkstemp) as create:
            result = task.prepare_training_dataset(request, output_directory=Path(folder))
            self.assertTrue(result.outputs)
            self.assertTrue(any(output.role == "report" for output in result.outputs))
            self.assertTrue(all(output.name.startswith("safe name") for output in result.outputs))
            self.assertTrue(all(call.kwargs["prefix"].startswith("safe name-") for call in create.call_args_list))
            self.assertTrue(all(Path(output.tempPath).parent == Path(folder) for output in result.outputs))


if __name__ == "__main__":
    unittest.main()
