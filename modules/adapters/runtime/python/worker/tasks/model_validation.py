from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LORA_KEY_PATTERNS = ("lora_", ".lora_", "lora_A", "lora_B")
RECURRENT_KEY_PATTERNS = ("recurrent", "gru", "lstm")


def _detect_format(output_dir: Path) -> str:
    if (output_dir / "adapter_model.safetensors").exists():
        return "adapter-safetensors"
    if (output_dir / "model.safetensors.index.json").exists():
        return "sharded-safetensors"
    if (output_dir / "model.safetensors").exists():
        return "safetensors"
    if list(output_dir.glob("*.safetensors")):
        return "safetensors"
    if list(output_dir.glob("*.bin")) or list(output_dir.glob("*.pt")):
        return "pytorch-bin"
    return "unknown"


def _safe_open_module() -> Any | None:
    try:
        from safetensors import safe_open

        return safe_open
    except Exception:
        return None


def _read_safetensors_tensors(path: Path) -> tuple[set[str], dict[str, list[int]], str | None]:
    safe_open = _safe_open_module()
    if safe_open is None:
        return set(), {}, "safetensors dependency is unavailable; tensor-level checks were skipped."

    keys: set[str] = set()
    shapes: dict[str, list[int]] = {}
    with safe_open(str(path), framework="pt", device="cpu") as file_obj:
        for key in file_obj.keys():
            keys.add(key)
            try:
                tensor = file_obj.get_tensor(key)
                shape = getattr(tensor, "shape", None)
                if shape is not None:
                    shapes[key] = [int(dimension) for dimension in shape]
            except Exception:
                continue
    return keys, shapes, None


def _read_safetensors_index(output_dir: Path) -> tuple[dict[str, str], list[str], str | None]:
    index_file = output_dir / "model.safetensors.index.json"
    if not index_file.exists():
        return {}, [], None

    try:
        data = json.loads(index_file.read_text(encoding="utf-8"))
    except Exception:
        return {}, [], "model.safetensors.index.json could not be parsed."

    weight_map = data.get("weight_map", {})
    if not isinstance(weight_map, dict):
        return {}, [], "model.safetensors.index.json weight_map is invalid."

    normalized: dict[str, str] = {}
    missing = []
    for tensor_key, shard in weight_map.items():
        shard_name = str(shard)
        normalized[str(tensor_key)] = shard_name
        if not (output_dir / shard_name).exists() and shard_name not in missing:
            missing.append(shard_name)

    return normalized, missing, None


