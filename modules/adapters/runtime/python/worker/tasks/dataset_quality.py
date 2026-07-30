from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from ..models import DatasetQualityRuntimeConfig

_PROVENANCE_FIELDS = {
    "artifactId",
    "sourceArtifactId",
    "sourceRowIndex",
    "chunkIndex",
    "generationMode",
    "split",
}
_EMAIL_PATTERN = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
_PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)")
_SSN_PATTERN = re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")
_SECRET_PATTERNS = (
    re.compile(r"\b(?:gh[pousr]_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}", re.IGNORECASE),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*[^\s,;]{8,}", re.IGNORECASE),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}", re.IGNORECASE),
)
_REASON_ORDER = (
    "mapping-required-fields-missing",
    "schema-invalid",
    "exact-duplicate",
    "fuzzy-duplicate",
    "text-too-short",
    "text-too-long",
    "language-not-allowed",
    "language-uncertain",
    "sensitive-personal-data",
    "secret-like-content",
    "unsafe-content",
    "benchmark-excluded",
    "source-not-allowed",
    "license-metadata-missing",
    "consent-metadata-missing",
    "source-row-limit",
)
_REASON_SUMMARIES = {
    "mapping-required-fields-missing": "required task fields were not found",
    "schema-invalid": "required task values were missing or invalid",
    "exact-duplicate": "the same training content was already accepted",
    "fuzzy-duplicate": "very similar training content was already accepted",
    "text-too-short": "the training text was too short",
    "text-too-long": "the training text was too long",
    "language-not-allowed": "the source language is not allowed",
    "language-uncertain": "the source language could not be determined safely",
    "sensitive-personal-data": "personal data may be present",
    "secret-like-content": "a credential or secret-like value may be present",
    "unsafe-content": "the row was marked unsafe by source metadata",
    "benchmark-excluded": "the row came from an excluded benchmark",
    "source-not-allowed": "the source is not permitted by policy",
    "license-metadata-missing": "required license information was missing",
    "consent-metadata-missing": "required consent information was missing",
    "source-row-limit": "the source exceeded its row limit",
}


@dataclass(frozen=True)
class DatasetQualityCurationResult:
    accepted_rows: list[dict[str, object]]
    quarantine_records: list[dict[str, object]]
    report: dict[str, object]


