from __future__ import annotations

import json
import platform
import traceback
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
from os import getenv
from pathlib import Path
from threading import Lock
import time
from typing import Any, Callable, Literal

from fastapi import FastAPI
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
    ValidateModelTaskResult,
)
from .tasks.example_generation import ensure_generation_model_downloaded
from .tasks.local_text_generation import describe_loaded_generation_models, unload_generation_models
from .tasks.model_validation import validate_model_output
from .tasks.prepare_training_dataset import prepare_training_dataset
from .tasks.train_model import train_model

RUNTIME_ID = getenv("PYTHON_RUNTIME_ID", "python-sidecar")
WORKER_VERSION = getenv("PYTHON_RUNTIME_WORKER_VERSION", "0.1.0")
WORKER_STARTED_AT = datetime.now(timezone.utc).isoformat()
PYTHON_VERSION = platform.python_version()

app = FastAPI(title="ai-system-builder python runtime worker", version=WORKER_VERSION)
TASK_EXECUTOR = ThreadPoolExecutor(max_workers=1)
TASK_REGISTRY_LOCK = Lock()
TASK_REGISTRY: dict[str, dict[str, Any]] = {}
TASK_WAIT_POLL_SECONDS = 1.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _active_task_count() -> int:
    with TASK_REGISTRY_LOCK:
        return sum(1 for task in TASK_REGISTRY.values() if task["status"] == "running")


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
        "metadata": {"runtimeId": RUNTIME_ID, **(metadata or {})},
        "future": None,
    }


def _update_task(request_id: str, **updates: Any) -> None:
    with TASK_REGISTRY_LOCK:
        task = TASK_REGISTRY[request_id]
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
    if request.taskType == "train-model":
        payload = TrainModelTaskRequest.model_validate(request.payload)
        def on_training_progress(progress: dict[str, Any]) -> None:
            _update_task(request.requestId, progress=progress)
            print(
                json.dumps(
                    {"event": "runtime.train_model.progress", "requestId": request.requestId, **progress},
                    ensure_ascii=False,
                ),
                flush=True,
            )

        print(json.dumps({"event": "runtime.train_model.started", "requestId": request.requestId}, ensure_ascii=False), flush=True)
        result = train_model(payload, on_progress=on_training_progress).model_dump(mode="json")
        print(
            json.dumps(
                {"event": "runtime.train_model.completed", "requestId": request.requestId, "status": result.get("status")},
                ensure_ascii=False,
            ),
            flush=True,
        )
        return result

    if request.taskType == "prepare-training-dataset":
        payload = PrepareTrainingDatasetRequest.model_validate(request.payload)

        def on_generation_progress(progress: dict[str, int]) -> None:
            processed = progress.get("processedChunkCount") or 0
            total = progress.get("totalChunkCount") or 0
            _update_task(
                request.requestId,
                progress={
                    "totalChunkCount": total,
                    "processedChunkCount": processed,
                    "generatedRowCount": progress.get("generatedRowCount") or 0,
                    "message": f"Processing chunk {min(processed + 1, total)}/{total}...",
                },
            )
            print(json.dumps({"event": "runtime.dataset_preparation.generation.progress", "requestId": request.requestId, **progress}, ensure_ascii=False), flush=True)

        return prepare_training_dataset(payload, on_generation_progress=on_generation_progress).model_dump(mode="json")

    if request.taskType == "validate-model":
        payload = ValidateModelTaskRequest.model_validate(request.payload)
        result = validate_model_output(
            Path(payload.modelPath),
            report_output_dir=Path(payload.reportOutputDirectory) if payload.reportOutputDirectory else None,
            expected_lora=bool(payload.expectedLoRA),
            expected_recurrent_additions=bool(payload.expectedRecurrentAdditions),
            validation_strictness=payload.validationStrictness or "normal",
        )
        return ValidateModelTaskResult(
            modelRecordId=payload.modelRecordId,
            status=result["status"],
            validationReportPath=result.get("validationReportPath"),
            validationDiffPath=result.get("validationDiffPath"),
            serializationFormat=result.get("serializationFormat"),
            shardCount=result.get("shardCount"),
            detectedLoRA=result.get("detectedLoRA"),
            detectedRecurrentAdditions=result.get("detectedRecurrentAdditions"),
            validatedModelPath=result.get("validatedModelPath"),
            validatedAt=result.get("validatedAt"),
            validationStrictness=result.get("validationStrictness"),
            tensorChecksCompleted=result.get("tensorChecksCompleted"),
            warnings=result.get("warnings"),
            errors=result.get("errors"),
        ).model_dump(mode="json")

    raise RuntimeError(f"Task type '{request.taskType}' is not implemented yet.")


