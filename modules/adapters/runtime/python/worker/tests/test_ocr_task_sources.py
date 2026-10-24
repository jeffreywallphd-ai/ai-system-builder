"""No source, model, provider or native I/O in task-map admission tests."""
from copy import deepcopy
from pathlib import Path
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import PrepareTrainingDatasetRequest
from modules.adapters.runtime.python.worker.ocr.protocol import OcrContractError
from modules.adapters.runtime.python.worker.ocr.task_sources import task_ocr_sources

ROOT = r"C:\synthetic\ai-system-builder-runtime-ABC123"


def payload_dict():
    return {
        "sourceInputs": [{"artifactId": "pdf-a", "localPath": ROOT + r"\0001-source.pdf",
                          "mediaType": "application/pdf", "originalName": "private-name.docx"}],
        "preparation": {"schemaVersion": "1", "inputIntent": "create-from-source-material",
                        "method": "structure-aware", "sourceKinds": ["document"], "generationMode": "task-examples"},
        "recipe": {"normalization": {"targetFormat": "markdown"},
                   "generation": {"mode": "qa", "model": {"provider": "transformers", "modelId": "synthetic"}}},
        "split": {"trainRatio": 0.8, "testRatio": 0.2}, "output": {"format": "jsonl"},
        "advanced": {"preset": "structure-aware", "content": {
            "strategy": "layout", "layoutEnabled": True, "ocrEnabled": True, "ocrLanguage": "en-US"}},
        "runtime": {"runtimeWorkingDirectory": ROOT, "ocrSources": {"protocol": "staged-pdf-ocr-v1", "sources": [
            {"artifactId": "pdf-a", "fileName": "0001-source.pdf", "byteLength": 8, "sha256": "a" * 64}]}},
    }


