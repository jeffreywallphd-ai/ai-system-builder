from __future__ import annotations

from collections.abc import Mapping
from contextlib import contextmanager
from dataclasses import dataclass
import gc
import importlib.metadata as importlib_metadata
import importlib.util
import inspect
import json
import math
import os
from os import environ
from pathlib import Path
import re
import shutil
from threading import Event, Lock, Thread
import time
from typing import Any, Callable

from ..models import ExampleGenerationConfig, LocalModelConfig
from .constrained_json_decoder import (
    ConstrainedJsonDecoder,
    ConstrainedJsonDecoderError,
)

DEFAULT_MAX_NEW_TOKENS = 256
DEFAULT_HUGGINGFACE_DOWNLOAD_TIMEOUT_SECONDS = "60"
DEFAULT_HUGGINGFACE_ETAG_TIMEOUT_SECONDS = "30"
DEFAULT_HUGGINGFACE_DOWNLOAD_ATTEMPTS = 3
DEFAULT_HUGGINGFACE_DOWNLOAD_RETRY_DELAY_SECONDS = 1.0
DEFAULT_HUGGINGFACE_CACHE_PROGRESS_INTERVAL_SECONDS = 5.0
MIN_STRUCTURED_DOWNLOAD_PROGRESS_INTERVAL_SECONDS = 0.5
DEFAULT_HUGGINGFACE_CHECKPOINT_MIN_BYTES = 100 * 1024 * 1024
DEFAULT_HUGGINGFACE_MAX_MODEL_BYTES = 20 * 1024 * 1024 * 1024
DEFAULT_HUGGINGFACE_MAX_CACHE_FILES = 100_000
MAX_TRANSFORMERS_WEIGHT_INDEX_BYTES = 16 * 1024 * 1024
GIBIBYTE = 1024 * 1024 * 1024
MEMORY_OVERFLOW_POLICY_BYTES = {
    "none": 0,
    "limited": GIBIBYTE,
    "extended": 4 * GIBIBYTE,
}
HUGGINGFACE_MODEL_ID_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$"
)


def configure_huggingface_download_environment() -> None:
    environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", DEFAULT_HUGGINGFACE_DOWNLOAD_TIMEOUT_SECONDS)
    environ.setdefault("HF_HUB_ETAG_TIMEOUT", DEFAULT_HUGGINGFACE_ETAG_TIMEOUT_SECONDS)
    environ.setdefault("HF_HUB_DISABLE_XET", "1")

    hf_home = environ.get("HF_HOME")
    if hf_home and not environ.get("HF_XET_CACHE"):
        environ["HF_XET_CACHE"] = str(Path(hf_home) / "xet")


@dataclass
class GenerationModelAvailability:
    provider: str
    model_id: str
    downloaded: bool
    from_cache: bool
    local_path: str | None = None
    cache_handle: str | None = None


class GenerationRuntimeDependencyError(RuntimeError):
    """Raised when managed components required to run a model are unavailable."""


class GenerationModelDownloadIncompleteError(RuntimeError):
    """Raised when a local model snapshot exists but is not complete."""


class GenerationModelDownloadError(RuntimeError):
    """Raised when a resumable model download cannot finish."""

    error_code = "model_download_interrupted"
    stage = "generation"
    retryable = True


class GenerationModelDownloadInvalidError(RuntimeError):
    """Raised when downloaded files do not form a complete model snapshot."""

    error_code = "model_download_invalid_snapshot"
    stage = "generation"
    retryable = True


class GenerationModelLoadError(RuntimeError):
    """Raised when a validated local model snapshot cannot be loaded."""


class GenerationInsufficientResourcesError(RuntimeError):
    '''Raised when loading a model exceeds the configured memory-overflow bound.'''


@dataclass(frozen=True)
class HuggingFaceSnapshotDownloadProfile:
    name: str
    allow_patterns: tuple[str, ...] | None
    ignore_patterns: tuple[str, ...]


GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE = HuggingFaceSnapshotDownloadProfile(
    name="transformers",
    allow_patterns=None,
    ignore_patterns=(
        "*.h5",
        "*.msgpack",
        "*.onnx",
        "*.ot",
        "*.tflite",
        "flax_model.*",
        "model.onnx*",
        "openvino_model.*",
        "tf_model.*",
    ),
)

CHECKPOINT_SNAPSHOT_PROFILE = HuggingFaceSnapshotDownloadProfile(
    name="checkpoint",
    allow_patterns=("*.ckpt", "*.safetensors"),
    ignore_patterns=("*/*", "*lora*", "*LoRA*", "*adapter*", "*Adapter*"),
)


def _snapshot_file_stats(path: str | Path | None) -> dict[str, int]:
    if not path:
        return {"fileCount": 0, "totalBytes": 0}

    snapshot_path = Path(path)
    if not snapshot_path.exists():
        return {"fileCount": 0, "totalBytes": 0}

    file_count = 0
    total_bytes = 0
    for child in snapshot_path.rglob("*"):
        if not child.is_file():
            continue
        file_count += 1
        if file_count > DEFAULT_HUGGINGFACE_MAX_CACHE_FILES:
            raise RuntimeError("Hugging Face snapshot exceeded the configured file-count limit.")
        try:
            total_bytes += child.stat().st_size
            if total_bytes > _parse_huggingface_max_model_bytes():
                raise RuntimeError("Hugging Face snapshot exceeded the configured byte limit.")
        except OSError:
            continue
    return {"fileCount": file_count, "totalBytes": total_bytes}


def _resolve_package_version(package_names: tuple[str, ...]) -> str | None:
    for package_name in package_names:
        try:
            return importlib_metadata.version(package_name)
        except importlib_metadata.PackageNotFoundError:
            continue
    return None


def _is_module_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def _resolve_huggingface_cache_root() -> Path | None:
    configured_cache = environ.get("HF_HUB_CACHE") or environ.get("TRANSFORMERS_CACHE")
    if configured_cache:
        configured_path = Path(configured_cache).expanduser()
        return configured_path.resolve(strict=False) if configured_path.is_absolute() else None

    hf_home = environ.get("HF_HOME")
    if hf_home:
        home_path = Path(hf_home).expanduser()
        return (home_path / "hub").resolve(strict=False) if home_path.is_absolute() else None

    try:
        from huggingface_hub import constants

        cache_path = Path(constants.HF_HUB_CACHE).expanduser()
        return cache_path.resolve(strict=False) if cache_path.is_absolute() else None
    except Exception:
        return None


def _resolve_huggingface_repo_cache_directory(model_id: str) -> Path | None:
    _assert_huggingface_model_id(model_id)
    cache_root = _resolve_huggingface_cache_root()
    if cache_root is None:
        return None
    candidate = (cache_root / f"models--{model_id.replace('/', '--')}").resolve(strict=False)
    try:
        candidate.relative_to(cache_root)
    except ValueError as error:
        raise RuntimeError("Hugging Face cache path is outside the host-owned cache root.") from error
    return candidate


def _resolve_huggingface_xet_cache_root() -> Path | None:
    configured_cache = environ.get("HF_XET_CACHE")
    if configured_cache:
        return Path(configured_cache)

    hf_home = environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home) / "xet"

    return None


