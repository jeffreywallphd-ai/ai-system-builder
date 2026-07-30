from __future__ import annotations

import csv
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from types import ModuleType
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import PrepareTrainingDatasetRequest
from modules.adapters.runtime.python.worker.tasks.example_generation import GeneratedQaExample
from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import (
    _partition_rows,
    _read_structured_source_rows,
    prepare_training_dataset,
)
from modules.adapters.runtime.python.worker.tests.structured_output_test_fixtures import (
    runtime_structured_output_fixture,
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
                "runtime": runtime_structured_output_fixture(),
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

    def test_selected_source_attribution_is_added_from_trusted_metadata(self) -> None:
        payload = self._build_payload("jsonl")
        payload.sourceInputs = payload.sourceInputs[:1]
        payload.sourceInputs[0].metadata = {
            "sourceUrl": "https://Example.com/public/item?tracking=removed#part",
            "authors": [{"name": "Ada Example"}, "Ben Example"],
            "licenseName": "CC BY 4.0",
        }
        payload.recipe.chunking.chunkSize = 100
        payload.recipe.chunking.chunkOverlap = 0
        payload.quality = {
            "requestedPolicy": {
                "preset": "recommended",
                "includeSourceAttribution": True,
            },
            "effectivePolicy": {
                "policyId": "policy",
                "revision": "1",
                "scope": "workspace",
                "preset": "recommended",
                "allowedLanguages": ["en"],
                "requireLicenseMetadata": False,
                "requireConsentMetadata": False,
                "includeSourceAttribution": True,
                "excludedBenchmarkIds": [],
                "maxRowsPerSource": 100,
                "minimumTextCharacters": 1,
                "maximumTextCharacters": 10000,
                "fuzzyDuplicateSimilarity": 0.95,
                "maxFuzzyCandidatesPerRow": 16,
                "maxReportSamplesPerReason": 3,
                "mandatoryChecks": {
                    "sourceAssociation": True,
                    "schema": True,
                    "exactDuplicates": True,
                    "fuzzyDuplicates": True,
                    "sensitivePersonalData": True,
                    "secretLikeContent": True,
                    "splitLeakage": True,
                },
            },
            "reviewRequired": True,
        }
        payload = PrepareTrainingDatasetRequest.model_validate(
            payload.model_dump(mode="json")
        )

        result = prepare_training_dataset(
            payload,
            example_generator=lambda chunks, _config: [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="What sequence is present?",
                    answer=chunk.text,
                )
                for chunk in chunks
            ],
        )

        output = next(item for item in result.outputs if item.role == "dataset")
        row = json.loads(Path(output.tempPath).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(
            row["sourceAttribution"],
            {
                "sourceArtifactId": "doc-1",
                "sourceName": "original-doc-1.txt",
                "sourceUri": "https://example.com/public/item",
                "sourceAuthor": "Ada Example, Ben Example",
                "sourceLicense": "CC BY 4.0",
            },
        )
        self.assertNotIn("tracking", json.dumps(row["sourceAttribution"]))

        payload.quality.requestedPolicy.includeSourceAttribution = False
        payload.quality.effectivePolicy.includeSourceAttribution = False
        without_attribution = prepare_training_dataset(
            PrepareTrainingDatasetRequest.model_validate(
                payload.model_dump(mode="json")
            ),
            example_generator=lambda chunks, _config: [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="What sequence is present?",
                    answer=chunk.text,
                )
                for chunk in chunks
            ],
        )
        output = next(
            item for item in without_attribution.outputs if item.role == "dataset"
        )
        row = json.loads(
            Path(output.tempPath).read_text(encoding="utf-8").splitlines()[0]
        )
        self.assertNotIn("sourceAttribution", row)

    def test_task_structured_fields_materialize_to_parquet_row_contracts(self) -> None:
        cases = [
            (
                "llm-instruction",
                {"taskType": "llm-instruction"},
                {
                    "instruction": "Describe the sequence.",
                    "input": "abcdefghij",
                    "output": "The sequence runs from a through j.",
                },
                {"instruction", "input", "output"},
            ),
            (
                "llm-classification",
                {"taskType": "llm-classification", "textField": "text", "labelField": "label"},
                {"label": "sequence"},
                {"text", "label"},
            ),
            (
                "llm-extraction",
                {"taskType": "llm-extraction", "textField": "text", "outputField": "expectedOutput"},
                {"expectedOutput": '{"first": "a", "last": "j"}'},
                {"text", "expectedOutput"},
            ),
            (
                "llm-embedding",
                {"taskType": "llm-embedding"},
                {"anchorText": "alphabet sequence", "positiveText": "abcdefghij"},
                {"anchorText", "positiveText"},
            ),
            (
                "llm-reranker",
                {"taskType": "llm-reranker"},
                {"query": "Which sequence is shown?", "passage": "abcdefghij"},
                {"query", "passage", "relevance"},
            ),
        ]

        for task_type, task_recipe, structured_fields, required_columns in cases:
            with self.subTest(task_type=task_type):
                captured_rows: list[dict[str, object]] = []
                fake_pyarrow = ModuleType("pyarrow")
                fake_parquet = ModuleType("pyarrow.parquet")

                class _FakeTable:
                    @staticmethod
                    def from_pylist(rows):
                        return list(rows)

                def write_table(table, path):
                    captured_rows.extend(table)
                    Path(path).write_bytes(b"PAR1")

                fake_pyarrow.Table = _FakeTable
                fake_parquet.write_table = write_table
                fake_pyarrow.parquet = fake_parquet
                payload = self._build_payload("parquet")
                payload.sourceInputs = payload.sourceInputs[:1]
                payload.recipe.task = task_recipe
                payload.recipe.chunking.chunkSize = 100
                payload.recipe.chunking.chunkOverlap = 0

                def generator(chunks, _config):
                    return [
                        GeneratedQaExample(
                            artifact_id=chunk.artifact_id,
                            chunk_index=chunk.chunk_index,
                            question="Generated task input?",
                            answer="Generated task output.",
                            generation_mode="structured-json-v1",
                            structured_fields=structured_fields,
                        )
                        for chunk in chunks
                    ]

                with patch.dict(
                    "sys.modules",
                    {"pyarrow": fake_pyarrow, "pyarrow.parquet": fake_parquet},
                ):
                    prepare_training_dataset(payload, example_generator=generator)
                self.assertTrue(required_columns.issubset(set(captured_rows[0])))
                self.assertEqual(len(captured_rows), 2)

    def test_default_generation_path_passes_exact_task_context_to_structured_generator(self) -> None:
        payload = self._build_payload("jsonl")
        payload.sourceInputs = payload.sourceInputs[:1]
        payload.recipe.chunking.chunkSize = 100
        payload.recipe.chunking.chunkOverlap = 0

        def structured_generator(
            chunks,
            _config,
            task_type,
            task_recipe,
            structured_output,
        ):
            self.assertEqual(task_type, "llm-instruction")
            self.assertEqual(task_recipe["promptStyle"], "instruction-response")
            self.assertEqual(
                structured_output.purpose_paths["output"],
                ("output",),
            )
            return [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="Describe the sequence.",
                    answer="The sequence runs from a through j.",
                    generation_mode="structured-json-v1",
                    structured_fields={
                        "instruction": "Describe the sequence.",
                        "input": chunk.text,
                        "output": "The sequence runs from a through j.",
                    },
                )
                for chunk in chunks
            ]

        with patch(
            "modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.generate_task_examples_for_chunks",
            side_effect=structured_generator,
        ) as generator:
            result = prepare_training_dataset(payload)

        self.assertEqual(generator.call_count, 1)
        aggregate = next(output for output in result.outputs if output.role == "dataset")
        row = json.loads(Path(aggregate.tempPath).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(row["instruction"], "Describe the sequence.")
        self.assertEqual(row["input"], "abcdefghij")

    def test_explicit_topic_aware_plan_omits_fixed_size_and_overlap(self) -> None:
        payload = self._build_payload("jsonl")
        payload.sourceInputs = payload.sourceInputs[:1]
        payload.recipe.task["textInputMode"] = "generate"
        payload.recipe.chunking = None
        payload.preparation = {
            "schemaVersion": "1",
            "inputIntent": "create-from-source-material",
            "method": "topic-aware",
            "sourceKinds": ["document"],
            "generationMode": "task-examples",
        }
        payload.advanced = {
            "preset": "topic-aware",
            "content": {
                "strategy": "semantic",
                "maxTokensPerChunk": 32,
                "maxSourceSpans": 100,
                "semanticBoundaryThreshold": 0.22,
                "ocrEnabled": False,
            },
            "semantic": {
                "enabled": True,
                "embeddingAlgorithm": "hashed-token-v1",
            },
            "synthetic": {
                "enabled": True,
                "candidatesPerChunk": 1,
                "requireReview": True,
            },
        }
        payload.quality = {
            "requestedPolicy": {"preset": "recommended"},
            "effectivePolicy": {
                "policyId": "policy",
                "revision": "1",
                "scope": "workspace",
                "preset": "recommended",
                "allowedLanguages": ["en"],
                "requireLicenseMetadata": False,
                "requireConsentMetadata": False,
                "excludedBenchmarkIds": [],
                "maxRowsPerSource": 100,
                "minimumTextCharacters": 1,
                "maximumTextCharacters": 10000,
                "fuzzyDuplicateSimilarity": 0.95,
                "maxFuzzyCandidatesPerRow": 16,
                "maxReportSamplesPerReason": 3,
                "mandatoryChecks": {
                    "sourceAssociation": True,
                    "schema": True,
                    "exactDuplicates": True,
                    "fuzzyDuplicates": True,
                    "sensitivePersonalData": True,
                    "secretLikeContent": True,
                    "splitLeakage": True,
                },
            },
            "reviewRequired": True,
        }
        payload = PrepareTrainingDatasetRequest.model_validate(
            payload.model_dump(mode="json")
        )

        result = prepare_training_dataset(
            payload,
            example_generator=lambda chunks, _config: [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="What is included?",
                    answer=chunk.text,
                )
                for chunk in chunks
            ],
        )

        self.assertGreater(result.summary.chunkCount, 0)
        self.assertEqual(result.advancedReport["content"]["strategy"], "semantic")

    def test_explicit_topic_aware_plan_rejects_stale_overlap_settings(self) -> None:
        payload = self._build_payload("jsonl")
        payload.sourceInputs = payload.sourceInputs[:1]
        payload.recipe.task["textInputMode"] = "generate"
        payload.preparation = {
            "schemaVersion": "1",
            "inputIntent": "create-from-source-material",
            "method": "topic-aware",
            "sourceKinds": ["document"],
            "generationMode": "task-examples",
        }
        payload.advanced = {
            "preset": "topic-aware",
            "content": {"strategy": "semantic", "ocrEnabled": False},
            "semantic": {"enabled": True},
            "synthetic": {"enabled": True, "requireReview": True},
        }
        payload = PrepareTrainingDatasetRequest.model_validate(
            payload.model_dump(mode="json")
        )

        with self.assertRaisesRegex(ValueError, "Section size and overlap"):
            prepare_training_dataset(payload)

    def test_explicit_existing_dataset_plan_uses_no_document_or_model_settings(self) -> None:
        source_path = Path(self.temp_dir.name) / "ready.jsonl"
        source_path.write_text(
            json.dumps({"text": "A useful example", "label": "help"}) + "\n",
            encoding="utf-8",
        )
        payload = PrepareTrainingDatasetRequest.model_validate(
            {
                "sourceInputs": [
                    {
                        "artifactId": "ready-1",
                        "localPath": str(source_path),
                        "mediaType": "application/x-ndjson",
                        "originalName": "ready.jsonl",
                    }
                ],
                "preparation": {
                    "schemaVersion": "1",
                    "inputIntent": "use-existing-dataset",
                    "method": "validate-and-split",
                    "sourceKinds": ["structured"],
                    "generationMode": "none",
                },
                "recipe": {
                    "task": {
                        "taskType": "llm-classification",
                        "textInputMode": "provided",
                        "textField": "text",
                        "labelField": "label",
                    }
                },
                "split": {"trainRatio": 0.8, "validationRatio": 0.1, "testRatio": 0.1},
                "output": {"format": "jsonl"},
            }
        )

        result = prepare_training_dataset(payload)

        self.assertEqual(result.summary.datasetRowCount, 1)
        metadata = next(output for output in result.outputs if output.role == "dataset").metadata
        self.assertEqual(metadata["preparation"]["method"], "validate-and-split")
        self.assertNotIn("generationModel", metadata)

    def test_explicit_plan_rejects_mixed_existing_and_source_material(self) -> None:
        source_path = Path(self.temp_dir.name) / "ready.jsonl"
        source_path.write_text(
            json.dumps({"instruction": "Ask", "output": "Answer"}) + "\n",
            encoding="utf-8",
        )
        payload = self._build_payload("jsonl")
        payload.sourceInputs = [
            payload.sourceInputs[0],
            {
                "artifactId": "ready-1",
                "localPath": str(source_path),
                "mediaType": "application/x-ndjson",
                "originalName": "ready.jsonl",
            },
        ]
        payload.preparation = {
            "schemaVersion": "1",
            "inputIntent": "create-from-source-material",
            "method": "fixed-length",
            "sourceKinds": ["document"],
            "generationMode": "task-examples",
        }
        payload = PrepareTrainingDatasetRequest.model_validate(
            payload.model_dump(mode="json")
        )

        with self.assertRaisesRegex(ValueError, "cannot be mixed"):
            prepare_training_dataset(payload)

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
                        "sourceArtifactId",
                        "sourceLineage",
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
                        "sourceArtifactId",
                        "sourceLineage",
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
                        "sourceArtifactId",
                        "sourceLineage",
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
        payload_dict["runtime"] = runtime_structured_output_fixture(
            "diffusion-lora",
            payload_dict["recipe"]["task"],
        )
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
        payload_dict["runtime"] = runtime_structured_output_fixture(
            "diffusion-lora",
            payload_dict["recipe"]["task"],
        )
        payload = PrepareTrainingDatasetRequest.model_validate(payload_dict)
        prompts: list[str] = []

        def text_generator(prompt, _config):
            prompts.append(prompt)
            return json.dumps(
                {
                    "schemaVersion": "1",
                    "taskType": "diffusion-lora",
                    "fieldKind": "caption",
                    "status": "ok",
                    "value": {
                        "caption": "a blue product widget on a clean background"
                    },
                }
            )

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
        payload_dict["runtime"] = runtime_structured_output_fixture(
            "vision-classification",
            payload_dict["recipe"]["task"],
        )
        payload = PrepareTrainingDatasetRequest.model_validate(payload_dict)
        prompts: list[str] = []

        def text_generator(prompt, _config):
            prompts.append(prompt)
            return json.dumps(
                {
                    "schemaVersion": "1",
                    "taskType": "vision-classification",
                    "fieldKind": "label",
                    "status": "ok",
                    "value": {"label": "billing"},
                }
            )

        result = prepare_training_dataset(
            payload,
            example_generator=lambda _chunks, _config: (_ for _ in ()).throw(AssertionError("chunk generation should not run")),
            text_value_generator=text_generator,
        )

        output = next(output for output in result.outputs if output.role == "dataset")
        row = json.loads(Path(output.tempPath).read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(row["label"], "billing")
        self.assertEqual(row["labelSet"], ["billing", "support"])
        self.assertIn('"allowedLabels": ["billing", "support"]', prompts[0])

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
