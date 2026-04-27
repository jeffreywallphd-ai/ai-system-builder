import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_HUGGING_FACE_TOKEN_GET_OPERATION = "desktop.huggingface-token.get" as const;
export const DESKTOP_HUGGING_FACE_TOKEN_SET_OPERATION = "desktop.huggingface-token.set" as const;
export const DESKTOP_HUGGING_FACE_TOKEN_CLEAR_OPERATION = "desktop.huggingface-token.clear" as const;

export const DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_TOKEN_GET_OPERATION,
  "request",
);
export const DESKTOP_HUGGING_FACE_TOKEN_GET_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_TOKEN_GET_OPERATION,
  "response",
);
export const DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_TOKEN_SET_OPERATION,
  "request",
);
export const DESKTOP_HUGGING_FACE_TOKEN_SET_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_TOKEN_SET_OPERATION,
  "response",
);
export const DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_OPERATION,
  "request",
);
export const DESKTOP_HUGGING_FACE_TOKEN_CLEAR_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_OPERATION,
  "response",
);

export interface DesktopHuggingFaceTokenStatusValue {
  configured: boolean;
  maskedToken?: string;
}

export type DesktopHuggingFaceTokenGetRequest = IpcRequest<
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_GET_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL.value
>;

export type DesktopHuggingFaceTokenSetRequest = IpcRequest<
  { token: string },
  typeof DESKTOP_HUGGING_FACE_TOKEN_SET_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL.value
>;

export type DesktopHuggingFaceTokenClearRequest = IpcRequest<
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_CLEAR_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL.value
>;

export type DesktopHuggingFaceTokenGetResponse = IpcResponse<
  DesktopHuggingFaceTokenStatusValue,
  Record<string, unknown>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_GET_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_GET_RESPONSE_CHANNEL.value
>;

export type DesktopHuggingFaceTokenSetResponse = IpcResponse<
  DesktopHuggingFaceTokenStatusValue,
  Record<string, unknown>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_SET_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_SET_RESPONSE_CHANNEL.value
>;

export type DesktopHuggingFaceTokenClearResponse = IpcResponse<
  DesktopHuggingFaceTokenStatusValue,
  Record<string, unknown>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_CLEAR_OPERATION,
  Record<string, never>,
  typeof DESKTOP_HUGGING_FACE_TOKEN_CLEAR_RESPONSE_CHANNEL.value
>;

export function createDesktopHuggingFaceTokenGetRequest(
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceTokenGetRequest {
  return createIpcRequest(DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL, {}, options);
}

export function createDesktopHuggingFaceTokenSetRequest(
  payload: { token: string },
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceTokenSetRequest {
  const token = payload.token.trim();
  if (!token) {
    throw new Error("token must be a non-empty, trimmed string.");
  }
  return createIpcRequest(DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL, { token }, options);
}

export function createDesktopHuggingFaceTokenClearRequest(
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceTokenClearRequest {
  return createIpcRequest(DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL, {}, options);
}

export function createDesktopHuggingFaceTokenGetSuccessResponse(
  value: DesktopHuggingFaceTokenStatusValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceTokenGetResponse {
  return createIpcSuccessResponse(DESKTOP_HUGGING_FACE_TOKEN_GET_RESPONSE_CHANNEL, value, options);
}

export function createDesktopHuggingFaceTokenSetSuccessResponse(
  value: DesktopHuggingFaceTokenStatusValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceTokenSetResponse {
  return createIpcSuccessResponse(DESKTOP_HUGGING_FACE_TOKEN_SET_RESPONSE_CHANNEL, value, options);
}

export function createDesktopHuggingFaceTokenClearSuccessResponse(
  value: DesktopHuggingFaceTokenStatusValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopHuggingFaceTokenClearResponse {
  return createIpcSuccessResponse(DESKTOP_HUGGING_FACE_TOKEN_CLEAR_RESPONSE_CHANNEL, value, options);
}
