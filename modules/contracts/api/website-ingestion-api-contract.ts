import { createWorkspaceId } from "../workspace";
import type { ContractErrorCode } from "../shared";
import {
  createIngestWebsitePageRequest,
  createIngestWebsitePagesBatchRequest,
  normalizeIngestWebsitePageSuccessValue,
  normalizeIngestWebsitePagesBatchSuccessValue,
  type IngestWebsitePageRequest,
  type IngestWebsitePageSuccessValue,
  type IngestWebsitePagesBatchRequest,
  type IngestWebsitePagesBatchSuccessValue,
} from "../ingestion";
import { createTransportOperation } from "../transport";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_INGEST_WEBSITE_PAGE_OPERATION = createTransportOperation(
  "artifact",
  "ingest-website-page",
);

export const API_INGEST_WEBSITE_PAGES_BATCH_OPERATION = createTransportOperation(
  "artifact",
  "ingest-website-pages-batch",
);

export interface ApiWebsiteIngestionBoundaryContext {
  host: "server";
  source: string;
}

export interface ApiIngestWebsitePageRequestPayload {
  request: IngestWebsitePageRequest;
  workspaceId: string;
  boundary: ApiWebsiteIngestionBoundaryContext;
}

export interface ApiIngestWebsitePagesBatchRequestPayload {
  request: IngestWebsitePagesBatchRequest;
  workspaceId: string;
  boundary: ApiWebsiteIngestionBoundaryContext;
}

export interface ApiIngestWebsitePageSuccessValue {
  result: IngestWebsitePageSuccessValue;
}

export interface ApiIngestWebsitePagesBatchSuccessValue {
  result: IngestWebsitePagesBatchSuccessValue;
}

export type ApiIngestWebsitePageRequest = ApiRequest<
  ApiIngestWebsitePageRequestPayload,
  typeof API_INGEST_WEBSITE_PAGE_OPERATION,
  Record<string, never>
>;

export type ApiIngestWebsitePagesBatchRequest = ApiRequest<
  ApiIngestWebsitePagesBatchRequestPayload,
  typeof API_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  Record<string, never>
>;

export type ApiIngestWebsitePageResponse = ApiResponse<
  ApiIngestWebsitePageSuccessValue,
  Record<string, unknown>,
  typeof API_INGEST_WEBSITE_PAGE_OPERATION,
  Record<string, never>
>;

export type ApiIngestWebsitePagesBatchResponse = ApiResponse<
  ApiIngestWebsitePagesBatchSuccessValue,
  Record<string, unknown>,
  typeof API_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  Record<string, never>
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeBoundary(
  boundary: ApiWebsiteIngestionBoundaryContext,
): ApiWebsiteIngestionBoundaryContext {
  return {
    host: "server",
    source: normalizeRequiredTextField(boundary.source, "boundary.source"),
  };
}

export function createApiIngestWebsitePageRequest(
  payload: ApiIngestWebsitePageRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiIngestWebsitePageRequest {
  return createApiRequest(
    API_INGEST_WEBSITE_PAGE_OPERATION,
    {
      request: createIngestWebsitePageRequest(payload.request),
      workspaceId: createWorkspaceId(payload.workspaceId),
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createApiIngestWebsitePagesBatchRequest(
  payload: ApiIngestWebsitePagesBatchRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiIngestWebsitePagesBatchRequest {
  return createApiRequest(
    API_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
    {
      request: createIngestWebsitePagesBatchRequest(payload.request),
      workspaceId: createWorkspaceId(payload.workspaceId),
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createApiIngestWebsitePageSuccessResponse(
  result: IngestWebsitePageSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiIngestWebsitePageResponse {
  return createApiSuccessResponse(
    API_INGEST_WEBSITE_PAGE_OPERATION,
    { result: normalizeIngestWebsitePageSuccessValue(result) },
    options,
  );
}

export function createApiIngestWebsitePagesBatchSuccessResponse(
  result: IngestWebsitePagesBatchSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): ApiIngestWebsitePagesBatchResponse {
  return createApiSuccessResponse(
    API_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
    { result: normalizeIngestWebsitePagesBatchSuccessValue(result) },
    options,
  );
}

export function createApiIngestWebsitePageFailureResponse(
  code: ContractErrorCode,
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiIngestWebsitePageResponse {
  return createApiFailureResponse(
    createApiError(API_INGEST_WEBSITE_PAGE_OPERATION, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    }),
  );
}

export function createApiIngestWebsitePagesBatchFailureResponse(
  code: ContractErrorCode,
  message: string,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    correlationId?: string;
  },
): ApiIngestWebsitePagesBatchResponse {
  return createApiFailureResponse(
    createApiError(API_INGEST_WEBSITE_PAGES_BATCH_OPERATION, code, message, {
      details: options?.details,
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    }),
  );
}