def curate_dataset_rows(
    rows: list[dict[str, object]],
    mapping_quarantine: list[dict[str, object]],
    source_inputs: list[Any],
    task_type: str,
    task_recipe: dict[str, Any],
    quality: DatasetQualityRuntimeConfig,
) -> DatasetQualityCurationResult:
    policy = quality.effectivePolicy
    source_metadata = {
        source.artifactId: dict(source.metadata or {}) for source in source_inputs
    }
    required_fields = _required_fields(task_type, task_recipe)
    accepted: list[dict[str, object]] = []
    quarantine: list[dict[str, object]] = [
        {
            "sourceArtifactId": str(record["sourceArtifactId"]),
            "sourceRowIndex": int(record["sourceRowIndex"]),
            "reasonCodes": ["mapping-required-fields-missing"],
            "row": _json_safe_record(record.get("row")),
        }
        for record in mapping_quarantine
    ]
    reason_counts: Counter[str] = Counter(
        {"mapping-required-fields-missing": len(mapping_quarantine)}
        if mapping_quarantine
        else {}
    )
    source_counts: Counter[str] = Counter(
        str(record["sourceArtifactId"]) for record in mapping_quarantine
    )
    language_counts: Counter[str] = Counter()
    class_counts: Counter[str] = Counter()
    rows_seen_per_source: Counter[str] = Counter()
    exact_fingerprints: set[str] = set()
    fuzzy_buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    accepted_simhashes: list[int] = []

    for fallback_index, row in enumerate(rows):
        source_id = _source_id(row)
        source_index = _source_row_index(row, fallback_index)
        source_counts[source_id] += 1
        rows_seen_per_source[source_id] += 1
        reasons: list[str] = []
        metadata = source_metadata.get(source_id, {})

        if any(_is_missing(row.get(field)) for field in required_fields):
            reasons.append("schema-invalid")
        if rows_seen_per_source[source_id] > policy.maxRowsPerSource:
            reasons.append("source-row-limit")
        if policy.requireLicenseMetadata and not _has_metadata_value(
            metadata, "license", "licenseId", "licenseName"
        ):
            reasons.append("license-metadata-missing")
        if policy.requireConsentMetadata and not _has_metadata_value(
            metadata, "consent", "consentStatus", "consentBasis"
        ):
            reasons.append("consent-metadata-missing")
        benchmark_id = _metadata_string(
            metadata, "benchmarkId", "benchmark", "datasetId"
        )
        if benchmark_id and benchmark_id in policy.excludedBenchmarkIds:
            reasons.append("benchmark-excluded")

        text = _row_text(row)
        if task_type.startswith("llm-"):
            if len(text) < policy.minimumTextCharacters:
                reasons.append("text-too-short")
            elif len(text) > policy.maximumTextCharacters:
                reasons.append("text-too-long")
            language = _resolve_language(metadata, text)
            language_counts[language] += 1
            if language == "und":
                reasons.append("language-uncertain")
            elif language not in policy.allowedLanguages:
                reasons.append("language-not-allowed")
        if _contains_sensitive_personal_data(text):
            reasons.append("sensitive-personal-data")
        if _contains_secret(text):
            reasons.append("secret-like-content")
        if _is_explicitly_unsafe(metadata, row):
            reasons.append("unsafe-content")

        content_fingerprint = _content_fingerprint(row)
        simhash_value: int | None = None
        if not reasons:
            if content_fingerprint in exact_fingerprints:
                reasons.append("exact-duplicate")
            else:
                simhash_value = _simhash(text)
                if simhash_value is not None and _has_fuzzy_duplicate(
                    simhash_value,
                    accepted_simhashes,
                    fuzzy_buckets,
                    policy.fuzzyDuplicateSimilarity,
                    policy.maxFuzzyCandidatesPerRow,
                ):
                    reasons.append("fuzzy-duplicate")

        if reasons:
            ordered_reasons = [
                reason for reason in _REASON_ORDER if reason in set(reasons)
            ]
            reason_counts.update(ordered_reasons)
            quarantine.append(
                {
                    "sourceArtifactId": source_id,
                    "sourceRowIndex": source_index,
                    "reasonCodes": ordered_reasons,
                    "row": _json_safe_record(row),
                }
            )
            continue

        accepted.append(row)
        exact_fingerprints.add(content_fingerprint)
        if simhash_value is not None:
            accepted_index = len(accepted_simhashes)
            accepted_simhashes.append(simhash_value)
            for band_key in _simhash_band_keys(simhash_value):
                bucket = fuzzy_buckets[band_key]
                if len(bucket) < policy.maxFuzzyCandidatesPerRow:
                    bucket.append(accepted_index)
        class_label = _class_label(row, task_type, task_recipe)
        if class_label is not None:
            class_counts[_sanitize_distribution_label(class_label)] += 1

    profile_rows = list(rows) + [
        record["row"]
        for record in mapping_quarantine
        if isinstance(record.get("row"), dict)
    ]
    missing_required_fields = [
        field
        for field in required_fields
        if not any(not _is_missing(row.get(field)) for row in rows)
    ]
    status = (
        "blocked"
        if not accepted
        else "needs-attention"
        if quarantine
        else "ready"
    )
    report: dict[str, object] = {
        "schemaVersion": "1",
        "status": status,
        "reportFingerprint": "",
        "policy": policy.model_dump(mode="json", by_alias=True),
        "mapping": {
            "taskType": task_type,
            "status": "incomplete" if mapping_quarantine else "complete",
            "mappedFields": sorted(
                {
                    field
                    for row in rows
                    for field in row
                    if field not in _PROVENANCE_FIELDS
                }
            )[:128],
            "missingRequiredFields": missing_required_fields,
        },
        "fields": _field_profiles(profile_rows),
        "distributions": {
            "sources": _counter_distribution(source_counts),
            **(
                {"classes": _counter_distribution(class_counts)}
                if class_counts
                else {}
            ),
            **(
                {"languages": _counter_distribution(language_counts)}
                if language_counts
                else {}
            ),
        },
        "counts": {
            "inputRows": len(rows) + len(mapping_quarantine),
            "acceptedRows": len(accepted),
            "quarantinedRows": len(quarantine),
        },
        "reasonCounts": {
            reason: reason_counts[reason]
            for reason in _REASON_ORDER
            if reason_counts[reason] > 0
        },
        "samples": _sanitized_samples(
            quarantine, policy.maxReportSamplesPerReason
        ),
        "reviewRequired": quality.reviewRequired,
        "approvalAllowed": bool(accepted),
    }
    report["reportFingerprint"] = hashlib.sha256(
        json.dumps(
            report,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return DatasetQualityCurationResult(accepted, quarantine, report)


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
        "diffusion-lora": [
            str(recipe.get("imageField") or "image"),
            str(recipe.get("captionField") or "caption"),
        ],
        "vision-classification": [
            str(recipe.get("imageField") or "image"),
            str(recipe.get("labelField") or "label"),
        ],
        "vision-detection": [
            str(recipe.get("imageField") or "image"),
            str(recipe.get("boundingBoxField") or "boundingBoxes"),
            str(recipe.get("labelField") or "labels"),
        ],
        "vision-segmentation": [
            str(recipe.get("imageField") or "image"),
            str(recipe.get("maskField") or "mask"),
        ],
    }.get(task_type, [])


def _row_text(row: dict[str, object]) -> str:
    values = [
        value
        for key, value in row.items()
        if key not in _PROVENANCE_FIELDS and isinstance(value, str)
    ]
    return "\n".join(values).strip()


def _content_fingerprint(row: dict[str, object]) -> str:
    content = {
        key: value for key, value in row.items() if key not in _PROVENANCE_FIELDS
    }
    return hashlib.sha256(
        json.dumps(
            content,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()


def _simhash(text: str) -> int | None:
    tokens = re.findall(r"\w+", text.casefold())
    if len(tokens) < 5:
        return None
    weights = [0] * 64
    for token in tokens:
        digest = int.from_bytes(
            hashlib.sha256(token.encode("utf-8")).digest()[:8], "big"
        )
        for bit in range(64):
            weights[bit] += 1 if digest & (1 << bit) else -1
    result = 0
    for bit, weight in enumerate(weights):
        if weight >= 0:
            result |= 1 << bit
    return result


def _simhash_band_keys(value: int) -> list[tuple[int, int]]:
    mask = (1 << 8) - 1
    return [(band, (value >> (band * 8)) & mask) for band in range(8)]


def _has_fuzzy_duplicate(
    value: int,
    accepted: list[int],
    buckets: dict[tuple[int, int], list[int]],
    threshold: float,
    maximum_candidates: int,
) -> bool:
    candidate_indices: list[int] = []
    seen: set[int] = set()
    for key in _simhash_band_keys(value):
        for index in buckets.get(key, []):
            if index not in seen:
                seen.add(index)
                candidate_indices.append(index)
                if len(candidate_indices) >= maximum_candidates:
                    break
        if len(candidate_indices) >= maximum_candidates:
            break
    for index in candidate_indices:
        similarity = 1.0 - ((value ^ accepted[index]).bit_count() / 64.0)
        if similarity >= threshold:
            return True
    return False


def _field_profiles(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    fields = sorted(
        {
            str(field)
            for row in rows
            for field in row
            if str(field) not in _PROVENANCE_FIELDS
        }
    )[:128]
    profiles: list[dict[str, object]] = []
    for field in fields:
        values = [row.get(field) for row in rows if not _is_missing(row.get(field))]
        value_types = {_value_type(value) for value in values}
        profiles.append(
            {
                "field": field[:128],
                "valueType": (
                    next(iter(value_types))
                    if len(value_types) == 1
                    else "mixed"
                ),
                "presentCount": len(values),
                "missingCount": len(rows) - len(values),
                "distinctCount": len(
                    {
                        json.dumps(
                            value,
                            ensure_ascii=False,
                            sort_keys=True,
                            default=str,
                        )
                        for value in values
                    }
                ),
            }
        )
    return profiles


def _value_type(value: object) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "mixed"


def _counter_distribution(counter: Counter[str]) -> list[dict[str, object]]:
    ordered = sorted(counter.items(), key=lambda item: (-item[1], item[0]))
    limited = ordered[:50]
    result = [{"label": label[:128], "count": count} for label, count in limited]
    omitted_count = sum(count for _, count in ordered[50:])
    if omitted_count:
        result.append({"label": "Other", "count": omitted_count})
    return result


def _sanitized_samples(
    quarantine: list[dict[str, object]], maximum_per_reason: int
) -> list[dict[str, object]]:
    samples: list[dict[str, object]] = []
    counts: Counter[str] = Counter()
    for record in quarantine:
        reasons = [
            str(reason)
            for reason in record.get("reasonCodes", [])
            if str(reason) in _REASON_SUMMARIES
        ]
        if not reasons or not any(
            counts[reason] < maximum_per_reason for reason in reasons
        ):
            continue
        for reason in reasons:
            if counts[reason] < maximum_per_reason:
                counts[reason] += 1
        row = record.get("row")
        field_names = (
            sorted(str(field)[:128] for field in row)[:32]
            if isinstance(row, dict)
            else []
        )
        samples.append(
            {
                "sourceArtifactId": str(record["sourceArtifactId"]),
                "sourceRowIndex": int(record["sourceRowIndex"]),
                "reasonCodes": reasons,
                "fieldNames": field_names,
                "summary": "Moved to quarantine because "
                + "; ".join(_REASON_SUMMARIES[reason] for reason in reasons)
                + ".",
            }
        )
    return samples


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


def _metadata_string(metadata: dict[str, Any], *fields: str) -> str | None:
    for field in fields:
        value = metadata.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _has_metadata_value(metadata: dict[str, Any], *fields: str) -> bool:
    return any(metadata.get(field) not in (None, "", False) for field in fields)


def _resolve_language(metadata: dict[str, Any], text: str) -> str:
    explicit = _metadata_string(metadata, "language", "languageCode", "lang")
    if explicit:
        return explicit
    letters = [character for character in text if character.isalpha()]
    if len(letters) < 8:
        return "und"
    latin = sum(
        1
        for character in letters
        if "LATIN" in unicodedata.name(character, "")
    )
    return "en" if latin / len(letters) >= 0.9 else "und"


def _contains_sensitive_personal_data(text: str) -> bool:
    return any(
        pattern.search(text)
        for pattern in (_EMAIL_PATTERN, _PHONE_PATTERN, _SSN_PATTERN)
    )


def _contains_secret(text: str) -> bool:
    return any(pattern.search(text) for pattern in _SECRET_PATTERNS)


def _is_explicitly_unsafe(
    metadata: dict[str, Any], row: dict[str, object]
) -> bool:
    metadata_value = metadata.get("unsafe")
    safety_status = _metadata_string(metadata, "safetyStatus", "safety")
    row_status = row.get("safetyStatus")
    return (
        metadata_value is True
        or (safety_status is not None and safety_status.casefold() == "unsafe")
        or (isinstance(row_status, str) and row_status.casefold() == "unsafe")
        or "[unsafe-content]" in _row_text(row).casefold()
    )


def _class_label(
    row: dict[str, object], task_type: str, recipe: dict[str, Any]
) -> str | None:
    field = None
    if task_type in {"llm-classification", "vision-classification"}:
        field = str(recipe.get("labelField") or "label")
    elif task_type == "llm-reranker":
        field = str(recipe.get("relevanceField") or "relevance")
    if field is None or _is_missing(row.get(field)):
        return None
    return str(row[field])


def _sanitize_distribution_label(value: str) -> str:
    normalized = value.strip()[:128]
    if _contains_sensitive_personal_data(normalized) or _contains_secret(normalized):
        return "Redacted value"
    return normalized or "Blank"


def _json_safe_record(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _is_missing(value: object) -> bool:
    return value is None or value == "" or value == [] or value == {}
