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

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler

from .models import (
    CancelPythonRuntimeTaskResult,
    ContextArtifactOperationTaskRequest,
    ContextGenerationTaskRequest,
    EnsureModelDownloadRequest,
    EnsureModelDownloadResult,
    LocalModelConfig,
    LoadedModelDescriptor,
    ModelStatusResult,
    PrepareTrainingDatasetRequest,
    ReviewDatasetRequest,
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
from .generation_capacity import read_local_accelerator_memory_bytes
from .tasks.local_text_generation import (
    GenerationModelDownloadRevisionError,
    describe_loaded_generation_models,
    ensure_generation_adapter_is_available,
    ensure_generation_model_is_available,
    get_or_create_local_text_generator,
    unload_generation_models,
)
from .tasks.model_validation import validate_model_output
from .tasks.context_generation import (
    ContextGenerationCancellationRequested,
    generate_context_artifact,
)
from .tasks.context_artifact_operation import (
    ContextArtifactOperationCancellationRequested,
    operate_on_context_artifact,
)
from .tasks.prepare_training_dataset import DatasetPreparationCancellationRequested, prepare_training_dataset
from .ocr.protocol import OcrContractError, OcrUnavailable
from .ocr.task_sources import CAPABILITY as OCR_TASK_CAPABILITY, task_ocr_sources
from .tasks.review_dataset import review_dataset
from .tasks.train_model import TrainingCancellationRequested, train_model
from .tasks.approved_local_training_session import (
    CAPABILITY as ORIGINAL_TRAINING_CAPABILITY, MAX_BODY_BYTES as TRAINING_BODY_LIMIT,
    MAX_SESSIONS as TRAINING_SESSION_LIMIT, NativeTrainingProducer, NativeTrainingProfile,
    BoundedLocalTrainingProducer, BoundedLocalTrainingProfile,
    OriginalTrainingSession, TrainingSessionError, capture_definition,
    _copy as _capture_training_stage_input,
)
from .tasks import original_training_session_exit as _training_exit_ready
from .tasks.model_source_task import (
    CAPABILITY as MODEL_SOURCE_TASK_CAPABILITY, SESSION_CAPABILITY as MODEL_SOURCE_SESSION_CAPABILITY,
    ModelSourceTaskError, ModelSourceTaskOwner,
    captured_selection as capture_model_source_selection, has_source_transfer,
    read_acknowledgement as read_model_source_acknowledgement, read_source_binding,
    valid_task_id as valid_model_source_task_id,
)
from .tasks.model_source_identity import (
    CAPABILITY as MODEL_SOURCE_IDENTITY_CAPABILITY, ModelSourceIdentityError,
    read_identity_request, inspect_model_source_identity,
)

RUNTIME_ID = getenv("PYTHON_RUNTIME_ID", "python-sidecar")
WORKER_VERSION = getenv("PYTHON_RUNTIME_WORKER_VERSION", "0.1.0")
WORKER_STARTED_AT = datetime.now(timezone.utc).isoformat()
PYTHON_VERSION = platform.python_version()
RUNTIME_AUTH_TOKEN = getenv("PYTHON_RUNTIME_AUTH_TOKEN", "").strip()

_TASK_ERROR_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,95}$")
_TASK_ERROR_STAGES = {"normalization", "chunking", "generation", "split"}


def _safe_task_error_code(error: Exception) -> str:
    if isinstance(error, OcrUnavailable):
        return "ocr_unavailable"
    if isinstance(error, OcrContractError):
        return "ocr_input_invalid"
    candidate = getattr(error, "error_code", None)
    return (
        candidate
        if isinstance(candidate, str) and _TASK_ERROR_CODE_PATTERN.fullmatch(candidate)
        else "task_failed"
    )


def _safe_task_error_stage(error: Exception) -> str | None:
    if isinstance(error, (OcrUnavailable, OcrContractError)):
        return "normalization"
    candidate = getattr(error, "stage", None)
    return candidate if candidate in _TASK_ERROR_STAGES else None


def _safe_task_error_details(error: Exception) -> dict:
    details = {"diagnosticClass": type(error).__name__}
    # Notification history is a public diagnostic sink. Copy no arbitrary details.
    if _safe_task_error_code(error) != "generation_insufficient_resources":
        return details
    raw = getattr(error, "details", None)
    value = raw.get("memoryShortfall") if isinstance(raw, dict) else None
    if not isinstance(value, dict):
        return details
    resource = value.get("resource")
    fields = ("requiredBytes", "availableBytes", "allowedOverflowBytes")
    if type(resource) is not str or resource not in {"ram", "vram", "combined"} or not all(
        type(value.get(key)) is int and 0 <= value[key] <= 1024 ** 5 for key in fields
    ):
        return details
    required, available, overflow = (value[key] for key in fields)
    if required <= available + overflow or resource == "vram" and overflow != 0:
        return details
    details["memoryShortfall"] = {"resource": resource, **{key: value[key] for key in fields}}
    return details


def _safe_task_error_message(error: Exception) -> str:
    if isinstance(error, OcrUnavailable):
        return "Text recognition is unavailable. Choose an installed Windows recognition language, or turn off scanned-PDF recognition."
    if isinstance(error, OcrContractError):
        return "The scanned PDF or its settings could not be verified. Select the source again and check the recognition language."
    if getattr(error, "error_code", None) == "model_download_invalid_snapshot":
        return "Downloaded files did not form a complete model. Retry to resume and verify the saved files."
    if getattr(error, "error_code", None) == "model_download_interrupted":
        return "Model download was interrupted. Retry to resume the saved partial download."
    return "Runtime task failed. Review host diagnostics and retry."

app = FastAPI(title="ai-system-builder python runtime worker", version=WORKER_VERSION)
TASK_EXECUTOR = ThreadPoolExecutor(max_workers=1)
TASK_REGISTRY_LOCK = Lock()
TASK_REGISTRY: dict[str, dict[str, Any]] = {}
MODEL_UNLOAD_IN_PROGRESS = False
MODEL_DOWNLOAD_OPERATIONS = 0
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


