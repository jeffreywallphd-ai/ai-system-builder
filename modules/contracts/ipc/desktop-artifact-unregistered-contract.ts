import {
  type RegisterUnregisteredArtifactSuccessValue,
  type UnregisteredArtifactBrowseSuccessValue,
  normalizeUnregisteredArtifactBrowseSuccessValue,
} from "../artifact-browser";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_OPERATION = createTransportOperation(
  "artifact",
  "unregistered",
  "browse",
);
export const DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_OPERATION = createTransportOperation(
  "artifact",
  "unregistered",
  "register",
);
export const DESKTOP_ARTIFACT_UNREGISTERED_DELETE_OPERATION = createTransportOperation(
  "artifact",
  "unregistered",
  "delete",
);

export const DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_OPERATION,
  "request",
);
export const DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_OPERATION,
  "response",
);
export const DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_OPERATION,
  "request",
);
export const DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_OPERATION,
  "response",
);
export const DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_OPERATION,
  "request",
);
export const DESKTOP_ARTIFACT_UNREGISTERED_DELETE_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_OPERATION,
  "response",
);

interface DesktopArtifactBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactUnregisteredBrowseRequestPayload {
  boundary: DesktopArtifactBoundaryContext;
}

export interface DesktopArtifactUnregisteredMutationRequestPayload {
  storageKey: string;
  boundary: DesktopArtifactBoundaryContext;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }
  return normalized;
}

function normalizeBoundary(boundary: DesktopArtifactBoundaryContext): DesktopArtifactBoundaryContext {
  return {
    host: "desktop",
    source: normalizeRequiredText(boundary.source, "boundary.source"),
  };
}

export type DesktopArtifactUnregisteredBrowseRequest = IpcRequest<
  DesktopArtifactUnregisteredBrowseRequestPayload,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL.value
>;
export type DesktopArtifactUnregisteredBrowseResponse = IpcResponse<
  UnregisteredArtifactBrowseSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_RESPONSE_CHANNEL.value
>;

export function createDesktopArtifactUnregisteredBrowseRequest(
  payload: DesktopArtifactUnregisteredBrowseRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopArtifactUnregisteredBrowseRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL,
    {
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopArtifactUnregisteredBrowseSuccessResponse(
  value: UnregisteredArtifactBrowseSuccessValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopArtifactUnregisteredBrowseResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_RESPONSE_CHANNEL,
    normalizeUnregisteredArtifactBrowseSuccessValue(value),
    options,
  );
}

export type DesktopArtifactUnregisteredRegisterRequest = IpcRequest<
  DesktopArtifactUnregisteredMutationRequestPayload,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL.value
>;
export type DesktopArtifactUnregisteredRegisterResponse = IpcResponse<
  RegisterUnregisteredArtifactSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_RESPONSE_CHANNEL.value
>;

export function createDesktopArtifactUnregisteredRegisterRequest(
  payload: DesktopArtifactUnregisteredMutationRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopArtifactUnregisteredRegisterRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL,
    {
      storageKey: normalizeRequiredText(payload.storageKey, "storageKey"),
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopArtifactUnregisteredRegisterSuccessResponse(
  value: RegisterUnregisteredArtifactSuccessValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopArtifactUnregisteredRegisterResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_RESPONSE_CHANNEL,
    { storageKey: normalizeRequiredText(value.storageKey, "storageKey") },
    options,
  );
}

export type DesktopArtifactUnregisteredDeleteRequest = IpcRequest<
  DesktopArtifactUnregisteredMutationRequestPayload,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_DELETE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL.value
>;
export type DesktopArtifactUnregisteredDeleteResponse = IpcResponse<
  { storageKey: string },
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_DELETE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UNREGISTERED_DELETE_RESPONSE_CHANNEL.value
>;

export function createDesktopArtifactUnregisteredDeleteRequest(
  payload: DesktopArtifactUnregisteredMutationRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopArtifactUnregisteredDeleteRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL,
    {
      storageKey: normalizeRequiredText(payload.storageKey, "storageKey"),
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopArtifactUnregisteredDeleteSuccessResponse(
  value: { storageKey: string },
  options?: { requestId?: string; correlationId?: string },
): DesktopArtifactUnregisteredDeleteResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_UNREGISTERED_DELETE_RESPONSE_CHANNEL,
    { storageKey: normalizeRequiredText(value.storageKey, "storageKey") },
    options,
  );
}
