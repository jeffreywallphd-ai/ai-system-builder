from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from docx import Document
from pypdf import PdfWriter

from modules.adapters.runtime.python.worker.models import DatasetPreparationSourceInput, DocumentNormalizationConfig
from modules.adapters.runtime.python.worker.tasks.document_normalization import normalize_sources_to_markdown


class DocumentNormalizationTests(unittest.TestCase):
    def test_normalizes_supported_documents(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            txt_path = root / "sample.txt"
            md_path = root / "sample.md"
            html_path = root / "sample.html"
            pdf_path = root / "sample.pdf"
            docx_path = root / "sample.docx"

            txt_path.write_text("plain text", encoding="utf-8")
            md_path.write_text("# heading\n\nmarkdown", encoding="utf-8")
            html_path.write_text("<h1>Title</h1><p>body</p>", encoding="utf-8")

            writer = PdfWriter()
            writer.add_blank_page(width=300, height=300)
            with pdf_path.open("wb") as handle:
                writer.write(handle)

            document = Document()
            document.add_paragraph("docx body")
            document.save(str(docx_path))

            result = normalize_sources_to_markdown(
                [
                    DatasetPreparationSourceInput(artifactId="txt", localPath=str(txt_path)),
                    DatasetPreparationSourceInput(artifactId="md", localPath=str(md_path)),
                    DatasetPreparationSourceInput(artifactId="html", localPath=str(html_path)),
                    DatasetPreparationSourceInput(artifactId="pdf", localPath=str(pdf_path)),
                    DatasetPreparationSourceInput(artifactId="docx", localPath=str(docx_path)),
                ],
                DocumentNormalizationConfig(targetFormat="markdown", unsupportedDocumentPolicy="fail"),
            )

            self.assertEqual(len(result.documents), 5)
            self.assertEqual(result.skipped_document_count, 0)
            by_id = {doc.artifact_id: doc.markdown for doc in result.documents}
            self.assertIn("plain text", by_id["txt"])
            self.assertIn("# heading", by_id["md"])
            self.assertIn("Title", by_id["html"])
            self.assertIn("docx body", by_id["docx"])

    def test_unsupported_document_policy_fail_raises(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "sample.bin"
            source.write_bytes(b"abc")
            with self.assertRaises(ValueError):
                normalize_sources_to_markdown(
                    [DatasetPreparationSourceInput(artifactId="bin", localPath=str(source))],
                    DocumentNormalizationConfig(targetFormat="markdown", unsupportedDocumentPolicy="fail"),
                )

    def test_unsupported_document_policy_skip_warns(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "sample.bin"
            source.write_bytes(b"abc")
            result = normalize_sources_to_markdown(
                [DatasetPreparationSourceInput(artifactId="bin", localPath=str(source))],
                DocumentNormalizationConfig(targetFormat="markdown", unsupportedDocumentPolicy="skip"),
            )
            self.assertEqual(len(result.documents), 0)
            self.assertEqual(result.skipped_document_count, 1)
            self.assertEqual(result.warnings[0].code, "document_normalization_skipped")

    def test_doc_extension_reports_explicit_unsupported_message(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "legacy.doc"
            source.write_bytes(b"abc")
            with self.assertRaisesRegex(ValueError, "legacy Microsoft Word"):
                normalize_sources_to_markdown(
                    [DatasetPreparationSourceInput(artifactId="doc", localPath=str(source))],
                    DocumentNormalizationConfig(targetFormat="markdown", unsupportedDocumentPolicy="fail"),
                )

    def test_doc_extension_skip_policy_uses_explicit_doc_warning_code(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "legacy.doc"
            source.write_bytes(b"abc")
            result = normalize_sources_to_markdown(
                [DatasetPreparationSourceInput(artifactId="doc", localPath=str(source))],
                DocumentNormalizationConfig(targetFormat="markdown", unsupportedDocumentPolicy="skip"),
            )
            self.assertEqual(result.skipped_document_count, 1)
            self.assertEqual(result.warnings[0].code, "document_normalization_unsupported_doc")


if __name__ == "__main__":
    unittest.main()
