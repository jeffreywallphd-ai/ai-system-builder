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
            ocr_language="en-US", **kwargs)

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
        content = normalizer._normalize_scanned_pdf(self.path, "en-US", lambda: False)
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
        result = normalizer.normalize_sources_to_markdown([self.source], DocumentNormalizationConfig(targetFormat="markdown"))
        self.assertEqual(result.documents[0].markdown, "")
        self.assertIsNone(result.documents[0].ocr_document)
        self.factory.assert_not_called()

    def test_mixed_non_pdf_sources_keep_standard_extraction_without_new_image_support(self):
        text = Path(self.temp.name) / "plain.txt"
        text.write_text("plain text", encoding="utf-8")
        image = Path(self.temp.name) / "image.png"
        image.write_bytes(b"not an enabled application image format")
        result = normalizer.normalize_sources_to_markdown(
            [DatasetPreparationSourceInput(artifactId="txt", localPath=str(text)),
             DatasetPreparationSourceInput(artifactId="png", localPath=str(image)), self.source],
            DocumentNormalizationConfig(targetFormat="markdown", unsupportedDocumentPolicy="skip"), ocr_language="en-US")
        self.assertEqual([doc.artifact_id for doc in result.documents], ["txt", "pdf"])
        self.assertEqual(result.documents[0].markdown, "plain text")
        self.assertIsNone(result.documents[0].ocr_document)
        self.assertEqual(result.skipped_document_count, 1)
        self.assertEqual(len(self.reader.requests), 2)

    def test_invalid_language_or_callback_denies_before_io(self):
        for kwargs in ({"ocr_language": "../private"}, {"cancelled": None}):
            with self.subTest(kwargs=tuple(kwargs)), patch.object(Path, "open") as opened:
                with self.assertRaises(OcrContractError):
                    normalizer.normalize_sources_to_markdown(
                        [self.source], DocumentNormalizationConfig(targetFormat="markdown"), **kwargs)
                opened.assert_not_called()
        self.factory.assert_not_called()

    def test_cancellation_before_open_is_not_skipped_under_either_policy(self):
        for policy in ("fail", "skip"):
            with self.subTest(policy=policy), patch.object(Path, "open") as opened:
                with self.assertRaises(OcrCancelled):
                    self.normalize(policy, cancelled=lambda: True)
                opened.assert_not_called()
        self.factory.assert_not_called()

    def test_cancellation_after_read_and_between_parts_never_returns_partial_success(self):
        original = normalizer._read_ocr_pdf
        state = [False]
        def after_read(*args):
            value = original(*args)
            state[0] = True
            return value
        with patch.object(normalizer, "_read_ocr_pdf", side_effect=after_read):
            with self.assertRaises(OcrCancelled):
                self.normalize(cancelled=lambda: state[0])
        self.assertEqual(self.reader.requests, [])
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

    def test_ocr_io_bounds_and_missing_sources_never_become_skips(self):
        for policy in ("fail", "skip"):
            for source in (str(self.path.parent / "missing.pdf"), str(self.path.parent)):
                with self.subTest(policy=policy, kind=Path(source).suffix):
                    self.source.localPath = source
                    with self.assertRaises(OcrContractError):
                        self.normalize(policy)
            self.source.localPath = str(self.path)
            with patch.object(normalizer, "MAX_SOURCE_BYTES", 4):
                with self.assertRaises(OcrContractError):
                    self.normalize(policy)
        self.factory.assert_not_called()

    def test_read_is_bounded_once_and_observed_source_change_denies(self):
        opened = self.path.open
        sizes = []
        class Stream:
            def __enter__(self):
                self.stream = opened("rb")
                return self
            def __exit__(self, *args):
                self.stream.close()
            def fileno(self):
                return self.stream.fileno()
            def read(self, size):
                sizes.append(size)
                return self.stream.read(size)
        with patch.object(Path, "open", return_value=Stream()):
            self.normalize()
        self.assertEqual(sizes, [normalizer.MAX_SOURCE_BYTES + 1])
        info = self.path.stat()
        before = SimpleNamespace(**{name: getattr(info, name) for name in
                                   ("st_mode", "st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")})
        if hasattr(info, "st_birthtime_ns"):
            before.st_birthtime_ns = info.st_birthtime_ns
        after = SimpleNamespace(**vars(before))
        after.st_size += 1
        with patch.object(normalizer.os, "fstat", side_effect=[before, after]):
            with self.assertRaises(OcrContractError):
                self.normalize()

    def test_distinct_windows_path_and_handle_ctime_does_not_hide_read_time_change(self):
        info = self.path.stat()
        before = SimpleNamespace(**{name: getattr(info, name) for name in
                                   ("st_mode", "st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")})
        if hasattr(info, "st_birthtime_ns"):
            before.st_birthtime_ns = info.st_birthtime_ns
        before.st_ctime_ns = info.st_ctime_ns + 1000
        after = SimpleNamespace(**vars(before))
        with patch.object(normalizer.os, "fstat", side_effect=[before, after]):
            self.assertEqual(len(self.normalize().documents), 1)
        after.st_ctime_ns += 1
        with patch.object(normalizer.os, "fstat", side_effect=[before, after]):
            with self.assertRaises(OcrContractError):
                self.normalize()

    def test_source_growth_and_private_io_errors_are_fixed_denials(self):
        with patch.object(Path, "open", side_effect=OSError("PRIVATE-FILE-PATH")):
            with self.assertRaises(OcrContractError) as caught:
                self.normalize()
        self.assertNotIn("PRIVATE-FILE-PATH", str(caught.exception))
        self.assertTrue(caught.exception.__suppress_context__)
        with self.path.open("rb") as real:
            with patch.object(Path, "open") as opened:
                stream = opened.return_value.__enter__.return_value
                stream.fileno.return_value = real.fileno()
                stream.read.return_value = b"x" * (self.path.stat().st_size + 1)
                # Growth observed in a bounded read cannot be accepted as the
                # stat-bound snapshot, even if metadata was restored.
                with self.assertRaises(OcrContractError):
                    self.normalize()
                stream.read.assert_called_once_with(normalizer.MAX_SOURCE_BYTES + 1)

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
