import type {
  ActiveWorkspaceSelection,
  CreateWorkspaceCommand,
  WorkspaceRecord,
  WorkspaceSystemPackActivation,
} from "../workspace";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcError } from "./ipc-error";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import {
  createIpcFailureResponse,
  createIpcSuccessResponse,
  type IpcResponse,
} from "./ipc-response";

export const DESKTOP_WORKSPACE_LIST_OPERATION = createTransportOperation("workspace", "list") as "workspace.list";
export const DESKTOP_WORKSPACE_CREATE_OPERATION = createTransportOperation("workspace", "create") as "workspace.create";
export const DESKTOP_WORKSPACE_SELECTION_READ_OPERATION = createTransportOperation("workspace", "selection-read") as "workspace.selection-read";
export const DESKTOP_WORKSPACE_SELECTION_SAVE_OPERATION = createTransportOperation("workspace", "selection-save") as "workspace.selection-save";
export const DESKTOP_WORKSPACE_SELECTION_CLEAR_OPERATION = createTransportOperation("workspace", "selection-clear") as "workspace.selection-clear";

export type DesktopWorkspaceOperation =
  | typeof DESKTOP_WORKSPACE_LIST_OPERATION
  | typeof DESKTOP_WORKSPACE_CREATE_OPERATION
  | typeof DESKTOP_WORKSPACE_SELECTION_READ_OPERATION
  | typeof DESKTOP_WORKSPACE_SELECTION_SAVE_OPERATION
  | typeof DESKTOP_WORKSPACE_SELECTION_CLEAR_OPERATION;

export const DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_LIST_OPERATION, "request");
export const DESKTOP_WORKSPACE_LIST_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_LIST_OPERATION, "response");
export const DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_CREATE_OPERATION, "request");
export const DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_CREATE_OPERATION, "response");
export const DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_SELECTION_READ_OPERATION, "request");
export const DESKTOP_WORKSPACE_SELECTION_READ_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_SELECTION_READ_OPERATION, "response");
export const DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_SELECTION_SAVE_OPERATION, "request");
export const DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_SELECTION_SAVE_OPERATION, "response");
export const DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_SELECTION_CLEAR_OPERATION, "request");
export const DESKTOP_WORKSPACE_SELECTION_CLEAR_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_WORKSPACE_SELECTION_CLEAR_OPERATION, "response");

export interface DesktopWorkspaceCreatePayload {
  readonly command: CreateWorkspaceCommand;
  readonly selectAfterCreate?: boolean;
}

export interface DesktopWorkspaceSelectionSavePayload {
  readonly selection: ActiveWorkspaceSelection;
}

export interface DesktopWorkspaceListPayload {
  readonly includeArchived?: boolean;
}

export interface DesktopWorkspaceListValue {
  readonly workspaces: readonly WorkspaceRecord[];
}

export interface DesktopWorkspaceCreateValue {
  readonly workspace?: WorkspaceRecord;
  readonly activeSelection?: ActiveWorkspaceSelection;
  readonly systemPackActivations?: readonly WorkspaceSystemPackActivation[];
}

export type DesktopWorkspaceListRequest = IpcRequest<
  DesktopWorkspaceListPayload,
  typeof DESKTOP_WORKSPACE_LIST_OPERATION,
  Record<string, never>
>;
export type DesktopWorkspaceCreateRequest = IpcRequest<
  DesktopWorkspaceCreatePayload,
  typeof DESKTOP_WORKSPACE_CREATE_OPERATION,
  Record<string, never>
>;
export type DesktopWorkspaceSelectionReadRequest = IpcRequest<
  Record<string, never>,
  typeof DESKTOP_WORKSPACE_SELECTION_READ_OPERATION,
  Record<string, never>
>;
export type DesktopWorkspaceSelectionSaveRequest = IpcRequest<
  DesktopWorkspaceSelectionSavePayload,
  typeof DESKTOP_WORKSPACE_SELECTION_SAVE_OPERATION,
  Record<string, never>
>;
export type DesktopWorkspaceSelectionClearRequest = IpcRequest<
  Record<string, never>,
  typeof DESKTOP_WORKSPACE_SELECTION_CLEAR_OPERATION,
  Record<string, never>
>;

export type DesktopWorkspaceListResponse = IpcResponse<
  DesktopWorkspaceListValue,
  Record<string, unknown>,
  typeof DESKTOP_WORKSPACE_LIST_OPERATION,
  Record<string, never>,
  typeof DESKTOP_WORKSPACE_LIST_RESPONSE_CHANNEL.value
>;
export type DesktopWorkspaceCreateResponse = IpcResponse<
  DesktopWorkspaceCreateValue,
  Record<string, unknown>,
  typeof DESKTOP_WORKSPACE_CREATE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL.value
