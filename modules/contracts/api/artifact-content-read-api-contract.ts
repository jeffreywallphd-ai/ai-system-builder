import {
  ARTIFACT_CONTENT_READ_OPERATION,
  normalizeArtifactBrowserLocator,
  normalizeArtifactContentReadSuccessValue,
  type ArtifactBrowserLocator,
  type ArtifactContentReadSuccessValue,
} from "../artifact-browser";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_ARTIFACT_CONTENT_READ_OPERATION = ARTIFACT_CONTENT_READ_OPERATION;

export interface ApiArtifactContentReadBoundaryContext {
  host: "server";
  source: string;
}

export interface ApiArtifactContentReadRequestPayload {
  locator: ArtifactBrowserLocator;
  boundary: ApiArtifactContentReadBoundaryContext;
}

export type ApiArtifactContentReadSuccessValue = ArtifactContentReadSuccessValue;

export type ApiArtifactContentReadRequest = ApiRequest<
  ApiArtifactContentReadRequestPayload,
  typeof API_ARTIFACT_CONTENT_READ_OPERATION,
  Record<string, never>
>;

export type ApiArtifactContentReadResponse = ApiResponse<
  ApiArtifactContentReadSuccessValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_CONTENT_READ_OPERATION,
  Record<string, never>
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeApiArtifactContentReadPayload(
  payload: ApiArtifactContentReadRequestPayload,
): ApiArtifactContentReadRequestPayload {
  return {
    locator: normalizeArtifactBrowserLocator(payload.locator),
    boundary: {
      host: "server",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createApiArtifactContentReadRequest(
  payload: ApiArtifactContentReadRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactContentReadRequest {
  return createApiRequest(
    API_ARTIFACT_CONTENT_READ_OPERATION,
    normalizeApiArtifactContentReadPayload(payload),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiArtifactContentReadSuccessResponse(
  value: ArtifactContentReadSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactContentReadResponse {
  return createApiSuccessResponse(
    API_ARTIFACT_CONTENT_READ_OPERATION,
    normalizeArtifactContentReadSuccessValue(value),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiArtifactContentReadFailureResponse(
  code: "validation" | "not-found" | "internal" | "unavailable",
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactContentReadResponse {
  return createApiFailureResponse(
    createApiError(API_ARTIFACT_CONTENT_READ_OPERATION, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    }),
  );
}
