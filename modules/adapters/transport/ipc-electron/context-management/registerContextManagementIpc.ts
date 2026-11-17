import type { ApplicationRequestContext } from "../../../../application/ports";
import type {
  ContextManagementTransportCommand,
  ContextManagementTransportValue,
} from "../../../../contracts/context-management";
import {
  DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_REQUEST_CHANNEL,
  DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_RESPONSE_CHANNEL,
  createDesktopContextManagementExecuteRequest,
  createDesktopContextManagementExecuteSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopContextManagementExecuteRequest,
  type DesktopContextManagementExecuteResponse,
} from "../../../../contracts/ipc";
import type {
  ContractErrorCode,
  ContractResult,
} from "../../../../contracts/shared";
import type {
  IpcMainHandlePort,
  IpcSenderTrustPolicy,
} from "../ipcMainHandlePort";

export interface ContextManagementCommandUseCasePort {
  executeCommand(
    command: ContextManagementTransportCommand,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ContextManagementTransportValue>>;
}

export interface RegisterContextManagementIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly senderTrust: IpcSenderTrustPolicy;
  readonly contextManagement: ContextManagementCommandUseCasePort;
  readonly getAuthoritativeRequestContext?: () => Pick<
    ApplicationRequestContext,
    "organizationId" | "principalId"
  >;
}

export function createDesktopContextManagementIpcHandler(
  dependencies: Omit<RegisterContextManagementIpcDependencies, "ipcMain">,
) {
  return async (
    event: unknown,
    request: DesktopContextManagementExecuteRequest,
  ): Promise<DesktopContextManagementExecuteResponse> => {
    const requestId =
      typeof request?.requestId === "string"
        ? request.requestId
        : undefined;
    const correlationId =
      typeof request?.correlationId === "string"
        ? request.correlationId
        : undefined;
    if (!dependencies.senderTrust.isTrustedSender(event)) {
      return failure(
        "forbidden",
        "The desktop IPC sender is not trusted.",
        requestId,
        correlationId,
      );
    }
    try {
      const normalized = createDesktopContextManagementExecuteRequest(
        request.payload,
        { requestId, correlationId },
      );
      const result = await dependencies.contextManagement.executeCommand(
        normalized.payload.command,
        {
          requestId,
          correlationId,
          workspaceId: normalized.payload.boundary.workspaceId,
          ...dependencies.getAuthoritativeRequestContext?.(),
        },
      );
      if (result.ok) {
        return createDesktopContextManagementExecuteSuccessResponse(
          result.value,
          {
            requestId: result.requestId ?? requestId,
            correlationId: result.correlationId ?? correlationId,
          },
        );
      }
      return failure(
        result.error.code,
        result.error.message,
        result.requestId ?? requestId,
        result.correlationId ?? correlationId,
        result.error.details,
      );
    } catch {
      return failure(
        "validation",
        "The Context Management request is invalid.",
        requestId,
        correlationId,
      );
    }
  };
}

function failure(
  code: ContractErrorCode,
  message: string,
  requestId?: string,
  correlationId?: string,
  details?: Readonly<Record<string, unknown>>,
): DesktopContextManagementExecuteResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_RESPONSE_CHANNEL,
      code,
      message,
      { requestId, correlationId, details },
    ),
  );
}

export function registerContextManagementIpc(
  dependencies: RegisterContextManagementIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_REQUEST_CHANNEL.value,
    createDesktopContextManagementIpcHandler(dependencies),
  );
}
