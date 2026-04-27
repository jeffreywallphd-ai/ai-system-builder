import {
  ARTIFACT_READ_OPERATION,
  normalizeArtifactBrowserLocator,
  normalizeArtifactReadSuccessValue,
  type ArtifactBrowserLocator,
  type ArtifactReadSuccessValue,
} from "../artifact-browser";
import { type StorageObjectMetadata } from "../storage";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_ARTIFACT_READ_OPERATION = ARTIFACT_READ_OPERATION;

export interface ApiArtifactReadBoundaryContext {
  host: "server";
  source: string;
}

export interface ApiArtifactReadRequestPayload {
  locator: ArtifactBrowserLocator;
  boundary: ApiArtifactReadBoundaryContext;
}

export type ApiArtifactReadSuccessValue<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> = ArtifactReadSuccessValue<TMetadata>;

export type ApiArtifactReadRequest = ApiRequest<
  ApiArtifactReadRequestPayload,
  typeof API_ARTIFACT_READ_OPERATION,
  Record<string, never>
>;

export type ApiArtifactReadResponse<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> = ApiResponse<
  ApiArtifactReadSuccessValue<TMetadata>,
  Record<string, unknown>,
  typeof API_ARTIFACT_READ_OPERATION,
  Record<string, never>
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeApiArtifactReadPayload(
  payload: ApiArtifactReadRequestPayload,
): ApiArtifactReadRequestPayload {
  return {
    locator: normalizeArtifactBrowserLocator(payload.locator),
    boundary: {
      host: "server",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createApiArtifactReadRequest(
  payload: ApiArtifactReadRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactReadRequest {
  return createApiRequest(
    API_ARTIFACT_READ_OPERATION,
    normalizeApiArtifactReadPayload(payload),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiArtifactReadSuccessResponse<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
>(
  value: ArtifactReadSuccessValue<TMetadata>,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactReadResponse<TMetadata> {
  return createApiSuccessResponse(
    API_ARTIFACT_READ_OPERATION,
    normalizeArtifactReadSuccessValue(value),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiArtifactReadFailureResponse(
  code: "validation" | "not-found" | "internal" | "unavailable",
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactReadResponse {
  return createApiFailureResponse(
    createApiError(API_ARTIFACT_READ_OPERATION, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    }),
  );
}
