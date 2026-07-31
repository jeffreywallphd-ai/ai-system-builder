import { normalizeIngestionTaskTransportCommand, normalizeIngestionTaskTransportValue, type IngestionTaskTransportCommand, type IngestionTaskTransportValue } from "../ingestion";
import type { ContractErrorCode } from "../shared";
import { createTransportOperation } from "../transport";
import { createWorkspaceId } from "../workspace";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";

export const API_INGESTION_TASK_EXECUTE_OPERATION = createTransportOperation("ingestion", "task-execute");
export interface ApiIngestionTaskExecutePayload { readonly workspaceId: string; readonly command: IngestionTaskTransportCommand; readonly boundary: { readonly host: "server"; readonly source: string } }
export type ApiIngestionTaskExecuteRequest = ApiRequest<ApiIngestionTaskExecutePayload, typeof API_INGESTION_TASK_EXECUTE_OPERATION, Record<string, never>>;
export type ApiIngestionTaskExecuteResponse = ApiResponse<IngestionTaskTransportValue, Record<string, unknown>, typeof API_INGESTION_TASK_EXECUTE_OPERATION, Record<string, never>>;

export function createApiIngestionTaskExecuteRequest(payload: ApiIngestionTaskExecutePayload, options?: { requestId?: string; correlationId?: string }): ApiIngestionTaskExecuteRequest {
  const source = payload.boundary.source.trim(); if (!source) throw new Error("Ingestion task boundary source is required.");
  return createApiRequest(API_INGESTION_TASK_EXECUTE_OPERATION, { workspaceId: createWorkspaceId(payload.workspaceId), command: normalizeIngestionTaskTransportCommand(payload.command), boundary: { host: "server", source } }, options);
}
export function createApiIngestionTaskExecuteSuccessResponse(value: IngestionTaskTransportValue, options?: { requestId?: string; correlationId?: string }): ApiIngestionTaskExecuteResponse { return createApiSuccessResponse(API_INGESTION_TASK_EXECUTE_OPERATION, normalizeIngestionTaskTransportValue(value), options); }
export function createApiIngestionTaskExecuteFailureResponse(code: ContractErrorCode, message: string, options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string }): ApiIngestionTaskExecuteResponse { return createApiFailureResponse(createApiError(API_INGESTION_TASK_EXECUTE_OPERATION, code, message, options), options); }
