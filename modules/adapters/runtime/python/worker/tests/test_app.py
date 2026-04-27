from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.adapters.runtime.python.worker.app import capabilities, ensure_model_download, execute_task, health, model_status, unload_models
from modules.adapters.runtime.python.worker.models import EnsureModelDownloadRequest
from modules.adapters.runtime.python.worker.models import PythonRuntimeTaskRequest
from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import DatasetPreparationStageError


class WorkerAppTests(unittest.TestCase):
    def test_health_reports_interpreter_version(self) -> None:
        result = health()
        self.assertTrue(result.healthy)
        self.assertRegex(result.status.pythonVersion or "", r"^\d+\.\d+\.\d+")

    def test_prepare_training_dataset_dispatch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "source.txt"
            input_path.write_text("alpha beta gamma", encoding="utf-8")

            request = PythonRuntimeTaskRequest(
                requestId="req-1",
                taskType="prepare-training-dataset",
                payload={
                    "sourceInputs": [
                        {
                            "artifactId": "artifact-1",
                            "localPath": str(input_path),
                            "mediaType": "text/plain",
                        }
                    ],
                    "recipe": {
                        "normalization": {
                            "targetFormat": "markdown",
                            "unsupportedDocumentPolicy": "fail",
                        },
                        "chunking": {
                            "strategy": "character",
                            "chunkSize": 128,
                            "chunkOverlap": 8,
                            "preserveDocumentBoundaries": True,
                        },
                        "generation": {
                            "mode": "qa",
                            "model": {"provider": "transformers", "modelId": "test-model"},
                        },
                    },
                    "split": {"trainRatio": 0.67, "testRatio": 0.33, "seed": 7, "shuffle": True},
                    "output": {"format": "jsonl", "naming": {"baseName": "test-dataset"}},
                },
            )

            with patch("modules.adapters.runtime.python.worker.app.prepare_training_dataset") as prepare_mock:
                prepare_mock.return_value = type("Result", (), {"model_dump": lambda self, mode: {
                    "outputs": [],
                    "summary": {
                        "sourceDocumentCount": 1,
                        "normalizedDocumentCount": 1,
                        "skippedDocumentCount": 0,
                        "chunkCount": 1,
                        "generatedExampleCount": 1,
                        "datasetRowCount": 1,
                        "trainRowCount": 1,
                        "testRowCount": 0,
                    },
                }})()
                response = execute_task(request)

            self.assertTrue(response.success)
            self.assertIsNotNone(response.data)
            self.assertEqual(response.data["summary"]["generatedExampleCount"], 1)

    def test_prepare_training_dataset_dispatch_accepts_auto_inference_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "source.txt"
            input_path.write_text("alpha beta gamma", encoding="utf-8")

            request = PythonRuntimeTaskRequest(
                requestId="req-auto-inference-mode",
                taskType="prepare-training-dataset",
                payload={
                    "sourceInputs": [
                        {
                            "artifactId": "artifact-1",
                            "localPath": str(input_path),
                            "mediaType": "text/plain",
                        }
                    ],
                    "recipe": {
                        "normalization": {"targetFormat": "markdown"},
                        "chunking": {"strategy": "character", "chunkSize": 128, "chunkOverlap": 8},
                        "generation": {
                            "mode": "qa",
                            "model": {
                                "provider": "transformers",
                                "modelId": "Qwen/Qwen3-1.7B",
                                "inferenceMode": "auto",
                            },
                        },
                    },
                    "split": {"trainRatio": 0.5, "testRatio": 0.5},
                    "output": {"format": "jsonl"},
                },
            )

            with patch("modules.adapters.runtime.python.worker.app.prepare_training_dataset") as prepare_mock:
                prepare_mock.return_value = type("Result", (), {"model_dump": lambda self, mode: {
                    "outputs": [],
                    "summary": {
                        "sourceDocumentCount": 1,
                        "normalizedDocumentCount": 1,
                        "skippedDocumentCount": 0,
                        "chunkCount": 1,
                        "generatedExampleCount": 1,
                        "datasetRowCount": 1,
                        "trainRowCount": 1,
                        "testRowCount": 0,
                    },
                }})()
                response = execute_task(request)

            self.assertTrue(response.success)
            prepare_mock.assert_called_once()
            payload = prepare_mock.call_args.args[0]
            self.assertEqual(payload.recipe.generation.model.inferenceMode, "auto")

    def test_unknown_task_preserves_generic_execution_path(self) -> None:
        request = PythonRuntimeTaskRequest(
            requestId="req-unknown",
            taskType="unknown-task",
            payload={},
        )
        response = execute_task(request)
        self.assertFalse(response.success)
        self.assertEqual(response.error.code, "not_implemented")

    def test_capabilities_endpoint_contains_dataset_task(self) -> None:
        result = capabilities()
        self.assertIn("prepare-training-dataset", result.capabilities)
        self.assertIn("dataset-preparation.auto-inference-mode", result.capabilities)
        self.assertIn("ensure-model-download", result.capabilities)
        self.assertIn("unload-model", result.capabilities)

    def test_ensure_model_download_endpoint_returns_download_status(self) -> None:
        request = EnsureModelDownloadRequest(provider="transformers", modelId="Qwen/Qwen2.5-1.5B-Instruct")
        with patch("modules.adapters.runtime.python.worker.app.ensure_generation_model_downloaded") as ensure_mock:
            ensure_mock.return_value = type("Availability", (), {
                "downloaded": True,
                "from_cache": False,
                "local_path": "/tmp/models/qwen",
            })()
            result = ensure_model_download(request)

        self.assertEqual(result.provider, "transformers")
        self.assertEqual(result.modelId, "Qwen/Qwen2.5-1.5B-Instruct")
        self.assertTrue(result.downloaded)
        self.assertFalse(result.fromCache)
        self.assertEqual(result.localPath, "/tmp/models/qwen")

    def test_model_status_endpoint_reports_loaded_models_and_active_tasks(self) -> None:
        with patch("modules.adapters.runtime.python.worker.app.describe_loaded_generation_models") as describe_mock:
            describe_mock.return_value = [{
                "provider": "transformers",
                "modelId": "test-model",
                "inferenceMode": "text2text",
                "device": "auto",
                "torchDtype": "auto",
                "localPath": "/tmp/models/test-model",
            }]
            result = model_status()

        self.assertEqual(result.activeTaskCount, 0)
        self.assertEqual(result.loadedModels[0].modelId, "test-model")
        self.assertEqual(result.loadedModels[0].localPath, "/tmp/models/test-model")

    def test_unload_models_endpoint_clears_loaded_models_when_idle(self) -> None:
        with patch("modules.adapters.runtime.python.worker.app.unload_generation_models") as unload_mock:
            unload_mock.return_value = [{
                "provider": "transformers",
                "modelId": "test-model",
                "inferenceMode": "text2text",
                "device": "auto",
                "torchDtype": "auto",
                "localPath": "/tmp/models/test-model",
            }]
            result = unload_models()

        self.assertEqual(result.unloadedModels[0].modelId, "test-model")
        self.assertEqual(result.activeTaskCount, 0)

    def test_timeout_returns_structured_error(self) -> None:
        request = PythonRuntimeTaskRequest(
            requestId="req-timeout",
            taskType="prepare-training-dataset",
            timeoutMs=5,
            payload={
                "sourceInputs": [],
                "recipe": {
                    "normalization": {"targetFormat": "markdown"},
                    "chunking": {"strategy": "character", "chunkSize": 128, "chunkOverlap": 8},
                    "generation": {"mode": "qa", "model": {"provider": "transformers", "modelId": "test-model"}},
                },
                "split": {"trainRatio": 0.5, "testRatio": 0.5},
                "output": {"format": "jsonl"},
            },
        )

        with patch("modules.adapters.runtime.python.worker.app.prepare_training_dataset") as prepare_mock:
            def _slow(*_args, **_kwargs):
                import time
                time.sleep(0.05)
                return None
            prepare_mock.side_effect = _slow
            response = execute_task(request)

        self.assertFalse(response.success)
        self.assertEqual(response.error.errorCode, "runtime_timeout")
        self.assertEqual(response.error.stage, "generation")

    def test_stage_error_details_are_returned_in_runtime_error(self) -> None:
        request = PythonRuntimeTaskRequest(
            requestId="req-stage-details",
            taskType="prepare-training-dataset",
            payload={
                "sourceInputs": [],
                "recipe": {
                    "normalization": {"targetFormat": "markdown"},
                    "chunking": {"strategy": "character", "chunkSize": 128, "chunkOverlap": 8},
                    "generation": {"mode": "qa", "model": {"provider": "transformers", "modelId": "test-model"}},
                },
                "split": {"trainRatio": 0.5, "testRatio": 0.5},
                "output": {"format": "jsonl"},
            },
        )

        with patch("modules.adapters.runtime.python.worker.app.prepare_training_dataset") as prepare_mock:
            prepare_mock.side_effect = DatasetPreparationStageError(
                "generation",
                "Generation model is not downloaded.",
                "generation_model_not_available",
                details={"modelId": "test-model"},
            )
            response = execute_task(request)

        self.assertFalse(response.success)
        self.assertEqual(response.error.errorCode, "generation_model_not_available")
        self.assertEqual(response.error.stage, "generation")
        self.assertEqual((response.error.details or {}).get("modelId"), "test-model")


if __name__ == "__main__":
    unittest.main()
