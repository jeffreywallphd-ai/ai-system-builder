"""Portable provider orchestration tests; no Windows or document engine runs."""
import hashlib
import json
import struct
import unittest
from unittest.mock import patch
from modules.adapters.runtime.python.worker.ocr import provider as p
from modules.adapters.runtime.python.worker.ocr.protocol import (
    OcrCancelled, OcrContractError, OcrDocument, OcrReadiness, OcrRequest,
)


def frame(value):
    raw = json.dumps(value, separators=(",", ":")).encode()
    return struct.pack("<I", len(raw)) + raw


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.provider = p.local_provider()
        self.request = OcrRequest(b"authorized immutable source", "application/pdf", (2, 5), "en-US")
        self.ready = {"version": 1, "status": "ready", "provider": "windows",
                      "providerVersion": "1", "language": "en-US"}
        self.result = {**self.ready, "status": "recognized",
                       "sourceSha256": self.request.source_sha256, "sourcePageCount": 5,
                       "pages": [{"number": n, "width": 800, "height": 600,
                                  "lines": [{"text": "Synthetic private text", "left": 2,
                                             "top": 3, "width": 100, "height": 30}]}
                                 for n in (2, 5)]}

    def test_construction_does_not_probe_engine(self):
        with patch.object(p, "exchange") as transport:
            self.assertIsInstance(p.local_provider(), p.WindowsOcrProvider)
        transport.assert_not_called()

    def test_available_and_request_exactly_serialized_and_bound(self):
        with patch.object(p.os, "name", "nt"), patch.object(p, "exchange", side_effect=[
                frame(self.ready), frame(self.result)]) as transport:
            result = self.provider.recognize(self.request, lambda: False)
        self.assertIs(type(result), OcrDocument)
        self.assertEqual([page.number for page in result.pages], [2, 5])
        self.assertEqual(result.source_sha256, hashlib.sha256(self.request.source).hexdigest())
        self.assertNotIn("Synthetic", repr(result))
        self.assertEqual(json.loads(transport.call_args_list[0].args[0][4:])["operation"], "readiness")
        sent = json.loads(transport.call_args_list[1].args[0][4:])
        self.assertEqual(sent["pages"], [2, 5])
        self.assertEqual(sent["language"], "en-US")

    def test_unsupported_platform_is_explicit_and_does_no_io(self):
        with patch.object(p.os, "name", "posix"), patch.object(p, "exchange") as transport:
            result = self.provider.readiness("en-US", lambda: False)
            self.assertEqual(result.reason, "unsupported-platform")
            with self.assertRaises(p.OcrUnavailable):
                self.provider.recognize(self.request, lambda: False)
        transport.assert_not_called()

    def test_invalid_inputs_fail_before_transport_even_when_unsupported(self):
        with patch.object(p.os, "name", "posix"), patch.object(p, "exchange") as transport:
            for language in ("", "../en-US", None, True, "en-US" * 20):
                with self.assertRaises(OcrContractError):
                    self.provider.readiness(language, lambda: False)
            with self.assertRaises(OcrContractError):
                self.provider.readiness("en-US", None)
            with self.assertRaises(OcrContractError):
                self.provider.recognize(object(), lambda: False)
        transport.assert_not_called()

    def test_transport_failure_is_explicit_unavailable_without_diagnostics(self):
        with patch.object(p.os, "name", "nt"), patch.object(p, "exchange", side_effect=p.OcrProcessError(
                "Private source path or supplier exception")):
            ready = self.provider.readiness("en-US", lambda: False)
            self.assertEqual(ready.reason, "helper-unavailable")
            with self.assertRaises(p.OcrUnavailable) as error:
                self.provider.recognize(self.request, lambda: False)
        self.assertNotIn("Private", str(error.exception))

    def test_missing_installed_language_never_starts_recognition(self):
        response = {**self.ready, "status": "unavailable", "reason": "language-unavailable"}
        with patch.object(p.os, "name", "nt"), patch.object(p, "exchange", return_value=frame(response)) as transport:
            self.assertEqual(self.provider.readiness("en-US", lambda: False).reason, "language-unavailable")
            with self.assertRaises(p.OcrUnavailable):
                self.provider.recognize(self.request, lambda: False)
        self.assertEqual(transport.call_count, 2)  # Readiness only, once per call.

    def test_wrong_readiness_identity_or_shape_is_not_silently_unavailable(self):
        for change in ({"provider": "other"}, {"providerVersion": "2"}, {"language": "en-GB"},
                       {"status": "unavailable", "reason": "qualification-pending"},
                       self.result):
            value = {**self.ready, **change}
            with self.subTest(change=change), patch.object(p.os, "name", "nt"), \
                    patch.object(p, "exchange", return_value=frame(value)), self.assertRaises(OcrContractError):
                self.provider.readiness("en-US", lambda: False)

    def test_substituted_source_pages_provider_version_or_language_are_rejected(self):
        for change in ({"sourceSha256": "0" * 64}, {"provider": "other"}, {"providerVersion": "2"},
                       {"language": "en-GB"}, {"pages": self.result["pages"][:1]}):
            with self.subTest(change=change), patch.object(p.os, "name", "nt"), patch.object(p, "exchange", side_effect=[
                    frame(self.ready), frame({**self.result, **change})]), self.assertRaises(OcrContractError):
                self.provider.recognize(self.request, lambda: False)

    def test_unavailable_or_malformed_recognition_is_never_a_document(self):
        for value in (frame(self.ready), b"bad frame", frame({**self.ready, "status": "unavailable",
                                                           "reason": "language-unavailable"})):
            with patch.object(p.os, "name", "nt"), patch.object(p, "exchange", side_effect=[
                    frame(self.ready), value]), self.assertRaises(OcrContractError):
                self.provider.recognize(self.request, lambda: False)

    def test_readiness_is_not_cached_between_documents(self):
        absent = {**self.ready, "status": "unavailable", "reason": "language-unavailable"}
        with patch.object(p.os, "name", "nt"), patch.object(p, "exchange", side_effect=[
                frame(self.ready), frame(self.result), frame(absent)]) as transport:
            self.provider.recognize(self.request, lambda: False)
            with self.assertRaises(p.OcrUnavailable):
                self.provider.recognize(self.request, lambda: False)
        self.assertEqual(transport.call_count, 3)

    def test_cancellation_and_recognition_transport_failure_remain_failures(self):
        with patch.object(p.os, "name", "nt"), patch.object(p, "exchange", side_effect=OcrCancelled("cancelled")):
            with self.assertRaises(OcrCancelled):
                self.provider.readiness("en-US", lambda: True)
        with patch.object(p.os, "name", "nt"), patch.object(p, "exchange", side_effect=[
                frame(self.ready), p.OcrProcessError("Local text recognition did not finish safely.")]):
            with self.assertRaises(p.OcrProcessError):
                self.provider.recognize(self.request, lambda: False)


if __name__ == "__main__":
    unittest.main()