def _resolve_huggingface_environment_diagnostics() -> dict[str, Any]:
    hf_xet_available = _is_module_available("hf_xet")
    diagnostics: dict[str, Any] = {
        "hfHomeConfigured": bool(environ.get("HF_HOME")),
        "hfHubCacheConfigured": _resolve_huggingface_cache_root() is not None,
        "hfXetCacheConfigured": bool(environ.get("HF_XET_CACHE")),
        "transformersCacheConfigured": bool(environ.get("TRANSFORMERS_CACHE")),
        "hfHubDisableXet": environ.get("HF_HUB_DISABLE_XET"),
        "hfHubDownloadTimeoutSeconds": environ.get("HF_HUB_DOWNLOAD_TIMEOUT"),
        "hfHubEtagTimeoutSeconds": environ.get("HF_HUB_ETAG_TIMEOUT"),
        "huggingfaceHubVersion": _resolve_package_version(("huggingface_hub", "huggingface-hub")),
        "hfXetAvailable": hf_xet_available,
        "hfXetVersion": _resolve_package_version(("hf_xet", "hf-xet")) if hf_xet_available else None,
    }
    return {key: value for key, value in diagnostics.items() if value is not None}


def _error_chain_summary(error: BaseException, max_depth: int = 4, max_message_length: int = 500) -> list[dict[str, str]]:
    del max_message_length
    entries: list[dict[str, str]] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and len(entries) < max_depth and id(current) not in seen:
        seen.add(id(current))
        entries.append({"errorType": type(current).__name__})
        current = current.__cause__ or current.__context__
    return entries


def _format_error_summary(error: BaseException) -> str:
    chain = _error_chain_summary(error, max_depth=1, max_message_length=300)
    if not chain:
        return type(error).__name__
    entry = chain[0]
    return entry["errorType"]


def _safe_download_diagnostic_data(data: Mapping[str, Any]) -> dict[str, Any]:
    allowed_keys = {
        "profile", "stage", "errorType", "elapsedMs", "fileCount", "totalBytes",
        "cachedFileCount", "cachedTotalBytes", "observedFileCount", "observedTotalBytes",
        "observedHubFileCount", "observedHubTotalBytes", "observedXetFileCount",
        "observedXetTotalBytes", "downloadedBytes", "downloadPercent", "progressUnit",
        "completedFileCount", "totalFileCount", "downloadBackend", "downloadedMissingFiles",
        "cacheDirectoryObserved", "xetCacheDirectoryObserved", "allowPatterns", "ignorePatterns",
        "hfHomeConfigured", "hfHubCacheConfigured", "hfXetCacheConfigured",
        "transformersCacheConfigured", "hfHubDisableXet", "hfHubDownloadTimeoutSeconds",
        "hfHubEtagTimeoutSeconds", "huggingfaceHubVersion", "hfXetAvailable", "hfXetVersion",
        "attemptNumber", "maximumAttempts", "cachePreserved",
    }
    return {key: value for key, value in data.items() if key in allowed_keys}