def _model_source_error(status_code=409):
    return JSONResponse(status_code=status_code, content={"error": {
        "code": "model_source_task_unconfirmed", "message": "The model file transfer could not be confirmed.", "retryable": False}})


@app.exception_handler(RequestValidationError)
async def sanitize_model_source_validation(request: Request, error: RequestValidationError):
    body = error.body
    if has_source_transfer(body) or type(body) is dict and has_source_transfer(body.get("payload")):
        return _model_source_error(422)
    return await request_validation_exception_handler(request, error)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _task_retains_custody(task) -> bool:
    owner = task.get("_modelSourceOwner")
    training = task.get("_originalTrainingOwner")
    return (task.get("status") in {"queued", "running"} or
            isinstance(owner, ModelSourceTaskOwner) and owner.retains_record or
            isinstance(training, OriginalTrainingSession) and training.retains_record)


def _task_execution_active(task) -> bool:
    training = task.get("_originalTrainingOwner")
    # Remote session settlement cannot reopen a resource-bearing original
    # worker while its supervisor is still confirming process/Job retirement.
    return training.blocks_recovery if isinstance(training, OriginalTrainingSession) else _task_retains_custody(task)


def _source_record_current_locked(record, owner) -> bool:
    return (isinstance(owner, ModelSourceTaskOwner) and TASK_REGISTRY.get(owner.task_id) is record and
            record.get("_modelSourceOwner") is owner and
            record.get("_modelSourceIncarnation") == (RUNTIME_ID, WORKER_STARTED_AT))


def _publish_source_task(record, owner, **updates) -> bool:
    with TASK_REGISTRY_LOCK:
        if not _source_record_current_locked(record, owner):
            return False
        record.update(updates)
        record["updatedAt"] = _now_iso()
        return True


def _active_task_count() -> int:
    with TASK_REGISTRY_LOCK:
        return sum(_task_execution_active(task) for task in TASK_REGISTRY.values())


def _prune_terminal_tasks_locked() -> None:
    terminal_ids = [
        request_id
        for request_id, task in TASK_REGISTRY.items()
        if task.get("status") in {"succeeded", "failed", "cancelled"} and not _task_retains_custody(task)
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
        "cancellationRequested": False,
    }


def _update_task(request_id: str, **updates: Any) -> None:
    with TASK_REGISTRY_LOCK:
        task = TASK_REGISTRY.get(request_id)
        if task is None:
            return
        # Legacy ID-only continuations cannot write a private successor record.
        if isinstance(task.get("_modelSourceOwner"), ModelSourceTaskOwner) or isinstance(task.get("_originalTrainingOwner"), OriginalTrainingSession):
            return
        task.update(updates)
        task["updatedAt"] = _now_iso()


def _build_task_status_result(record: dict[str, Any]) -> PythonRuntimeTaskStatusResult:
    owner = record.get("_modelSourceOwner")
    data = owner.generic_result() if isinstance(owner, ModelSourceTaskOwner) and record.get("data") is not None else record.get("data")
    return PythonRuntimeTaskStatusResult(
        requestId=record["requestId"],
        taskType=record.get("taskType"),
        status=record["status"],
        progress=record.get("progress"),
        data=data,
        error=record.get("error"),
        startedAt=record.get("startedAt"),
        updatedAt=record.get("updatedAt"),
        completedAt=record.get("completedAt"),
        metadata=record.get("metadata"),
    )


