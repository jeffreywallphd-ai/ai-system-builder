"""Synthetic scanned-PDF normalization; no native engine or model execution."""
from dataclasses import replace
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from pypdf import PdfWriter

from modules.adapters.runtime.python.worker.models import DatasetPreparationSourceInput, DocumentNormalizationConfig
from modules.adapters.runtime.python.worker.ocr.protocol import (
    OcrCancelled, OcrContractError, OcrDocument, OcrLine, OcrPage, OcrReadiness, OcrUnavailable,
)
from modules.adapters.runtime.python.worker.ocr import provider as composition
from modules.adapters.runtime.python.worker.ocr import source_snapshot
from modules.adapters.runtime.python.worker.ocr.source_snapshot import OcrSourceBinding
from modules.adapters.runtime.python.worker.ocr.task_sources import OcrTaskSources
from modules.adapters.runtime.python.worker.tasks import document_normalization as normalizer


class Provider:
    def __init__(self, pages):
        self.pages = pages
        self.requests = []
        self.after = lambda: None

    def readiness(self, language, cancelled):
        return OcrReadiness(True, "test", "1", language)

    def recognize(self, request, cancelled):
        self.requests.append(request)
        result = OcrDocument(request.source_sha256, len(self.pages), "test", "1", request.language,
                             tuple(self.pages[number - 1] for number in request.pages))
        self.after()
        return result


class OcrNormalizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "synthetic.pdf"
        self.path.write_bytes(b"immutable synthetic staged PDF")
        self.source = DatasetPreparationSourceInput(artifactId="pdf", localPath=str(self.path),
                                                    originalName="synthetic.pdf", mediaType="application/pdf")
        root = r"C:\synthetic\ai-system-builder-runtime-ABC123"
        self.source.localPath = root + r"\0001-source.pdf"
        self.binding = OcrSourceBinding(root, "0001-source.pdf", "pdf", self.path.stat().st_size,
                                       hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.ocr = OcrTaskSources("en-US", root, (self.binding,))
        capture_patch = patch.object(source_snapshot, "capture_source", return_value=self.path.read_bytes())
        self.capture = capture_patch.start()
        self.addCleanup(capture_patch.stop)
        self.reader = Provider((OcrPage(1, 100, 50, ()),
                                OcrPage(2, 100, 50, (OcrLine("  alpha\t\U0001f642  ", 1, 2, 70, 15),
                                                     OcrLine("second", 2, 20, 60, 10))),
                                OcrPage(3, 100, 50, ())))
        factory_patch = patch.object(composition, "local_provider", return_value=self.reader)
        self.factory = factory_patch.start()
        self.addCleanup(factory_patch.stop)

    def normalize(self, policy="skip", **kwargs):
        return normalizer.normalize_sources_to_markdown(
            [self.source], DocumentNormalizationConfig(targetFormat="markdown", unsupportedDocumentPolicy=policy),
            ocr=self.ocr, **kwargs)

    def test_exact_line_text_offsets_original_blank_pages_geometry_and_no_confidence(self):
        result = self.normalize()
        doc = result.documents[0]
        self.assertEqual(doc.markdown, "  alpha\t\U0001f642  \nsecond")
        self.assertEqual(doc.ocr_document.source_sha256, hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual([page.number for page in doc.ocr_document.pages], [1, 2, 3])
        self.assertEqual([region.page_number for region in doc.regions], [2, 2])
        for line, region in zip(doc.ocr_document.pages[1].lines, doc.regions, strict=True):
            self.assertEqual(doc.markdown[region.start:region.end], line.text)
            self.assertIsNone(region.confidence)
            self.assertEqual(region.kind, "line")
            self.assertGreater(line.width, 0)
            self.assertLessEqual(line.top + line.height, doc.ocr_document.pages[1].height)
        self.assertEqual(result.skipped_document_count, 0)
        self.assertEqual(result.warnings, [])
        for value in (repr(doc), repr(result)):
            self.assertNotIn("alpha", value)
            self.assertNotIn(str(self.path), value)
        content = normalizer._normalize_scanned_pdf(self.path.read_bytes(), "en-US", lambda: False)
        self.assertNotIn("alpha", repr(content))

    def test_all_blank_pages_remain_empty_with_zero_text_hygiene(self):
        self.reader.pages = tuple(replace(page, lines=()) for page in self.reader.pages)
        doc = self.normalize().documents[0]
        self.assertEqual(doc.markdown, "")
        self.assertEqual(doc.regions, [])
        self.assertEqual(doc.extraction_quality, 0.0)
        self.assertEqual(len(doc.ocr_document.pages), 3)

    def test_missing_ocr_option_uses_standard_pdf_without_provider(self):
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        with self.path.open("wb") as stream:
            writer.write(stream)
        self.source.localPath = str(self.path)
        result = normalizer.normalize_sources_to_markdown([self.source], DocumentNormalizationConfig(targetFormat="markdown"))
        self.assertEqual(result.documents[0].markdown, "")
        self.assertIsNone(result.documents[0].ocr_document)
        self.factory.assert_not_called()

    def test_mixed_or_changed_source_list_denies_before_first_capture(self):
        for source in (self.source.model_copy(update={"artifactId": "other"}),
                       self.source.model_copy(update={"localPath": "C:\\other.pdf"}),
                       self.source.model_copy(update={"mediaType": "text/plain"})):
            with self.subTest(source=source.artifactId), self.assertRaises(OcrContractError):
                normalizer.normalize_sources_to_markdown([source], DocumentNormalizationConfig(targetFormat="markdown"), ocr=self.ocr)
        self.capture.assert_not_called()
        self.factory.assert_not_called()

    def test_invalid_map_or_callback_denies_before_capture(self):
        for kwargs in ({"ocr": {}}, {"cancelled": None}, {"cancelled": lambda: "yes"}):
            with self.subTest(keys=tuple(kwargs)), self.assertRaises(OcrContractError):
                normalizer.normalize_sources_to_markdown([self.source], DocumentNormalizationConfig(targetFormat="markdown"), **kwargs)
        self.capture.assert_not_called()
        self.factory.assert_not_called()

    def test_cancellation_before_open_is_not_skipped_under_either_policy(self):
        for policy in ("fail", "skip"):
            with self.subTest(policy=policy), patch.object(Path, "open") as opened:
                with self.assertRaises(OcrCancelled):
                    self.normalize(policy, cancelled=lambda: True)
                opened.assert_not_called()
        self.factory.assert_not_called()

    def test_cancellation_after_capture_and_between_parts_has_no_partial_success(self):
        state = [False]
        def after_capture(*args, **kwargs):
            state[0] = True
            return self.path.read_bytes()
        self.capture.side_effect = after_capture
        with self.assertRaises(OcrCancelled):
            self.normalize(cancelled=lambda: state[0])
        self.factory.assert_not_called()
        self.capture.side_effect = None
        state[0] = False
        self.reader.after = lambda: state.__setitem__(0, True)
        with self.assertRaises(OcrCancelled):
            self.normalize(cancelled=lambda: state[0])
        self.assertEqual(len(self.reader.requests), 1)

    def test_cancellation_between_sources_and_before_final_return(self):
        for stop_after in (1, 2):
            with self.subTest(stop_after=stop_after):
                calls = []
                original = normalizer._normalize_source_to_markdown
                def extract(source):
                    calls.append(source)
                    return original(source)
                path = Path(self.temp.name) / "plain.txt"
                path.write_text("plain", encoding="utf-8")
                source = DatasetPreparationSourceInput(artifactId="text", localPath=str(path))
                with patch.object(normalizer, "_normalize_source_to_markdown", side_effect=extract):
                    with self.assertRaises(OcrCancelled):
                        normalizer.normalize_sources_to_markdown(
                            [source, source], DocumentNormalizationConfig(targetFormat="markdown", unsupportedDocumentPolicy="skip"),
                            cancelled=lambda: len(calls) >= stop_after)
                self.assertEqual(len(calls), stop_after)

    def test_native_capture_denials_have_no_fallback_or_skip(self):
        for policy in ("fail", "skip"):
            with self.subTest(policy=policy):
                self.capture.side_effect = OSError("PRIVATE-SOURCE-PATH")
                with self.assertRaises(OcrContractError) as caught:
                    self.normalize(policy)
                self.assertNotIn("PRIVATE", str(caught.exception))
                self.assertTrue(caught.exception.__suppress_context__)
        self.factory.assert_not_called()

    def test_exact_binding_selects_capture_despite_a_false_display_suffix(self):
        self.source.originalName = "private-display.csv"
        with patch.object(normalizer, "_normalize_source_to_markdown", side_effect=AssertionError("No fallback")):
            self.assertEqual(len(self.normalize().documents), 1)
        call = self.capture.call_args
        self.assertEqual(call.args, (self.binding,))
        self.assertEqual({k: v for k, v in call.kwargs.items() if k != "cancelled"},
                         {"stage_root": self.ocr.stage_root, "local_path": self.source.localPath, "artifact_id": "pdf"})

    def test_absent_or_parameterized_pdf_mime_does_not_change_bound_capture(self):
        for mime in (None, "application/pdf; charset=binary"):
            with self.subTest(mime=mime):
                self.source.mediaType = mime
                self.assertEqual(len(self.normalize().documents), 1)
        self.assertEqual(self.capture.call_count, 2)

    def test_capture_cancellation_is_sanitized_and_cannot_be_skipped(self):
        self.capture.side_effect = OcrCancelled("PRIVATE-DIAGNOSTIC")
        with self.assertRaises(OcrCancelled) as caught:
            self.normalize()
        self.assertNotIn("PRIVATE", str(caught.exception))
        self.factory.assert_not_called()

    def test_unavailable_and_supplier_failures_propagate_under_skip(self):
        for error in (OcrUnavailable("PRIVATE-PROVIDER-DETAIL"), RuntimeError("PRIVATE-PROVIDER-DETAIL")):
            with self.subTest(kind=type(error).__name__):
                with patch.object(self.reader, "recognize", side_effect=error):
                    with self.assertRaises((OcrUnavailable, OcrContractError)) as caught:
                        self.normalize()
                    self.assertNotIn("PRIVATE-PROVIDER-DETAIL", str(caught.exception))

    def test_cold_standard_import_and_normalization_do_not_import_supplier(self):
        code = """
import sys,tempfile
from pathlib import Path
from modules.adapters.runtime.python.worker.models import DatasetPreparationSourceInput,DocumentNormalizationConfig
from modules.adapters.runtime.python.worker.tasks.document_normalization import normalize_sources_to_markdown
assert 'modules.adapters.runtime.python.worker.ocr.provider' not in sys.modules
with tempfile.TemporaryDirectory() as folder:
    p=Path(folder)/'plain.txt';p.write_text('plain',encoding='utf-8')
    result=normalize_sources_to_markdown([DatasetPreparationSourceInput(artifactId='text',localPath=str(p))],DocumentNormalizationConfig(targetFormat="markdown"))
    assert result.documents[0].markdown=='plain'
assert 'modules.adapters.runtime.python.worker.ocr.provider' not in sys.modules
assert 'modules.adapters.runtime.python.worker.ocr.windows_process' not in sys.modules
"""
        result = subprocess.run([sys.executable, "-B", "-c", code], capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, "Cold Standard normalization must not load an OCR supplier.")


if __name__ == "__main__":
    unittest.main()
