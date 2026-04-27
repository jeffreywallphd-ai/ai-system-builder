import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";

export const API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION = "huggingface.dataset.parquet-files.browse" as const;

export interface ApiHuggingFaceDatasetParquetFilesBrowseRequestPayload {
  repository: string;
  revision?: string;
  source: string;
}

export interface ApiHuggingFaceDatasetParquetFilesBrowseResponseValue {
  repository: string;
  revision: string;
  files: Array<{
    repository: string;
    path: string;
    revision: string;
    sizeBytes?: number;
  }>;
}

export type ApiHuggingFaceDatasetParquetFilesBrowseRequest = ApiRequest<
  ApiHuggingFaceDatasetParquetFilesBrowseRequestPayload,
  typeof API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
  Record<string, never>
>;

export type ApiHuggingFaceDatasetParquetFilesBrowseResponse = ApiResponse<
  ApiHuggingFaceDatasetParquetFilesBrowseResponseValue,
  Record<string, unknown>,
  typeof API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
  Record<string, never>
>;

export function createApiHuggingFaceDatasetParquetFilesBrowseRequest(
  payload: ApiHuggingFaceDatasetParquetFilesBrowseRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiHuggingFaceDatasetParquetFilesBrowseRequest {
  const repository = payload.repository?.trim();
  const source = payload.source?.trim();
  if (!repository) {
    throw new Error("repository must be a non-empty string.");
  }
  if (!source) {
    throw new Error("source must be a non-empty string.");
  }

  return createApiRequest(API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION, {
    repository,
    revision: payload.revision?.trim() || undefined,
    source,
  }, options);
}

export function createApiHuggingFaceDatasetParquetFilesBrowseSuccessResponse(
  value: ApiHuggingFaceDatasetParquetFilesBrowseResponseValue,
  options?: { requestId?: string; correlationId?: string },
): ApiHuggingFaceDatasetParquetFilesBrowseResponse {
  return createApiSuccessResponse(API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION, value, options);
}

export function createApiHuggingFaceDatasetParquetFilesBrowseFailureResponse(
  code: "validation" | "not-found" | "unavailable" | "internal",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiHuggingFaceDatasetParquetFilesBrowseResponse {
  return createApiFailureResponse(
    createApiError(API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION, code, message, options),
  );
}
