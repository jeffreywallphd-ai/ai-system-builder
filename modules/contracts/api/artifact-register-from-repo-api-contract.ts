import { createApiError } from "./api-error";
import type { ArtifactFamily } from "../../domain/artifact";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";

export const API_ARTIFACT_REGISTER_FROM_REPO_OPERATION = "artifact.register.from-repo" as const;

export interface ApiArtifactRegisterFromRepoRequestPayload {
  target: {
    provider: string;
    repository: string;
    revision?: string;
    path: string;
  };
  artifactFamily?: ArtifactFamily;
  mediaType?: string;
  source: string;
}

export interface ApiArtifactRegisterFromRepoResponseValue {
  artifactId: string;
  backing: {
    role: "imported-source";
    target: {
      provider: string;
      repository: string;
      path: string;
      revision: string;
      locator: string;
    };
    verification: {
      exists: true;
      verifiedAt: string;
    };
  };
}

export type ApiArtifactRegisterFromRepoRequest = ApiRequest<
  ApiArtifactRegisterFromRepoRequestPayload,
  typeof API_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  Record<string, never>
>;

export type ApiArtifactRegisterFromRepoResponse = ApiResponse<
  ApiArtifactRegisterFromRepoResponseValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  Record<string, never>
>;

function normalizeRequired(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return normalized;
}

export function createApiArtifactRegisterFromRepoRequest(
  payload: ApiArtifactRegisterFromRepoRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactRegisterFromRepoRequest {
  return createApiRequest(API_ARTIFACT_REGISTER_FROM_REPO_OPERATION, {
    target: {
      provider: normalizeRequired(payload.target.provider, "target.provider"),
      repository: normalizeRequired(payload.target.repository, "target.repository"),
      revision: payload.target.revision?.trim() || undefined,
      path: normalizeRequired(payload.target.path, "target.path"),
    },
    artifactFamily: payload.artifactFamily,
    mediaType: payload.mediaType?.trim() || undefined,
    source: normalizeRequired(payload.source, "source"),
  }, options);
}

export function createApiArtifactRegisterFromRepoSuccessResponse(
  value: ApiArtifactRegisterFromRepoResponseValue,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactRegisterFromRepoResponse {
  return createApiSuccessResponse(API_ARTIFACT_REGISTER_FROM_REPO_OPERATION, value, options);
}

export function createApiArtifactRegisterFromRepoFailureResponse(
  code: "validation" | "not-found" | "unavailable" | "internal",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiArtifactRegisterFromRepoResponse {
  return createApiFailureResponse(
    createApiError(API_ARTIFACT_REGISTER_FROM_REPO_OPERATION, code, message, options),
  );
}
