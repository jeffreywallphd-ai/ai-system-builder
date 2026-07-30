from __future__ import annotations

from typing import Any

from ..models import DatasetPreparationAdvancedConfig
from .document_normalization import NormalizedDocument
from .markdown_chunking import MarkdownChunk


def resolve_advanced_capability_readiness(
    config: DatasetPreparationAdvancedConfig,
) -> list[dict[str, str]]:
    capabilities = [
        {
            "capabilityId": "source-span-lineage",
            "status": "ready",
            "provider": "managed-python-worker",
            "version": "normalized-span-v1",
            "message": "Source spans and document regions are recorded.",
        },
        {
            "capabilityId": "table-structure",
            "status": "ready",
            "provider": "managed-python-worker",
            "version": "markdown-table-v1",
            "message": "Tables can be kept together.",
        },
        {
            "capabilityId": "layout-regions",
            "status": "ready",
            "provider": "managed-python-worker",
            "version": "extracted-layout-v1",
            "message": "Extracted pages and document regions are available.",
        },
        {
            "capabilityId": "ocr-text",
            "status": "unavailable",
            "provider": "none",
            "version": "unavailable",
            "message": "Text recognition for scanned images is not installed.",
            "action": "Use a text-based source or add reviewed text before preparation.",
        },
        {
            "capabilityId": "semantic-embeddings",
            "status": "ready",
            "provider": "managed-python-worker",
            "version": "hashed-token-v1",
            "message": "Reproducible local similarity checks are available.",
        },
        {
            "capabilityId": "deterministic-critic",
            "status": "ready",
            "provider": "managed-python-worker",
            "version": "deterministic-grounding-v1",
            "message": "Generated examples can be checked independently.",
        },
        {
            "capabilityId": "hard-negative-mining",
            "status": "ready",
            "provider": "managed-python-worker",
            "version": "hashed-token-v1",
            "message": "Reviewable hard-negative recommendations are available.",
        },
    ]
    if config.preset == "generate-examples":
        capabilities.append(
            {
                "capabilityId": "local-generation-model",
                "status": "ready",
                "provider": "transformers",
                "version": "configured-local-model",
                "message": "The configured local model is used for generation.",
            }
        )
    return capabilities


def build_advanced_content_report(
    config: DatasetPreparationAdvancedConfig,
    documents: list[NormalizedDocument],
    chunks: list[MarkdownChunk],
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "schemaVersion": "1",
        "preset": config.preset,
        "capabilities": resolve_advanced_capability_readiness(config),
    }
    if config.content is not None:
        qualities = [document.extraction_quality for document in documents]
        report["content"] = {
            "strategy": config.content.strategy,
            "algorithmVersion": "bounded-structure-v1",
            "sourceSpanCount": len(chunks),
            "lowConfidenceSourceCount": sum(1 for quality in qualities if quality < 0.6),
            "meanExtractionQuality": round(sum(qualities) / max(1, len(qualities)), 4),
        }
    return report
