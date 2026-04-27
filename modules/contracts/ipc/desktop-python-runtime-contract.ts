import { createTransportOperation } from "../transport";
import { createIpcChannel, type IpcChannel, type IpcChannelValue } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION = createTransportOperation(
  "runtime",
  "python-status-read",
);

export const DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION = createTransportOperation(
  "runtime",
  "python-control",
);

export const DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
  "request",
);

export const DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
  "response",
);

export const DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
  "request",
);

export const DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
  "response",
);

export type DesktopPythonRuntimeSupervisorStatus = "stopped" | "starting" | "ready" | "failed";

export interface DesktopPythonRuntimeLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface DesktopPythonRuntimeLoadedModel {
  provider: "transformers";
  modelId: string;
  inferenceMode: "text2text" | "causal" | "chat";
  device?: "cpu" | "cuda" | "auto";
  torchDtype?: "auto" | "float16" | "bfloat16" | "float32";
  localPath?: string;
}

export interface DesktopPythonRuntimeStatusPayload {
  supervisorStatus: DesktopPythonRuntimeSupervisorStatus;
  healthy: boolean;
  runtimeStatus: string;
  capabilities: string[];
  logs: DesktopPythonRuntimeLogEntry[];
  loadedModels?: DesktopPythonRuntimeLoadedModel[];
  activeTaskCount?: number;
}

export interface DesktopPythonRuntimeBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopPythonRuntimeStatusReadRequestPayload {
  boundary: DesktopPythonRuntimeBoundaryContext;
}

export interface DesktopPythonRuntimeControlRequestPayload {
  action: "start" | "stop" | "restart" | "unload-model";
  boundary: DesktopPythonRuntimeBoundaryContext;
}

export type DesktopPythonRuntimeStatusReadRequest = IpcRequest<
  DesktopPythonRuntimeStatusReadRequestPayload,
  typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL.value
>;

export type DesktopPythonRuntimeControlRequest = IpcRequest<
  DesktopPythonRuntimeControlRequestPayload,
  typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
  Record<string, never>,
  typeof DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL.value
>;

export type DesktopPythonRuntimeStatusReadResponse = IpcResponse<
  DesktopPythonRuntimeStatusPayload,
  Record<string, unknown>,
  typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL.value
>;

export type DesktopPythonRuntimeControlResponse = IpcResponse<
  DesktopPythonRuntimeStatusPayload,
  Record<string, unknown>,
  typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
  Record<string, never>,
  typeof DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeBoundary(
  boundary: DesktopPythonRuntimeBoundaryContext,
): DesktopPythonRuntimeBoundaryContext {
  return {
    host: "desktop",
    source: normalizeRequiredTextField(boundary.source, "boundary.source"),
  };
}

function normalizeStatusPayload(
  payload: DesktopPythonRuntimeStatusPayload,
): DesktopPythonRuntimeStatusPayload {
  return {
    supervisorStatus: payload.supervisorStatus,
    healthy: payload.healthy,
    runtimeStatus: payload.runtimeStatus.trim(),
    capabilities: payload.capabilities.map((capability) => capability.trim()).filter((capability) => capability.length > 0),
    logs: payload.logs.map((log) => ({
      timestamp: log.timestamp,
      level: log.level,
      message: log.message.trim(),
    })),
    loadedModels: (payload.loadedModels ?? []).map((model) => ({
      provider: model.provider,
      modelId: model.modelId.trim(),
      inferenceMode: model.inferenceMode,
      device: model.device,
      torchDtype: model.torchDtype,
      localPath: model.localPath?.trim(),
    })),
    activeTaskCount: payload.activeTaskCount ?? 0,
  };
}

export function createDesktopPythonRuntimeStatusReadRequest(
  payload: DesktopPythonRuntimeStatusReadRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopPythonRuntimeStatusReadRequest {
  return createIpcRequest(
    DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL,
    {
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopPythonRuntimeControlRequest(
  payload: DesktopPythonRuntimeControlRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopPythonRuntimeControlRequest {
  return createIpcRequest(
    DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL,
    {
      action: payload.action,
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopPythonRuntimeStatusReadSuccessResponse(
  payload: DesktopPythonRuntimeStatusPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopPythonRuntimeStatusReadResponse {
  return createIpcSuccessResponse(
    DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL,
    normalizeStatusPayload(payload),
    options,
  );
}

export function createDesktopPythonRuntimeControlSuccessResponse(
  payload: DesktopPythonRuntimeStatusPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopPythonRuntimeControlResponse {
  return createIpcSuccessResponse(
    DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL,
    normalizeStatusPayload(payload),
    options,
  );
}

export function getDesktopPythonRuntimeStatusReadChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION, "request">
>;
export function getDesktopPythonRuntimeStatusReadChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION, "response">
>;
export function getDesktopPythonRuntimeStatusReadChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL
    : DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL;
}

export function getDesktopPythonRuntimeControlChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION, "request">
>;
export function getDesktopPythonRuntimeControlChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION, "response">
>;
export function getDesktopPythonRuntimeControlChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL
    : DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL;
}
