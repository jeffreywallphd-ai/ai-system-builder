import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";

export const API_ARTIFACT_PUBLISH_OPERATION = "artifact.publish" as const;

export interface ApiArtifactPublishRequestPayload {
  artifactId: string;
  target: {
    provider: string;
    repository: string;
    revision?: string;
    path: string;
  };
  mediaType?: string;
  verify?: boolean;
  source: string;
}

export interface ApiArtifactPublishResponseValue {
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

export type ApiArtifactPublishRequest = ApiRequest<
  ApiArtifactPublishRequestPayload,
  typeof API_ARTIFACT_PUBLISH_OPERATION,
  Record<string, never>
>;

export type ApiArtifactPublishResponse = ApiResponse<
  ApiArtifactPublishResponseValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_PUBLISH_OPERATION,
  Record<string, never>
>;

function normalizeRequired(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return normalized;
}

export function createApiArtifactPublishRequest(
  payload: ApiArtifactPublishRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactPublishRequest {
  return createApiRequest(API_ARTIFACT_PUBLISH_OPERATION, {
    artifactId: normalizeRequired(payload.artifactId, "artifactId"),
    target: {
      provider: normalizeRequired(payload.target.provider, "target.provider"),
      repository: normalizeRequired(payload.target.repository, "target.repository"),
      revision: payload.target.revision?.trim() || undefined,
      path: normalizeRequired(payload.target.path, "target.path"),
    },
    mediaType: payload.mediaType?.trim() || undefined,
    verify: payload.verify ?? true,
    source: normalizeRequired(payload.source, "source"),
  }, options);
}

export function createApiArtifactPublishSuccessResponse(
  value: ApiArtifactPublishResponseValue,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactPublishResponse {
  return createApiSuccessResponse(API_ARTIFACT_PUBLISH_OPERATION, value, options);
}

export function createApiArtifactPublishFailureResponse(
  code: "validation" | "not-found" | "unavailable" | "internal",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiArtifactPublishResponse {
  return createApiFailureResponse(createApiError(API_ARTIFACT_PUBLISH_OPERATION, code, message, options));
}
