import type {
  RuntimeCapabilityId,
  RuntimeCapabilityStatus,
  RuntimeReadinessSnapshot,
} from "../runtime";
import { normalizeRuntimeCapabilityId } from "../runtime";
import { createTransportOperation } from "../transport";
import { createIpcChannel, type IpcChannel, type IpcChannelValue } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_RUNTIME_READINESS_READ_OPERATION = createTransportOperation(
  "runtime",
  "readiness-read",
);

export const DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION = createTransportOperation(
  "runtime",
  "capability-status-read",
);

export const DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_RUNTIME_READINESS_READ_OPERATION,
  "request",
);

export const DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_RUNTIME_READINESS_READ_OPERATION,
  "response",
);

export const DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  "request",
);

export const DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  "response",
);

export interface DesktopRuntimeReadinessBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopRuntimeReadinessReadRequestPayload {
  boundary: DesktopRuntimeReadinessBoundaryContext;
}

export interface DesktopRuntimeCapabilityStatusReadRequestPayload {
  capabilityId: RuntimeCapabilityId;
  boundary: DesktopRuntimeReadinessBoundaryContext;
}

export type DesktopRuntimeReadinessReadRequest = IpcRequest<
  DesktopRuntimeReadinessReadRequestPayload,
  typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL.value
>;

export type DesktopRuntimeCapabilityStatusReadRequest = IpcRequest<
  DesktopRuntimeCapabilityStatusReadRequestPayload,
  typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL.value
>;

export type DesktopRuntimeReadinessReadResponse = IpcResponse<
  RuntimeReadinessSnapshot,
  Record<string, unknown>,
  typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL.value
>;

export type DesktopRuntimeCapabilityStatusReadResponse = IpcResponse<
  RuntimeCapabilityStatus,
  Record<string, unknown>,
  typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeBoundary(
  boundary: DesktopRuntimeReadinessBoundaryContext,
): DesktopRuntimeReadinessBoundaryContext {
  return {
    host: "desktop",
    source: normalizeRequiredTextField(boundary.source, "boundary.source"),
  };
}

export function createDesktopRuntimeReadinessReadRequest(
  payload: DesktopRuntimeReadinessReadRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopRuntimeReadinessReadRequest {
  return createIpcRequest(
    DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL,
    {
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopRuntimeCapabilityStatusReadRequest(
  payload: DesktopRuntimeCapabilityStatusReadRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopRuntimeCapabilityStatusReadRequest {
  return createIpcRequest(
    DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL,
    {
      capabilityId: normalizeRuntimeCapabilityId(payload.capabilityId),
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopRuntimeReadinessReadSuccessResponse(
  payload: RuntimeReadinessSnapshot,
  options?: { requestId?: string; correlationId?: string },
): DesktopRuntimeReadinessReadResponse {
  return createIpcSuccessResponse(
    DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL,
    payload,
    options,
  );
}

export function createDesktopRuntimeCapabilityStatusReadSuccessResponse(
  payload: RuntimeCapabilityStatus,
  options?: { requestId?: string; correlationId?: string },
): DesktopRuntimeCapabilityStatusReadResponse {
  return createIpcSuccessResponse(
    DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL,
    payload,
    options,
  );
}

export function getDesktopRuntimeReadinessReadChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION, "request">
>;
export function getDesktopRuntimeReadinessReadChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION, "response">
>;
export function getDesktopRuntimeReadinessReadChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_RUNTIME_READINESS_READ_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL
    : DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL;
}

export function getDesktopRuntimeCapabilityStatusReadChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION, "request">
>;
export function getDesktopRuntimeCapabilityStatusReadChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION, "response">
>;
export function getDesktopRuntimeCapabilityStatusReadChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL
    : DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL;
}
