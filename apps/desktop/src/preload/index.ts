import { contextBridge, ipcRenderer } from "electron";

import { createDesktopPreloadApi, type DesktopPreloadApi } from "./exposedApi";

export const DESKTOP_PRELOAD_API_KEY = "desktopApi";

export interface ContextBridgeExposePort {
  exposeInMainWorld: (apiKey: string, api: DesktopPreloadApi) => void;
}

export function exposeDesktopPreloadApi(
  bridge: ContextBridgeExposePort,
  api: DesktopPreloadApi,
): void {
  bridge.exposeInMainWorld(DESKTOP_PRELOAD_API_KEY, api);
}

const api = createDesktopPreloadApi({
  ipcRenderer,
  memoryDiagnosticsEnabled: process.env.DESKTOP_MEMORY_DIAGNOSTICS === "1",
});

exposeDesktopPreloadApi(contextBridge, api);
