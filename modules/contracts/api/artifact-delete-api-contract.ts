import { createWorkspaceId } from "../workspace";
import { createTransportOperation } from "../transport";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_ARTIFACT_REGISTERED_DELETE_OPERATION = createTransportOperation(
  "artifact",
  "registered",
  "delete",
);

export interface ApiArtifactRegisteredDeleteBoundaryContext {
  host: "server";
  source: string;
}

export interface ApiArtifactRegisteredDeleteRequestPayload {
  storageKey: string;
  workspaceId: string;
  boundary: ApiArtifactRegisteredDeleteBoundaryContext;
}

export type ApiArtifactRegisteredDeleteSuccessValue = {
  storageKey: string;
};

export type ApiArtifactRegisteredDeleteRequest = ApiRequest<
  ApiArtifactRegisteredDeleteRequestPayload,
  typeof API_ARTIFACT_REGISTERED_DELETE_OPERATION,
  Record<string, never>
>;

export type ApiArtifactRegisteredDeleteResponse = ApiResponse<
  ApiArtifactRegisteredDeleteSuccessValue,
  Record<string, unknown>,
  typeof API_ARTIFACT_REGISTERED_DELETE_OPERATION,
  Record<string, never>
>;

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }
  return normalized;
}

export function createApiArtifactRegisteredDeleteRequest(
  payload: ApiArtifactRegisteredDeleteRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactRegisteredDeleteRequest {
  return createApiRequest(
    API_ARTIFACT_REGISTERED_DELETE_OPERATION,
    {
      storageKey: normalizeRequiredText(payload.storageKey, "storageKey"),
      workspaceId: createWorkspaceId(payload.workspaceId),
      boundary: {
        host: "server",
        source: normalizeRequiredText(payload.boundary.source, "boundary.source"),
      },
    },
    options,
  );
}

export function createApiArtifactRegisteredDeleteSuccessResponse(
  value: ApiArtifactRegisteredDeleteSuccessValue,
  options?: { requestId?: string; correlationId?: string },
): ApiArtifactRegisteredDeleteResponse {
  return createApiSuccessResponse(
    API_ARTIFACT_REGISTERED_DELETE_OPERATION,
    { storageKey: normalizeRequiredText(value.storageKey, "storageKey") },
    options,
  );
}

export function createApiArtifactRegisteredDeleteFailureResponse(
  code: "validation" | "forbidden" | "not-found" | "internal" | "unavailable",
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactRegisteredDeleteResponse {
  return createApiFailureResponse(
    createApiError(API_ARTIFACT_REGISTERED_DELETE_OPERATION, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    }),
  );
}
