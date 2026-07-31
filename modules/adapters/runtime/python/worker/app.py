from __future__ import annotations

import json
import hashlib
import hmac
import platform
import secrets
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
from os import getenv
from pathlib import Path
from threading import Lock
import time
from typing import Any, Callable, Literal
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .models import (
    CancelPythonRuntimeTaskResult,
    EnsureModelDownloadRequest,
    EnsureModelDownloadResult,
    LocalModelConfig,
    LoadedModelDescriptor,
    ModelStatusResult,
    PrepareTrainingDatasetRequest,
    PythonRuntimeCapabilitiesResult,
    PythonRuntimeError,
    PythonRuntimeHealthCheckResult,
    PythonRuntimeHealthStatus,
    PythonRuntimeTaskStatusResult,
    StartPythonRuntimeTaskRequest,
    StartPythonRuntimeTaskResult,
    TrainModelTaskRequest,
    UnloadModelsResult,
    ValidateModelTaskRequest,
    ExampleGenerationConfig,
    GenerationParams,
    ValidateModelTaskResult,
)
from .tasks.example_generation import ensure_generation_model_downloaded
from .tasks.constrained_json_decoder import get_constrained_json_decoder_runtime_status
from .tasks.local_text_generation import describe_loaded_generation_models, get_or_create_local_text_generator, unload_generation_models
from .tasks.model_validation import validate_model_output
from .tasks.prepare_training_dataset import prepare_training_dataset
from .tasks.train_model import train_model

RUNTIME_ID = getenv("PYTHON_RUNTIME_ID", "python-sidecar")
WORKER_VERSION = getenv("PYTHON_RUNTIME_WORKER_VERSION", "0.1.0")
WORKER_STARTED_AT = datetime.now(timezone.utc).isoformat()
PYTHON_VERSION = platform.python_version()
RUNTIME_AUTH_TOKEN = getenv("PYTHON_RUNTIME_AUTH_TOKEN", "").strip()

_TASK_ERROR_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,95}$")
_TASK_ERROR_STAGES = {"normalization", "chunking", "generation", "split"}


def _safe_task_error_code(error: Exception) -> str:
    candidate = getattr(error, "error_code", None)
    return (
        candidate
        if isinstance(candidate, str) and _TASK_ERROR_CODE_PATTERN.fullmatch(candidate)
        else "task_failed"
    )


def _safe_task_error_stage(error: Exception) -> str | None:
    candidate = getattr(error, "stage", None)
    return candidate if candidate in _TASK_ERROR_STAGES else None


def _safe_task_error_message(error: Exception) -> str:
    if getattr(error, "error_code", None) == "model_download_invalid_snapshot":
        return "Downloaded files did not form a complete model. Retry to resume and verify the saved files."
    if getattr(error, "error_code", None) == "model_download_interrupted":
        return "Model download was interrupted. Retry to resume the saved partial download."
    return "Runtime task failed. Review host diagnostics and retry."

app = FastAPI(title="ai-system-builder python runtime worker", version=WORKER_VERSION)
TASK_EXECUTOR = ThreadPoolExecutor(max_workers=1)
TASK_REGISTRY_LOCK = Lock()
TASK_REGISTRY: dict[str, dict[str, Any]] = {}
TASK_WAIT_POLL_SECONDS = 1.0
TASK_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(getenv(name, str(default)))
    except ValueError:
        return default
    return min(max(value, minimum), maximum)


TASK_MAX_ACTIVE = _bounded_env_int("PYTHON_RUNTIME_MAX_ACTIVE_TASKS", 8, 1, 32)
TASK_MAX_RETAINED = _bounded_env_int("PYTHON_RUNTIME_MAX_RETAINED_TASKS", 256, 1, 1024)


