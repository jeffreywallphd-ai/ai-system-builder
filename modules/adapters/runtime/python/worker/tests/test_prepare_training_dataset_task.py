from __future__ import annotations

import csv
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import PrepareTrainingDatasetRequest
from modules.adapters.runtime.python.worker.tasks.example_generation import GeneratedQaExample
from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import (
    _partition_rows,
    _read_structured_source_rows,
    prepare_training_dataset,
)


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
                    "task": {
                        "taskType": "llm-instruction",
                        "promptStyle": "instruction-response",
                    },
                },
                "split": {"trainRatio": 0.5, "testRatio": 0.5, "shuffle": False},
                "output": {"format": output_format, "destinations": {"local": {"enabled": True}}},
            }
        )

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.model_availability_patcher = patch(
            "modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.ensure_generation_model_is_available",
        )
        self.model_availability_patcher.start()
        first = Path(self.temp_dir.name) / "first.txt"
        second = Path(self.temp_dir.name) / "second.unsupported"
        first.write_text("abcdefghij", encoding="utf-8")
        second.write_text("unsupported", encoding="utf-8")
        self.first_path = str(first)
        self.second_path = str(second)

    def tearDown(self) -> None:
        self.model_availability_patcher.stop()
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
        serialized_output = result.model_dump(mode="json")["outputs"][0]
        self.assertRegex(serialized_output["outputHandle"], r"^[A-Za-z0-9._-]+$")
        self.assertNotIn("tempPath", serialized_output)

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

            self.assertGreaterEqual(len(result.outputs), 2)
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
                        "split",
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
                        "split",
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
                        "split",
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

        with self.assertRaisesRegex(ValueError, "Generation failed") as context:
            prepare_training_dataset(payload, example_generator=failing_generator)

        self.assertEqual(getattr(context.exception, "stage", None), "generation")
        self.assertEqual(getattr(context.exception, "error_code", None), "generation_failed")

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

    def test_partition_is_deterministic_and_keeps_sources_and_duplicates_together(self) -> None:
        rows = [
            {"text": "same", "label": "a", "sourceArtifactId": "source-a", "sourceRowIndex": 0},
            {"text": "same", "label": "a", "sourceArtifactId": "source-b", "sourceRowIndex": 0},
            {"text": "alpha", "label": "a", "sourceArtifactId": "source-a", "sourceRowIndex": 1},
            {"text": "charlie", "label": "c", "sourceArtifactId": "source-c", "sourceRowIndex": 0},
            {"text": "delta", "label": "d", "sourceArtifactId": "source-d", "sourceRowIndex": 0},
            {"text": "echo", "label": "e", "sourceArtifactId": "source-e", "sourceRowIndex": 0},
        ]

        first, group_count = _partition_rows(rows, 0.5, 0.25, 0.25, 17, True)
        second, _ = _partition_rows(rows, 0.5, 0.25, 0.25, 17, True)

        self.assertEqual(first, second)
        self.assertEqual(group_count, 4)
        self.assertEqual(sum(len(split) for split in first.values()), len(rows))
        self.assertTrue(all(first[role] for role in ["train", "validation", "test"]))

        role_by_source: dict[str, set[str]] = {}
        role_by_content: dict[tuple[str, str], set[str]] = {}
        for role, split_rows in first.items():
            for row in split_rows:
                role_by_source.setdefault(str(row["sourceArtifactId"]), set()).add(role)
                role_by_content.setdefault((str(row["text"]), str(row["label"])), set()).add(role)
        self.assertTrue(all(len(roles) == 1 for roles in role_by_source.values()))
        self.assertTrue(all(len(roles) == 1 for roles in role_by_content.values()))

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
        self.assertEqual(diagnostic["rawData"]["sourceInputCount"], 2)
        self.assertEqual(diagnostic["preparedData"]["chunkCount"], 3)
        self.assertTrue(diagnostic["errors"])
        self.assertNotIn("abcd", output.getvalue())
        self.assertNotIn(self.first_path, output.getvalue())

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

    def test_single_generated_row_writes_aggregate_and_train_outputs(self) -> None:
        payload = self._build_payload("jsonl")
        payload.recipe.generation.failurePolicy = "skip"

        def one_row_generator(chunks, _config):
            return [
                GeneratedQaExample(
                    artifact_id="doc-1",
                    chunk_index=0,
                    question="Q0",
                    answer="A0",
                )
                for chunk in chunks
                if chunk.chunk_index == 0
            ]

        result = prepare_training_dataset(payload, example_generator=one_row_generator)

        self.assertEqual(result.summary.datasetRowCount, 1)
        self.assertEqual(
            [output.role for output in result.outputs],
            ["dataset", "train"],
        )

    def test_records_dataset_preparation_task_metadata_on_outputs(self) -> None:
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

        dataset_output = next(output for output in result.outputs if output.role == "dataset")
        self.assertEqual(
            dataset_output.metadata["datasetPreparationTask"]["taskType"],
            "llm-instruction",
        )
        self.assertEqual(
            dataset_output.metadata["datasetPreparationTask"]["recipe"]["promptStyle"],
            "instruction-response",
        )

    def test_reads_parquet_as_a_structured_training_source(self) -> None:
        try:
            import pyarrow as pa
            import pyarrow.parquet as pq
        except ImportError:
            self.skipTest("pyarrow is not installed in this test environment")

        parquet_path = Path(self.temp_dir.name) / "classification.parquet"
        pq.write_table(
            pa.Table.from_pylist(
                [
                    {"text": "A billing question", "label": "billing"},
                    {"text": "A bug report", "label": "bug"},
                ]
            ),
            parquet_path,
        )
        payload_dict = self._build_payload("jsonl").model_dump(mode="json")
        payload_dict["sourceInputs"] = [
            {
                "artifactId": "classification-source",
                "localPath": str(parquet_path),
                "mediaType": "application/vnd.apache.parquet",
                "originalName": "classification.parquet",
            }
        ]
        payload_dict["recipe"]["task"] = {
            "taskType": "llm-classification",
            "textField": "text",
            "labelField": "label",
        }
        payload = PrepareTrainingDatasetRequest.model_validate(payload_dict)

        result = prepare_training_dataset(
            payload,
            example_generator=lambda _chunks, _config: (_ for _ in ()).throw(
                AssertionError("generation should not run")
            ),
        )

        output = next(item for item in result.outputs if item.role == "dataset")
        rows = [
            json.loads(line)
            for line in Path(output.tempPath).read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual([row["label"] for row in rows], ["billing", "bug"])

    def test_rejects_structured_sources_over_the_row_limit(self) -> None:
        csv_path = Path(self.temp_dir.name) / "bounded.csv"
        csv_path.write_text("text,label\none,a\ntwo,b\n", encoding="utf-8")
        source = SimpleNamespace(
            localPath=str(csv_path),
            originalName="bounded.csv",
            mediaType="text/csv",
        )

        with patch(
            "modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.MAX_STRUCTURED_SOURCE_ROWS",
            1,
        ):
            with self.assertRaisesRegex(ValueError, "row limit"):
                _read_structured_source_rows(source)

    def test_prepares_structured_classification_rows_without_generation(self) -> None:
        payload = self._build_payload("jsonl")
        csv_path = Path(self.temp_dir.name) / "classification.csv"
        csv_path.write_text("text,label\nA billing question,billing\nA bug report,bug\n", encoding="utf-8")
        payload_dict = payload.model_dump(mode="json")
        payload_dict["sourceInputs"] = [
            {
                "artifactId": "classification-source",
                "localPath": str(csv_path),
                "mediaType": "text/csv",
                "originalName": "classification.csv",
            }
        ]
        payload_dict["recipe"]["task"] = {
            "taskType": "llm-classification",
            "textField": "text",
            "labelField": "label",
        }
        payload = PrepareTrainingDatasetRequest.model_validate(payload_dict)

        result = prepare_training_dataset(
            payload,
            example_generator=lambda _chunks, _config: (_ for _ in ()).throw(AssertionError("generation should not run")),
        )

        output = next(output for output in result.outputs if output.role == "dataset")
        rows = [json.loads(line) for line in Path(output.tempPath).read_text(encoding="utf-8").splitlines()]
        self.assertEqual(rows[0]["text"], "A billing question")
        self.assertEqual(rows[0]["label"], "billing")
        self.assertEqual(output.metadata["datasetPreparationTask"]["taskType"], "llm-classification")

    def test_prepares_diffusion_lora_manifest_from_image_metadata(self) -> None:
        payload = self._build_payload("jsonl")
        image_path = Path(self.temp_dir.name) / "widget.png"
        image_path.write_bytes(b"fake-png")
        payload_dict = payload.model_dump(mode="json")
        payload_dict["sourceInputs"] = [
            {
                "artifactId": "image-1",
                "localPath": str(image_path),
                "mediaType": "image/png",
                "originalName": "widget.png",
                "metadata": {"caption": "a product photo of a blue widget"},
            }
        ]
        payload_dict["recipe"]["task"] = {
            "taskType": "diffusion-lora",
            "conceptKind": "subject",
            "imageField": "image",
            "captionField": "caption",
            "triggerToken": "asbwidget",
        }
        payload = PrepareTrainingDatasetRequest.model_validate(payload_dict)

        result = prepare_training_dataset(
            payload,
            example_generator=lambda _chunks, _config: (_ for _ in ()).throw(AssertionError("generation should not run")),
        )

        output = next(output for output in result.outputs if output.role == "dataset")
        row = json.loads(Path(output.tempPath).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(row["image"], "image-1")
        self.assertEqual(row["caption"], "a product photo of a blue widget")
        self.assertEqual(row["triggerToken"], "asbwidget")
        self.assertEqual(output.metadata["datasetPreparationTask"]["taskType"], "diffusion-lora")

    def test_prepares_diffusion_lora_manifest_with_generated_caption(self) -> None:
        payload = self._build_payload("jsonl")
        image_path = Path(self.temp_dir.name) / "widget.png"
        image_path.write_bytes(b"fake-png")
        payload_dict = payload.model_dump(mode="json")
        payload_dict["sourceInputs"] = [
            {
                "artifactId": "image-1",
                "localPath": str(image_path),
                "mediaType": "image/png",
                "originalName": "widget.png",
                "metadata": {"description": "blue product photo"},
            }
        ]
        payload_dict["recipe"]["generation"]["promptTemplate"] = "Write concise product training captions."
        payload_dict["recipe"]["task"] = {
            "taskType": "diffusion-lora",
            "textInputMode": "generate",
            "conceptKind": "subject",
            "imageField": "image",
            "captionField": "caption",
            "triggerToken": "asbwidget",
        }
        payload = PrepareTrainingDatasetRequest.model_validate(payload_dict)
        prompts: list[str] = []

        def text_generator(prompt, _config):
            prompts.append(prompt)
            return "a blue product widget on a clean background"

        result = prepare_training_dataset(
            payload,
            example_generator=lambda _chunks, _config: (_ for _ in ()).throw(AssertionError("chunk generation should not run")),
            text_value_generator=text_generator,
        )

        output = next(output for output in result.outputs if output.role == "dataset")
        row = json.loads(Path(output.tempPath).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(row["caption"], "a blue product widget on a clean background")
        self.assertIn("Write concise product training captions.", prompts[0])
        self.assertIn("widget.png", prompts[0])
        self.assertIn("asbwidget", prompts[0])

    def test_prepares_vision_classification_manifest_with_generated_allowed_label(self) -> None:
        payload = self._build_payload("jsonl")
        image_path = Path(self.temp_dir.name) / "billing.png"
        image_path.write_bytes(b"fake-png")
        payload_dict = payload.model_dump(mode="json")
        payload_dict["sourceInputs"] = [
            {
                "artifactId": "image-3",
                "localPath": str(image_path),
                "mediaType": "image/png",
                "originalName": "billing.png",
                "metadata": {"description": "screen capture of a billing workflow"},
            }
        ]
        payload_dict["recipe"]["generation"]["promptTemplate"] = "Choose the best image category."
        payload_dict["recipe"]["task"] = {
            "taskType": "vision-classification",
            "textInputMode": "generate",
            "imageField": "image",
            "labelField": "label",
            "labelSet": ["billing", "support"],
        }
        payload = PrepareTrainingDatasetRequest.model_validate(payload_dict)
        prompts: list[str] = []

        def text_generator(prompt, _config):
            prompts.append(prompt)
            return "billing workflow"

        result = prepare_training_dataset(
            payload,
            example_generator=lambda _chunks, _config: (_ for _ in ()).throw(AssertionError("chunk generation should not run")),
            text_value_generator=text_generator,
        )

        output = next(output for output in result.outputs if output.role == "dataset")
        row = json.loads(Path(output.tempPath).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(row["label"], "billing")
        self.assertEqual(row["labelSet"], ["billing", "support"])
        self.assertIn("Allowed labels: billing, support", prompts[0])

    def test_detection_manifest_requires_annotations(self) -> None:
        payload = self._build_payload("jsonl")
        image_path = Path(self.temp_dir.name) / "object.png"
        image_path.write_bytes(b"fake-png")
        payload_dict = payload.model_dump(mode="json")
        payload_dict["sourceInputs"] = [
            {
                "artifactId": "image-2",
                "localPath": str(image_path),
                "mediaType": "image/png",
                "originalName": "object.png",
            }
        ]
        payload_dict["recipe"]["task"] = {"taskType": "vision-detection", "boxFormat": "coco"}
        payload = PrepareTrainingDatasetRequest.model_validate(payload_dict)

        with self.assertRaises(ValueError) as context:
            prepare_training_dataset(payload, example_generator=lambda _chunks, _config: [])

        error = context.exception
        self.assertEqual(getattr(error, "stage", None), "generation")
        self.assertEqual(getattr(error, "error_code", None), "dataset_preparation_no_manifest_rows")
        self.assertEqual(getattr(error, "details", {}).get("taskType"), "vision-detection")


if __name__ == "__main__":
    unittest.main()
