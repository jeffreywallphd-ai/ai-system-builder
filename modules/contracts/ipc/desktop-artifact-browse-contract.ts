import {
  ARTIFACT_BROWSE_OPERATION,
  normalizeArtifactBrowseSuccessValue,
  type ArtifactBrowseSuccessValue,
} from "../artifact-browser";
import type { ArtifactFamily } from "../../domain/artifact";
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

export const DESKTOP_ARTIFACT_BROWSE_OPERATION = ARTIFACT_BROWSE_OPERATION;

export const DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_BROWSE_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_BROWSE_OPERATION,
  "response",
);

export interface DesktopArtifactBrowseBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactBrowseRequestPayload {
  artifactFamily?: ArtifactFamily;
  boundary: DesktopArtifactBrowseBoundaryContext;
}

export type DesktopArtifactBrowseSuccessValue = ArtifactBrowseSuccessValue;

export type DesktopArtifactBrowseRequest = IpcRequest<
  DesktopArtifactBrowseRequestPayload,
  typeof DESKTOP_ARTIFACT_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value
>;

export type DesktopArtifactBrowseResponse = IpcResponse<
  DesktopArtifactBrowseSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeDesktopArtifactBrowsePayload(
  payload: DesktopArtifactBrowseRequestPayload,
): DesktopArtifactBrowseRequestPayload {
  return {
    artifactFamily: payload.artifactFamily,
    boundary: {
      host: "desktop",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createDesktopArtifactBrowseRequest(
  payload: DesktopArtifactBrowseRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactBrowseRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
    normalizeDesktopArtifactBrowsePayload(payload),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createDesktopArtifactBrowseSuccessResponse(
  browse: ArtifactBrowseSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactBrowseResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL,
    normalizeArtifactBrowseSuccessValue(browse),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function isDesktopArtifactBrowseRequestChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_ARTIFACT_BROWSE_OPERATION,
  "request"
> {
  return value === DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value;
}

export function isDesktopArtifactBrowseResponseChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_ARTIFACT_BROWSE_OPERATION,
  "response"
> {
  return value === DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL.value;
}

export function getDesktopArtifactBrowseChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_BROWSE_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_BROWSE_OPERATION, "request">
>;
export function getDesktopArtifactBrowseChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_BROWSE_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_BROWSE_OPERATION, "response">
>;
export function getDesktopArtifactBrowseChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_BROWSE_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_BROWSE_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_BROWSE_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_BROWSE_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL
    : DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL;
}
