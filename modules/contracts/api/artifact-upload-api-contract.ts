import { createWorkspaceId } from "../workspace";
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
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_ARTIFACT_UPLOAD_OPERATION = ARTIFACT_UPLOAD_OPERATION;
export const API_ARTIFACT_UPLOAD_POLICY_READ_OPERATION = ARTIFACT_UPLOAD_POLICY_READ_OPERATION;

export interface ApiArtifactUploadBoundaryContext {
  host: "server";
  source: string;
}

export interface ApiArtifactUploadRequestPayload {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
  workspaceId: string;
  boundary: ApiArtifactUploadBoundaryContext;
}

export interface ApiArtifactUploadSuccessValue<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
> {
  descriptor: StagedArtifactDescriptor<TMetadata>;
}

export interface ApiArtifactUploadPolicyReadRequestPayload {
  boundary: ApiArtifactUploadBoundaryContext;
}

export interface ApiArtifactUploadPolicyReadSuccessValue {
  policy: ArtifactUploadAcceptedTypePolicy;
}

export type ApiArtifactUploadRequest = ApiRequest<
  ApiArtifactUploadRequestPayload,
  typeof API_ARTIFACT_UPLOAD_OPERATION,
  Record<string, never>
>;

export type ApiArtifactUploadResponse<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
> = ApiResponse<
  ApiArtifactUploadSuccessValue<TMetadata>,
  Record<string, unknown>,
  typeof API_ARTIFACT_UPLOAD_OPERATION,
  Record<string, never>
>;

export type ApiArtifactUploadPolicyReadRequest = ApiRequest<
  ApiArtifactUploadPolicyReadRequestPayload,
  typeof API_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  Record<string, never>
>;

export type ApiArtifactUploadPolicyReadResponse = ApiResponse<
  ApiArtifactUploadPolicyReadSuccessValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  Record<string, never>
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeApiArtifactUploadPayload(
  payload: ApiArtifactUploadRequestPayload,
): ApiArtifactUploadRequestPayload {
  if (payload.bytes.length === 0) {
    throw new Error("bytes must contain at least one byte.");
  }

  return {
    fileName: normalizeRequiredTextField(payload.fileName, "fileName"),
    mediaType: normalizeRequiredTextField(payload.mediaType, "mediaType"),
    bytes: payload.bytes,
    workspaceId: createWorkspaceId(payload.workspaceId),
    boundary: {
      host: "server",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createApiArtifactUploadRequest(
  payload: ApiArtifactUploadRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactUploadRequest {
  return createApiRequest(
    API_ARTIFACT_UPLOAD_OPERATION,
    normalizeApiArtifactUploadPayload(payload),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiArtifactUploadSuccessResponse<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
>(
  descriptor: StagedArtifactDescriptor<TMetadata>,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactUploadResponse<TMetadata> {
  return createApiSuccessResponse(
    API_ARTIFACT_UPLOAD_OPERATION,
    {
      descriptor: normalizeStagedArtifactDescriptor(descriptor),
    },
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiArtifactUploadFailureResponse(
  code: "validation" | "internal" | "conflict" | "unavailable",
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactUploadResponse {
  return createApiFailureResponse(
    createApiError(API_ARTIFACT_UPLOAD_OPERATION, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    }),
  );
}

export function createApiArtifactUploadPolicyReadRequest(
  payload: ApiArtifactUploadPolicyReadRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactUploadPolicyReadRequest {
  return createApiRequest(API_ARTIFACT_UPLOAD_POLICY_READ_OPERATION, {
    boundary: {
      host: "server",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  }, options);
}

export function createApiArtifactUploadPolicyReadSuccessResponse(
  policy: ArtifactUploadAcceptedTypePolicy,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactUploadPolicyReadResponse {
  return createApiSuccessResponse(
    API_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
    { policy },
    options,
  );
}
