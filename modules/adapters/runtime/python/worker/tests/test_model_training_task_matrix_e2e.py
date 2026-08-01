from __future__ import annotations

import gc
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest
from modules.adapters.runtime.python.worker.tasks.train_model import train_model


@dataclass(frozen=True)
class FixedModelAsset:
    repository: str
    revision: str
    maximum_snapshot_bytes: int
    weight_sha256: tuple[tuple[str, str], ...]


FIXED_MODEL_ASSETS = {
    "text": FixedModelAsset(
        repository="trl-internal-testing/tiny-GPT2LMHeadModel",
        revision="22752b95d991f2ddbbdc85a1adf305a6eb277df8",
        maximum_snapshot_bytes=16 * 1024 * 1024,
        weight_sha256=(
            (
                "model.safetensors",
                "c65159ad5e5a947ef09590d32dcb986caf9abf3cbf3081fedb6e3b7f4edc84f3",
            ),
        ),
    ),
    "diffusion": FixedModelAsset(
        repository="hf-internal-testing/tiny-stable-diffusion-torch",
        revision="a88cdfbd91f96ec7f61eb7484b652ff0f4ee701d",
        maximum_snapshot_bytes=40 * 1024 * 1024,
        weight_sha256=(
            (
                "text_encoder/pytorch_model.bin",
                "9d56720d7eb5270ea803289848671ddcc3de5c80a56641e88148136d2de28ed8",
            ),
            (
                "unet/diffusion_pytorch_model.bin",
                "228772f10e985dbe23aa818dc665754ad635d043e2d18c1a5cf1b1b8d34961a4",
            ),
            (
                "vae/diffusion_pytorch_model.bin",
                "56861600bf1a29357ccb828f66ed2a1747b9026c894ab47aaacb082b20673f41",
            ),
        ),
    ),
    "vision-classification": FixedModelAsset(
        repository="hf-internal-testing/tiny-random-vit",
        revision="96e253fe90cfcededfa8edf8b7e6f230f87a63a1",
        maximum_snapshot_bytes=5 * 1024 * 1024,
        weight_sha256=(
            (
                "model.safetensors",
                "b38d069d27638fcf45c8f98d40b83e49b0987b7bb4743f140c5bde91c78f10a3",
            ),
            (
                "pytorch_model.bin",
                "c24aefb91f22827cd1192ee92438e6ddcd2f32284b71d370834fa3119551f739",
            ),
        ),
    ),
    "vision-detection": FixedModelAsset(
        repository="hf-internal-testing/tiny-random-YolosForObjectDetection",
        revision="0a4aae25bfbe8b5edd4815cb00d697a6ba7d2126",
        maximum_snapshot_bytes=5 * 1024 * 1024,
        weight_sha256=(
            (
                "pytorch_model.bin",
                "6de41646963d5f89526b7a34ad648c7a2e1a07adcca72592c2230d294dcdaf75",
            ),
        ),
    ),
    "vision-segmentation": FixedModelAsset(
        repository="hf-internal-testing/tiny-random-SegformerForSemanticSegmentation",
        revision="b73798972cdf24daafa858994713aca60e2bf90d",
        maximum_snapshot_bytes=20 * 1024 * 1024,
        weight_sha256=(
            (
                "pytorch_model.bin",
                "90ecfb3c0f0249f27b1b930bc0da73ebe0ee57d7266dd6cd332f1234c48dc50f",
            ),
        ),
    ),
}

TEXT_TASK_ROWS: dict[str, list[dict[str, Any]]] = {
    "llm-instruction": [
        {
            "instruction": "Answer using the context.",
            "input": "When does the library close?",
            "context": "The library closes at six.",
            "output": "It closes at six.",
        },
        {
            "instruction": "Answer using the context.",
            "input": "What color is the badge?",
            "context": "The badge is blue.",
            "output": "The badge is blue.",
        },
    ],
    "llm-classification": [
        {"text": "The invoice is overdue.", "label": "billing"},
        {"text": "The password reset failed.", "label": "support"},
    ],
    "llm-extraction": [
        {"text": "Invoice A totals 20 dollars.", "expectedOutput": "{\"total\":20}"},
        {"text": "Invoice B totals 30 dollars.", "expectedOutput": "{\"total\":30}"},
    ],
    "llm-embedding": [
        {
            "anchorText": "library hours",
            "positiveText": "the library closes at six",
            "negativeText": "blue badge",
        },
        {
            "anchorText": "badge color",
            "positiveText": "the badge is blue",
            "negativeText": "invoice total",
        },
    ],
    "llm-reranker": [
        {
            "query": "When does the library close?",
            "passage": "The library closes at six.",
            "relevance": 1,
            "negativePassage": "The badge is blue.",
        },
        {
            "query": "What color is the badge?",
            "passage": "The badge is blue.",
            "relevance": 1,
            "negativePassage": "The invoice totals twenty dollars.",
        },
    ],
}

