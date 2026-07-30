from __future__ import annotations

from dataclasses import dataclass
import re

from ..models import AdvancedContentProcessingConfig, MarkdownChunkingConfig
from .document_normalization import NormalizedDocument, NormalizedRegion


_TOKEN_PATTERN = re.compile(r"\b[\w'-]+\b", re.UNICODE)
_SENTENCE_PATTERN = re.compile(r"[^.!?\n]+(?:[.!?]+|$)", re.MULTILINE)


@dataclass
class MarkdownChunk:
    artifact_id: str
    chunk_index: int
    text: str
    normalized_start: int = 0
    normalized_end: int = 0
    region_kind: str = "text"
    page_number: int | None = None
    strategy: str = "character"
    token_count: int = 0
    extraction_quality: float = 1.0


def _trimmed_span(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _character_spans(text: str, chunk_size: int, chunk_overlap: int) -> list[tuple[int, int, str, int | None]]:
    if chunk_overlap >= chunk_size:
        raise ValueError("chunkOverlap must be smaller than chunkSize")
    start, text_end = _trimmed_span(text, 0, len(text))
    if start >= text_end:
        return []
    spans: list[tuple[int, int, str, int | None]] = []
    step = chunk_size - chunk_overlap
    while start < text_end:
        end = min(start + chunk_size, text_end)
        bounded_start, bounded_end = _trimmed_span(text, start, end)
        if bounded_start < bounded_end:
            spans.append((bounded_start, bounded_end, "text", None))
        if end >= text_end:
            break
        start += step
    return spans


def _group_atomic_spans(
    text: str,
    atoms: list[tuple[int, int, str, int | None]],
    *,
    max_characters: int,
    max_tokens: int,
) -> list[tuple[int, int, str, int | None]]:
    grouped: list[tuple[int, int, str, int | None]] = []
    current: list[tuple[int, int, str, int | None]] = []
    current_tokens = 0
    for atom in atoms:
        atom_tokens = len(_TOKEN_PATTERN.findall(text[atom[0] : atom[1]]))
        proposed_characters = atom[1] - current[0][0] if current else atom[1] - atom[0]
        if current and (proposed_characters > max_characters or current_tokens + atom_tokens > max_tokens):
            grouped.append((current[0][0], current[-1][1], current[0][2], current[0][3]))
            current = []
            current_tokens = 0
        current.append(atom)
        current_tokens += atom_tokens
    if current:
        grouped.append((current[0][0], current[-1][1], current[0][2], current[0][3]))
    return grouped


def _sentence_atoms(text: str) -> list[tuple[int, int, str, int | None]]:
    atoms: list[tuple[int, int, str, int | None]] = []
    for match in _SENTENCE_PATTERN.finditer(text):
        start, end = _trimmed_span(text, match.start(), match.end())
        if start < end:
            atoms.append((start, end, "paragraph", None))
    return atoms


def _section_spans(text: str) -> list[tuple[int, int, str, int | None]]:
    headings = list(re.finditer(r"(?m)^#{1,6}\s+.+$", text))
    if not headings:
        return _sentence_atoms(text)
    starts = [0] if headings[0].start() > 0 else []
    starts.extend(match.start() for match in headings)
    spans: list[tuple[int, int, str, int | None]] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(text)
        start, end = _trimmed_span(text, start, end)
        if start < end:
            spans.append((start, end, "heading" if text[start] == "#" else "paragraph", None))
    return spans


def _table_spans(text: str) -> list[tuple[int, int, str, int | None]]:
    tables: list[tuple[int, int, str, int | None]] = []
    active_start: int | None = None
    active_end = 0
    for match in re.finditer(r"(?m)^.*$", text):
        is_table = match.group(0).count("|") >= 2
        if is_table and active_start is None:
            active_start = match.start()
        if is_table:
            active_end = match.end()
        elif active_start is not None:
            tables.append((active_start, active_end, "table", None))
            active_start = None
    if active_start is not None:
        tables.append((active_start, active_end, "table", None))
    return tables or _section_spans(text)


def _layout_spans(document: NormalizedDocument) -> list[tuple[int, int, str, int | None]]:
    regions = document.regions or [NormalizedRegion("text", 0, len(document.markdown))]
    return [
        (region.start, region.end, region.kind, region.page_number)
        for region in regions
        if 0 <= region.start < region.end <= len(document.markdown)
    ]


def _token_spans(text: str, max_tokens: int) -> list[tuple[int, int, str, int | None]]:
    tokens = list(_TOKEN_PATTERN.finditer(text))
    return [
        (tokens[start].start(), tokens[min(start + max_tokens, len(tokens)) - 1].end(), "text", None)
        for start in range(0, len(tokens), max_tokens)
    ]


def _semantic_spans(
    text: str,
    max_characters: int,
    max_tokens: int,
    boundary_threshold: float,
) -> list[tuple[int, int, str, int | None]]:
    sentences = _sentence_atoms(text)
    if len(sentences) < 2:
        return sentences or _section_spans(text)
    grouped: list[tuple[int, int, str, int | None]] = []
    current_start = sentences[0][0]
    current_end = sentences[0][1]
    previous_tokens = set(token.lower() for token in _TOKEN_PATTERN.findall(text[current_start:current_end]))
    current_token_count = len(previous_tokens)
    for sentence in sentences[1:]:
        sentence_tokens = set(token.lower() for token in _TOKEN_PATTERN.findall(text[sentence[0] : sentence[1]]))
        union = previous_tokens | sentence_tokens
        similarity = len(previous_tokens & sentence_tokens) / max(1, len(union))
        would_exceed = sentence[1] - current_start > max_characters or current_token_count + len(sentence_tokens) > max_tokens
        if similarity < boundary_threshold or would_exceed:
            grouped.append((current_start, current_end, "paragraph", None))
            current_start = sentence[0]
            current_token_count = 0
        current_end = sentence[1]
        current_token_count += len(sentence_tokens)
        previous_tokens = sentence_tokens
    grouped.append((current_start, current_end, "paragraph", None))
    return grouped


def _advanced_spans(
    document: NormalizedDocument,
    advanced: AdvancedContentProcessingConfig,
) -> list[tuple[int, int, str, int | None]]:
    if advanced.ocrEnabled:
        raise RuntimeError(
            "OCR text recognition is unavailable. Use a text-based source or add reviewed text before preparation."
        )
    max_tokens = int(advanced.maxTokensPerChunk or 320)
    max_characters = max(256, max_tokens * 8)
    strategy = advanced.strategy
    if strategy == "token":
        return _token_spans(document.markdown, max_tokens)
    if strategy == "sentence":
        return _group_atomic_spans(
            document.markdown,
            _sentence_atoms(document.markdown),
            max_characters=max_characters,
            max_tokens=max_tokens,
        )
    if strategy == "section":
        return _group_atomic_spans(
            document.markdown,
            _section_spans(document.markdown),
            max_characters=max_characters,
            max_tokens=max_tokens,
        )
    if strategy == "table":
        return _table_spans(document.markdown)
    if strategy == "semantic":
        return _semantic_spans(
            document.markdown,
            max_characters,
            max_tokens,
            float(advanced.semanticBoundaryThreshold or 0.22),
        )
    if strategy == "layout":
        if advanced.layoutEnabled is False:
            raise RuntimeError("Layout-aware preparation was selected but layout regions are disabled.")
        return _layout_spans(document)
    raise ValueError(f"Unsupported advanced content strategy: {strategy}")


def chunk_markdown_documents(
    documents: list[NormalizedDocument],
    config: MarkdownChunkingConfig | None,
    advanced: AdvancedContentProcessingConfig | None = None,
) -> list[MarkdownChunk]:
    if config is None and advanced is None:
        raise ValueError("Fixed-length chunking settings are required.")
    if config is not None and config.strategy != "character":
        raise ValueError(f"Unsupported markdown chunking strategy: {config.strategy}")
    preserve_document_boundaries = (
        config.preserveDocumentBoundaries if config is not None else True
    )
    if preserve_document_boundaries is None:
        preserve_document_boundaries = True
    if advanced is not None and not preserve_document_boundaries:
        raise ValueError("Advanced content processing requires document boundaries for source lineage.")

    if not preserve_document_boundaries:
        if config is None:
            raise ValueError("Fixed-length chunking settings are required.")
        combined = "\n\n".join(document.markdown.strip() for document in documents if document.markdown.strip())
        return [
            MarkdownChunk(
                artifact_id="combined",
                chunk_index=index,
                text=combined[start:end],
                normalized_start=start,
                normalized_end=end,
                token_count=len(_TOKEN_PATTERN.findall(combined[start:end])),
            )
            for index, (start, end, _kind, _page) in enumerate(
                _character_spans(combined, config.chunkSize, config.chunkOverlap)
            )
        ]

    chunks: list[MarkdownChunk] = []
    for document in documents:
        spans = (
            _advanced_spans(document, advanced)
            if advanced is not None
            else _character_spans(
                document.markdown,
                config.chunkSize,
                config.chunkOverlap,
            )
        )
        if advanced is not None and len(spans) > int(advanced.maxSourceSpans or 10_000):
            raise ValueError("Advanced content processing produced more source spans than the configured safe limit.")
        for index, (start, end, kind, page_number) in enumerate(spans):
            chunks.append(
                MarkdownChunk(
                    artifact_id=document.artifact_id,
                    chunk_index=index,
                    text=document.markdown[start:end],
                    normalized_start=start,
                    normalized_end=end,
                    region_kind=kind,
                    page_number=page_number,
                    strategy=advanced.strategy if advanced is not None else "character",
                    token_count=len(_TOKEN_PATTERN.findall(document.markdown[start:end])),
                    extraction_quality=document.extraction_quality,
                )
            )
    return chunks
