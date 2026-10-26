from __future__ import annotations

from collections import Counter
import hashlib
import json
import time
import tracemalloc
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


def semantic_reference_rows(source_count=16, pairs_per_source=32):
    """Known bag-of-token duplicates, not a natural-language recall benchmark."""
    rows = []
    for source in range(source_count):
        for pair in range(pairs_per_source):
            digest = hashlib.sha256(f"reference-{source}-{pair}".encode()).hexdigest()
            words = ["fact" + digest[offset:offset + 8] for offset in range(0, 64, 8)]
            for duplicate in (False, True):
                rows.append({
                    "sourceArtifactId": f"source-{source:02}",
                    "sourceRowIndex": pair * 2 + int(duplicate),
                    "text": " ".join(reversed(words) if duplicate else words)
                    + " synthetic-reference-only-marker",
                    "label": "billing" if pair % 2 == 0 else "profile",
                })
    return rows


class SemanticCurationTests(unittest.TestCase):
    def test_controlled_reference_cohorts_preserve_unique_rows_with_bounded_allocations(self) -> None:
        for source_count, pairs_per_source in ((4, 16), (16, 32)):
            with self.subTest(sources=source_count, pairs=pairs_per_source):
                rows = semantic_reference_rows(source_count, pairs_per_source)
                original = json.dumps(rows, sort_keys=True)
                config = _config(similarityThreshold=0.99, maxComparisonsPerRow=16)
                baseline = curate_semantic_rows(rows, "llm-classification", {}, _config(enabled=False))
                self.assertEqual(len(baseline.accepted_rows), len(rows))
                self.assertEqual(baseline.quarantine_records, [])
                self.assertFalse(tracemalloc.is_tracing())
                tracemalloc.start()
                started = time.perf_counter()
                try:
                    result = curate_semantic_rows(rows, "llm-classification", {}, config)
                    elapsed = time.perf_counter() - started
                    _, peak_python_bytes = tracemalloc.get_traced_memory()
                finally:
                    tracemalloc.stop()
                self.assertLess(elapsed, 60)
                self.assertLessEqual(peak_python_bytes, 64 * 1024 ** 2)
                self.assertEqual(len(result.accepted_rows), len(rows) // 2)
                fields = ("sourceArtifactId", "sourceRowIndex", "text", "label")
                self.assertEqual(Counter(tuple(row[key] for key in fields) for row in result.accepted_rows),
                                 Counter(tuple(row[key] for key in fields) for row in rows if row["sourceRowIndex"] % 2 == 0))
                self.assertEqual(Counter(tuple(row["row"][key] for key in fields) for row in result.quarantine_records),
                                 Counter(tuple(row[key] for key in fields) for row in rows if row["sourceRowIndex"] % 2 == 1))
                self.assertEqual(result.report["duplicateRowCount"], len(rows) // 2)
                self.assertEqual(result.report["algorithmVersion"], "2")
                self.assertLessEqual(result.report["comparedPairCount"], 2 * len(rows) * 16)
                self.assertEqual(Counter(row["sourceArtifactId"] for row in result.accepted_rows),
                                 {f"source-{index:02}": pairs_per_source for index in range(source_count)})
                self.assertEqual(Counter(row["label"] for row in result.accepted_rows),
                                 {"billing": len(rows) // 4, "profile": len(rows) // 4})
                self.assertTrue(all(row["sourceRowIndex"] % 2 == 0 for row in result.accepted_rows))
                self.assertEqual(len(result.quarantine_records), len(rows) // 2)
                self.assertTrue(all(row["reasonCodes"] == ["semantic-duplicate"]
                                    and row["sourceRowIndex"] % 2 == 1 for row in result.quarantine_records))
                expected_sources = [f"source-{index:02}" for index in range(source_count)]
                for offset in range(0, len(result.accepted_rows), source_count):
                    self.assertEqual([row["sourceArtifactId"] for row in result.accepted_rows[offset:offset + source_count]],
                                     expected_sources)
                for example in result.report["reviewExamples"]:
                    self.assertEqual(example["sourceArtifactId"], example["matchedSourceArtifactId"])
                    self.assertEqual(example["sourceRowIndex"] - 1, example["matchedSourceRowIndex"])
                self.assertLessEqual(len(result.report["reviewExamples"]), 20)
                self.assertNotIn("synthetic-reference-only-marker", json.dumps(result.report))
                self.assertEqual(result, curate_semantic_rows(rows, "llm-classification", {}, config))
                self.assertEqual(json.dumps(rows, sort_keys=True), original)
                print(json.dumps({"schemaVersion": "semantic-reference-measurement-v1",
                                  "inputRows": len(rows), "acceptedRows": len(result.accepted_rows),
                                  "knownDuplicateRows": result.report["duplicateRowCount"],
                                  "comparedPairCount": result.report["comparedPairCount"],
                                  "elapsedMilliseconds": round(elapsed * 1000), "peakTracedPythonBytes": peak_python_bytes,
                                  "scope": "Fixed token-permutation reference and traced Python allocations only; not RSS, native admission, natural-language recall, model or full-app qualification."}))

    def test_controlled_contrast_recommendations_resolve_to_other_selected_sources(self) -> None:
        rows = [{"sourceArtifactId": row["sourceArtifactId"], "sourceRowIndex": row["sourceRowIndex"],
                 "anchorText": row["text"], "positiveText": "A distinct provided positive reference."}
                for row in semantic_reference_rows(16, 8) if row["sourceRowIndex"] % 2 == 0]
        original = json.dumps(rows, sort_keys=True)
        config = _config(similarityThreshold=0.99, maxComparisonsPerRow=16)
        result = curate_semantic_rows(rows, "llm-embedding", {}, config)
        self.assertEqual(len(result.accepted_rows), len(rows))
        fields = ("sourceArtifactId", "sourceRowIndex", "anchorText", "positiveText")
        self.assertEqual(Counter(tuple(row[key] for key in fields) for row in result.accepted_rows),
                         Counter(tuple(row[key] for key in fields) for row in rows))
        self.assertEqual(result.quarantine_records, [])
        self.assertGreater(result.report["hardNegativeRecommendationCount"], 0)
        selected = {(row["sourceArtifactId"], row["sourceRowIndex"]) for row in rows}
        recommendations = 0
        for row in result.accepted_rows:
            if recommendation := row.get("hardNegativeRecommendation"):
                recommendations += 1
                self.assertIn((recommendation["sourceArtifactId"], recommendation["sourceRowIndex"]), selected)
                self.assertNotEqual(recommendation["sourceArtifactId"], row["sourceArtifactId"])
                self.assertEqual(recommendation["algorithm"], "hashed-token-v1")
                self.assertGreaterEqual(recommendation["similarity"], 0.1)
                self.assertLess(recommendation["similarity"], 0.99)
        self.assertEqual(recommendations, result.report["hardNegativeRecommendationCount"])
        self.assertLessEqual(result.report["comparedPairCount"], 2 * len(rows) * 16)
        self.assertEqual(result, curate_semantic_rows(rows, "llm-embedding", {}, config))
        self.assertEqual(json.dumps(rows, sort_keys=True), original)
        self.assertNotIn("synthetic-reference-only-marker", json.dumps(result.report))

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
