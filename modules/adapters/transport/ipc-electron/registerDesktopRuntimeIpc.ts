import { registerComfyUiRuntimeIpc, type DesktopComfyUiRuntimeIpcFeature } from "./comfyui-runtime/registerComfyUiRuntimeIpc";
import type { IpcMainHandlePort } from "./ipcMainHandlePort";
import { lazyProvidedObject, type AsyncFeatureProvider } from "./lazyFeatureProvider";

export type { DesktopComfyUiRuntimeIpcFeature } from "./comfyui-runtime/registerComfyUiRuntimeIpc";

export interface RegisterDesktopRuntimeIpcDependencies {
  ipcMain: IpcMainHandlePort;
  getComfyUiFeature: AsyncFeatureProvider<DesktopComfyUiRuntimeIpcFeature>;
}

export function registerDesktopRuntimeIpc(dependencies: RegisterDesktopRuntimeIpcDependencies): void {
  registerComfyUiRuntimeIpc({
    ipcMain: dependencies.ipcMain,
    comfyUi: lazyProvidedObject(dependencies.getComfyUiFeature),
  });
}
