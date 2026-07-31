from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.responses import JSONResponse

from modules.adapters.runtime.python.worker import app as worker_app
from modules.adapters.runtime.python.worker.app import _run_task, ensure_model_download
from modules.adapters.runtime.python.worker.tasks.local_text_generation import (
    GenerationModelDownloadError,
)
from modules.adapters.runtime.python.worker.models import EnsureModelDownloadRequest
from modules.adapters.runtime.python.worker.models import StartPythonRuntimeTaskRequest


class WorkerAppTests(unittest.TestCase):
    def setUp(self) -> None:
        with worker_app.TASK_REGISTRY_LOCK:
            worker_app.TASK_REGISTRY.clear()

    def test_capabilities_advertise_constrained_json_only_when_ready(self) -> None:
        with patch(
            "modules.adapters.runtime.python.worker.app.get_constrained_json_decoder_runtime_status",
            return_value=SimpleNamespace(available=True),
        ):
            ready = worker_app.capabilities()
        with patch(
            "modules.adapters.runtime.python.worker.app.get_constrained_json_decoder_runtime_status",
            return_value=SimpleNamespace(available=False),
        ):
            unavailable = worker_app.capabilities()

        self.assertIn("dataset-preparation.constrained-json", ready.capabilities)
        self.assertNotIn("dataset-preparation.constrained-json", unavailable.capabilities)

    def test_model_download_success_emits_lifecycle_logs(self) -> None:
        request = EnsureModelDownloadRequest(
            provider="transformers",
            modelId="Qwen/Qwen3.5-4B",
        )

        with (
            patch(
                "modules.adapters.runtime.python.worker.app.ensure_generation_model_downloaded",
                return_value=SimpleNamespace(
                    downloaded=True,
                    from_cache=False,
                    local_path="/models/qwen",
                    cache_handle="models--Qwen--Qwen3.5-4B/snapshots/revision-a",
                ),
            ),
            patch("builtins.print") as print_mock,
        ):
            response = ensure_model_download(request)

        self.assertEqual(response.modelId, "Qwen/Qwen3.5-4B")
        printed_events = [
            json.loads(call.args[0])["event"]
            for call in print_mock.call_args_list
            if call.args and isinstance(call.args[0], str) and call.args[0].startswith("{")
        ]
        self.assertIn("runtime.model_download.started", printed_events)
        self.assertIn("runtime.model_download.succeeded", printed_events)

    def test_model_download_failure_returns_structured_json_response(self) -> None:
        request = EnsureModelDownloadRequest(
            provider="transformers",
            modelId="Qwen/Qwen3.5-4B",
        )

        with (
            patch(
                "modules.adapters.runtime.python.worker.app.ensure_generation_model_downloaded",
                side_effect=RuntimeError("Automatic download failed."),
            ),
            patch("builtins.print") as print_mock,
        ):
            response = ensure_model_download(request)

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 502)
        payload = json.loads(response.body.decode("utf-8"))
        self.assertEqual(payload["error"]["code"], "model_download_failed")
        self.assertEqual(payload["error"]["stage"], "generation")
        self.assertNotIn("modelId", payload["error"]["details"])
        self.assertNotIn("Automatic download failed", payload["error"]["message"])
        self.assertNotIn("Traceback", payload["error"]["message"])
        printed_events = [
            json.loads(call.args[0])["event"]
            for call in print_mock.call_args_list
            if call.args and isinstance(call.args[0], str) and call.args[0].startswith("{")
        ]
        self.assertIn("runtime.model_download.started", printed_events)
        self.assertIn("runtime.model_download.failed", printed_events)
        self.assertNotIn("Qwen/Qwen3.5-4B", " ".join(str(call) for call in print_mock.call_args_list))

    def test_model_download_interruption_returns_safe_retryable_response(self) -> None:
        request = EnsureModelDownloadRequest(
            provider="transformers",
            modelId="Qwen/Qwen2.5-3B-Instruct",
        )

        with patch(
            "modules.adapters.runtime.python.worker.app.ensure_generation_model_downloaded",
            side_effect=GenerationModelDownloadError("private transfer details"),
        ):
            response = ensure_model_download(request)

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 502)
        payload = json.loads(response.body.decode("utf-8"))
        self.assertEqual(payload["error"]["code"], "model_download_failed")
        self.assertEqual(
            payload["error"]["errorCode"], "model_download_interrupted"
        )
        self.assertTrue(payload["error"]["retryable"])
        self.assertIn("Retry to resume", payload["error"]["message"])
        self.assertNotIn("private", payload["error"]["message"])

    def test_async_model_download_task_returns_download_result(self) -> None:
        request = StartPythonRuntimeTaskRequest(
            requestId="download-1",
            taskType="ensure-model-download",
            payload={
                "provider": "transformers",
                "modelId": "Qwen/Qwen3.5-4B",
            },
        )

        with patch(
            "modules.adapters.runtime.python.worker.app.ensure_generation_model_downloaded",
            return_value=SimpleNamespace(
                downloaded=True,
                from_cache=False,
                local_path="/models/qwen",
                cache_handle="models--Qwen--Qwen3.5-4B/snapshots/revision-a",
            ),
        ):
            result = _run_task(request)

        self.assertEqual(
            result,
            {
                "provider": "transformers",
                "modelId": "Qwen/Qwen3.5-4B",
                "downloaded": True,
                "fromCache": False,
                "modelHandle": "models--Qwen--Qwen3.5-4B/snapshots/revision-a",
            },
        )

    def test_async_model_download_task_updates_progress(self) -> None:
        request = StartPythonRuntimeTaskRequest(
            requestId="download-progress-1",
            taskType="ensure-model-download",
            payload={
                "provider": "transformers",
                "modelId": "Qwen/Qwen3.5-4B",
            },
        )

        def fake_download(_model_config, on_progress=None, download_context=None):
            del download_context
            if on_progress is not None:
                on_progress(
                    {
                        "stage": "snapshot-download",
                        "message": "Downloading Hugging Face snapshot.",
                        "fileCount": 12,
                        "totalBytes": 3456,
                    }
                )
            return SimpleNamespace(
                downloaded=True,
                from_cache=False,
                local_path="/models/qwen",
                cache_handle="models--Qwen--Qwen3.5-4B/snapshots/revision-a",
            )

        with patch(
            "modules.adapters.runtime.python.worker.app.ensure_generation_model_downloaded",
            side_effect=fake_download,
        ):
            with worker_app.TASK_REGISTRY_LOCK:
                worker_app.TASK_REGISTRY[request.requestId] = worker_app._create_task_record(
                    request.requestId,
                    request.taskType,
                )
            _run_task(request)

        status = worker_app.read_task_status("download-progress-1")
        self.assertEqual(status.progress["stage"], "snapshot-download")
        self.assertEqual(status.progress["fileCount"], 12)

    def test_async_model_download_failure_preserves_retryable_safe_error(self) -> None:
        request = StartPythonRuntimeTaskRequest(
            requestId="download-retryable-1",
            taskType="ensure-model-download",
            payload={
                "provider": "transformers",
                "modelId": "Qwen/Qwen2.5-3B-Instruct",
            },
        )

        with patch(
            "modules.adapters.runtime.python.worker.app.ensure_generation_model_downloaded",
            side_effect=GenerationModelDownloadError(
                "private network and cache details"
            ),
        ):
            worker_app._start_async_task(request)
            task = worker_app.TASK_REGISTRY[request.requestId]
            task["future"].result(timeout=2)

        status = worker_app.read_task_status(request.requestId)
        self.assertEqual(status.status, "failed")
        self.assertEqual(status.error.code, "model_download_interrupted")
        self.assertTrue(status.error.retryable)
        self.assertIn("Retry to resume", status.error.message)
        self.assertNotIn("private", status.error.message)

    def test_validate_model_returns_opaque_report_references(self) -> None:
        request = StartPythonRuntimeTaskRequest(
            requestId="validate-1",
            taskType="validate-model",
            payload={
                "modelRecordId": "model-1",
                "modelPath": "/host/models/model-1",
            },
        )
        with patch(
            "modules.adapters.runtime.python.worker.app.validate_model_output",
            return_value={
                "status": "valid",
                "validationReportPath": "/host/models/model-1/report.md",
                "validationDiffPath": "/host/models/model-1/diff.json",
            },
        ):
            result = _run_task(request)

        self.assertRegex(
            result["validationReportPath"],
            r"^validation-report:[a-f0-9]{64}$",
        )
        self.assertRegex(
            result["validationDiffPath"],
            r"^validation-diff:[a-f0-9]{64}$",
        )
        self.assertNotIn("/host/models", json.dumps(result))

    def test_validate_model_rejects_caller_selected_report_directory(self) -> None:
        request = StartPythonRuntimeTaskRequest(
            requestId="validate-unsafe",
            taskType="validate-model",
            payload={
                "modelRecordId": "model-1",
                "modelPath": "/host/models/model-1",
                "reportOutputDirectory": "/renderer/selected",
            },
        )

        with self.assertRaises(Exception):
            _run_task(request)


if __name__ == "__main__":
    unittest.main()
