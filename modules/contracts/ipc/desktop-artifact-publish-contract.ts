import { API_ARTIFACT_PUBLISH_OPERATION } from "../api";
import { createWorkspaceId } from "../workspace";
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

export const DESKTOP_ARTIFACT_PUBLISH_OPERATION = API_ARTIFACT_PUBLISH_OPERATION;

export const DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  "response",
);

export interface DesktopArtifactPublishBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactPublishRequestPayload {
  workspaceId: string;
  artifactId: string;
  target: {
    provider: string;
    repository: string;
    revision?: string;
    path: string;
  };
  mediaType?: string;
  verify?: boolean;
  repositoryCreation?: {
    approved: true;
    visibility: "private" | "public";
  };
  boundary: DesktopArtifactPublishBoundaryContext;
}

export interface DesktopArtifactPublishSuccessValue {
  target: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator: string;
  };
  verification: {
    exists: boolean;
    verifiedAt?: string;
  };
}

export type DesktopArtifactPublishRequest = IpcRequest<
  DesktopArtifactPublishRequestPayload,
  typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value
>;

export type DesktopArtifactPublishResponse = IpcResponse<
  DesktopArtifactPublishSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeDesktopArtifactPublishPayload(
  payload: DesktopArtifactPublishRequestPayload,
): DesktopArtifactPublishRequestPayload {
  return {
    workspaceId: createWorkspaceId(payload.workspaceId),
    artifactId: normalizeRequiredTextField(payload.artifactId, "artifactId"),
    target: {
      provider: normalizeRequiredTextField(payload.target.provider, "target.provider"),
      repository: normalizeRequiredTextField(payload.target.repository, "target.repository"),
      revision: payload.target.revision?.trim() || undefined,
      path: normalizeRequiredTextField(payload.target.path, "target.path"),
    },
    mediaType: payload.mediaType?.trim() || undefined,
    verify: payload.verify ?? true,
    repositoryCreation: normalizeRepositoryCreation(payload.repositoryCreation),
    boundary: {
      host: "desktop",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

function normalizeRepositoryCreation(
  value: DesktopArtifactPublishRequestPayload["repositoryCreation"],
): DesktopArtifactPublishRequestPayload["repositoryCreation"] {
  if (!value) return undefined;
  if (value.approved !== true) {
    throw new Error("repositoryCreation.approved must be true when repository creation is requested.");
  }
  if (value.visibility !== "private" && value.visibility !== "public") {
    throw new Error("repositoryCreation.visibility must be private or public.");
  }
  return { approved: true, visibility: value.visibility };
}

export function createDesktopArtifactPublishRequest(
  payload: DesktopArtifactPublishRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactPublishRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL,
    normalizeDesktopArtifactPublishPayload(payload),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createDesktopArtifactPublishSuccessResponse(
  value: DesktopArtifactPublishSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactPublishResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL,
    {
      target: {
        provider: normalizeRequiredTextField(value.target.provider, "target.provider"),
        repository: normalizeRequiredTextField(value.target.repository, "target.repository"),
        path: normalizeRequiredTextField(value.target.path, "target.path"),
        revision: value.target.revision?.trim() || undefined,
        locator: normalizeRequiredTextField(value.target.locator, "target.locator"),
      },
      verification: {
        exists: value.verification.exists,
        verifiedAt: value.verification.verifiedAt?.trim() || undefined,
      },
    },
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function isDesktopArtifactPublishRequestChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  "request"
> {
  return value === DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value;
}

export function isDesktopArtifactPublishResponseChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  "response"
> {
  return value === DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL.value;
}

export function getDesktopArtifactPublishChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION, "request">
>;
export function getDesktopArtifactPublishChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION, "response">
>;
export function getDesktopArtifactPublishChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_PUBLISH_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL
    : DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL;
}