def _run_task(request: StartPythonRuntimeTaskRequest) -> Any:
    if request.taskType == "ensure-model-download":
        payload = EnsureModelDownloadRequest.model_validate(request.payload)
        if payload.sourceTransfer is not None:
            raise ModelSourceTaskError()
        def on_model_download_progress(progress: dict[str, Any]) -> None:
            _update_task(request.requestId, progress=progress)

        return _ensure_model_download_data(payload, on_progress=on_model_download_progress)

    if request.taskType == "train-model":
        payload = TrainModelTaskRequest.model_validate(request.payload)
        def on_training_progress(progress: dict[str, Any]) -> None:
            with TASK_REGISTRY_LOCK:
                cancellation_requested = TASK_REGISTRY.get(
                    request.requestId,
                    {},
                ).get("cancellationRequested") is True
            if cancellation_requested:
                raise TrainingCancellationRequested(
                    "Model training cancellation requested."
                )
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
        # Validate the complete source map before resolving even the output root.
        task_ocr_sources(payload)

        def preparation_cancelled() -> bool:
            with TASK_REGISTRY_LOCK:
                return TASK_REGISTRY.get(request.requestId, {}).get("cancellationRequested") is True

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
            cancelled=preparation_cancelled,
        ).model_dump(mode="json")

    if request.taskType == "generate-context-artifact":
        payload = ContextGenerationTaskRequest.model_validate(request.payload)

        def check_context_cancellation() -> None:
            with TASK_REGISTRY_LOCK:
                cancellation_requested = TASK_REGISTRY.get(
                    request.requestId,
                    {},
                ).get("cancellationRequested") is True
            if cancellation_requested:
                raise ContextGenerationCancellationRequested(
                    "Context generation cancellation requested."
                )

        def on_context_progress(progress: dict[str, Any]) -> None:
            check_context_cancellation()
            _update_task(request.requestId, progress=progress)
            print(
                json.dumps({"event": "runtime.context_generation.progress"}),
                flush=True,
            )

        return generate_context_artifact(
            payload,
            on_progress=on_context_progress,
            cancellation_check=check_context_cancellation,
        )

    if request.taskType == "context-artifact-operation":
        payload = ContextArtifactOperationTaskRequest.model_validate(
            request.payload
        )

        def check_context_operation_cancellation() -> None:
            with TASK_REGISTRY_LOCK:
                cancellation_requested = TASK_REGISTRY.get(
                    request.requestId,
                    {},
                ).get("cancellationRequested") is True
            if cancellation_requested:
                raise ContextArtifactOperationCancellationRequested(
                    "Context artifact operation cancellation requested."
                )

        return operate_on_context_artifact(
            payload,
            cancellation_check=check_context_operation_cancellation,
        )

    if request.taskType == "review-dataset":
        payload = ReviewDatasetRequest.model_validate(request.payload)
        return review_dataset(payload)


    if request.taskType == "conversation-text-generation":
        payload = request.payload if isinstance(request.payload, dict) else {}
        messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
        if not messages:
            raise RuntimeError("Conversation text generation requires at least one message.")
        selected_model_id = payload.get("selectedModelId")
        if not isinstance(selected_model_id, str) or not selected_model_id.strip():
            raise RuntimeError("Conversation text generation requires an approved selected model reference.")
        base_model_id = payload.get("baseModelId")
        if base_model_id is not None and (
            not isinstance(base_model_id, str) or not base_model_id.strip()
        ):
            raise RuntimeError("Conversation text generation base model reference is invalid.")
        adapter_revision = payload.get("adapterRevision")
        if adapter_revision is not None and not isinstance(adapter_revision, str):
            raise RuntimeError("Conversation text generation adapter revision is invalid.")
        runtime_model_id = base_model_id.strip() if base_model_id else selected_model_id
        adapter_model_id = selected_model_id if base_model_id else None
        loaded_model_data = next(
            (
                model
                for model in describe_loaded_generation_models()
                if model.get("modelId") == runtime_model_id
                and model.get("memoryMode", "standard") == "standard"
                and model.get("adapterModelId") == adapter_model_id
                and model.get("adapterRevision") == adapter_revision
            ),
            None,
        )
        selected_model = (
            LoadedModelDescriptor.model_validate(loaded_model_data)
            if loaded_model_data is not None
            else None
        )
        generation_payload = payload.get("generation") if isinstance(payload.get("generation"), dict) else {}
        params = GenerationParams(
            temperature=generation_payload.get("temperature") if isinstance(generation_payload.get("temperature"), (int, float)) else None,
            maxNewTokens=generation_payload.get("maxOutputTokens") if isinstance(generation_payload.get("maxOutputTokens"), int) else None,
        )
        config = ExampleGenerationConfig(
            mode="qa",
            model=LocalModelConfig(
                provider="transformers",
                modelId=runtime_model_id,
                inferenceMode=(
                    selected_model.inferenceMode if selected_model else "auto"
                ),
                device=selected_model.device if selected_model else "auto",
                torchDtype=selected_model.torchDtype if selected_model else "auto",
                adapterModelId=adapter_model_id,
                adapterRevision=adapter_revision,
            ),
            generationParams=params,
        )
        if selected_model is None:
            ensure_generation_model_is_available(config)
            if adapter_model_id:
                ensure_generation_adapter_is_available(config)
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
    if request.sourceTransfer is not None:
        raise ModelSourceTaskError()
    provider, model_id, revision = request.provider, request.modelId, request.revision
    source_manifest = request.sourceManifest.model_dump(mode="json") if request.sourceManifest is not None else None
    availability = ensure_generation_model_downloaded(
        LocalModelConfig(provider=provider, modelId=model_id),
        on_progress=on_progress,
        download_context={
            "inferenceMode": request.inferenceMode,
            "taskTags": request.taskTags,
            "artifactForm": request.artifactForm,
            **({"revision": revision} if revision is not None else {}),
            **({"sourceManifest": source_manifest} if source_manifest is not None else {}),
        },
    )
    if revision is not None and getattr(availability, "revision", None) != revision:
        raise GenerationModelDownloadRevisionError("Pinned model download revision could not be confirmed.")
    if source_manifest is not None and getattr(availability, "verified_manifest_digest", None) != source_manifest["manifestDigest"]:
        from .tasks.model_download_manifest import ModelDownloadManifestError
        raise ModelDownloadManifestError()
    result = EnsureModelDownloadResult(
        provider=provider,
        modelId=model_id,
        revision=revision,
        downloaded=availability.downloaded,
        fromCache=availability.from_cache,
        modelHandle=availability.cache_handle,
    ).model_dump(mode="json")
    if revision is None:
        result.pop("revision", None)
    if source_manifest is not None:
        result["verifiedManifestDigest"] = source_manifest["manifestDigest"]
    else:
        result.pop("verifiedManifestDigest", None)
    return result


