from __future__ import annotations

import csv
import json
import os
import random
import tempfile
from pathlib import Path, PurePath
from typing import Any, Callable

from ..models import (
    DatasetPreparationSummary,
    DatasetPreparationWarning,
    PrepareTrainingDatasetRequest,
    PrepareTrainingDatasetResult,
    PythonRuntimeOutputDescriptor,
)
from .document_normalization import normalize_sources_to_markdown
from .example_generation import (
    GeneratedQaExample,
    ensure_generation_model_is_available,
    generate_qa_examples_for_chunks,
    generate_text_value,
)
from .markdown_chunking import chunk_markdown_documents

DEFAULT_MAX_CHUNK_COUNT = 10000
SUPPORTED_RUNTIME_TASK_TYPES = {
    "llm-instruction",
    "llm-classification",
    "llm-extraction",
    "llm-embedding",
    "llm-reranker",
    "diffusion-lora",
    "vision-classification",
    "vision-detection",
    "vision-segmentation",
}
TEXT_GENERATED_TASK_TYPES = {
    "llm-instruction",
    "llm-classification",
    "llm-extraction",
    "llm-embedding",
    "llm-reranker",
}
IMAGE_MANIFEST_TASK_TYPES = {
    "diffusion-lora",
    "vision-classification",
    "vision-detection",
    "vision-segmentation",
}
DEFAULT_RUNTIME_TASK_TYPE = "llm-instruction"
STRUCTURED_SOURCE_SUFFIXES = {".csv", ".json", ".jsonl"}
IMAGE_SOURCE_SUFFIXES = {".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}


class DatasetPreparationStageError(ValueError):
    def __init__(
        self,
        stage: str,
        message: str,
        error_code: str,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.error_code = error_code
        self.details = details


def _validate_split_config(train_ratio: float, test_ratio: float) -> None:
    if train_ratio <= 0:
        raise ValueError("split.trainRatio must be greater than 0")
    if test_ratio <= 0:
        raise ValueError("split.testRatio must be greater than 0")
    if abs((train_ratio + test_ratio) - 1.0) > 1e-6:
        raise ValueError("split.trainRatio + split.testRatio must equal 1.0")

def _validate_generated_rows(total_rows: int, chunk_count: int) -> None:
    if total_rows > 0:
        return

    raise DatasetPreparationStageError(
        "generation",
        (
            "No training examples were generated from the normalized chunks. "
            f"Processed {chunk_count} chunk(s), but generation produced 0 row(s). "
            "Check source content, chunking settings, and generation model configuration."
        ),
        "generation_no_examples",
        details={
            "chunkCount": chunk_count,
            "generatedRowCount": total_rows,
        },
    )


def _resolve_task_recipe(payload: PrepareTrainingDatasetRequest) -> tuple[str, dict[str, Any]]:
    task = payload.recipe.task if isinstance(payload.recipe.task, dict) else {}
    raw_task_type = task.get("taskType", DEFAULT_RUNTIME_TASK_TYPE)
    task_type = str(raw_task_type).strip().lower() if raw_task_type is not None else DEFAULT_RUNTIME_TASK_TYPE
    if not task_type:
        task_type = DEFAULT_RUNTIME_TASK_TYPE

    if task_type not in SUPPORTED_RUNTIME_TASK_TYPES:
        raise DatasetPreparationStageError(
            "generation",
            (
                f"Dataset preparation task type '{task_type}' is not supported by this runtime yet. "
                f"Supported task types: {', '.join(sorted(SUPPORTED_RUNTIME_TASK_TYPES))}."
            ),
            "dataset_preparation_task_unsupported",
            details={
                "taskType": task_type,
                "supportedTaskTypes": sorted(SUPPORTED_RUNTIME_TASK_TYPES),
            },
        )

    return task_type, task


def _source_extension(source: Any) -> str:
    if source.originalName:
        original_extension = Path(source.originalName).suffix.lower()
        if original_extension:
            return original_extension
    return Path(source.localPath).suffix.lower()


def _is_structured_source(source: Any) -> bool:
    media_type = (source.mediaType or "").lower()
    return (
        _source_extension(source) in STRUCTURED_SOURCE_SUFFIXES
        or media_type in {"application/json", "text/json", "application/x-ndjson", "application/jsonl", "text/csv", "application/csv"}
    )


def _is_image_source(source: Any) -> bool:
    media_type = (source.mediaType or "").lower()
    return media_type.startswith("image/") or _source_extension(source) in IMAGE_SOURCE_SUFFIXES


def _read_structured_source_rows(source: Any) -> list[dict[str, Any]]:
    path = Path(source.localPath)
    suffix = _source_extension(source)
    if suffix == ".csv" or (source.mediaType or "").lower() in {"text/csv", "application/csv"}:
        with path.open("r", encoding="utf-8", newline="") as handle:
            return [dict(row) for row in csv.DictReader(handle)]

    text = path.read_text(encoding="utf-8")
    if suffix == ".jsonl" or (source.mediaType or "").lower() in {"application/x-ndjson", "application/jsonl"}:
        rows: list[dict[str, Any]] = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            parsed = json.loads(stripped)
            if isinstance(parsed, dict):
                rows.append(parsed)
        return rows

    parsed = json.loads(text)
    if isinstance(parsed, list):
        return [row for row in parsed if isinstance(row, dict)]
    if isinstance(parsed, dict):
        for key in ["rows", "data", "items", "examples", "annotations"]:
            candidate = parsed.get(key)
            if isinstance(candidate, list):
                return [row for row in candidate if isinstance(row, dict)]
        return [parsed]
    return []


def _first_present(row: dict[str, Any], *field_names: str) -> Any:
    for field_name in field_names:
        if field_name in row and row[field_name] not in (None, ""):
            return row[field_name]
    return None


def _string_or_none(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    return str(value)


def _jsonish_or_string(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return json.loads(stripped)
        except Exception:
            return stripped
    return value


def _source_label(source: Any) -> str:
    if source.originalName:
        stem = PurePath(source.originalName).stem
    else:
        stem = Path(source.localPath).stem
    return stem.replace("_", " ").replace("-", " ").strip() or source.artifactId


def _source_metadata(source: Any) -> dict[str, Any]:
    return source.metadata if isinstance(source.metadata, dict) else {}


def _row_with_source(row: dict[str, Any], source_artifact_id: str, row_index: int | None = None) -> dict[str, Any]:
    enriched = dict(row)
    enriched.setdefault("sourceArtifactId", source_artifact_id)
    if row_index is not None:
        enriched.setdefault("sourceRowIndex", row_index)
    return enriched


def _resolve_text_input_mode(task_type: str, task_recipe: dict[str, Any]) -> str:
    raw_mode = str(task_recipe.get("textInputMode") or "").strip().lower()
    if raw_mode in {"provided", "generate"}:
        return raw_mode
    return "generate" if task_type in TEXT_GENERATED_TASK_TYPES else "provided"


def _resolve_generation_failure_policy(payload: PrepareTrainingDatasetRequest) -> str:
    failure_policy = payload.recipe.generation.failurePolicy
    if failure_policy:
        return failure_policy
    normalization_mode = payload.recipe.normalization.normalizationMode or "strict"
    return "skip" if normalization_mode == "best-effort" else "fail"


def _label_set(task_recipe: dict[str, Any]) -> list[str]:
    raw_label_set = task_recipe.get("labelSet")
    if not isinstance(raw_label_set, list):
        return []
    return [str(label).strip() for label in raw_label_set if str(label).strip()]


def _select_allowed_label(generated_label: str, label_set: list[str]) -> str:
    if not label_set:
        return generated_label
    normalized_generated_label = generated_label.strip().lower()
    for label in label_set:
        normalized_label = label.lower()
        if normalized_generated_label == normalized_label or normalized_label in normalized_generated_label:
            return label
    return label_set[0]


def _format_prompt_context_value(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _clean_generated_text_value(value: str, max_length: int = 500) -> str:
    candidate = value.replace("\r", "\n").strip()
    for prefix in ("caption:", "label:", "answer:", "output:", "text:"):
        if candidate.lower().startswith(prefix):
            candidate = candidate[len(prefix) :].strip()
            break
    candidate = next((line.strip() for line in candidate.splitlines() if line.strip()), candidate)
    return candidate[:max_length].strip()


def _build_text_value_prompt(
    payload: PrepareTrainingDatasetRequest,
    task_type: str,
    task_recipe: dict[str, Any],
    source: Any,
    field_kind: str,
    existing_text: Any | None = None,
    extra_context: dict[str, Any] | None = None,
) -> str:
    prompt_template = (payload.recipe.generation.promptTemplate or "").strip() or (
        "Create the requested short text field for a training dataset. "
        "Use only the provided file name, metadata, annotations, and task settings."
    )
    metadata = _source_metadata(source)
    lines = [
        prompt_template,
        "",
        f"Task type: {task_type}",
        f"Text field to create: {field_kind}",
        f"Artifact id: {source.artifactId}",
        f"File name: {source.originalName or Path(source.localPath).name}",
        f"Media type: {source.mediaType or 'unknown'}",
    ]
    if metadata:
        lines.append(f"Metadata: {_format_prompt_context_value(metadata)}")
    label_set = _label_set(task_recipe)
    if label_set:
        lines.append(f"Allowed labels: {', '.join(label_set)}")
    if existing_text is not None:
        lines.append(f"Existing text hint: {_format_prompt_context_value(existing_text)}")
    if extra_context:
        for key, value in extra_context.items():
            if value not in (None, ""):
                lines.append(f"{key}: {_format_prompt_context_value(value)}")
    lines.append("")
    lines.append("Return only the requested text field. Do not include explanations or formatting.")
    return "\n".join(lines)


def _generate_text_field(
    payload: PrepareTrainingDatasetRequest,
    task_type: str,
    task_recipe: dict[str, Any],
    source: Any,
    field_kind: str,
    text_value_generator: Callable[[str, object], str],
    warnings: list[DatasetPreparationWarning],
    existing_text: Any | None = None,
    extra_context: dict[str, Any] | None = None,
) -> str | None:
    prompt = _build_text_value_prompt(
        payload,
        task_type,
        task_recipe,
        source,
        field_kind,
        existing_text=existing_text,
        extra_context=extra_context,
    )
    try:
        generated = _clean_generated_text_value(text_value_generator(prompt, payload.recipe.generation))
    except Exception as error:
        formatted_error = _format_generation_error(error)
        if _resolve_generation_failure_policy(payload) == "skip":
            warnings.append(
                DatasetPreparationWarning(
                    code="text_generation_skipped",
                    message=f"Skipped generated {field_kind} for source '{source.artifactId}': {formatted_error}",
                    sourceArtifactId=source.artifactId,
                )
            )
            return None
        raise DatasetPreparationStageError(
            "generation",
            formatted_error,
            "text_generation_failed",
            details={
                "taskType": task_type,
                "fieldKind": field_kind,
                "sourceArtifactId": source.artifactId,
            },
        ) from error

    if generated:
        return generated
    if _resolve_generation_failure_policy(payload) == "skip":
        warnings.append(
            DatasetPreparationWarning(
                code="text_generation_skipped",
                message=f"Skipped generated {field_kind} for source '{source.artifactId}': generation returned an empty value.",
                sourceArtifactId=source.artifactId,
            )
        )
        return None
    raise DatasetPreparationStageError(
        "generation",
        f"Generated {field_kind} for source '{source.artifactId}' was empty.",
        "text_generation_empty",
        details={
            "taskType": task_type,
            "fieldKind": field_kind,
            "sourceArtifactId": source.artifactId,
        },
    )


def _map_structured_row(task_type: str, task_recipe: dict[str, Any], row: dict[str, Any], source: Any, row_index: int) -> dict[str, Any] | None:
    if task_type == "llm-instruction":
        instruction = _first_present(row, "instruction", "prompt", "question")
        output = _first_present(row, "output", "completion", "answer", "response")
        if instruction is None or output is None:
            return None
        input_value = _first_present(row, "input", "context", "sourceContext", "text")
        return _row_with_source(
            {
                "instruction": instruction,
                "input": input_value or "",
                "output": output,
                "prompt": _first_present(row, "prompt", "question", "instruction") or instruction,
                "completion": _first_present(row, "completion", "answer", "output") or output,
            },
            source.artifactId,
            row_index,
        )

    if task_type == "llm-classification":
        text_field = str(task_recipe.get("textField") or "text")
        label_field = str(task_recipe.get("labelField") or "label")
        text = _first_present(row, text_field, "text", "input", "content", "document")
        label = _first_present(row, label_field, "label", "class", "category", "target")
        if text is None or label is None:
            return None
        return _row_with_source({text_field: text, label_field: label}, source.artifactId, row_index)

    if task_type == "llm-extraction":
        text_field = str(task_recipe.get("textField") or "text")
        output_field = str(task_recipe.get("outputField") or "expectedOutput")
        text = _first_present(row, text_field, "text", "input", "content", "document")
        expected_output = _first_present(row, output_field, "expectedOutput", "output", "extraction", "entities")
        if text is None or expected_output is None:
            return None
        mapped = {text_field: text, output_field: _jsonish_or_string(expected_output)}
        schema_value = _first_present(row, "schema", "jsonSchema")
        if schema_value is not None:
            mapped["schema"] = _jsonish_or_string(schema_value)
        return _row_with_source(mapped, source.artifactId, row_index)

    if task_type == "llm-embedding":
        anchor_field = str(task_recipe.get("anchorTextField") or "anchorText")
        positive_field = str(task_recipe.get("positiveTextField") or "positiveText")
        negative_field = str(task_recipe.get("negativeTextField") or "negativeText")
        anchor = _first_present(row, anchor_field, "anchorText", "anchor", "query", "text")
        positive = _first_present(row, positive_field, "positiveText", "positive", "match", "pairedText")
        if anchor is None or positive is None:
            return None
        mapped = {anchor_field: anchor, positive_field: positive}
        negative = _first_present(row, negative_field, "negativeText", "negative", "hardNegative")
        if negative is not None:
            mapped[negative_field] = negative
        return _row_with_source(mapped, source.artifactId, row_index)

    if task_type == "llm-reranker":
        query_field = str(task_recipe.get("queryField") or "query")
        passage_field = str(task_recipe.get("passageField") or "passage")
        relevance_field = str(task_recipe.get("relevanceField") or "relevance")
        query = _first_present(row, query_field, "query", "question")
        passage = _first_present(row, passage_field, "passage", "document", "text", "content")
        relevance = _first_present(row, relevance_field, "relevance", "score", "label")
        if query is None or passage is None or relevance is None:
            return None
        mapped = {query_field: query, passage_field: passage, relevance_field: relevance}
        negative = _first_present(row, str(task_recipe.get("negativePassageField") or "negativePassage"), "negativePassage", "negative")
        if negative is not None:
            mapped[str(task_recipe.get("negativePassageField") or "negativePassage")] = negative
        return _row_with_source(mapped, source.artifactId, row_index)

    if task_type == "diffusion-lora":
        image_field = str(task_recipe.get("imageField") or "image")
        caption_field = str(task_recipe.get("captionField") or "caption")
        image = _first_present(row, image_field, "image", "imagePath", "imageArtifactId", "file")
        caption = _first_present(row, caption_field, "caption", "prompt", "description", "text")
        if image is None or caption is None:
            return None
        return _row_with_source({image_field: image, caption_field: caption}, source.artifactId, row_index)

    if task_type == "vision-classification":
        image_field = str(task_recipe.get("imageField") or "image")
        label_field = str(task_recipe.get("labelField") or "label")
        image = _first_present(row, image_field, "image", "imagePath", "imageArtifactId", "file")
        label = _first_present(row, label_field, "label", "class", "category", "target")
        if image is None or label is None:
            return None
        return _row_with_source({image_field: image, label_field: label}, source.artifactId, row_index)

    if task_type == "vision-detection":
        image_field = str(task_recipe.get("imageField") or "image")
        box_field = str(task_recipe.get("boundingBoxField") or "boundingBoxes")
        label_field = str(task_recipe.get("labelField") or "labels")
        image = _first_present(row, image_field, "image", "imagePath", "imageArtifactId", "file")
        boxes = _first_present(row, box_field, "boundingBoxes", "boxes", "bbox", "annotations")
        labels = _first_present(row, label_field, "labels", "label", "classes", "categories")
        if image is None or boxes is None:
            return None
        mapped = {image_field: image, box_field: _jsonish_or_string(boxes)}
        if labels is not None:
            mapped[label_field] = _jsonish_or_string(labels)
        mapped["boxFormat"] = task_recipe.get("boxFormat") or row.get("boxFormat") or "coco"
        return _row_with_source(mapped, source.artifactId, row_index)

    if task_type == "vision-segmentation":
        image_field = str(task_recipe.get("imageField") or "image")
        mask_field = str(task_recipe.get("maskField") or "mask")
        label_field = str(task_recipe.get("labelField") or "label")
        image = _first_present(row, image_field, "image", "imagePath", "imageArtifactId", "file")
        mask = _first_present(row, mask_field, "mask", "maskPath", "maskArtifactId", "polygon", "segmentation")
        if image is None or mask is None:
            return None
        mapped = {image_field: image, mask_field: _jsonish_or_string(mask)}
        label = _first_present(row, label_field, "label", "class", "category")
        if label is not None:
            mapped[label_field] = label
        mapped["maskFormat"] = task_recipe.get("maskFormat") or row.get("maskFormat") or "png"
        return _row_with_source(mapped, source.artifactId, row_index)

    return None


def _load_structured_task_rows(payload: PrepareTrainingDatasetRequest, task_type: str, task_recipe: dict[str, Any]) -> tuple[list[dict[str, Any]], set[str], list[DatasetPreparationWarning]]:
    rows: list[dict[str, Any]] = []
    consumed_artifact_ids: set[str] = set()
    warnings: list[DatasetPreparationWarning] = []
    for source in payload.sourceInputs:
        if not _is_structured_source(source):
            continue
        try:
            source_rows = _read_structured_source_rows(source)
        except Exception as error:
            warnings.append(
                DatasetPreparationWarning(
                    code="structured_source_read_failed",
                    message=f"Could not read structured source '{source.artifactId}': {error}",
                    sourceArtifactId=source.artifactId,
                )
            )
            continue
        mapped_rows = [
            mapped
            for index, row in enumerate(source_rows)
            if (mapped := _map_structured_row(task_type, task_recipe, row, source, index)) is not None
        ]
        if mapped_rows:
            rows.extend(mapped_rows)
            consumed_artifact_ids.add(source.artifactId)
        else:
            warnings.append(
                DatasetPreparationWarning(
                    code="structured_source_missing_task_fields",
                    message=f"Structured source '{source.artifactId}' did not include the fields needed for {task_type}.",
                    sourceArtifactId=source.artifactId,
                )
            )
    return rows, consumed_artifact_ids, warnings


def _build_direct_image_rows(
    payload: PrepareTrainingDatasetRequest,
    task_type: str,
    task_recipe: dict[str, Any],
    consumed_artifact_ids: set[str],
    text_value_generator: Callable[[str, object], str],
) -> tuple[list[dict[str, Any]], list[DatasetPreparationWarning]]:
    rows: list[dict[str, Any]] = []
    warnings: list[DatasetPreparationWarning] = []
    text_input_mode = _resolve_text_input_mode(task_type, task_recipe)
    should_generate_text = text_input_mode == "generate"
    label_set = _label_set(task_recipe)
    for source in payload.sourceInputs:
        if source.artifactId in consumed_artifact_ids or not _is_image_source(source):
            continue
        metadata = _source_metadata(source)
        label = _string_or_none(_first_present(metadata, "label", "class", "category", "target")) or _source_label(source)
        caption = _string_or_none(_first_present(metadata, "caption", "prompt", "description", "altText"))
        trigger_token = _string_or_none(task_recipe.get("triggerToken"))
        if not caption:
            caption = f"{trigger_token} {_source_label(source)}".strip() if trigger_token else _source_label(source)

        if task_type == "diffusion-lora":
            if should_generate_text:
                generated_caption = _generate_text_field(
                    payload,
                    task_type,
                    task_recipe,
                    source,
                    "caption",
                    text_value_generator,
                    warnings,
                    existing_text=caption,
                    extra_context={
                        "Concept kind": task_recipe.get("conceptKind") or "subject",
                        "Trigger token": trigger_token,
                        "Regularization class": task_recipe.get("regularizationClass"),
                    },
                )
                if generated_caption is None:
                    continue
                caption = generated_caption
            rows.append(
                _row_with_source(
                    {
                        str(task_recipe.get("imageField") or "image"): source.artifactId,
                        str(task_recipe.get("captionField") or "caption"): caption,
                        "conceptKind": task_recipe.get("conceptKind") or "subject",
                        **({"triggerToken": trigger_token} if trigger_token else {}),
                        **({"regularizationClass": task_recipe.get("regularizationClass")} if task_recipe.get("regularizationClass") else {}),
                    },
                    source.artifactId,
                )
            )
        elif task_type == "vision-classification":
            if should_generate_text:
                generated_label = _generate_text_field(
                    payload,
                    task_type,
                    task_recipe,
                    source,
                    "classification label",
                    text_value_generator,
                    warnings,
                    existing_text=label,
                )
                if generated_label is None:
                    continue
                label = _select_allowed_label(generated_label, label_set)
            rows.append(
                _row_with_source(
                    {
                        str(task_recipe.get("imageField") or "image"): source.artifactId,
                        str(task_recipe.get("labelField") or "label"): label,
                        **({"labelSet": label_set} if label_set else {}),
                    },
                    source.artifactId,
                )
            )
        elif task_type == "vision-detection":
            boxes = _first_present(metadata, "boundingBoxes", "boxes", "bbox", "annotations")
            labels = _first_present(metadata, "labels", "label", "classes", "categories")
            if boxes is None:
                warnings.append(
                    DatasetPreparationWarning(
                        code="image_annotations_missing",
                        message=f"Image source '{source.artifactId}' is missing bounding box annotations for object detection.",
                        sourceArtifactId=source.artifactId,
                    )
                )
                continue
            if should_generate_text:
                generated_label = _generate_text_field(
                    payload,
                    task_type,
                    task_recipe,
                    source,
                    "object label",
                    text_value_generator,
                    warnings,
                    existing_text=labels,
                    extra_context={
                        "Bounding boxes": boxes,
                        "Box format": task_recipe.get("boxFormat") or "coco",
                    },
                )
                if generated_label is None:
                    continue
                labels = _select_allowed_label(generated_label, label_set)
            row = {
                str(task_recipe.get("imageField") or "image"): source.artifactId,
                str(task_recipe.get("boundingBoxField") or "boundingBoxes"): _jsonish_or_string(boxes),
                "boxFormat": task_recipe.get("boxFormat") or "coco",
            }
            if labels is not None:
                row[str(task_recipe.get("labelField") or "labels")] = _jsonish_or_string(labels)
            if label_set:
                row["labelSet"] = label_set
            rows.append(_row_with_source(row, source.artifactId))
        elif task_type == "vision-segmentation":
            mask = _first_present(metadata, "mask", "maskPath", "maskArtifactId", "polygon", "segmentation")
            if mask is None:
                warnings.append(
                    DatasetPreparationWarning(
                        code="image_annotations_missing",
                        message=f"Image source '{source.artifactId}' is missing mask annotations for segmentation.",
                        sourceArtifactId=source.artifactId,
                    )
                )
                continue
            if should_generate_text:
                generated_label = _generate_text_field(
                    payload,
                    task_type,
                    task_recipe,
                    source,
                    "segmentation label",
                    text_value_generator,
                    warnings,
                    existing_text=label,
                    extra_context={
                        "Mask": mask,
                        "Mask format": task_recipe.get("maskFormat") or "png",
                    },
                )
                if generated_label is None:
                    continue
                label = _select_allowed_label(generated_label, label_set)
            rows.append(
                _row_with_source(
                    {
                        str(task_recipe.get("imageField") or "image"): source.artifactId,
                        str(task_recipe.get("maskField") or "mask"): _jsonish_or_string(mask),
                        str(task_recipe.get("labelField") or "label"): label,
                        "maskFormat": task_recipe.get("maskFormat") or "png",
                        **({"labelSet": label_set} if label_set else {}),
                    },
                    source.artifactId,
                )
            )
    return rows, warnings


def _row_fieldnames(rows: list[dict[str, object]], task_type: str) -> list[str]:
    preferred_by_task = {
        "llm-instruction": ["artifactId", "chunkIndex", "instruction", "input", "output", "prompt", "completion", "question", "answer", "generationMode", "sourceArtifactId", "sourceRowIndex"],
        "llm-classification": ["text", "label", "labelSet", "multiLabel", "sourceArtifactId", "sourceRowIndex", "chunkIndex"],
        "llm-extraction": ["text", "schema", "expectedOutput", "strictSchema", "sourceArtifactId", "sourceRowIndex", "chunkIndex"],
        "llm-embedding": ["anchorText", "positiveText", "negativeText", "sourceArtifactId", "sourceRowIndex", "chunkIndex"],
        "llm-reranker": ["query", "passage", "relevance", "negativePassage", "sourceArtifactId", "sourceRowIndex", "chunkIndex"],
        "diffusion-lora": ["image", "caption", "triggerToken", "conceptKind", "regularizationClass", "sourceArtifactId", "sourceRowIndex"],
        "vision-classification": ["image", "label", "labelSet", "sourceArtifactId", "sourceRowIndex"],
        "vision-detection": ["image", "boundingBoxes", "labels", "boxFormat", "sourceArtifactId", "sourceRowIndex"],
        "vision-segmentation": ["image", "mask", "label", "maskFormat", "sourceArtifactId", "sourceRowIndex"],
    }
    ordered = list(preferred_by_task.get(task_type, []))
    seen = set(ordered)
    for row in rows:
        for key in row.keys():
            if key not in seen:
                ordered.append(key)
                seen.add(key)
    return [field for field in ordered if any(field in row for row in rows)]


def _log_generation_failure_diagnostics(
    raw_data: dict[str, Any],
    prepared_data: dict[str, Any],
    errors: list[str],
) -> None:
    print(
        json.dumps(
            {
                "event": "runtime.dataset_preparation.generation.failed",
                "rawData": raw_data,
                "preparedData": prepared_data,
                "errors": errors,
            },
            ensure_ascii=False,
            default=str,
        ),
        flush=True,
    )


def _format_generation_error(error: Exception) -> str:
    message = str(error).strip()
    if message:
        return message
    return error.__class__.__name__


def _emit_rows(
    rows: list[dict[str, object]],
    output_format: str,
    role: str,
    base_name: str,
    metadata: dict[str, object],
    task_type: str,
    output_directory: Path | None = None,
) -> PythonRuntimeOutputDescriptor:
    suffix = {"jsonl": ".jsonl", "json": ".json", "csv": ".csv", "parquet": ".parquet"}[output_format]
    fd, temp_path = tempfile.mkstemp(
        prefix=f"{base_name}-{role}-",
        suffix=suffix,
        dir=str(output_directory) if output_directory is not None else None,
    )
    path = Path(temp_path)

    try:
        if output_format == "jsonl":
            path.write_text(
                "\n".join(json.dumps(row, ensure_ascii=False) for row in rows),
                encoding="utf-8",
            )
        elif output_format == "json":
            path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        elif output_format == "csv":
            with path.open("w", encoding="utf-8", newline="") as handle:
                fieldnames = _row_fieldnames(rows, task_type)
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                for row in rows:
                    writer.writerow({
                        key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
                        for key, value in row.items()
                    })
        else:
            try:
                import pyarrow as pa
                import pyarrow.parquet as pq
            except ImportError as error:
                raise RuntimeError(
                    "The 'pyarrow' package is required for output.format='parquet'."
                ) from error

            table = pa.Table.from_pylist(rows)
            pq.write_table(table, path)
    finally:
        os.close(fd)

    media_type = {
        "jsonl": "application/x-ndjson",
        "json": "application/json",
        "csv": "text/csv",
        "parquet": "application/x-parquet",
    }[output_format]

    return PythonRuntimeOutputDescriptor(
        name=base_name if role == "dataset" else f"{base_name}-{role}",
        role=role,
        outputHandle=path.name,
        tempPath=temp_path,
        mediaType=media_type,
        sizeBytes=path.stat().st_size,
        metadata=metadata,
    )


def _build_generated_task_row(
    task_type: str,
    task_recipe: dict[str, Any],
    example: GeneratedQaExample,
    source_chunk: Any | None,
    next_chunk: Any | None,
) -> dict[str, object]:
    source_text = source_chunk.text if source_chunk is not None else example.answer
    row_context = {
        "sourceArtifactId": example.artifact_id,
        "chunkIndex": example.chunk_index,
        "generationMode": example.generation_mode,
    }

    if task_type == "llm-instruction":
        return {
            "artifactId": example.artifact_id,
            "chunkIndex": example.chunk_index,
            "instruction": "Answer the user question using only the provided context.",
            "input": example.question,
            "output": example.answer,
            "prompt": example.question,
            "completion": example.answer,
            "question": example.question,
            "answer": example.answer,
            "generationMode": example.generation_mode,
        }

    if task_type == "llm-classification":
        text_field = str(task_recipe.get("textField") or "text")
        label_field = str(task_recipe.get("labelField") or "label")
        label_set = task_recipe.get("labelSet") if isinstance(task_recipe.get("labelSet"), list) else None
        generated_label = example.answer.strip().splitlines()[0][:120] or "generated-label"
        if label_set:
            normalized_generated_label = generated_label.lower()
            selected_label = next(
                (
                    str(label)
                    for label in label_set
                    if str(label).strip().lower() in normalized_generated_label
                ),
                str(label_set[0]),
            )
        else:
            selected_label = generated_label
        return {
            text_field: source_text,
            label_field: selected_label,
            **({"labelSet": label_set} if label_set else {}),
            "multiLabel": bool(task_recipe.get("multiLabel", False)),
            **row_context,
        }

    if task_type == "llm-extraction":
        text_field = str(task_recipe.get("textField") or "text")
        output_field = str(task_recipe.get("outputField") or "expectedOutput")
        return {
            text_field: source_text,
            output_field: example.answer,
            "strictSchema": bool(task_recipe.get("strictSchema", True)),
            **row_context,
        }

    if task_type == "llm-embedding":
        anchor_field = str(task_recipe.get("anchorTextField") or "anchorText")
        positive_field = str(task_recipe.get("positiveTextField") or "positiveText")
        negative_field = str(task_recipe.get("negativeTextField") or "negativeText")
        row: dict[str, object] = {
            anchor_field: example.question,
            positive_field: example.answer,
            **row_context,
        }
        if next_chunk is not None and next_chunk.text != source_text:
            row[negative_field] = next_chunk.text
        return row

    if task_type == "llm-reranker":
        query_field = str(task_recipe.get("queryField") or "query")
        passage_field = str(task_recipe.get("passageField") or "passage")
        relevance_field = str(task_recipe.get("relevanceField") or "relevance")
        row = {
            query_field: example.question,
            passage_field: source_text,
            relevance_field: 1,
            **row_context,
        }
        if next_chunk is not None and next_chunk.text != source_text:
            row[str(task_recipe.get("negativePassageField") or "negativePassage")] = next_chunk.text
        return row

    raise ValueError(f"Generated text rows are not supported for task type '{task_type}'.")


def _build_generated_rows(
    payload: PrepareTrainingDatasetRequest,
    task_type: str,
    task_recipe: dict[str, Any],
    generator: Callable[[list, object], list[GeneratedQaExample]],
    text_value_generator: Callable[[str, object], str],
    on_generation_progress: Callable[[dict[str, int]], None] | None = None,
) -> tuple[list[dict[str, object]], list[DatasetPreparationWarning], int, int, int]:
    structured_rows, consumed_structured_artifact_ids, structured_warnings = _load_structured_task_rows(
        payload,
        task_type,
        task_recipe,
    )

    if task_type in IMAGE_MANIFEST_TASK_TYPES:
        if _resolve_text_input_mode(task_type, task_recipe) == "generate":
            try:
                ensure_generation_model_is_available(payload.recipe.generation)
            except Exception as error:
                raise DatasetPreparationStageError(
                    "generation",
                    str(error),
                    "generation_model_not_available",
                    details={
                        "provider": payload.recipe.generation.model.provider,
                        "modelId": payload.recipe.generation.model.modelId,
                    },
                ) from error
        image_rows, image_warnings = _build_direct_image_rows(
            payload,
            task_type,
            task_recipe,
            consumed_structured_artifact_ids,
            text_value_generator,
        )
        rows = structured_rows + image_rows
        warnings = structured_warnings + image_warnings
        if not rows:
            raise DatasetPreparationStageError(
                "generation",
                (
                    f"No {task_type} manifest rows could be created. "
                    "Use image files with the needed metadata or a CSV/JSON/JSONL manifest with the task fields."
                ),
                "dataset_preparation_no_manifest_rows",
                details={
                    "taskType": task_type,
                    "sourceInputCount": len(payload.sourceInputs),
                    "warningCodes": [warning.code for warning in warnings],
                },
            )
        return rows, warnings, len(rows), 0, len(rows)

    source_inputs_for_generation = [
        source for source in payload.sourceInputs if source.artifactId not in consumed_structured_artifact_ids
    ]
    if structured_rows and not source_inputs_for_generation:
        return structured_rows, structured_warnings, len(structured_rows), 0, len(structured_rows)

    try:
        ensure_generation_model_is_available(payload.recipe.generation)
    except Exception as error:
        raise DatasetPreparationStageError(
            "generation",
            str(error),
            "generation_model_not_available",
            details={
                "provider": payload.recipe.generation.model.provider,
                "modelId": payload.recipe.generation.model.modelId,
            },
        ) from error

    try:
        normalization = normalize_sources_to_markdown(source_inputs_for_generation, payload.recipe.normalization)
    except Exception as error:
        raise DatasetPreparationStageError(
            "normalization",
            str(error),
            "normalization_failed",
            details={
                "sourceInputCount": len(payload.sourceInputs),
                "unsupportedDocumentPolicy": payload.recipe.normalization.unsupportedDocumentPolicy,
                "normalizationMode": payload.recipe.normalization.normalizationMode or "strict",
            },
        ) from error

    try:
        chunks = chunk_markdown_documents(normalization.documents, payload.recipe.chunking)
    except Exception as error:
        raise DatasetPreparationStageError(
            "chunking",
            str(error),
            "chunking_failed",
            details={
                "normalizedDocumentCount": len(normalization.documents),
                "chunkSize": payload.recipe.chunking.chunkSize,
                "chunkOverlap": payload.recipe.chunking.chunkOverlap,
                "preserveDocumentBoundaries": bool(payload.recipe.chunking.preserveDocumentBoundaries),
            },
        ) from error

    max_chunk_count = int(payload.recipe.chunking.maxChunkCount or DEFAULT_MAX_CHUNK_COUNT)
    if len(chunks) > max_chunk_count:
        raise DatasetPreparationStageError(
            "chunking",
            f"Chunk count {len(chunks)} exceeds configured maxChunkCount {max_chunk_count}.",
            "chunk_limit_exceeded",
            details={
                "maxChunkCount": max_chunk_count,
                "actualChunkCount": len(chunks),
            },
        )

    failure_policy = payload.recipe.generation.failurePolicy
    if not failure_policy:
        normalization_mode = payload.recipe.normalization.normalizationMode or "strict"
        failure_policy = "skip" if normalization_mode == "best-effort" else "fail"

    batch_size = int(payload.recipe.generation.batchSize or 1)
    rows: list[dict[str, object]] = list(structured_rows)
    warnings: list[DatasetPreparationWarning] = list(structured_warnings) + list(normalization.warnings)
    generation_error_samples: list[str] = []
    skipped_generation_chunk_count = 0
    processed_chunk_count = 0
    generated_row_count = 0
    for start in range(0, len(chunks), batch_size):
        chunk_batch = chunks[start : start + batch_size]
        if on_generation_progress is not None:
            on_generation_progress(
                {
                    "totalChunkCount": len(chunks),
                    "processedChunkCount": processed_chunk_count,
                    "generatedRowCount": generated_row_count,
                }
            )
        try:
            generated_examples = generator(chunk_batch, payload.recipe.generation)
            generated_chunk_keys = {
                (example.artifact_id, example.chunk_index)
                for example in generated_examples
            }
            if failure_policy == "skip":
                skipped_chunks = [
                    chunk
                    for chunk in chunk_batch
                    if (chunk.artifact_id, chunk.chunk_index) not in generated_chunk_keys
                ]
                skipped_generation_chunk_count += len(skipped_chunks)
                for chunk in skipped_chunks:
                    warnings.append(
                        DatasetPreparationWarning(
                            code="generation_example_skipped",
                            message=(
                                f"Skipped chunk {chunk.chunk_index} from source '{chunk.artifact_id}' during generation: "
                                "generation returned no usable example"
                            ),
                            sourceArtifactId=chunk.artifact_id,
                        )
                    )
            chunk_by_key = {(chunk.artifact_id, chunk.chunk_index): chunk for chunk in chunk_batch}
            for index, example in enumerate(generated_examples):
                source_chunk = chunk_by_key.get((example.artifact_id, example.chunk_index))
                next_chunk = chunk_batch[(index + 1) % len(chunk_batch)] if chunk_batch else None
                rows.append(_build_generated_task_row(task_type, task_recipe, example, source_chunk, next_chunk))
            processed_chunk_count += len(chunk_batch)
            generated_row_count = len(rows)
            if on_generation_progress is not None:
                on_generation_progress(
                    {
                        "totalChunkCount": len(chunks),
                        "processedChunkCount": processed_chunk_count,
                        "generatedRowCount": generated_row_count,
                    }
                )
        except Exception as error:
            formatted_error = _format_generation_error(error)
            if len(generation_error_samples) < 3:
                generation_error_samples.append(formatted_error)
            if failure_policy == "skip":
                skipped_generation_chunk_count += len(chunk_batch)
                for chunk in chunk_batch:
                    warnings.append(
                        DatasetPreparationWarning(
                            code="generation_example_skipped",
                            message=(
                                f"Skipped chunk {chunk.chunk_index} from source '{chunk.artifact_id}' during generation: {formatted_error}"
                            ),
                            sourceArtifactId=chunk.artifact_id,
                        )
                    )
                processed_chunk_count += len(chunk_batch)
                if on_generation_progress is not None:
                    on_generation_progress(
                        {
                            "totalChunkCount": len(chunks),
                            "processedChunkCount": processed_chunk_count,
                            "generatedRowCount": generated_row_count,
                        }
                    )
                continue
            raise DatasetPreparationStageError(
                "generation",
                formatted_error,
                "generation_failed",
                details={
                    "failurePolicy": failure_policy,
                    "failedChunkCount": len(chunk_batch),
                    "chunkIndices": [chunk.chunk_index for chunk in chunk_batch],
                    "sourceArtifactIds": sorted({chunk.artifact_id for chunk in chunk_batch}),
                    "batchSize": batch_size,
                },
            ) from error

    if not rows:
        model = payload.recipe.generation.model
        raw_data = {
            "sourceInputs": [source.model_dump(mode="json") for source in payload.sourceInputs],
            "normalizedDocuments": [
                {
                    "artifactId": document.artifact_id,
                    "mediaType": document.media_type,
                    "sourcePath": document.source_path,
                    "markdown": document.markdown,
                }
                for document in normalization.documents
            ],
        }
        prepared_data = {
            "chunking": payload.recipe.chunking.model_dump(mode="json"),
            "generation": payload.recipe.generation.model_dump(mode="json"),
            "chunks": [
                {
                    "artifactId": chunk.artifact_id,
                    "chunkIndex": chunk.chunk_index,
                    "text": chunk.text,
                }
                for chunk in chunks
            ],
            "failurePolicy": failure_policy,
            "generationBatchSize": batch_size,
            "skippedGenerationChunkCount": skipped_generation_chunk_count,
        }
        diagnostic_errors = list(generation_error_samples)
        if not diagnostic_errors:
            diagnostic_errors.append("Generation completed without producing any usable examples.")
        _log_generation_failure_diagnostics(raw_data, prepared_data, diagnostic_errors)
        details = {
            "chunkCount": len(chunks),
            "generatedRowCount": 0,
            "failurePolicy": failure_policy,
            "generationBatchSize": batch_size,
            "skippedGenerationChunkCount": skipped_generation_chunk_count,
            "generationErrorSamples": generation_error_samples,
            "modelProvider": model.provider,
            "modelId": model.modelId,
        }
        error_message = (
            "No training examples were generated from the normalized chunks. "
            f"Processed {len(chunks)} chunk(s), but generation produced 0 row(s). "
            f"Failure policy was '{failure_policy}'. "
            f"Skipped generation chunk(s): {skipped_generation_chunk_count}. "
            "Check source content, chunking settings, and generation model configuration."
        )
        if generation_error_samples:
            error_message = f"{error_message} Example generation error(s): {' | '.join(generation_error_samples)}"
        raise DatasetPreparationStageError(
            "generation",
            error_message,
            "generation_no_examples",
            details=details,
        )

    return (
        rows,
        warnings,
        len(normalization.documents),
        normalization.skipped_document_count,
        len(chunks),
    )


def prepare_training_dataset(
    payload: PrepareTrainingDatasetRequest,
    example_generator: Callable[[list, object], list[GeneratedQaExample]] = generate_qa_examples_for_chunks,
    text_value_generator: Callable[[str, object], str] = generate_text_value,
    on_generation_progress: Callable[[dict[str, int]], None] | None = None,
    output_directory: Path | None = None,
) -> PrepareTrainingDatasetResult:
    task_type, task_recipe = _resolve_task_recipe(payload)
    try:
        _validate_split_config(float(payload.split.trainRatio), float(payload.split.testRatio))
    except Exception as error:
        raise DatasetPreparationStageError(
            "split",
            str(error),
            "split_validation_failed",
            details={
                "trainRatio": payload.split.trainRatio,
                "testRatio": payload.split.testRatio,
            },
        ) from error

    rows, warnings, normalized_count, skipped_count, chunk_count = _build_generated_rows(
        payload,
        task_type,
        task_recipe,
        example_generator,
        text_value_generator,
        on_generation_progress,
    )
    _validate_generated_rows(len(rows), chunk_count)

    if payload.split.shuffle:
        seed = int(payload.split.seed or 0)
        random.Random(seed).shuffle(rows)

    base_name = payload.output.naming.baseName if payload.output.naming and payload.output.naming.baseName else "training-dataset"
    output_metadata = {
        "stage": "generated-examples",
        "datasetPreparationTask": {
            "taskType": task_type,
            "recipe": task_recipe or {"taskType": task_type},
            "runtimeSupport": "supported",
        },
        "generationMode": payload.recipe.generation.mode,
        "generationModel": {
            "provider": payload.recipe.generation.model.provider,
            "modelId": payload.recipe.generation.model.modelId,
        },
        "sourceArtifactIds": [source.artifactId for source in payload.sourceInputs],
        "summary": {
            "chunkCount": chunk_count,
            "generatedExampleCount": len(rows),
        },
        "split": payload.split.model_dump(mode="json"),
        "outputConfig": payload.output.model_dump(mode="json"),
    }

    dataset_output = _emit_rows(
        rows,
        payload.output.format,
        "dataset",
        base_name,
        {**output_metadata, "partition": "dataset"},
        task_type,
        output_directory,
    )

    summary = DatasetPreparationSummary(
        sourceDocumentCount=len(payload.sourceInputs),
        normalizedDocumentCount=normalized_count,
        skippedDocumentCount=skipped_count,
        chunkCount=chunk_count,
        generatedExampleCount=len(rows),
        datasetRowCount=len(rows),
        trainRowCount=len(rows),
        testRowCount=0,
    )

    return PrepareTrainingDatasetResult(
        outputs=[dataset_output],
        summary=summary,
        warnings=warnings or None,
    )
