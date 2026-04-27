import {
  ARTIFACT_UPLOAD_OPERATION,
  ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  type ArtifactUploadAcceptedTypePolicy,
} from "../artifact-upload";
import {
  normalizeStagedArtifactDescriptor,
  type StagedArtifactDescriptor,
  type StagedArtifactMetadata,
} from "../ingestion";
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

export const DESKTOP_ARTIFACT_UPLOAD_OPERATION = ARTIFACT_UPLOAD_OPERATION;
export const DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_OPERATION = ARTIFACT_UPLOAD_POLICY_READ_OPERATION;

export const DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  "response",
);

export const DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  "request",
);

export const DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  "response",
);

export interface DesktopArtifactUploadBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopArtifactUploadRequestPayload {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
  boundary: DesktopArtifactUploadBoundaryContext;
}

export interface DesktopArtifactUploadSuccessValue<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
> {
  descriptor: StagedArtifactDescriptor<TMetadata>;
}

export interface DesktopArtifactUploadPolicyReadRequestPayload {
  boundary: DesktopArtifactUploadBoundaryContext;
}

export interface DesktopArtifactUploadPolicyReadSuccessValue {
  policy: ArtifactUploadAcceptedTypePolicy;
}

export type DesktopArtifactUploadRequest = IpcRequest<
  DesktopArtifactUploadRequestPayload,
  typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value
>;

export type DesktopArtifactUploadResponse<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
> = IpcResponse<
  DesktopArtifactUploadSuccessValue<TMetadata>,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL.value
>;

export type DesktopArtifactUploadPolicyReadRequest = IpcRequest<
  DesktopArtifactUploadPolicyReadRequestPayload,
  typeof DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL.value
>;

export type DesktopArtifactUploadPolicyReadResponse = IpcResponse<
  DesktopArtifactUploadPolicyReadSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeDesktopArtifactUploadPayload(
  payload: DesktopArtifactUploadRequestPayload,
): DesktopArtifactUploadRequestPayload {
  if (payload.bytes.length === 0) {
    throw new Error("bytes must contain at least one byte.");
  }

  return {
    fileName: normalizeRequiredTextField(payload.fileName, "fileName"),
    mediaType: normalizeRequiredTextField(payload.mediaType, "mediaType"),
    bytes: payload.bytes,
    boundary: {
      host: "desktop",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createDesktopArtifactUploadRequest(
  payload: DesktopArtifactUploadRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactUploadRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
    normalizeDesktopArtifactUploadPayload(payload),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createDesktopArtifactUploadSuccessResponse<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
>(
  descriptor: StagedArtifactDescriptor<TMetadata>,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactUploadResponse<TMetadata> {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL,
    {
      descriptor: normalizeStagedArtifactDescriptor(descriptor),
    },
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createDesktopArtifactUploadPolicyReadRequest(
  payload: DesktopArtifactUploadPolicyReadRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactUploadPolicyReadRequest {
  return createIpcRequest(
    DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL,
    {
      boundary: {
        host: "desktop",
        source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
      },
    },
    options,
  );
}

export function createDesktopArtifactUploadPolicyReadSuccessResponse(
  policy: ArtifactUploadAcceptedTypePolicy,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopArtifactUploadPolicyReadResponse {
  return createIpcSuccessResponse(
    DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_RESPONSE_CHANNEL,
    { policy },
    options,
  );
}

export function isDesktopArtifactUploadRequestChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  "request"
> {
  return value === DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value;
}

export function isDesktopArtifactUploadResponseChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  "response"
> {
  return value === DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL.value;
}

export function getDesktopArtifactUploadChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION, "request">
>;
export function getDesktopArtifactUploadChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION, "response">
>;
export function getDesktopArtifactUploadChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_ARTIFACT_UPLOAD_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL
    : DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL;
}
