import {
  normalizeArtifactRepoTarget,
  type ArtifactRepoTarget,
  type HasArtifactInRepoResultValue,
} from "../storage";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_ARTIFACT_REPO_HAS_OPERATION = "artifact.repo.has" as const;

export interface ApiArtifactRepoHasBoundaryContext {
  host: "server";
  source: string;
}

export interface ApiArtifactRepoHasRequestPayload {
  target: ArtifactRepoTarget;
  boundary: ApiArtifactRepoHasBoundaryContext;
}

export type ApiArtifactRepoHasRequest = ApiRequest<
  ApiArtifactRepoHasRequestPayload,
  typeof API_ARTIFACT_REPO_HAS_OPERATION,
  Record<string, never>
>;

export type ApiArtifactRepoHasResponse = ApiResponse<
  HasArtifactInRepoResultValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_REPO_HAS_OPERATION,
  Record<string, never>
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeApiArtifactRepoHasPayload(
  payload: ApiArtifactRepoHasRequestPayload,
): ApiArtifactRepoHasRequestPayload {
  return {
    target: normalizeArtifactRepoTarget(payload.target),
    boundary: {
      host: "server",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

export function createApiArtifactRepoHasRequest(
  payload: ApiArtifactRepoHasRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactRepoHasRequest {
  return createApiRequest(API_ARTIFACT_REPO_HAS_OPERATION, normalizeApiArtifactRepoHasPayload(payload), {
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  });
}

export function createApiArtifactRepoHasSuccessResponse(
  value: HasArtifactInRepoResultValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactRepoHasResponse {
  return createApiSuccessResponse(API_ARTIFACT_REPO_HAS_OPERATION, value, {
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  });
}

export function createApiArtifactRepoHasFailureResponse(
  code: "validation" | "not-found" | "internal" | "unavailable",
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactRepoHasResponse {
  return createApiFailureResponse(
    createApiError(API_ARTIFACT_REPO_HAS_OPERATION, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    }),
  );
}
