from __future__ import annotations

import json
import hashlib
import math
import re
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LORA_KEY_PATTERNS = ("lora_", ".lora_", "lora_A", "lora_B")
RECURRENT_KEY_PATTERNS = ("recurrent", "gru", "lstm")
MAX_SAFETENSORS_INDEX_BYTES = 8 * 1024 * 1024
MAX_SAFETENSORS_INDEX_MEMBERS = 100_000
WINDOWS_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")

_PROTECTED_RESULT_NAMES = frozenset(("config.json", "generation_config.json", "tokenizer.json",
    "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt",
    "model.safetensors", "adapter_config.json", "adapter_model.safetensors", "serialization_manifest.json", "training-run.json"))
_PROTECTED_TENSOR_WIDTHS = {"BOOL":1,"U8":1,"I8":1,"I16":2,"I32":4,"I64":8,
    "F16":2,"BF16":2,"F32":4,"F64":8}


def _result_need(value: bool) -> None:
    if value is not True:
        raise ValueError("The protected training result structure is unavailable.")


def _result_json(raw: bytes) -> dict:
    def pairs(rows):
        result = {}
        for key,value in rows:
            _result_need(key not in result); result[key] = value
        return result
    def constant(_): raise ValueError("Invalid JSON constant")
    def number(raw):
        value = float(raw); _result_need(math.isfinite(value)); return value
    value = json.loads(raw.decode("utf8"),object_pairs_hook=pairs,parse_constant=constant,parse_float=number)
    _result_need(type(value) is dict)
    return value