>;
export type DesktopWorkspaceSelectionReadResponse = IpcResponse<
  ActiveWorkspaceSelection,
  Record<string, unknown>,
  typeof DESKTOP_WORKSPACE_SELECTION_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_WORKSPACE_SELECTION_READ_RESPONSE_CHANNEL.value
>;
export type DesktopWorkspaceSelectionSaveResponse = IpcResponse<
  ActiveWorkspaceSelection,
  Record<string, unknown>,
  typeof DESKTOP_WORKSPACE_SELECTION_SAVE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL.value
>;
export type DesktopWorkspaceSelectionClearResponse = IpcResponse<
  ActiveWorkspaceSelection,
  Record<string, unknown>,
  typeof DESKTOP_WORKSPACE_SELECTION_CLEAR_OPERATION,
  Record<string, never>,
  typeof DESKTOP_WORKSPACE_SELECTION_CLEAR_RESPONSE_CHANNEL.value
>;

export type DesktopWorkspaceResponseChannelValue =
  | typeof DESKTOP_WORKSPACE_LIST_RESPONSE_CHANNEL.value
  | typeof DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL.value
  | typeof DESKTOP_WORKSPACE_SELECTION_READ_RESPONSE_CHANNEL.value
  | typeof DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL.value
  | typeof DESKTOP_WORKSPACE_SELECTION_CLEAR_RESPONSE_CHANNEL.value;

export type DesktopWorkspaceFailureResponse = IpcResponse<
  unknown,
  Record<string, unknown>,
  DesktopWorkspaceOperation,
  Record<string, never>,
  DesktopWorkspaceResponseChannelValue
>;

type DesktopWorkspaceResponseChannel =
  | typeof DESKTOP_WORKSPACE_LIST_RESPONSE_CHANNEL
  | typeof DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL
  | typeof DESKTOP_WORKSPACE_SELECTION_READ_RESPONSE_CHANNEL
  | typeof DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL
  | typeof DESKTOP_WORKSPACE_SELECTION_CLEAR_RESPONSE_CHANNEL;

export function createDesktopWorkspaceListRequest(
  payload: DesktopWorkspaceListPayload = {},
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceListRequest {
  return createIpcRequest(DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL, payload, options);
}

export function createDesktopWorkspaceCreateRequest(
  payload: DesktopWorkspaceCreatePayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceCreateRequest {
  return createIpcRequest(DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL, payload, options);
}

export function createDesktopWorkspaceSelectionReadRequest(
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceSelectionReadRequest {
  return createIpcRequest(DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL, {}, options);
}

export function createDesktopWorkspaceSelectionSaveRequest(
  payload: DesktopWorkspaceSelectionSavePayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceSelectionSaveRequest {
  return createIpcRequest(DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL, payload, options);
}

export function createDesktopWorkspaceSelectionClearRequest(
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceSelectionClearRequest {
  return createIpcRequest(DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL, {}, options);
}

export function createDesktopWorkspaceListSuccessResponse(
  value: DesktopWorkspaceListValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceListResponse {
  return createIpcSuccessResponse(DESKTOP_WORKSPACE_LIST_RESPONSE_CHANNEL, value, options);
}

export function createDesktopWorkspaceCreateSuccessResponse(
  value: DesktopWorkspaceCreateValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceCreateResponse {
  return createIpcSuccessResponse(DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL, value, options);
}

export function createDesktopWorkspaceSelectionReadSuccessResponse(
  value: ActiveWorkspaceSelection,
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceSelectionReadResponse {
  return createIpcSuccessResponse(DESKTOP_WORKSPACE_SELECTION_READ_RESPONSE_CHANNEL, value, options);
}

export function createDesktopWorkspaceSelectionSaveSuccessResponse(
  value: ActiveWorkspaceSelection,
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceSelectionSaveResponse {
  return createIpcSuccessResponse(DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL, value, options);
}

export function createDesktopWorkspaceSelectionClearSuccessResponse(
  value: ActiveWorkspaceSelection,
  options?: { requestId?: string; correlationId?: string },
): DesktopWorkspaceSelectionClearResponse {
  return createIpcSuccessResponse(DESKTOP_WORKSPACE_SELECTION_CLEAR_RESPONSE_CHANNEL, value, options);
}

export function createDesktopWorkspaceFailureResponse(
  channel: DesktopWorkspaceResponseChannel,
  code: "validation" | "internal" | "not-found" | "unavailable",
  message: string,
  options?: { requestId?: string; correlationId?: string; details?: Record<string, unknown> },
): DesktopWorkspaceFailureResponse {
  return createIpcFailureResponse(createIpcError(channel, code, message, options));
}
