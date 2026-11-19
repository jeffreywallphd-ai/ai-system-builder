"""Private exact-file integrity protocol; no acquisition or model-readiness authority."""
from __future__ import annotations

import hashlib
import json
import os
import stat
from typing import Any

from ..models import ModelDownloadManifest, MAX_MODEL_DOWNLOAD_SOURCE_FILES as MAX_SOURCE_FILES

BLOCK_BYTES = 64 * 1024
MAX_INDEX_BYTES = 1024 * 1024


class ModelDownloadManifestError(RuntimeError):
    error_code = "model_download_manifest_not_confirmed"
    stage = "generation"
    retryable = False

    def __init__(self) -> None:
        super().__init__("The selected model files could not be verified.")



def capture_manifest(value: Any, model_id: str, revision: str | None) -> ModelDownloadManifest:
    """A fresh immutable normalized copy, before SDK, cache or environment effects."""
    try:
        raw = value.model_dump(mode="json") if isinstance(value, ModelDownloadManifest) else value
        manifest = ModelDownloadManifest.model_validate(raw)
        if manifest.source.modelId != model_id or manifest.source.revision != revision:
            raise ValueError("Model source does not match the request.")
        return manifest
    except Exception:
        raise ModelDownloadManifestError() from None


def _identity(facts: os.stat_result) -> tuple[int, ...]:
    return (facts.st_dev, facts.st_ino, facts.st_mode, facts.st_size, facts.st_mtime_ns, facts.st_ctime_ns,
            getattr(facts, "st_file_attributes", 0), getattr(facts, "st_reparse_tag", 0))


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ModelDownloadManifestError()
        result[key] = value
    return result


def verify_snapshot(manifest: ModelDownloadManifest, local_path: str, *, allow_missing: bool = False) -> bool:
    """Verify selected bytes at this read; this is not a durable native file fence."""
    from .local_text_generation import _selected_transformers_snapshot, _resolve_transformers_snapshot_file

    try:
        source = manifest.source
        root, repository = _selected_transformers_snapshot(source.modelId, local_path)
        if root.name != source.revision:
            raise ModelDownloadManifestError()
        root_before = _identity(root.lstat())
        selected = {file.path: file for file in source.files}
        names: set[str] = set()
        with os.scandir(root) as entries:
            for entry in entries:
                if len(names) >= MAX_SOURCE_FILES or entry.name not in selected:
                    raise ModelDownloadManifestError()
                names.add(entry.name)
        if not allow_missing and names != set(selected):
            raise ModelDownloadManifestError()
        index_bytes: bytes | None = None
        for name in sorted(names):
            expected = selected[name]
            visible = root / name
            visible_before = _identity(visible.lstat())
            resolved = _resolve_transformers_snapshot_file(root, repository, name)
            before = resolved.lstat()
            if before.st_size != expected.sizeBytes:
                raise ModelDownloadManifestError()
            checksum = hashlib.sha256() if expected.integrity.algorithm == "sha256" else hashlib.sha1()
            if expected.integrity.algorithm == "git-blob-sha1":
                checksum.update(f"blob {expected.sizeBytes}\0".encode("ascii"))
            if name == "model.safetensors.index.json" and expected.sizeBytes > MAX_INDEX_BYTES:
                raise ModelDownloadManifestError()
            captured = bytearray() if name == "model.safetensors.index.json" else None
            fd = os.open(resolved, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as stream:
                opened = _identity(os.fstat(stream.fileno()))
                # Windows path/handle stat APIs can report different ctime
                # semantics. Retain each API's own ctime before/after guard;
                # compare their common file facts without equating those times.
                path_facts = _identity(before)
                if not stat.S_ISREG(opened[2]) or opened[:5] + opened[6:] != path_facts[:5] + path_facts[6:]:
                    raise ModelDownloadManifestError()
                remaining = expected.sizeBytes
                while remaining:
                    part = stream.read(min(BLOCK_BYTES, remaining))
                    if not part:
                        raise ModelDownloadManifestError()
                    remaining -= len(part); checksum.update(part)
                    if captured is not None:
                        captured.extend(part)
                if stream.read(1) or _identity(os.fstat(stream.fileno())) != opened:
                    raise ModelDownloadManifestError()
            if (checksum.hexdigest() != expected.integrity.digest or _identity(resolved.lstat()) != _identity(before) or
                    _identity(visible.lstat()) != visible_before or
                    _resolve_transformers_snapshot_file(root, repository, name) != resolved):
                raise ModelDownloadManifestError()
            if captured is not None:
                index_bytes = bytes(captured)
        if index_bytes is not None:
            index = json.loads(index_bytes.decode("utf-8"), object_pairs_hook=_unique_json_object)
            mapping = index.get("weight_map") if type(index) is dict else None
            if (type(mapping) is not dict or not 1 <= len(mapping) <= 65536 or
                    any(type(value) is not str or value not in selected or not value.endswith(".safetensors") for value in mapping.values())):
                raise ModelDownloadManifestError()
            # An index may not conceal a different approved-but-unused shard.
            if set(mapping.values()) != {name for name in selected if name.endswith(".safetensors")}:
                raise ModelDownloadManifestError()
        elif names == set(selected) and "model.safetensors" not in names:
            raise ModelDownloadManifestError()
        if _identity(root.lstat()) != root_before:
            raise ModelDownloadManifestError()
        return names == set(selected)
    except ModelDownloadManifestError:
        raise
    except Exception:
        raise ModelDownloadManifestError() from None
