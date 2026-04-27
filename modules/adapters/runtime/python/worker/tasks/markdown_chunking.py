from __future__ import annotations

from dataclasses import dataclass

from ..models import MarkdownChunkingConfig
from .document_normalization import NormalizedDocument


@dataclass
class MarkdownChunk:
    artifact_id: str
    chunk_index: int
    text: str


def _chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    if chunk_overlap >= chunk_size:
        raise ValueError("chunkOverlap must be smaller than chunkSize")

    normalized = text.strip()
    if not normalized:
        return []

    chunks: list[str] = []
    start = 0
    step = chunk_size - chunk_overlap

    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        chunk = normalized[start:end]
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start += step

    return chunks


def chunk_markdown_documents(
    documents: list[NormalizedDocument],
    config: MarkdownChunkingConfig,
) -> list[MarkdownChunk]:
    if config.strategy != "character":
        raise ValueError(f"Unsupported markdown chunking strategy: {config.strategy}")

    preserve_document_boundaries = config.preserveDocumentBoundaries
    if preserve_document_boundaries is None:
        preserve_document_boundaries = True

    if preserve_document_boundaries:
        chunks: list[MarkdownChunk] = []
        for document in documents:
            for index, chunk_text in enumerate(
                _chunk_text(document.markdown, config.chunkSize, config.chunkOverlap)
            ):
                chunks.append(
                    MarkdownChunk(
                        artifact_id=document.artifact_id,
                        chunk_index=index,
                        text=chunk_text,
                    )
                )
        return chunks

    combined = "\n\n".join(document.markdown.strip() for document in documents if document.markdown.strip())
    combined_chunks = _chunk_text(combined, config.chunkSize, config.chunkOverlap)

    return [
        MarkdownChunk(
            artifact_id="combined",
            chunk_index=index,
            text=chunk_text,
        )
        for index, chunk_text in enumerate(combined_chunks)
    ]
