from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pyarrow.parquet as pq

from modules.adapters.runtime.python.worker.models import PrepareTrainingDatasetRequest
from modules.adapters.runtime.python.worker.tasks.example_generation import GeneratedQaExample
from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import (
    prepare_training_dataset,
)
from modules.adapters.runtime.python.worker.tests.structured_output_test_fixtures import (
    runtime_structured_output_fixture,
)


TASKS = (
    "llm-instruction",
    "llm-classification",
    "llm-extraction",
    "llm-embedding",
    "llm-reranker",
    "diffusion-lora",
    "vision-classification",
    "vision-detection",
    "vision-segmentation",
)
TEXT_TASKS = TASKS[:5]
EXPECTED_COLUMNS = {
    "llm-instruction": {"instruction", "input", "output"},
    "llm-classification": {"text", "label"},
    "llm-extraction": {"text", "expectedOutput"},
    "llm-embedding": {"anchorText", "positiveText"},
    "llm-reranker": {"query", "passage", "relevance"},
    "diffusion-lora": {"image", "caption"},
    "vision-classification": {"image", "label"},
    "vision-detection": {"image", "boundingBoxes", "labels"},
    "vision-segmentation": {"image", "mask"},
}


def _task(task_type: str, generated: bool = False) -> dict[str, object]:
    value: dict[str, object] = {"taskType": task_type}
    if task_type == "llm-classification":
        value.update({"textField": "text", "labelField": "label"})
    elif task_type == "llm-extraction":
        value.update({"textField": "text", "outputField": "expectedOutput"})
    elif task_type == "vision-detection":
        value["boxFormat"] = "coco"
    elif task_type == "vision-segmentation":
        value["maskFormat"] = "png"
    value["textInputMode"] = "generate" if generated else "provided"
    return value


def _row(task_type: str, suffix: str) -> dict[str, object]:
    return {
        "llm-instruction": {
            "instruction": f"Answer request {suffix}.",
            "input": f"Request {suffix}",
            "context": f"Trusted context {suffix}",
            "output": f"Supported answer {suffix}",
        },
        "llm-classification": {"text": f"Classify {suffix}", "label": "reference"},
        "llm-extraction": {
            "text": f"Invoice {suffix} totals 20 dollars.",
            "expectedOutput": {"total": 20, "record": suffix},
        },
        "llm-embedding": {
            "anchorText": f"search {suffix}",
            "positiveText": f"matching passage {suffix}",
        },
        "llm-reranker": {
            "query": f"query {suffix}",
            "passage": f"relevant passage {suffix}",
            "relevance": 1,
        },
        "diffusion-lora": {"image": f"image-{suffix}", "caption": f"caption {suffix}"},
        "vision-classification": {"image": f"image-{suffix}", "label": "reference"},
        "vision-detection": {
            "image": f"image-{suffix}",
            "boundingBoxes": [[1, 2, 10, 12]],
            "labels": ["object"],
        },
        "vision-segmentation": {
            "image": f"image-{suffix}",
            "mask": f"mask-{suffix}.png",
            "label": "object",
        },
    }[task_type]


