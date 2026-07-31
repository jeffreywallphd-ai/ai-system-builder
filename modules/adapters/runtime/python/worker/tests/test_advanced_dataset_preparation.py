from __future__ import annotations

import json
import unittest

from modules.adapters.runtime.python.worker.models import DatasetPreparationAdvancedConfig
from modules.adapters.runtime.python.worker.tasks.advanced_capabilities import (
    build_advanced_content_report,
)
from modules.adapters.runtime.python.worker.tasks.document_normalization import (
    NormalizedDocument,
)
from modules.adapters.runtime.python.worker.tasks.example_generation import GeneratedQaExample
from modules.adapters.runtime.python.worker.tasks.markdown_chunking import MarkdownChunk
from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import (
    _build_generated_task_row,
)


class AdvancedDatasetPreparationTests(unittest.TestCase):
    def test_content_report_is_aggregate_and_records_capability_readiness(self) -> None:
        config = DatasetPreparationAdvancedConfig.model_validate(
            {
                "preset": "better-document-understanding",
                "content": {
                    "strategy": "section",
                    "maxTokensPerChunk": 320,
                    "maxSourceSpans": 100,
                    "ocrEnabled": False,
                },
            }
        )
        secret_marker = "private-source-marker"
        report = build_advanced_content_report(
            config,
            [NormalizedDocument("source-a", secret_marker, "text/plain", "/tmp/source.txt")],
            [
                MarkdownChunk(
                    "source-a",
                    0,
                    secret_marker,
                    normalized_start=0,
                    normalized_end=len(secret_marker),
                    strategy="section",
                )
            ],
        )

        self.assertEqual(report["content"]["sourceSpanCount"], 1)
        self.assertEqual(report["content"]["algorithmVersion"], "bounded-structure-v1")
        self.assertNotIn(secret_marker, json.dumps(report))
        self.assertIn(
            {"capabilityId": "ocr-text", "status": "unavailable"},
            [
                {
                    "capabilityId": item["capabilityId"],
                    "status": item["status"],
                }
                for item in report["capabilities"]
            ],
        )

    def test_generated_row_records_exact_normalized_source_lineage(self) -> None:
        chunk = MarkdownChunk(
            artifact_id="source-a",
            chunk_index=2,
            text="Grounded synthetic source text.",
            normalized_start=45,
            normalized_end=76,
            region_kind="page",
            page_number=3,
            strategy="layout",
        )
        row = _build_generated_task_row(
            "llm-instruction",
            {"taskType": "llm-instruction"},
            GeneratedQaExample(
                artifact_id="source-a",
                chunk_index=2,
                question="What is described?",
                answer="Grounded synthetic source text.",
            ),
            chunk,
            None,
        )

        self.assertEqual(
            row["sourceLineage"],
            {
                "sourceArtifactId": "source-a",
                "normalizedStart": 45,
                "normalizedEnd": 76,
                "regionKind": "page",
                "pageNumber": 3,
            },
        )


if __name__ == "__main__":
    unittest.main()
