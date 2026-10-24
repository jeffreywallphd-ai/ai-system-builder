"""Complete-PDF adapter-neutral behavior; no engine, file, model or process."""
from dataclasses import replace
import unittest

from modules.adapters.runtime.python.worker.ocr.protocol import (
    OcrCancelled, OcrContractError, OcrDocument, OcrLine, OcrPage,
    OcrReadiness, OcrRequest, OcrUnavailable,
)
from modules.adapters.runtime.python.worker.ocr.recognition import recognize_pdf_document


class Provider:
    def __init__(self, count=3):
        self.count = count
        self.requests = []
        self.ready_calls = 0
        self.ready = OcrReadiness(True, "test", "1", "en-US")
        self.transform = lambda result, index: result
        self.on_ready = lambda: None

    def readiness(self, language, cancelled):
        self.ready_calls += 1
        self.on_ready()
        return self.ready

    def recognize(self, request, cancelled):
        self.requests.append(request)
        pages = tuple(OcrPage(number, 100, 50, (OcrLine("LINE", 1, 2, 70, 15),))
                      for number in request.pages)
        result = OcrDocument(request.source_sha256, self.count, "test", "1", request.language, pages)
        return self.transform(result, len(self.requests))


class CompletePdfRecognitionTests(unittest.TestCase):
    def recognize(self, provider, cancelled=lambda: False):
        return recognize_pdf_document(b"immutable synthetic PDF", "en-US", provider, cancelled)

    def test_complete_one_and_sixteen_pages_use_same_immutable_source(self):
        for count in (1, 16):
            with self.subTest(count=count):
                provider = Provider(count)
                result = self.recognize(provider)
                self.assertEqual(tuple(page.number for page in result.pages), tuple(range(1, count + 1)))
                self.assertEqual(provider.ready_calls, 1)
                self.assertEqual(len(provider.requests), 1 if count == 1 else 2)
                self.assertTrue(all(request.source is provider.requests[0].source for request in provider.requests))
                self.assertTrue(all(request.language == "en-US" for request in provider.requests))

    def test_seventeen_pages_deny_before_a_partial_subset_can_succeed(self):
        provider = Provider(17)
        with self.assertRaises(OcrContractError):
            self.recognize(provider)
        self.assertEqual([request.pages for request in provider.requests], [(1,)])

    def test_unavailable_and_wrong_readiness_never_recognize(self):
        for ready in (OcrReadiness(False, "test", "1", "en-US", "language-unavailable"),
                      OcrReadiness(True, "test", "1", "fr-FR"), None):
            provider = Provider()
            provider.ready = ready
            with self.subTest(ready=ready), self.assertRaises((OcrUnavailable, OcrContractError)):
                self.recognize(provider)
            self.assertEqual(provider.requests, [])

    def test_first_and_second_results_cannot_substitute_source_provider_or_language(self):
        for stage in (1, 2):
            for changes in ({"source_sha256": "0" * 64}, {"provider": "other"},
                            {"version": "2"}, {"language": "fr-FR"}):
                provider = Provider()
                provider.transform = lambda result, index: replace(result, **changes) if index == stage else result
                with self.subTest(stage=stage, field=tuple(changes)), self.assertRaises(OcrContractError):
                    self.recognize(provider)

    def test_ready_provider_version_is_the_authoritative_identity(self):
        for ready in (OcrReadiness(True, "other", "1", "en-US"),
                      OcrReadiness(True, "test", "2", "en-US")):
            provider = Provider()
            provider.ready = ready
            with self.subTest(ready=ready), self.assertRaises(OcrContractError):
                self.recognize(provider)

    def test_second_source_page_count_cannot_change(self):
        provider = Provider()
        provider.transform = lambda result, index: replace(result, source_page_count=4) if index == 2 else result
        with self.assertRaises(OcrContractError):
            self.recognize(provider)

    def test_missing_or_substituted_page_selection_is_refused(self):
        for stage in (1, 2):
            provider = Provider()
            def swap(result, index):
                if index != stage:
                    return result
                pages = (replace(result.pages[0], number=2),) if index == 1 else (result.pages[0],)
                return replace(result, pages=pages)
            provider.transform = swap
            with self.subTest(stage=stage), self.assertRaises(OcrContractError):
                self.recognize(provider)

    def test_global_line_and_character_bounds_apply_to_merged_results(self):
        for lines in ((OcrLine("x", 1, 2, 70, 15),) * 2049,
                      (OcrLine("x" * 125001, 1, 2, 70, 15),)):
            provider = Provider(2)
            provider.transform = lambda result, index: replace(result, pages=(replace(result.pages[0], lines=lines),))
            with self.subTest(line_count=len(lines)), self.assertRaises(OcrContractError):
                self.recognize(provider)
            self.assertEqual(len(provider.requests), 2)

    def test_neutral_encoded_byte_bound_covers_combined_supplementary_text(self):
        # Both parts are valid (<2MiB each,180k total scalar characters), but
        # their combined neutral ASCII-escaped validation form exceeds2MiB.
        provider = Provider(2)
        line = OcrLine("\U0001f642" * 90000, 1, 2, 70, 15)
        provider.transform = lambda result, index: replace(result, pages=(replace(result.pages[0], lines=(line,)),))
        with self.assertRaises(OcrContractError):
            self.recognize(provider)
        self.assertEqual(len(provider.requests), 2)
        request = OcrRequest(b"pdf", "application/pdf", (1,), "en-US")
        with self.assertRaises(OcrContractError):
            OcrDocument(request.source_sha256, 1, "test", "1", "en-US",
                        (OcrPage(1, 100, 50, (replace(line, text="\U0001f642" * 180000),)),))

    def test_blank_pages_are_not_dropped_or_filled(self):
        provider = Provider()
        provider.transform = lambda result, index: replace(result, pages=tuple(replace(page, lines=()) for page in result.pages))
        result = self.recognize(provider)
        self.assertEqual([page.number for page in result.pages], [1, 2, 3])
        self.assertTrue(all(not page.lines for page in result.pages))

    def test_cancellation_before_ready_after_ready_and_between_parts(self):
        provider = Provider()
        with self.assertRaises(OcrCancelled):
            self.recognize(provider, lambda: True)
        self.assertEqual(provider.ready_calls, 0)
        provider = Provider()
        state = [False]
        provider.on_ready = lambda: state.__setitem__(0, True)
        with self.assertRaises(OcrCancelled):
            self.recognize(provider, lambda: state[0])
        self.assertEqual(provider.requests, [])
        for stage in (1, 2):
            provider = Provider()
            state = [False]
            def stop(result, index):
                state[0] = index == stage
                return result
            provider.transform = stop
            with self.subTest(stage=stage), self.assertRaises(OcrCancelled):
                self.recognize(provider, lambda: state[0])
            self.assertEqual(len(provider.requests), stage)

    def test_invalid_input_and_callback_deny_before_provider_access(self):
        for source, language, callback in ((bytearray(b"pdf"), "en-US", lambda: False),
                                           (b"pdf", "../private", lambda: False),
                                           (b"pdf", "en-US", None)):
            provider = Provider()
            with self.subTest(language=language), self.assertRaises(OcrContractError):
                recognize_pdf_document(source, language, provider, callback)
            self.assertEqual(provider.ready_calls, 0)

    def test_supplier_errors_never_echo_private_details(self):
        marker = "PRIVATE-SOURCE-AND-PATH"
        for stage in ("ready", "recognize"):
            provider = Provider()
            def fail(*args):
                raise RuntimeError(marker)
            if stage == "ready":
                provider.readiness = fail
            else:
                provider.recognize = fail
            with self.subTest(stage=stage), self.assertRaises(OcrContractError) as caught:
                self.recognize(provider)
            self.assertNotIn(marker, str(caught.exception))
            self.assertTrue(caught.exception.__suppress_context__)


if __name__ == "__main__":
    unittest.main()