def _opaque_task_resource_ref(request_id: str, role: str) -> str:
    digest = hmac.new(
        RUNTIME_AUTH_TOKEN.encode("utf-8"),
        f"{request_id}:{role}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{role}:{digest}"


def _runtime_output_directory(payload: PrepareTrainingDatasetRequest) -> Path:
    runtime = payload.runtime
    configured = (
        runtime.get("runtimeWorkingDirectory")
        if isinstance(runtime, dict)
        else None
    )
    if not isinstance(configured, str) or not configured.strip():
        raise ValueError("Runtime output root is required.")
    candidate = Path(configured)
    if not candidate.is_absolute() or candidate.is_symlink():
        raise ValueError("Runtime output root is invalid.")
    canonical = candidate.resolve(strict=True)
    if not canonical.is_dir():
        raise ValueError("Runtime output root is invalid.")
    return canonical


def _request_has_valid_launch_token(authorization_header: str | None) -> bool:
    if not RUNTIME_AUTH_TOKEN or not authorization_header:
        return False
    scheme, separator, supplied_token = authorization_header.partition(" ")
    if not separator or scheme.lower() != "bearer" or not supplied_token:
        return False
    try:
        return secrets.compare_digest(supplied_token, RUNTIME_AUTH_TOKEN)
    except (TypeError, ValueError):
        return False


@app.middleware("http")
async def require_launch_authentication(request: Request, call_next):
    if not RUNTIME_AUTH_TOKEN:
        return JSONResponse(
            status_code=503,
            content={"error": {"code": "runtime_auth_unconfigured", "message": "Runtime authentication is unavailable."}},
        )
    if not _request_has_valid_launch_token(request.headers.get("authorization")):
        return JSONResponse(
            status_code=401,
            headers={"www-authenticate": "Bearer"},
            content={"error": {"code": "runtime_auth_required", "message": "Runtime authentication is required."}},
        )
    return await call_next(request)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _active_task_count() -> int:
    with TASK_REGISTRY_LOCK:
        return sum(1 for task in TASK_REGISTRY.values() if task["status"] in {"queued", "running"})


def _prune_terminal_tasks_locked() -> None:
    terminal_ids = [
        request_id
        for request_id, task in TASK_REGISTRY.items()
        if task.get("status") in {"succeeded", "failed", "cancelled"}
    ]
    while len(terminal_ids) > TASK_MAX_RETAINED:
        TASK_REGISTRY.pop(terminal_ids.pop(0), None)


def _safe_task_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    safe: dict[str, Any] = {"runtimeId": RUNTIME_ID}
    workspace_id = metadata.get("workspaceId") if isinstance(metadata, dict) else None
    if isinstance(workspace_id, str) and 0 < len(workspace_id) <= 128:
        safe["workspaceId"] = workspace_id
    return safe


def _resolve_dataset_preparation_inactivity_timeout_ms(request: StartPythonRuntimeTaskRequest) -> int | None:
    if request.metadata and isinstance(request.metadata.get("datasetPreparationInactivityTimeoutMs"), int):
        timeout_ms = int(request.metadata["datasetPreparationInactivityTimeoutMs"])
        if timeout_ms > 0:
            return timeout_ms
    if request.timeoutMs and request.timeoutMs > 0:
        return int(request.timeoutMs)
    return None


def _create_task_record(request_id: str, task_type: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    now = _now_iso()
    return {
        "requestId": request_id,
        "taskType": task_type,
        "status": "queued",
        "progress": None,
        "data": None,
        "error": None,
        "startedAt": now,
        "updatedAt": now,
        "completedAt": None,
        "metadata": _safe_task_metadata(metadata),
        "future": None,
    }


def _update_task(request_id: str, **updates: Any) -> None:
    with TASK_REGISTRY_LOCK:
        task = TASK_REGISTRY.get(request_id)
        if task is None:
            return
        task.update(updates)
        task["updatedAt"] = _now_iso()


def _build_task_status_result(record: dict[str, Any]) -> PythonRuntimeTaskStatusResult:
    return PythonRuntimeTaskStatusResult(
        requestId=record["requestId"],
        taskType=record.get("taskType"),
        status=record["status"],
        progress=record.get("progress"),
        data=record.get("data"),
        error=record.get("error"),
        startedAt=record.get("startedAt"),
        updatedAt=record.get("updatedAt"),
        completedAt=record.get("completedAt"),
        metadata=record.get("metadata"),
    )


def _run_task(request: StartPythonRuntimeTaskRequest) -> Any:
    if request.taskType == "ensure-model-download":
        payload = EnsureModelDownloadRequest.model_validate(request.payload)
        def on_model_download_progress(progress: dict[str, Any]) -> None:
            _update_task(request.requestId, progress=progress)

        return _ensure_model_download_data(payload, on_progress=on_model_download_progress)

    if request.taskType == "train-model":
        payload = TrainModelTaskRequest.model_validate(request.payload)
        def on_training_progress(progress: dict[str, Any]) -> None:
            _update_task(request.requestId, progress=progress)
            print(json.dumps({"event": "runtime.train_model.progress"}), flush=True)

        print(json.dumps({"event": "runtime.train_model.started"}), flush=True)
        result = train_model(payload, on_progress=on_training_progress).model_dump(mode="json")
        print(
            json.dumps(
                {"event": "runtime.train_model.completed", "status": result.get("status")},
                ensure_ascii=False,
            ),
            flush=True,
        )
        return result

    if request.taskType == "prepare-training-dataset":
        payload = PrepareTrainingDatasetRequest.model_validate(request.payload)

        def on_generation_progress(progress: dict[str, Any]) -> None:
            processed = progress.get("processedChunkCount") or 0
            total = progress.get("totalChunkCount") or 0
            explicit_message = progress.get("message")
            message = (
                explicit_message
                if isinstance(explicit_message, str) and explicit_message.strip()
                else f"Processing chunk {min(processed + 1, total)}/{total}..."
            )
            _update_task(
                request.requestId,
                progress={
                    "totalChunkCount": total,
                    "processedChunkCount": processed,
                    "generatedRowCount": progress.get("generatedRowCount") or 0,
                    "message": message,
                    **(
                        {"phase": progress["phase"]}
                        if isinstance(progress.get("phase"), str)
                        else {}
                    ),
                    **(
                        {"memoryOverflowActive": True}
                        if progress.get("memoryOverflowActive") is True
                        else {}
                    ),
                    **(
                        {
                            "estimatedMemoryOverflowBytes": progress[
                                "estimatedMemoryOverflowBytes"
                            ]
                        }
                        if isinstance(
                            progress.get("estimatedMemoryOverflowBytes"), int
                        )
                        else {}
                    ),
                    **(
                        {
                            "memoryOverflowLimitBytes": progress[
                                "memoryOverflowLimitBytes"
                            ]
                        }
                        if isinstance(progress.get("memoryOverflowLimitBytes"), int)
                        else {}
                    ),
                },
            )
            print(json.dumps({"event": "runtime.dataset_preparation.generation.progress"}), flush=True)

        return prepare_training_dataset(
            payload,
            on_generation_progress=on_generation_progress,
            output_directory=_runtime_output_directory(payload),
        ).model_dump(mode="json")


    if request.taskType == "conversation-text-generation":
        payload = request.payload if isinstance(request.payload, dict) else {}
        messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
        if not messages:
            raise RuntimeError("Conversation text generation requires at least one message.")
        selected_model_id = payload.get("selectedModelId")
        if not isinstance(selected_model_id, str) or not selected_model_id.strip():
            raise RuntimeError("Conversation text generation requires an approved selected model reference.")
        loaded_models = describe_loaded_generation_models()
        if not loaded_models:
            raise RuntimeError("Conversation text generation requires a loaded local generation model.")
        selected_model = next((model for model in loaded_models if model.modelId == selected_model_id), None)
        if selected_model is None:
            raise RuntimeError("Conversation text generation selected model is unavailable.")
        generation_payload = payload.get("generation") if isinstance(payload.get("generation"), dict) else {}
        params = GenerationParams(
            temperature=generation_payload.get("temperature") if isinstance(generation_payload.get("temperature"), (int, float)) else None,
            maxNewTokens=generation_payload.get("maxOutputTokens") if isinstance(generation_payload.get("maxOutputTokens"), int) else None,
        )
        config = ExampleGenerationConfig(
            mode="qa",
            model=LocalModelConfig(provider="transformers", modelId=selected_model.modelId, inferenceMode=selected_model.inferenceMode, device=selected_model.device, torchDtype=selected_model.torchDtype),
            generationParams=params,
        )
        generator = get_or_create_local_text_generator(config)
        prompt = _build_conversation_prompt(messages)
        assistant_response_text = generator.generate_text(prompt).strip()
        if not assistant_response_text:
            raise RuntimeError("Conversation text generation returned empty assistant text.")
        return {"assistantResponseText": assistant_response_text}

    if request.taskType == "validate-model":
        payload = ValidateModelTaskRequest.model_validate(request.payload)
        result = validate_model_output(
            Path(payload.modelPath),
            expected_lora=bool(payload.expectedLoRA),
            expected_recurrent_additions=bool(payload.expectedRecurrentAdditions),
            validation_strictness=payload.validationStrictness or "normal",
        )
        return ValidateModelTaskResult(
            modelRecordId=payload.modelRecordId,
            status=result["status"],
            validationReportPath=(
                _opaque_task_resource_ref(request.requestId, "validation-report")
                if result.get("validationReportPath")
                else None
            ),
            validationDiffPath=(
                _opaque_task_resource_ref(request.requestId, "validation-diff")
                if result.get("validationDiffPath")
                else None
            ),
            serializationFormat=result.get("serializationFormat"),
            shardCount=result.get("shardCount"),
            detectedLoRA=result.get("detectedLoRA"),
            detectedRecurrentAdditions=result.get("detectedRecurrentAdditions"),
            validatedAt=result.get("validatedAt"),
            validationStrictness=result.get("validationStrictness"),
            tensorChecksCompleted=result.get("tensorChecksCompleted"),
            warnings=result.get("warnings"),
            errors=result.get("errors"),
        ).model_dump(mode="json")

    raise RuntimeError(f"Task type '{request.taskType}' is not implemented yet.")




def _build_conversation_prompt(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if role not in {"system", "user", "assistant"} or not isinstance(content, str):
            continue
        cleaned = content.strip()
        if not cleaned:
            continue
        parts.append(f"{role.upper()}: {cleaned}")
    parts.append("ASSISTANT:")
    return "\n\n".join(parts)


def _ensure_model_download_data(
    request: EnsureModelDownloadRequest,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    availability = ensure_generation_model_downloaded(
        LocalModelConfig(provider=request.provider, modelId=request.modelId),
        on_progress=on_progress,
        download_context={
            "inferenceMode": request.inferenceMode,
            "taskTags": request.taskTags,
            "artifactForm": request.artifactForm,
        },
    )
    return EnsureModelDownloadResult(
        provider=request.provider,
        modelId=request.modelId,
        downloaded=availability.downloaded,
        fromCache=availability.from_cache,
        modelHandle=availability.cache_handle,
    ).model_dump(mode="json")


def _start_async_task(request: StartPythonRuntimeTaskRequest) -> StartPythonRuntimeTaskResult:
    with TASK_REGISTRY_LOCK:
        if not TASK_REQUEST_ID_PATTERN.fullmatch(request.requestId):
            raise RuntimeError("Runtime task request identifier is invalid.")
        _prune_terminal_tasks_locked()
        existing = TASK_REGISTRY.get(request.requestId)
        if existing and existing.get("status") in {"queued", "running"}:
            raise RuntimeError("Runtime task request identifier is already active.")
        active_count = sum(
            1
            for task in TASK_REGISTRY.values()
            if task.get("status") in {"queued", "running"}
        )
        if active_count >= TASK_MAX_ACTIVE:
            raise RuntimeError("Python runtime task queue is at capacity.")
        TASK_REGISTRY[request.requestId] = _create_task_record(
            request.requestId,
            request.taskType,
            request.metadata,
        )

    def task_wrapper() -> None:
        _update_task(request.requestId, status="running")
        try:
            data = _run_task(request)
            _update_task(request.requestId, status="succeeded", data=data, completedAt=_now_iso())
        except Exception as error:
            error_code = _safe_task_error_code(error)
            error_stage = _safe_task_error_stage(error)
            print(
                json.dumps(
                    {
                        "event": "runtime.task.failed",
                        "taskType": request.taskType,
                        "diagnosticClass": type(error).__name__,
                        "errorCode": error_code,
                        **({"stage": error_stage} if error_stage else {}),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            _update_task(
                request.requestId,
                status="failed",
                error=PythonRuntimeError(
                    code=error_code,
                    errorCode=error_code,
                    stage=error_stage,
                    message=_safe_task_error_message(error),
                    details={"diagnosticClass": type(error).__name__},
                    retryable=getattr(error, "retryable", False) is True,
                ),
                completedAt=_now_iso(),
            )
        finally:
            with TASK_REGISTRY_LOCK:
                _prune_terminal_tasks_locked()

    future = TASK_EXECUTOR.submit(task_wrapper)
    _update_task(request.requestId, future=future)
    with TASK_REGISTRY_LOCK:
        record = TASK_REGISTRY[request.requestId]
    accepted_status = (
        record["status"]
        if record["status"] in {"queued", "running"}
        else "running"
    )
    return StartPythonRuntimeTaskResult(requestId=request.requestId, taskType=request.taskType, accepted=True, status=accepted_status, startedAt=record["startedAt"], updatedAt=record["updatedAt"], metadata=record["metadata"])


@app.get("/health", response_model=PythonRuntimeHealthCheckResult)
def health() -> PythonRuntimeHealthCheckResult:
    return PythonRuntimeHealthCheckResult(healthy=True, status=PythonRuntimeHealthStatus(runtimeId=RUNTIME_ID, status="ready", version=WORKER_VERSION, pythonVersion=PYTHON_VERSION, workerStartedAt=WORKER_STARTED_AT, lastHeartbeatAt=_now_iso()))


@app.get("/capabilities", response_model=PythonRuntimeCapabilitiesResult)
def capabilities() -> PythonRuntimeCapabilitiesResult:
    supported = [
        "prepare-training-dataset",
        "ensure-model-download",
        "model-status",
        "unload-model",
        "dataset-preparation.auto-inference-mode",
        "train-model",
        "validate-model",
        "conversation-text-generation",
    ]
    if get_constrained_json_decoder_runtime_status().available:
        supported.append("dataset-preparation.constrained-json")
    return PythonRuntimeCapabilitiesResult(runtimeId=RUNTIME_ID, capabilities=supported)


@app.post("/tasks/start", response_model=StartPythonRuntimeTaskResult)
def start_task(request: StartPythonRuntimeTaskRequest) -> StartPythonRuntimeTaskResult:
    return _start_async_task(request)


@app.get("/tasks/{request_id}", response_model=PythonRuntimeTaskStatusResult)
def read_task_status(request_id: str) -> PythonRuntimeTaskStatusResult:
    with TASK_REGISTRY_LOCK:
        record = TASK_REGISTRY.get(request_id)
    if not record:
        return PythonRuntimeTaskStatusResult(requestId=request_id, status="unknown", metadata={"runtimeId": RUNTIME_ID})
    return _build_task_status_result(record)


@app.post("/tasks/{request_id}/cancel", response_model=CancelPythonRuntimeTaskResult)
def cancel_task(request_id: str) -> CancelPythonRuntimeTaskResult:
    with TASK_REGISTRY_LOCK:
        record = TASK_REGISTRY.get(request_id)
    if not record:
        return CancelPythonRuntimeTaskResult(requestId=request_id, status="unknown", cancelled=False, message="Task not found.", metadata={"runtimeId": RUNTIME_ID})
    future = record.get("future")
    if record["status"] == "queued" and isinstance(future, Future) and future.cancel():
        _update_task(request_id, status="cancelled", completedAt=_now_iso())
        return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status="cancelled", cancelled=True, message="Cancelled queued task.", metadata=record.get("metadata"))
    if record["status"] == "cancelled":
        return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status="cancelled", cancelled=True, message="Task is already cancelled.", metadata=record.get("metadata"))
    if record["status"] == "running":
        return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status="running", cancelled=False, message="Task is already running and cannot be force-cancelled.", metadata=record.get("metadata"))
    return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status=record["status"], cancelled=False, message="Task is no longer cancellable.", metadata=record.get("metadata"))


@app.post("/models/ensure-downloaded", response_model=EnsureModelDownloadResult)
def ensure_model_download(request: EnsureModelDownloadRequest) -> EnsureModelDownloadResult | JSONResponse:
    started_at = time.monotonic()
    print(
        json.dumps(
            {
                "event": "runtime.model_download.started",
                "provider": request.provider,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    try:
        result = _ensure_model_download_data(request)
    except Exception as error:
        print(
            json.dumps(
                {
                    "event": "runtime.model_download.failed",
                    "provider": request.provider,
                    "elapsedMs": round((time.monotonic() - started_at) * 1000),
                    "diagnosticClass": type(error).__name__,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        safe_error_code = _safe_task_error_code(error)
        return JSONResponse(
            status_code=502,
            content={
                "error": PythonRuntimeError(
                    code="model_download_failed",
                    errorCode=(
                        safe_error_code
                        if safe_error_code != "task_failed"
                        else "generation_model_not_available"
                    ),
                    stage=_safe_task_error_stage(error) or "generation",
                    message=(
                        _safe_task_error_message(error)
                        if safe_error_code != "task_failed"
                        else "Model download failed. Review host diagnostics and retry."
                    ),
                    details={"provider": request.provider},
                    retryable=getattr(error, "retryable", True) is True,
                ).model_dump(mode="json")
            },
        )
    print(
        json.dumps(
            {
                "event": "runtime.model_download.succeeded",
                "provider": request.provider,
                "downloaded": result.get("downloaded") is True,
                "fromCache": result.get("fromCache") is True,
                "hasModelHandle": bool(result.get("modelHandle")),
                "elapsedMs": round((time.monotonic() - started_at) * 1000),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return EnsureModelDownloadResult.model_validate(result)


@app.get("/models/status", response_model=ModelStatusResult)
def model_status() -> ModelStatusResult:
    return ModelStatusResult(loadedModels=[LoadedModelDescriptor.model_validate(model) for model in describe_loaded_generation_models()], activeTaskCount=_active_task_count())


@app.post("/models/unload", response_model=UnloadModelsResult)
def unload_models() -> UnloadModelsResult | JSONResponse:
    active_task_count = _active_task_count()
    if active_task_count > 0:
        return JSONResponse(status_code=409, content={"error": PythonRuntimeError(code="model_unload_blocked", message="Cannot unload generation model while a runtime task is active.", details={"activeTaskCount": active_task_count}, retryable=True).model_dump(mode="json")})
    unloaded = unload_generation_models()
    return UnloadModelsResult(unloadedModels=[LoadedModelDescriptor.model_validate(model) for model in unloaded], activeTaskCount=0)
