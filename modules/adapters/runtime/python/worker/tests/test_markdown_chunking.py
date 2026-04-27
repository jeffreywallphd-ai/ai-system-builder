from __future__ import annotations

import unittest

from modules.adapters.runtime.python.worker.models import MarkdownChunkingConfig
from modules.adapters.runtime.python.worker.tasks.document_normalization import NormalizedDocument
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


if __name__ == "__main__":
    unittest.main()
