import type { RuntimeInstallResult, RuntimeInstallStatusResult } from "../runtime-installer";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_COMFYUI_INSTALL_STATUS_READ_OPERATION = createTransportOperation("comfyui-runtime", "read-install-status");
export const DESKTOP_COMFYUI_INSTALL_REPAIR_OPERATION = createTransportOperation("comfyui-runtime", "repair-install");

export const DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL = createIpcChannel(DESKTOP_COMFYUI_INSTALL_STATUS_READ_OPERATION, "request");
export const DESKTOP_COMFYUI_INSTALL_STATUS_READ_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_COMFYUI_INSTALL_STATUS_READ_OPERATION, "response");
export const DESKTOP_COMFYUI_INSTALL_REPAIR_REQUEST_CHANNEL = createIpcChannel(DESKTOP_COMFYUI_INSTALL_REPAIR_OPERATION, "request");
export const DESKTOP_COMFYUI_INSTALL_REPAIR_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_COMFYUI_INSTALL_REPAIR_OPERATION, "response");

export interface DesktopComfyUiInstallStatusRequestPayload { installRoot?: string; }
export interface DesktopComfyUiRepairInstallRequestPayload { allowUpdate?: boolean; forceRepair?: boolean; installRoot?: string; }

export type DesktopComfyUiInstallStatusRequest = IpcRequest<DesktopComfyUiInstallStatusRequestPayload, typeof DESKTOP_COMFYUI_INSTALL_STATUS_READ_OPERATION, Record<string, never>, typeof DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL.value>;
export type DesktopComfyUiInstallStatusResponse = IpcResponse<RuntimeInstallStatusResult, Record<string, unknown>, typeof DESKTOP_COMFYUI_INSTALL_STATUS_READ_OPERATION, Record<string, never>, typeof DESKTOP_COMFYUI_INSTALL_STATUS_READ_RESPONSE_CHANNEL.value>;
export type DesktopComfyUiRepairInstallRequest = IpcRequest<DesktopComfyUiRepairInstallRequestPayload, typeof DESKTOP_COMFYUI_INSTALL_REPAIR_OPERATION, Record<string, never>, typeof DESKTOP_COMFYUI_INSTALL_REPAIR_REQUEST_CHANNEL.value>;
export type DesktopComfyUiRepairInstallResponse = IpcResponse<RuntimeInstallResult, Record<string, unknown>, typeof DESKTOP_COMFYUI_INSTALL_REPAIR_OPERATION, Record<string, never>, typeof DESKTOP_COMFYUI_INSTALL_REPAIR_RESPONSE_CHANNEL.value>;

export const createDesktopComfyUiInstallStatusRequest = (payload: DesktopComfyUiInstallStatusRequestPayload = {}, options?: { requestId?: string; correlationId?: string }): DesktopComfyUiInstallStatusRequest => createIpcRequest(DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL, payload, options);
export const createDesktopComfyUiInstallStatusSuccessResponse = (value: RuntimeInstallStatusResult, options?: { requestId?: string; correlationId?: string }): DesktopComfyUiInstallStatusResponse => createIpcSuccessResponse(DESKTOP_COMFYUI_INSTALL_STATUS_READ_RESPONSE_CHANNEL, value, options);
export const createDesktopComfyUiRepairInstallRequest = (payload: DesktopComfyUiRepairInstallRequestPayload = {}, options?: { requestId?: string; correlationId?: string }): DesktopComfyUiRepairInstallRequest => createIpcRequest(DESKTOP_COMFYUI_INSTALL_REPAIR_REQUEST_CHANNEL, payload, options);
export const createDesktopComfyUiRepairInstallSuccessResponse = (value: RuntimeInstallResult, options?: { requestId?: string; correlationId?: string }): DesktopComfyUiRepairInstallResponse => createIpcSuccessResponse(DESKTOP_COMFYUI_INSTALL_REPAIR_RESPONSE_CHANNEL, value, options);
