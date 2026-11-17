"""Complete bounded PDF recognition without supplier or transport dependencies."""
from __future__ import annotations

from typing import Callable

from .protocol import (
    MAX_RECOGNIZED_PAGES, OcrCancelled, OcrContractError, OcrDocument,
    OcrProvider, OcrReadiness, OcrRequest, OcrUnavailable, check_result,
)


def recognize_pdf_document(source: bytes, language: str, provider: OcrProvider,
                           cancelled: Callable[[], bool]) -> OcrDocument:
    """Recognize every original page, or refuse the complete operation.

    The first page establishes the source page count. The same ready identity
    must cover both parts; no omitted-page success or supplier fallback exists.
    Source authorization precedes this immutable byte boundary.
    """
    try:
        first_request = OcrRequest(source, "application/pdf", (1,), language)
        if not callable(cancelled):
            raise OcrContractError("Text recognition returned an invalid bounded result.")

        def check_cancelled() -> None:
            value = cancelled()
            if type(value) is not bool:
                raise OcrContractError("Text recognition returned an invalid bounded result.")
            if value:
                raise OcrCancelled("Text recognition was cancelled.")

        check_cancelled()
        ready = provider.readiness(language, cancelled)
        check_cancelled()
        if type(ready) is not OcrReadiness or ready.language != language:
            raise OcrContractError("Text recognition returned an invalid bounded result.")
        if not ready.available:
            raise OcrUnavailable("Local text recognition is unavailable for the selected language.")
        first = check_result(first_request, provider.recognize(first_request, cancelled), ready)
        check_cancelled()
        count = first.source_page_count
        if count > MAX_RECOGNIZED_PAGES:
            raise OcrContractError("The scanned PDF has too many pages for text recognition.")
        if count == 1:
            return first
        remaining_request = OcrRequest(source, "application/pdf", tuple(range(2, count + 1)), language)
        remaining = check_result(remaining_request, provider.recognize(remaining_request, cancelled), ready)
        check_cancelled()
        if remaining.source_page_count != count:
            raise OcrContractError("Text recognition returned an invalid bounded result.")
        result = OcrDocument(first.source_sha256, count, first.provider, first.version,
                             language, first.pages + remaining.pages)
        complete_request = OcrRequest(source, "application/pdf", tuple(range(1, count + 1)), language)
        result = check_result(complete_request, result, ready)
        check_cancelled()
        return result
    except OcrCancelled:
        raise OcrCancelled("Text recognition was cancelled.") from None
    except OcrUnavailable:
        raise OcrUnavailable("Local text recognition is unavailable for the selected language.") from None
    except Exception:
        # No supplier exception, path or recognized content becomes a diagnostic.
        raise OcrContractError("The scanned PDF could not be read safely with text recognition.") from None
