"""Portable framing tests; no native helper, model or provider is executed."""
import json
import struct
import unittest
from modules.adapters.runtime.python.worker.ocr.protocol import (
    OcrContractError, OcrDocument, OcrReadiness, OcrRequest,
)
from modules.adapters.runtime.python.worker.ocr import wire


def framed(value):
    data = json.dumps(value, separators=(",", ":")).encode()
    return struct.pack("<I", len(data)) + data


class WireTests(unittest.TestCase):
    def identity(self, status="ready"):
        return {"version": 1, "status": status, "provider": "windows",
                "providerVersion": "1", "language": "en-US"}

    def document(self):
        return {**self.identity("recognized"), "sourceSha256": "a" * 64,
                "sourcePageCount": 2, "pages": [{"number": 2, "width": 600,
                "height": 800, "lines": [{"text": "Private synthetic text",
                "left": 12, "top": 20, "width": 200, "height": 40}]}]}

    def test_readiness_and_exact_bounded_request(self):
        header = wire.readiness_frame("en-US")
        self.assertEqual(struct.unpack("<I", header[:4])[0], len(header) - 4)
        request = OcrRequest(b"original bytes", "application/pdf", (2, 5), "en-US")
        self.assertEqual(json.loads(wire.request_frame(request)[4:]), {
            "version": 1, "operation": "recognize", "language": "en-US",
            "mediaType": "application/pdf", "source": "b3JpZ2luYWwgYnl0ZXM=", "pages": [2, 5]})

    def test_readiness_available_and_unavailable(self):
        self.assertEqual(wire.parse_response(framed(self.identity())),
                         OcrReadiness(True, "windows", "1", "en-US"))
        value = {**self.identity("unavailable"), "reason": "language-unavailable"}
        self.assertFalse(wire.parse_response(framed(value)).available)

    def test_source_page_geometry_and_text_are_retained(self):
        result = wire.parse_response(framed(self.document()))
        self.assertIs(type(result), OcrDocument)
        self.assertEqual(result.pages[0].number, 2)
        self.assertEqual(result.pages[0].lines[0].text, "Private synthetic text")
        self.assertEqual(result.pages[0].lines[0].left, 12)
        self.assertNotIn("Private", repr(result))

    def test_bad_frame_size_type_trailing_and_unicode(self):
        valid = framed(self.identity())
        for value in (b"", b"\0" * 4, valid[:-1], valid + b"x", bytearray(valid),
                      struct.pack("<I", 1) + b"\xff", b"\xff" * (2097152 + 5)):
            with self.subTest(size=len(value)), self.assertRaises(OcrContractError):
                wire.parse_response(value)

    def test_duplicate_keys_deep_json_and_constants_are_refused(self):
        for data in (b'{"version":1,"version":1}', b'{"x":NaN}',
                     b'{"x":Infinity}', b'[' * 1100 + b']' * 1100):
            with self.assertRaises(OcrContractError):
                wire.parse_response(struct.pack("<I", len(data)) + data)

    def test_unknown_or_missing_keys_and_boolean_version_are_refused(self):
        values = [{**self.identity(), "extra": "untrusted"}, self.identity("other"),
                  {**self.identity(), "version": True}, {"version": 1},
                  {**self.identity("recognized"), "reason": "untrusted"}]
        for value in values:
            with self.assertRaises(OcrContractError): wire.parse_response(framed(value))

    def test_invalid_nested_records_never_expose_content(self):
        for field, value in (("left", float("nan")), ("text", "PRIVATE\nLEAK"),
                             ("width", True), ("right", 200)):
            doc = self.document(); doc["pages"][0]["lines"][0][field] = value
            with self.assertRaises(OcrContractError) as error:
                wire.parse_response(framed(doc))
            self.assertNotIn("PRIVATE", str(error.exception))
            self.assertNotIn("synthetic", str(error.exception))

    def test_aggregate_text_and_pixel_limits_still_apply(self):
        doc = self.document(); doc["pages"][0]["width"] = 4096; doc["pages"][0]["height"] = 4096
        with self.assertRaises(OcrContractError): wire.parse_response(framed(doc))
        doc = self.document(); doc["pages"][0]["lines"][0]["text"] = "x" * 250001
        with self.assertRaises(OcrContractError): wire.parse_response(framed(doc))

    def test_aggregate_limits_cross_page_boundaries(self):
        doc = self.document(); page = doc["pages"][0]
        line = {**page["lines"][0], "text": "x"}
        page["number"] = 1; page["lines"] = [line] * 4096
        doc["pages"].append({**page, "number": 2, "lines": [line]})
        with self.assertRaises(OcrContractError): wire.parse_response(framed(doc))
        doc = self.document(); page = doc["pages"][0]; page["number"] = 1
        page["lines"][0]["text"] = "x" * 125001
        doc["pages"].append({**page, "number": 2})
        with self.assertRaises(OcrContractError): wire.parse_response(framed(doc))

    def test_empty_recognition_is_retained_without_fake_confidence(self):
        doc = self.document(); doc["pages"][0]["lines"] = []
        result = wire.parse_response(framed(doc))
        self.assertEqual(result.pages[0].lines, ())
        self.assertFalse(hasattr(result, "confidence"))

    def test_surrogates_and_unknown_nested_fields_are_refused(self):
        doc = self.document(); doc["pages"][0]["lines"][0]["text"] = "private\ud800"
        with self.assertRaises(OcrContractError): wire.parse_response(framed(doc))
        doc = self.document(); doc["pages"][0]["confidence"] = 1.0
        with self.assertRaises(OcrContractError): wire.parse_response(framed(doc))

    def test_page_and_line_containers_have_exact_types(self):
        for name, value in (("pages", {}), ("sourcePageCount", True), ("sourceSha256", 4)):
            doc = self.document(); doc[name] = value
            with self.assertRaises(OcrContractError): wire.parse_response(framed(doc))
        for value in (None, {}, "private"):
            doc = self.document(); doc["pages"][0]["lines"] = value
            with self.assertRaises(OcrContractError): wire.parse_response(framed(doc))

    def test_wrong_request_type_and_language_cannot_reach_framing(self):
        for value in (None, {}, b"private"):
            with self.assertRaises(OcrContractError): wire.request_frame(value)
        for language in ("../private", "en_US", "en\nUS", None):
            with self.assertRaises(OcrContractError): wire.readiness_frame(language)

    def test_maximum_authorized_source_fits_fixed_frame(self):
        source = b"s" * (16 * 1024**2)
        request = OcrRequest(source, "image/png", (1,), "en-US")
        encoded = wire.request_frame(request)
        self.assertLessEqual(len(encoded) - 4, wire.MAX_REQUEST_BYTES)
        self.assertEqual(struct.unpack("<I", encoded[:4])[0], len(encoded) - 4)


if __name__ == "__main__": unittest.main()
