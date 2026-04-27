import type {
  ClearApplicationSettingRequest,
  ClearApplicationSettingResult,
  ListApplicationSettingDefinitionsRequest,
  ListApplicationSettingDefinitionsResult,
  ReadApplicationSettingsRequest,
  ReadApplicationSettingsResult,
  ResolveModelDefaultRequest,
  ResolvedModelDefault,
  UpdateApplicationSettingRequest,
  UpdateApplicationSettingResult,
} from "../settings";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION = createTransportOperation("application-settings", "list-definitions");
export const DESKTOP_APPLICATION_SETTINGS_READ_OPERATION = createTransportOperation("application-settings", "read");
export const DESKTOP_APPLICATION_SETTINGS_UPDATE_OPERATION = createTransportOperation("application-settings", "update");
export const DESKTOP_APPLICATION_SETTINGS_CLEAR_OPERATION = createTransportOperation("application-settings", "clear");
export const DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_OPERATION = createTransportOperation("application-settings", "resolve-model-default");

export const DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION,
  "request",
);
export const DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION,
  "response",
);

export const DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_READ_OPERATION,
  "request",
);
export const DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_READ_OPERATION,
  "response",
);

export const DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_UPDATE_OPERATION,
  "request",
);
export const DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_UPDATE_OPERATION,
  "response",
);

export const DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_CLEAR_OPERATION,
  "request",
);
export const DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_CLEAR_OPERATION,
  "response",
);

export const DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_OPERATION,
  "request",
);
export const DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_OPERATION,
  "response",
);

export type DesktopApplicationSettingsListDefinitionsRequest = IpcRequest<
  ListApplicationSettingDefinitionsRequest,
  typeof DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL.value
>;

export type DesktopApplicationSettingsListDefinitionsResponse = IpcResponse<
  ListApplicationSettingDefinitionsResult,
  Record<string, unknown>,
  typeof DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL.value
>;

export type DesktopApplicationSettingsReadRequest = IpcRequest<
  ReadApplicationSettingsRequest,
  typeof DESKTOP_APPLICATION_SETTINGS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL.value
>;

export type DesktopApplicationSettingsReadResponse = IpcResponse<
  ReadApplicationSettingsResult,
  Record<string, unknown>,
  typeof DESKTOP_APPLICATION_SETTINGS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL.value
>;

export type DesktopApplicationSettingsUpdateRequest = IpcRequest<
  UpdateApplicationSettingRequest,
  typeof DESKTOP_APPLICATION_SETTINGS_UPDATE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL.value
>;

export type DesktopApplicationSettingsUpdateResponse = IpcResponse<
  UpdateApplicationSettingResult,
  Record<string, unknown>,
  typeof DESKTOP_APPLICATION_SETTINGS_UPDATE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL.value
>;

export type DesktopApplicationSettingsClearRequest = IpcRequest<
  ClearApplicationSettingRequest,
  typeof DESKTOP_APPLICATION_SETTINGS_CLEAR_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL.value
>;

export type DesktopApplicationSettingsClearResponse = IpcResponse<
  ClearApplicationSettingResult,
  Record<string, unknown>,
  typeof DESKTOP_APPLICATION_SETTINGS_CLEAR_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL.value
>;

export type DesktopApplicationSettingsResolveModelDefaultRequest = IpcRequest<
  ResolveModelDefaultRequest,
  typeof DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL.value
>;

export type DesktopApplicationSettingsResolveModelDefaultResponse = IpcResponse<
  { resolved: ResolvedModelDefault },
  Record<string, unknown>,
  typeof DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_OPERATION,
  Record<string, never>,
  typeof DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL.value
>;

export function createDesktopApplicationSettingsListDefinitionsRequest(
  payload: ListApplicationSettingDefinitionsRequest = {},
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsListDefinitionsRequest {
  return createIpcRequest(DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL, payload, options);
}

export function createDesktopApplicationSettingsListDefinitionsSuccessResponse(
  result: ListApplicationSettingDefinitionsResult,
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsListDefinitionsResponse {
  return createIpcSuccessResponse(DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL, result, options);
}

export function createDesktopApplicationSettingsReadRequest(
  payload: ReadApplicationSettingsRequest = {},
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsReadRequest {
  return createIpcRequest(DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL, payload, options);
}

export function createDesktopApplicationSettingsReadSuccessResponse(
  result: ReadApplicationSettingsResult,
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsReadResponse {
  return createIpcSuccessResponse(DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL, result, options);
}

export function createDesktopApplicationSettingsUpdateRequest(
  payload: UpdateApplicationSettingRequest,
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsUpdateRequest {
  return createIpcRequest(DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL, payload, options);
}

export function createDesktopApplicationSettingsUpdateSuccessResponse(
  result: UpdateApplicationSettingResult,
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsUpdateResponse {
  return createIpcSuccessResponse(DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL, result, options);
}

export function createDesktopApplicationSettingsClearRequest(
  payload: ClearApplicationSettingRequest,
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsClearRequest {
  return createIpcRequest(DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL, payload, options);
}

export function createDesktopApplicationSettingsClearSuccessResponse(
  result: ClearApplicationSettingResult,
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsClearResponse {
  return createIpcSuccessResponse(DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL, result, options);
}

export function createDesktopApplicationSettingsResolveModelDefaultRequest(
  payload: ResolveModelDefaultRequest,
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsResolveModelDefaultRequest {
  return createIpcRequest(DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL, payload, options);
}

export function createDesktopApplicationSettingsResolveModelDefaultSuccessResponse(
  resolved: ResolvedModelDefault,
  options?: { requestId?: string; correlationId?: string },
): DesktopApplicationSettingsResolveModelDefaultResponse {
  return createIpcSuccessResponse(
    DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL,
    { resolved },
    options,
  );
}

export function getDesktopApplicationSettingsChannel(
  operation: "listDefinitions" | "readSettings" | "updateSetting" | "clearSetting" | "resolveModelDefault",
  kind: "request" | "response",
) {
  if (operation === "listDefinitions") {
    return kind === "request"
      ? DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL
      : DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL;
  }
  if (operation === "readSettings") {
    return kind === "request" ? DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL : DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL;
  }
  if (operation === "updateSetting") {
    return kind === "request" ? DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL : DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL;
  }
  if (operation === "clearSetting") {
    return kind === "request" ? DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL : DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL;
  }
  return kind === "request"
    ? DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL
    : DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL;
}
