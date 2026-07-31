import { normalizeIngestionTaskTransportCommand, normalizeIngestionTaskTransportValue, type IngestionTaskTransportCommand, type IngestionTaskTransportValue } from "../ingestion";
import { createTransportOperation } from "../transport";
import { createWorkspaceId } from "../workspace";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_INGESTION_TASK_EXECUTE_OPERATION = createTransportOperation("ingestion", "task-execute");
export const DESKTOP_INGESTION_TASK_EXECUTE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_INGESTION_TASK_EXECUTE_OPERATION, "request");
export const DESKTOP_INGESTION_TASK_EXECUTE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_INGESTION_TASK_EXECUTE_OPERATION, "response");
export interface DesktopIngestionTaskExecutePayload { readonly command: IngestionTaskTransportCommand; readonly boundary: { readonly host: "desktop"; readonly source: string; readonly workspaceId: string } }
export type DesktopIngestionTaskExecuteRequest = IpcRequest<DesktopIngestionTaskExecutePayload, typeof DESKTOP_INGESTION_TASK_EXECUTE_OPERATION, Record<string, never>, typeof DESKTOP_INGESTION_TASK_EXECUTE_REQUEST_CHANNEL.value>;
export type DesktopIngestionTaskExecuteResponse = IpcResponse<IngestionTaskTransportValue, Record<string, unknown>, typeof DESKTOP_INGESTION_TASK_EXECUTE_OPERATION, Record<string, never>, typeof DESKTOP_INGESTION_TASK_EXECUTE_RESPONSE_CHANNEL.value>;

export function createDesktopIngestionTaskExecuteRequest(payload: DesktopIngestionTaskExecutePayload, options?: { requestId?: string; correlationId?: string }): DesktopIngestionTaskExecuteRequest {
  const source = payload.boundary.source.trim(); if (!source) throw new Error("Ingestion task boundary source is required.");
  return createIpcRequest(DESKTOP_INGESTION_TASK_EXECUTE_REQUEST_CHANNEL, { command: normalizeIngestionTaskTransportCommand(payload.command), boundary: { host: "desktop", source, workspaceId: createWorkspaceId(payload.boundary.workspaceId) } }, options);
}
export function createDesktopIngestionTaskExecuteSuccessResponse(value: IngestionTaskTransportValue, options?: { requestId?: string; correlationId?: string }): DesktopIngestionTaskExecuteResponse { return createIpcSuccessResponse(DESKTOP_INGESTION_TASK_EXECUTE_RESPONSE_CHANNEL, normalizeIngestionTaskTransportValue(value), options); }
