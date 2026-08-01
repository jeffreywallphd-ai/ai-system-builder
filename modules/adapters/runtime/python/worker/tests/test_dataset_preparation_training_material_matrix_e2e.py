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
from modules.adapters.runtime.python.worker.tests.test_dataset_preparation_creation_matrix_e2e import (
    EXPECTED_COLUMNS,
    _advanced,
    _generated_fields,
    _quality,
    _row,
    _task,
)


class DatasetPreparationTrainingMaterialMatrixE2ETest(unittest.TestCase):
    """Nine training goals by three user-facing material divisions."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.model_patcher = patch(
            "modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.ensure_generation_model_is_available"
        )
        self.model_patcher.start()

    def tearDown(self) -> None:
        self.model_patcher.stop()
        self.temporary.cleanup()

    def _run(self, task_type: str, material_division: str) -> None:
        if material_division == "existing-dataset":
            payload, overrides = self._structured_payload(task_type, 1)
        elif material_division == "combined-datasets":
            payload, overrides = self._structured_payload(task_type, 2)
        elif material_division == "source-material":
            payload, overrides = self._source_payload(task_type)
        else:
            raise AssertionError(f"Unknown material division: {material_division}")

        output_directory = self.root / "outputs" / task_type / material_division
        output_directory.mkdir(parents=True, exist_ok=True)
        result = prepare_training_dataset(
            payload,
            output_directory=output_directory,
            **overrides,
        )
        output = next(item for item in result.outputs if item.role == "dataset")
        output_path = Path(output.tempPath)
        content = output_path.read_bytes()
        self.assertEqual(content[:4], b"PAR1")
        self.assertEqual(content[-4:], b"PAR1")
        table = pq.read_table(output_path)
        self.assertGreater(table.num_rows, 0)
        self.assertEqual(result.summary.datasetRowCount, table.num_rows)
        self.assertTrue(EXPECTED_COLUMNS[task_type].issubset(table.column_names))
        self.assertIn("sourceArtifactId", table.column_names)
        self.assertTrue(all(table.column("sourceArtifactId").to_pylist()))

    def _structured_payload(
        self,
        task_type: str,
        source_count: int,
    ) -> tuple[PrepareTrainingDatasetRequest, dict[str, object]]:
        sources: list[dict[str, object]] = []
        for index in range(source_count):
            path = self.root / f"{task_type}-dataset-{index}.jsonl"
            path.write_text(json.dumps(_row(task_type, str(index))) + "\n", encoding="utf-8")
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
                        if source_count == 1
                        else "combine-existing-datasets"
                    ),
                    "method": (
                        "validate-and-split"
                        if source_count == 1
                        else "combine-and-split"
                    ),
                    "sourceKinds": ["structured"],
                    "generationMode": "none",
                },
                "recipe": {"task": _task(task_type)},
                "split": {"trainRatio": 0.8, "testRatio": 0.2, "shuffle": False},
                "output": {"format": "parquet"},
            }
        )
        return payload, {}

    def _source_payload(
        self,
        task_type: str,
    ) -> tuple[PrepareTrainingDatasetRequest, dict[str, object]]:
        if task_type.startswith("llm-"):
            return self._text_source_payload(task_type)
        return self._image_source_payload(task_type)

    def _text_source_payload(
        self,
        task_type: str,
    ) -> tuple[PrepareTrainingDatasetRequest, dict[str, object]]:
        path = self.root / f"{task_type}-source.md"
        path.write_text(
            "# Library hours\n\nThe city library closes at 6:00 PM on weekdays.",
            encoding="utf-8",
        )
        payload = PrepareTrainingDatasetRequest.model_validate(
            {
                "sourceInputs": [
                    {
                        "artifactId": f"document-{task_type}",
                        "localPath": str(path),
                        "mediaType": "text/markdown",
                        "originalName": path.name,
                    }
                ],
                "preparation": {
                    "schemaVersion": "1",
                    "inputIntent": "create-from-source-material",
                    "method": "topic-aware",
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
                "advanced": _advanced("topic-aware"),
                "quality": _quality(),
                "split": {"trainRatio": 0.8, "testRatio": 0.2, "shuffle": False},
                "output": {"format": "parquet"},
                "runtime": runtime_structured_output_fixture(task_type),
            }
        )

        def generator(chunks, _config):
            return [
                GeneratedQaExample(
                    artifact_id=chunk.artifact_id,
                    chunk_index=chunk.chunk_index,
                    question="What fact does the source state?",
                    answer=chunk.text,
                    structured_fields=_generated_fields(task_type, chunk.text),
                )
                for chunk in chunks
            ]

        return payload, {"example_generator": generator}

    def _image_source_payload(
        self,
        task_type: str,
    ) -> tuple[PrepareTrainingDatasetRequest, dict[str, object]]:
        path = self.root / f"{task_type}-source.png"
        path.write_bytes(
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
            b"\x00\x00\x00\x01\x00\x00\x00\x01"
        )
        if task_type == "diffusion-lora":
            method = "use-source-metadata"
            metadata = {"caption": "A small reference image"}
        elif task_type == "vision-classification":
            method = "use-source-metadata"
            metadata = {"label": "reference"}
        elif task_type == "vision-detection":
            method = "use-existing-annotations"
            metadata = {"boundingBoxes": [[1, 2, 10, 12]], "labels": ["object"]}
        else:
            method = "use-existing-annotations"
            metadata = {"mask": "reviewed-mask.png", "label": "object"}
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
                    "method": method,
                    "sourceKinds": ["image"],
                    "generationMode": "none",
                },
                "recipe": {"task": _task(task_type)},
                "split": {"trainRatio": 0.8, "testRatio": 0.2, "shuffle": False},
                "output": {"format": "parquet"},
            }
        )
        return payload, {}

    def test_llm_instruction_existing_dataset_creates_parquet(self):
        self._run("llm-instruction", "existing-dataset")

    def test_llm_instruction_combined_datasets_creates_parquet(self):
        self._run("llm-instruction", "combined-datasets")

    def test_llm_instruction_source_material_creates_parquet(self):
        self._run("llm-instruction", "source-material")

    def test_llm_classification_existing_dataset_creates_parquet(self):
        self._run("llm-classification", "existing-dataset")

    def test_llm_classification_combined_datasets_creates_parquet(self):
        self._run("llm-classification", "combined-datasets")

    def test_llm_classification_source_material_creates_parquet(self):
        self._run("llm-classification", "source-material")

    def test_llm_extraction_existing_dataset_creates_parquet(self):
        self._run("llm-extraction", "existing-dataset")

    def test_llm_extraction_combined_datasets_creates_parquet(self):
        self._run("llm-extraction", "combined-datasets")

    def test_llm_extraction_source_material_creates_parquet(self):
        self._run("llm-extraction", "source-material")

    def test_llm_embedding_existing_dataset_creates_parquet(self):
        self._run("llm-embedding", "existing-dataset")

    def test_llm_embedding_combined_datasets_creates_parquet(self):
        self._run("llm-embedding", "combined-datasets")

    def test_llm_embedding_source_material_creates_parquet(self):
        self._run("llm-embedding", "source-material")

    def test_llm_reranker_existing_dataset_creates_parquet(self):
        self._run("llm-reranker", "existing-dataset")

    def test_llm_reranker_combined_datasets_creates_parquet(self):
        self._run("llm-reranker", "combined-datasets")

    def test_llm_reranker_source_material_creates_parquet(self):
        self._run("llm-reranker", "source-material")

    def test_diffusion_lora_existing_dataset_creates_parquet(self):
        self._run("diffusion-lora", "existing-dataset")

    def test_diffusion_lora_combined_datasets_creates_parquet(self):
        self._run("diffusion-lora", "combined-datasets")

    def test_diffusion_lora_source_material_creates_parquet(self):
        self._run("diffusion-lora", "source-material")

    def test_vision_classification_existing_dataset_creates_parquet(self):
        self._run("vision-classification", "existing-dataset")

    def test_vision_classification_combined_datasets_creates_parquet(self):
        self._run("vision-classification", "combined-datasets")

    def test_vision_classification_source_material_creates_parquet(self):
        self._run("vision-classification", "source-material")

    def test_vision_detection_existing_dataset_creates_parquet(self):
        self._run("vision-detection", "existing-dataset")

    def test_vision_detection_combined_datasets_creates_parquet(self):
        self._run("vision-detection", "combined-datasets")

    def test_vision_detection_source_material_creates_parquet(self):
        self._run("vision-detection", "source-material")

    def test_vision_segmentation_existing_dataset_creates_parquet(self):
        self._run("vision-segmentation", "existing-dataset")

    def test_vision_segmentation_combined_datasets_creates_parquet(self):
        self._run("vision-segmentation", "combined-datasets")

    def test_vision_segmentation_source_material_creates_parquet(self):
        self._run("vision-segmentation", "source-material")


if __name__ == "__main__":
    unittest.main()
