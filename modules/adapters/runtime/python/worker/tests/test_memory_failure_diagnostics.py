from __future__ import annotations
import unittest
from modules.adapters.runtime.python.worker.app import _safe_task_error_details
from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import DatasetPreparationStageError

class MemoryFailureDiagnosticsTests(unittest.TestCase):
    def test_numeric_memory_facts_are_the_only_additional_public_details(self):
        value = {"resource": "ram", "requiredBytes": 3758096384, "availableBytes": 3503902720, "allowedOverflowBytes": 0}
        error = DatasetPreparationStageError("generation", "private exception", "generation_insufficient_resources",
            details={"memoryShortfall": {**value, "path": "private-fixture"}, "modelId": "private-fixture"})
        self.assertEqual(_safe_task_error_details(error), {"diagnosticClass": "DatasetPreparationStageError", "memoryShortfall": value})

    def test_other_codes_malformed_or_inconsistent_facts_never_escape(self):
        value = {"resource": "ram", "requiredBytes": 100, "availableBytes": 1, "allowedOverflowBytes": 0}
        for malformed in [None, [], "private", {**value, "availableBytes": True}, {**value, "requiredBytes": 1.5},
            {**value, "availableBytes": -1}, {**value, "requiredBytes": float("inf")}, {**value, "requiredBytes": 1024**5+1},
            {**value, "allowedOverflowBytes": 100}, {**value, "resource": "unknown"},
            {**value, "resource": []}, {**value, "resource": {}},
            {**value, "resource": "vram", "allowedOverflowBytes": 1}]:
            with self.subTest(value=malformed):
                error = DatasetPreparationStageError("generation", "private", "generation_insufficient_resources", details={"memoryShortfall": malformed})
                self.assertEqual(_safe_task_error_details(error), {"diagnosticClass": "DatasetPreparationStageError"})
        error = DatasetPreparationStageError("generation", "private", "generation_failed", details={"memoryShortfall": value})
        self.assertNotIn("memoryShortfall", _safe_task_error_details(error))
