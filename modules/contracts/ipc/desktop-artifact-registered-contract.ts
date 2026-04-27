import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_ARTIFACT_REGISTERED_DELETE_OPERATION = createTransportOperation(
  "artifact",
  "registered",
  "delete",
);

export const DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_REGISTERED_DELETE_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_REGISTERED_DELETE_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_REGISTERED_DELETE_OPERATION,
  "response",
);

interface DesktopArtifactBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactRegisteredDeleteRequestPayload {
  storageKey: string;
  boundary: DesktopArtifactBoundaryContext;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} must be non-empty.`);
  }

  return normalized;
}

export type DesktopArtifactRegisteredDeleteRequest = IpcRequest<
  DesktopArtifactRegisteredDeleteRequestPayload,
  typeof DESKTOP_ARTIFACT_REGISTERED_DELETE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL.value
>;

export type DesktopArtifactRegisteredDeleteResponse = IpcResponse<
  { storageKey: string },
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_REGISTERED_DELETE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_REGISTERED_DELETE_RESPONSE_CHANNEL.value
>;

export function createDesktopArtifactRegisteredDeleteRequest(
  payload: DesktopArtifactRegisteredDeleteRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopArtifactRegisteredDeleteRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL,
    {
      storageKey: normalizeRequiredText(payload.storageKey, "storageKey"),
      boundary: {
        host: "desktop",
        source: normalizeRequiredText(payload.boundary.source, "boundary.source"),
      },
    },
    options,
  );
}

export function createDesktopArtifactRegisteredDeleteSuccessResponse(
  value: { storageKey: string },
  options?: { requestId?: string; correlationId?: string },
): DesktopArtifactRegisteredDeleteResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_REGISTERED_DELETE_RESPONSE_CHANNEL,
    { storageKey: normalizeRequiredText(value.storageKey, "storageKey") },
    options,
  );
}
