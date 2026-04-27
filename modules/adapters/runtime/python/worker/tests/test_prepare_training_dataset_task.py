from __future__ import annotations

import csv
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import PrepareTrainingDatasetRequest
from modules.adapters.runtime.python.worker.tasks.example_generation import GeneratedQaExample
from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import prepare_training_dataset


class PrepareTrainingDatasetTaskTests(unittest.TestCase):
    def _build_payload(self, output_format: str) -> PrepareTrainingDatasetRequest:
        return PrepareTrainingDatasetRequest.model_validate(
            {
                "sourceInputs": [
                    {
                        "artifactId": "doc-1",
                        "localPath": self.first_path,
                        "mediaType": "text/plain",
                        "originalName": "original-doc-1.txt",
                    },
                    {"artifactId": "doc-2", "localPath": self.second_path, "mediaType": "application/octet-stream"},
                ],
                "recipe": {
                    "normalization": {
                        "targetFormat": "markdown",
                        "unsupportedDocumentPolicy": "skip",
                    },
                    "chunking": {
                        "strategy": "character",
                        "chunkSize": 4,
                        "chunkOverlap": 1,
                        "preserveDocumentBoundaries": True,
                    },
                    "generation": {
                        "mode": "qa",
                        "model": {"provider": "transformers", "modelId": "test-model"},
                    },
                },
                "split": {"trainRatio": 0.5, "testRatio": 0.5, "shuffle": False},
                "output": {"format": output_format, "destinations": {"local": {"enabled": True}}},
            }
        )

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        first = Path(self.temp_dir.name) / "first.txt"
        second = Path(self.temp_dir.name) / "second.unsupported"
        first.write_text("abcdefghij", encoding="utf-8")
        second.write_text("unsupported", encoding="utf-8")
        self.first_path = str(first)
        self.second_path = str(second)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_returns_generated_examples_summary_and_warning_from_normalization(self) -> None:
        payload = self._build_payload("jsonl")

        def generator(chunks, _config):
            return [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question=f"Q{chunk.chunk_index}",
                    answer=chunk.text,
                )
                for chunk in chunks
            ]

        result = prepare_training_dataset(payload, example_generator=generator)

        self.assertEqual(result.summary.sourceDocumentCount, 2)
        self.assertEqual(result.summary.normalizedDocumentCount, 1)
        self.assertEqual(result.summary.skippedDocumentCount, 1)
        self.assertEqual(result.summary.chunkCount, 3)
        self.assertEqual(result.summary.generatedExampleCount, 3)
        self.assertEqual(result.summary.datasetRowCount, 3)
        self.assertEqual(result.summary.trainRowCount, 3)
        self.assertEqual(result.summary.testRowCount, 0)
        self.assertTrue(any(warning.code == "document_normalization_skipped" for warning in result.warnings or []))

    def test_writes_generated_schema_as_jsonl_json_and_csv(self) -> None:
        def generator(chunks, _config):
            return [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="What is this chunk about?",
                    answer=chunk.text,
                )
                for chunk in chunks
            ]

        output_formats = ["jsonl", "json", "csv"]
        try:
            import pyarrow  # noqa: F401

            output_formats.append("parquet")
        except ImportError:
            pass

        for output_format in output_formats:
            payload = self._build_payload(output_format)
            result = prepare_training_dataset(payload, example_generator=generator)

            self.assertEqual(len(result.outputs), 1)
            train_output = next(output for output in result.outputs if output.role == "dataset")
            if output_format == "parquet":
                self.assertEqual(train_output.mediaType, "application/x-parquet")
                self.assertTrue(Path(train_output.tempPath).stat().st_size > 0)
                continue

            contents = Path(train_output.tempPath).read_text(encoding="utf-8")

            if output_format == "jsonl":
                first_row = json.loads(contents.splitlines()[0])
                self.assertEqual(
                    set(first_row.keys()),
                    {
                        "artifactId",
                        "chunkIndex",
                        "instruction",
                        "input",
                        "output",
                        "prompt",
                        "completion",
                        "question",
                        "answer",
                        "generationMode",
                    },
                )
            elif output_format == "json":
                first_row = json.loads(contents)[0]
                self.assertEqual(
                    set(first_row.keys()),
                    {
                        "artifactId",
                        "chunkIndex",
                        "instruction",
                        "input",
                        "output",
                        "prompt",
                        "completion",
                        "question",
                        "answer",
                        "generationMode",
                    },
                )
            else:
                reader = csv.DictReader(contents.splitlines())
                self.assertEqual(
                    reader.fieldnames,
                    [
                        "artifactId",
                        "chunkIndex",
                        "instruction",
                        "input",
                        "output",
                        "prompt",
                        "completion",
                        "question",
                        "answer",
                        "generationMode",
                    ],
                )

    def test_split_validation_requires_positive_ratios_and_total_of_one(self) -> None:
        payload = self._build_payload("jsonl")
        payload.split.trainRatio = 0
        with self.assertRaisesRegex(ValueError, "trainRatio"):
            prepare_training_dataset(payload, example_generator=lambda chunks, _config: [])

        payload = self._build_payload("jsonl")
        payload.split.testRatio = 0
        with self.assertRaisesRegex(ValueError, "testRatio"):
            prepare_training_dataset(payload, example_generator=lambda chunks, _config: [])

        payload = self._build_payload("jsonl")
        payload.split.trainRatio = 0.7
        payload.split.testRatio = 0.2
        with self.assertRaisesRegex(ValueError, "must equal 1.0"):
            prepare_training_dataset(payload, example_generator=lambda chunks, _config: [])

    def test_generation_failure_policy_skip_adds_warning_and_continues(self) -> None:
        payload = self._build_payload("jsonl")
        payload.recipe.generation.failurePolicy = "skip"

        def flaky_generator(chunks, _config):
            chunk = chunks[0]
            if chunk.chunk_index == 1:
                raise RuntimeError("generation blew up")
            return [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="Q",
                    answer=chunk.text,
                )
            ]

        result = prepare_training_dataset(payload, example_generator=flaky_generator)

        warning_codes = [warning.code for warning in result.warnings or []]
        self.assertIn("generation_example_skipped", warning_codes)
        self.assertEqual(result.summary.generatedExampleCount, 2)

    def test_generation_skip_merges_generation_warnings_with_normalization_warnings(self) -> None:
        payload = self._build_payload("jsonl")
        payload.recipe.generation.failurePolicy = "skip"

        def flaky_generator(chunks, _config):
            chunk = chunks[0]
            if chunk.chunk_index == 0:
                raise RuntimeError("generation failed for first chunk")
            return [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="Q",
                    answer=chunk.text,
                )
            ]

        result = prepare_training_dataset(payload, example_generator=flaky_generator)

        warning_codes = [warning.code for warning in result.warnings or []]
        self.assertIn("document_normalization_skipped", warning_codes)
        self.assertIn("generation_example_skipped", warning_codes)

    def test_generation_failure_default_is_fail_fast_in_strict_mode(self) -> None:
        payload = self._build_payload("jsonl")
        payload.recipe.normalization.normalizationMode = "strict"

        def failing_generator(_chunks, _config):
            raise RuntimeError("cannot generate")

        with self.assertRaisesRegex(RuntimeError, "cannot generate"):
            prepare_training_dataset(payload, example_generator=failing_generator)

    def test_enforces_max_chunk_count_guardrail(self) -> None:
        payload = self._build_payload("jsonl")
        payload.recipe.chunking.maxChunkCount = 1

        with self.assertRaisesRegex(ValueError, "maxChunkCount"):
            prepare_training_dataset(payload, example_generator=lambda chunks, _config: [])

    def test_supports_generation_batching(self) -> None:
        payload = self._build_payload("jsonl")
        payload.recipe.generation.batchSize = 2
        batch_sizes: list[int] = []

        def generator(chunks, _config):
            batch_sizes.append(len(chunks))
            return [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="Q",
                    answer=chunk.text,
                )
                for chunk in chunks
            ]

        result = prepare_training_dataset(payload, example_generator=generator)
        self.assertEqual(result.summary.generatedExampleCount, 3)
        self.assertEqual(batch_sizes, [2, 1])

    def test_split_clamps_to_keep_train_and_test_non_empty(self) -> None:
        payload = self._build_payload("jsonl")
        payload.split.trainRatio = 0.1
        payload.split.testRatio = 0.9

        def generator(chunks, _config):
            return [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question=f"Q{chunk.chunk_index}",
                    answer=chunk.text,
                )
                for chunk in chunks
            ]

        result = prepare_training_dataset(payload, example_generator=generator)

        self.assertEqual(result.summary.generatedExampleCount, 3)
        self.assertEqual(result.summary.datasetRowCount, 3)
        self.assertEqual(result.summary.trainRowCount, 3)
        self.assertEqual(result.summary.testRowCount, 0)

        dataset_output = next(output for output in result.outputs if output.role == "dataset")
        self.assertTrue(Path(dataset_output.tempPath).read_text(encoding="utf-8").strip())

    def test_generation_requires_at_least_one_generated_row(self) -> None:
        payload = self._build_payload("jsonl")
        payload.recipe.generation.failurePolicy = "skip"
        output = io.StringIO()

        with patch(
            "modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.ensure_generation_model_is_available",
        ):
            with redirect_stdout(output):
                with self.assertRaises(ValueError) as context:
                    prepare_training_dataset(payload, example_generator=lambda _chunks, _config: [])

        error = context.exception
        self.assertEqual(getattr(error, "stage", None), "generation")
        self.assertEqual(getattr(error, "error_code", None), "generation_no_examples")
        self.assertIn("No training examples were generated", str(error))
        self.assertEqual(getattr(error, "details", {}).get("chunkCount"), 3)
        self.assertEqual(getattr(error, "details", {}).get("failurePolicy"), "skip")
        self.assertEqual(getattr(error, "details", {}).get("skippedGenerationChunkCount"), 3)
        diagnostic = json.loads(output.getvalue().strip())
        self.assertEqual(diagnostic["event"], "runtime.dataset_preparation.generation.failed")
        self.assertEqual(diagnostic["rawData"]["sourceInputs"][0]["artifactId"], "doc-1")
        self.assertEqual(diagnostic["preparedData"]["chunks"][0]["text"], "abcd")
        self.assertTrue(diagnostic["errors"])

    def test_skip_policy_counts_generator_omitted_chunks(self) -> None:
        payload = self._build_payload("jsonl")
        payload.recipe.generation.failurePolicy = "skip"

        def partial_generator(chunks, _config):
            return [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="Q",
                    answer=chunk.text,
                )
                for chunk in chunks
                if chunk.chunk_index != 1
            ]

        result = prepare_training_dataset(payload, example_generator=partial_generator)

        self.assertEqual(result.summary.generatedExampleCount, 2)
        skipped_warnings = [
            warning for warning in result.warnings or [] if warning.code == "generation_example_skipped"
        ]
        self.assertEqual(len(skipped_warnings), 1)
        self.assertIn("returned no usable example", skipped_warnings[0].message)

    def test_fails_early_when_generation_model_is_not_available_locally(self) -> None:
        payload = self._build_payload("jsonl")
        generator_called = False

        def generator(_chunks, _config):
            nonlocal generator_called
            generator_called = True
            return []

        with patch(
            "modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.ensure_generation_model_is_available",
            side_effect=RuntimeError("Generation model 'test-model' is not available in the local Hugging Face cache."),
        ):
            with self.assertRaises(ValueError) as context:
                prepare_training_dataset(payload, example_generator=generator)

        error = context.exception
        self.assertFalse(generator_called)
        self.assertEqual(getattr(error, "stage", None), "generation")
        self.assertEqual(getattr(error, "error_code", None), "generation_model_not_available")
        self.assertEqual(getattr(error, "details", {}).get("modelId"), "test-model")
        self.assertIn("not available in the local Hugging Face cache", str(error))

    def test_single_generated_row_can_be_written_to_one_dataset_file(self) -> None:
        payload = self._build_payload("jsonl")

        def one_row_generator(_chunks, _config):
            return [
                GeneratedQaExample(
                    artifact_id="doc-1",
                    chunk_index=0,
                    question="Q0",
                    answer="A0",
                )
            ]

        result = prepare_training_dataset(payload, example_generator=one_row_generator)

        self.assertEqual(result.summary.datasetRowCount, 1)
        self.assertEqual(len(result.outputs), 1)


if __name__ == "__main__":
    unittest.main()
