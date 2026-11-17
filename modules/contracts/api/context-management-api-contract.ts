import type {
  ContextManagementTransportCommand,
  ContextManagementTransportValue,
} from "../context-management";
import { createTransportOperation } from "../transport";
import type { ApiResponse } from "./api-response";

export const API_CONTEXT_MANAGEMENT_EXECUTE_OPERATION =
  createTransportOperation("context-management", "execute");

export interface ApiContextManagementExecuteCommand {
  readonly workspaceId: string;
  readonly command: ContextManagementTransportCommand;
}

export type ApiContextManagementExecuteResponse = ApiResponse<
  ContextManagementTransportValue,
  Record<string, unknown>,
  typeof API_CONTEXT_MANAGEMENT_EXECUTE_OPERATION
>;
