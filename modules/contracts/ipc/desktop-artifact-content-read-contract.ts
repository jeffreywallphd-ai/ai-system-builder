import { createWorkspaceId } from "../workspace";
import {
  ARTIFACT_CONTENT_READ_OPERATION,
  normalizeArtifactBrowserLocator,
  normalizeArtifactContentReadSuccessValue,
  type ArtifactBrowserLocator,
  type ArtifactContentReadSuccessValue,
} from "../artifact-browser";
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

export const DESKTOP_ARTIFACT_CONTENT_READ_OPERATION = ARTIFACT_CONTENT_READ_OPERATION;

export const DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  "response",
);

export interface DesktopArtifactContentReadBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactContentReadRequestPayload {
  locator: ArtifactBrowserLocator;
  workspaceId: string;
  boundary: DesktopArtifactContentReadBoundaryContext;
}

export type DesktopArtifactContentReadSuccessValue = ArtifactContentReadSuccessValue;

export type DesktopArtifactContentReadRequest = IpcRequest<
  DesktopArtifactContentReadRequestPayload,
  typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL.value
>;

export type DesktopArtifactContentReadResponse = IpcResponse<
  DesktopArtifactContentReadSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeDesktopArtifactContentReadPayload(
  payload: DesktopArtifactContentReadRequestPayload,
): DesktopArtifactContentReadRequestPayload {
  return {
    locator: normalizeArtifactBrowserLocator(payload.locator),
    workspaceId: createWorkspaceId(payload.workspaceId),
    boundary: {
      host: "desktop",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createDesktopArtifactContentReadRequest(
  payload: DesktopArtifactContentReadRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactContentReadRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL,
    normalizeDesktopArtifactContentReadPayload(payload),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createDesktopArtifactContentReadSuccessResponse(
  value: ArtifactContentReadSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactContentReadResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL,
    normalizeArtifactContentReadSuccessValue(value),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function isDesktopArtifactContentReadRequestChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  "request"
> {
  return value === DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL.value;
}

export function isDesktopArtifactContentReadResponseChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  "response"
> {
  return value === DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL.value;
}

export function getDesktopArtifactContentReadChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION, "request">
>;
export function getDesktopArtifactContentReadChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION, "response">
>;
export function getDesktopArtifactContentReadChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_CONTENT_READ_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL
    : DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL;
}
