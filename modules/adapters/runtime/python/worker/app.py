from __future__ import annotations

import platform
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
from os import getenv
from threading import Lock

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .models import (
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
    PythonRuntimeTaskRequest,
    PythonRuntimeTaskResult,
    UnloadModelsResult,
)
from .tasks.prepare_training_dataset import prepare_training_dataset
from .tasks.example_generation import ensure_generation_model_downloaded
from .tasks.local_text_generation import describe_loaded_generation_models, unload_generation_models

RUNTIME_ID = getenv("PYTHON_RUNTIME_ID", "python-sidecar")
WORKER_VERSION = getenv("PYTHON_RUNTIME_WORKER_VERSION", "0.1.0")
WORKER_STARTED_AT = datetime.now(timezone.utc).isoformat()
PYTHON_VERSION = platform.python_version()

app = FastAPI(title="ai-system-builder python runtime worker", version=WORKER_VERSION)
TASK_EXECUTOR = ThreadPoolExecutor(max_workers=1)
ACTIVE_TASK_LOCK = Lock()
ACTIVE_TASK_IDS: set[str] = set()


def _active_task_count() -> int:
    with ACTIVE_TASK_LOCK:
        return len(ACTIVE_TASK_IDS)


def _mark_task_active(request_id: str) -> None:
    with ACTIVE_TASK_LOCK:
        ACTIVE_TASK_IDS.add(request_id)


def _mark_task_complete(request_id: str) -> None:
    with ACTIVE_TASK_LOCK:
        ACTIVE_TASK_IDS.discard(request_id)


@app.get("/health", response_model=PythonRuntimeHealthCheckResult)
def health() -> PythonRuntimeHealthCheckResult:
    heartbeat = datetime.now(timezone.utc).isoformat()
    return PythonRuntimeHealthCheckResult(
        healthy=True,
        status=PythonRuntimeHealthStatus(
            runtimeId=RUNTIME_ID,
            status="ready",
            version=WORKER_VERSION,
            pythonVersion=PYTHON_VERSION,
            workerStartedAt=WORKER_STARTED_AT,
            lastHeartbeatAt=heartbeat,
        ),
    )


@app.get("/capabilities", response_model=PythonRuntimeCapabilitiesResult)
def capabilities() -> PythonRuntimeCapabilitiesResult:
    return PythonRuntimeCapabilitiesResult(
        runtimeId=RUNTIME_ID,
        capabilities=[
            "prepare-training-dataset",
            "ensure-model-download",
            "model-status",
            "unload-model",
            "dataset-preparation.auto-inference-mode",
        ],
    )


@app.post("/models/ensure-downloaded", response_model=EnsureModelDownloadResult)
def ensure_model_download(request: EnsureModelDownloadRequest) -> EnsureModelDownloadResult | JSONResponse:
    try:
        availability = ensure_generation_model_downloaded(LocalModelConfig(provider=request.provider, modelId=request.modelId))
    except Exception as error:
        return JSONResponse(
            status_code=502,
            content={
                "error": PythonRuntimeError(
                    code="model_download_failed",
                    errorCode="generation_model_not_available",
                    stage="generation",
                    message=str(error),
                    details={
                        "provider": request.provider,
                        "modelId": request.modelId,
                    },
                    retryable=True,
                ).model_dump(mode="json"),
            },
        )

    return EnsureModelDownloadResult(
        provider=request.provider,
        modelId=request.modelId,
        downloaded=availability.downloaded,
        fromCache=availability.from_cache,
        localPath=availability.local_path,
    )


@app.get("/models/status", response_model=ModelStatusResult)
def model_status() -> ModelStatusResult:
    return ModelStatusResult(
        loadedModels=[
            LoadedModelDescriptor.model_validate(model)
            for model in describe_loaded_generation_models()
        ],
        activeTaskCount=_active_task_count(),
    )


@app.post("/models/unload", response_model=UnloadModelsResult)
def unload_models() -> UnloadModelsResult | JSONResponse:
    active_task_count = _active_task_count()
    if active_task_count > 0:
        return JSONResponse(
            status_code=409,
            content={
                "error": PythonRuntimeError(
                    code="model_unload_blocked",
                    message="Cannot unload generation model while a runtime task is active.",
                    details={"activeTaskCount": active_task_count},
                    retryable=True,
                ).model_dump(mode="json"),
            },
        )

    unloaded = unload_generation_models()
    return UnloadModelsResult(
        unloadedModels=[
            LoadedModelDescriptor.model_validate(model)
            for model in unloaded
        ],
        activeTaskCount=0,
    )


@app.post("/tasks/execute", response_model=PythonRuntimeTaskResult)
def execute_task(request: PythonRuntimeTaskRequest) -> PythonRuntimeTaskResult:
    try:
        if request.taskType == "prepare-training-dataset":
            payload = PrepareTrainingDatasetRequest.model_validate(request.payload)
            def run_prepare_training_dataset() -> object:
                _mark_task_active(request.requestId)
                try:
                    return prepare_training_dataset(payload)
                finally:
                    _mark_task_complete(request.requestId)

            task_future = TASK_EXECUTOR.submit(run_prepare_training_dataset)
            timeout_seconds = (request.timeoutMs / 1000) if request.timeoutMs else None
            try:
                result = task_future.result(timeout=timeout_seconds)
            except FutureTimeoutError:
                task_future.cancel()
                return PythonRuntimeTaskResult(
                    requestId=request.requestId,
                    taskType=request.taskType,
                    success=False,
                    error=PythonRuntimeError(
                        code="task_timeout",
                        errorCode="runtime_timeout",
                        stage="generation",
                        message=f"Dataset preparation timed out after {request.timeoutMs}ms.",
                        retryable=False,
                    ),
                    metadata={"runtimeId": RUNTIME_ID},
                )
            return PythonRuntimeTaskResult(
                requestId=request.requestId,
                taskType=request.taskType,
                success=True,
                data=result.model_dump(mode="json"),
                metadata={"runtimeId": RUNTIME_ID},
            )

        return PythonRuntimeTaskResult(
            requestId=request.requestId,
            taskType=request.taskType,
            success=False,
            error=PythonRuntimeError(
                code="not_implemented",
                message=f"Task type '{request.taskType}' is not implemented yet.",
                retryable=False,
            ),
            metadata={
                "runtimeId": RUNTIME_ID,
                "skeleton": True,
            },
        )
    except Exception as error:
        error_code = "task_failed"
        stage = None
        details = None
        message = str(error)
        if hasattr(error, "error_code"):
            error_code = str(getattr(error, "error_code"))
        if hasattr(error, "stage"):
            stage = str(getattr(error, "stage"))
        if hasattr(error, "details"):
            error_details = getattr(error, "details")
            if isinstance(error_details, dict):
                details = error_details
        return PythonRuntimeTaskResult(
            requestId=request.requestId,
            taskType=request.taskType,
            success=False,
            error=PythonRuntimeError(
                code="task_failed",
                errorCode=error_code,
                stage=stage,  # type: ignore[arg-type]
                message=message,
                details=details,
                retryable=False,
            ),
            metadata={"runtimeId": RUNTIME_ID},
        )