def _emit_model_download_event(event: str, model_id: str, **data: Any) -> None:
    del model_id
    print(
        json.dumps(
            {
                "event": event,
                "provider": "transformers",
                **_safe_download_diagnostic_data(data),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


def _parse_cache_progress_interval_seconds() -> float:
    configured = environ.get("AI_SYSTEM_BUILDER_HF_DOWNLOAD_PROGRESS_INTERVAL_SECONDS")
    if not configured:
        return DEFAULT_HUGGINGFACE_CACHE_PROGRESS_INTERVAL_SECONDS
    try:
        parsed = float(configured)
    except ValueError:
        return DEFAULT_HUGGINGFACE_CACHE_PROGRESS_INTERVAL_SECONDS
    return parsed if parsed > 0 else DEFAULT_HUGGINGFACE_CACHE_PROGRESS_INTERVAL_SECONDS


def _start_snapshot_cache_progress_monitor(
    model_id: str,
    profile_name: str,
    on_progress: Callable[[dict[str, Any]], None] | None,
) -> Callable[[], None]:
    cache_directory = _resolve_huggingface_repo_cache_directory(model_id)
    if cache_directory is None:
        return lambda: None

    stop_event = Event()
    started_at = time.monotonic()
    interval_seconds = _parse_cache_progress_interval_seconds()
    last_signature: tuple[int, int] | None = None

    def emit_if_changed(force: bool = False) -> None:
        nonlocal last_signature
        xet_cache_directory = _resolve_huggingface_xet_cache_root()
        hub_stats = _snapshot_file_stats(cache_directory)
        xet_stats = _snapshot_file_stats(xet_cache_directory)
        cache_directory_observed = cache_directory.exists()
        xet_cache_observed = xet_cache_directory is not None and xet_cache_directory.exists()
        if not cache_directory_observed and not xet_cache_observed:
            return

        observed_file_count = hub_stats["fileCount"] + xet_stats["fileCount"]
        observed_total_bytes = hub_stats["totalBytes"] + xet_stats["totalBytes"]
        signature = (observed_file_count, observed_total_bytes)
        if signature == (0, 0) and last_signature is None:
            return
        if not force and signature == last_signature:
            return

        last_signature = signature
        _report_model_download_progress(
            model_id,
            on_progress,
            "snapshot-cache-progress",
            "Observed Hugging Face cache growth.",
            profile=profile_name,
            observedFileCount=observed_file_count,
            observedTotalBytes=observed_total_bytes,
            observedHubFileCount=hub_stats["fileCount"],
            observedHubTotalBytes=hub_stats["totalBytes"],
            observedXetFileCount=xet_stats["fileCount"],
            observedXetTotalBytes=xet_stats["totalBytes"],
            elapsedMs=round((time.monotonic() - started_at) * 1000),
            cacheDirectoryObserved=cache_directory_observed,
            xetCacheDirectoryObserved=xet_cache_observed,
        )

    def monitor() -> None:
        while not stop_event.wait(interval_seconds):
            emit_if_changed()

    thread = Thread(target=monitor, name="hf-cache-progress", daemon=True)
    thread.start()

    def stop() -> None:
        stop_event.set()
        thread.join(timeout=1)
        emit_if_changed(force=True)

    return stop


def _report_model_download_progress(
    model_id: str,
    on_progress: Callable[[dict[str, Any]], None] | None,
    stage: str,
    message: str,
    **data: Any,
) -> None:
    progress = {
        "stage": stage,
        "message": message,
        "provider": "transformers",
        **_safe_download_diagnostic_data(data),
    }
    if on_progress is not None:
        on_progress(progress)
    _emit_model_download_event(
        "runtime.model_download.progress",
        model_id,
        **{key: value for key, value in progress.items() if key not in {"provider"}},
    )


class _StructuredSnapshotTqdm:
    @classmethod
    def get_lock(cls) -> Any:
        from tqdm.auto import tqdm

        if not hasattr(cls, "_lock"):
            cls._lock = tqdm.get_lock()
        return cls._lock

    @classmethod
    def set_lock(cls, lock: Any) -> None:
        from tqdm.auto import tqdm

        cls._lock = lock
        tqdm.set_lock(lock)

    def __init__(self, *args: Any, **kwargs: Any):
        self._model_id = kwargs.pop("_asb_model_id", None)
        self._profile_name = kwargs.pop("_asb_profile_name", None)
        self._on_progress = kwargs.pop("_asb_on_progress", None)
        self._download_name = kwargs.pop("_asb_download_name", None)
        self._download_backend = kwargs.pop("_asb_download_backend", None)
        self._progress_unit = kwargs.get("unit")
        self._last_reported: tuple[int, int | None] | None = None
        self._last_reported_at: float | None = None
        self._started_at = time.monotonic()
        from tqdm.auto import tqdm

        # The worker emits structured progress. Suppress tqdm's stderr renderer so
        # the desktop supervisor does not receive an unstructured line per update.
        kwargs["disable"] = True
        self._inner = tqdm(*args, **kwargs)
        self._emit_progress()

    def __iter__(self):
        for item in self._inner:
            self._emit_progress()
            yield item

    def __enter__(self):
        self._inner.__enter__()
        self._emit_progress()
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any):
        self._emit_progress(force=True)
        return self._inner.__exit__(exc_type, exc_value, traceback)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    def update(self, n: int = 1) -> Any:
        previous = int(getattr(self._inner, "n", 0) or 0)
        result = self._inner.update(n)
        if int(getattr(self._inner, "n", 0) or 0) == previous:
            self._inner.n = previous + n
        self._emit_progress()
        return result

    def close(self) -> None:
        self._emit_progress(force=True)
        self._inner.close()

    def _emit_progress(self, force: bool = False) -> None:
        if not self._model_id:
            return

        completed = int(getattr(self._inner, "n", 0) or 0)
        total_value = getattr(self._inner, "total", None)
        total = int(total_value) if isinstance(total_value, (int, float)) and total_value >= 0 else None
        signature = (completed, total)
        if not force and signature == self._last_reported:
            return
        now = time.monotonic()
        is_complete = total is not None and completed >= total
        if (
            not force
            and not is_complete
            and self._last_reported_at is not None
            and now - self._last_reported_at
            < MIN_STRUCTURED_DOWNLOAD_PROGRESS_INTERVAL_SECONDS
        ):
            return

        self._last_reported = signature
        self._last_reported_at = now
        data: dict[str, Any] = {
            "profile": self._profile_name,
            "elapsedMs": round((now - self._started_at) * 1000),
        }
        if self._download_name:
            data["downloadName"] = self._download_name
        if self._download_backend:
            data["downloadBackend"] = self._download_backend
        if self._progress_unit == "B":
            maximum_bytes = _parse_huggingface_max_model_bytes()
            if completed > maximum_bytes or (total is not None and total > maximum_bytes):
                raise RuntimeError("Hugging Face snapshot exceeded the configured byte limit.")
            data["progressUnit"] = "bytes"
            data["downloadedBytes"] = completed
            if total is not None:
                data["totalBytes"] = total
                data["downloadPercent"] = round((completed / total) * 100, 2) if total > 0 else 0
        else:
            data["progressUnit"] = "files"
            data["completedFileCount"] = completed
            if total is not None:
                data["totalFileCount"] = total

        _report_model_download_progress(
            self._model_id,
            self._on_progress,
            "snapshot-progress",
            "Downloading Hugging Face snapshot files.",
            **data,
        )


def _create_structured_snapshot_tqdm(
    model_id: str,
    profile_name: str,
    on_progress: Callable[[dict[str, Any]], None] | None,
):
    class _ConfiguredStructuredSnapshotTqdm(_StructuredSnapshotTqdm):
        def __init__(self, *args: Any, **kwargs: Any):
            kwargs["_asb_model_id"] = model_id
            kwargs["_asb_profile_name"] = profile_name
            kwargs["_asb_on_progress"] = on_progress
            super().__init__(*args, **kwargs)

    return _ConfiguredStructuredSnapshotTqdm


@contextmanager
def _structured_huggingface_file_progress(
    model_id: str,
    profile_name: str,
    on_progress: Callable[[dict[str, Any]], None] | None,
):
    try:
        import huggingface_hub.file_download as file_download
    except Exception:
        yield
        return

    original_context = getattr(file_download, "_get_progress_bar_context", None)
    if not callable(original_context):
        yield
        return

    def create_progress_context(
        *,
        desc: str,
        log_level: int,
        total: int | None = None,
        initial: int = 0,
        unit: str = "B",
        unit_scale: bool = True,
        name: str | None = None,
        _tqdm_bar: Any = None,
    ):
        if _tqdm_bar is not None or name not in {"huggingface_hub.http_get", "huggingface_hub.xet_get"}:
            return original_context(
                desc=desc,
                log_level=log_level,
                total=total,
                initial=initial,
                unit=unit,
                unit_scale=unit_scale,
                name=name,
                _tqdm_bar=_tqdm_bar,
            )

        tqdm_class = _create_structured_snapshot_tqdm(model_id, profile_name, on_progress)
        return tqdm_class(
            total=total,
            initial=initial,
            unit=unit,
            unit_scale=unit_scale,
            desc=desc,
            disable=False,
            _asb_download_name=desc,
            _asb_download_backend="xet" if name == "huggingface_hub.xet_get" else "http",
        )

    file_download._get_progress_bar_context = create_progress_context
    try:
        yield
    finally:
        file_download._get_progress_bar_context = original_context


def _normalize_context_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized or None


def _normalize_context_text_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    normalized: list[str] = []
    for entry in value:
        normalized_entry = _normalize_context_text(entry)
        if normalized_entry:
            normalized.append(normalized_entry)
    return normalized


def _looks_like_checkpoint_model(model_id: str) -> bool:
    return bool(re.search(r"\b(stable-diffusion|sdxl|flux|text-to-image|txt2img|diffusion)\b", model_id.lower()))


def _resolve_snapshot_download_profile(
    model_config: LocalModelConfig,
    download_context: Mapping[str, Any] | None,
) -> HuggingFaceSnapshotDownloadProfile:
    inference_mode = _normalize_context_text(download_context.get("inferenceMode") if download_context else None)
    artifact_form = _normalize_context_text(download_context.get("artifactForm") if download_context else None)
    task_tags = _normalize_context_text_list(download_context.get("taskTags") if download_context else None)

    if inference_mode == "text-to-image" or "text-to-image" in task_tags:
        return CHECKPOINT_SNAPSHOT_PROFILE

    if artifact_form == "checkpoint" or _looks_like_checkpoint_model(model_config.modelId):
        return CHECKPOINT_SNAPSHOT_PROFILE

    return GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE


def _snapshot_download_kwargs(profile: HuggingFaceSnapshotDownloadProfile) -> dict[str, Any]:
    kwargs: dict[str, Any] = {}
    if profile.allow_patterns:
        kwargs["allow_patterns"] = list(profile.allow_patterns)
    if profile.ignore_patterns:
        kwargs["ignore_patterns"] = list(profile.ignore_patterns)
    return kwargs


def _top_level_checkpoint_files(path: str | Path | None) -> list[str]:
    if not path:
        return []

    snapshot_path = Path(path)
    if not snapshot_path.exists():
        return []

    checkpoint_files = []
    for child in snapshot_path.iterdir():
        if child.is_file() and child.suffix.lower() in {".ckpt", ".safetensors"}:
            checkpoint_files.append(child.name)
    return sorted(checkpoint_files)


def _top_level_checkpoint_file_stats(path: str | Path | None) -> list[dict[str, int | str]]:
    if not path:
        return []

    snapshot_path = Path(path)
    if not snapshot_path.exists():
        return []

    checkpoint_files: list[dict[str, int | str]] = []
    for child in snapshot_path.iterdir():
        if not child.is_file() or child.suffix.lower() not in {".ckpt", ".safetensors"}:
            continue
        try:
            size_bytes = child.stat().st_size
        except OSError:
            size_bytes = 0
        checkpoint_files.append({"name": child.name, "sizeBytes": size_bytes})
    return sorted(checkpoint_files, key=lambda item: str(item["name"]))


def _parse_checkpoint_min_bytes() -> int:
    configured = environ.get("AI_SYSTEM_BUILDER_HF_CHECKPOINT_MIN_BYTES")
    if not configured:
        return DEFAULT_HUGGINGFACE_CHECKPOINT_MIN_BYTES
    try:
        parsed = int(configured)
    except ValueError:
        return DEFAULT_HUGGINGFACE_CHECKPOINT_MIN_BYTES
    return parsed if parsed >= 0 else DEFAULT_HUGGINGFACE_CHECKPOINT_MIN_BYTES


def _parse_huggingface_max_model_bytes() -> int:
    configured = environ.get("AI_SYSTEM_BUILDER_HF_MAX_MODEL_BYTES")
    if not configured:
        return DEFAULT_HUGGINGFACE_MAX_MODEL_BYTES
    try:
        parsed = int(configured)
    except ValueError:
        return DEFAULT_HUGGINGFACE_MAX_MODEL_BYTES
    return min(max(parsed, 1024), 100 * 1024 * 1024 * 1024)


def _assert_huggingface_model_id(model_id: str) -> None:
    if len(model_id) > 193 or not HUGGINGFACE_MODEL_ID_PATTERN.fullmatch(model_id):
        raise ValueError("Hugging Face model identifier must use canonical owner/model syntax.")


def _validate_huggingface_snapshot_path(local_path: str) -> None:
    cache_root = _resolve_huggingface_cache_root()
    if cache_root is None:
        raise RuntimeError("Hugging Face host-owned cache root is unavailable.")
    snapshot_path = Path(local_path).resolve(strict=True)
    try:
        snapshot_path.relative_to(cache_root)
    except ValueError as error:
        raise RuntimeError("Hugging Face snapshot is outside the host-owned cache root.") from error
    if not snapshot_path.is_dir():
        raise RuntimeError("Hugging Face snapshot is not a directory.")


def _to_huggingface_snapshot_handle(local_path: str) -> str:
    cache_root = _resolve_huggingface_cache_root()
    if cache_root is None:
        raise RuntimeError("Hugging Face host-owned cache root is unavailable.")
    canonical_root = cache_root.resolve(strict=True)
    snapshot_path = Path(local_path).resolve(strict=True)
    try:
        relative_path = snapshot_path.relative_to(canonical_root)
    except ValueError as error:
        raise RuntimeError(
            "Hugging Face snapshot is outside the host-owned cache root."
        ) from error
    parts = relative_path.parts
    if (
        not parts
        or any(
            not part
            or part in {".", ".."}
            or len(part) > 255
            or not re.fullmatch(r"[A-Za-z0-9._-]+", part)
            for part in parts
        )
    ):
        raise RuntimeError("Hugging Face snapshot handle is invalid.")
    return "/".join(parts)


def _cleanup_failed_huggingface_cache(model_id: str) -> None:
    cache_directory = _resolve_huggingface_repo_cache_directory(model_id)
    if cache_directory is None:
        return
    shutil.rmtree(cache_directory, ignore_errors=True)


def _is_huggingface_download_policy_failure(error: BaseException) -> bool:
    """Return whether a failure requires removing bounded untrusted cache data."""

    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        message = str(current)
        if any(
            fragment in message
            for fragment in (
                "exceeded the configured byte limit",
                "exceeded the configured file-count limit",
                "outside the host-owned cache root",
                "host-owned cache root is unavailable",
            )
        ):
            return True
        current = current.__cause__ or current.__context__
    return False


def _is_auxiliary_checkpoint_file(file_name: str) -> bool:
    normalized = file_name.lower()
    return "lora" in normalized or "adapter" in normalized


def _validate_snapshot_profile_result(
    model_config: LocalModelConfig,
    profile: HuggingFaceSnapshotDownloadProfile,
    local_path: str,
) -> None:
    if profile.name == GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE.name:
        _validate_transformers_snapshot_result(local_path)
        return

    if profile.name != CHECKPOINT_SNAPSHOT_PROFILE.name:
        raise RuntimeError("Hugging Face model download profile is unsupported.")

    checkpoint_files = _top_level_checkpoint_file_stats(local_path)
    minimum_size_bytes = _parse_checkpoint_min_bytes()
    primary_checkpoint_files = [
        file
        for file in checkpoint_files
        if not _is_auxiliary_checkpoint_file(str(file["name"])) and int(file["sizeBytes"]) >= minimum_size_bytes
    ]
    if primary_checkpoint_files:
        return

    raise RuntimeError(
        (
            "Hugging Face model did not expose a top-level primary .safetensors or .ckpt "
            f"checkpoint of at least {minimum_size_bytes} bytes after applying the checkpoint download profile. "
            "Auxiliary LoRA/adapter files do not satisfy full checkpoint downloads. Choose a checkpoint-format model "
            "artifact or save it as a reference."
        )
    )


class LocalTextGenerator:
    def generate_text(
        self,
        prompt: str,
        system_prompt: str | None = None,
        *,
        constrained_json_schema: Mapping[str, Any] | None = None,
    ) -> str:
        raise NotImplementedError


def _compose_non_chat_prompt(prompt: str, system_prompt: str | None) -> str:
    normalized_system_prompt = (system_prompt or "").strip()
    if not normalized_system_prompt:
        return prompt
    return (
        "System instructions (higher priority):\n"
        f"{normalized_system_prompt}\n\n"
        "User request:\n"
        f"{prompt}"
    )


def _validate_transformers_snapshot_result(local_path: str) -> None:
    root = Path(local_path).resolve(strict=True)
    files = {
        item.name: item
        for item in root.iterdir()
        if item.is_file() and item.stat().st_size > 0
    }
    if "config.json" not in files:
        raise RuntimeError(
            "Hugging Face model snapshot is incomplete: model configuration is missing."
        )

    weight_indexes = [
        name
        for name in ("model.safetensors.index.json", "pytorch_model.bin.index.json")
        if name in files
    ]
    single_weight_files = [
        name
        for name in ("model.safetensors", "pytorch_model.bin")
        if name in files
    ]
    if not weight_indexes and not single_weight_files:
        raise RuntimeError(
            "Hugging Face model snapshot is incomplete: complete model weights are missing."
        )

    for index_name in weight_indexes:
        index_path = files[index_name]
        if index_path.stat().st_size > MAX_TRANSFORMERS_WEIGHT_INDEX_BYTES:
            raise RuntimeError(
                "Hugging Face model snapshot is invalid: the model weight index is too large."
            )
        try:
            index_payload = json.loads(index_path.read_text(encoding="utf-8"))
            weight_map = index_payload.get("weight_map")
            if not isinstance(weight_map, dict) or not weight_map:
                raise ValueError("weight_map is missing")
            referenced_files = {value for value in weight_map.values() if isinstance(value, str)}
            if not referenced_files or len(referenced_files) > DEFAULT_HUGGINGFACE_MAX_CACHE_FILES:
                raise ValueError("weight_map file set is invalid")
            for relative_name in referenced_files:
                candidate = (root / relative_name).resolve(strict=True)
                candidate.relative_to(root)
                if not candidate.is_file() or candidate.stat().st_size <= 0:
                    raise ValueError("referenced weight shard is missing")
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise RuntimeError(
                "Hugging Face model snapshot is incomplete: one or more model weight shards are missing or invalid."
            ) from error

    has_tokenizer = (
        "tokenizer.json" in files
        or "tokenizer.model" in files
        or "sentencepiece.bpe.model" in files
        or "spiece.model" in files
        or "vocab.txt" in files
        or ("vocab.json" in files and "merges.txt" in files)
    )
    if not has_tokenizer:
        raise RuntimeError(
            "Hugging Face model snapshot is incomplete: tokenizer files are missing."
        )


class TransformersText2TextGenerator(LocalTextGenerator):
    def __init__(self, model_config: LocalModelConfig, generation_params: dict[str, Any]):
        self._generation_params = generation_params
        self._pipeline = self._build_pipeline(model_config)

    @staticmethod
    def _build_pipeline(model_config: LocalModelConfig):
        configure_huggingface_download_environment()
        try:
            from transformers import pipeline
        except ImportError as error:
            raise RuntimeError(
                "The 'transformers' package is required for recipe generation with provider='transformers'."
            ) from error

        resolved_model_reference = _RESOLVED_MODEL_REFERENCES.get(model_config.modelId, model_config.modelId)
        return pipeline(
            "text2text-generation",
            model=resolved_model_reference,
            tokenizer=resolved_model_reference,
            model_kwargs=_resolve_model_kwargs(model_config) or None,
        )

    def generate_text(
        self,
        prompt: str,
        system_prompt: str | None = None,
        *,
        constrained_json_schema: Mapping[str, Any] | None = None,
    ) -> str:
        if constrained_json_schema is not None:
            raise ConstrainedJsonDecoderError(
                "decoder-inference-mode-unsupported",
                "Token constraints are available only for causal and chat models.",
            )
        generation = self._pipeline(
            _compose_non_chat_prompt(prompt, system_prompt),
            **dict(self._generation_params),
        )
        text = _extract_pipeline_text(generation)
        if not text:
            raise RuntimeError("Text2text generation returned no text.")
        return text


class TransformersCausalGenerator(LocalTextGenerator):
    def __init__(self, model_config: LocalModelConfig, generation_params: dict[str, Any]):
        self._generation_params = generation_params
        self._tokenizer, self._model = self._load_model(model_config)
        self._constrained_json_decoder: ConstrainedJsonDecoder | None = None

    @staticmethod
    def _load_model(model_config: LocalModelConfig):
        configure_huggingface_download_environment()
        try:
            from transformers import AutoModelForCausalLM, AutoTokenizer
        except ImportError as error:
            raise RuntimeError(
                "The 'transformers' package is required for recipe generation with provider='transformers'."
            ) from error

        resolved_model_reference = _RESOLVED_MODEL_REFERENCES.get(model_config.modelId, model_config.modelId)
        model_kwargs = _resolve_model_kwargs(model_config)
        tokenizer = AutoTokenizer.from_pretrained(resolved_model_reference)
        model = AutoModelForCausalLM.from_pretrained(resolved_model_reference, **model_kwargs)

        if getattr(tokenizer, "pad_token_id", None) is None:
            tokenizer.pad_token_id = getattr(tokenizer, "eos_token_id", None)

        if model_config.device in {"cpu", "cuda"} and _supports_manual_device_move(model):
            model = model.to(model_config.device)

        return tokenizer, model

    def _generate_new_tokens_text(
        self,
        input_ids: Any,
        generation_inputs: dict[str, Any],
        constrained_json_schema: Mapping[str, Any] | None = None,
    ) -> str:
        generation_params = _resolve_runtime_generation_params(
            self._generation_params,
            self._tokenizer,
        )
        generation_params = _filter_supported_generation_params(generation_params, self._model.generate)
        if constrained_json_schema is not None:
            if self._constrained_json_decoder is None:
                self._constrained_json_decoder = ConstrainedJsonDecoder(
                    self._model,
                    self._tokenizer,
                )
            return self._constrained_json_decoder.generate(
                generation_inputs=generation_inputs,
                generation_params=generation_params,
                input_ids=input_ids,
                schema=constrained_json_schema,
            )
        generation_output = self._model.generate(**generation_inputs, **generation_params)

        first_output = generation_output[0]
        prompt_length = input_ids.shape[-1]
        generated_ids = first_output[prompt_length:]

        text = self._tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
        if not text:
            raise RuntimeError("Causal generation returned no new tokens.")
        return text

    def generate_text(
        self,
        prompt: str,
        system_prompt: str | None = None,
        *,
        constrained_json_schema: Mapping[str, Any] | None = None,
    ) -> str:
        tokenized = self._tokenizer(
            _compose_non_chat_prompt(prompt, system_prompt),
            return_tensors="pt",
        )
        input_ids = tokenized["input_ids"]
        generation_inputs = _move_tokenized_inputs_to_model_device(tokenized, self._model)
        return self._generate_new_tokens_text(
            input_ids,
            generation_inputs,
            constrained_json_schema,
        )


class TransformersChatGenerator(TransformersCausalGenerator):
    def generate_text(
        self,
        prompt: str,
        system_prompt: str | None = None,
        *,
        constrained_json_schema: Mapping[str, Any] | None = None,
    ) -> str:
        messages = []
        if system_prompt and system_prompt.strip():
            messages.append({"role": "system", "content": system_prompt.strip()})
        messages.append({"role": "user", "content": prompt})
        templated = _apply_chat_template_for_generation(self._tokenizer, messages)

        if isinstance(templated, Mapping):
            input_ids = templated["input_ids"]
            generation_inputs = _move_tokenized_inputs_to_model_device(dict(templated), self._model)
        else:
            input_ids = templated
            generation_inputs = {"input_ids": templated}
            generation_inputs = _move_tokenized_inputs_to_model_device(generation_inputs, self._model)

        return self._generate_new_tokens_text(
            input_ids,
            generation_inputs,
            constrained_json_schema,
        )


def ensure_generation_model_downloaded(
    model_config: LocalModelConfig,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
    download_context: Mapping[str, Any] | None = None,
) -> GenerationModelAvailability:
    if model_config.provider != "transformers":
        raise ValueError(f"Unsupported generation model provider: {model_config.provider}")
    _assert_huggingface_model_id(model_config.modelId)

    configure_huggingface_download_environment()
    download_profile = _resolve_snapshot_download_profile(model_config, download_context)
    snapshot_kwargs = _snapshot_download_kwargs(download_profile)

    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise RuntimeError(
            "The 'huggingface_hub' package is required to validate and download generation models."
        ) from error
    _emit_model_download_event(
        "runtime.model_download.environment",
        model_config.modelId,
        profile=download_profile.name,
        **_resolve_huggingface_environment_diagnostics(),
    )

    cache_candidate_path: str | None = None
    try:
        _report_model_download_progress(
            model_config.modelId,
            on_progress,
            "cache-check",
            "Checking the local Hugging Face cache.",
            profile=download_profile.name,
            allowPatterns=list(download_profile.allow_patterns or ()),
            ignorePatterns=list(download_profile.ignore_patterns),
        )
        _emit_model_download_event("runtime.model_download.cache_check.started", model_config.modelId)
        local_path = snapshot_download(
            repo_id=model_config.modelId,
            local_files_only=True,
            **snapshot_kwargs,
        )
        _validate_huggingface_snapshot_path(local_path)
        cache_candidate_path = local_path
        _validate_snapshot_profile_result(model_config, download_profile, local_path)
        cache_stats = _snapshot_file_stats(local_path)
        _emit_model_download_event(
            "runtime.model_download.cache_check.succeeded",
            model_config.modelId,
            profile=download_profile.name,
            **cache_stats,
        )
        _report_model_download_progress(
            model_config.modelId,
            on_progress,
            "cache-hit",
            "Found a cached Hugging Face snapshot.",
            profile=download_profile.name,
            fileCount=cache_stats["fileCount"],
            totalBytes=cache_stats["totalBytes"],
        )
        _RESOLVED_MODEL_REFERENCES[model_config.modelId] = local_path
        return GenerationModelAvailability(
            provider=model_config.provider,
            model_id=model_config.modelId,
            downloaded=False,
            from_cache=True,
            local_path=local_path,
            cache_handle=_to_huggingface_snapshot_handle(local_path),
        )
    except Exception as error:
        _emit_model_download_event(
            "runtime.model_download.cache_check.missed",
            model_config.modelId,
            errorType=type(error).__name__,
            profile=download_profile.name,
        )
        _report_model_download_progress(
            model_config.modelId,
            on_progress,
            "cache-miss",
            "No complete cached Hugging Face snapshot was found.",
            errorType=type(error).__name__,
            profile=download_profile.name,
        )

    download_failure_stage = "transfer"
    try:
        before_stats = _snapshot_file_stats(cache_candidate_path)
        _report_model_download_progress(
            model_config.modelId,
            on_progress,
            "snapshot-download",
            "Downloading a Hugging Face snapshot.",
            profile=download_profile.name,
            cachedFileCount=before_stats["fileCount"],
            cachedTotalBytes=before_stats["totalBytes"],
            allowPatterns=list(download_profile.allow_patterns or ()),
            ignorePatterns=list(download_profile.ignore_patterns),
        )
        _emit_model_download_event(
            "runtime.model_download.snapshot.started",
            model_config.modelId,
            profile=download_profile.name,
            cachedFileCount=before_stats["fileCount"],
            cachedTotalBytes=before_stats["totalBytes"],
            allowPatterns=list(download_profile.allow_patterns or ()),
            ignorePatterns=list(download_profile.ignore_patterns),
        )
        stop_cache_monitor = _start_snapshot_cache_progress_monitor(
            model_config.modelId,
            download_profile.name,
            on_progress,
        )
        try:
            for attempt_number in range(1, DEFAULT_HUGGINGFACE_DOWNLOAD_ATTEMPTS + 1):
                try:
                    with _structured_huggingface_file_progress(model_config.modelId, download_profile.name, on_progress):
                        local_path = snapshot_download(
                            repo_id=model_config.modelId,
                            local_files_only=False,
                            tqdm_class=_create_structured_snapshot_tqdm(model_config.modelId, download_profile.name, on_progress),
                            **snapshot_kwargs,
                        )
                    download_failure_stage = "validation"
                    _validate_huggingface_snapshot_path(local_path)
                    _validate_snapshot_profile_result(model_config, download_profile, local_path)
                    download_failure_stage = "transfer"
                    break
                except Exception as error:
                    if (
                        _is_huggingface_download_policy_failure(error)
                        or attempt_number >= DEFAULT_HUGGINGFACE_DOWNLOAD_ATTEMPTS
                    ):
                        raise
                    _report_model_download_progress(
                        model_config.modelId,
                        on_progress,
                        "snapshot-retry",
                        "The download was interrupted. Retrying from saved files.",
                        profile=download_profile.name,
                        errorType=type(error).__name__,
                        attemptNumber=attempt_number + 1,
                        maximumAttempts=DEFAULT_HUGGINGFACE_DOWNLOAD_ATTEMPTS,
                        cachePreserved=True,
                    )
                    time.sleep(
                        DEFAULT_HUGGINGFACE_DOWNLOAD_RETRY_DELAY_SECONDS
                        * attempt_number
                    )
        finally:
            stop_cache_monitor()
        after_stats = _snapshot_file_stats(local_path)
        downloaded_missing_files = after_stats["fileCount"] > before_stats["fileCount"] or after_stats["totalBytes"] > before_stats["totalBytes"]
        _emit_model_download_event(
            "runtime.model_download.snapshot.succeeded",
            model_config.modelId,
            profile=download_profile.name,
            fileCount=after_stats["fileCount"],
            totalBytes=after_stats["totalBytes"],
            downloadedMissingFiles=downloaded_missing_files,
        )
        _report_model_download_progress(
            model_config.modelId,
            on_progress,
            "snapshot-complete",
            "Hugging Face snapshot download is complete.",
            profile=download_profile.name,
            fileCount=after_stats["fileCount"],
            totalBytes=after_stats["totalBytes"],
            downloadedMissingFiles=downloaded_missing_files,
        )
        _RESOLVED_MODEL_REFERENCES[model_config.modelId] = local_path
        return GenerationModelAvailability(
            provider=model_config.provider,
            model_id=model_config.modelId,
            downloaded=downloaded_missing_files or cache_candidate_path is None,
            from_cache=cache_candidate_path is not None and not downloaded_missing_files,
            local_path=local_path,
            cache_handle=_to_huggingface_snapshot_handle(local_path),
        )
    except Exception as error:
        cache_directory = _resolve_huggingface_repo_cache_directory(model_config.modelId)
        failure_cache_stats = _snapshot_file_stats(cache_directory)
        error_chain = _error_chain_summary(error)
        _emit_model_download_event(
            "runtime.model_download.snapshot.failed",
            model_config.modelId,
            errorType=type(error).__name__,
            errorChain=error_chain,
            profile=download_profile.name,
            observedFileCount=failure_cache_stats["fileCount"],
            observedTotalBytes=failure_cache_stats["totalBytes"],
        )
        _report_model_download_progress(
            model_config.modelId,
            on_progress,
            "snapshot-failed",
            "Hugging Face snapshot download failed.",
            errorType=type(error).__name__,
            errorChain=error_chain,
            profile=download_profile.name,
            observedFileCount=failure_cache_stats["fileCount"],
            observedTotalBytes=failure_cache_stats["totalBytes"],
        )
        policy_failure = _is_huggingface_download_policy_failure(error)
        if policy_failure:
            _cleanup_failed_huggingface_cache(model_config.modelId)
            raise
        if download_failure_stage == "validation":
            raise GenerationModelDownloadInvalidError(
                "Downloaded files did not form a complete model. Retry to resume and verify the saved files."
            ) from error
        raise GenerationModelDownloadError(
            "Model download was interrupted. Retry to resume the saved partial download."
        ) from error


def ensure_generation_model_is_available(config: ExampleGenerationConfig) -> GenerationModelAvailability:
    if config.model.device == "auto" and not _is_module_available("accelerate"):
        raise GenerationRuntimeDependencyError(
            "Automatic model placement is unavailable because a required managed generation component is missing."
        )
    model_config = config.model
    if model_config.provider != "transformers":
        raise ValueError(f"Unsupported generation model provider: {model_config.provider}")
    _assert_huggingface_model_id(model_config.modelId)
    configure_huggingface_download_environment()
    download_profile = _resolve_snapshot_download_profile(model_config, None)
    snapshot_kwargs = _snapshot_download_kwargs(download_profile)
    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise RuntimeError(
            "The 'huggingface_hub' package is required to validate generation models."
        ) from error

    try:
        local_path = snapshot_download(
            repo_id=model_config.modelId,
            local_files_only=True,
            **snapshot_kwargs,
        )
    except Exception as error:
        raise RuntimeError(
            "The selected generation model is not available in the local cache. Download it and retry."
        ) from error

    try:
        _validate_huggingface_snapshot_path(local_path)
        _validate_snapshot_profile_result(model_config, download_profile, local_path)
    except Exception as error:
        raise GenerationModelDownloadIncompleteError(
            "The selected generation model is not fully downloaded. Resume its download and retry."
        ) from error

    _RESOLVED_MODEL_REFERENCES[model_config.modelId] = local_path
    return GenerationModelAvailability(
        provider=model_config.provider,
        model_id=model_config.modelId,
        downloaded=False,
        from_cache=True,
        local_path=local_path,
        cache_handle=_to_huggingface_snapshot_handle(local_path),
    )


_GENERATOR_CACHE: dict[tuple[str, str, str, str, str], LocalTextGenerator] = {}
_GENERATOR_CACHE_LOCK = Lock()
_RESOLVED_MODEL_REFERENCES: dict[str, str] = {}


def _generator_cache_key(model: LocalModelConfig) -> tuple[str, str, str, str, str]:
    return (
        model.provider,
        model.modelId,
        model.inferenceMode,
        model.device or "auto",
        model.torchDtype or "auto",
    )


def _resolved_model_reference_for(model_id: str) -> str:
    return _RESOLVED_MODEL_REFERENCES.get(model_id, model_id)


@dataclass(frozen=True)
class _SystemMemorySnapshot:
    total_bytes: int
    available_bytes: int


def _read_system_memory_snapshot() -> _SystemMemorySnapshot | None:
    try:
        if os.name == 'nt':
            import ctypes

            class MemoryStatusEx(ctypes.Structure):
                _fields_ = [
                    ('length', ctypes.c_ulong),
                    ('memory_load', ctypes.c_ulong),
                    ('total_physical', ctypes.c_ulonglong),
                    ('available_physical', ctypes.c_ulonglong),
                    ('total_page_file', ctypes.c_ulonglong),
                    ('available_page_file', ctypes.c_ulonglong),
                    ('total_virtual', ctypes.c_ulonglong),
                    ('available_virtual', ctypes.c_ulonglong),
                    ('available_extended_virtual', ctypes.c_ulonglong),
                ]

            status = MemoryStatusEx()
            status.length = ctypes.sizeof(MemoryStatusEx)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return None
            return _SystemMemorySnapshot(
                total_bytes=int(status.total_physical),
                available_bytes=int(status.available_physical),
            )

        page_size = int(os.sysconf('SC_PAGE_SIZE'))
        total_pages = int(os.sysconf('SC_PHYS_PAGES'))
        available_pages = int(os.sysconf('SC_AVPHYS_PAGES'))
        return _SystemMemorySnapshot(
            total_bytes=page_size * total_pages,
            available_bytes=page_size * available_pages,
        )
    except (AttributeError, OSError, TypeError, ValueError):
        return None


def _snapshot_model_weight_bytes(path: str | Path) -> int:
    snapshot_path = Path(path)
    safetensor_bytes = 0
    binary_bytes = 0
    file_count = 0
    for child in snapshot_path.rglob('*'):
        if not child.is_file():
            continue
        file_count += 1
        if file_count > DEFAULT_HUGGINGFACE_MAX_CACHE_FILES:
            return 0
        try:
            size = child.stat().st_size
        except OSError:
            continue
        name = child.name.lower()
        if name.endswith('.safetensors'):
            safetensor_bytes += size
        elif name.endswith(('.bin', '.pt', '.pth')):
            binary_bytes += size
    return safetensor_bytes or binary_bytes


def _available_cuda_memory_bytes() -> int:
    try:
        import torch

        if not torch.cuda.is_available():
            return 0
        free_bytes, _total_bytes = torch.cuda.mem_get_info()
        return max(0, int(free_bytes))
    except Exception:
        return 0


def _ensure_model_load_resources(model_config: LocalModelConfig) -> dict[str, int] | None:
    resolved_reference = Path(_resolved_model_reference_for(model_config.modelId))
    if not resolved_reference.is_absolute() or not resolved_reference.exists():
        return

    weight_bytes = _snapshot_model_weight_bytes(resolved_reference)
    memory = _read_system_memory_snapshot()
    if weight_bytes <= 0 or memory is None:
        return

    dtype_multiplier = 2.0 if model_config.torchDtype == 'float32' else 1.0
    required_bytes = math.ceil(weight_bytes * dtype_multiplier * 1.25) + GIBIBYTE
    device = model_config.device or 'auto'
    cuda_available_bytes = _available_cuda_memory_bytes() if device != 'cpu' else 0
    if device == 'cuda':
        available_bytes = cuda_available_bytes
    elif device == 'cpu':
        available_bytes = memory.available_bytes
    else:
        available_bytes = memory.available_bytes + cuda_available_bytes

    if available_bytes >= required_bytes:
        return None

    memory_shortfall_bytes = required_bytes - available_bytes
    allowed_overflow_bytes = (
        0
        if device == 'cuda'
        else MEMORY_OVERFLOW_POLICY_BYTES[model_config.memoryOverflowPolicy]
    )
    if memory_shortfall_bytes <= allowed_overflow_bytes:
        overflow = {
            'estimatedMemoryOverflowBytes': memory_shortfall_bytes,
            'memoryOverflowLimitBytes': allowed_overflow_bytes,
        }
        print(
            json.dumps(
                {
                    'event': 'runtime.generation_model.memory_overflow',
                    **overflow,
                    'acceleratorAvailable': cuda_available_bytes > 0,
                }
            ),
            flush=True,
        )
        return overflow

    print(
        json.dumps(
            {
                'event': 'runtime.generation_model.resources_insufficient',
                'requiredMemoryBytes': required_bytes,
                'availableMemoryBytes': available_bytes,
                'totalSystemMemoryBytes': memory.total_bytes,
                'acceleratorAvailable': cuda_available_bytes > 0,
                'estimatedMemoryShortfallBytes': memory_shortfall_bytes,
                'allowedMemoryOverflowBytes': allowed_overflow_bytes,
            }
        ),
        flush=True,
    )
    if device == 'cuda' and cuda_available_bytes <= 0:
        raise GenerationInsufficientResourcesError(
            'The selected model requires CUDA, but the local runtime does not have CUDA available.'
        )
    raise GenerationInsufficientResourcesError(
        'The selected model cannot fit in the memory currently available to the local runtime.'
    )


def _resolve_auto_inference_mode(model_config: LocalModelConfig) -> str:
    if model_config.inferenceMode != "auto":
        return model_config.inferenceMode

    configure_huggingface_download_environment()
    try:
        from transformers import AutoConfig, AutoTokenizer
    except ImportError as error:
        raise RuntimeError(
            "The 'transformers' package is required for automatic inference mode resolution."
        ) from error

    resolved_model_reference = _resolved_model_reference_for(model_config.modelId)
    model_config_metadata = AutoConfig.from_pretrained(resolved_model_reference)
    if bool(getattr(model_config_metadata, "is_encoder_decoder", False)):
        return "text2text"

    tokenizer = AutoTokenizer.from_pretrained(resolved_model_reference)
    chat_template = getattr(tokenizer, "chat_template", None)
    if isinstance(chat_template, str) and chat_template.strip():
        return "chat"

    return "causal"


def _resolve_generation_params(config: ExampleGenerationConfig) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if config.generationParams is None:
        params["max_new_tokens"] = DEFAULT_MAX_NEW_TOKENS
        return params

    if config.generationParams.maxNewTokens is not None:
        params["max_new_tokens"] = config.generationParams.maxNewTokens
    else:
        params["max_new_tokens"] = DEFAULT_MAX_NEW_TOKENS
    if config.generationParams.temperature is not None:
        params["temperature"] = config.generationParams.temperature
    if config.generationParams.topP is not None:
        params["top_p"] = config.generationParams.topP

    return params


def _resolve_runtime_generation_params(params: dict[str, Any], tokenizer: Any) -> dict[str, Any]:
    resolved = dict(params)
    if "pad_token_id" not in resolved:
        pad_token_id = getattr(tokenizer, "pad_token_id", None)
        eos_token_id = getattr(tokenizer, "eos_token_id", None)
        if pad_token_id is not None:
            resolved["pad_token_id"] = pad_token_id
        elif eos_token_id is not None:
            resolved["pad_token_id"] = eos_token_id
    return resolved


def _filter_supported_generation_params(params: dict[str, Any], generate_callable: Any) -> dict[str, Any]:
    try:
        signature = inspect.signature(generate_callable)
    except (TypeError, ValueError):
        return params

    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values()):
        return params

    supported = set(signature.parameters.keys())
    return {key: value for key, value in params.items() if key in supported}


def _apply_chat_template_for_generation(tokenizer: Any, messages: list[dict[str, str]]) -> Any:
    apply_chat_template = getattr(tokenizer, "apply_chat_template", None)
    if not callable(apply_chat_template):
        raise RuntimeError(
            "Chat inference mode requires a tokenizer with apply_chat_template support."
        )

    base_kwargs: dict[str, Any] = {
        "tokenize": True,
        "add_generation_prompt": True,
        "return_tensors": "pt",
    }
    accepts_enable_thinking = _callable_accepts_keyword(apply_chat_template, "enable_thinking")
    attempts = (
        [
            {**base_kwargs, "return_dict": True, "enable_thinking": False},
            {**base_kwargs, "return_dict": True},
            {**base_kwargs, "enable_thinking": False},
            base_kwargs,
        ]
        if accepts_enable_thinking is not False
        else [
            {**base_kwargs, "return_dict": True},
            base_kwargs,
        ]
    )
    last_type_error: TypeError | None = None
    for kwargs in attempts:
        try:
            return apply_chat_template(messages, **kwargs)
        except TypeError as error:
            last_type_error = error

    if last_type_error is not None:
        raise last_type_error
    raise RuntimeError("Chat inference mode could not apply the tokenizer chat template.")


def _callable_accepts_keyword(callable_value: Any, keyword: str) -> bool | None:
    try:
        signature = inspect.signature(callable_value)
    except (TypeError, ValueError):
        return None

    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values()):
        return True
    return keyword in signature.parameters


