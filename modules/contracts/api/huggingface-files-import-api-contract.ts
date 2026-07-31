import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";

export const API_HUGGING_FACE_FILES_IMPORT_OPERATION = "huggingface.files.import" as const;

export interface ApiHuggingFaceRepositoryImportSelection {
  repository: string;
  revision?: string;
}

export interface ApiHuggingFaceFileImportSelection extends ApiHuggingFaceRepositoryImportSelection {
  path: string;
  mediaType?: string;
}

export interface ApiHuggingFaceFilesImportRequestPayload {
  repositories?: ApiHuggingFaceRepositoryImportSelection[];
  files?: ApiHuggingFaceFileImportSelection[];
  source: string;
}

export interface ApiHuggingFaceFilesImportResponseValue {
  repositories: Array<{
    repository: string;
    revision: string;
    status: "succeeded" | "partial" | "failed";
    message?: string;
    code?: "validation" | "not-found" | "unavailable" | "internal";
    files: Array<{
      repository: string;
      path: string;
      revision: string;
      mediaType?: string;
      status: "registered" | "failed";
      artifactId?: string;
      message?: string;
      code?: "validation" | "not-found" | "unavailable" | "internal";
    }>;
  }>;
  summary: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
}

export type ApiHuggingFaceFilesImportRequest = ApiRequest<
  ApiHuggingFaceFilesImportRequestPayload,
  typeof API_HUGGING_FACE_FILES_IMPORT_OPERATION,
  Record<string, never>
>;

export type ApiHuggingFaceFilesImportResponse = ApiResponse<
  ApiHuggingFaceFilesImportResponseValue,
  Record<string, unknown>,
  typeof API_HUGGING_FACE_FILES_IMPORT_OPERATION,
  Record<string, never>
>;

export function createApiHuggingFaceFilesImportRequest(
  payload: ApiHuggingFaceFilesImportRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiHuggingFaceFilesImportRequest {
  const source = payload.source?.trim();
  if (!source) {
    throw new Error("source must be a non-empty string.");
  }

  const repositories = normalizeRepositories(payload.repositories ?? []);
  const files = normalizeFiles(payload.files ?? []);
  if (repositories.length === 0 && files.length === 0) {
    throw new Error("At least one Hugging Face repository or file must be selected.");
  }

  return createApiRequest(API_HUGGING_FACE_FILES_IMPORT_OPERATION, {
    repositories,
    files,
    source,
  }, options);
}

export function createApiHuggingFaceFilesImportSuccessResponse(
  value: ApiHuggingFaceFilesImportResponseValue,
  options?: { requestId?: string; correlationId?: string },
): ApiHuggingFaceFilesImportResponse {
  return createApiSuccessResponse(API_HUGGING_FACE_FILES_IMPORT_OPERATION, value, options);
}

export function createApiHuggingFaceFilesImportFailureResponse(
  code: "validation" | "not-found" | "unavailable" | "internal",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiHuggingFaceFilesImportResponse {
  return createApiFailureResponse(
    createApiError(API_HUGGING_FACE_FILES_IMPORT_OPERATION, code, message, options),
  );
}

function normalizeRepositories(
  repositories: ApiHuggingFaceRepositoryImportSelection[],
): ApiHuggingFaceRepositoryImportSelection[] {
  return repositories
    .map((repository) => ({
      repository: repository.repository?.trim() ?? "",
      revision: repository.revision?.trim() || undefined,
    }))
    .filter((repository) => repository.repository.length > 0);
}

function normalizeFiles(
  files: ApiHuggingFaceFileImportSelection[],
): ApiHuggingFaceFileImportSelection[] {
  return files
    .map((file) => ({
      repository: file.repository?.trim() ?? "",
      revision: file.revision?.trim() || undefined,
      path: file.path?.trim() ?? "",
      mediaType: file.mediaType?.trim() || undefined,
    }))
    .filter((file) => file.repository.length > 0 && file.path.length > 0);
}
