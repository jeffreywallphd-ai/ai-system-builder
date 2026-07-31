import {
  API_HUGGING_FACE_FILES_IMPORT_OPERATION,
  type ApiHuggingFaceFileImportSelection,
  type ApiHuggingFaceFilesImportResponseValue,
  type ApiHuggingFaceRepositoryImportSelection,
} from "../api/huggingface-files-import-api-contract";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_HUGGING_FACE_FILES_IMPORT_OPERATION = API_HUGGING_FACE_FILES_IMPORT_OPERATION;
export const DESKTOP_HUGGING_FACE_FILES_IMPORT_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_FILES_IMPORT_OPERATION,
  "request",
);
export const DESKTOP_HUGGING_FACE_FILES_IMPORT_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_FILES_IMPORT_OPERATION,
  "response",
);

export interface DesktopHuggingFaceFilesImportRequestPayload {
  repositories?: ApiHuggingFaceRepositoryImportSelection[];
  files?: ApiHuggingFaceFileImportSelection[];
  boundary: {
    host: "desktop";
    source: string;
  };
}

export type DesktopHuggingFaceFilesImportRequest = IpcRequest<
  DesktopHuggingFaceFilesImportRequestPayload,
  typeof DESKTOP_HUGGING_FACE_FILES_IMPORT_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_FILES_IMPORT_REQUEST_CHANNEL.value
>;

export type DesktopHuggingFaceFilesImportResponse = IpcResponse<
  ApiHuggingFaceFilesImportResponseValue,
  Record<string, unknown>,
  typeof DESKTOP_HUGGING_FACE_FILES_IMPORT_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_FILES_IMPORT_RESPONSE_CHANNEL.value
>;

export function createDesktopHuggingFaceFilesImportRequest(
  payload: DesktopHuggingFaceFilesImportRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceFilesImportRequest {
  const source = payload.boundary.source?.trim();
  const repositories = normalizeRepositories(payload.repositories ?? []);
  const files = normalizeFiles(payload.files ?? []);
  if (!source) {
    throw new Error("boundary.source must be a non-empty string.");
  }
  if (repositories.length === 0 && files.length === 0) {
    throw new Error("At least one Hugging Face repository or file must be selected.");
  }

  return createIpcRequest(
    DESKTOP_HUGGING_FACE_FILES_IMPORT_REQUEST_CHANNEL,
    {
      repositories,
      files,
      boundary: {
        host: "desktop",
        source,
      },
    },
    options,
  );
}

export function createDesktopHuggingFaceFilesImportSuccessResponse(
  value: ApiHuggingFaceFilesImportResponseValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceFilesImportResponse {
  return createIpcSuccessResponse(
    DESKTOP_HUGGING_FACE_FILES_IMPORT_RESPONSE_CHANNEL,
    value,
    options,
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