def _resolve_model_kwargs(model_config: LocalModelConfig) -> dict[str, Any]:
    model_kwargs: dict[str, Any] = {}
    if model_config.device == "auto":
        model_kwargs["device_map"] = "auto"

    if not model_config.torchDtype or model_config.torchDtype == "auto":
        model_kwargs["torch_dtype"] = "auto"
    elif model_config.torchDtype:
        import torch

        dtype_mapping = {
            "float16": torch.float16,
            "bfloat16": torch.bfloat16,
            "float32": torch.float32,
        }
        model_kwargs["torch_dtype"] = dtype_mapping[model_config.torchDtype]

    return model_kwargs


def _supports_manual_device_move(model: Any) -> bool:
    if getattr(model, "hf_device_map", None) is not None:
        return False
    if getattr(model, "quantization_config", None) is not None:
        return False
    return True


def _extract_pipeline_text(generation: Any) -> str:
    if not generation:
        raise RuntimeError("Model returned no generated text.")

    first = generation[0] if isinstance(generation, list) else generation
    if isinstance(first, dict):
        generated_text = str(first.get("generated_text", "")).strip()
        summary_text = str(first.get("summary_text", "")).strip()
        if generated_text:
            return generated_text
        if summary_text:
            return summary_text
    raise RuntimeError("Model returned an empty generation.")


