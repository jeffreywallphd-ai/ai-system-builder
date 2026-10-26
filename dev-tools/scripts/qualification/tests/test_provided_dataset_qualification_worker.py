import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace as NS
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("provided_fixture", Path(__file__).resolve().parents[1] / "visual-composer/provided-dataset-qualification-worker.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class ProvidedDatasetQualificationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name).resolve()
        source = self.root / "source.csv"
        source.write_text("text,label\nSynthetic invoice,invoice\n", encoding="utf-8")
        self.payload = NS(preparation=NS(method="validate-and-split", generationMode="none",
            inputIntent="use-existing-dataset", sourceKinds=["structured"]),
            recipe=NS(task={"taskType": "llm-classification", "textInputMode": "provided"},
                generation=None, normalization=None, chunking=None), advanced=None,
            sourceInputs=[NS(localPath=str(source), mediaType="text/csv", originalName="synthetic-provided.csv")],
            output=NS(format="jsonl"))

    def test_fixed_provided_payload_is_admitted_without_model_import(self):
        fixture.validate_provided(self.payload, self.root)

    def test_generation_ocr_other_tasks_and_unbounded_sources_are_denied(self):
        for target, key, value in [
            ("preparation", "method", "fixed-length"), ("preparation", "generationMode", "task-examples"),
            ("preparation", "inputIntent", "create-from-source-material"), ("preparation", "sourceKinds", ["document"]),
            ("recipe", "generation", {}), ("recipe", "normalization", {}), ("recipe", "chunking", {}),
            ("output", "format", "parquet"),
        ]:
            payload = copy.deepcopy(self.payload)
            setattr(getattr(payload, target), key, value)
            with self.subTest(key=key), self.assertRaises(ValueError): fixture.validate_provided(payload, self.root)
        for change in [lambda p: setattr(p, "advanced", NS(content=NS(ocrEnabled=True))),
                       lambda p: setattr(p, "sourceInputs", p.sourceInputs * 2),
                       lambda p: p.recipe.task.update(textInputMode="generate"),
                       lambda p: p.recipe.task.update(taskType="llm-instruction"),
                       lambda p: setattr(p.sourceInputs[0], "originalName", "untrusted.csv")]:
            payload = copy.deepcopy(self.payload); change(payload)
            with self.assertRaises(ValueError): fixture.validate_provided(payload, self.root)

    def test_external_missing_directory_empty_large_or_alias_sources_are_denied(self):
        source = Path(self.payload.sourceInputs[0].localPath)
        for candidate in [self.root.parent / "outside.csv", self.root / "missing", self.root,
                          self.root / "child/../source.csv"]:
            payload = copy.deepcopy(self.payload); payload.sourceInputs[0].localPath = str(candidate)
            with self.assertRaises((ValueError, OSError)): fixture.validate_provided(payload, self.root)
        for size in (0, 16_385):
            source.write_bytes(b"x" * size)
            with self.assertRaises(ValueError): fixture.validate_provided(self.payload, self.root)

    def test_only_preparation_and_review_are_admitted(self):
        for name in ("prepare-training-dataset", "review-dataset"): fixture.dispatch_allowed(NS(taskType=name))
        for name in ("generate-text", "download-model", "train-lora", "", None):
            with self.assertRaises(ValueError): fixture.dispatch_allowed(NS(taskType=name))

    def test_failure_facts_are_closed_exclusive_and_bounded(self):
        fixture.write_failure_fact(self.root, "preparation", ValueError("private input must not be written"), 1)
        files = list(self.root.glob("qualification-provided-failure-*.json"))
        self.assertEqual(len(files), 1)
        raw = files[0].read_text(encoding="utf-8")
        self.assertNotIn("private", raw); self.assertLess(len(raw), 4096)
        self.assertEqual(json.loads(raw)["type"], "ValueError")
        with self.assertRaises(FileExistsError): fixture.write_failure_fact(self.root, "preparation", ValueError(), 1)
        for boundary, sequence in (("unknown", 2), ("task", 0), ("task", 17), ("task", True)):
            with self.assertRaises(ValueError): fixture.write_failure_fact(self.root, boundary, ValueError(), sequence)


if __name__ == "__main__": unittest.main()