def _start_async_task(request: StartPythonRuntimeTaskRequest) -> StartPythonRuntimeTaskResult:
    selection = capture_model_source_selection(request.payload)
    if selection is not None:
        if request.taskType != "ensure-model-download" or not valid_model_source_task_id(request.requestId):
            raise ModelSourceTaskError()
        # Capture the supported immutable selection/metadata before queueing.
        request = StartPythonRuntimeTaskRequest(requestId=request.requestId, taskType=request.taskType,
            payload=selection.model_dump(mode="json", exclude_none=True), metadata=_safe_task_metadata(request.metadata),
            timeoutMs=request.timeoutMs)
    with TASK_REGISTRY_LOCK:
        if any(isinstance(row.get("_originalTrainingOwner"), OriginalTrainingSession) and
               row["_originalTrainingOwner"].blocks_recovery for row in TASK_REGISTRY.values()):
            raise RuntimeError("Original training custody must be settled before another task.")
        if MODEL_UNLOAD_IN_PROGRESS:
            raise RuntimeError("Generation model cleanup is in progress. Retry after completion.")
        if not TASK_REQUEST_ID_PATTERN.fullmatch(request.requestId):
            raise RuntimeError("Runtime task request identifier is invalid.")
        _prune_terminal_tasks_locked()
        existing = TASK_REGISTRY.get(request.requestId)
        if existing and (_task_retains_custody(existing) or isinstance(existing.get("_modelSourceOwner"), ModelSourceTaskOwner)):
            raise RuntimeError("Runtime task request identifier is already active.")
        active_count = sum(
            1
            for task in TASK_REGISTRY.values()
            if _task_execution_active(task)
        )
        if active_count >= TASK_MAX_ACTIVE:
            raise RuntimeError("Python runtime task queue is at capacity.")
        record = _create_task_record(
            request.requestId,
            request.taskType,
            request.metadata,
        )
        original_id = request.requestId
        incarnation = (RUNTIME_ID, WORKER_STARTED_AT)
        if selection is not None:
            def original_record_current():
                with TASK_REGISTRY_LOCK:
                    return _source_record_current_locked(record, owner)
            owner = ModelSourceTaskOwner(original_id, selection, record_current=original_record_current)
            record["_modelSourceOwner"] = owner
            record["_modelSourceIncarnation"] = incarnation
        TASK_REGISTRY[request.requestId] = record

    def record_is_current_locked():
        if selection is not None:
            return _source_record_current_locked(record, owner)
        return (TASK_REGISTRY.get(original_id) is record and
                incarnation == (RUNTIME_ID, WORKER_STARTED_AT) and
                not isinstance(record.get("_modelSourceOwner"), ModelSourceTaskOwner))

    def publish(**updates):
        if selection is not None:
            return _publish_source_task(record, owner, **updates)
        with TASK_REGISTRY_LOCK:
            if not record_is_current_locked():
                return False
            record.update(updates)
            record["updatedAt"] = _now_iso()
            return True

    def task_wrapper() -> None:
        try:
            if not publish(status="running"):
                return
            data = owner.execute() if selection is not None else _run_task(request)
            with TASK_REGISTRY_LOCK:
                if not record_is_current_locked():
                    return
                cancellation_requested = record.get("cancellationRequested") is True
            if cancellation_requested:
                publish(
                    status="cancelled",
                    data=None,
                    completedAt=_now_iso(),
                )
            else:
                publish(
                    status="succeeded",
                    data=data,
                    completedAt=_now_iso(),
                )
        except (
            DatasetPreparationCancellationRequested,
            TrainingCancellationRequested,
            ContextGenerationCancellationRequested,
            ContextArtifactOperationCancellationRequested,
        ):
            publish(
                status="cancelled",
                data=None,
                error=None,
                completedAt=_now_iso(),
            )
        except Exception as error:
            with TASK_REGISTRY_LOCK:
                if not record_is_current_locked():
                    return
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
            publish(
                status="failed",
                error=PythonRuntimeError(
                    code=error_code,
                    errorCode=error_code,
                    stage=error_stage,
                    message=_safe_task_error_message(error),
                    details=_safe_task_error_details(error),
                    retryable=getattr(error, "retryable", False) is True,
                ),
                completedAt=_now_iso(),
            )
        finally:
            with TASK_REGISTRY_LOCK:
                if record_is_current_locked():
                    _prune_terminal_tasks_locked()

    try:
        future = TASK_EXECUTOR.submit(task_wrapper)
    except Exception:
        if selection is not None:
            owner.issue_unconfirmed()
            raise ModelSourceTaskError() from None
        raise
    if not publish(future=future):
        if selection is not None:
            raise ModelSourceTaskError()
        raise RuntimeError("The original runtime task could not be confirmed.")
    with TASK_REGISTRY_LOCK:
        if not record_is_current_locked():
            if selection is not None:
                raise ModelSourceTaskError()
            raise RuntimeError("The original runtime task could not be confirmed.")
        reply_record = record
    accepted_status = (
        reply_record["status"]
        if reply_record["status"] in {"queued", "running"}
        else "running"
    )
    return StartPythonRuntimeTaskResult(requestId=original_id, taskType=reply_record["taskType"], accepted=True, status=accepted_status, startedAt=reply_record["startedAt"], updatedAt=reply_record["updatedAt"], metadata=reply_record["metadata"])


_ORIGINAL_TRAINING_PRODUCER = None
_ORIGINAL_TRAINING_PROFILE = None
_ORIGINAL_TRAINING_PROTOCOL = "settled-v1"
_ORIGINAL_TRAINING_STAGES = {}


def configure_original_training(producer: NativeTrainingProducer, *, retirement_protocol="settled-v1"):
    """Trusted boot composition only. No request/env flag can supply custody.

    Actual host composition must provide the independently qualified native
    producer/profile. This source mechanism deliberately supplies no producer.
    """
    global _ORIGINAL_TRAINING_PRODUCER, _ORIGINAL_TRAINING_PROFILE, _ORIGINAL_TRAINING_PROTOCOL
    if type(retirement_protocol) is not str or retirement_protocol not in ("settled-v1", _training_exit_ready.PROTOCOL):
        raise TrainingSessionError()
    if not isinstance(producer, NativeTrainingProducer):
        raise TrainingSessionError()
    profile = producer.profile
    if type(profile) is not NativeTrainingProfile:
        raise TrainingSessionError()
    with TASK_REGISTRY_LOCK:
        if _ORIGINAL_TRAINING_PRODUCER is not None or TASK_REGISTRY:
            raise TrainingSessionError()
        _ORIGINAL_TRAINING_PRODUCER, _ORIGINAL_TRAINING_PROFILE = producer, profile
        _ORIGINAL_TRAINING_PROTOCOL = retirement_protocol


