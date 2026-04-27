import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";
import type { ApiArtifactPublishResponseValue } from "./artifact-publish-api-contract";

export const API_ARTIFACT_SOURCE_VERIFY_OPERATION = "artifact.source.verify" as const;

export interface ApiArtifactSourceVerifyRequestPayload {
  artifactId: string;
  source: string;
}

export type ApiArtifactSourceVerifyRequest = ApiRequest<
  ApiArtifactSourceVerifyRequestPayload,
  typeof API_ARTIFACT_SOURCE_VERIFY_OPERATION,
  Record<string, never>
>;

export type ApiArtifactSourceVerifyResponse = ApiResponse<
  ApiArtifactPublishResponseValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_SOURCE_VERIFY_OPERATION,
  Record<string, never>
>;

function normalizeRequired(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return normalized;
}

export function createApiArtifactSourceVerifyRequest(
  payload: ApiArtifactSourceVerifyRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactSourceVerifyRequest {
  return createApiRequest(API_ARTIFACT_SOURCE_VERIFY_OPERATION, {
    artifactId: normalizeRequired(payload.artifactId, "artifactId"),
    source: normalizeRequired(payload.source, "source"),
  }, options);
}

export function createApiArtifactSourceVerifySuccessResponse(
  value: ApiArtifactPublishResponseValue,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactSourceVerifyResponse {
  return createApiSuccessResponse(API_ARTIFACT_SOURCE_VERIFY_OPERATION, value, options);
}

export function createApiArtifactSourceVerifyFailureResponse(
  code: "validation" | "not-found" | "unavailable" | "internal",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiArtifactSourceVerifyResponse {
  return createApiFailureResponse(createApiError(API_ARTIFACT_SOURCE_VERIFY_OPERATION, code, message, options));
}
