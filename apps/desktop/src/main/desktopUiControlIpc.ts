import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import type { DesktopUiControlOwner } from "../../../../modules/hosts/desktop/composition/composeDesktopUiControl";
import {
  DESKTOP_UI_CONTROL_CHANNELS, readUiControlAttempt, readUiControlLeaseTarget, readUiControlRevoke,
  type UiControlObservation, type UiControlWindowTarget,
} from "../../../../modules/contracts/headless";
import { isWorkspaceId } from "../../../../modules/contracts/workspace";

type Window = object;
type Frame = object;
type DocumentOwner = {
  readonly main: DesktopUiControlOwner;
  readonly frame: Frame;
  readonly target: UiControlWindowTarget;
  readonly token: Parameters<DesktopUiControlOwner["authority"]["registerWindow"]>[1];
  retired: boolean;
};

export function registerDesktopUiControlIpc(dependencies: {
  readonly ipcMain: IpcMainHandlePort;
  readonly getOwner: () => DesktopUiControlOwner | undefined;
  readonly resolve: (event: unknown) => { readonly window: Window; readonly frame: Frame; readonly isCurrent: () => boolean } | undefined;
}) {
  const active = new WeakMap<Window, DocumentOwner>();
  const windows = new WeakMap<Window, string>();
  const pending = new WeakMap<Window, { readonly workspaceId: string; readonly frame: Frame }>();
  let observing = 0;
  function retire(window: Window) {
    pending.delete(window);
    const previous = active.get(window);
    if (!previous) return;
    previous.retired = true;
    previous.main.authority.retireWindow(previous.target, previous.token);
    active.delete(window);
  }

  const { ipcMain, getOwner, resolve } = dependencies;
  ipcMain.handle(DESKTOP_UI_CONTROL_CHANNELS.observe, async (event, input): Promise<UiControlObservation> => {
    const sender = resolve(event);
    if (!sender) return { status: "unavailable" };
    const { window, frame, isCurrent } = sender;
    const main = getOwner();
    const prior = active.get(window);
    if (input !== null && !isWorkspaceId(input)) return { status: "unavailable" };
    const inFlight = pending.get(window);
    if (inFlight?.workspaceId === input && inFlight.frame === frame) return { status: "busy" };
    if (inFlight) pending.delete(window);
    if (prior && (input !== prior.target.workspaceId || frame !== prior.frame || main !== prior.main)) retire(window);
    if (input === null) return { status: "ready" };
    if (!main) return { status: "unavailable" };
    if (observing >= 8) return { status: "busy" };
    const observation = { workspaceId: input, frame };
    pending.set(window, observation);
    observing++;
    try {
      const allowed = await main.canObserve(input);
      if (pending.get(window) !== observation) return { status: "unavailable" };
      if (!allowed || !isCurrent() || getOwner() !== main) {
        if (active.get(window) === prior) retire(window);
        return { status: "unavailable" };
      }
      let owned = active.get(window);
      if (!owned) {
        const windowId = windows.get(window) ?? randomUUID();
        windows.set(window, windowId);
        const target = { hostIncarnationId: main.hostIncarnationId, windowId, uiIncarnationId: randomUUID(), workspaceId: input };
        const token = { organizationId: main.identity.organizationId, principalId: main.identity.principalId,
          isCurrent: () => !!owned && !owned.retired && isCurrent() && getOwner() === main };
        owned = { main, frame, target, token, retired: false };
        if (!main.authority.registerWindow(target, token)) return { status: "unavailable" };
        active.set(window, owned);
      }
      const request = main.authority.readPending(owned.target, owned.token);
      return request ? { status: "ready", request } : { status: "ready" };
    } catch {
      if (pending.get(window) === observation && active.get(window) === prior) retire(window);
      return { status: "unavailable" };
    } finally {
      observing--;
      if (pending.get(window) === observation) pending.delete(window);
    }
  });

  function current(event: unknown) {
    const sender = resolve(event);
    const owned = sender && active.get(sender.window);
    return owned?.frame === sender?.frame && owned?.token.isCurrent() ? owned : undefined;
  }

  ipcMain.handle(DESKTOP_UI_CONTROL_CHANNELS.accept, async (event, input) => {
    const owned = current(event);
    const attempt = readUiControlAttempt(input);
    if (!owned || !attempt || attempt.workspaceId !== owned.target.workspaceId) return;
    const value = await owned.main.authority.accept(attempt, owned.token);
    if (value.status === "ok" && current(event) === owned) {
      const exact = owned.main.authority.readInteractiveLease(value.value.target, owned.token);
      if (exact) return { target: exact.target, remainingMs: exact.expiresAt - performance.now() };
    }
  });
  ipcMain.handle(DESKTOP_UI_CONTROL_CHANNELS.ready, async (event, input) => {
    const owned = current(event);
    const lease = readUiControlLeaseTarget(input);
    if (!owned || !lease || lease.workspaceId !== owned.target.workspaceId) return;
    const value = await owned.main.authority.ready(lease, owned.token);
    if (value.status === "ok" && current(event) === owned) {
      const exact = owned.main.authority.readInteractiveLease(value.value.target, owned.token);
      if (exact) return { target: exact.target, remainingMs: exact.expiresAt - performance.now() };
    }
  });
  ipcMain.handle(DESKTOP_UI_CONTROL_CHANNELS.revoke, async (event, input) => {
    const owned = current(event);
    const target = readUiControlRevoke(input);
    return !!owned && !!target && owned.main.authority.revoke(target, owned.token).status === "ok";
  });
  return { retire };
}
