from __future__ import annotations

import csv
import json
import math
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlparse

from ..models import TrainModelTaskRequest, TrainModelTaskResult
from .model_serialization import DEFAULT_MAX_SHARD_SIZE, save_adapter_pretrained, save_full_model_pretrained, write_serialization_manifest
from .model_validation import validate_model_output

SUPPORTED_DATASET_FORMATS = {"jsonl", "json", "csv", "parquet"}
VISION_TRAINING_TASKS = {"vision-classification", "vision-detection", "vision-segmentation"}
DIFFUSION_LORA_TASK = "diffusion-lora"
DEFAULT_IMAGE_RESOLUTION = 512
VISION_LORA_DEFAULT_TARGET_MODULES = ("query", "value", "q_proj", "v_proj", "key", "k_proj", "out_proj", "qkv")
VISION_LORA_FALLBACK_TARGET_MODULES = ("dense", "proj")
VISION_LORA_MODULES_TO_SAVE_BY_TASK = {
    "vision-classification": ("classifier", "score", "head", "heads.head"),
    "vision-detection": ("class_labels_classifier", "bbox_predictor", "class_embed", "bbox_embed", "classifier"),
    "vision-segmentation": ("classifier", "decode_head", "segmentation_head", "auxiliary_head"),
}


@dataclass(frozen=True)
class ManifestBundle:
    train_rows: list[dict[str, Any]]
    validation_rows: list[dict[str, Any]]


def _to_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _require_non_empty(value: str | None, field: str) -> str:
    if value is None or value.strip() == "":
        raise ValueError(f"{field} is required.")
    return value.strip()


def _resolve_base_model(payload: TrainModelTaskRequest) -> str:
    if payload.baseModel.localPath and payload.baseModel.localPath.strip():
        return payload.baseModel.localPath.strip()
    if payload.baseModel.modelId and payload.baseModel.modelId.strip():
        return payload.baseModel.modelId.strip()
    raise ValueError("baseModel must include modelId or localPath for Python-side training.")


def _parse_positive_int(value: Any, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)):
        candidate = int(value)
        return candidate if candidate > 0 else fallback
    if isinstance(value, str) and value.strip():
        try:
            candidate = int(value.strip())
        except ValueError:
            return fallback
        return candidate if candidate > 0 else fallback
    return fallback


def _parse_positive_float(value: Any, fallback: float) -> float:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)):
        candidate = float(value)
        return candidate if candidate > 0 else fallback
    if isinstance(value, str) and value.strip():
        try:
            candidate = float(value.strip())
        except ValueError:
            return fallback
        return candidate if candidate > 0 else fallback
    return fallback


def _training_task_tags(training_task: str) -> list[str]:
    return {
        "diffusion-lora": ["text-to-image"],
        "vision-classification": ["image-classification"],
        "vision-detection": ["object-detection"],
        "vision-segmentation": ["image-segmentation"],
    }.get(training_task, [])


def _dataset_path(dataset: Any) -> Path:
    if dataset.path is None:
        raise ValueError(f"Dataset '{dataset.artifactId}' is missing path; runtime storage binding must provide a local dataset path.")
    return Path(dataset.path)


def _infer_dataset_format(dataset: Any, path: Path) -> str:
    if dataset.format and dataset.format.strip():
        fmt = dataset.format.strip().lower()
    else:
        ext = path.suffix.lower().lstrip(".")
        fmt = "jsonl" if ext == "jsonl" else ext
    if fmt not in SUPPORTED_DATASET_FORMATS:
        raise ValueError(f"Unsupported dataset format '{fmt}'. Supported formats: {', '.join(sorted(SUPPORTED_DATASET_FORMATS))}.")
    return fmt


def _read_rows(path: Path, fmt: str) -> list[dict[str, Any]]:
    if fmt == "jsonl":
        rows = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                if isinstance(row, dict):
                    rows.append(row)
        return rows

    if fmt == "json":
        value = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
        if isinstance(value, dict):
            for key in ["rows", "data", "examples"]:
                rows = value.get(key)
                if isinstance(rows, list):
                    return [row for row in rows if isinstance(row, dict)]
            split_rows = []
            for key in ["train", "validation", "test"]:
                rows = value.get(key)
                if isinstance(rows, list):
                    split_rows.extend([{**row, "split": key} for row in rows if isinstance(row, dict)])
            if split_rows:
                return split_rows
        raise ValueError(f"JSON dataset '{path}' must be an array, a rows/data/examples object, or split arrays.")

    if fmt == "csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            return [dict(row) for row in csv.DictReader(handle)]

    try:
        import pyarrow.parquet as parquet
    except Exception as error:  # pragma: no cover - optional dependency failure
        raise RuntimeError("pyarrow is required for parquet multimodal dataset loading.") from error

    return [row for row in parquet.read_table(path).to_pylist() if isinstance(row, dict)]


def load_manifest_bundle(payload: TrainModelTaskRequest) -> ManifestBundle:
    train_rows: list[dict[str, Any]] = []
    validation_rows: list[dict[str, Any]] = []

    for dataset in payload.datasets:
        path = _dataset_path(dataset)
        if not path.exists():
            raise ValueError(f"Dataset path does not exist: {path}")
        fmt = _infer_dataset_format(dataset, path)
        rows = _read_rows(path, fmt)
        for row in rows:
            enriched = {**row, "_datasetPath": str(path)}
            split = str(row.get("split") or dataset.splitRole or "train").strip().lower()
            if split == "validation":
                validation_rows.append(enriched)
            elif split != "test":
                train_rows.append(enriched)

    if not train_rows:
        raise ValueError("At least one train split dataset row is required.")

    return ManifestBundle(train_rows=train_rows, validation_rows=validation_rows)


