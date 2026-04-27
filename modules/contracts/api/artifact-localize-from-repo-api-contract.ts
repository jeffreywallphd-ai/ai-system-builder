import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";

export const API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION = "artifact.localize.from-repo" as const;

export interface ApiArtifactLocalizeFromRepoRequestPayload {
  artifactId: string;
  source: string;
}

export interface ApiArtifactLocalizeFromRepoResponseValue {
  artifactId: string;
  localObject: {
    key: string;
    mediaType?: string;
    sizeBytes: number;
  };
  source: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator: string;
  };
  localizedAt: string;
}

export type ApiArtifactLocalizeFromRepoRequest = ApiRequest<
  ApiArtifactLocalizeFromRepoRequestPayload,
  typeof API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  Record<string, never>
>;

export type ApiArtifactLocalizeFromRepoResponse = ApiResponse<
  ApiArtifactLocalizeFromRepoResponseValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  Record<string, never>
>;

function normalizeRequired(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return normalized;
}

export function createApiArtifactLocalizeFromRepoRequest(
  payload: ApiArtifactLocalizeFromRepoRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactLocalizeFromRepoRequest {
  return createApiRequest(
    API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
    {
      artifactId: normalizeRequired(payload.artifactId, "artifactId"),
      source: normalizeRequired(payload.source, "source"),
    },
    options,
  );
}

export function createApiArtifactLocalizeFromRepoSuccessResponse(
  value: ApiArtifactLocalizeFromRepoResponseValue,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactLocalizeFromRepoResponse {
  return createApiSuccessResponse(API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION, value, options);
}

export function createApiArtifactLocalizeFromRepoFailureResponse(
  code: "validation" | "not-found" | "unavailable" | "internal",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiArtifactLocalizeFromRepoResponse {
  return createApiFailureResponse(
    createApiError(API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION, code, message, options),
  );
}
