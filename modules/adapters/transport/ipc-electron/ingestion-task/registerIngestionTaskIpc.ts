import type { ApplicationRequestContext } from "../../../../application/ports";
import type { ContractErrorCode, ContractResult } from "../../../../contracts/shared";
import type { IngestionTaskTransportCommand, IngestionTaskTransportValue } from "../../../../contracts/ingestion";
import {
  DESKTOP_INGESTION_TASK_EXECUTE_REQUEST_CHANNEL,
  DESKTOP_INGESTION_TASK_EXECUTE_RESPONSE_CHANNEL,
  createDesktopIngestionTaskExecuteRequest,
  createDesktopIngestionTaskExecuteSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopIngestionTaskExecuteRequest,
  type DesktopIngestionTaskExecuteResponse,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort, IpcSenderTrustPolicy } from "../ipcMainHandlePort";

export interface IngestionTaskCommandUseCasePort {
  executeCommand(command: IngestionTaskTransportCommand, context?: ApplicationRequestContext): Promise<ContractResult<IngestionTaskTransportValue>>;
}

export interface RegisterIngestionTaskIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly senderTrust: IpcSenderTrustPolicy;
  readonly ingestionTasks: IngestionTaskCommandUseCasePort;
}

export function createDesktopIngestionTaskIpcHandler(dependencies: Omit<RegisterIngestionTaskIpcDependencies, "ipcMain">) {
  return async (event: unknown, request: DesktopIngestionTaskExecuteRequest): Promise<DesktopIngestionTaskExecuteResponse> => {
    const requestId = typeof request?.requestId === "string" ? request.requestId : undefined;
    const correlationId = typeof request?.correlationId === "string" ? request.correlationId : undefined;
    if (!dependencies.senderTrust.isTrustedSender(event)) return createFailure("forbidden", "The desktop IPC sender is not trusted.", requestId, correlationId);
    try {
      const normalized = createDesktopIngestionTaskExecuteRequest(request.payload, { requestId, correlationId });
      const result = await dependencies.ingestionTasks.executeCommand(normalized.payload.command, {
        requestId,
        correlationId,
        workspaceId: normalized.payload.boundary.workspaceId,
      });
      if (result.ok) return createDesktopIngestionTaskExecuteSuccessResponse(result.value, { requestId: result.requestId ?? requestId, correlationId: result.correlationId ?? correlationId });
      return createFailure(result.error.code, result.error.message, result.requestId ?? requestId, result.correlationId ?? correlationId, result.error.details);
    } catch (error) {
      return createFailure("validation", error instanceof Error ? error.message : "The ingestion task request is invalid.", requestId, correlationId);
    }
  };
}

function createFailure(code: ContractErrorCode, message: string, requestId?: string, correlationId?: string, details?: Readonly<Record<string, unknown>>): DesktopIngestionTaskExecuteResponse {
  return createIpcFailureResponse(createIpcError(DESKTOP_INGESTION_TASK_EXECUTE_RESPONSE_CHANNEL, code, message, { requestId, correlationId, details }));
}

export function registerIngestionTaskIpc(dependencies: RegisterIngestionTaskIpcDependencies): void {
  dependencies.ipcMain.handle(DESKTOP_INGESTION_TASK_EXECUTE_REQUEST_CHANNEL.value, createDesktopIngestionTaskIpcHandler(dependencies));
}
