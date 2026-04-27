import {
  API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
} from "../api/huggingface-namespace-datasets-api-contract";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION = API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION;
export const DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
  "request",
);
export const DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
  "response",
);

export interface DesktopHuggingFaceNamespaceDatasetsBrowseRequestPayload {
  namespace: string;
  boundary: {
    host: "desktop";
    source: string;
  };
}

export interface DesktopHuggingFaceNamespaceDatasetsBrowseResponseValue {
  namespace: string;
  datasets: Array<{
    namespace: string;
    repository: string;
  }>;
}

export type DesktopHuggingFaceNamespaceDatasetsBrowseRequest = IpcRequest<
  DesktopHuggingFaceNamespaceDatasetsBrowseRequestPayload,
  typeof DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL.value
>;

export type DesktopHuggingFaceNamespaceDatasetsBrowseResponse = IpcResponse<
  DesktopHuggingFaceNamespaceDatasetsBrowseResponseValue,
  Record<string, unknown>,
  typeof DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_RESPONSE_CHANNEL.value
>;

export function createDesktopHuggingFaceNamespaceDatasetsBrowseRequest(
  payload: DesktopHuggingFaceNamespaceDatasetsBrowseRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceNamespaceDatasetsBrowseRequest {
  const namespace = payload.namespace?.trim();
  const source = payload.boundary.source?.trim();
  if (!namespace) {
    throw new Error("namespace must be a non-empty string.");
  }
  if (!source) {
    throw new Error("boundary.source must be a non-empty string.");
  }

  return createIpcRequest(
    DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL,
    {
      namespace,
      boundary: {
        host: "desktop",
        source,
      },
    },
    options,
  );
}

export function createDesktopHuggingFaceNamespaceDatasetsBrowseSuccessResponse(
  value: DesktopHuggingFaceNamespaceDatasetsBrowseResponseValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceNamespaceDatasetsBrowseResponse {
  return createIpcSuccessResponse(
    DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_RESPONSE_CHANNEL,
    value,
    options,
  );
}