def _start_async_task(request: StartPythonRuntimeTaskRequest) -> StartPythonRuntimeTaskResult:
    with TASK_REGISTRY_LOCK:
        existing = TASK_REGISTRY.get(request.requestId)
        if existing and existing.get("status") in {"queued", "running"}:
            raise RuntimeError(f"Task requestId '{request.requestId}' is already active.")
        if not existing:
            TASK_REGISTRY[request.requestId] = _create_task_record(request.requestId, request.taskType, request.metadata)

    def task_wrapper() -> None:
        _update_task(request.requestId, status="running")
        try:
            data = _run_task(request)
            _update_task(request.requestId, status="succeeded", data=data, completedAt=_now_iso())
        except Exception as error:
            print(
                json.dumps(
                    {
                        "event": "runtime.task.failed",
                        "requestId": request.requestId,
                        "taskType": request.taskType,
                        "message": str(error),
                        "traceback": traceback.format_exc(),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            _update_task(
                request.requestId,
                status="failed",
                error=PythonRuntimeError(code="task_failed", errorCode=getattr(error, "error_code", "task_failed"), stage=getattr(error, "stage", None), message=str(error), details=getattr(error, "details", None), retryable=False),
                completedAt=_now_iso(),
            )

    future = TASK_EXECUTOR.submit(task_wrapper)
    _update_task(request.requestId, future=future)
    with TASK_REGISTRY_LOCK:
        record = TASK_REGISTRY[request.requestId]
    return StartPythonRuntimeTaskResult(requestId=request.requestId, taskType=request.taskType, accepted=True, status=record["status"], startedAt=record["startedAt"], updatedAt=record["updatedAt"], metadata=record["metadata"])


@app.get("/health", response_model=PythonRuntimeHealthCheckResult)
def health() -> PythonRuntimeHealthCheckResult:
    return PythonRuntimeHealthCheckResult(healthy=True, status=PythonRuntimeHealthStatus(runtimeId=RUNTIME_ID, status="ready", version=WORKER_VERSION, pythonVersion=PYTHON_VERSION, workerStartedAt=WORKER_STARTED_AT, lastHeartbeatAt=_now_iso()))


@app.get("/capabilities", response_model=PythonRuntimeCapabilitiesResult)
def capabilities() -> PythonRuntimeCapabilitiesResult:
    return PythonRuntimeCapabilitiesResult(runtimeId=RUNTIME_ID, capabilities=["prepare-training-dataset", "ensure-model-download", "model-status", "unload-model", "dataset-preparation.auto-inference-mode", "train-model", "validate-model"])


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
    if record["status"] == "running":
        return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status="running", cancelled=False, message="Task is already running and cannot be force-cancelled.", metadata=record.get("metadata"))
    return CancelPythonRuntimeTaskResult(requestId=request_id, taskType=record.get("taskType"), status=record["status"], cancelled=False, message="Task is no longer cancellable.", metadata=record.get("metadata"))


@app.post("/models/ensure-downloaded", response_model=EnsureModelDownloadResult)
def ensure_model_download(request: EnsureModelDownloadRequest) -> EnsureModelDownloadResult | JSONResponse:
    try:
        availability = ensure_generation_model_downloaded(LocalModelConfig(provider=request.provider, modelId=request.modelId))
    except Exception as error:
        return JSONResponse(status_code=502, content={"error": PythonRuntimeError(code="model_download_failed", errorCode="generation_model_not_available", stage="generation", message=str(error), details={"provider": request.provider, "modelId": request.modelId}, retryable=True).model_dump(mode="json")})
    return EnsureModelDownloadResult(provider=request.provider, modelId=request.modelId, downloaded=availability.downloaded, fromCache=availability.from_cache, localPath=availability.local_path)


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

