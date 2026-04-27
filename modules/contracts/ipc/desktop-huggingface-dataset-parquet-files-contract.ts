import {
  API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
} from "../api/huggingface-dataset-parquet-files-api-contract";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION = API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION;
export const DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
  "request",
);
export const DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
  "response",
);

export interface DesktopHuggingFaceDatasetParquetFilesBrowseRequestPayload {
  repository: string;
  revision?: string;
  boundary: {
    host: "desktop";
    source: string;
  };
}

export interface DesktopHuggingFaceDatasetParquetFilesBrowseResponseValue {
  repository: string;
  revision: string;
  files: Array<{
    repository: string;
    path: string;
    revision: string;
    sizeBytes?: number;
  }>;
}

export type DesktopHuggingFaceDatasetParquetFilesBrowseRequest = IpcRequest<
  DesktopHuggingFaceDatasetParquetFilesBrowseRequestPayload,
  typeof DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL.value
>;

export type DesktopHuggingFaceDatasetParquetFilesBrowseResponse = IpcResponse<
  DesktopHuggingFaceDatasetParquetFilesBrowseResponseValue,
  Record<string, unknown>,
  typeof DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_RESPONSE_CHANNEL.value
>;

export function createDesktopHuggingFaceDatasetParquetFilesBrowseRequest(
  payload: DesktopHuggingFaceDatasetParquetFilesBrowseRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceDatasetParquetFilesBrowseRequest {
  const repository = payload.repository?.trim();
  const source = payload.boundary.source?.trim();
  if (!repository) {
    throw new Error("repository must be a non-empty string.");
  }
  if (!source) {
    throw new Error("boundary.source must be a non-empty string.");
  }

  return createIpcRequest(
    DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL,
    {
      repository,
      revision: payload.revision?.trim() || undefined,
      boundary: {
        host: "desktop",
        source,
      },
    },
    options,
  );
}

export function createDesktopHuggingFaceDatasetParquetFilesBrowseSuccessResponse(
  value: DesktopHuggingFaceDatasetParquetFilesBrowseResponseValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceDatasetParquetFilesBrowseResponse {
  return createIpcSuccessResponse(
    DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_RESPONSE_CHANNEL,
    value,
    options,
  );
}