TASK_MODEL_KEYS = {
    "llm-instruction": "text",
    "llm-classification": "text",
    "llm-extraction": "text",
    "llm-embedding": "text",
    "llm-reranker": "text",
    "diffusion-lora": "diffusion",
    "vision-classification": "vision-classification",
    "vision-detection": "vision-detection",
    "vision-segmentation": "vision-segmentation",
}

IGNORED_SNAPSHOT_PATTERNS = (
    "*.h5",
    "*.msgpack",
    "*.onnx",
    "*.tflite",
    "*.xml",
    "openvino*",
)


def _snapshot_size(root: Path) -> int:
    return sum(path.stat().st_size for path in root.rglob("*") if path.is_file())


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ModelTrainingTaskMatrixE2ETest(unittest.TestCase):
    """Physical one-epoch training through the staged Save/Discard boundary."""

    @classmethod
    def setUpClass(cls) -> None:
        required_modules = (
            "datasets",
            "diffusers",
            "huggingface_hub",
            "peft",
            "PIL",
            "pyarrow",
            "scipy",
            "torch",
            "transformers",
        )
        missing = [
            name
            for name in required_modules
            if importlib.util.find_spec(name) is None
        ]
        if missing:
            raise RuntimeError(
                "The controlled model-training E2E runtime is missing required "
                f"packages: {', '.join(missing)}."
            )

        from huggingface_hub import snapshot_download

        cls.local_models: dict[str, Path] = {}
        local_only = os.environ.get("HF_HUB_OFFLINE") == "1"
        for key, asset in FIXED_MODEL_ASSETS.items():
            snapshot: Path | None = None
            for _attempt in range(3):
                try:
                    snapshot = Path(
                        snapshot_download(
                            repo_id=asset.repository,
                            revision=asset.revision,
                            token=False,
                            local_files_only=local_only,
                            ignore_patterns=IGNORED_SNAPSHOT_PATTERNS,
                        )
                    )
                    break
                except Exception:
                    continue
            if snapshot is None:
                raise RuntimeError(
                    "Unable to resolve fixed model-training E2E asset "
                    f"{asset.repository}@{asset.revision}."
                ) from None
            size = _snapshot_size(snapshot)
            if size > asset.maximum_snapshot_bytes:
                raise RuntimeError(
                    "Fixed model-training E2E asset exceeded its reviewed size "
                    f"ceiling: {asset.repository}."
                )
            for relative_path, expected_sha256 in asset.weight_sha256:
                weight_path = snapshot / relative_path
                if (
                    not weight_path.is_file()
                    or _file_sha256(weight_path) != expected_sha256
                ):
                    raise RuntimeError(
                        "Fixed model-training E2E asset failed weight integrity "
                        f"verification: {asset.repository}."
                    )
            cls.local_models[key] = snapshot

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.fixture_root = self.root / "fixtures"
        self.fixture_root.mkdir(parents=True)
        self._write_image_fixtures()

    def tearDown(self) -> None:
        self.temporary.cleanup()
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def _write_image_fixtures(self) -> None:
        from PIL import Image

        Image.new("RGB", (32, 32), (220, 20, 20)).save(
            self.fixture_root / "red.png"
        )
        Image.new("RGB", (32, 32), (20, 20, 220)).save(
            self.fixture_root / "blue.png"
        )
        first_mask = Image.new("L", (32, 32), 0)
        second_mask = Image.new("L", (32, 32), 1)
        first_mask.save(self.fixture_root / "mask-zero.png")
        second_mask.save(self.fixture_root / "mask-one.png")

    def _write_dataset(self, task: str) -> tuple[Path, str, int]:
        if task in TEXT_TASK_ROWS:
            import pyarrow as pa
            import pyarrow.parquet as parquet

            rows = TEXT_TASK_ROWS[task]
            path = self.fixture_root / f"{task}.parquet"
            parquet.write_table(pa.Table.from_pylist(rows), path)
            return path, "parquet", len(rows)

        rows: list[dict[str, Any]]
        if task == "diffusion-lora":
            rows = [
                {"image": "red.png", "caption": "a small red square"},
                {"image": "blue.png", "caption": "a small blue square"},
            ]
        elif task == "vision-classification":
            rows = [
                {"image": "red.png", "label": "red"},
                {"image": "blue.png", "label": "blue"},
            ]
        elif task == "vision-detection":
            rows = [
                {
                    "image": "red.png",
                    "boundingBoxes": [
                        {"label": "square", "bbox": [4, 4, 20, 20]}
                    ],
                    "boxFormat": "xywh",
                },
                {
                    "image": "blue.png",
                    "boundingBoxes": [
                        {"label": "square", "bbox": [6, 6, 18, 18]}
                    ],
                    "boxFormat": "xywh",
                },
            ]
        elif task == "vision-segmentation":
            rows = [
                {
                    "image": "red.png",
                    "mask": "mask-zero.png",
                    "label": "background",
                },
                {
                    "image": "blue.png",
                    "mask": "mask-one.png",
                    "label": "foreground",
                },
            ]
        else:
            raise AssertionError(f"Unsupported training task fixture: {task}")

        path = self.fixture_root / f"{task}.jsonl"
        path.write_text(
            "".join(json.dumps(row) + "\n" for row in rows),
            encoding="utf-8",
        )
        return path, "jsonl", len(rows)

    def _request(
        self,
        task: str,
        dataset_path: Path,
        dataset_format: str,
    ) -> TrainModelTaskRequest:
        model_key = TASK_MODEL_KEYS[task]
        asset = FIXED_MODEL_ASSETS[model_key]
        method = (
            "lora"
            if task.startswith("llm-") or task == "diffusion-lora"
            else "full-finetune"
        )
        output_directory = self.root / "staged" / task
        return TrainModelTaskRequest.model_validate(
            {
                "trainingTask": task,
                "baseModel": {
                    "modelId": asset.repository,
                    "localPath": str(self.local_models[model_key]),
                    "inferenceMode": "causal" if task.startswith("llm-") else None,
                },
                "datasets": [
                    {
                        "artifactId": f"e2e-{task}",
                        "splitRole": "train",
                        "format": dataset_format,
                        "path": str(dataset_path),
                    }
                ],
                "method": method,
                "commonParameters": {
                    "numEpochs": 1,
                    "batchSize": 2,
                    "learningRate": 0.0002,
                    "maxSequenceLength": 64,
                    "imageResolution": 32,
                },
                "advancedParameters": {
                    "gradientAccumulationSteps": 1,
                    "checkpointIntervalSteps": 50,
                    "evalIntervalSteps": 0,
                    "lora": {
                        "rank": 2,
                        "alpha": 4,
                        "dropout": 0.0,
                    },
                },
                "output": {
                    "outputModelName": f"e2e-{task}",
                    "outputDirectory": str(output_directory),
                    "maxShardSize": "64MB",
                },
                "validation": {
                    "enabled": True,
                    "expectedLoRA": method == "lora",
                },
                "runMetadata": {"qualification": "model-training-e2e"},
            }
        )

    def _run_task(self, task: str) -> None:
        dataset_path, dataset_format, row_count = self._write_dataset(task)
        self.assertGreaterEqual(row_count, 1)
        self.assertLessEqual(row_count, 4)
        progress: list[dict[str, Any]] = []

        result = train_model(
            self._request(task, dataset_path, dataset_format),
            on_progress=progress.append,
        )

        error_code = (
            result.error.get("code")
            if isinstance(result.error, dict)
            else None
        )
        self.assertEqual(
            result.status,
            "succeeded",
            f"{task} failed with code {error_code or 'unknown'}.",
        )
        self.assertIsNotNone(result.generatedModelCandidate)
        candidate = result.generatedModelCandidate or {}
        self.assertEqual(candidate.get("generatedFromRunId"), result.runId)
        self.assertEqual(
            candidate.get("metadata", {}).get("trainingTask"),
            task,
        )
        staged_path = Path(str(candidate.get("localPath")))
        self.assertTrue(staged_path.is_dir())
        self.assertTrue(any(path.is_file() for path in staged_path.rglob("*")))
        stages = [entry.get("stage") for entry in progress]
        self.assertIn("training", stages)
        self.assertEqual(stages[-1], "completed")
        training_progress = [
            entry for entry in progress if entry.get("stage") == "training"
        ]
        self.assertTrue(training_progress)
        self.assertTrue(
            all(entry.get("totalEpochs") == 1 for entry in training_progress)
        )

    def test_llm_instruction_reaches_staged_review_without_saving(self) -> None:
        self._run_task("llm-instruction")

    def test_llm_classification_reaches_staged_review_without_saving(self) -> None:
        self._run_task("llm-classification")

    def test_llm_extraction_reaches_staged_review_without_saving(self) -> None:
        self._run_task("llm-extraction")

    def test_llm_embedding_reaches_staged_review_without_saving(self) -> None:
        self._run_task("llm-embedding")

    def test_llm_reranker_reaches_staged_review_without_saving(self) -> None:
        self._run_task("llm-reranker")

    def test_diffusion_lora_reaches_staged_review_without_saving(self) -> None:
        self._run_task("diffusion-lora")

    def test_vision_classification_reaches_staged_review_without_saving(
        self,
    ) -> None:
        self._run_task("vision-classification")

    def test_vision_detection_reaches_staged_review_without_saving(self) -> None:
        self._run_task("vision-detection")

    def test_vision_segmentation_reaches_staged_review_without_saving(self) -> None:
        self._run_task("vision-segmentation")


if __name__ == "__main__":
    unittest.main()
