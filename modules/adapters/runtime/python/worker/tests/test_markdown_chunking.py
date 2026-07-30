from __future__ import annotations

import unittest

from modules.adapters.runtime.python.worker.models import AdvancedContentProcessingConfig, MarkdownChunkingConfig
from modules.adapters.runtime.python.worker.tasks.document_normalization import NormalizedDocument, NormalizedRegion
from modules.adapters.runtime.python.worker.tasks.markdown_chunking import chunk_markdown_documents


class MarkdownChunkingTests(unittest.TestCase):
    def test_character_chunking_uses_size_and_overlap(self) -> None:
        chunks = chunk_markdown_documents(
            [
                NormalizedDocument(
                    artifact_id="a1",
                    markdown="abcdefghij",
                    media_type="text/markdown",
                    source_path="/tmp/a1.md",
                )
            ],
            MarkdownChunkingConfig(
                strategy="character",
                chunkSize=4,
                chunkOverlap=1,
                preserveDocumentBoundaries=True,
            ),
        )

        self.assertEqual([chunk.text for chunk in chunks], ["abcd", "defg", "ghij"])

    def test_preserves_document_boundaries_when_enabled(self) -> None:
        chunks = chunk_markdown_documents(
            [
                NormalizedDocument("a1", "AAAA", "text/markdown", "/tmp/a1.md"),
                NormalizedDocument("a2", "BBBB", "text/markdown", "/tmp/a2.md"),
            ],
            MarkdownChunkingConfig(strategy="character", chunkSize=10, chunkOverlap=0, preserveDocumentBoundaries=True),
        )

        self.assertEqual([chunk.artifact_id for chunk in chunks], ["a1", "a2"])

    def test_can_chunk_across_document_boundaries_when_disabled(self) -> None:
        chunks = chunk_markdown_documents(
            [
                NormalizedDocument("a1", "AAAA", "text/markdown", "/tmp/a1.md"),
                NormalizedDocument("a2", "BBBB", "text/markdown", "/tmp/a2.md"),
            ],
            MarkdownChunkingConfig(strategy="character", chunkSize=20, chunkOverlap=0, preserveDocumentBoundaries=False),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].artifact_id, "combined")
        self.assertIn("AAAA", chunks[0].text)
        self.assertIn("BBBB", chunks[0].text)

    def test_advanced_strategies_preserve_exact_bounded_source_spans(self) -> None:
        text = (
            "# Account help\n"
            "Billing questions can be reviewed by the account team. "
            "Invoices contain dates and totals.\n\n"
            "| Plan | Limit |\n| Basic | 10 |\n"
        )
        document = NormalizedDocument(
            "a1",
            text,
            "text/markdown",
            "/tmp/a1.md",
            regions=[
                NormalizedRegion("heading", 0, 14),
                NormalizedRegion("paragraph", 15, 112),
                NormalizedRegion("table", 114, len(text)),
            ],
            extraction_quality=0.95,
        )
        baseline = MarkdownChunkingConfig(
            strategy="character",
            chunkSize=160,
            chunkOverlap=0,
            preserveDocumentBoundaries=True,
        )

        for strategy in ("token", "sentence", "section", "table", "semantic", "layout"):
            with self.subTest(strategy=strategy):
                chunks = chunk_markdown_documents(
                    [document],
                    baseline,
                    AdvancedContentProcessingConfig(
                        strategy=strategy,
                        maxTokensPerChunk=32,
                        maxSourceSpans=100,
                        semanticBoundaryThreshold=0.1,
                        layoutEnabled=True,
                        ocrEnabled=False,
                    ),
                )
                self.assertGreater(len(chunks), 0)
                for chunk in chunks:
                    self.assertEqual(
                        text[chunk.normalized_start : chunk.normalized_end],
                        chunk.text,
                    )
                    self.assertEqual(chunk.artifact_id, "a1")
                    self.assertEqual(chunk.strategy, strategy)
                    self.assertLessEqual(chunk.normalized_end, len(text))
                    self.assertEqual(chunk.extraction_quality, 0.95)

    def test_advanced_processing_rejects_ocr_and_unbounded_spans(self) -> None:
        document = NormalizedDocument(
            "a1",
            " ".join(
                f"Sentence {index} contains several bounded words."
                for index in range(12)
            ),
            "text/plain",
            "/tmp/a1.txt",
        )
        baseline = MarkdownChunkingConfig(
            strategy="character",
            chunkSize=20,
            chunkOverlap=0,
            preserveDocumentBoundaries=True,
        )
        with self.assertRaisesRegex(RuntimeError, "OCR text recognition is unavailable"):
            chunk_markdown_documents(
                [document],
                baseline,
                AdvancedContentProcessingConfig(
                    strategy="sentence",
                    maxTokensPerChunk=32,
                    maxSourceSpans=10,
                    ocrEnabled=True,
                ),
            )
        with self.assertRaisesRegex(ValueError, "safe limit"):
            chunk_markdown_documents(
                [document],
                baseline,
                AdvancedContentProcessingConfig(
                    strategy="sentence",
                    maxTokensPerChunk=32,
                    maxSourceSpans=1,
                    ocrEnabled=False,
                ),
            )


if __name__ == "__main__":
    unittest.main()
