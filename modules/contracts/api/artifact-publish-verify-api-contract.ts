import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";
import type { ApiArtifactPublishResponseValue } from "./artifact-publish-api-contract";

export const API_ARTIFACT_PUBLISH_VERIFY_OPERATION = "artifact.publish.verify" as const;

export interface ApiArtifactPublishVerifyRequestPayload {
  artifactId: string;
  source: string;
}

export type ApiArtifactPublishVerifyRequest = ApiRequest<
  ApiArtifactPublishVerifyRequestPayload,
  typeof API_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  Record<string, never>
>;

export type ApiArtifactPublishVerifyResponse = ApiResponse<
  ApiArtifactPublishResponseValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  Record<string, never>
>;

function normalizeRequired(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return normalized;
}

export function createApiArtifactPublishVerifyRequest(
  payload: ApiArtifactPublishVerifyRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactPublishVerifyRequest {
  return createApiRequest(API_ARTIFACT_PUBLISH_VERIFY_OPERATION, {
    artifactId: normalizeRequired(payload.artifactId, "artifactId"),
    source: normalizeRequired(payload.source, "source"),
  }, options);
}

export function createApiArtifactPublishVerifySuccessResponse(
  value: ApiArtifactPublishResponseValue,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactPublishVerifyResponse {
  return createApiSuccessResponse(API_ARTIFACT_PUBLISH_VERIFY_OPERATION, value, options);
}

export function createApiArtifactPublishVerifyFailureResponse(
  code: "validation" | "not-found" | "unavailable" | "internal",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiArtifactPublishVerifyResponse {
  return createApiFailureResponse(createApiError(API_ARTIFACT_PUBLISH_VERIFY_OPERATION, code, message, options));
}
