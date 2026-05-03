import type { RuntimeInstallerPort } from "../../../../application/ports/runtime-installer/runtime-installer.port";
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
import type { IpcMainHandlePort } from "../ipcMainHandlePort";
import { buildComfyUiInstallRequest } from "../../../runtime/installer/comfyui/createComfyUiRuntimeInstaller";

export interface RegisterComfyUiRuntimeIpcDependencies { ipcMain: IpcMainHandlePort; installer: RuntimeInstallerPort; installRoot: string; }

export function registerComfyUiRuntimeIpc(dependencies: RegisterComfyUiRuntimeIpcDependencies): void {
  dependencies.ipcMain.handle(DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL.value, async (_event, request: DesktopComfyUiInstallStatusRequest): Promise<DesktopComfyUiInstallStatusResponse> => {
    try {
      const value = await dependencies.installer.getInstallStatus({ targetId: "comfyui", installRoot: request.payload.installRoot ?? dependencies.installRoot });
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
      const installRequest = buildComfyUiInstallRequest({ installRoot: request.payload.installRoot ?? dependencies.installRoot, allowUpdate: request.payload.allowUpdate, forceRepair: request.payload.forceRepair });
      const value = await dependencies.installer.repairInstall?.(installRequest)
      ?? await dependencies.installer.ensureInstalled(installRequest);
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
