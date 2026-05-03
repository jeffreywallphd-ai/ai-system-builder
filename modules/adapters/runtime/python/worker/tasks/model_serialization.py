from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_MAX_SHARD_SIZE = "2GB"


def _copy_text_file(source: Path, destination: Path) -> None:
    if source.exists() and source.is_file():
        destination.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")


def _copy_if_exists(source_dir: Path, destination_dir: Path, file_name: str) -> None:
    source = source_dir / file_name
    if source.exists() and source.is_file():
        destination = destination_dir / file_name
        destination.write_bytes(source.read_bytes())


def save_full_model_pretrained(model: Any, tokenizer: Any, output_dir: Path, max_shard_size: str | None = None) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    shard_size = max_shard_size or DEFAULT_MAX_SHARD_SIZE

    model.save_pretrained(str(output_dir), safe_serialization=True, max_shard_size=shard_size)
    if tokenizer is not None:
        tokenizer.save_pretrained(str(output_dir))

    index_file = output_dir / "model.safetensors.index.json"
    safetensors_files = sorted(path.name for path in output_dir.glob("*.safetensors"))
    serialization_format = "sharded-safetensors" if index_file.exists() else "safetensors"

    return {
        "serializationFormat": serialization_format,
        "safetensorsFiles": safetensors_files,
        "indexFile": str(index_file) if index_file.exists() else None,
        "maxShardSize": shard_size,
    }


def save_adapter_pretrained(peft_model: Any, tokenizer: Any, output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    peft_model.save_pretrained(str(output_dir), safe_serialization=True)
    if tokenizer is not None:
        tokenizer.save_pretrained(str(output_dir))

    _copy_if_exists(output_dir, output_dir, "adapter_config.json")
    _copy_if_exists(output_dir, output_dir, "adapter_model.safetensors")

    return {
        "serializationFormat": "adapter-safetensors",
        "adapterConfigPath": str(output_dir / "adapter_config.json") if (output_dir / "adapter_config.json").exists() else None,
        "adapterModelPath": str(output_dir / "adapter_model.safetensors") if (output_dir / "adapter_model.safetensors").exists() else None,
    }


def write_serialization_manifest(output_dir: Path, payload: dict[str, Any]) -> str:
    path = output_dir / "serialization_manifest.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return str(path)
