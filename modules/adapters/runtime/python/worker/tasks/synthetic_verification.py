from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import re
from typing import Any

from ..models import AdvancedSyntheticVerificationConfig
from .example_generation import GeneratedQaExample
from .markdown_chunking import MarkdownChunk
from .semantic_curation import cosine_similarity, hashed_token_embedding
from .structured_output_runtime import read_purpose_value


_WORD_PATTERN = re.compile(r"[\w'-]+", re.UNICODE)
_EMAIL_PATTERN = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
_SECRET_PATTERN = re.compile(
    r"\b(?:gh[pousr]_|github_pat_|sk-|xox[baprs]-|api[_-]?key\s*[:=]|password\s*[:=])",
    re.IGNORECASE,
)
_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "was",
    "with",
}


@dataclass(frozen=True)
class SyntheticCandidateDecision:
    accepted: bool
    reason_codes: list[str]
    grounding_score: float
    critic_score: float
    diversity_score: float
    row: dict[str, object]


def _tokens(text: str) -> set[str]:
    return {
        token.casefold()
        for token in _WORD_PATTERN.findall(text)
        if len(token) > 1 and token.casefold() not in _STOP_WORDS
    }


def _grounding_score(answer: str, source: str) -> float:
    answer_tokens = _tokens(answer)
    if not answer_tokens:
        return 0.0
    source_tokens = _tokens(source)
    return len(answer_tokens & source_tokens) / len(answer_tokens)


def _required_fields(task_type: str, recipe: dict[str, Any]) -> list[str]:
    return {
        "llm-instruction": ["instruction", "output"],
        "llm-classification": [
            str(recipe.get("textField") or "text"),
            str(recipe.get("labelField") or "label"),
        ],
        "llm-extraction": [
            str(recipe.get("textField") or "text"),
            str(recipe.get("outputField") or "expectedOutput"),
        ],
        "llm-embedding": [
            str(recipe.get("anchorTextField") or "anchorText"),
            str(recipe.get("positiveTextField") or "positiveText"),
        ],
        "llm-reranker": [
            str(recipe.get("queryField") or "query"),
            str(recipe.get("passageField") or "passage"),
            str(recipe.get("relevanceField") or "relevance"),
        ],
    }.get(task_type, [])


