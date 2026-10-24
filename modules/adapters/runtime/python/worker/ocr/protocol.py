"""Provider-neutral, bounded OCR results inside the managed runtime adapter.

This boundary does not install, launch or advertise an OCR provider.
Recognized content is data, never a diagnostic or an instruction to execute.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import math
import re
import unicodedata
from typing import Callable, Protocol

MAX_SOURCE_BYTES = 16 * 1024**2
MAX_RECOGNIZED_PAGES = 16
MAX_SOURCE_PAGES = 5_000
MAX_DIMENSION = 4_096
MAX_PAGE_PIXELS = 4 * 1024**2
MAX_LINES = 4_096
MAX_TEXT_CHARACTERS = 250_000
MAX_RESULT_BYTES = 2 * 1024**2


class OcrContractError(ValueError):
    """A fixed public error; never include provider output or source text."""


class OcrCancelled(RuntimeError):
    pass


def _require(value: bool) -> None:
    if not value:
        raise OcrContractError("Text recognition returned an invalid bounded result.")


def _integer(value: object, minimum: int, maximum: int) -> None:
    _require(type(value) is int and minimum <= value <= maximum)


def _number(value: object) -> None:
    _require(type(value) in (int, float) and 0 <= value <= MAX_DIMENSION and
             math.isfinite(value))


def _identifier(value: object) -> None:
    _require(type(value) is str and re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,63}", value) is not None)


def _language(value: object) -> None:
    _require(type(value) is str and len(value) <= 35 and
             re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}", value) is not None)


@dataclass(frozen=True)
class OcrReadiness:
    available: bool
    provider: str
    version: str
    language: str
    reason: str | None = None

    def __post_init__(self) -> None:
        _require(type(self.available) is bool)
        _identifier(self.provider)
        _identifier(self.version)
        _language(self.language)
        _require(self.reason in (None, "unsupported-platform", "helper-unavailable",
                                "language-unavailable", "qualification-pending"))
        _require(self.available == (self.reason is None))


@dataclass(frozen=True)
class OcrLine:
    text: str = field(repr=False)
    left: float
    top: float
    width: float
    height: float

    def __post_init__(self) -> None:
        _require(type(self.text) is str and 0 < len(self.text) <= MAX_TEXT_CHARACTERS)
        _require(bool(self.text.strip()) and all(
            (unicodedata.category(character) not in ("Cc", "Cs") or character == "\t")
            for character in self.text
        ))
        for value in (self.left, self.top, self.width, self.height):
            _number(value)
        _require(self.width > 0 and self.height > 0)


@dataclass(frozen=True)
class OcrPage:
    number: int
    width: int
    height: int
    lines: tuple[OcrLine, ...]

    def __post_init__(self) -> None:
        _integer(self.number, 1, MAX_SOURCE_PAGES)
        _integer(self.width, 1, MAX_DIMENSION)
        _integer(self.height, 1, MAX_DIMENSION)
        _require(self.width * self.height <= MAX_PAGE_PIXELS)
        _require(type(self.lines) is tuple and len(self.lines) <= MAX_LINES)
        for line in self.lines:
            _require(type(line) is OcrLine)
            _require(line.left + line.width <= self.width and
                     line.top + line.height <= self.height)


@dataclass(frozen=True)
class OcrDocument:
    source_sha256: str
    source_page_count: int
    provider: str
    version: str
    language: str
    pages: tuple[OcrPage, ...]

    def __post_init__(self) -> None:
        _require(type(self.source_sha256) is str and
                 re.fullmatch(r"[a-f0-9]{64}", self.source_sha256) is not None)
        _integer(self.source_page_count, 1, MAX_SOURCE_PAGES)
        _identifier(self.provider)
        _identifier(self.version)
        _language(self.language)
        _require(type(self.pages) is tuple and 1 <= len(self.pages) <= MAX_RECOGNIZED_PAGES)
        previous = 0
        line_count = text_count = 0
        for page in self.pages:
            _require(type(page) is OcrPage and previous < page.number <= self.source_page_count)
            previous = page.number
            line_count += len(page.lines)
            text_count += sum(len(line.text) for line in page.lines)
        _require(line_count <= MAX_LINES and text_count <= MAX_TEXT_CHARACTERS)


@dataclass(frozen=True)
class OcrRequest:
    source: bytes = field(repr=False)
    media_type: str
    pages: tuple[int, ...]
    language: str

    def __post_init__(self) -> None:
        _require(type(self.source) is bytes and 0 < len(self.source) <= MAX_SOURCE_BYTES)
        _require(type(self.media_type) is str and
                 self.media_type in ("image/png", "image/jpeg", "application/pdf"))
        _language(self.language)
        _require(type(self.pages) is tuple and 1 <= len(self.pages) <= MAX_RECOGNIZED_PAGES)
        previous = 0
        for number in self.pages:
            _integer(number, 1, MAX_SOURCE_PAGES)
            _require(number > previous)
            previous = number
        _require(self.media_type == "application/pdf" or self.pages == (1,))

    @property
    def source_sha256(self) -> str:
        return hashlib.sha256(self.source).hexdigest()


class OcrProvider(Protocol):
    """A future provider must preserve the same bounds and page identities.

    The application continues to use its existing managed runtime/task ports.
    Windows, Tesseract, process, file and transport details belong outside them.
    Input bytes are a previously authorized immutable source snapshot. The caller
    supplies exact ascending source-page numbers; omitted pages are not inspected.
    No provider may download a language/model or silently fall back to a service.
    """

    def readiness(self, language: str, cancelled: Callable[[], bool]) -> OcrReadiness: ...

    def recognize(self, request: OcrRequest,
                  cancelled: Callable[[], bool]) -> OcrDocument: ...


def check_result(request: OcrRequest, result: OcrDocument,
                 readiness: OcrReadiness) -> OcrDocument:
    """Refuse a swapped source, provider, language or page set; never repair it."""
    _require(type(request) is OcrRequest and type(result) is OcrDocument and
             type(readiness) is OcrReadiness and readiness.available)
    _require(result.source_sha256 == request.source_sha256 and
             result.language == request.language == readiness.language and
             result.provider == readiness.provider and result.version == readiness.version and
             tuple(page.number for page in result.pages) == request.pages)
    _require(request.media_type == "application/pdf" or result.source_page_count == 1)
    return result
