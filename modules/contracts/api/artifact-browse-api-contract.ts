import {
  ARTIFACT_BROWSE_OPERATION,
  normalizeArtifactBrowseSuccessValue,
  type ArtifactBrowseSuccessValue,
} from "../artifact-browser";
import { createApiError } from "./api-error";
import type { ArtifactFamily } from "../../domain/artifact";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_ARTIFACT_BROWSE_OPERATION = ARTIFACT_BROWSE_OPERATION;

export interface ApiArtifactBrowseBoundaryContext {
  host: "server";
  source: string;
}

export interface ApiArtifactBrowseRequestPayload {
  artifactFamily?: ArtifactFamily;
  boundary: ApiArtifactBrowseBoundaryContext;
}

export type ApiArtifactBrowseSuccessValue = ArtifactBrowseSuccessValue;

export type ApiArtifactBrowseRequest = ApiRequest<
  ApiArtifactBrowseRequestPayload,
  typeof API_ARTIFACT_BROWSE_OPERATION,
  Record<string, never>
>;

export type ApiArtifactBrowseResponse = ApiResponse<
  ApiArtifactBrowseSuccessValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_BROWSE_OPERATION,
  Record<string, never>
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeApiArtifactBrowsePayload(
  payload: ApiArtifactBrowseRequestPayload,
): ApiArtifactBrowseRequestPayload {
  return {
    artifactFamily: payload.artifactFamily,
    boundary: {
      host: "server",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createApiArtifactBrowseRequest(
  payload: ApiArtifactBrowseRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactBrowseRequest {
  return createApiRequest(
    API_ARTIFACT_BROWSE_OPERATION,
    normalizeApiArtifactBrowsePayload(payload),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiArtifactBrowseSuccessResponse(
  browse: ArtifactBrowseSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactBrowseResponse {
  return createApiSuccessResponse(
    API_ARTIFACT_BROWSE_OPERATION,
    normalizeArtifactBrowseSuccessValue(browse),
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createApiArtifactBrowseFailureResponse(
  code: "validation" | "internal" | "unavailable",
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactBrowseResponse {
  return createApiFailureResponse(
    createApiError(API_ARTIFACT_BROWSE_OPERATION, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    }),
  );
}