def _is_usable_tensor_device(device: Any) -> bool:
    if device is None:
        return False

    normalized = str(device).strip().lower()
    if not normalized:
        return False

    return normalized not in {"disk", "meta"} and not normalized.startswith(("disk:", "meta:"))


def _select_device_map_input_device(device_map: Any) -> Any | None:
    if not isinstance(device_map, dict):
        return None

    usable_devices = [device for device in device_map.values() if _is_usable_tensor_device(device)]
    if not usable_devices:
        return None

    non_cpu_device = next((device for device in usable_devices if str(device).strip().lower() != "cpu"), None)
    return non_cpu_device if non_cpu_device is not None else usable_devices[0]


def _resolve_tokenized_input_device(model: Any) -> Any | None:
    device_map = getattr(model, "hf_device_map", None)
    if device_map is not None:
        return _select_device_map_input_device(device_map)

    model_device = getattr(model, "device", None)
    if _is_usable_tensor_device(model_device):
        return model_device

    return None


def _move_tokenized_inputs_to_model_device(tokenized: dict[str, Any], model: Any) -> dict[str, Any]:
    target_device = _resolve_tokenized_input_device(model)
    if target_device is None:
        return tokenized

    moved: dict[str, Any] = {}
    for key, value in tokenized.items():
        moved[key] = value.to(target_device) if hasattr(value, "to") else value
    return moved


