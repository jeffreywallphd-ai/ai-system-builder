import type {
  CancelPythonRuntimeTaskResult,
  PythonRuntimeTaskStatus,
  PythonRuntimeTaskStatusResult,
  PythonRuntimeCapabilitiesResult,
  PythonRuntimeError,
  PythonRuntimeHealthCheckResult,
  PythonRuntimeHealthStatus,
  PythonRuntimeLoadedModel,
  PythonRuntimeModelStatusResult,
  StartPythonRuntimeTaskRequest,
  StartPythonRuntimeTaskResult,
  PythonRuntimeStatus,
  PythonRuntimeUnloadModelsResult,
} from "../../../../contracts/runtime";

const PYTHON_RUNTIME_STATUS_VALUES: ReadonlySet<PythonRuntimeStatus> = new Set([
  "starting",
  "ready",
  "degraded",
  "stopped",
  "failed",
]);

const LOADED_MODEL_INFERENCE_MODES: ReadonlySet<PythonRuntimeLoadedModel["inferenceMode"]> = new Set([
  "text2text",
  "causal",
  "chat",
]);

const LOADED_MODEL_DEVICES: ReadonlySet<NonNullable<PythonRuntimeLoadedModel["device"]>> = new Set([
  "cpu",
  "cuda",
  "auto",
]);

const LOADED_MODEL_TORCH_DTYPES: ReadonlySet<NonNullable<PythonRuntimeLoadedModel["torchDtype"]>> = new Set([
  "auto",
  "float16",
  "bfloat16",
  "float32",
]);
const PYTHON_RUNTIME_TASK_STATUS_VALUES: ReadonlySet<PythonRuntimeTaskStatus> = new Set([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid python runtime ${label}: expected object payload.`);
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid python runtime payload: ${field} must be a non-empty string.`);
  }

  return value;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return asString(value, field);
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid python runtime payload: ${field} must be a boolean.`);
  }

  return value;
}

function asPythonRuntimeStatus(value: unknown, field: string): PythonRuntimeStatus {
  const normalized = asString(value, field);
  if (!PYTHON_RUNTIME_STATUS_VALUES.has(normalized as PythonRuntimeStatus)) {
    throw new Error(
      `Invalid python runtime payload: ${field} must be one of ${Array.from(PYTHON_RUNTIME_STATUS_VALUES).join(", ")}.`,
    );
  }

  return normalized as PythonRuntimeStatus;
}

function asOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return asBoolean(value, field);
}

function asLoadedModelInferenceMode(value: unknown, field: string): PythonRuntimeLoadedModel["inferenceMode"] {
  const normalized = asString(value, field);
  if (!LOADED_MODEL_INFERENCE_MODES.has(normalized as PythonRuntimeLoadedModel["inferenceMode"])) {
    throw new Error(`Invalid python runtime payload: ${field} must be a known inference mode.`);
  }

  return normalized as PythonRuntimeLoadedModel["inferenceMode"];
}

function asOptionalLoadedModelDevice(value: unknown, field: string): PythonRuntimeLoadedModel["device"] {
  const normalized = asOptionalString(value, field);
  if (!normalized) {
    return undefined;
  }

  if (!LOADED_MODEL_DEVICES.has(normalized as NonNullable<PythonRuntimeLoadedModel["device"]>)) {
    throw new Error(`Invalid python runtime payload: ${field} must be a known device.`);
  }

  return normalized as PythonRuntimeLoadedModel["device"];
}

function asOptionalLoadedModelTorchDtype(value: unknown, field: string): PythonRuntimeLoadedModel["torchDtype"] {
  const normalized = asOptionalString(value, field);
  if (!normalized) {
    return undefined;
  }

  if (!LOADED_MODEL_TORCH_DTYPES.has(normalized as NonNullable<PythonRuntimeLoadedModel["torchDtype"]>)) {
    throw new Error(`Invalid python runtime payload: ${field} must be a known torch dtype.`);
  }

  return normalized as PythonRuntimeLoadedModel["torchDtype"];
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Invalid python runtime payload: ${field} must be a number.`);
  }

  return value;
}

function asOptionalRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return asObject(value, field);
}

function asOptionalStage(value: unknown, field: string): PythonRuntimeError["stage"] | undefined {
  const stage = asOptionalString(value, field);
  if (!stage) {
    return undefined;
  }

  if (!["normalization", "chunking", "generation", "split"].includes(stage)) {
    throw new Error(`Invalid python runtime payload: ${field} must be a known stage.`);
  }

  return stage as PythonRuntimeError["stage"];
}

function asPythonRuntimeTaskStatus(value: unknown, field: string): PythonRuntimeTaskStatus {
  if (value === undefined || value === null) {
    return "unknown";
  }
  if (typeof value !== "string") {
    return "unknown";
  }
  const status = value.trim().toLowerCase();
  if (status.length === 0) {
    return "unknown";
  }
  return PYTHON_RUNTIME_TASK_STATUS_VALUES.has(status as PythonRuntimeTaskStatus)
    ? (status as PythonRuntimeTaskStatus)
    : "unknown";
}

function parseLoadedModel(value: unknown, field: string): PythonRuntimeLoadedModel {
  const payload = asObject(value, field);
  return {
    provider: "transformers",
    modelId: asString(payload.modelId, `${field}.modelId`),
    inferenceMode: asLoadedModelInferenceMode(payload.inferenceMode, `${field}.inferenceMode`),
    device: asOptionalLoadedModelDevice(payload.device, `${field}.device`),
    torchDtype: asOptionalLoadedModelTorchDtype(payload.torchDtype, `${field}.torchDtype`),
    localPath: asOptionalString(payload.localPath, `${field}.localPath`),
  };
}