def configure_bounded_local_training(producer: BoundedLocalTrainingProducer):
    """Explicit trusted boot selection; neither JSON nor an env flag enables it.

    The local guarantee is cooperative. The original parent still owns process
    limits, worker retirement, task-owned directories, result review and Save.
    """
    global _ORIGINAL_TRAINING_PRODUCER, _ORIGINAL_TRAINING_PROFILE, _ORIGINAL_TRAINING_PROTOCOL
    if type(producer) is not BoundedLocalTrainingProducer or type(producer.profile) is not BoundedLocalTrainingProfile:
        raise TrainingSessionError()
    with TASK_REGISTRY_LOCK:
        if _ORIGINAL_TRAINING_PRODUCER is not None or TASK_REGISTRY:
            raise TrainingSessionError()
        _ORIGINAL_TRAINING_PRODUCER, _ORIGINAL_TRAINING_PROFILE = producer, producer.profile
        _ORIGINAL_TRAINING_PROTOCOL = "settled-v1"


def _capture_original_training_stages(owner, record, submit_original, current, timeout):
    """Closed operations on the same captured executor, never HTTP callbacks."""
    methods = {"prepare": OriginalTrainingSession.prepare, "seal": OriginalTrainingSession.seal,
               "exit-ready": OriginalTrainingSession.finish_exit_ready}
    direct = {"start": OriginalTrainingSession.start, "cancel": OriginalTrainingSession.cancel,
              "settle": OriginalTrainingSession.settle, "output-read": OriginalTrainingSession.read_output,
              "output-ack": OriginalTrainingSession.acknowledge_output,
              "begin": OriginalTrainingSession.begin_exit_ready, "lost": OriginalTrainingSession.mark_exit_ready_lost}
    futures = {}
    def invoke(action, supplied=None):
        if action not in methods:
            raise TrainingSessionError()
        selected = methods[action]
        captured = _capture_training_stage_input(supplied) if action == "seal" else None
        with TASK_REGISTRY_LOCK:
            # No wait or callback while holding the registry's nonreentrant lock.
            if TASK_REGISTRY.get(record["requestId"]) is not record or record.get("_originalTrainingOwner") is not owner or action in futures:
                raise TrainingSessionError()
            futures[action] = None  # Latch before submit, including a lost reply.
        def perform():
            if not current():
                raise TrainingSessionError()
            return selected(owner, captured) if action == "seal" else selected(owner)
        future = submit_original(perform)
        if type(future) is not Future:
            raise TrainingSessionError()
        futures[action] = future  # Retain original pending work across wait timeout.
        return future.result(timeout=timeout)
    return {"owner": owner, "record": record, "invoke": invoke, "futures": futures, "direct": direct}


def _training_identity():
    profile = _ORIGINAL_TRAINING_PROFILE
    if profile is None or _ORIGINAL_TRAINING_PRODUCER is None:
        raise TrainingSessionError()
    return {"runtimeId": RUNTIME_ID, "workerStartedAt": WORKER_STARTED_AT,
            "profileId": profile.profile_id, "profileFingerprint": profile.fingerprint}


async def _training_body(request: Request):
    # Stream bound before JSON parsing; errors never echo private input or paths.
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > TRAINING_BODY_LIMIT:
            raise TrainingSessionError()
        content.extend(chunk)
    body = json.loads(bytes(content))
    if type(body) is not dict:
        raise TrainingSessionError()
    return body


def _prepare_original_training(body):
    local = type(_ORIGINAL_TRAINING_PROFILE) is BoundedLocalTrainingProfile
    keys = {"identity", "definition", "localModelCopy"} if local else {"identity", "definition"}
    deliver_output = (local and type(body) is dict and type(body.get("outputDelivery")) is str
                      and body["outputDelivery"] == "bounded-local-v1")
    if deliver_output: keys = keys | {"outputDelivery"}
    if type(body) is not dict or set(body) != keys or body["identity"] != _training_identity():
        raise TrainingSessionError()
    definition = capture_definition(body["definition"])
    task_id = definition["requestId"]
    incarnation = (RUNTIME_ID, WORKER_STARTED_AT)
    with TASK_REGISTRY_LOCK:
        # This explicit profile reserves the existing executor exclusively.
        if (MODEL_UNLOAD_IN_PROGRESS or MODEL_DOWNLOAD_OPERATIONS or task_id in TASK_REGISTRY or
                any(_task_retains_custody(row) and not (isinstance(row.get("_originalTrainingOwner"), OriginalTrainingSession)
                    and not row["_originalTrainingOwner"].blocks_recovery) for row in TASK_REGISTRY.values()) or
                sum(isinstance(row.get("_originalTrainingOwner"), OriginalTrainingSession)
                    for row in TASK_REGISTRY.values()) >= TRAINING_SESSION_LIMIT):
            raise TrainingSessionError()
        record = _create_task_record(task_id, "train-model", {"workspaceId": definition["workspaceId"]})
        binding = {**_training_identity(), "requestId": task_id, "workspaceId": definition["workspaceId"],
                   "sessionId": secrets.token_hex(32)}
        def current():
            with TASK_REGISTRY_LOCK:
                return (TASK_REGISTRY.get(task_id) is record and record.get("_originalTrainingOwner") is owner and
                        record.get("_trainingIncarnation") == incarnation == (RUNTIME_ID, WORKER_STARTED_AT))
        def publish(**updates):
            with TASK_REGISTRY_LOCK:
                if not (TASK_REGISTRY.get(task_id) is record and record.get("_originalTrainingOwner") is owner and
                        incarnation == (RUNTIME_ID, WORKER_STARTED_AT)):
                    return False
                record.update(updates); record["updatedAt"] = _now_iso()
                if record["status"] in {"succeeded", "failed", "cancelled"}:
                    record["completedAt"] = _now_iso()
                return True
        # Capture this executor/method/receiver now, not after awaited preparation.
        submit_original = TASK_EXECUTOR.submit
        run_original = OriginalTrainingSession.run
        def submit(session):
            if session is not owner or not current():
                raise TrainingSessionError()
            future = submit_original((lambda: run_original(owner)) if protocol == _training_exit_ready.PROTOCOL else owner.run)
            publish(future=future)
            return future
        protocol = _ORIGINAL_TRAINING_PROTOCOL
        owner = OriginalTrainingSession(definition, _ORIGINAL_TRAINING_PRODUCER, current, publish, submit, _ORIGINAL_TRAINING_PROFILE,
            retirement_protocol=protocol, local_model=body["localModelCopy"] if local else None,
            local_output_delivery=bool(deliver_output))
        record.update(_originalTrainingOwner=owner, _trainingBinding=binding, _trainingIncarnation=incarnation)
        if protocol == _training_exit_ready.PROTOCOL:
            if len(_ORIGINAL_TRAINING_STAGES) >= TRAINING_SESSION_LIMIT:
                raise TrainingSessionError()
            _ORIGINAL_TRAINING_STAGES[task_id] = _capture_original_training_stages(owner, record, submit_original,
                current, _ORIGINAL_TRAINING_PROFILE.maximum_duration_seconds)
        TASK_REGISTRY[task_id] = record  # Reserve original record BEFORE native IO.
    stage = _ORIGINAL_TRAINING_STAGES.get(task_id) if protocol == _training_exit_ready.PROTOCOL else None
    phase = stage["invoke"]("prepare") if stage else owner.prepare()
    if phase == "unconfirmed" and owner.known_not_run and owner.settle():
        phase = "unavailable"
    return {"binding": binding, "phase": "ready" if phase == "prepared" else phase}


