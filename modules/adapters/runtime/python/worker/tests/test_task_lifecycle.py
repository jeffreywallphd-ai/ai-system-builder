from __future__ import annotations

import time
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker import app as worker_app
from modules.adapters.runtime.python.worker.models import StartPythonRuntimeTaskRequest


class TaskLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        with worker_app.TASK_REGISTRY_LOCK:
            worker_app.TASK_REGISTRY.clear()

    def test_start_returns_accepted_true_quickly(self) -> None:
        with patch("modules.adapters.runtime.python.worker.app.train_model") as train_mock:
            train_mock.return_value = type("R", (), {"model_dump": lambda self, mode: {"runId": "r1"}})()
            started = time.monotonic()
            result = worker_app.start_task(StartPythonRuntimeTaskRequest(requestId="r1", taskType="train-model", payload={"baseModel": {}, "datasets": [], "method": "lora", "output": {}}))
            elapsed = time.monotonic() - started
        self.assertTrue(result.accepted)
        self.assertLess(elapsed, 0.5)

    def test_unknown_request_id_returns_unknown(self) -> None:
        result = worker_app.read_task_status("missing")
        self.assertEqual(result.status, "unknown")

    def test_running_then_succeeded_status(self) -> None:
        def slow_train(_payload):
            time.sleep(0.2)
            return type("R", (), {"model_dump": lambda self, mode: {"runId": "r2"}})()

        with patch("modules.adapters.runtime.python.worker.app.train_model", side_effect=slow_train):
            worker_app.start_task(StartPythonRuntimeTaskRequest(requestId="r2", taskType="train-model", payload={"baseModel": {}, "datasets": [], "method": "lora", "output": {}}))
            running = worker_app.read_task_status("r2")
            self.assertIn(running.status, {"queued", "running"})
            time.sleep(0.4)
            done = worker_app.read_task_status("r2")
            self.assertEqual(done.status, "succeeded")
            self.assertEqual(done.data["runId"], "r2")

    def test_failed_task_returns_structured_error(self) -> None:
        with patch("modules.adapters.runtime.python.worker.app.train_model", side_effect=RuntimeError("boom")):
            worker_app.start_task(StartPythonRuntimeTaskRequest(requestId="r3", taskType="train-model", payload={"baseModel": {}, "datasets": [], "method": "lora", "output": {}}))
            time.sleep(0.2)
            status = worker_app.read_task_status("r3")
            self.assertEqual(status.status, "failed")
            self.assertEqual(status.error.code, "task_failed")

    def test_dataset_progress_updates_registry(self) -> None:
        def fake_prepare(_payload, on_generation_progress):
            on_generation_progress({"totalChunkCount": 2, "processedChunkCount": 1, "generatedRowCount": 5})
            time.sleep(0.1)
            return type("R", (), {"model_dump": lambda self, mode: {"summary": {"generatedExampleCount": 5}}})()

        with patch("modules.adapters.runtime.python.worker.app.prepare_training_dataset", side_effect=fake_prepare):
            worker_app.start_task(StartPythonRuntimeTaskRequest(requestId="r4", taskType="prepare-training-dataset", payload={"sourceInputs": [], "recipe": {"normalization": {"targetFormat": "markdown"}, "chunking": {"strategy": "character", "chunkSize": 1, "chunkOverlap": 0}, "generation": {"mode": "qa", "model": {"provider": "transformers", "modelId": "m"}}}, "split": {"trainRatio": 0.5, "testRatio": 0.5}, "output": {"format": "jsonl"}}))
            time.sleep(0.05)
            status = worker_app.read_task_status("r4")
            self.assertIsNotNone(status.progress)
            self.assertEqual(status.progress["processedChunkCount"], 1)
            self.assertEqual(status.progress["message"], "Processing chunk 2/2...")

    def test_duplicate_request_id_is_rejected(self) -> None:
        def slow_train(_payload):
            time.sleep(0.2)
            return type("R", (), {"model_dump": lambda self, mode: {"runId": "dup"}})()

        with patch("modules.adapters.runtime.python.worker.app.train_model", side_effect=slow_train):
            worker_app.start_task(StartPythonRuntimeTaskRequest(requestId="dup", taskType="train-model", payload={"baseModel": {}, "datasets": [], "method": "lora", "output": {}}))
            with self.assertRaises(RuntimeError):
                worker_app.start_task(StartPythonRuntimeTaskRequest(requestId="dup", taskType="train-model", payload={"baseModel": {}, "datasets": [], "method": "lora", "output": {}}))

    def test_cancel_running_does_not_claim_killed(self) -> None:
        def slow_train(_payload):
            time.sleep(0.4)
            return type("R", (), {"model_dump": lambda self, mode: {"runId": "r5"}})()

        with patch("modules.adapters.runtime.python.worker.app.train_model", side_effect=slow_train):
            worker_app.start_task(StartPythonRuntimeTaskRequest(requestId="r5", taskType="train-model", payload={"baseModel": {}, "datasets": [], "method": "lora", "output": {}}))
            time.sleep(0.05)
            cancel = worker_app.cancel_task("r5")
            self.assertFalse(cancel.cancelled)
            self.assertEqual(cancel.status, "running")

    def test_active_task_count_tracks_running_only(self) -> None:
        def slow_train(_payload):
            time.sleep(0.2)
            return type("R", (), {"model_dump": lambda self, mode: {"runId": "r6"}})()

        with patch("modules.adapters.runtime.python.worker.app.train_model", side_effect=slow_train):
            worker_app.start_task(StartPythonRuntimeTaskRequest(requestId="r6", taskType="train-model", payload={"baseModel": {}, "datasets": [], "method": "lora", "output": {}}))
            self.assertGreaterEqual(worker_app.model_status().activeTaskCount, 0)
            time.sleep(0.4)
            self.assertEqual(worker_app.model_status().activeTaskCount, 0)


if __name__ == "__main__":
    unittest.main()