def validate_model_output(
    output_dir: Path,
    *,
    report_output_dir: Path | None = None,
    expected_lora: bool = False,
    expected_recurrent_additions: bool = False,
    validation_strictness: str = "normal",
    recurrent_key_patterns: tuple[str, ...] = RECURRENT_KEY_PATTERNS,
    lora_key_patterns: tuple[str, ...] = LORA_KEY_PATTERNS,
) -> dict[str, Any]:
    warnings: list[str] = []
    errors: list[str] = []
    if not output_dir.exists():
        errors.append(f"Model path does not exist: {output_dir}")
    elif not output_dir.is_dir():
        errors.append(f"Model path is not a directory: {output_dir}")

    if errors:
        report_path: str | None = None
        diff_path: str | None = None
        if report_output_dir is not None:
            report_output_dir.mkdir(parents=True, exist_ok=True)
            report_name = f"{output_dir.name or 'model'}_validation_report.md"
            diff_name = f"{output_dir.name or 'model'}_validation_diff.json"
            fallback_report = report_output_dir / report_name
            fallback_diff = report_output_dir / diff_name
            fallback_diff.write_text(
                json.dumps(
                    {
                        "errors": errors,
                        "warnings": warnings,
                        "validationStrictness": validation_strictness,
                        "validatedModelPath": str(output_dir),
                    },
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            fallback_report.write_text(
                "\n".join([
                    "# Model Validation Report",
                    "",
                    "- Status: **invalid**",
                    f"- Validation strictness: `{validation_strictness}`",
                    "",
                    "## Errors",
                    *[f"- {error}" for error in errors],
                ]),
                encoding="utf-8",
            )
            report_path = str(fallback_report)
            diff_path = str(fallback_diff)

        status = "invalid"
        return {
            "status": status,
            "serializationFormat": "unknown",
            "validationReportPath": report_path,
            "validationDiffPath": diff_path,
            "warnings": warnings,
            "errors": errors,
            "shardCount": 0,
            "detectedLoRA": False,
            "detectedRecurrentAdditions": False,
            "tensorChecksCompleted": False,
            "validationStrictness": validation_strictness,
            "validatedModelPath": str(output_dir),
            "validatedAt": datetime.now(timezone.utc).isoformat(),
        }
    format_name = _detect_format(output_dir)
    tensor_checks_required = format_name in {"safetensors", "sharded-safetensors", "adapter-safetensors"}
    tensor_checks_completed = True

    has_config = (output_dir / "config.json").exists()
    has_tokenizer = any((output_dir / name).exists() for name in ["tokenizer.json", "tokenizer_config.json"])
    has_adapter_config = (output_dir / "adapter_config.json").exists()
    has_adapter_model = (output_dir / "adapter_model.safetensors").exists()

    weight_map, missing_shards, index_error = _read_safetensors_index(output_dir)
    if index_error:
        errors.append(index_error)

    shard_names = sorted(set(weight_map.values()))

    missing_tensor_keys: list[str] = []
    all_tensor_keys: set[str] = set()
    tensor_shape_summary: dict[str, list[int]] = {}

    # Adapter outputs must be complete.
    if has_adapter_config != has_adapter_model:
        errors.append("Adapter output is partial; both adapter_config.json and adapter_model.safetensors are required.")

    # Full model outputs should include config.
    is_adapter_output = has_adapter_config and has_adapter_model
    if format_name in {"safetensors", "sharded-safetensors"} and not is_adapter_output and not has_config:
        errors.append("config.json is required for full-model safetensors outputs.")

    if format_name in {"safetensors", "sharded-safetensors", "adapter-safetensors"} and not has_tokenizer:
        warnings.append("Tokenizer files were not found (tokenizer.json or tokenizer_config.json).")

    if missing_shards:
        errors.append(f"Missing safetensors shards referenced by index: {', '.join(missing_shards)}")

    if weight_map and not missing_shards:
        by_shard: dict[str, set[str]] = {}
        for tensor_key, shard_name in weight_map.items():
            by_shard.setdefault(shard_name, set()).add(tensor_key)

        for shard_name, expected_keys in by_shard.items():
            shard_path = output_dir / shard_name
            present_keys, shapes, shard_warning = _read_safetensors_tensors(shard_path)
            all_tensor_keys.update(present_keys)
            tensor_shape_summary.update(shapes)
            if shard_warning:
                tensor_checks_completed = False
                if validation_strictness == "publish":
                    errors.append(shard_warning)
                else:
                    warnings.append(shard_warning)
                continue
            for expected_key in sorted(expected_keys):
                if expected_key not in present_keys:
                    missing_tensor_keys.append(f"{shard_name}:{expected_key}")

    if format_name == "safetensors" and not weight_map:
        single = output_dir / "model.safetensors"
        if single.exists():
            present_keys, shapes, shard_warning = _read_safetensors_tensors(single)
            all_tensor_keys.update(present_keys)
            tensor_shape_summary.update(shapes)
            if shard_warning:
                tensor_checks_completed = False
                if validation_strictness == "publish":
                    errors.append(shard_warning)
                else:
                    warnings.append(shard_warning)

    if has_adapter_model:
        present_keys, shapes, shard_warning = _read_safetensors_tensors(output_dir / "adapter_model.safetensors")
        all_tensor_keys.update(present_keys)
        tensor_shape_summary.update(shapes)
        if shard_warning:
            tensor_checks_completed = False
            if validation_strictness == "publish":
                errors.append(shard_warning)
            else:
                warnings.append(shard_warning)

    if tensor_checks_required and not tensor_checks_completed and validation_strictness == "publish":
        errors.append("Tensor-level safetensors checks are required for publish-bound validation.")

    if missing_tensor_keys:
        errors.append(f"Missing tensor keys referenced by index: {', '.join(missing_tensor_keys)}")

    detected_lora = has_adapter_config or has_adapter_model
    detected_lora_keys = sorted([key for key in all_tensor_keys if any(pattern in key for pattern in lora_key_patterns)])
    if detected_lora_keys:
        detected_lora = True

    detected_recurrent_keys = sorted([key for key in all_tensor_keys if any(pattern in key.lower() for pattern in recurrent_key_patterns)])
    detected_recurrent = len(detected_recurrent_keys) > 0

    if expected_lora and not detected_lora:
        errors.append("Expected LoRA adapter artifacts or keys, but none were detected.")

    if expected_recurrent_additions and not detected_recurrent:
        warnings.append("Expected recurrent/additional layer keys were not detected.")

    status = "valid"
    if errors:
        status = "invalid"
    elif warnings:
        status = "warning"

    diff_report = {
        "added": [],
        "missing": [f"-{name}" for name in missing_shards],
        "shapeChanges": [],
        "loraDetected": detected_lora,
        "recurrentDetected": detected_recurrent,
        "tensorCount": len(all_tensor_keys),
        "shardCount": len(shard_names),
        "missingShardFiles": missing_shards,
        "missingTensorKeys": missing_tensor_keys,
        "detectedLoRAKeys": detected_lora_keys,
        "detectedRecurrentKeys": detected_recurrent_keys,
        "tensorShapeSummary": tensor_shape_summary,
        "shardSummary": {
            "count": len(shard_names),
            "shards": shard_names,
            "missing": missing_shards,
        },
        "hfCompatibility": {
            "config": has_config,
            "tokenizer": has_tokenizer,
            "safetensors": format_name in {"safetensors", "sharded-safetensors", "adapter-safetensors"},
            "adapterFiles": has_adapter_config and has_adapter_model,
        },
        "tensorChecksCompleted": tensor_checks_completed if tensor_checks_required else True,
        "validationStrictness": validation_strictness,
        "validatedModelPath": str(output_dir),
    }

    diff_path = output_dir / "model_validation_diff.json"
    diff_path.write_text(json.dumps(diff_report, indent=2, ensure_ascii=False), encoding="utf-8")

    markdown_lines = [
        "# Model Validation Report",
        "",
        f"- Status: **{status}**",
        f"- Serialization format: `{format_name}`",
        f"- Detected LoRA: `{detected_lora}`",
        f"- Detected recurrent/additional keys: `{detected_recurrent}`",
        f"- Tensor count: `{len(all_tensor_keys)}`",
        f"- Shard count: `{len(shard_names)}`",
    ]
    if warnings:
        markdown_lines.append("")
        markdown_lines.append("## Warnings")
        markdown_lines.extend([f"- {w}" for w in warnings])
    if errors:
        markdown_lines.append("")
        markdown_lines.append("## Errors")
        markdown_lines.extend([f"- {e}" for e in errors])

    report_path = output_dir / "model_validation_report.md"
    report_path.write_text("\n".join(markdown_lines), encoding="utf-8")

    return {
        "status": status,
        "serializationFormat": format_name,
        "validationReportPath": str(report_path),
        "validationDiffPath": str(diff_path),
        "warnings": warnings,
        "errors": errors,
        "shardCount": len(shard_names),
        "detectedLoRA": detected_lora,
        "detectedRecurrentAdditions": detected_recurrent,
        "tensorChecksCompleted": tensor_checks_completed if tensor_checks_required else True,
        "validationStrictness": validation_strictness,
        "validatedModelPath": str(output_dir),
        "validatedAt": datetime.now(timezone.utc).isoformat(),
    }
