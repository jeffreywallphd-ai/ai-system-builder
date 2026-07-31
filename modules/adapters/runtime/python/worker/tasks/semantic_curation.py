from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass
import hashlib
import math
import re
from typing import Any

from ..models import AdvancedSemanticCurationConfig


_DIMENSIONS = 128
_MAX_TEXT_CHARACTERS = 1_000_000
_MAX_REVIEW_EXAMPLES = 20
_PROVENANCE_FIELDS = {
    "artifactId",
    "sourceArtifactId",
    "sourceRowIndex",
    "chunkIndex",
    "generationMode",
    "sourceLineage",
    "sourceCitation",
    "hardNegativeRecommendation",
    "syntheticVerification",
    "split",
}


@dataclass(frozen=True)
class SemanticCurationResult:
    accepted_rows: list[dict[str, object]]
    quarantine_records: list[dict[str, object]]
    report: dict[str, object]


def _row_text(row: dict[str, object]) -> str:
    values = [
        value
        for key, value in sorted(row.items())
        if key not in _PROVENANCE_FIELDS and isinstance(value, str)
    ]
    return "\n".join(values).strip()[:_MAX_TEXT_CHARACTERS]


def _source_id(row: dict[str, object]) -> str:
    for field in ("sourceArtifactId", "artifactId"):
        value = row.get(field)
        if isinstance(value, str) and value:
            return value
    return "unknown-source"


def _source_row_index(row: dict[str, object], fallback: int) -> int:
    for field in ("sourceRowIndex", "chunkIndex"):
        value = row.get(field)
        if isinstance(value, int) and value >= 0:
            return value
    return fallback


def hashed_token_embedding(text: str) -> tuple[float, ...]:
    vector = [0.0] * _DIMENSIONS
    tokens = re.findall(r"[\w'-]+", text.casefold(), re.UNICODE)
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:2], "big") % _DIMENSIONS
        direction = 1.0 if digest[2] & 1 else -1.0
        vector[index] += direction
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude == 0:
        return tuple(vector)
    return tuple(value / magnitude for value in vector)


