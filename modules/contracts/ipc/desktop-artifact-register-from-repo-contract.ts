import {
  API_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
} from "../api/artifact-register-from-repo-api-contract";
import { createIpcChannel, type IpcChannel, type IpcChannelValue } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION = API_ARTIFACT_REGISTER_FROM_REPO_OPERATION;

export const DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  "response",
);

export interface DesktopArtifactRegisterFromRepoBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactRegisterFromRepoRequestPayload {
  target: {
    provider: string;
    repository: string;
    revision?: string;
    path: string;
  };
  artifactFamily?: string;
  mediaType?: string;
  boundary: DesktopArtifactRegisterFromRepoBoundaryContext;
}

export interface DesktopArtifactRegisterFromRepoSuccessValue {
  artifactId: string;
  backing: {
    role: "imported-source";
    target: {
      provider: string;
      repository: string;
      path: string;
      revision: string;
      locator: string;
    };
    verification: {
      exists: true;
      verifiedAt: string;
    };
  };
}

export type DesktopArtifactRegisterFromRepoRequest = IpcRequest<
  DesktopArtifactRegisterFromRepoRequestPayload,
  typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value
>;

export type DesktopArtifactRegisterFromRepoResponse = IpcResponse<
  DesktopArtifactRegisterFromRepoSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizePayload(
  payload: DesktopArtifactRegisterFromRepoRequestPayload,
): DesktopArtifactRegisterFromRepoRequestPayload {
  return {
    target: {
      provider: normalizeRequiredTextField(payload.target.provider, "target.provider"),
      repository: normalizeRequiredTextField(payload.target.repository, "target.repository"),
      revision: payload.target.revision?.trim() || undefined,
      path: normalizeRequiredTextField(payload.target.path, "target.path"),
    },
    artifactFamily: payload.artifactFamily,
    mediaType: payload.mediaType?.trim() || undefined,
    boundary: {
      host: "desktop",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createDesktopArtifactRegisterFromRepoRequest(
  payload: DesktopArtifactRegisterFromRepoRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactRegisterFromRepoRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL,
    normalizePayload(payload),
    options,
  );
}

export function createDesktopArtifactRegisterFromRepoSuccessResponse(
  value: DesktopArtifactRegisterFromRepoSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactRegisterFromRepoResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL,
    value,
    options,
  );
}

export function isDesktopArtifactRegisterFromRepoRequestChannel(
  value: string,
): value is IpcChannelValue<typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION, "request"> {
  return value === DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value;
}

export function isDesktopArtifactRegisterFromRepoResponseChannel(
  value: string,
): value is IpcChannelValue<typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION, "response"> {
  return value === DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL.value;
}

export function getDesktopArtifactRegisterFromRepoChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION, "request">
>;
export function getDesktopArtifactRegisterFromRepoChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION, "response">
>;
export function getDesktopArtifactRegisterFromRepoChannel(
  kind: "request" | "response",
) {
  return kind === "request"
    ? DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL
    : DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL;
}
