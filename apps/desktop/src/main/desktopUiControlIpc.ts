import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import type { DesktopUiControlOwner } from "../../../../modules/hosts/desktop/composition/composeDesktopUiControl";
import {
  DESKTOP_UI_CONTROL_CHANNELS, readUiControlAttempt, readUiControlLeaseTarget, readUiControlRevoke,
  readUiPresentationAcknowledgment, readUiPresentationPublication, readUiPresentationPull,
  type UiControlAttempt, type UiControlLeaseTarget, type UiControlObservation, type UiControlWindowTarget, type UiPresentationPullResult,
} from "../../../../modules/contracts/headless";
import { isWorkspaceId } from "../../../../modules/contracts/workspace";

type Window = object;
type Frame = object;
type DocumentOwner = {
  readonly main: DesktopUiControlOwner;
  readonly frame: Frame;
  readonly target: UiControlWindowTarget;
  readonly token: Parameters<DesktopUiControlOwner["authority"]["registerWindow"]>[1];
  lastObservedAttempt?: UiControlAttempt;
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
  const pulling = new Set<string>();
  let observing = 0;
  function retire(window: Window) {
    pending.delete(window);
    const previous = active.get(window);
    if (!previous) return;
    previous.retired = true;
    previous.main.authority.retireWindow(previous.target, previous.token);
    // The old frame token can already be unusable during a native hide or
    // document shutdown. Use only the exact attempt captured while usable.
    if (previous.lastObservedAttempt) previous.main.closeDelivery(previous.lastObservedAttempt);
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
      const view = main.authority.observeInteractive(owned.target, owned.token);
      if (!view) return { status: "ready" };
      if (view.request) owned.lastObservedAttempt = view.active?.target ?? view.request.target;
      const remainingMs = (view.active?.expiresAt ?? 0) - performance.now();
      const lease = view.active && remainingMs > 0 ? { target: view.active.target, remainingMs } : undefined;
      const contextChallenge = lease && main.contextChallenge(lease.target);
      return { status: "ready", request: view.request, ...(lease ? { lease } : {}),
        ...(contextChallenge ? { contextChallenge } : {}) };
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
  function activeLease(event: unknown, target: UiControlLeaseTarget) {
    const owned = current(event);
    if (!owned || !owned.main.authority.readInteractiveLease(target, owned.token, true)) return;
    return owned;
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
    if (!owned || !target || owned.main.authority.revoke(target, owned.token).status !== "ok") return false;
    owned.main.closeDelivery(target);
    return true;
  });
  ipcMain.handle(DESKTOP_UI_CONTROL_CHANNELS.pull, async (event, raw): Promise<UiPresentationPullResult> => {
    const input = readUiPresentationPull(raw);
    const owned = input && activeLease(event, input.target);
    if (!input || !owned) return { status: "unavailable" };
    const { leaseId } = input.target;
    if (pulling.has(leaseId) || pulling.size >= 8) return { status: "empty" };
    pulling.add(leaseId);
    try { return await pull(event, input, owned); }
    finally { pulling.delete(leaseId); }
  });
  async function pull(event: unknown, input: NonNullable<ReturnType<typeof readUiPresentationPull>>, owned: DocumentOwner): Promise<UiPresentationPullResult> {
    const queue = owned.main.readDelivery(input.target);
    const pulled = queue?.next(input.target, input.sequence, false);
    if (!pulled || pulled.status === "empty") return { status: "empty" };
    if (pulled.status === "terminal") return pulled;
    if (pulled.status !== "delivered") return { status: "unavailable" };
    const detail = await owned.main.authorizeIntent(input.target.workspaceId, pulled.command.intent);
    if (activeLease(event, input.target) !== owned) return { status: "unavailable" };
    if (!detail) {
      const denied = queue?.rejectUndeliverable(input.target, input.sequence, pulled.command.commandId);
      return denied ? { status: "terminal", receipt: denied } : { status: "unavailable" };
    }
    const latest = queue?.next(input.target, input.sequence);
    if (latest?.status === "terminal") return latest;
    if (latest?.status === "delivered") return { status: "command", command: latest.command, detail };
    return { status: "unavailable" };
  }
  ipcMain.handle(DESKTOP_UI_CONTROL_CHANNELS.acknowledge, async (event, raw) => {
    const input = readUiPresentationAcknowledgment(raw);
    const owned = input && activeLease(event, input.target);
    if (!input || !owned) return false;
    const { sequence, commandId, status } = input.receipt;
    return !!owned.main.readDelivery(input.target)?.acknowledge(input.target, sequence, commandId, status);
  });
  ipcMain.handle(DESKTOP_UI_CONTROL_CHANNELS.context, async (event, raw) => {
    const input = readUiPresentationPublication(raw);
    const owned = input && activeLease(event, input.target);
    if (!input || !owned || owned.main.contextChallenge(input.target) !== input.challenge) return false;
    const selected = input.context.selection;
    const allowed = selected
      ? await owned.main.authorizeIntent(input.target.workspaceId, selected)
      : await owned.main.canObserve(input.target.workspaceId);
    if (!allowed || activeLease(event, input.target) !== owned) return false;
    return owned.main.publishContext(input.target, owned.token, input.context, input.challenge);
  });
  return { retire };
}
