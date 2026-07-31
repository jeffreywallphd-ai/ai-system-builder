from __future__ import annotations

import json
import unittest

from modules.adapters.runtime.python.worker.models import AdvancedSemanticCurationConfig
from modules.adapters.runtime.python.worker.tasks.semantic_curation import (
    cosine_similarity,
    curate_semantic_rows,
    hashed_token_embedding,
)


def _config(**overrides):
    return AdvancedSemanticCurationConfig.model_validate(
        {
            "enabled": True,
            "embeddingAlgorithm": "hashed-token-v1",
            "similarityThreshold": 0.85,
            "maxComparisonsPerRow": 16,
            "hardNegativeMining": True,
            **overrides,
        }
    )


class SemanticCurationTests(unittest.TestCase):
    def test_deterministically_quarantines_semantic_duplicates_before_splitting(self) -> None:
        rows = [
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 0,
                "text": "How can a customer review an account invoice total?",
                "label": "billing",
            },
            {
                "sourceArtifactId": "source-b",
                "sourceRowIndex": 0,
                "text": "How can a customer review the total on an account invoice?",
                "label": "billing",
            },
            {
                "sourceArtifactId": "source-c",
                "sourceRowIndex": 0,
                "text": "Where can a user change a profile photograph?",
                "label": "profile",
            },
        ]
        first = curate_semantic_rows(
            rows,
            "llm-classification",
            {"labelField": "label"},
            _config(similarityThreshold=0.75),
        )
        second = curate_semantic_rows(
            rows,
            "llm-classification",
            {"labelField": "label"},
            _config(similarityThreshold=0.75),
        )

        self.assertEqual(first.report, second.report)
        self.assertEqual(first.accepted_rows, second.accepted_rows)
        self.assertEqual(first.report["duplicateRowCount"], 1)
        self.assertEqual(
            first.quarantine_records[0]["reasonCodes"],
            ["semantic-duplicate"],
        )
        accepted_similarity = cosine_similarity(
            hashed_token_embedding(first.accepted_rows[0]["text"]),
            hashed_token_embedding(first.accepted_rows[1]["text"]),
        )
        self.assertLess(accepted_similarity, 0.75)

    def test_applies_source_caps_balancing_and_round_robin_mixing(self) -> None:
        rows = [
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": index,
                "text": f"Distinct billing example {index} alpha",
                "label": "billing",
            }
            for index in range(3)
        ] + [
            {
                "sourceArtifactId": "source-b",
                "sourceRowIndex": 0,
                "text": "Distinct profile example omega",
                "label": "profile",
            }
        ]
        result = curate_semantic_rows(
            rows,
            "llm-classification",
            {"labelField": "label"},
            _config(similarityThreshold=0.99, maxRowsPerSource=2),
        )

        self.assertEqual(result.report["sourceCapRejectedRowCount"], 1)
        self.assertGreater(result.report["balancingRecommendationCount"], 0)
        self.assertEqual(
            [row["sourceArtifactId"] for row in result.accepted_rows[:2]],
            ["source-a", "source-b"],
        )

    def test_records_reviewable_hard_negative_lineage_without_report_text(self) -> None:
        private_marker = "synthetic-private-marker"
        rows = [
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 0,
                "anchorText": f"account invoice billing {private_marker}",
                "positiveText": "review invoice total",
            },
            {
                "sourceArtifactId": "source-b",
                "sourceRowIndex": 0,
                "anchorText": "account invoice payment schedule",
                "positiveText": "review payment date",
            },
        ]
        result = curate_semantic_rows(
            rows,
            "llm-embedding",
            {},
            _config(similarityThreshold=0.95),
        )

        self.assertGreater(
            result.report["hardNegativeRecommendationCount"],
            0,
        )
        self.assertTrue(
            any(
                "hardNegativeRecommendation" in row
                for row in result.accepted_rows
            )
        )
        self.assertNotIn(private_marker, json.dumps(result.report))
        self.assertNotIn(
            "embedding",
            json.dumps(result.report["reviewExamples"]).lower(),
        )

    def test_comparison_work_is_bounded(self) -> None:
        rows = [
            {
                "sourceArtifactId": f"source-{index}",
                "text": f"unique topic token {index}",
            }
            for index in range(20)
        ]
        result = curate_semantic_rows(
            rows,
            "llm-instruction",
            {},
            _config(similarityThreshold=1.0, maxComparisonsPerRow=3),
        )
        self.assertLessEqual(result.report["comparedPairCount"], 20 * 3)


if __name__ == "__main__":
    unittest.main()