function parseLoadedModels(value: unknown, field: string): PythonRuntimeLoadedModel[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid python runtime payload: ${field} must be an array.`);
  }

  return value.map((entry, index) => parseLoadedModel(entry, `${field}[${index}]`));
}

function parseRuntimeError(value: unknown, field: string): PythonRuntimeError | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const payload = asObject(value, field);
  const mappedCode = asOptionalString(payload.code, `${field}.code`)
    ?? asOptionalString(payload.errorCode, `${field}.errorCode`);
  if (!mappedCode) {
    throw new Error(`Invalid python runtime payload: ${field}.code must be a non-empty string.`);
  }

  return {
    code: mappedCode,
    stage: asOptionalStage(payload.stage, `${field}.stage`),
    message: asString(payload.message, `${field}.message`),
    details: asOptionalRecord(payload.details, `${field}.details`),
    retryable: asOptionalBoolean(payload.retryable, `${field}.retryable`),
  };
}

function parseHealthStatus(value: unknown): PythonRuntimeHealthStatus {
  const payload = asObject(value, "health status");
  return {
    runtimeId: asString(payload.runtimeId, "status.runtimeId"),
    status: asPythonRuntimeStatus(payload.status, "status.status"),
    version: asOptionalString(payload.version, "status.version"),
    pythonVersion: asOptionalString(payload.pythonVersion, "status.pythonVersion"),
    workerStartedAt: asOptionalString(payload.workerStartedAt, "status.workerStartedAt"),
    lastHeartbeatAt: asOptionalString(payload.lastHeartbeatAt, "status.lastHeartbeatAt"),
  };
}

function parseCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid python runtime capabilities: capabilities must be an array.");
  }

  return value.map((entry, index) => asString(entry, `capabilities[${index}]`));
}


export function mapStartTaskRequest(
  request: StartPythonRuntimeTaskRequest,
): StartPythonRuntimeTaskRequest {
  return {
    requestId: asString(request.requestId, "request.requestId"),
    taskType: asString(request.taskType, "request.taskType"),
    payload: request.payload,
    timeoutMs: request.timeoutMs,
    metadata: asOptionalRecord(request.metadata, "request.metadata"),
  };
}

export function mapHealthResponseFromHttpPayload(
  payload: unknown,
): PythonRuntimeHealthCheckResult {
  const response = asObject(payload, "health response");
  return {
    healthy: asBoolean(response.healthy, "healthy"),
    status: parseHealthStatus(response.status),
    error: parseRuntimeError(response.error, "error"),
    message: asOptionalString(response.message, "message"),
  };
}

export function mapCapabilitiesResponseFromHttpPayload(
  payload: unknown,
): PythonRuntimeCapabilitiesResult {
  const response = asObject(payload, "capabilities response");
  return {
    runtimeId: asString(response.runtimeId, "runtimeId"),
    capabilities: parseCapabilities(response.capabilities),
  };
}


export function mapStartTaskResponse(payload: unknown): StartPythonRuntimeTaskResult {
  const response = asObject(payload, "start task response");
  const accepted = asBoolean(response.accepted, "accepted");
  if (!accepted) {
    throw new Error("Invalid python runtime payload: accepted must be true.");
  }
  const status = asPythonRuntimeTaskStatus(response.status, "status");
  if (status !== "queued" && status !== "running") {
    throw new Error("Invalid python runtime payload: start status must be queued or running.");
  }
  return {
    requestId: asString(response.requestId, "requestId"),
    taskType: asString(response.taskType, "taskType"),
    accepted,
    status,
    startedAt: asOptionalString(response.startedAt, "startedAt"),
    updatedAt: asOptionalString(response.updatedAt, "updatedAt"),
    metadata: asOptionalRecord(response.metadata, "metadata"),
  };
}

export function mapTaskStatusResponse(payload: unknown): PythonRuntimeTaskStatusResult {
  const response = asObject(payload, "task status response");
  return {
    requestId: asString(response.requestId, "requestId"),
    taskType: asOptionalString(response.taskType, "taskType"),
    status: asPythonRuntimeTaskStatus(response.status, "status"),
    progress: asOptionalRecord(response.progress, "progress"),
    data: response.data,
    error: parseRuntimeError(response.error, "error"),
    startedAt: asOptionalString(response.startedAt, "startedAt"),
    updatedAt: asOptionalString(response.updatedAt, "updatedAt"),
    completedAt: asOptionalString(response.completedAt, "completedAt"),
    metadata: asOptionalRecord(response.metadata, "metadata"),
  };
}

export function mapCancelTaskResponse(payload: unknown): CancelPythonRuntimeTaskResult {
  const response = asObject(payload, "cancel task response");
  return {
    requestId: asString(response.requestId, "requestId"),
    taskType: asOptionalString(response.taskType, "taskType"),
    status: asPythonRuntimeTaskStatus(response.status, "status"),
    cancelled: asBoolean(response.cancelled, "cancelled"),
    message: asOptionalString(response.message, "message"),
    metadata: asOptionalRecord(response.metadata, "metadata"),
  };
}

export function mapModelStatusResponseFromHttpPayload(
  payload: unknown,
): PythonRuntimeModelStatusResult {
  const response = asObject(payload, "model status response");
  return {
    loadedModels: parseLoadedModels(response.loadedModels, "loadedModels"),
    activeTaskCount: asNumber(response.activeTaskCount, "activeTaskCount"),
  };
}

export function mapUnloadModelsResponseFromHttpPayload(
  payload: unknown,
): PythonRuntimeUnloadModelsResult {
  const response = asObject(payload, "unload models response");
  return {
    unloadedModels: parseLoadedModels(response.unloadedModels, "unloadedModels"),
    activeTaskCount: asNumber(response.activeTaskCount, "activeTaskCount"),
  };
}
