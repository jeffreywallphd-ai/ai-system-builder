import {
  API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
} from "../api/artifact-localize-from-repo-api-contract";
import { createIpcChannel, type IpcChannel, type IpcChannelValue } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION = API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION;

export const DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  "response",
);

export interface DesktopArtifactLocalizeFromRepoBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactLocalizeFromRepoRequestPayload {
  artifactId: string;
  boundary: DesktopArtifactLocalizeFromRepoBoundaryContext;
}

export interface DesktopArtifactLocalizeFromRepoSuccessValue {
  artifactId: string;
  localObject: {
    key: string;
    mediaType?: string;
    sizeBytes: number;
  };
  source: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator: string;
  };
  localizedAt: string;
}

export type DesktopArtifactLocalizeFromRepoRequest = IpcRequest<
  DesktopArtifactLocalizeFromRepoRequestPayload,
  typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value
>;

export type DesktopArtifactLocalizeFromRepoResponse = IpcResponse<
  DesktopArtifactLocalizeFromRepoSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizePayload(
  payload: DesktopArtifactLocalizeFromRepoRequestPayload,
): DesktopArtifactLocalizeFromRepoRequestPayload {
  return {
    artifactId: normalizeRequiredTextField(payload.artifactId, "artifactId"),
    boundary: {
      host: "desktop",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createDesktopArtifactLocalizeFromRepoRequest(
  payload: DesktopArtifactLocalizeFromRepoRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactLocalizeFromRepoRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL,
    normalizePayload(payload),
    options,
  );
}

export function createDesktopArtifactLocalizeFromRepoSuccessResponse(
  value: DesktopArtifactLocalizeFromRepoSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactLocalizeFromRepoResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL,
    value,
    options,
  );
}

export function isDesktopArtifactLocalizeFromRepoRequestChannel(
  value: string,
): value is IpcChannelValue<typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION, "request"> {
  return value === DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value;
}

export function isDesktopArtifactLocalizeFromRepoResponseChannel(
  value: string,
): value is IpcChannelValue<typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION, "response"> {
  return value === DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL.value;
}

export function getDesktopArtifactLocalizeFromRepoChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION, "request">
>;
export function getDesktopArtifactLocalizeFromRepoChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION, "response">
>;
export function getDesktopArtifactLocalizeFromRepoChannel(
  kind: "request" | "response",
) {
  return kind === "request"
    ? DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL
    : DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL;
}
