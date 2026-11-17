"""Strict finite private OCR frames; this module never launches a provider."""
from __future__ import annotations
import base64
import json
import struct
from .protocol import (
    MAX_LINES, MAX_RECOGNIZED_PAGES, MAX_RESULT_BYTES, MAX_TEXT_CHARACTERS,
    OcrContractError, OcrDocument, OcrLine, OcrPage,
    OcrReadiness, OcrRequest,
)

MAX_REQUEST_BYTES = 23_000_000


def _need(value: bool) -> None:
    if not value:
        raise OcrContractError("Text recognition returned an invalid bounded result.")


def _keys(value: object, names: tuple[str, ...]) -> dict:
    _need(type(value) is dict and set(value) == set(names))
    return value


def _frame(value: dict) -> bytes:
    encoded = json.dumps(value, ensure_ascii=True, allow_nan=False,
                         separators=(",", ":")).encode("ascii")
    _need(0 < len(encoded) <= MAX_REQUEST_BYTES)
    return struct.pack("<I", len(encoded)) + encoded


def readiness_frame(language: str) -> bytes:
    OcrReadiness(False, "windows", "1", language, "qualification-pending")
    return _frame({"version": 1, "operation": "readiness", "language": language})


def request_frame(request: OcrRequest) -> bytes:
    _need(type(request) is OcrRequest)
    return _frame({"version": 1, "operation": "recognize",
                   "language": request.language, "mediaType": request.media_type,
                   "source": base64.b64encode(request.source).decode("ascii"),
                   "pages": request.pages})


def _unique(pairs: list[tuple[str, object]]) -> dict:
    value = {}
    for key, item in pairs:
        _need(key not in value)
        value[key] = item
    return value


def _invalid_constant(value: str) -> None:
    raise OcrContractError("Text recognition returned an invalid bounded result.")


def parse_response(frame: bytes) -> OcrReadiness | OcrDocument:
    try:
        _need(type(frame) is bytes and 4 < len(frame) <= MAX_RESULT_BYTES + 4)
        length, = struct.unpack("<I", frame[:4])
        _need(length == len(frame) - 4)
        value = json.loads(frame[4:].decode("utf-8", errors="strict"),
                           object_pairs_hook=_unique, parse_constant=_invalid_constant)
        _need(type(value) is dict and type(value.get("version")) is int and value["version"] == 1)
        status = value.get("status")
        _need(type(status) is str and status in ("ready", "unavailable", "recognized"))
        identity = ("version", "status", "provider", "providerVersion", "language")
        if status in ("ready", "unavailable"):
            _keys(value, identity + (("reason",) if status == "unavailable" else ()))
            return OcrReadiness(status == "ready", value["provider"],
                                value["providerVersion"], value["language"], value.get("reason"))
        _keys(value, identity + ("sourceSha256", "sourcePageCount", "pages"))
        _need(type(value["pages"]) is list and 1 <= len(value["pages"]) <= MAX_RECOGNIZED_PAGES)
        pages = []
        line_count = text_count = 0
        for page in value["pages"]:
            _keys(page, ("number", "width", "height", "lines"))
            _need(type(page["lines"]) is list)
            line_count += len(page["lines"])
            _need(line_count <= MAX_LINES)
            lines = []
            for line in page["lines"]:
                _keys(line, ("text", "left", "top", "width", "height"))
                _need(type(line["text"]) is str)
                text_count += len(line["text"])
                _need(text_count <= MAX_TEXT_CHARACTERS)
                lines.append(OcrLine(**line))
            pages.append(OcrPage(page["number"], page["width"], page["height"], tuple(lines)))
        return OcrDocument(value["sourceSha256"], value["sourcePageCount"],
                           value["provider"], value["providerVersion"],
                           value["language"], tuple(pages))
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError, struct.error):
        raise OcrContractError("Text recognition returned an invalid bounded result.") from None
