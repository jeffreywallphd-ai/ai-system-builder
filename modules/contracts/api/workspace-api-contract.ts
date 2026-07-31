import type {
  ActiveWorkspaceSelection,
  CreateWorkspaceCommand,
  WorkspaceRecord,
  WorkspaceSystemPackActivation,
} from "../workspace";
import { createTransportOperation } from "../transport";
import { createApiError } from "./api-error";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_WORKSPACE_LIST_OPERATION = createTransportOperation("workspace", "list") as "workspace.list";
export const API_WORKSPACE_CREATE_OPERATION = createTransportOperation("workspace", "create") as "workspace.create";
export const API_WORKSPACE_SELECTION_READ_OPERATION = createTransportOperation("workspace", "selection-read") as "workspace.selection-read";
export const API_WORKSPACE_SELECTION_SAVE_OPERATION = createTransportOperation("workspace", "selection-save") as "workspace.selection-save";
export const API_WORKSPACE_SELECTION_CLEAR_OPERATION = createTransportOperation("workspace", "selection-clear") as "workspace.selection-clear";

export type ApiWorkspaceOperation =
  | typeof API_WORKSPACE_LIST_OPERATION
  | typeof API_WORKSPACE_CREATE_OPERATION
  | typeof API_WORKSPACE_SELECTION_READ_OPERATION
  | typeof API_WORKSPACE_SELECTION_SAVE_OPERATION
  | typeof API_WORKSPACE_SELECTION_CLEAR_OPERATION;

export interface ApiWorkspaceCreatePayload {
  readonly command: CreateWorkspaceCommand;
  readonly selectAfterCreate?: boolean;
}

export interface ApiWorkspaceSelectionSavePayload {
  readonly selection: ActiveWorkspaceSelection;
}

export interface ApiWorkspaceListValue {
  readonly workspaces: readonly WorkspaceRecord[];
}

export interface ApiWorkspaceCreateValue {
  readonly workspace?: WorkspaceRecord;
  readonly activeSelection?: ActiveWorkspaceSelection;
  readonly systemPackActivations?: readonly WorkspaceSystemPackActivation[];
}

export type ApiWorkspaceListResponse = ApiResponse<
  ApiWorkspaceListValue,
  Record<string, unknown>,
  typeof API_WORKSPACE_LIST_OPERATION,
  Record<string, never>
>;

export type ApiWorkspaceCreateResponse = ApiResponse<
  ApiWorkspaceCreateValue,
  Record<string, unknown>,
  typeof API_WORKSPACE_CREATE_OPERATION,
  Record<string, never>
>;

export type ApiWorkspaceSelectionReadResponse = ApiResponse<
  ActiveWorkspaceSelection,
  Record<string, unknown>,
  typeof API_WORKSPACE_SELECTION_READ_OPERATION,
  Record<string, never>
>;

export type ApiWorkspaceSelectionSaveResponse = ApiResponse<
  ActiveWorkspaceSelection,
  Record<string, unknown>,
  typeof API_WORKSPACE_SELECTION_SAVE_OPERATION,
  Record<string, never>
>;

export type ApiWorkspaceSelectionClearResponse = ApiResponse<
  ActiveWorkspaceSelection,
  Record<string, unknown>,
  typeof API_WORKSPACE_SELECTION_CLEAR_OPERATION,
  Record<string, never>
>;

export function createApiWorkspaceListSuccessResponse(
  value: ApiWorkspaceListValue,
  options?: { requestId?: string; correlationId?: string },
): ApiWorkspaceListResponse {
  return createApiSuccessResponse(API_WORKSPACE_LIST_OPERATION, value, options);
}

export function createApiWorkspaceCreateSuccessResponse(
  value: ApiWorkspaceCreateValue,
  options?: { requestId?: string; correlationId?: string },
): ApiWorkspaceCreateResponse {
  return createApiSuccessResponse(API_WORKSPACE_CREATE_OPERATION, value, options);
}

export function createApiWorkspaceSelectionReadSuccessResponse(
  value: ActiveWorkspaceSelection,
  options?: { requestId?: string; correlationId?: string },
): ApiWorkspaceSelectionReadResponse {
  return createApiSuccessResponse(API_WORKSPACE_SELECTION_READ_OPERATION, value, options);
}

export function createApiWorkspaceSelectionSaveSuccessResponse(
  value: ActiveWorkspaceSelection,
  options?: { requestId?: string; correlationId?: string },
): ApiWorkspaceSelectionSaveResponse {
  return createApiSuccessResponse(API_WORKSPACE_SELECTION_SAVE_OPERATION, value, options);
}

export function createApiWorkspaceSelectionClearSuccessResponse(
  value: ActiveWorkspaceSelection,
  options?: { requestId?: string; correlationId?: string },
): ApiWorkspaceSelectionClearResponse {
  return createApiSuccessResponse(API_WORKSPACE_SELECTION_CLEAR_OPERATION, value, options);
}

export function createApiWorkspaceFailureResponse(
  operation: ApiWorkspaceOperation,
  code: "validation" | "internal" | "not-found" | "unavailable",
  message: string,
  options?: { requestId?: string; correlationId?: string; details?: Record<string, unknown> },
): ApiResponse<unknown, Record<string, unknown>, ApiWorkspaceOperation, Record<string, never>> {
  return createApiFailureResponse(createApiError(operation, code, message, options), options);
}