def _quality() -> dict[str, object]:
    return {
        "requestedPolicy": {"preset": "recommended"},
        "effectivePolicy": {
            "policyId": "dataset-preparation-e2e",
            "revision": "1",
            "scope": "workspace",
            "preset": "recommended",
            "allowedLanguages": ["en"],
            "requireLicenseMetadata": False,
            "requireConsentMetadata": False,
            "includeSourceAttribution": False,
            "excludedBenchmarkIds": [],
            "maxRowsPerSource": 100,
            "minimumTextCharacters": 1,
            "maximumTextCharacters": 100_000,
            "fuzzyDuplicateSimilarity": 0.99,
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


def _advanced(method: str) -> dict[str, object] | None:
    if method not in {"topic-aware", "structure-aware"}:
        return None
    content = (
        {
            "strategy": "semantic",
            "maxTokensPerChunk": 512,
            "maxSourceSpans": 8,
            "semanticBoundaryThreshold": 0.55,
        }
        if method == "topic-aware"
        else {
            "strategy": "layout",
            "maxTokensPerChunk": 512,
            "maxSourceSpans": 8,
            "layoutEnabled": True,
            "ocrEnabled": False,
        }
    )
    return {
        "preset": method,
        "content": content,
        "semantic": {"enabled": True, "similarityThreshold": 0.99},
        "synthetic": {
            "enabled": True,
            "candidatesPerChunk": 1,
            "minimumGroundingScore": 0.45,
            "minimumCriticScore": 0.6,
            "minimumDiversityScore": 0.2,
            "requireReview": True,
        },
    }


def _generated_fields(task_type: str, source_text: str) -> dict[str, object]:
    return {
        "llm-instruction": {
            "instruction": "Answer the input using only the provided context.",
            "input": "What fact does the source state?",
            "context": source_text,
            "output": source_text,
        },
        "llm-classification": {"label": "reference"},
        "llm-extraction": {"expectedOutput": {"sourceText": source_text}},
        "llm-embedding": {"anchorText": "source fact", "positiveText": source_text},
        "llm-reranker": {
            "query": "What fact does the source state?",
            "passage": source_text,
        },
    }[task_type]


class DatasetPreparationCreationMatrixE2ETest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.model_patcher = patch(
            "modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.ensure_generation_model_is_available"
        )
        self.model_patcher.start()

    def tearDown(self) -> None:
        self.model_patcher.stop()
        self.temp_dir.cleanup()

    def _assert_parquet(
        self,
        task_type: str,
        payload: PrepareTrainingDatasetRequest,
        **overrides: object,
    ) -> None:
        output_dir = self.root / "outputs" / f"{task_type}-{payload.preparation.method}"
        output_dir.mkdir(parents=True, exist_ok=True)
        result = prepare_training_dataset(
            payload,
            output_directory=output_dir,
            **overrides,
        )
        output = next(item for item in result.outputs if item.role == "dataset")
        table = pq.read_table(Path(output.tempPath))
        self.assertGreater(table.num_rows, 0)
        self.assertEqual(result.summary.datasetRowCount, table.num_rows)
        self.assertTrue(EXPECTED_COLUMNS[task_type].issubset(table.column_names))
        self.assertIn("sourceArtifactId", table.column_names)
        self.assertTrue(all(table.column("sourceArtifactId").to_pylist()))

    def test_every_task_and_material_division_creates_valid_parquet(self) -> None:
        executed: list[tuple[str, str]] = []
        for task_type in TASKS:
            for count, method in ((1, "validate-and-split"), (2, "combine-and-split")):
                with self.subTest(task=task_type, method=method):
                    sources = []
                    for index in range(count):
                        path = self.root / f"{task_type}-{index}.jsonl"
                        path.write_text(
                            json.dumps(_row(task_type, str(index))) + "\n",
                            encoding="utf-8",
                        )
                        sources.append(
                            {
                                "artifactId": f"structured-{task_type}-{index}",
                                "localPath": str(path),
                                "mediaType": "application/x-ndjson",
                                "originalName": path.name,
                            }
                        )
                    payload = PrepareTrainingDatasetRequest.model_validate(
                        {
                            "sourceInputs": sources,
                            "preparation": {
                                "schemaVersion": "1",
                                "inputIntent": (
                                    "use-existing-dataset"
                                    if count == 1
                                    else "combine-existing-datasets"
                                ),
                                "method": method,
                                "sourceKinds": ["structured"],
                                "generationMode": "none",
                            },
                            "recipe": {"task": _task(task_type)},
                            "split": {
                                "trainRatio": 0.8,
                                "testRatio": 0.2,
                                "shuffle": False,
                            },
                            "output": {"format": "parquet"},
                        }
                    )
                    self._assert_parquet(task_type, payload)
                    executed.append((task_type, method))

        for task_type in TEXT_TASKS:
            for method in ("fixed-length", "topic-aware", "structure-aware"):
                with self.subTest(task=task_type, method=method):
                    suffix = ".md" if method == "structure-aware" else ".txt"
                    path = self.root / f"source-{task_type}-{method}{suffix}"
                    path.write_text(
                        "# Reference policy\n\nThe city library closes at 6:00 PM on weekdays.",
                        encoding="utf-8",
                    )
                    advanced = _advanced(method)
                    data: dict[str, object] = {
                        "sourceInputs": [
                            {
                                "artifactId": f"document-{task_type}-{method}",
                                "localPath": str(path),
                                "mediaType": (
                                    "text/markdown"
                                    if suffix == ".md"
                                    else "text/plain"
                                ),
                                "originalName": path.name,
                            }
                        ],
                        "preparation": {
                            "schemaVersion": "1",
                            "inputIntent": "create-from-source-material",
                            "method": method,
                            "sourceKinds": ["document"],
                            "generationMode": "task-examples",
                        },
                        "recipe": {
                            "task": _task(task_type, True),
                            "normalization": {
                                "targetFormat": "markdown",
                                "unsupportedDocumentPolicy": "fail",
                                "normalizationMode": "strict",
                            },
                            **(
                                {
                                    "chunking": {
                                        "strategy": "character",
                                        "chunkSize": 2_000,
                                        "chunkOverlap": 0,
                                        "preserveDocumentBoundaries": True,
                                    }
                                }
                                if method == "fixed-length"
                                else {}
                            ),
                            "generation": {
                                "mode": "qa",
                                "model": {
                                    "provider": "transformers",
                                    "modelId": "e2e-fixture-model",
                                },
                                "batchSize": 1,
                                "failurePolicy": "skip",
                            },
                        },
                        "split": {
                            "trainRatio": 0.8,
                            "testRatio": 0.2,
                            "shuffle": False,
                        },
                        "output": {"format": "parquet"},
                        "runtime": runtime_structured_output_fixture(task_type),
                    }
                    if advanced is not None:
                        data.update({"advanced": advanced, "quality": _quality()})
                    payload = PrepareTrainingDatasetRequest.model_validate(data)

                    def generator(chunks, _config, current=task_type):
                        return [
                            GeneratedQaExample(
                                artifact_id=chunk.artifact_id,
                                chunk_index=chunk.chunk_index,
                                question="What fact does the source state?",
                                answer=chunk.text,
                                structured_fields=_generated_fields(current, chunk.text),
                            )
                            for chunk in chunks
                        ]

                    self._assert_parquet(
                        task_type,
                        payload,
                        example_generator=generator,
                    )
                    executed.append((task_type, method))

        for task_type in ("diffusion-lora", "vision-classification"):
            for method in ("use-source-metadata", "model-assisted-metadata"):
                with self.subTest(task=task_type, method=method):
                    path = self.root / f"{task_type}.png"
                    path.write_bytes(
                        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
                        b"\x00\x00\x00\x01\x00\x00\x00\x01"
                    )
                    generated = method == "model-assisted-metadata"
                    metadata = (
                        {"caption": "reference image"}
                        if task_type == "diffusion-lora"
                        else {"label": "reference"}
                    )
                    data = {
                        "sourceInputs": [
                            {
                                "artifactId": f"image-{task_type}-{method}",
                                "localPath": str(path),
                                "mediaType": "image/png",
                                "originalName": path.name,
                                "metadata": metadata,
                            }
                        ],
                        "preparation": {
                            "schemaVersion": "1",
                            "inputIntent": "create-from-source-material",
                            "method": method,
                            "sourceKinds": ["image"],
                            "generationMode": "metadata-text" if generated else "none",
                        },
                        "recipe": {
                            "task": _task(task_type, generated),
                            **(
                                {
                                    "generation": {
                                        "mode": "qa",
                                        "model": {
                                            "provider": "transformers",
                                            "modelId": "e2e-fixture-model",
                                        },
                                        "failurePolicy": "skip",
                                    }
                                }
                                if generated
                                else {}
                            ),
                        },
                        "split": {
                            "trainRatio": 0.8,
                            "testRatio": 0.2,
                            "shuffle": False,
                        },
                        "output": {"format": "parquet"},
                        **(
                            {"runtime": runtime_structured_output_fixture(task_type)}
                            if generated
                            else {}
                        ),
                    }
                    payload = PrepareTrainingDatasetRequest.model_validate(data)
                    overrides = {}
                    if generated:
                        example = payload.runtime["structuredOutput"]["example"]
                        overrides["text_value_generator"] = (
                            lambda _prompt, _config, value=example: json.dumps(value)
                        )
                    self._assert_parquet(task_type, payload, **overrides)
                    executed.append((task_type, method))

        for task_type in ("vision-detection", "vision-segmentation"):
            with self.subTest(task=task_type, method="use-existing-annotations"):
                path = self.root / f"{task_type}.png"
                path.write_bytes(
                    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
                    b"\x00\x00\x00\x01\x00\x00\x00\x01"
                )
                metadata = (
                    {"boundingBoxes": [[1, 2, 10, 12]], "labels": ["object"]}
                    if task_type == "vision-detection"
                    else {"mask": "reviewed-mask.png", "label": "object"}
                )
                payload = PrepareTrainingDatasetRequest.model_validate(
                    {
                        "sourceInputs": [
                            {
                                "artifactId": f"image-{task_type}",
                                "localPath": str(path),
                                "mediaType": "image/png",
                                "originalName": path.name,
                                "metadata": metadata,
                            }
                        ],
                        "preparation": {
                            "schemaVersion": "1",
                            "inputIntent": "create-from-source-material",
                            "method": "use-existing-annotations",
                            "sourceKinds": ["image"],
                            "generationMode": "none",
                        },
                        "recipe": {"task": _task(task_type)},
                        "split": {
                            "trainRatio": 0.8,
                            "testRatio": 0.2,
                            "shuffle": False,
                        },
                        "output": {"format": "parquet"},
                    }
                )
                self._assert_parquet(task_type, payload)
                executed.append((task_type, "use-existing-annotations"))

        self.assertEqual(len(executed), 39)


if __name__ == "__main__":
    unittest.main()
