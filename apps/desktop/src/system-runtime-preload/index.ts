import { contextBridge, ipcRenderer } from "electron";

import {
  createSystemRuntimePreloadApi,
  type SystemRuntimePreloadApi,
} from "./systemRuntimePreloadApi";

export const SYSTEM_RUNTIME_PRELOAD_API_KEY = "systemRuntime";

export interface SystemRuntimeContextBridgePort {
  exposeInMainWorld(key: string, api: SystemRuntimePreloadApi): void;
}

export function exposeSystemRuntimePreloadApi(
  bridge: SystemRuntimeContextBridgePort,
  api: SystemRuntimePreloadApi,
): void {
  bridge.exposeInMainWorld(SYSTEM_RUNTIME_PRELOAD_API_KEY, api);
}

exposeSystemRuntimePreloadApi(
  contextBridge,
  createSystemRuntimePreloadApi({ ipcRenderer }),
);
