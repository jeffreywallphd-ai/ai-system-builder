import type { IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import {
  DESKTOP_HEADLESS_PAIRING_CHANNELS,
  isDesktopHeadlessClientId,
  readDesktopHeadlessPairingStatus,
  readDesktopHeadlessPairingRequest,
  type DesktopHeadlessClientAccess,
  type DesktopHeadlessPairingResult,
  type DesktopHeadlessRevokeResult,
  type DesktopHeadlessStartResult,
} from "../../../../modules/contracts/headless";
import type { DesktopHeadlessConnection } from "../../../../modules/hosts/desktop/composition/composeDesktopHeadlessConnection";

interface PairingWindow {
  isUsable(): boolean;
  confirm(workspaceLabel: string, access?: DesktopHeadlessClientAccess): Promise<boolean>;
  confirmStart(): Promise<boolean>;
  showCode(endpoint: string, fingerprint: string, code: string): Promise<void>;
}

/** Resolve and capture the exact foreground main frame, then recheck it after every wait. */
export function captureDesktopHeadlessPairingWindow<Window>(event: unknown, dependencies: {
  getFocusedWindow(): Window | null;
  ownsAndTrusts(window: Window, event: unknown): boolean;
  dialogs(window: Window): Omit<PairingWindow, "isUsable">;
}): PairingWindow | undefined {
  const window = dependencies.getFocusedWindow();
  if (!window || !dependencies.ownsAndTrusts(window, event)) return undefined;
  return {
    ...dependencies.dialogs(window),
    isUsable: () => dependencies.getFocusedWindow() === window && dependencies.ownsAndTrusts(window, event),
  };
}

export function registerDesktopHeadlessPairingIpc(dependencies: {
  readonly ipcMain: IpcMainHandlePort;
  readonly getConnection: () => DesktopHeadlessConnection | undefined;
  readonly resolveWindow: (event: unknown) => PairingWindow | undefined;
}) {
  let promptOpen = false;
  const { ipcMain, getConnection, resolveWindow } = dependencies;
  ipcMain.handle(DESKTOP_HEADLESS_PAIRING_CHANNELS.status, async (event, input: unknown) => {
    const window = resolveWindow(event);
    const connection = getConnection();
    if (!window?.isUsable() || !connection || input !== null) return { status: "unavailable" };
    try {
      const status = await connection.status();
      return window.isUsable() ? readDesktopHeadlessPairingStatus(status) : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  });
  ipcMain.handle(DESKTOP_HEADLESS_PAIRING_CHANNELS.pair, async (event, input: unknown): Promise<DesktopHeadlessPairingResult> => {
    const window = resolveWindow(event);
    const connection = getConnection();
    const selection = readDesktopHeadlessPairingRequest(input);
    if (!window?.isUsable() || !connection || !selection || promptOpen) return "denied";
    const { workspaceId, access } = selection;
    promptOpen = true;
    try {
      const label = await connection.readWorkspaceLabel(workspaceId, access);
      if (!label || !window.isUsable()) return "denied";
      if (!await window.confirm(`${oneLine(label)} (${workspaceId})`, access)) return "canceled";
      if (!window.isUsable()) return "denied";
      const outcome = await connection.beginPairing(workspaceId, window.isUsable, access);
      if (outcome.status !== "ready") return outcome.status;
      if (!window.isUsable()) return "denied";
      await window.showCode(outcome.endpoint, outcome.fingerprint, outcome.pairingCode);
      return "shown";
    } catch {
      return "unavailable";
    } finally {
      promptOpen = false;
    }
  });
  ipcMain.handle(DESKTOP_HEADLESS_PAIRING_CHANNELS.start, async (event, input: unknown): Promise<DesktopHeadlessStartResult> => {
    const window = resolveWindow(event);
    const connection = getConnection();
    if (!window?.isUsable() || !connection || input !== null || promptOpen) return "denied";
    promptOpen = true;
    try {
      if (!await window.confirmStart()) return "canceled";
      if (!window.isUsable()) return "denied";
      return await connection.startExistingClients(window.isUsable);
    } catch {
      return "unavailable";
    } finally {
      promptOpen = false;
    }
  });
  ipcMain.handle(DESKTOP_HEADLESS_PAIRING_CHANNELS.revoke, async (event, input: unknown): Promise<DesktopHeadlessRevokeResult> => {
    const window = resolveWindow(event);
    const connection = getConnection();
    if (!window?.isUsable() || !connection || !isDesktopHeadlessClientId(input)) return "denied";
    try {
      return await connection.revoke(input) ? "revoked" : "denied";
    } catch {
      return "unavailable";
    }
  });
}

function oneLine(label: string): string {
  return label.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").trim() || "Selected workspace";
}