def _operate_original_training(task_id, action, body):
    expected_keys = {"binding", "input"} if action == "seal" else {"binding", "sequence"} if action == "output-ack" else {"binding"}
    if type(body) is not dict or set(body) != expected_keys:
        raise TrainingSessionError()
    with TASK_REGISTRY_LOCK:
        record = TASK_REGISTRY.get(task_id)
        if record is None or not isinstance(record.get("_originalTrainingOwner"), OriginalTrainingSession):
            raise TrainingSessionError()
        owner = record["_originalTrainingOwner"]
        if (body["binding"] != record["_trainingBinding"] or
                record["_trainingIncarnation"] != (RUNTIME_ID, WORKER_STARTED_AT)):
            raise TrainingSessionError()
    _training_exit_ready.assert_wire(owner, action)
    stages = _ORIGINAL_TRAINING_STAGES.get(task_id)
    if stages is not None and (stages["owner"] is not owner or stages["record"] is not record):
        raise TrainingSessionError()
    if action == "seal":
        result = {"phase": stages["invoke"]("seal", body["input"]) if stages else owner.seal(body["input"])}
    elif action == "start":
        result = stages["direct"]["start"](owner) if stages else owner.start()
    elif action == "cancel":
        result = {"cancelled": stages["direct"]["cancel"](owner) if stages else owner.cancel()}
    elif action == "settle":
        settled = stages["direct"]["settle"](owner) if stages else owner.settle()
        with owner.lock:
            result = {"settled": settled, "retirement": "settled" if settled else "unconfirmed" if owner.close_attempted else "pending"}
    elif action == "read":
        with TASK_REGISTRY_LOCK:
            # The same pointer must still own the original publication.
            if TASK_REGISTRY.get(task_id) is not record:
                raise TrainingSessionError()
            result = {"record": _build_task_status_result(record).model_dump(mode="json", exclude_none=True)}
    elif action == "output-read":
        result = {"output": stages["direct"]["output-read"](owner) if stages else owner.read_output()}
    elif action == "output-ack":
        result = {"acknowledged": stages["direct"]["output-ack"](owner, body["sequence"]) if stages else owner.acknowledge_output(body["sequence"])}
    elif action == "exit-ready":
        if stages is None or not _training_exit_ready.enabled(owner):
            raise TrainingSessionError()
        readiness = stages["direct"]["begin"](owner)
        if readiness == "queued":
            try: readiness = stages["invoke"]("exit-ready")
            except Exception:
                stages["direct"]["lost"](owner); readiness = "unconfirmed"
        result = {"schema": "original-training-exit-ready-v1", "ready": readiness == "ready", "retirement": readiness}
    else:
        raise TrainingSessionError()
    response = {"binding": record["_trainingBinding"], **result}
    if action in ("output-read", "output-ack"):
        if len(json.dumps(response, allow_nan=False, separators=(",", ":")).encode("utf8")) > TRAINING_BODY_LIMIT:
            raise TrainingSessionError()
    return response


@app.post("/training/original/prepare")
async def prepare_original_training(request: Request):
    try:
        return await run_in_threadpool(_prepare_original_training, await _training_body(request))
    except Exception:
        return JSONResponse(status_code=409, content={"error": "original_training_unavailable"})


@app.post("/training/original/{request_id}/{action}")
async def operate_original_training(request_id: str, action: str, request: Request):
    try:
        return await run_in_threadpool(_operate_original_training, request_id, action, await _training_body(request))
    except Exception:
        return JSONResponse(status_code=409, content={"error": "original_training_unavailable"})


@app.get("/health", response_model=PythonRuntimeHealthCheckResult)
def health() -> PythonRuntimeHealthCheckResult:
    return PythonRuntimeHealthCheckResult(healthy=True, status=PythonRuntimeHealthStatus(runtimeId=RUNTIME_ID, status="ready", version=WORKER_VERSION, pythonVersion=PYTHON_VERSION, workerStartedAt=WORKER_STARTED_AT, lastHeartbeatAt=_now_iso()))


