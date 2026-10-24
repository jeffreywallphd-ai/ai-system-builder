"""Real preparation/lineage/output flow with synthetic OCR and generator fixtures."""
import json
import importlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import PrepareTrainingDatasetRequest
from modules.adapters.runtime.python.worker.ocr.protocol import OcrContractError, OcrUnavailable, OcrPage, OcrLine
from modules.adapters.runtime.python.worker.ocr import provider, source_snapshot
from modules.adapters.runtime.python.worker.tasks.example_generation import GeneratedQaExample
from modules.adapters.runtime.python.worker.tests.test_ocr_task_sources import payload_dict
from modules.adapters.runtime.python.worker.tests.test_document_normalization_ocr import Provider
from modules.adapters.runtime.python.worker.tests.structured_output_test_fixtures import runtime_structured_output_fixture
from modules.adapters.runtime.python.worker.tests.test_dataset_quality import _quality_config

task = importlib.import_module("modules.adapters.runtime.python.worker.tasks.prepare_training_dataset")


def payload():
    data = payload_dict()
    data["runtime"].update(runtime_structured_output_fixture())
    data["recipe"]["task"] = {"taskType": "llm-instruction", "textInputMode": "generate"}
    data["advanced"]["content"].update(maxTokensPerChunk=32, maxSourceSpans=100)
    data["advanced"].update(semantic={"enabled": True, "embeddingAlgorithm": "hashed-token-v1"},
                             synthetic={"enabled": True, "candidatesPerChunk": 1, "requireReview": True})
    data["quality"] = _quality_config().model_dump(mode="json")
    return PrepareTrainingDatasetRequest.model_validate(data)


def generate(chunks, config):
    return [GeneratedQaExample(artifact_id=c.artifact_id, chunk_index=c.chunk_index,
                              question=f"Explain {c.text.strip()}?", answer=c.text) for c in chunks]


class OcrPreparationTaskTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.reader = Provider((OcrPage(1, 100, 50, ()), OcrPage(2, 100, 50, (
            OcrLine("  alpha\t\U0001f642  ", 1, 2, 70, 15), OcrLine("second", 2, 20, 60, 10))),
            OcrPage(3, 100, 50, ())))
        for target, kwargs in ((task, {"ensure_generation_model_is_available": None}),):
            for name, result in kwargs.items():
                context = patch.object(target, name, return_value=result)
                context.start(); self.addCleanup(context.stop)
        factory = patch.object(provider, "local_provider", return_value=self.reader)
        self.factory = factory.start(); self.addCleanup(factory.stop)
        # The separate capture suite qualifies real files, bounds and SHA256.
        capture = patch.object(source_snapshot, "capture_source", return_value=b"synthetic immutable PDF")
        self.capture = capture.start(); self.addCleanup(capture.stop)

    def run_task(self, value=None, **kwargs):
        return task.prepare_training_dataset(value or payload(), example_generator=generate,
                                             output_directory=Path(self.folder.name), **kwargs)

    def test_complete_task_preserves_original_page_and_lineage_and_actual_reader_facts(self):
        with patch.object(task, "_load_structured_task_rows", side_effect=AssertionError("Display-name fallback")):
            result = self.run_task()
        self.assertEqual(result.summary.sourceDocumentCount, 1)
        self.assertEqual(result.summary.normalizedDocumentCount, 1)
        self.assertEqual(result.summary.chunkCount, 2)
        report = result.advancedReport
        self.assertEqual(report["content"]["ocr"], {"provider": "test", "version": "1", "language": "en-US",
                                                    "documentCount": 1, "pageCount": 3, "lineCount": 2})
        self.assertEqual(next(v for v in report["capabilities"] if v["capabilityId"] == "ocr-text")["status"], "ready")
        output = next(v for v in result.outputs if v.role == "dataset")
        rows = [json.loads(line) for line in Path(output.tempPath).read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual(row["sourceLineage"]["regionKind"], "line")
            self.assertEqual(row["sourceLineage"]["pageNumber"], 2)
            self.assertEqual(row["sourceLineage"]["sourceArtifactId"], "pdf-a")
        self.assertNotIn("runtimeWorkingDirectory", json.dumps(report))
        self.assertNotIn("alpha", json.dumps(report))

    def test_bad_map_denies_before_source_model_or_output_effects(self):
        value = payload(); value.runtime["ocrSources"]["sources"][0]["sha256"] = "private-invalid"
        with patch.object(task, "_ensure_generation_model_ready") as model, patch.object(task, "_emit_rows") as output:
            with self.assertRaises(OcrContractError): self.run_task(value)
        model.assert_not_called(); output.assert_not_called(); self.capture.assert_not_called()

    def test_cancel_before_source_capture_does_not_emit_outputs(self):
        with self.assertRaises(task.DatasetPreparationCancellationRequested): self.run_task(cancelled=lambda: True)
        self.capture.assert_not_called(); self.factory.assert_not_called()
        self.assertEqual(list(Path(self.folder.name).iterdir()), [])

    def test_cancel_after_recognition_or_generation_cannot_return_partial_outputs(self):
        state = [False]
        self.reader.after = lambda: state.__setitem__(0, True)
        with self.assertRaises(task.DatasetPreparationCancellationRequested): self.run_task(cancelled=lambda: state[0])
        self.assertEqual(list(Path(self.folder.name).iterdir()), [])
        self.reader.after = lambda: None; state[0] = False
        def stop_after_generation(chunks, config):
            state[0] = True
            return generate(chunks, config)
        with self.assertRaises(task.DatasetPreparationCancellationRequested):
            task.prepare_training_dataset(payload(), example_generator=stop_after_generation,
                output_directory=Path(self.folder.name), cancelled=lambda: state[0])
        self.assertEqual(list(Path(self.folder.name).iterdir()), [])

    def test_unavailable_reader_stays_unavailable_under_skip_policy(self):
        value = payload(); value.recipe.normalization.unsupportedDocumentPolicy = "skip"
        with patch.object(self.reader, "recognize", side_effect=OcrUnavailable("private-provider-error")):
            with self.assertRaises(OcrUnavailable): self.run_task(value)
        self.assertEqual(list(Path(self.folder.name).iterdir()), [])


if __name__ == "__main__": unittest.main()
