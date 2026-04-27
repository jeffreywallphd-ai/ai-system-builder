import {
  DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL,
  createDesktopPythonRuntimeControlSuccessResponse,
  createDesktopPythonRuntimeStatusReadSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopPythonRuntimeControlRequest,
  type DesktopPythonRuntimeControlResponse,
  type DesktopPythonRuntimeStatusPayload,
  type DesktopPythonRuntimeStatusReadRequest,
  type DesktopPythonRuntimeStatusReadResponse,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface PythonRuntimeControlPort {
  startPythonRuntime: () => Promise<void>;
  stopPythonRuntime: () => Promise<void>;
  restartPythonRuntime: () => Promise<void>;
  unloadPythonRuntimeModel: () => Promise<void>;
  readPythonRuntimeStatus: () => Promise<DesktopPythonRuntimeStatusPayload>;
}

export interface RegisterPythonRuntimeIpcDependencies extends PythonRuntimeControlPort {
  ipcMain: IpcMainHandlePort;
}

interface RuntimeRequestCorrelation {
  requestId?: string;
  correlationId?: string;
}

function createRuntimeErrorDetails(operation: string): Record<string, string> {
  return { operation };
}

function mapStatusReadRuntimeErrorToIpcFailure(
  operation: string,
  request: RuntimeRequestCorrelation,
  error: unknown,
): DesktopPythonRuntimeStatusReadResponse {
  return createIpcFailureResponse(createIpcError(
    DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL,
    "internal",
    error instanceof Error ? error.message : "Python runtime operation failed.",
    {
      requestId: request.requestId,
      correlationId: request.correlationId,
      details: createRuntimeErrorDetails(operation),
    },
  ));
}

function mapControlRuntimeErrorToIpcFailure(
  operation: string,
  request: RuntimeRequestCorrelation,
  error: unknown,
): DesktopPythonRuntimeControlResponse {
  return createIpcFailureResponse(createIpcError(
    DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL,
    "internal",
    error instanceof Error ? error.message : "Python runtime operation failed.",
    {
      requestId: request.requestId,
      correlationId: request.correlationId,
      details: createRuntimeErrorDetails(operation),
    },
  ));
}

export function createDesktopPythonRuntimeStatusReadIpcHandler(
  dependencies: Pick<RegisterPythonRuntimeIpcDependencies, "readPythonRuntimeStatus">,
) {
  return async (
    _event: unknown,
    request: DesktopPythonRuntimeStatusReadRequest,
  ): Promise<DesktopPythonRuntimeStatusReadResponse> => {
    try {
      const status = await dependencies.readPythonRuntimeStatus();
      return createDesktopPythonRuntimeStatusReadSuccessResponse(
        status,
        {
          requestId: request.requestId,
          correlationId: request.correlationId,
        },
      );
    } catch (error) {
      return mapStatusReadRuntimeErrorToIpcFailure(
        "status-read",
        request,
        error,
      );
    }
  };
}

export function createDesktopPythonRuntimeControlIpcHandler(
  dependencies: Pick<RegisterPythonRuntimeIpcDependencies, "startPythonRuntime" | "stopPythonRuntime" | "restartPythonRuntime" | "unloadPythonRuntimeModel" | "readPythonRuntimeStatus">,
) {
  return async (
    _event: unknown,
    request: DesktopPythonRuntimeControlRequest,
  ): Promise<DesktopPythonRuntimeControlResponse> => {
    try {
      if (request.payload.action === "start") {
        await dependencies.startPythonRuntime();
      } else if (request.payload.action === "stop") {
        await dependencies.stopPythonRuntime();
      } else if (request.payload.action === "restart") {
        await dependencies.restartPythonRuntime();
      } else {
        await dependencies.unloadPythonRuntimeModel();
      }

      const status = await dependencies.readPythonRuntimeStatus();
      return createDesktopPythonRuntimeControlSuccessResponse(
        status,
        {
          requestId: request.requestId,
          correlationId: request.correlationId,
        },
      );
    } catch (error) {
      return mapControlRuntimeErrorToIpcFailure(
        request.payload.action,
        request,
        error,
      );
    }
  };
}

export function registerPythonRuntimeIpc(
  dependencies: RegisterPythonRuntimeIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL.value,
    createDesktopPythonRuntimeStatusReadIpcHandler({
      readPythonRuntimeStatus: dependencies.readPythonRuntimeStatus,
    }),
  );

  dependencies.ipcMain.handle(
    DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL.value,
    createDesktopPythonRuntimeControlIpcHandler({
      startPythonRuntime: dependencies.startPythonRuntime,
      stopPythonRuntime: dependencies.stopPythonRuntime,
      restartPythonRuntime: dependencies.restartPythonRuntime,
      unloadPythonRuntimeModel: dependencies.unloadPythonRuntimeModel,
      readPythonRuntimeStatus: dependencies.readPythonRuntimeStatus,
    }),
  );
}