@app.get("/capabilities", response_model=PythonRuntimeCapabilitiesResult)
def capabilities() -> PythonRuntimeCapabilitiesResult:
    from .tasks.bounded_model_loader import offload_runtime_available
    supported = [
        "prepare-training-dataset",
        "review-dataset",
        "generate-context-artifact",
        "context-artifact-operation",
        "ensure-model-download",
        "ensure-model-download.exact-revision-v1",
        "ensure-model-download.source-manifest-v1",
        MODEL_SOURCE_TASK_CAPABILITY,
        MODEL_SOURCE_SESSION_CAPABILITY,
        MODEL_SOURCE_IDENTITY_CAPABILITY,
        "model-status",
        "unload-model",
        "dataset-preparation.auto-inference-mode",
        "train-model",
        "validate-model",
        "conversation-text-generation",
    ]
    decoder_available = get_constrained_json_decoder_runtime_status().available
    if decoder_available:
        supported.append("dataset-preparation.constrained-json")
    if offload_runtime_available():
        supported.append("dataset-preparation.offload-v1")
    if platform.system() == "Windows":
        # Protocol support only; no engine/process/language probe at startup.
        supported.append(OCR_TASK_CAPABILITY)
    if _ORIGINAL_TRAINING_PRODUCER is not None:
        supported.append(_training_exit_ready.CAPABILITY if _ORIGINAL_TRAINING_PROTOCOL == _training_exit_ready.PROTOCOL
                         else ORIGINAL_TRAINING_CAPABILITY)
    return PythonRuntimeCapabilitiesResult(
        runtimeId=RUNTIME_ID, capabilities=supported,
        totalAcceleratorMemoryBytes=read_local_accelerator_memory_bytes() if decoder_available else None,
    )


@app.post("/tasks/start", response_model=StartPythonRuntimeTaskResult)
def start_task(request: StartPythonRuntimeTaskRequest) -> StartPythonRuntimeTaskResult | JSONResponse:
    try:
        return _start_async_task(request)
    except ModelSourceTaskError:
        return _model_source_error(400)


def _model_source_task_owner(request_id):
    if not valid_model_source_task_id(request_id):
        return None
    with TASK_REGISTRY_LOCK:
        record = TASK_REGISTRY.get(request_id)
        owner = record.get("_modelSourceOwner") if record is not None else None
    return owner if isinstance(owner, ModelSourceTaskOwner) else None


@app.post("/models/source-identity")
async def read_model_source_identity(request: Request):
    def denied(status):
        return JSONResponse(status_code=status, content={"error": {"code": "model_source_identity_unconfirmed",
            "message": "The model receiver identity could not be confirmed.", "retryable": False}})
    try:
        incoming = await read_identity_request(request)
    except ModelSourceIdentityError:
        return denied(400)
    runtime_id, started_at = RUNTIME_ID, WORKER_STARTED_AT
    if incoming.runtimeId != runtime_id or incoming.workerStartedAt != started_at:
        return denied(409)
    try:
        scope = None
        if incoming.phase == "snapshot":
            owner = _model_source_task_owner(incoming.taskId)
            if owner is None:
                return denied(404)
            scope = owner.identity_probe_scope()
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(inspect_model_source_identity, incoming,
            runtime_id=runtime_id, worker_started_at=started_at,
            is_current=lambda: RUNTIME_ID == runtime_id and WORKER_STARTED_AT == started_at,
            scope=scope)
    except (ModelSourceIdentityError, ModelSourceTaskError):
        return denied(409)


@app.get("/tasks/{request_id}/model-source")
def read_model_source_status(request_id: str):
    owner = _model_source_task_owner(request_id)
    if owner is None:
        return _model_source_error(404)
    try:
        return owner.status()
    except ModelSourceTaskError:
        return _model_source_error(409)


@app.post("/tasks/{request_id}/model-source/acknowledgement")
async def acknowledge_model_source(request_id: str, request: Request):
    owner = _model_source_task_owner(request_id)
    if owner is None:
        return _model_source_error(404)
    try:
        incoming = await read_model_source_acknowledgement(request)
    except ModelSourceTaskError:
        return _model_source_error(400)
    try:
        # Registry locks are released before hashes, links or context cleanup.
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(owner.acknowledge, incoming)
    except ModelSourceTaskError:
        return _model_source_error(409)


def _cancel_bound_model_source(record, owner, binding):
    if not owner.matches_binding(binding):
        raise ModelSourceTaskError()
    with TASK_REGISTRY_LOCK:
        if not _source_record_current_locked(record, owner):
            raise ModelSourceTaskError()
        future, status = record.get("future"), record.get("status")
    cancelled = False
    # Future callbacks may acquire the registry lock. Cancel only the captured
    # original Future, outside that lock, then publish by exact row/owner CAS.
    if status == "queued" and isinstance(future, Future) and future.cancel():
        owner.cancel_before_start()
        if not _publish_source_task(record, owner, status="cancelled", completedAt=_now_iso()):
            raise ModelSourceTaskError()
        cancelled = True
    elif status == "cancelled":
        cancelled = True
    return {"cancelled": cancelled, "source": owner.status()}


@app.post("/tasks/{request_id}/model-source/cancel")
async def cancel_bound_model_source(request_id: str, request: Request):
    try:
        binding = await read_source_binding(request)
    except ModelSourceTaskError:
        return _model_source_error(400)
    if binding["taskId"] != request_id:
        return _model_source_error(409)
    with TASK_REGISTRY_LOCK:
        record = TASK_REGISTRY.get(request_id)
        owner = record.get("_modelSourceOwner") if record is not None else None
    if not isinstance(owner, ModelSourceTaskOwner):
        return _model_source_error(404)
    try:
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(_cancel_bound_model_source, record, owner, binding)
    except ModelSourceTaskError:
        return _model_source_error(409)


@app.get("/tasks/{request_id}", response_model=PythonRuntimeTaskStatusResult)
def read_task_status(request_id: str) -> PythonRuntimeTaskStatusResult:
    with TASK_REGISTRY_LOCK:
        record = TASK_REGISTRY.get(request_id)
    if not record:
        return PythonRuntimeTaskStatusResult(requestId=request_id, status="unknown", metadata={"runtimeId": RUNTIME_ID})
    if isinstance(record.get("_originalTrainingOwner"), OriginalTrainingSession):
        raise HTTPException(status_code=409, detail="original-training-session-required")
    return _build_task_status_result(record)