class OcrTaskSourcesTests(unittest.TestCase):
    def test_exact_task_map_is_private_ordered_and_does_no_io(self):
        with patch.object(Path, "open", side_effect=AssertionError("Unexpected file read")):
            result = task_ocr_sources(PrepareTrainingDatasetRequest.model_validate(payload_dict()))
        self.assertEqual(result.language, "en-US")
        self.assertEqual(result.stage_root, ROOT)
        self.assertEqual(result.bindings[0].file_name, "0001-source.pdf")
        self.assertEqual(result.bindings[0].artifact_id, "pdf-a")
        self.assertNotIn(ROOT, repr(result))
        self.assertNotIn("pdf-a", repr(result))

    def test_whole_map_rejects_missing_extra_changed_and_unsafe_bindings_before_io(self):
        cases = []
        def changed(label, mutate):
            data = payload_dict(); mutate(data); cases.append((label, data))
        changed("missing map", lambda p: p["runtime"].pop("ocrSources"))
        changed("wrong protocol", lambda p: p["runtime"]["ocrSources"].update(protocol="staged-pdf-ocr-v2"))
        changed("extra map key", lambda p: p["runtime"]["ocrSources"].update(path="PRIVATE"))
        changed("empty map", lambda p: p["runtime"]["ocrSources"].update(sources=[]))
        changed("extra source", lambda p: p["runtime"]["ocrSources"]["sources"].append(deepcopy(p["runtime"]["ocrSources"]["sources"][0])))
        changed("different root", lambda p: p["runtime"].update(runtimeWorkingDirectory=r"C:\other\not-a-stage"))
        changed("network root", lambda p: p["runtime"].update(runtimeWorkingDirectory=r"\\server\share\stage"))
        changed("relative source", lambda p: p["sourceInputs"][0].update(localPath="0001-source.pdf"))
        changed("other source path", lambda p: p["sourceInputs"][0].update(localPath=ROOT + r"\0002-source.pdf"))
        changed("different id", lambda p: p["sourceInputs"][0].update(artifactId="other"))
        changed("non-PDF", lambda p: p["sourceInputs"][0].update(mediaType="text/plain"))
        for key, value in (("fileName", "../private.pdf"), ("fileName", "0002-source.pdf"),
                           ("fileName", "0001-private.pdf"), ("byteLength", True),
                           ("byteLength", 0), ("byteLength", 16 * 1024**2 + 1),
                           ("sha256", "A" * 64), ("sha256", "sha256:" + "a" * 64),
                           ("extra", "PRIVATE")):
            changed(key + str(value)[:12], lambda p, k=key, v=value: p["runtime"]["ocrSources"]["sources"][0].update({k: v}))
        for label, data in cases:
            with self.subTest(case=label), patch.object(Path, "open", side_effect=AssertionError("Unexpected I/O")):
                with self.assertRaises(OcrContractError) as error:
                    task_ocr_sources(PrepareTrainingDatasetRequest.model_validate(data))
                self.assertNotIn("PRIVATE", str(error.exception))
                self.assertNotIn(ROOT, str(error.exception))

    def test_standard_has_no_ocr_map_and_inactive_maps_deny(self):
        data = payload_dict(); data.pop("advanced"); data["runtime"].pop("ocrSources")
        self.assertIsNone(task_ocr_sources(PrepareTrainingDatasetRequest.model_validate(data)))
        data["runtime"]["ocrSources"] = payload_dict()["runtime"]["ocrSources"]
        with self.assertRaises(OcrContractError):
            task_ocr_sources(PrepareTrainingDatasetRequest.model_validate(data))

    def test_raw_boolean_and_language_inputs_are_not_coerced(self):
        for key, value in (("ocrEnabled", 1), ("ocrEnabled", "true"), ("layoutEnabled", 1),
                           ("layoutEnabled", "true"), ("ocrLanguage", 1), ("ocrLanguage", "../private")):
            data = payload_dict(); data["advanced"]["content"][key] = value
            with self.subTest(key=key, kind=type(value).__name__), self.assertRaises(ValueError):
                PrepareTrainingDatasetRequest.model_validate(data)

    def test_incompatible_task_settings_deny_before_any_read(self):
        cases = [("content", "strategy", "sentence"), ("content", "layoutEnabled", False),
                 ("content", "ocrLanguage", None), ("plan", "method", "topic-aware"),
                 ("plan", "generationMode", "none"), ("plan", "inputIntent", "use-existing-dataset"),
                 ("plan", "sourceKinds", ["document", "structured"])]
        for area, key, value in cases:
            data = payload_dict()
            target = data["advanced"]["content"] if area == "content" else data["preparation"]
            target[key] = value
            with self.subTest(key=key), patch.object(Path, "open", side_effect=AssertionError("Unexpected I/O")):
                with self.assertRaises(OcrContractError):
                    task_ocr_sources(PrepareTrainingDatasetRequest.model_validate(data))

    def test_duplicate_source_identity_denies_the_entire_ordered_map(self):
        data = payload_dict()
        data["sourceInputs"].append(deepcopy(data["sourceInputs"][0]))
        data["sourceInputs"][1]["localPath"] = ROOT + r"\0002-source.pdf"
        data["runtime"]["ocrSources"]["sources"].append(deepcopy(data["runtime"]["ocrSources"]["sources"][0]))
        data["runtime"]["ocrSources"]["sources"][1]["fileName"] = "0002-source.pdf"
        with patch.object(Path, "open", side_effect=AssertionError("Unexpected I/O")), self.assertRaises(OcrContractError):
            task_ocr_sources(PrepareTrainingDatasetRequest.model_validate(data))

    def test_optional_pdf_media_metadata_does_not_override_the_binding(self):
        for media in (None, "application/pdf; charset=binary", "APPLICATION/PDF"):
            data = payload_dict(); data["sourceInputs"][0]["mediaType"] = media
            with self.subTest(media=media):
                self.assertEqual(task_ocr_sources(PrepareTrainingDatasetRequest.model_validate(data)).bindings[0].file_name,
                                 "0001-source.pdf")


if __name__ == "__main__":
    unittest.main()