def cosine_similarity(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    return max(-1.0, min(1.0, sum(a * b for a, b in zip(left, right))))


def _round_robin_mix(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    by_source: dict[str, deque[dict[str, object]]] = defaultdict(deque)
    for row in rows:
        by_source[_source_id(row)].append(row)
    mixed: list[dict[str, object]] = []
    source_ids = sorted(by_source)
    while source_ids:
        next_sources: list[str] = []
        for source_id in source_ids:
            queue = by_source[source_id]
            mixed.append(queue.popleft())
            if queue:
                next_sources.append(source_id)
        source_ids = next_sources
    return mixed


def _balance_field(task_type: str, task_recipe: dict[str, Any], requested: str | None) -> str | None:
    if requested:
        return requested
    if task_type in {"llm-classification", "vision-classification"}:
        return str(task_recipe.get("labelField") or "label")
    if task_type == "llm-reranker":
        return str(task_recipe.get("relevanceField") or "relevance")
    return None


def curate_semantic_rows(
    rows: list[dict[str, object]],
    task_type: str,
    task_recipe: dict[str, Any],
    config: AdvancedSemanticCurationConfig,
) -> SemanticCurationResult:
    if not config.enabled:
        return SemanticCurationResult(rows, [], {
            "embeddingAlgorithm": "hashed-token-v1",
            "algorithmVersion": "1",
            "similarityThreshold": float(config.similarityThreshold or 0.9),
            "comparedPairCount": 0,
            "duplicateRowCount": 0,
            "coverageScore": 1.0,
            "sourceCapRejectedRowCount": 0,
            "balancingRecommendationCount": 0,
            "hardNegativeRecommendationCount": 0,
            "reviewExamples": [],
        })
    if config.embeddingAlgorithm not in (None, "hashed-token-v1"):
        raise ValueError("The requested semantic embedding algorithm is unavailable.")

    threshold = float(config.similarityThreshold or 0.9)
    maximum_comparisons = int(config.maxComparisonsPerRow or 128)
    source_cap = int(config.maxRowsPerSource) if config.maxRowsPerSource is not None else None
    accepted: list[dict[str, object]] = []
    embeddings: list[tuple[float, ...]] = []
    accepted_lineage: list[tuple[str, int]] = []
    quarantine: list[dict[str, object]] = []
    source_counts: Counter[str] = Counter()
    compared_pairs = 0
    duplicate_count = 0
    source_cap_count = 0
    review_examples: list[dict[str, object]] = []

    for fallback_index, row in enumerate(rows):
        source_id = _source_id(row)
        source_index = _source_row_index(row, fallback_index)
        if source_cap is not None and source_counts[source_id] >= source_cap:
            source_cap_count += 1
            quarantine.append({
                "sourceArtifactId": source_id,
                "sourceRowIndex": source_index,
                "reasonCodes": ["source-row-limit"],
                "row": row,
            })
            continue
        embedding = hashed_token_embedding(_row_text(row))
        matched_index: int | None = None
        matched_similarity = -1.0
        first_candidate = max(0, len(embeddings) - maximum_comparisons)
        for candidate_index in range(first_candidate, len(embeddings)):
            compared_pairs += 1
            similarity = cosine_similarity(embedding, embeddings[candidate_index])
            if similarity > matched_similarity:
                matched_similarity = similarity
                matched_index = candidate_index
        if matched_index is not None and matched_similarity >= threshold:
            duplicate_count += 1
            quarantine.append({
                "sourceArtifactId": source_id,
                "sourceRowIndex": source_index,
                "reasonCodes": ["semantic-duplicate"],
                "row": row,
            })
            if len(review_examples) < _MAX_REVIEW_EXAMPLES:
                matched_source, matched_row = accepted_lineage[matched_index]
                review_examples.append({
                    "sourceArtifactId": source_id,
                    "sourceRowIndex": source_index,
                    "reason": "semantic-duplicate",
                    "matchedSourceArtifactId": matched_source,
                    "matchedSourceRowIndex": matched_row,
                    "similarity": round(matched_similarity, 4),
                })
            continue
        accepted.append(dict(row))
        embeddings.append(embedding)
        accepted_lineage.append((source_id, source_index))
        source_counts[source_id] += 1

    nearest_similarities: list[float] = []
    hard_negative_count = 0
    if embeddings:
        for index, embedding in enumerate(embeddings):
            best_index: int | None = None
            best_similarity = -1.0
            for candidate_index, candidate in enumerate(embeddings):
                if index == candidate_index or accepted_lineage[index][0] == accepted_lineage[candidate_index][0]:
                    continue
                similarity = cosine_similarity(embedding, candidate)
                if similarity > best_similarity:
                    best_index = candidate_index
                    best_similarity = similarity
            if best_index is not None:
                nearest_similarities.append(max(0.0, best_similarity))
                if (
                    config.hardNegativeMining
                    and task_type in {"llm-embedding", "llm-reranker"}
                    and 0.1 <= best_similarity < threshold
                ):
                    hard_negative_count += 1
                    matched_source, matched_row = accepted_lineage[best_index]
                    accepted[index]["hardNegativeRecommendation"] = {
                        "sourceArtifactId": matched_source,
                        "sourceRowIndex": matched_row,
                        "similarity": round(best_similarity, 4),
                        "algorithm": "hashed-token-v1",
                    }
                    if len(review_examples) < _MAX_REVIEW_EXAMPLES:
                        source_id, source_index = accepted_lineage[index]
                        review_examples.append({
                            "sourceArtifactId": source_id,
                            "sourceRowIndex": source_index,
                            "reason": "hard-negative",
                            "matchedSourceArtifactId": matched_source,
                            "matchedSourceRowIndex": matched_row,
                            "similarity": round(best_similarity, 4),
                        })

    balance_field = _balance_field(task_type, task_recipe, config.balanceField)
    distribution = Counter(
        str(row[balance_field])[:128]
        for row in accepted
        if balance_field is not None and row.get(balance_field) not in (None, "")
    )
    balancing_recommendations = (
        sum(max(distribution.values()) - count for count in distribution.values())
        if distribution
        else 0
    )
    coverage_score = round(
        1.0 - (sum(nearest_similarities) / len(nearest_similarities)),
        4,
    ) if nearest_similarities else (1.0 if accepted else 0.0)
    report = {
        "embeddingAlgorithm": "hashed-token-v1",
        "algorithmVersion": "1",
        "similarityThreshold": threshold,
        "comparedPairCount": compared_pairs,
        "duplicateRowCount": duplicate_count,
        "coverageScore": coverage_score,
        "sourceCapRejectedRowCount": source_cap_count,
        "balancingRecommendationCount": balancing_recommendations,
        "hardNegativeRecommendationCount": hard_negative_count,
        "reviewExamples": review_examples,
    }
    return SemanticCurationResult(_round_robin_mix(accepted), quarantine, report)
