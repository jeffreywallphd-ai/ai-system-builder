import { createOperationIdentity, type OperationIdentity } from "../shared";
import {
  createIpcChannel,
  type IpcChannel,
  type IpcChannelValue,
} from "./ipc-channel";
import {
  createIpcRequest,
  type IpcRequest,
} from "./ipc-request";
import {
  createIpcSuccessResponse,
  type IpcResponse,
} from "./ipc-response";

export const DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION: OperationIdentity = createOperationIdentity("artifact", "media", "view");

export const DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
  "response",
);

export interface DesktopArtifactMediaViewBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactMediaViewRequestPayload {
  storageKey: string;
  boundary: DesktopArtifactMediaViewBoundaryContext;
}

export interface DesktopArtifactMediaViewSuccessValue {
  storageKey: string;
  mediaType?: string;
  sizeBytes?: number;
  bytes: Uint8Array;
}

export type DesktopArtifactMediaViewRequest = IpcRequest<
  DesktopArtifactMediaViewRequestPayload,
  typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL.value
>;

export type DesktopArtifactMediaViewResponse = IpcResponse<
  DesktopArtifactMediaViewSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeDesktopArtifactMediaViewPayload(
  payload: DesktopArtifactMediaViewRequestPayload,
): DesktopArtifactMediaViewRequestPayload {
  return {
    storageKey: normalizeRequiredTextField(payload.storageKey, "storageKey"),
    boundary: {
      host: "desktop",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createDesktopArtifactMediaViewRequest(
  payload: DesktopArtifactMediaViewRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactMediaViewRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL,
    normalizeDesktopArtifactMediaViewPayload(payload),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createDesktopArtifactMediaViewSuccessResponse(
  value: DesktopArtifactMediaViewSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactMediaViewResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL,
    {
      ...value,
      storageKey: normalizeRequiredTextField(value.storageKey, "storageKey"),
      mediaType: value.mediaType?.trim() || undefined,
    },
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function getDesktopArtifactMediaViewChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION, "request">
>;
export function getDesktopArtifactMediaViewChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION, "response">
>;
export function getDesktopArtifactMediaViewChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL
    : DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL;
}
