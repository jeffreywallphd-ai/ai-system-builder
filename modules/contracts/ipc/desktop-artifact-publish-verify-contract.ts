import { API_ARTIFACT_PUBLISH_VERIFY_OPERATION } from "../api";
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
import type { DesktopArtifactPublishSuccessValue } from "./desktop-artifact-publish-contract";

export const DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION = API_ARTIFACT_PUBLISH_VERIFY_OPERATION;

export const DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  "response",
);

export interface DesktopArtifactPublishVerifyBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactPublishVerifyRequestPayload {
  artifactId: string;
  boundary: DesktopArtifactPublishVerifyBoundaryContext;
}

export type DesktopArtifactPublishVerifyRequest = IpcRequest<
  DesktopArtifactPublishVerifyRequestPayload,
  typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL.value
>;

export type DesktopArtifactPublishVerifyResponse = IpcResponse<
  DesktopArtifactPublishSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

export function createDesktopArtifactPublishVerifyRequest(
  payload: DesktopArtifactPublishVerifyRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactPublishVerifyRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL,
    {
      artifactId: normalizeRequiredTextField(payload.artifactId, "artifactId"),
      boundary: {
        host: "desktop",
        source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
      },
    },
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createDesktopArtifactPublishVerifySuccessResponse(
  value: DesktopArtifactPublishSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactPublishVerifyResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL,
    value,
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function getDesktopArtifactPublishVerifyChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION, "request">
>;
export function getDesktopArtifactPublishVerifyChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION, "response">
>;
export function getDesktopArtifactPublishVerifyChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL
    : DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL;
}