def staged_source_artifact_paths(payload: TrainModelTaskRequest) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for dataset in payload.datasets:
        metadata = _to_dict(getattr(dataset, "metadata", None))
        candidates = [
            metadata.get("stagedSourceArtifactPaths"),
            metadata.get("sourceArtifactPaths"),
        ]
        for candidate in candidates:
            if isinstance(candidate, dict):
                for artifact_id, path in candidate.items():
                    if isinstance(artifact_id, str) and isinstance(path, str) and path.strip():
                        paths[artifact_id] = Path(path)
    return paths


def _row_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def _purpose_row_value(
    row: dict[str, Any],
    purpose_paths: dict[str, tuple[str, ...]] | None,
    purpose: str,
    *fallback_keys: str,
) -> Any:
    path = purpose_paths.get(purpose) if purpose_paths else None
    if path:
        value: Any = row
        for segment in path:
            if not isinstance(value, dict):
                return None
            value = value.get(segment)
        return value
    return _row_value(row, *fallback_keys)


def _coerce_jsonish(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return value
    if stripped[0] not in "[{":
        return value
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return value


def resolve_manifest_asset_path(value: Any, dataset_path: Path, source_paths: dict[str, Path]) -> Path:
    if isinstance(value, dict):
        for key in ["artifactId", "imageArtifactId", "maskArtifactId"]:
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate in source_paths:
                return source_paths[candidate]
        for key in ["path", "localPath", "image", "mask"]:
            candidate = value.get(key)
            if isinstance(candidate, str):
                return resolve_manifest_asset_path(candidate, dataset_path, source_paths)

    if not isinstance(value, str) or value.strip() == "":
        raise ValueError("Manifest asset path is missing.")

    normalized = value.strip()
    if normalized in source_paths:
        return source_paths[normalized]

    if normalized.startswith("file://"):
        parsed = urlparse(normalized)
        file_path = Path(unquote(parsed.path))
        if file_path.exists():
            return file_path

    candidate = Path(normalized)
    if candidate.is_absolute() and candidate.exists():
        return candidate

    relative_candidate = dataset_path.parent / normalized
    if relative_candidate.exists():
        return relative_candidate

    if candidate.exists():
        return candidate

    raise ValueError(f"Manifest asset path could not be resolved: {normalized}")


def _build_output_metadata(
    *,
    payload: TrainModelTaskRequest,
    run_id: str,
    training_task: str,
    output_path: Path,
    serialization: dict[str, Any],
    validation: dict[str, Any],
    metrics: dict[str, float],
) -> tuple[dict[str, Any], str, str]:
    manifest_path = write_serialization_manifest(output_path, {
        "runId": run_id,
        "method": payload.method,
        "trainingTask": training_task,
        "serialization": serialization,
        "validation": validation,
        "metrics": metrics,
    })
    run_metadata_path = output_path / "training-run.json"
    run_metadata_path.write_text(
        json.dumps(
            {
                "runId": run_id,
                "method": payload.method,
                "trainingTask": training_task,
                "baseModel": payload.baseModel.model_dump(mode="json"),
                "datasets": [dataset.model_dump(mode="json") for dataset in payload.datasets],
                "startedAt": datetime.now(timezone.utc).isoformat(),
                "status": "failed" if validation["status"] == "invalid" else "succeeded",
                "serializationManifestPath": manifest_path,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    metadata = {
        "runtimeTask": "train-model",
        "trainingTask": training_task,
        "runMetadataPath": str(run_metadata_path),
        "validation": validation,
        "serialization": serialization,
    }
    return metadata, manifest_path, str(run_metadata_path)


def _candidate(
    *,
    payload: TrainModelTaskRequest,
    training_task: str,
    run_id: str,
    output_model_name: str,
    output_path: Path,
    artifact_form: str,
    serialization: dict[str, Any],
    validation: dict[str, Any],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    model_id = payload.baseModel.modelId
    return {
        "displayName": output_model_name,
        "modelId": None,
        "localPath": str(output_path),
        "artifactForm": artifact_form,
        "inferenceMode": payload.baseModel.inferenceMode,
        "taskTags": _training_task_tags(training_task),
        "baseModelId": model_id,
        "adapterOfModelId": model_id if artifact_form == "adapter" else None,
        "generatedFromRunId": run_id,
        "serializationFormat": validation.get("serializationFormat") or serialization.get("serializationFormat"),
        "metadata": metadata,
    }


def _make_failed_result(
    *,
    payload: TrainModelTaskRequest,
    run_id: str,
    output_path: Path,
    output_model_name: str,
    training_task: str,
    error: Exception,
    logs: list[str],
    warnings: list[str],
) -> TrainModelTaskResult:
    return TrainModelTaskResult(
        runId=run_id,
        status="failed",
        outputDirectory=str(output_path),
        outputModelName=output_model_name,
        logs=logs,
        warnings=warnings,
        error={
            "code": "training_failed",
            "message": str(error),
            "details": {
                "method": payload.method,
                "trainingTask": training_task,
            },
        },
    )


class _ClassificationImageDataset:
    def __init__(self, rows: list[dict[str, Any]], processor: Any, label_to_id: dict[str, int], source_paths: dict[str, Path], purpose_paths: dict[str, tuple[str, ...]] | None = None) -> None:
        self.rows = rows
        self.processor = processor
        self.label_to_id = label_to_id
        self.source_paths = source_paths
        self.purpose_paths = purpose_paths

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, Any]:
        import torch
        from PIL import Image

        row = self.rows[index]
        dataset_path = Path(str(row["_datasetPath"]))
        image_path = resolve_manifest_asset_path(_row_value(row, "image", "imagePath", "imageArtifactId", "file", "path"), dataset_path, self.source_paths)
        label = str(_purpose_row_value(row, self.purpose_paths, "label", "label", "class", "category") or "").strip()
        if not label:
            raise ValueError("Vision classification rows must include a label.")
        image = Image.open(image_path).convert("RGB")
        encoded = self.processor(images=image, return_tensors="pt")
        item = {key: value.squeeze(0) for key, value in encoded.items()}
        item["labels"] = torch.tensor(self.label_to_id[label], dtype=torch.long)
        return item


class _DetectionImageDataset:
    def __init__(self, rows: list[dict[str, Any]], processor: Any, label_to_id: dict[str, int], source_paths: dict[str, Path], purpose_paths: dict[str, tuple[str, ...]] | None = None) -> None:
        self.rows = rows
        self.processor = processor
        self.label_to_id = label_to_id
        self.source_paths = source_paths
        self.purpose_paths = purpose_paths

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, Any]:
        from PIL import Image

        row = self.rows[index]
        dataset_path = Path(str(row["_datasetPath"]))
        image_path = resolve_manifest_asset_path(_row_value(row, "image", "imagePath", "imageArtifactId", "file", "path"), dataset_path, self.source_paths)
        image = Image.open(image_path).convert("RGB")
        boxes = _normalize_detection_boxes(row, self.purpose_paths)
        annotations = {
            "image_id": index,
            "annotations": [
                {
                    "bbox": box["bbox"],
                    "category_id": self.label_to_id[box["label"]],
                    "area": max(float(box["bbox"][2]) * float(box["bbox"][3]), 1.0),
                    "iscrowd": 0,
                }
                for box in boxes
            ],
        }
        encoded = self.processor(images=image, annotations=annotations, return_tensors="pt")
        return {key: (value.squeeze(0) if key != "labels" else value[0]) for key, value in encoded.items()}


class _SegmentationImageDataset:
    def __init__(self, rows: list[dict[str, Any]], processor: Any, label_to_id: dict[str, int], source_paths: dict[str, Path]) -> None:
        self.rows = rows
        self.processor = processor
        self.label_to_id = label_to_id
        self.source_paths = source_paths

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, Any]:
        from PIL import Image

        row = self.rows[index]
        dataset_path = Path(str(row["_datasetPath"]))
        image_path = resolve_manifest_asset_path(_row_value(row, "image", "imagePath", "imageArtifactId", "file", "path"), dataset_path, self.source_paths)
        mask_path = resolve_manifest_asset_path(_row_value(row, "mask", "maskPath", "maskArtifactId"), dataset_path, self.source_paths)
        image = Image.open(image_path).convert("RGB")
        mask = Image.open(mask_path)
        encoded = self.processor(images=image, segmentation_maps=mask, return_tensors="pt")
        return {key: value.squeeze(0) for key, value in encoded.items()}


def _collect_classification_labels(rows: list[dict[str, Any]], purpose_paths: dict[str, tuple[str, ...]] | None = None) -> list[str]:
    labels = []
    for row in rows:
        label = _purpose_row_value(row, purpose_paths, "label", "label", "class", "category")
        if label is None:
            label_set = row.get("labelSet")
            if isinstance(label_set, list):
                labels.extend(str(entry).strip() for entry in label_set if str(entry).strip())
            continue
        labels.append(str(label).strip())
    unique = sorted(set(label for label in labels if label))
    if not unique:
        raise ValueError("Vision classification rows must include labels.")
    return unique


def _normalize_detection_boxes(row: dict[str, Any], purpose_paths: dict[str, tuple[str, ...]] | None = None) -> list[dict[str, Any]]:
    raw_boxes = _coerce_jsonish(_row_value(row, "boundingBoxes", "boxes", "bbox", "annotations"))
    if isinstance(raw_boxes, dict):
        raw_boxes = [raw_boxes]
    if not isinstance(raw_boxes, list) or not raw_boxes:
        raise ValueError("Vision detection rows must include bounding boxes.")

    labels_value = _coerce_jsonish(
        _purpose_row_value(row, purpose_paths, "label", "labels")
    )
    box_format = str(row.get("boxFormat") or "xywh").strip().lower()
    boxes: list[dict[str, Any]] = []
    for index, raw_box in enumerate(raw_boxes):
        if isinstance(raw_box, dict):
            label = str(raw_box.get("label") or raw_box.get("category") or raw_box.get("class") or "").strip()
            bbox_value = raw_box.get("bbox") or raw_box.get("box") or raw_box.get("xywh") or raw_box.get("xyxy")
            raw_format = str(raw_box.get("boxFormat") or raw_box.get("format") or box_format).strip().lower()
        else:
            label = ""
            bbox_value = raw_box
            raw_format = box_format
        if not label and isinstance(labels_value, list) and index < len(labels_value):
            label = str(labels_value[index]).strip()
        if not label and isinstance(labels_value, str):
            label = labels_value.strip()
        if not label:
            raise ValueError("Vision detection bounding boxes must include labels.")
        bbox = _normalize_bbox(bbox_value, raw_format)
        boxes.append({"label": label, "bbox": bbox})
    return boxes


def _normalize_bbox(value: Any, box_format: str) -> list[float]:
    if isinstance(value, str):
        value = _coerce_jsonish(value)
    if isinstance(value, dict):
        if {"x", "y", "width", "height"}.issubset(value):
            return [float(value["x"]), float(value["y"]), float(value["width"]), float(value["height"])]
        if {"x1", "y1", "x2", "y2"}.issubset(value):
            x1, y1, x2, y2 = float(value["x1"]), float(value["y1"]), float(value["x2"]), float(value["y2"])
            return [x1, y1, max(x2 - x1, 1.0), max(y2 - y1, 1.0)]
    if isinstance(value, (list, tuple)) and len(value) >= 4:
        values = [float(value[0]), float(value[1]), float(value[2]), float(value[3])]
        if box_format in {"xyxy", "pascal-voc"}:
            return [values[0], values[1], max(values[2] - values[0], 1.0), max(values[3] - values[1], 1.0)]
        return values
    raise ValueError("Bounding boxes must be arrays or objects with four coordinates.")


def _collect_detection_labels(rows: list[dict[str, Any]], purpose_paths: dict[str, tuple[str, ...]] | None = None) -> list[str]:
    labels = []
    for row in rows:
        labels.extend(box["label"] for box in _normalize_detection_boxes(row, purpose_paths))
    unique = sorted(set(label for label in labels if label))
    if not unique:
        raise ValueError("Vision detection rows must include class labels.")
    return unique


def _collect_segmentation_labels(rows: list[dict[str, Any]], purpose_paths: dict[str, tuple[str, ...]] | None = None) -> list[str]:
    labels = []
    for row in rows:
        label = _purpose_row_value(row, purpose_paths, "label", "label", "class", "category")
        if label is not None:
            labels.append(str(label).strip())
    unique = sorted(set(label for label in labels if label))
    return unique or ["foreground"]


def _module_names(model: Any) -> list[str]:
    named_modules = getattr(model, "named_modules", None)
    if not callable(named_modules):
        return []
    try:
        return [name for name, _module in named_modules() if isinstance(name, str) and name]
    except Exception:
        return []


def _module_matches_target(module_name: str, target_module: str) -> bool:
    return module_name == target_module or module_name.endswith(f".{target_module}")


def _sanitize_target_modules(value: Any) -> list[str]:
    return [entry.strip() for entry in value if isinstance(entry, str) and entry.strip()] if isinstance(value, list) else []


def _resolve_vision_lora_target_modules(model: Any, configured_target_modules: Any = None) -> list[str]:
    module_names = _module_names(model)
    configured = _sanitize_target_modules(configured_target_modules)
    if configured:
        if module_names:
            unmatched = [target for target in configured if not any(_module_matches_target(name, target) for name in module_names)]
            if unmatched:
                raise ValueError(f"Configured vision LoRA target modules were not found in the selected model: {', '.join(unmatched)}.")
        return configured

    matched_defaults = [
        target
        for target in VISION_LORA_DEFAULT_TARGET_MODULES
        if not module_names or any(_module_matches_target(name, target) for name in module_names)
    ]
    if matched_defaults:
        return matched_defaults

    matched_fallbacks = [
        target
        for target in VISION_LORA_FALLBACK_TARGET_MODULES
        if any(_module_matches_target(name, target) for name in module_names)
    ]
    if matched_fallbacks:
        return matched_fallbacks

    raise ValueError("Could not infer vision LoRA target modules for the selected model. Configure advancedParameters.lora.targetModules explicitly.")


def _resolve_vision_lora_modules_to_save(model: Any, training_task: str) -> list[str]:
    module_names = _module_names(model)
    candidates = VISION_LORA_MODULES_TO_SAVE_BY_TASK.get(training_task, ())
    return [
        candidate
        for candidate in candidates
        if not module_names or any(_module_matches_target(name, candidate) for name in module_names)
    ]


def _count_trainable_parameters(model: Any) -> tuple[int, int] | None:
    parameters = getattr(model, "parameters", None)
    if not callable(parameters):
        return None
    try:
        trainable = 0
        total = 0
        for parameter in parameters():
            count = int(parameter.numel()) if callable(getattr(parameter, "numel", None)) else 0
            total += count
            if bool(getattr(parameter, "requires_grad", False)):
                trainable += count
        return trainable, total
    except Exception:
        return None


def _apply_vision_lora(model: Any, payload: TrainModelTaskRequest, training_task: str) -> tuple[Any, dict[str, Any]]:
    try:
        from peft import LoraConfig, get_peft_model
    except Exception as error:  # pragma: no cover
        raise RuntimeError("peft is required for vision LoRA training.") from error

    advanced = _to_dict(payload.advancedParameters)
    lora = _to_dict(advanced.get("lora"))
    target_modules = _resolve_vision_lora_target_modules(model, lora.get("targetModules"))
    modules_to_save = _resolve_vision_lora_modules_to_save(model, training_task)
    lora_config_args = {
        "r": int(lora.get("rank", 16)),
        "lora_alpha": int(lora.get("alpha", 32)),
        "lora_dropout": float(lora.get("dropout", 0.05)),
        "bias": "none",
        "target_modules": target_modules,
    }
    if modules_to_save:
        lora_config_args["modules_to_save"] = modules_to_save

    lora_model = get_peft_model(model, LoraConfig(**lora_config_args))
    trainable_counts = _count_trainable_parameters(lora_model)
    if trainable_counts is not None and trainable_counts[0] <= 0:
        raise RuntimeError("No trainable LoRA parameters were created for the selected vision model.")

    return lora_model, {
        "rank": lora_config_args["r"],
        "alpha": lora_config_args["lora_alpha"],
        "dropout": lora_config_args["lora_dropout"],
        "targetModules": target_modules,
        "modulesToSave": modules_to_save,
        "trainableParameterCount": trainable_counts[0] if trainable_counts is not None else None,
        "totalParameterCount": trainable_counts[1] if trainable_counts is not None else None,
    }


def _build_vision_training_args(payload: TrainModelTaskRequest, output_path: Path) -> Any:
    try:
        from transformers import TrainingArguments
    except Exception as error:  # pragma: no cover
        raise RuntimeError("transformers is required for vision model training.") from error

    common = _to_dict(payload.commonParameters)
    advanced = _to_dict(payload.advancedParameters)
    return TrainingArguments(
        output_dir=str(output_path / "checkpoints"),
        num_train_epochs=float(common.get("numEpochs", 1)),
        max_steps=int(common.get("maxSteps", -1)) if isinstance(common.get("maxSteps"), (int, float)) else -1,
        per_device_train_batch_size=int(common.get("batchSize", 1)),
        per_device_eval_batch_size=int(common.get("batchSize", 1)),
        learning_rate=float(common.get("learningRate", 5e-5)),
        weight_decay=float(common.get("weightDecay", 0.0)),
        gradient_accumulation_steps=int(advanced.get("gradientAccumulationSteps", 1)),
        save_steps=int(advanced.get("checkpointIntervalSteps", 50)),
        eval_steps=int(advanced.get("evalIntervalSteps", 0)) if int(advanced.get("evalIntervalSteps", 0)) > 0 else None,
        logging_steps=10,
        save_total_limit=int(advanced.get("saveTotalLimit", 2)),
        bf16=advanced.get("mixedPrecision") == "bf16",
        fp16=advanced.get("mixedPrecision") == "fp16",
        gradient_checkpointing=bool(advanced.get("gradientCheckpointing", False)),
        remove_unused_columns=False,
        report_to=[],
    )


def _run_vision_trainer(
    model: Any,
    processor: Any,
    train_dataset: Any,
    eval_dataset: Any | None,
    args: Any,
    *,
    data_collator: Callable[[list[dict[str, Any]]], dict[str, Any]] | None = None,
    on_progress: Callable[[dict[str, int]], None] | None = None,
) -> tuple[dict[str, float], list[dict[str, Any]]]:
    try:
        from transformers import Trainer, TrainerCallback
    except Exception as error:  # pragma: no cover
        raise RuntimeError("transformers Trainer is required for vision model training.") from error

    def estimate_total_steps() -> int:
        max_steps = getattr(args, "max_steps", -1)
        if isinstance(max_steps, int) and max_steps > 0:
            return max_steps
        train_rows = len(train_dataset)
        per_device_batch_size = max(int(getattr(args, "per_device_train_batch_size", 1) or 1), 1)
        epochs = max(int(math.ceil(float(getattr(args, "num_train_epochs", 1) or 1))), 1)
        return max(math.ceil(train_rows / per_device_batch_size), 1) * epochs

    class _VisionProgressCallback(TrainerCallback):
        def on_step_end(self, _args: Any, state: Any, _control: Any, **_kwargs: Any) -> None:
            if on_progress is None:
                return
            total_steps = estimate_total_steps()
            current_step = int(state.global_step) if isinstance(state.global_step, int) else 0
            total_epochs = int(_args.num_train_epochs) if isinstance(_args.num_train_epochs, (int, float)) else 1
            current_epoch = int(state.epoch) + 1 if isinstance(state.epoch, (int, float)) else 1
            on_progress({
                "epoch": max(current_epoch, 1),
                "totalEpochs": max(total_epochs, 1),
                "batch": min(max(current_step, 0), total_steps),
                "totalBatches": total_steps,
            })

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=processor,
        data_collator=data_collator,
        callbacks=[_VisionProgressCallback()],
    )
    if on_progress is not None:
        on_progress({"epoch": 0, "totalEpochs": max(int(math.ceil(float(args.num_train_epochs))), 1), "batch": 0, "totalBatches": estimate_total_steps()})
    train_result = trainer.train()
    metrics = {key: float(value) for key, value in train_result.metrics.items() if isinstance(value, (int, float))}
    checkpoints = []
    for state in trainer.state.log_history:
        if "loss" in state and "step" in state:
            checkpoints.append({"path": str(args.output_dir), "step": int(state["step"]), "metric": "loss", "value": float(state["loss"])})
    return metrics, checkpoints


def _detection_collator(batch: list[dict[str, Any]]) -> dict[str, Any]:
    import torch

    pixel_values = torch.stack([item["pixel_values"] for item in batch])
    result = {"pixel_values": pixel_values, "labels": [item["labels"] for item in batch]}
    if "pixel_mask" in batch[0]:
        result["pixel_mask"] = torch.stack([item["pixel_mask"] for item in batch])
    return result


def train_vision_model(
    payload: TrainModelTaskRequest,
    *,
    training_task: str,
    run_id: str,
    output_path: Path,
    output_model_name: str,
    purpose_paths: dict[str, tuple[str, ...]] | None = None,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> TrainModelTaskResult:
    logs: list[str] = []
    warnings: list[str] = []
    try:
        if payload.method not in {"lora", "full-finetune"}:
            raise ValueError("Vision model training supports lora and full-finetune methods.")
        if training_task not in VISION_TRAINING_TASKS:
            raise ValueError(f"Vision training task '{training_task}' is not recognized.")
        try:
            from transformers import (
                AutoImageProcessor,
                AutoModelForImageClassification,
                AutoModelForObjectDetection,
                AutoModelForSemanticSegmentation,
            )
        except Exception as error:  # pragma: no cover
            raise RuntimeError("transformers and torch vision dependencies are required for vision model training.") from error

        if on_progress is not None:
            on_progress({"stage": "initializing", "message": "Loading image dataset and model assets..."})

        bundle = load_manifest_bundle(payload)
        source_paths = staged_source_artifact_paths(payload)
        base_model_ref = _resolve_base_model(payload)
        processor = AutoImageProcessor.from_pretrained(base_model_ref)
        rows_for_labels = bundle.train_rows + bundle.validation_rows

        if training_task == "vision-classification":
            labels = _collect_classification_labels(rows_for_labels, purpose_paths)
            label_to_id = {label: index for index, label in enumerate(labels)}
            id_to_label = {index: label for label, index in label_to_id.items()}
            model = AutoModelForImageClassification.from_pretrained(
                base_model_ref,
                num_labels=len(labels),
                id2label=id_to_label,
                label2id=label_to_id,
                ignore_mismatched_sizes=True,
            )
            train_dataset = _ClassificationImageDataset(bundle.train_rows, processor, label_to_id, source_paths, purpose_paths)
            eval_dataset = _ClassificationImageDataset(bundle.validation_rows, processor, label_to_id, source_paths, purpose_paths) if bundle.validation_rows else None
            data_collator = None
        elif training_task == "vision-detection":
            labels = _collect_detection_labels(rows_for_labels, purpose_paths)
            label_to_id = {label: index for index, label in enumerate(labels)}
            id_to_label = {index: label for label, index in label_to_id.items()}
            model = AutoModelForObjectDetection.from_pretrained(
                base_model_ref,
                num_labels=len(labels),
                id2label=id_to_label,
                label2id=label_to_id,
                ignore_mismatched_sizes=True,
            )
            train_dataset = _DetectionImageDataset(bundle.train_rows, processor, label_to_id, source_paths, purpose_paths)
            eval_dataset = _DetectionImageDataset(bundle.validation_rows, processor, label_to_id, source_paths, purpose_paths) if bundle.validation_rows else None
            data_collator = _detection_collator
        else:
            labels = _collect_segmentation_labels(rows_for_labels, purpose_paths)
            label_to_id = {label: index for index, label in enumerate(labels)}
            id_to_label = {index: label for label, index in label_to_id.items()}
            model = AutoModelForSemanticSegmentation.from_pretrained(
                base_model_ref,
                num_labels=len(labels),
                id2label=id_to_label,
                label2id=label_to_id,
                ignore_mismatched_sizes=True,
            )
            train_dataset = _SegmentationImageDataset(bundle.train_rows, processor, label_to_id, source_paths)
            eval_dataset = _SegmentationImageDataset(bundle.validation_rows, processor, label_to_id, source_paths) if bundle.validation_rows else None
            data_collator = None

        vision_lora_metadata: dict[str, Any] | None = None
        if payload.method == "lora":
            model, vision_lora_metadata = _apply_vision_lora(model, payload, training_task)
            logs.append("Applied vision LoRA adapter config.")
            if not vision_lora_metadata.get("modulesToSave"):
                warnings.append("No recognized task head modules were found for LoRA modules_to_save; only LoRA target modules will be trainable.")

        train_args = _build_vision_training_args(payload, output_path)

        def progress(progress_payload: dict[str, int]) -> None:
            message = (
                f"Epoch [{progress_payload.get('epoch', 0)}]/[{progress_payload.get('totalEpochs', 0)}], "
                f"Batch [{progress_payload.get('batch', 0)}]/[{progress_payload.get('totalBatches', 0)}]"
            )
            logs.append(message)
            if on_progress is not None:
                on_progress({**progress_payload, "stage": "training", "message": message})

        metrics, checkpoints = _run_vision_trainer(model, processor, train_dataset, eval_dataset, train_args, data_collator=data_collator, on_progress=progress)
        if on_progress is not None:
            on_progress({"stage": "serializing", "message": "Serializing trained vision adapter..." if payload.method == "lora" else "Serializing trained vision model..."})

        if payload.method == "lora":
            serialization = save_adapter_pretrained(
                model,
                processor,
                output_path,
                base_model_id=payload.baseModel.modelId,
            )
            artifact_form = "adapter"
        else:
            max_shard_size = str(_to_dict(payload.output).get("maxShardSize") or DEFAULT_MAX_SHARD_SIZE)
            serialization = save_full_model_pretrained(model, processor, output_path, max_shard_size=max_shard_size)
            artifact_form = "full-model"
        if on_progress is not None:
            on_progress({"stage": "validating", "message": "Running post-training validation..."})
        validation_config = _to_dict(payload.validation)
        validation_enabled = bool(validation_config.get("enabled", True))
        validation = (
            validate_model_output(
                output_path,
                expected_lora=bool(validation_config.get("expectedLoRA", payload.method == "lora")),
                expected_recurrent_additions=bool(validation_config.get("expectedRecurrentAdditions", False)),
            )
            if validation_enabled
            else {"status": "unknown", "warnings": ["Validation was disabled and did not run."], "errors": [], "validationReportPath": None}
        )
        metadata, _manifest_path, _run_metadata_path = _build_output_metadata(
            payload=payload,
            run_id=run_id,
            training_task=training_task,
            output_path=output_path,
            serialization=serialization,
            validation=validation,
            metrics=metrics,
        )
        metadata["labels"] = labels
        if vision_lora_metadata is not None:
            metadata["visionLora"] = vision_lora_metadata
        final_status = "failed" if validation_enabled and validation["status"] == "invalid" else "succeeded"
        generated_candidate = (
            _candidate(
                payload=payload,
                training_task=training_task,
                run_id=run_id,
                output_model_name=output_model_name,
                output_path=output_path,
                artifact_form=artifact_form,
                serialization=serialization,
                validation=validation,
                metadata=metadata,
            )
            if final_status == "succeeded"
            else None
        )
        if on_progress is not None:
            on_progress({"stage": "completed", "message": "Training task completed."})
        return TrainModelTaskResult(
            runId=run_id,
            status=final_status,
            outputDirectory=str(output_path),
            outputModelName=output_model_name,
            logs=logs,
            warnings=warnings + validation.get("warnings", []),
            checkpoints=checkpoints,
            metrics=metrics,
            validationReportPath=validation.get("validationReportPath"),
            generatedModelCandidate=generated_candidate,
            error=(
                {
                    "code": "validation_failed",
                    "message": "Training artifacts failed post-training validation.",
                    "details": {"validationStatus": validation.get("status"), "validationErrors": validation.get("errors", [])},
                }
                if final_status == "failed"
                else None
            ),
        )
    except Exception as error:
        if on_progress is not None:
            on_progress({"stage": "failed", "message": f"Training failed: {error}"})
        return _make_failed_result(
            payload=payload,
            run_id=run_id,
            output_path=output_path,
            output_model_name=output_model_name,
            training_task=training_task,
            error=error,
            logs=logs,
            warnings=warnings,
        )


class _DiffusionLoraDataset:
    def __init__(self, rows: list[dict[str, Any]], tokenizer: Any, resolution: int, source_paths: dict[str, Path], purpose_paths: dict[str, tuple[str, ...]] | None = None) -> None:
        self.rows = rows
        self.tokenizer = tokenizer
        self.resolution = resolution
        self.source_paths = source_paths
        self.purpose_paths = purpose_paths

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, Any]:
        import numpy as np
        import torch
        from PIL import Image

        row = self.rows[index]
        dataset_path = Path(str(row["_datasetPath"]))
        image_path = resolve_manifest_asset_path(_row_value(row, "image", "imagePath", "imageArtifactId", "file", "path"), dataset_path, self.source_paths)
        caption = str(_purpose_row_value(row, self.purpose_paths, "caption", "caption", "prompt", "description", "text") or "").strip()
        if not caption:
            raise ValueError("Diffusion LoRA rows must include a caption or prompt.")
        image = Image.open(image_path).convert("RGB").resize((self.resolution, self.resolution))
        array = np.asarray(image).astype("float32") / 127.5 - 1.0
        pixel_values = torch.from_numpy(array).permute(2, 0, 1)
        tokenized = self.tokenizer(
            caption,
            padding="max_length",
            truncation=True,
            max_length=self.tokenizer.model_max_length,
            return_tensors="pt",
        )
        return {"pixel_values": pixel_values, "input_ids": tokenized.input_ids.squeeze(0)}


def _save_diffusion_lora_weights(output_path: Path, unet: Any, lora_config: dict[str, Any]) -> dict[str, Any]:
    output_path.mkdir(parents=True, exist_ok=True)
    try:
        from diffusers import StableDiffusionPipeline
        from diffusers.utils import convert_state_dict_to_diffusers
        from peft.utils import get_peft_model_state_dict

        unet_lora_state_dict = convert_state_dict_to_diffusers(get_peft_model_state_dict(unet))
        StableDiffusionPipeline.save_lora_weights(str(output_path), unet_lora_layers=unet_lora_state_dict, safe_serialization=True)
    except Exception:
        lora_dir = output_path / "unet_lora"
        lora_dir.mkdir(parents=True, exist_ok=True)
        unet.save_pretrained(str(lora_dir), safe_serialization=True)
        nested_adapter = lora_dir / "adapter_model.safetensors"
        if nested_adapter.exists():
            shutil.copyfile(nested_adapter, output_path / "adapter_model.safetensors")
    if not (output_path / "adapter_config.json").exists():
        (output_path / "adapter_config.json").write_text(json.dumps(lora_config, indent=2, ensure_ascii=False), encoding="utf-8")
    return {
        "serializationFormat": "diffusers-lora-safetensors" if (output_path / "pytorch_lora_weights.safetensors").exists() else "adapter-safetensors",
        "diffusersLoraPath": str(output_path / "pytorch_lora_weights.safetensors") if (output_path / "pytorch_lora_weights.safetensors").exists() else None,
        "adapterModelPath": str(output_path / "adapter_model.safetensors") if (output_path / "adapter_model.safetensors").exists() else None,
        "adapterConfigPath": str(output_path / "adapter_config.json"),
    }


def train_diffusion_lora_model(
    payload: TrainModelTaskRequest,
    *,
    training_task: str,
    run_id: str,
    output_path: Path,
    output_model_name: str,
    purpose_paths: dict[str, tuple[str, ...]] | None = None,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> TrainModelTaskResult:
    logs: list[str] = []
    warnings: list[str] = []
    try:
        if training_task != DIFFUSION_LORA_TASK:
            raise ValueError(f"Diffusion training task '{training_task}' is not recognized.")
        if payload.method != "lora":
            raise ValueError("Diffusion training currently supports the lora method.")
        try:
            import torch
            import torch.nn.functional as torch_functional
            from diffusers import AutoencoderKL, DDPMScheduler, UNet2DConditionModel
            from peft import LoraConfig
            from torch.utils.data import DataLoader
            from transformers import CLIPTextModel, CLIPTokenizer
        except Exception as error:  # pragma: no cover
            raise RuntimeError("diffusers, peft, transformers, torch, numpy, and pillow are required for diffusion LoRA training.") from error

        if on_progress is not None:
            on_progress({"stage": "initializing", "message": "Loading image dataset and diffusion model assets..."})

        bundle = load_manifest_bundle(payload)
        source_paths = staged_source_artifact_paths(payload)
        base_model_ref = _resolve_base_model(payload)
        common = _to_dict(payload.commonParameters)
        advanced = _to_dict(payload.advancedParameters)
        lora = _to_dict(advanced.get("lora"))
        resolution = _parse_positive_int(common.get("imageResolution"), DEFAULT_IMAGE_RESOLUTION)
        batch_size = _parse_positive_int(common.get("batchSize"), 1)
        max_steps = _parse_positive_int(common.get("maxSteps"), 0)
        epochs = _parse_positive_int(common.get("numEpochs"), 1)
        learning_rate = _parse_positive_float(common.get("learningRate"), 1e-4)
        rank = _parse_positive_int(lora.get("rank"), 16)
        alpha = _parse_positive_int(lora.get("alpha"), 32)
        dropout = float(lora.get("dropout", 0.05) or 0.05)
        target_modules = lora.get("targetModules")
        normalized_target_modules = [entry.strip() for entry in target_modules if isinstance(entry, str) and entry.strip()] if isinstance(target_modules, list) else ["to_q", "to_k", "to_v", "to_out.0"]

        tokenizer = CLIPTokenizer.from_pretrained(base_model_ref, subfolder="tokenizer")
        text_encoder = CLIPTextModel.from_pretrained(base_model_ref, subfolder="text_encoder")
        vae = AutoencoderKL.from_pretrained(base_model_ref, subfolder="vae")
        unet = UNet2DConditionModel.from_pretrained(base_model_ref, subfolder="unet")
        noise_scheduler = DDPMScheduler.from_pretrained(base_model_ref, subfolder="scheduler")

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if device.type == "cpu":
            warnings.append("Diffusion LoRA training is running on CPU and may be very slow.")
        text_encoder.to(device)
        vae.to(device)
        unet.to(device)
        vae.requires_grad_(False)
        text_encoder.requires_grad_(False)
        unet.requires_grad_(False)

        lora_config = {
            "r": rank,
            "lora_alpha": alpha,
            "target_modules": normalized_target_modules,
            "lora_dropout": dropout,
            "bias": "none",
        }
        if not hasattr(unet, "add_adapter"):
            raise RuntimeError("The installed diffusers/peft versions do not expose UNet add_adapter support for LoRA training.")
        unet.add_adapter(LoraConfig(**lora_config))
        trainable_parameters = [parameter for parameter in unet.parameters() if parameter.requires_grad]
        if not trainable_parameters:
            raise RuntimeError("No trainable LoRA parameters were created for the diffusion UNet.")
        optimizer = torch.optim.AdamW(trainable_parameters, lr=learning_rate)

        dataset = _DiffusionLoraDataset(bundle.train_rows, tokenizer, resolution, source_paths, purpose_paths)
        dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
        total_batches = max(len(dataloader) * epochs, 1)
        if max_steps > 0:
            total_batches = min(total_batches, max_steps)

        step = 0
        unet.train()
        for epoch_index in range(epochs):
            for batch in dataloader:
                step += 1
                pixel_values = batch["pixel_values"].to(device=device, dtype=vae.dtype)
                input_ids = batch["input_ids"].to(device)
                latents = vae.encode(pixel_values).latent_dist.sample()
                latents = latents * getattr(vae.config, "scaling_factor", 0.18215)
                noise = torch.randn_like(latents)
                timesteps = torch.randint(0, noise_scheduler.config.num_train_timesteps, (latents.shape[0],), device=device).long()
                noisy_latents = noise_scheduler.add_noise(latents, noise, timesteps)
                encoder_hidden_states = text_encoder(input_ids)[0]
                model_pred = unet(noisy_latents, timesteps, encoder_hidden_states).sample
                loss = torch_functional.mse_loss(model_pred.float(), noise.float(), reduction="mean")
                loss.backward()
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                logs.append(f"Epoch [{epoch_index + 1}]/[{epochs}], Batch [{step}]/[{total_batches}], Loss {float(loss.detach().cpu()):.6f}")
                if on_progress is not None:
                    on_progress({
                        "stage": "training",
                        "message": f"Epoch [{epoch_index + 1}]/[{epochs}], Batch [{min(step, total_batches)}]/[{total_batches}]",
                        "epoch": epoch_index + 1,
                        "totalEpochs": epochs,
                        "batch": min(step, total_batches),
                        "totalBatches": total_batches,
                    })
                if max_steps > 0 and step >= max_steps:
                    break
            if max_steps > 0 and step >= max_steps:
                break

        if on_progress is not None:
            on_progress({"stage": "serializing", "message": "Serializing diffusion LoRA adapter..."})
        serialization = _save_diffusion_lora_weights(output_path, unet, lora_config)
        validation_config = _to_dict(payload.validation)
        validation_enabled = bool(validation_config.get("enabled", True))
        validation = (
            validate_model_output(output_path, expected_lora=True, expected_recurrent_additions=bool(validation_config.get("expectedRecurrentAdditions", False)))
            if validation_enabled
            else {"status": "unknown", "warnings": ["Validation was disabled and did not run."], "errors": [], "validationReportPath": None}
        )
        metrics = {"train_loss": float(loss.detach().cpu()) if "loss" in locals() else 0.0}
        metadata, _manifest_path, _run_metadata_path = _build_output_metadata(
            payload=payload,
            run_id=run_id,
            training_task=training_task,
            output_path=output_path,
            serialization=serialization,
            validation=validation,
            metrics=metrics,
        )
        final_status = "failed" if validation_enabled and validation["status"] == "invalid" else "succeeded"
        generated_candidate = (
            _candidate(
                payload=payload,
                training_task=training_task,
                run_id=run_id,
                output_model_name=output_model_name,
                output_path=output_path,
                artifact_form="adapter",
                serialization=serialization,
                validation=validation,
                metadata=metadata,
            )
            if final_status == "succeeded"
            else None
        )
        if on_progress is not None:
            on_progress({"stage": "completed", "message": "Training task completed."})
        return TrainModelTaskResult(
            runId=run_id,
            status=final_status,
            outputDirectory=str(output_path),
            outputModelName=output_model_name,
            logs=logs,
            warnings=warnings + validation.get("warnings", []),
            checkpoints=[],
            metrics=metrics,
            validationReportPath=validation.get("validationReportPath"),
            generatedModelCandidate=generated_candidate,
            error=(
                {
                    "code": "validation_failed",
                    "message": "Training artifacts failed post-training validation.",
                    "details": {"validationStatus": validation.get("status"), "validationErrors": validation.get("errors", [])},
                }
                if final_status == "failed"
                else None
            ),
        )
    except Exception as error:
        if on_progress is not None:
            on_progress({"stage": "failed", "message": f"Training failed: {error}"})
        return _make_failed_result(
            payload=payload,
            run_id=run_id,
            output_path=output_path,
            output_model_name=output_model_name,
            training_task=training_task,
            error=error,
            logs=logs,
            warnings=warnings,
        )
