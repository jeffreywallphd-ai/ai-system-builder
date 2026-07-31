import {
  DESKTOP_COMFYUI_INSTALL_REPAIR_REQUEST_CHANNEL,
  DESKTOP_COMFYUI_INSTALL_REPAIR_RESPONSE_CHANNEL,
  DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_COMFYUI_INSTALL_STATUS_READ_RESPONSE_CHANNEL,
  createDesktopComfyUiRepairInstallSuccessResponse,
  createDesktopComfyUiInstallStatusSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopComfyUiInstallStatusRequest,
  type DesktopComfyUiInstallStatusResponse,
  type DesktopComfyUiRepairInstallRequest,
  type DesktopComfyUiRepairInstallResponse,
} from "../../../../contracts/ipc";
import type { RuntimeInstallResult, RuntimeInstallStatusResult } from "../../../../contracts/runtime-installer";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface DesktopComfyUiRuntimeIpcFeature {
  readInstallStatus: (request: DesktopComfyUiInstallStatusRequest) => Promise<RuntimeInstallStatusResult>;
  repairInstall: (request: DesktopComfyUiRepairInstallRequest) => Promise<RuntimeInstallResult>;
}

export interface RegisterComfyUiRuntimeIpcDependencies { ipcMain: IpcMainHandlePort; comfyUi: DesktopComfyUiRuntimeIpcFeature; }

export function registerComfyUiRuntimeIpc(dependencies: RegisterComfyUiRuntimeIpcDependencies): void {
  dependencies.ipcMain.handle(DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL.value, async (_event, request: DesktopComfyUiInstallStatusRequest): Promise<DesktopComfyUiInstallStatusResponse> => {
    try {
      const value = await dependencies.comfyUi.readInstallStatus(request);
      return createDesktopComfyUiInstallStatusSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return createIpcFailureResponse(createIpcError(
        DESKTOP_COMFYUI_INSTALL_STATUS_READ_RESPONSE_CHANNEL,
        "internal",
        error instanceof Error ? error.message : "Failed to read ComfyUI install status.",
        { requestId: request.requestId, correlationId: request.correlationId },
      ));
    }
  });

  dependencies.ipcMain.handle(DESKTOP_COMFYUI_INSTALL_REPAIR_REQUEST_CHANNEL.value, async (_event, request: DesktopComfyUiRepairInstallRequest): Promise<DesktopComfyUiRepairInstallResponse> => {
    try {
      const value = await dependencies.comfyUi.repairInstall(request);
      return createDesktopComfyUiRepairInstallSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return createIpcFailureResponse(createIpcError(
        DESKTOP_COMFYUI_INSTALL_REPAIR_RESPONSE_CHANNEL,
        "internal",
        error instanceof Error ? error.message : "Failed to repair ComfyUI install.",
        { requestId: request.requestId, correlationId: request.correlationId },
      ));
    }
  });
}