def get_or_create_local_text_generator(
    config: ExampleGenerationConfig,
    on_memory_overflow: Callable[[dict[str, int]], None] | None = None,
) -> LocalTextGenerator:
    key = _generator_cache_key(config.model)

    with _GENERATOR_CACHE_LOCK:
        existing = _GENERATOR_CACHE.get(key)
        if existing:
            return existing

        if config.model.provider != "transformers":
            raise ValueError(f"Unsupported generation model provider: {config.model.provider}")

        try:
            generation_params = _resolve_generation_params(config)
            resolved_inference_mode = _resolve_auto_inference_mode(config.model)
            resolved_model_config = config.model.model_copy(update={"inferenceMode": resolved_inference_mode})
            key = _generator_cache_key(resolved_model_config)
            existing_after_resolution = _GENERATOR_CACHE.get(key)
            if existing_after_resolution:
                return existing_after_resolution

            memory_overflow = _ensure_model_load_resources(resolved_model_config)
            if memory_overflow is not None and on_memory_overflow is not None:
                on_memory_overflow(memory_overflow)
            print(
                json.dumps(
                    {
                        "event": "runtime.generation_model.loading",
                        "provider": "transformers",
                        "inferenceMode": resolved_inference_mode,
                    }
                ),
                flush=True,
            )
            if resolved_inference_mode == "text2text":
                created: LocalTextGenerator = TransformersText2TextGenerator(
                    resolved_model_config,
                    generation_params,
                )
            elif resolved_inference_mode == "causal":
                created = TransformersCausalGenerator(resolved_model_config, generation_params)
            elif resolved_inference_mode == "chat":
                created = TransformersChatGenerator(resolved_model_config, generation_params)
            else:
                raise ValueError(f"Unsupported inference mode: {resolved_inference_mode}")
        except (GenerationModelLoadError, GenerationInsufficientResourcesError):
            raise
        except Exception as error:
            raise GenerationModelLoadError(
                "The selected generation model could not be loaded by the local runtime."
            ) from error

        _GENERATOR_CACHE[key] = created
        return created


def _describe_loaded_generation_models_unlocked() -> list[dict[str, str | None]]:
    return [
        {
            "provider": provider,
            "modelId": model_id,
            "inferenceMode": inference_mode,
            "device": device,
            "torchDtype": torch_dtype,
        }
        for provider, model_id, inference_mode, device, torch_dtype in _GENERATOR_CACHE.keys()
    ]


def describe_loaded_generation_models() -> list[dict[str, str | None]]:
    if not _GENERATOR_CACHE_LOCK.acquire(blocking=False):
        # Model construction holds this lock to prevent duplicate multi-gigabyte
        # loads. Runtime status must remain responsive while that work proceeds.
        return []
    try:
        return _describe_loaded_generation_models_unlocked()
    finally:
        _GENERATOR_CACHE_LOCK.release()


def unload_generation_models() -> list[dict[str, str | None]]:
    with _GENERATOR_CACHE_LOCK:
        unloaded = _describe_loaded_generation_models_unlocked()
        _GENERATOR_CACHE.clear()
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    return unloaded