@app.post("/tasks/{request_id}/cancel", response_model=CancelPythonRuntimeTaskResult)
def cancel_task(request_id: str) -> CancelPythonRuntimeTaskResult:
    with TASK_REGISTRY_LOCK:
        record = TASK_REGISTRY.get(request_id)
    if not record:
        return CancelPythonRuntimeTaskResult(requestId=request_id, status="unknown", cancelled=False, message="Task not found.", metadata={"runtimeId": RUNTIME_ID})
    if isinstance(record.get("_originalTrainingOwner"), OriginalTrainingSession):
        raise HTTPException(status_code=409, detail="original-training-session-required")
    if isinstance(record.get("_modelSourceOwner"), ModelSourceTaskOwner):
        # An old generic request may arrive after this ID belongs to a source.
        # Only the exact bound source route can touch its queued Future.
        raise HTTPException(status_code=409, detail="model-source-bound-cancellation-required")
    future = record.get("future")
    if record["status"] == "queued" and isinstance(future, Future) and future.cancel():
        owner = record.get("_modelSourceOwner")
        if isinstance(owner, ModelSourceTaskOwner):
            owner.cancel_before_start()
            if not _publish_source_task(record, owner, status="cancelled", completedAt=_now_iso()):
                return CancelPythonRuntimeTaskResult(requestId=request_id, status="unknown", cancelled=False,
                    message="Task is no longer available.", metadata={"runtimeId": RUNTIME_ID})
        else:
            _update_task(request_id, status="cancelled", completedAt=_now_iso())
        return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status="cancelled", cancelled=True, message="Cancelled queued task.", metadata=record.get("metadata"))
    if record["status"] == "cancelled":
        return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status="cancelled", cancelled=True, message="Task is already cancelled.", metadata=record.get("metadata"))
    if record["status"] == "running":
        if record.get("taskType") in {
            "train-model",
            "generate-context-artifact",
            "context-artifact-operation",
            "prepare-training-dataset",
        }:
            with TASK_REGISTRY_LOCK:
                current = TASK_REGISTRY.get(request_id)
                if current is not record:
                    return CancelPythonRuntimeTaskResult(requestId=request_id, status="unknown", cancelled=False,
                        message="Task is no longer available.", metadata={"runtimeId": RUNTIME_ID})
                if current is not None:
                    current["cancellationRequested"] = True
                    current["progress"] = {
                        "stage": "cancelling",
                        "message": (
                            "Stopping dataset preparation after the current bounded operation."
                            if record.get("taskType") == "prepare-training-dataset"
                            else
                            "Stopping context generation after the current chunk."
                            if record.get("taskType") == "generate-context-artifact"
                            else "Stopping context retrieval."
                            if record.get("taskType") == "context-artifact-operation"
                            else "Stopping model training after the current batch."
                        ),
                    }
                    current["updatedAt"] = _now_iso()
            message = (
                "Dataset preparation cancellation requested."
                if record.get("taskType") == "prepare-training-dataset"
                else
                "Context generation cancellation requested."
                if record.get("taskType") == "generate-context-artifact"
                else "Context retrieval cancellation requested."
                if record.get("taskType") == "context-artifact-operation"
                else "Model training cancellation requested."
            )
            return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status="running", cancelled=False, message=message, metadata=record.get("metadata"))
        return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status="running", cancelled=False, message="Task is already running and cannot be force-cancelled.", metadata=record.get("metadata"))
    return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status=record["status"], cancelled=False, message="Task is no longer cancellable.", metadata=record.get("metadata"))


@app.post("/models/ensure-downloaded", response_model=EnsureModelDownloadResult, response_model_exclude_unset=True)
def ensure_model_download(request: EnsureModelDownloadRequest) -> EnsureModelDownloadResult | JSONResponse:
    global MODEL_DOWNLOAD_OPERATIONS
    with TASK_REGISTRY_LOCK:
        if any(isinstance(row.get("_originalTrainingOwner"), OriginalTrainingSession) and
               row["_originalTrainingOwner"].blocks_recovery for row in TASK_REGISTRY.values()):
            return JSONResponse(status_code=409, content={"error": "original_training_custody_pending"})
        MODEL_DOWNLOAD_OPERATIONS += 1
    try:
        return _ensure_model_download_reserved(request)
    finally:
        with TASK_REGISTRY_LOCK:
            MODEL_DOWNLOAD_OPERATIONS -= 1


def _ensure_model_download_reserved(request: EnsureModelDownloadRequest) -> EnsureModelDownloadResult | JSONResponse:
    if request.sourceTransfer is not None:
        return _model_source_error(409)
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
    global MODEL_UNLOAD_IN_PROGRESS
    from .tasks.local_model_offload import OffloadAdmissionError
    with TASK_REGISTRY_LOCK:
        active_task_count = sum(_task_execution_active(task) for task in TASK_REGISTRY.values())
        if active_task_count > 0 or MODEL_UNLOAD_IN_PROGRESS:
            return JSONResponse(status_code=409, content={"error": PythonRuntimeError(code="model_unload_blocked", message="Cannot unload generation model while a runtime task or cleanup is active.", details={"activeTaskCount": active_task_count}, retryable=True).model_dump(mode="json")})
        MODEL_UNLOAD_IN_PROGRESS = True
    try:
        unloaded = unload_generation_models()
        return UnloadModelsResult(unloadedModels=[LoadedModelDescriptor.model_validate(model) for model in unloaded], activeTaskCount=0)
    except OffloadAdmissionError:
        return JSONResponse(status_code=409, content={"error": PythonRuntimeError(code="model_cleanup_pending", message="Model cleanup could not be confirmed. Ownership is retained; retry unloading after completion.", retryable=True).model_dump(mode="json")})
    finally:
        with TASK_REGISTRY_LOCK:
            MODEL_UNLOAD_IN_PROGRESS = False
