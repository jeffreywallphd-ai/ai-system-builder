"""Replaceable local OCR composition; Windows details stay behind this adapter.

This module neither builds nor selects executable paths. Product capabilities
must not advertise OCR until their own build and delivery checks qualify.
"""
from __future__ import annotations
import os
from typing import Callable
from .protocol import (
    OcrContractError, OcrDocument, OcrProvider, OcrReadiness, OcrRequest, check_result,
)
from .wire import parse_response, readiness_frame, request_frame
from .windows_process import exchange, OcrProcessError


class OcrUnavailable(RuntimeError):
    """Fixed public error; never include a document, path or supplier exception."""


class WindowsOcrProvider:
    """Use only the installed, manifest-bound helper and exact installed language.

    Readiness is checked anew for each recognition. There is no cached ready
    identity, provider fallback, language substitution or implicit download.
    """

    def readiness(self, language: str, cancelled: Callable[[], bool]) -> OcrReadiness:
        frame = readiness_frame(language)  # Validate even when the platform is absent.
        if not callable(cancelled):
            raise OcrContractError("Text recognition returned an invalid bounded result.")
        if os.name != "nt":
            return OcrReadiness(False, "windows", "1", language, "unsupported-platform")
        try:
            response = parse_response(exchange(frame, cancelled))
        except OcrProcessError:
            return OcrReadiness(False, "windows", "1", language, "helper-unavailable")
        if (type(response) is not OcrReadiness or response.provider != "windows" or
                response.version != "1" or response.language != language or
                response.reason not in (None, "language-unavailable")):
            raise OcrContractError("Text recognition returned an invalid bounded result.")
        return response

    def recognize(self, request: OcrRequest,
                  cancelled: Callable[[], bool]) -> OcrDocument:
        frame = request_frame(request)  # No unvalidated source crosses the transport.
        ready = self.readiness(request.language, cancelled)
        if not ready.available:
            raise OcrUnavailable("Local text recognition is unavailable for the selected language.")
        result = parse_response(exchange(frame, cancelled))
        return check_result(request, result, ready)


def local_provider() -> OcrProvider:
    """Fixed selected supplier; a future adapter implements the same protocol.

    Construction performs no engine probe, process launch or file read.
    Unsupported platforms return an explicit unavailable readiness result.
    """
    return WindowsOcrProvider()
