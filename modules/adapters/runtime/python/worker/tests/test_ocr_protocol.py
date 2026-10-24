"""Portable provider contract checks; not physical Windows recognition qualification."""
from dataclasses import FrozenInstanceError, replace
import unittest

from modules.adapters.runtime.python.worker.ocr.protocol import (OcrContractError, OcrDocument, OcrLine, OcrPage,
                      OcrReadiness, OcrRequest, check_result)


class OcrProtocolTests(unittest.TestCase):
    def setUp(self):
        self.request = OcrRequest(b"synthetic image bytes", "image/png", (1,), "en-US")
        self.ready = OcrReadiness(True, "test-provider", "v1", "en-US")
        self.line = OcrLine("SAFE LOCAL TEXT", 1, 2, 70, 15)
        self.page = OcrPage(1, 100, 50, (self.line,))
        self.result = OcrDocument(self.request.source_sha256, 1, "test-provider", "v1", "en-US", (self.page,))

    def test_preserves_exact_text_geometry_and_source(self):
        self.assertIs(check_result(self.request, self.result, self.ready), self.result)
        self.assertEqual(self.result.pages[0].lines[0].text, "SAFE LOCAL TEXT")
        self.assertEqual(self.result.pages[0].lines[0].left, 1)

    def test_inputs_and_results_are_immutable_and_content_not_in_repr(self):
        with self.assertRaises(FrozenInstanceError):
            self.line.text = "changed"
        self.assertNotIn("SAFE LOCAL TEXT", repr(self.result))
        self.assertNotIn("synthetic image bytes", repr(self.request))
        with self.assertRaises(OcrContractError):
            replace(self.request, source=bytearray(self.request.source))

    def test_rejects_empty_oversized_and_unrecognized_input(self):
        for source in (b"", b"x" * (16 * 1024**2 + 1)):
            with self.subTest(size=len(source)), self.assertRaises(OcrContractError):
                replace(self.request, source=source)
        with self.assertRaises(OcrContractError):
            replace(self.request, media_type="text/html")

    def test_rejects_non_finite_outside_or_boolean_geometry(self):
        for width in (True, float("nan"), float("inf"), -1, 0, 10**1000):
            with self.subTest(kind=type(width).__name__), self.assertRaises(OcrContractError):
                replace(self.line, width=width)
        with self.assertRaises(OcrContractError):
            replace(self.page, lines=(replace(self.line, left=90),))

    def test_rejects_pixel_bombs_before_provider_use(self):
        with self.assertRaises(OcrContractError):
            replace(self.page, width=4096, height=4096)
        with self.assertRaises(OcrContractError):
            replace(self.page, width=4097)

    def test_rejects_ambiguous_page_requests(self):
        for pages in ((), (True,), (0,), (2, 1), (1, 1), tuple(range(1, 18)), (5001,)):
            with self.subTest(pages=pages), self.assertRaises(OcrContractError):
                OcrRequest(b"pdf", "application/pdf", pages, "en-US")
        with self.assertRaises(OcrContractError):
            replace(self.request, pages=(2,))

    def test_retains_sparse_original_pdf_page_identity(self):
        request = OcrRequest(b"pdf", "application/pdf", (2, 7), "en-US")
        result = replace(self.result, source_sha256=request.source_sha256,
                         source_page_count=9, pages=(replace(self.page, number=2), replace(self.page, number=7)))
        self.assertIs(check_result(request, result, self.ready), result)
        with self.assertRaises(OcrContractError):
            replace(result, pages=tuple(reversed(result.pages)))

    def test_refuses_swapped_source_provider_language_and_pages(self):
        for result in (replace(self.result, source_sha256="0" * 64),
                       replace(self.result, provider="other-provider"),
                       replace(self.result, version="v2"),
                       replace(self.result, language="fr-FR"),
                       replace(self.result, source_page_count=2),
                       replace(self.result, source_page_count=2, pages=(replace(self.page, number=2),))):
            with self.subTest(provider=result.provider), self.assertRaises(OcrContractError):
                check_result(self.request, result, self.ready)

    def test_failure_does_not_echo_recognized_content(self):
        marker = "private-recognized-source-marker"
        for value in (marker + "\x00", marker + "\n", marker + "\x7f", marker + "\ud800", "   "):
            with self.subTest(length=len(value)), self.assertRaises(OcrContractError) as error:
                replace(self.line, text=value)
            self.assertNotIn(marker, str(error.exception))

    def test_aggregate_lines_and_text_are_bounded_across_pages(self):
        large_page = replace(self.page, lines=(self.line,) * 2049)
        with self.assertRaises(OcrContractError):
            replace(self.result, source_page_count=2,
                    pages=(large_page, replace(large_page, number=2)))
        text_page = replace(self.page, lines=(replace(self.line, text="x" * 125_001),))
        with self.assertRaises(OcrContractError):
            replace(self.result, source_page_count=2,
                    pages=(text_page, replace(text_page, number=2)))

    def test_empty_recognition_is_retained_without_fabricating_text(self):
        empty = replace(self.result, pages=(replace(self.page, lines=()),))
        self.assertIs(check_result(self.request, empty, self.ready), empty)
        self.assertEqual(empty.pages[0].lines, ())

    def test_readiness_is_explicit_and_no_confidence_is_fabricated(self):
        unavailable = OcrReadiness(False, "none", "unavailable", "en-US", "helper-unavailable")
        with self.assertRaises(OcrContractError):
            check_result(self.request, self.result, unavailable)
        with self.assertRaises(OcrContractError):
            replace(unavailable, available=True)
        self.assertFalse(hasattr(self.line, "confidence"))
        self.assertFalse(hasattr(self.result, "accuracy"))


if __name__ == "__main__":
    unittest.main()