def _protected_tensor_header(raw: bytes, size: int) -> dict[str, list[int]]:
    _result_need(len(raw) >= 8)
    length = struct.unpack("<Q",raw[:8])[0]
    _result_need(0 < length <= 1024**2 and length % 8 == 0 and len(raw) == 8+length <= size
        and raw[8:9] == b"{")
    header = _result_json(raw[8:]); metadata = header.pop("__metadata__",None)
    _result_need(metadata == {"format":"pt"} and 1 <= len(header) <= 4096)
    shapes,intervals = {},[]
    for name,row in header.items():
        _result_need(type(name) is str and re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,511}",name) is not None
            and type(row) is dict and set(row) == {"dtype","shape","data_offsets"})
        dtype,shape,offsets = row["dtype"],row["shape"],row["data_offsets"]
        _result_need(type(dtype) is str and dtype in _PROTECTED_TENSOR_WIDTHS
            and type(shape) is list and len(shape) <= 32 and type(offsets) is list and len(offsets) == 2
            and all(type(n) is int and 0 <= n <= size for n in offsets))
        width = _PROTECTED_TENSOR_WIDTHS[dtype]; count,stride = 1,width*8
        for dimension in shape:
            _result_need(type(dimension) is int and 0 <= dimension <= 2**53-1)
            if dimension:
                _result_need(stride <= (2**64-1)//dimension); stride *= dimension
            count *= dimension
        start,end = offsets
        _result_need(start <= end and end-start == count*width)
        intervals.append((start,end)); shapes[name] = shape
    following = 0
    for start,end in sorted(intervals):
        _result_need(start == following); following = end
    _result_need(following == size-len(raw))
    return shapes


def _protected_code_declarations(value) -> None:
    if type(value) is dict:
        for key,item in value.items():
            if key in ("auto_map","auto_mapping","_auto_class","custom_pipelines"):
                _result_need(item is None or type(item) is dict and not item)
            elif key == "trust_remote_code":
                _result_need(item is None or item is False)
            _protected_code_declarations(item)
    elif type(value) is list:
        for item in value:_protected_code_declarations(item)


def validate_protected_training_output_chunks(chunks, files, *, method: str,
        maximum_copy_bytes: int, maximum_metadata_bytes: int, chunk_bytes: int) -> dict[str, Any]:
    """Pure structural data checks, never Native custody or task/Save authority.

    The original producer must separately bind the genuine one-use Native stream,
    descriptors and live authority. Caller-supplied bytes cannot supply that proof.
    This helper opens no paths, runs no model/SDK and retains no tensor body.
    """
    try:
        _result_need(type(method) is str and method in ("full-finetune","lora","qlora")
            and type(maximum_copy_bytes) is int and 1 <= maximum_copy_bytes <= 2**53-1
            and type(maximum_metadata_bytes) is int and 1 <= maximum_metadata_bytes <= min(maximum_copy_bytes,64*1024**2)
            and type(chunk_bytes) is int and 4096 <= chunk_bytes <= 1024**2
            and type(files) is tuple and 1 <= len(files) <= len(_PROTECTED_RESULT_NAMES))
        names,total = set(),0
        for row in files:
            _result_need(type(row) is tuple and len(row) == 3)
            name,size,sha = row
            _result_need(type(name) is str and name in _PROTECTED_RESULT_NAMES and name not in names
                and type(size) is int and 1 <= size <= maximum_copy_bytes
                and type(sha) is str and re.fullmatch(r"[a-f0-9]{64}",sha) is not None)
            names.add(name); total += size
        _result_need(total <= maximum_copy_bytes and "tokenizer.json" in names)
        adapter = method != "full-finetune"
        weight = "adapter_model.safetensors" if adapter else "model.safetensors"
        config = "adapter_config.json" if adapter else "config.json"
        _result_need({weight,config} <= names and not names &
            ({"model.safetensors","config.json","generation_config.json"} if adapter else {"adapter_model.safetensors","adapter_config.json"}))
        records = {"training-run.json","serialization_manifest.json"}
        _result_need("training-run.json" in names)
        _result_need(all(size <= 128*1024 for name,size,_ in files if name in records))
        index,offset,metadata_size = 0,0,0
        digest = hashlib.sha256(); metadata,header = {},bytearray(); header_goal = None
        shapes = None; current_metadata = bytearray()
        for event in chunks:
            _result_need(type(event) is tuple and len(event) == 3 and index < len(files))
            name,position,raw = event; expected,size,sha = files[index]
            _result_need(type(name) is str and name == expected and type(position) is int and position == offset
                and type(raw) is bytes and len(raw) <= chunk_bytes)
            if not raw:
                _result_need(offset == size and digest.hexdigest() == sha)
                if name == weight: shapes = _protected_tensor_header(bytes(header),size)
                else:
                    metadata[name] = (current_metadata.decode("utf8") if name == "merges.txt"
                        else _result_json(bytes(current_metadata)))
                index += 1; offset = 0; digest = hashlib.sha256(); current_metadata = bytearray()
                continue
            _result_need(offset+len(raw) <= size)
            digest.update(raw); offset += len(raw)
            if name == weight:
                remaining = raw
                if len(header) < 8:
                    take = min(8-len(header),len(remaining)); header.extend(remaining[:take]); remaining = remaining[take:]
                if len(header) == 8 and header_goal is None:
                    length = struct.unpack("<Q",header)[0]
                    _result_need(0 < length <= 1024**2 and length % 8 == 0 and 8+length <= size)
                    header_goal = 8+length
                if header_goal is not None and len(header) < header_goal:
                    header.extend(remaining[:header_goal-len(header)])
            else:
                if name not in records:
                    metadata_size += len(raw); _result_need(metadata_size <= maximum_metadata_bytes)
                current_metadata.extend(raw)
        # Exhaust the source even after its last file marker. A genuine Native
        # stream performs its final all-file/root/authority check on that next().
        _result_need(index == len(files) and offset == 0 and shapes is not None)
        # The producer applies these restrictions recursively to configuration
        # exports. Vocabulary/token data keys must not be mistaken for code flags.
        for name in ("config.json","adapter_config.json","generation_config.json","tokenizer_config.json"):
            if name in metadata:_protected_code_declarations(metadata[name])
        tokenizer = metadata["tokenizer.json"]
        _protected_code_declarations({key:tokenizer[key] for key in
            ("auto_map","auto_mapping","_auto_class","custom_pipelines","trust_remote_code") if key in tokenizer})
        _result_need(type(tokenizer.get("model")) is dict and type(tokenizer["model"].get("type")) is str
            and tokenizer["model"]["type"] in ("BPE","WordPiece","WordLevel","Unigram"))
        if adapter: _result_need(metadata[config].get("peft_type") == "LORA")
        else: _result_need(type(metadata[config].get("model_type")) is str and bool(metadata[config]["model_type"]))
        run = metadata["training-run.json"];run_id = run.get("runId")
        _result_need(type(run_id) is str and re.fullmatch(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}",run_id) is not None
            and run.get("method") == method and run.get("candidateValidation") == "pending"
            and type(run.get("startedAt")) is str and 0 < len(run["startedAt"]) <= 128)
        if "serialization_manifest.json" in names:
            manifest = metadata["serialization_manifest.json"];task = run.get("trainingTask")
            _result_need(run.get("status") == "training-complete" and manifest.get("runId") == run_id
                and manifest.get("method") == method and type(task) is str
                and re.fullmatch(r"[a-z][a-z0-9-]{0,119}",task) is not None
                and type(manifest.get("trainingTask")) is str and manifest["trainingTask"] == task
                and type(run.get("serializationManifestPath")) is str
                and run["serializationManifestPath"] == "serialization_manifest.json"
                and type(manifest.get("serialization")) is dict)
            serialization = manifest["serialization"]
            _result_need(serialization.get("safetensorsFiles") == [weight]
                and serialization.get("serializationFormat") == ("adapter-safetensors" if adapter else "safetensors"))
        else:
            _result_need(set(run) == {"runId","startedAt","method","status","trainingStatus","checkpointStep","candidateValidation"}
                and run["status"] == "checkpoint-snapshot" and run["trainingStatus"] == "running"
                and type(run["checkpointStep"]) is int and 1 <= run["checkpointStep"] <= 2**53-1)
        return {"serializationFormat":"adapter-safetensors" if adapter else "safetensors",
            "tensorShapeSummary":shapes,"metadata":metadata,"files":files,
            "profile":"candidate" if records <= names else "checkpoint"}
    except Exception:
        raise ValueError("The protected training result structure is unavailable.") from None


def _detect_format(output_dir: Path) -> str:
    if (output_dir / "pytorch_lora_weights.safetensors").exists():
        return "diffusers-lora-safetensors"
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


def _read_safetensors_tensors(path: Path) -> tuple[set[str], dict[str, list[int]], str | None, str | None]:
    safe_open = _safe_open_module()
    if safe_open is None:
        return set(), {}, "safetensors dependency is unavailable; tensor-level checks were skipped.", None

    keys: set[str] = set()
    shapes: dict[str, list[int]] = {}
    try:
        with safe_open(str(path), framework="pt", device="cpu") as file_obj:
            for key in file_obj.keys():
                tensor = file_obj.get_tensor(key)
                shape = getattr(tensor, "shape", None)
                if shape is None:
                    raise ValueError("Tensor shape is unavailable.")
                shapes[key] = [int(dimension) for dimension in shape]
                keys.add(key)
    except Exception:
        # Never publish native exceptions, paths or partially inspected tensors.
        return set(), {}, None, "Safetensors weights could not be read or validated."
    return keys, shapes, None, None


def _resolve_contained_shard(output_dir: Path, shard_name: str) -> Path:
    if (
        not shard_name
        or len(shard_name) > 512
        or "\\" in shard_name
        or shard_name.startswith("/")
        or shard_name.startswith("//")
        or WINDOWS_DRIVE_PREFIX.match(shard_name)
    ):
        raise ValueError("Safetensors index contains an unsafe shard reference.")
    parts = shard_name.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise ValueError("Safetensors index contains an unsafe shard reference.")

    canonical_root = output_dir.resolve(strict=True)
    candidate = canonical_root.joinpath(*parts)
    if not candidate.exists():
        return candidate
    if candidate.is_symlink():
        raise ValueError("Safetensors index cannot reference linked shards.")
    canonical_candidate = candidate.resolve(strict=True)
    try:
        canonical_candidate.relative_to(canonical_root)
    except ValueError as error:
        raise ValueError(
            "Safetensors index contains an out-of-root shard reference."
        ) from error
    if not canonical_candidate.is_file():
        raise ValueError("Safetensors index must reference regular shard files.")
    return canonical_candidate


def _read_safetensors_index(output_dir: Path) -> tuple[dict[str, str], list[str], str | None]:
    index_file = output_dir / "model.safetensors.index.json"
    if not index_file.exists():
        return {}, [], None

    try:
        if index_file.is_symlink() or index_file.stat().st_size > MAX_SAFETENSORS_INDEX_BYTES:
            return {}, [], "model.safetensors.index.json is not an approved regular index file."
        data = json.loads(index_file.read_text(encoding="utf-8"))
    except Exception:
        return {}, [], "model.safetensors.index.json could not be parsed."

    weight_map = data.get("weight_map") if isinstance(data, dict) else None
    if not isinstance(weight_map, dict) or not weight_map:
        return {}, [], "model.safetensors.index.json weight_map is invalid."

    if len(weight_map) > MAX_SAFETENSORS_INDEX_MEMBERS:
        return {}, [], "model.safetensors.index.json exceeds the shard member limit."

    normalized: dict[str, str] = {}
    missing = []
    for tensor_key, shard in weight_map.items():
        if not isinstance(tensor_key, str) or not tensor_key or not isinstance(shard, str):
            return {}, [], "model.safetensors.index.json weight_map is invalid."
        shard_name = shard.strip()
        try:
            shard_path = _resolve_contained_shard(output_dir, shard_name)
        except ValueError as error:
            return {}, [], str(error)
        normalized[tensor_key] = shard_name
        if not shard_path.exists() and shard_name not in missing:
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
        errors.append("Model path does not exist.")
    elif not output_dir.is_dir():
        errors.append("Model path is not a directory.")

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
                        "validatedModelRef": "registered-model",
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
            "validatedModelRef": "registered-model",
            "validatedAt": datetime.now(timezone.utc).isoformat(),
        }
    format_name = _detect_format(output_dir)
    tensor_checks_required = format_name in {"safetensors", "sharded-safetensors", "adapter-safetensors", "diffusers-lora-safetensors"}
    tensor_checks_completed = True

    has_config = (output_dir / "config.json").exists()
    has_tokenizer = any((output_dir / name).exists() for name in ["tokenizer.json", "tokenizer_config.json"])
    has_processor = any((output_dir / name).exists() for name in ["preprocessor_config.json", "image_processor_config.json", "processor_config.json", "feature_extractor_config.json"])
    has_adapter_config = (output_dir / "adapter_config.json").exists()
    has_adapter_model = (output_dir / "adapter_model.safetensors").exists()
    has_diffusers_lora_model = (output_dir / "pytorch_lora_weights.safetensors").exists()
    has_adapter_weights = has_adapter_model or has_diffusers_lora_model

    weight_map, missing_shards, index_error = _read_safetensors_index(output_dir)
    if index_error:
        errors.append(index_error)
    if index_error or missing_shards:
        tensor_checks_completed = False

    shard_names = sorted(set(weight_map.values()))

    missing_tensor_keys: list[str] = []
    all_tensor_keys: set[str] = set()
    tensor_shape_summary: dict[str, list[int]] = {}
    tensor_read_failed = False

    def inspect_tensors(path: Path) -> set[str] | None:
        nonlocal tensor_checks_completed, tensor_read_failed
        if tensor_read_failed:
            return None
        present_keys, shapes, warning, error = _read_safetensors_tensors(path)
        all_tensor_keys.update(present_keys)
        tensor_shape_summary.update(shapes)
        if error:
            tensor_checks_completed = False
            tensor_read_failed = True
            # A failed shard invalidates the whole model's aggregate inspection.
            all_tensor_keys.clear()
            tensor_shape_summary.clear()
            missing_tensor_keys.clear()
            errors.append(error)
            return None
        elif warning:
            tensor_checks_completed = False
            (errors if validation_strictness == "publish" else warnings).append(warning)
            return None
        return present_keys

    # Adapter outputs must be complete.
    if has_adapter_config != has_adapter_weights:
        errors.append("Adapter output is partial; adapter_config.json and adapter safetensors weights are required.")

    # Full model outputs should include config.
    is_adapter_output = has_adapter_config and has_adapter_weights
    if format_name in {"safetensors", "sharded-safetensors"} and not is_adapter_output and not has_config:
        errors.append("config.json is required for full-model safetensors outputs.")

    if format_name in {"safetensors", "sharded-safetensors", "adapter-safetensors", "diffusers-lora-safetensors"} and not has_tokenizer and not has_processor and not is_adapter_output:
        warnings.append("Tokenizer or processor files were not found.")

    if missing_shards:
        errors.append(f"Missing safetensors shards referenced by index: {', '.join(missing_shards)}")

    if weight_map and not missing_shards:
        by_shard: dict[str, set[str]] = {}
        for tensor_key, shard_name in weight_map.items():
            by_shard.setdefault(shard_name, set()).add(tensor_key)

        for shard_name, expected_keys in by_shard.items():
            shard_path = _resolve_contained_shard(output_dir, shard_name)
            present_keys = inspect_tensors(shard_path)
            if present_keys is None:
                continue
            for expected_key in sorted(expected_keys):
                if expected_key not in present_keys:
                    missing_tensor_keys.append(f"{shard_name}:{expected_key}")

    if format_name == "safetensors" and not weight_map:
        single = output_dir / "model.safetensors"
        if single.exists():
            inspect_tensors(single)

    if has_adapter_model:
        inspect_tensors(output_dir / "adapter_model.safetensors")

    if has_diffusers_lora_model:
        inspect_tensors(output_dir / "pytorch_lora_weights.safetensors")

    if tensor_checks_required and not tensor_checks_completed and validation_strictness == "publish":
        errors.append("Tensor-level safetensors checks are required for publish-bound validation.")

    if missing_tensor_keys:
        errors.append(f"Missing tensor keys referenced by index: {', '.join(missing_tensor_keys)}")

    detected_lora = has_adapter_config or has_adapter_weights
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
            "processor": has_processor,
            "safetensors": format_name in {"safetensors", "sharded-safetensors", "adapter-safetensors", "diffusers-lora-safetensors"},
            "adapterFiles": has_adapter_config and has_adapter_weights,
        },
        "tensorChecksCompleted": tensor_checks_completed if tensor_checks_required else True,
        "validationStrictness": validation_strictness,
        "validatedModelRef": "registered-model",
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
        "validatedModelRef": "registered-model",
        "validatedAt": datetime.now(timezone.utc).isoformat(),
    }
