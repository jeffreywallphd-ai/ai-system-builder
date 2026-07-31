import {
  normalizeArtifactRepoTarget,
  type ArtifactRepositoryCreationPolicy,
  type ArtifactRepoTarget,
  type StoreArtifactInRepoSuccessValue,
} from "../storage";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_ARTIFACT_REPO_STORE_OPERATION = "artifact.repo.store" as const;

export interface ApiArtifactRepoStoreBoundaryContext {
  host: "server";
  source: string;
}

export interface ApiArtifactRepoStoreRequestPayload {
  target: ArtifactRepoTarget;
  contentBase64: string;
  mediaType?: string;
  overwrite?: boolean;
  repositoryCreation?: ArtifactRepositoryCreationPolicy;
  boundary: ApiArtifactRepoStoreBoundaryContext;
}

export type ApiArtifactRepoStoreRequest = ApiRequest<
  ApiArtifactRepoStoreRequestPayload,
  typeof API_ARTIFACT_REPO_STORE_OPERATION,
  Record<string, never>
>;

export type ApiArtifactRepoStoreResponse = ApiResponse<
  StoreArtifactInRepoSuccessValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_REPO_STORE_OPERATION,
  Record<string, never>
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeApiArtifactRepoStorePayload(
  payload: ApiArtifactRepoStoreRequestPayload,
): ApiArtifactRepoStoreRequestPayload {
  if (!payload.contentBase64 || payload.contentBase64.trim().length === 0) {
    throw new Error("contentBase64 must be a non-empty base64 string.");
  }

  return {
    target: normalizeArtifactRepoTarget(payload.target),
    contentBase64: normalizeRequiredTextField(payload.contentBase64, "contentBase64"),
    mediaType: payload.mediaType?.trim() || undefined,
    overwrite: payload.overwrite,
    repositoryCreation: normalizeRepositoryCreation(payload.repositoryCreation),
    boundary: {
      host: "server",
      source: normalizeRequiredTextField(payload.boundary.source, "boundary.source"),
    },
  };
}

function normalizeRepositoryCreation(
  value: ArtifactRepositoryCreationPolicy | undefined,
): ArtifactRepositoryCreationPolicy | undefined {
  if (!value) return undefined;
  if (value.approved !== true) {
    throw new Error("repositoryCreation.approved must be true when repository creation is requested.");
  }
  if (value.visibility !== "private" && value.visibility !== "public") {
    throw new Error("repositoryCreation.visibility must be private or public.");
  }
  return { approved: true, visibility: value.visibility };
}

export function createApiArtifactRepoStoreRequest(
  payload: ApiArtifactRepoStoreRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactRepoStoreRequest {
  return createApiRequest(API_ARTIFACT_REPO_STORE_OPERATION, normalizeApiArtifactRepoStorePayload(payload), {
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  });
}

export function createApiArtifactRepoStoreSuccessResponse(
  value: StoreArtifactInRepoSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactRepoStoreResponse {
  return createApiSuccessResponse(API_ARTIFACT_REPO_STORE_OPERATION, value, {
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  });
}

export function createApiArtifactRepoStoreFailureResponse(
  code: "validation" | "not-found" | "internal" | "unavailable",
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactRepoStoreResponse {
  return createApiFailureResponse(
    createApiError(API_ARTIFACT_REPO_STORE_OPERATION, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    }),
  );
}
