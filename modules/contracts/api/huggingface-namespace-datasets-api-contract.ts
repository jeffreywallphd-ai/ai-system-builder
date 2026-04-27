import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";

export const API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION = "huggingface.namespace.datasets.browse" as const;

export interface ApiHuggingFaceNamespaceDatasetsBrowseRequestPayload {
  namespace: string;
  source: string;
}

export interface ApiHuggingFaceNamespaceDatasetsBrowseResponseValue {
  namespace: string;
  datasets: Array<{
    namespace: string;
    repository: string;
  }>;
}

export type ApiHuggingFaceNamespaceDatasetsBrowseRequest = ApiRequest<
  ApiHuggingFaceNamespaceDatasetsBrowseRequestPayload,
  typeof API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
  Record<string, never>
>;

export type ApiHuggingFaceNamespaceDatasetsBrowseResponse = ApiResponse<
  ApiHuggingFaceNamespaceDatasetsBrowseResponseValue,
  Record<string, unknown>,
  typeof API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
  Record<string, never>
>;

export function createApiHuggingFaceNamespaceDatasetsBrowseRequest(
  payload: ApiHuggingFaceNamespaceDatasetsBrowseRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiHuggingFaceNamespaceDatasetsBrowseRequest {
  const namespace = payload.namespace?.trim();
  const source = payload.source?.trim();
  if (!namespace) {
    throw new Error("namespace must be a non-empty string.");
  }
  if (!source) {
    throw new Error("source must be a non-empty string.");
  }

  return createApiRequest(API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION, { namespace, source }, options);
}

export function createApiHuggingFaceNamespaceDatasetsBrowseSuccessResponse(
  value: ApiHuggingFaceNamespaceDatasetsBrowseResponseValue,
  options?: { requestId?: string; correlationId?: string },
): ApiHuggingFaceNamespaceDatasetsBrowseResponse {
  return createApiSuccessResponse(API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION, value, options);
}

export function createApiHuggingFaceNamespaceDatasetsBrowseFailureResponse(
  code: "validation" | "not-found" | "unavailable" | "internal",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiHuggingFaceNamespaceDatasetsBrowseResponse {
  return createApiFailureResponse(
    createApiError(API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION, code, message, options),
  );
}
