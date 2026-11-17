import {
  normalizeContextManagementTransportCommand,
  type ContextManagementTransportCommand,
  type ContextManagementTransportValue,
} from "../context-management";
import { createTransportOperation } from "../transport";
import { createWorkspaceId } from "../workspace";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import {
  createIpcSuccessResponse,
  type IpcResponse,
} from "./ipc-response";

export const DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_OPERATION =
  createTransportOperation("context-management", "execute");
export const DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_REQUEST_CHANNEL =
  createIpcChannel(
    DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_OPERATION,
    "request",
  );
export const DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_RESPONSE_CHANNEL =
  createIpcChannel(
    DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_OPERATION,
    "response",
  );

export interface DesktopContextManagementExecutePayload {
  readonly command: ContextManagementTransportCommand;
  readonly boundary: {
    readonly host: "desktop";
    readonly source: string;
    readonly workspaceId: string;
  };
}

export type DesktopContextManagementExecuteRequest = IpcRequest<
  DesktopContextManagementExecutePayload,
  typeof DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_REQUEST_CHANNEL.value
>;

export type DesktopContextManagementExecuteResponse = IpcResponse<
  ContextManagementTransportValue,
  Record<string, unknown>,
  typeof DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_RESPONSE_CHANNEL.value
>;

export function createDesktopContextManagementExecuteRequest(
  payload: DesktopContextManagementExecutePayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopContextManagementExecuteRequest {
  const source = payload.boundary.source.trim();
  if (!source) {
    throw new Error("Context Management boundary source is required.");
  }
  return createIpcRequest(
    DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_REQUEST_CHANNEL,
    {
      command: normalizeContextManagementTransportCommand(payload.command),
      boundary: {
        host: "desktop",
        source,
        workspaceId: createWorkspaceId(payload.boundary.workspaceId),
      },
    },
    options,
  );
}

export function createDesktopContextManagementExecuteSuccessResponse(
  value: ContextManagementTransportValue,
  options?: { requestId?: string; correlationId?: string },
): DesktopContextManagementExecuteResponse {
  return createIpcSuccessResponse(
    DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_RESPONSE_CHANNEL,
    value,
    options,
  );
}