def _missing(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _unsafe(text: str) -> bool:
    return (
        bool(_EMAIL_PATTERN.search(text))
        or bool(_SECRET_PATTERN.search(text))
        or "[unsafe-content]" in text.casefold()
    )


class SyntheticCandidateVerifier:
    def __init__(
        self,
        config: AdvancedSyntheticVerificationConfig,
        task_type: str,
        task_recipe: dict[str, Any],
        purpose_paths: dict[str, tuple[str, ...]] | None = None,
    ) -> None:
        self._config = config
        self._task_type = task_type
        self._task_recipe = task_recipe
        self._purpose_paths = purpose_paths
        self._fingerprints: set[str] = set()
        self._embeddings: list[tuple[float, ...]] = []
        self._generated = 0
        self._admitted = 0
        self._reasons: Counter[str] = Counter()
        self._grounding_scores: list[float] = []
        self._diversity_scores: list[float] = []

    def evaluate(
        self,
        example: GeneratedQaExample,
        source_chunk: MarkdownChunk | None,
        row: dict[str, object],
    ) -> SyntheticCandidateDecision:
        self._generated += 1
        reasons: list[str] = []
        if self._purpose_paths is None:
            required = _required_fields(self._task_type, self._task_recipe)
            if any(_missing(row.get(field)) for field in required):
                reasons.append("synthetic-schema-invalid")
        else:
            required_purposes = {
                "llm-instruction": ["instruction", "output"],
                "llm-classification": ["label"],
                "llm-extraction": ["expected-output"],
                "llm-embedding": ["anchor-text", "positive-text"],
                "llm-reranker": ["query", "passage"],
            }.get(self._task_type, [])
            try:
                purpose_values = [
                    read_purpose_value(row, self._purpose_paths[purpose])
                    for purpose in required_purposes
                ]
            except (KeyError, ValueError):
                purpose_values = [None]
            auxiliary_fields = []
            if self._task_type in {"llm-classification", "llm-extraction"}:
                auxiliary_fields.append(str(self._task_recipe.get("textField") or "text"))
            if self._task_type == "llm-reranker":
                auxiliary_fields.append(str(self._task_recipe.get("relevanceField") or "relevance"))
            if any(_missing(value) for value in purpose_values) or any(
                _missing(row.get(field)) for field in auxiliary_fields
            ):
                reasons.append("synthetic-schema-invalid")

        citation: dict[str, object] | None = None
        if (
            source_chunk is None
            or source_chunk.artifact_id != example.artifact_id
            or source_chunk.chunk_index != example.chunk_index
            or source_chunk.normalized_end <= source_chunk.normalized_start
        ):
            reasons.append("synthetic-citation-missing")
            source_text = ""
        else:
            source_text = source_chunk.text
            citation = {
                "sourceArtifactId": source_chunk.artifact_id,
                "chunkIndex": source_chunk.chunk_index,
                "normalizedStart": source_chunk.normalized_start,
                "normalizedEnd": source_chunk.normalized_end,
                "regionKind": source_chunk.region_kind,
                **(
                    {"pageNumber": source_chunk.page_number}
                    if source_chunk.page_number is not None
                    else {}
                ),
            }
            row["sourceCitation"] = citation

        grounding = _grounding_score(example.answer, source_text)
        minimum_grounding = float(self._config.minimumGroundingScore or 0.45)
        if grounding < minimum_grounding:
            reasons.append("synthetic-grounding-low")
        combined_text = f"{example.question}\n{example.answer}".strip()
        if _unsafe(combined_text):
            reasons.append("synthetic-safety-rejected")

        fingerprint = " ".join(combined_text.casefold().split())
        embedding = hashed_token_embedding(combined_text)
        maximum_similarity = max(
            (cosine_similarity(embedding, prior) for prior in self._embeddings),
            default=0.0,
        )
        diversity = 1.0 - max(0.0, maximum_similarity)
        if fingerprint in self._fingerprints:
            reasons.append("synthetic-duplicate")
        elif self._embeddings and diversity < float(
            self._config.minimumDiversityScore or 0.2
        ):
            reasons.append("synthetic-diversity-low")

        critic = (
            grounding * 0.6
            + (0.15 if example.question.strip().endswith("?") else 0.0)
            + (0.15 if 2 <= len(_tokens(example.answer)) <= 120 else 0.0)
            + (0.1 if citation is not None else 0.0)
        )
        if critic < float(self._config.minimumCriticScore or 0.6):
            reasons.append("synthetic-critic-rejected")

        ordered_reasons = list(dict.fromkeys(reasons))
        accepted = not ordered_reasons
        row["syntheticVerification"] = {
            "criticProvider": "deterministic-grounding-v1",
            "groundingScore": round(grounding, 4),
            "criticScore": round(critic, 4),
            "diversityScore": round(diversity, 4),
            "candidateIndex": example.candidate_index or 0,
            "status": "admitted" if accepted else "quarantined",
        }
        self._grounding_scores.append(grounding)
        self._diversity_scores.append(diversity)
        if accepted:
            self._admitted += 1
            self._fingerprints.add(fingerprint)
            self._embeddings.append(embedding)
        else:
            self._reasons.update(ordered_reasons)
        return SyntheticCandidateDecision(
            accepted=accepted,
            reason_codes=ordered_reasons,
            grounding_score=round(grounding, 4),
            critic_score=round(critic, 4),
            diversity_score=round(diversity, 4),
            row=row,
        )

    def report(self) -> dict[str, object]:
        return {
            "criticProvider": "deterministic-grounding-v1",
            "generatedCandidateCount": self._generated,
            "admittedCandidateCount": self._admitted,
            "quarantinedCandidateCount": self._generated - self._admitted,
            "meanGroundingScore": round(
                sum(self._grounding_scores) / max(1, len(self._grounding_scores)),
                4,
            ),
            "diversityScore": round(
                sum(self._diversity_scores) / max(1, len(self._diversity_scores)),
                4,
            ),
            "reasonCounts": dict(sorted(self._reasons.items())),
        }
