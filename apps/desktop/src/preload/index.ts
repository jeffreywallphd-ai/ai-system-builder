import { contextBridge, ipcRenderer } from "electron";
import { DESKTOP_UI_CONTROL_RETIRED_EVENT, readUiControlAttempt } from "../../../../modules/contracts/headless";

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

let windowRetirementListener: ((target: NonNullable<ReturnType<typeof readUiControlAttempt>>) => void) | undefined;
const api = createDesktopPreloadApi({
  ipcRenderer,
  memoryDiagnosticsEnabled: process.env.DESKTOP_MEMORY_DIAGNOSTICS === "1",
  listenForWindowRetirement(listener) {
    windowRetirementListener = listener;
    return () => { if (windowRetirementListener === listener) windowRetirementListener = undefined; };
  },
});

ipcRenderer.on?.(DESKTOP_UI_CONTROL_RETIRED_EVENT, (_event, value: unknown) => {
  const target = readUiControlAttempt(value);
  if (target) windowRetirementListener?.(target);
});
exposeDesktopPreloadApi(contextBridge, api);
