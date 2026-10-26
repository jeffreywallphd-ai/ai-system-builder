from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import AdvancedSemanticCurationConfig
from modules.adapters.runtime.python.worker.tasks import semantic_curation
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
        baseline = curate_semantic_rows(
            rows, "llm-classification", {"labelField": "label"}, _config(enabled=False),
        )

        self.assertEqual(first.report, second.report)
        self.assertEqual(first.accepted_rows, second.accepted_rows)
        self.assertEqual(len(baseline.accepted_rows), 3)
        self.assertEqual(len(first.accepted_rows), 2)
        self.assertEqual({row["label"] for row in first.accepted_rows}, {"billing", "profile"})
        self.assertEqual(first.report["algorithmVersion"], "2")
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
        self.assertLessEqual(result.report["comparedPairCount"], 2 * 20 * 3)

    def test_both_passes_bound_and_report_actual_similarity_calls(self) -> None:
        rows = [
            {
                "sourceArtifactId": f"source-{index}",
                "sourceRowIndex": index,
                "anchorText": " ".join(
                    f"topic-{index}-{word}"
                    for word in ("alpha", "bravo", "charlie", "delta", "echo", "foxtrot")
                ),
                "positiveText": f"example-{index}",
            }
            for index in range(64)
        ]
        config = _config(similarityThreshold=1.0, maxComparisonsPerRow=3)
        with patch.object(semantic_curation, "cosine_similarity", wraps=cosine_similarity) as compare:
            result = curate_semantic_rows(rows, "llm-embedding", {}, config)

        self.assertEqual(len(result.accepted_rows), len(rows))
        self.assertLessEqual(compare.call_count, 2 * len(rows) * 3)
        self.assertEqual(result.report["comparedPairCount"], compare.call_count)

    def test_disabled_curation_keeps_rows_and_does_not_compute_embeddings(self) -> None:
        rows = [{"sourceArtifactId": "source-a", "text": "Keep the original provided row."}]
        with patch.object(semantic_curation, "hashed_token_embedding") as embed:
            result = curate_semantic_rows(rows, "llm-instruction", {}, _config(enabled=False))
        self.assertIs(result.accepted_rows, rows)
        self.assertEqual(result.quarantine_records, [])
        self.assertEqual(result.report["comparedPairCount"], 0)
        self.assertEqual(result.report["algorithmVersion"], "1")
        embed.assert_not_called()

    def test_unknown_algorithm_is_denied_before_embedding_rows(self) -> None:
        config = _config().model_copy(update={"embeddingAlgorithm": "unreviewed"})
        with patch.object(semantic_curation, "hashed_token_embedding") as embed:
            with self.assertRaisesRegex(ValueError, "algorithm is unavailable"):
                curate_semantic_rows([{"text": "Synthetic row."}], "llm-instruction", {}, config)
        embed.assert_not_called()

    def test_bounded_window_does_not_claim_a_distant_global_match(self) -> None:
        rows = [
            {"sourceArtifactId": "source-a", "text": f"account invoice number-{index}"}
            for index in range(4)
        ] + [{"sourceArtifactId": "source-b", "text": "account invoice receipt"}]
        config = _config(similarityThreshold=1.0, maxComparisonsPerRow=2)
        first = curate_semantic_rows(rows, "llm-embedding", {}, config)
        second = curate_semantic_rows(rows, "llm-embedding", {}, config)
        self.assertEqual(first, second)
        self.assertEqual(len(first.accepted_rows), len(rows))
        self.assertNotIn("hardNegativeRecommendation", first.accepted_rows[0])
        self.assertLessEqual(len(first.report["reviewExamples"]), 20)


if __name__ == "__main__":
    unittest.main()
