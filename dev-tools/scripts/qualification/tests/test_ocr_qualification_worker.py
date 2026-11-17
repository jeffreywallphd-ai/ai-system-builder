"""Portable fixed-fixture checks; no product worker, native OCR or model runs."""
from pathlib import Path
import importlib.util
import json
import os
import sys
from types import ModuleType, SimpleNamespace
import unittest
import tempfile
from unittest.mock import patch

SOURCE = Path(__file__).parents[1] / "visual-composer/ocr-qualification-worker.py"
spec = importlib.util.spec_from_file_location("ocr_delivery_fixture_under_test", SOURCE)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def generation(**changes):
    return SimpleNamespace(model=SimpleNamespace(**{
        "provider": "transformers", "modelId": fixture.MODEL_ID, "device": "cpu",
        "memoryMode": "standard", "memoryOverflowPolicy": "none", "adapterModelId": None, **changes,
    }))


class OcrQualificationFixtureTests(unittest.TestCase):
    def test_failure_inside_native_exchange_is_recorded_without_formatting_and_rethrown(self):
        class UntrustedFailure(RuntimeError):
            def __str__(self):
                raise AssertionError("Supplier text must not be formatted")
        error = UntrustedFailure("private-path token prompt recognized text")
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            def exchange():
                raise error
            wrapped = fixture.observe_failure(exchange, "native",
                lambda boundary, failure: fixture.write_failure_fact(cache, boundary, failure, 1))
            with self.assertRaises(UntrustedFailure) as raised:
                wrapped()
            self.assertIs(raised.exception, error)
            facts = json.loads(next(cache.iterdir()).read_text(encoding="utf-8"))
            self.assertEqual(facts, {"schema_version": "qualified-ocr-failure-v1", "pid": os.getpid(),
                "sequence": 1, "boundary": "native", "type": "other", "code": "unknown", "stage": "unknown"})

    def test_failure_journal_has_finite_fields_exclusive_files_and_sequence_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            error = ValueError("private-path token prompt recognized text")
            for sequence in range(1, 17):
                fixture.write_failure_fact(cache, "task", error, sequence)
            self.assertEqual(len(list(cache.iterdir())), 16)
            self.assertTrue(all(file.stat().st_size <= 4096 for file in cache.iterdir()))
            with self.assertRaises(FileExistsError):
                fixture.write_failure_fact(cache, "task", error, 1)
            for boundary, sequence in (("supplier-private-text", 1), ("task", 0), ("task", 17), ("task", True)):
                with self.assertRaises(ValueError):
                    fixture.write_failure_fact(cache, boundary, error, sequence)
            for file in cache.iterdir():
                body = file.read_text(encoding="utf-8")
                self.assertNotIn("private-path", body)
                self.assertNotIn("recognized text", body)

    def test_diagnostic_write_failure_does_not_replace_original_cancellation(self):
        class DatasetPreparationCancellationRequested(RuntimeError):
            pass
        error = DatasetPreparationCancellationRequested()
        def cancel():
            raise error
        def unavailable_journal(*args):
            raise OSError("diagnostic unavailable")
        with self.assertRaises(DatasetPreparationCancellationRequested) as raised:
            fixture.observe_failure(cancel, "preparation", unavailable_journal)()
        self.assertIs(raised.exception, error)

    def test_fixture_writer_refuses_missing_or_traversing_run_identity_before_any_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for run in ("", "../other-run", "A" * 32, "a" * 81):
                with patch.dict(os.environ, {"VISUAL_COMPOSER_QUALIFICATION_RUN_ID": run}), \
                        patch.object(fixture.Path, "cwd", return_value=root):
                    with self.assertRaises(RuntimeError): fixture.write_fixture(root)
                self.assertEqual(list(root.iterdir()), [])

    def test_generation_preserves_exact_fixture_text_and_source_lineage(self):
        module = ModuleType("_ai_system_builder_worker.tasks.example_generation")
        module.GeneratedQaExample = lambda **values: SimpleNamespace(**values)
        chunks = [SimpleNamespace(artifact_id="synthetic-source", chunk_index=i, text=text)
                  for i, text in enumerate(fixture.LABELS)]
        with patch.dict(sys.modules, {module.__name__: module}):
            rows = fixture.generate(chunks, generation())
        self.assertEqual([row.answer for row in rows], list(fixture.LABELS))
        self.assertEqual([row.chunk_index for row in rows], list(range(5)))
        self.assertTrue(all(row.artifact_id == "synthetic-source" for row in rows))
        self.assertTrue(all(row.answer in row.question for row in rows))

    def test_real_model_adapter_accelerator_and_overflow_are_refused(self):
        for changes in ({"modelId": "a-real-model"}, {"provider": "other"}, {"device": "cuda"},
                        {"memoryMode": "offload-v1"}, {"memoryOverflowPolicy": "limited"},
                        {"adapterModelId": "an-adapter"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                fixture.valid_model(generation(**changes))

    def test_unknown_text_and_excessive_or_empty_chunks_cannot_generate_rows(self):
        module = ModuleType("_ai_system_builder_worker.tasks.example_generation")
        module.GeneratedQaExample = lambda **values: SimpleNamespace(**values)
        for chunks in ([], [SimpleNamespace(text="unknown source", artifact_id="a", chunk_index=0)],
                       [SimpleNamespace(text=fixture.LABELS[0], artifact_id="a", chunk_index=i) for i in range(17)]):
            with patch.dict(sys.modules, {module.__name__: module}), self.assertRaises(ValueError):
                fixture.generate(chunks, generation())

    def test_extra_arguments_and_nonoffline_launch_fail_before_worker_loading(self):
        with patch.object(sys, "argv", [str(SOURCE), "--command", "anything"]), \
                patch.object(fixture.importlib.util, "spec_from_file_location") as load:
            with self.assertRaises(RuntimeError): fixture.main()
        load.assert_not_called()
        with patch.object(sys, "argv", [str(SOURCE)]), patch.dict(os.environ, {}, clear=True), \
                patch.object(fixture.importlib.util, "spec_from_file_location") as load:
            with self.assertRaises(RuntimeError): fixture.main()
        load.assert_not_called()


if __name__ == "__main__": unittest.main()
