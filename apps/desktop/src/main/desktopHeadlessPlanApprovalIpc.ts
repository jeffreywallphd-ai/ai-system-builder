import { createHash, randomUUID } from "node:crypto";
import type { IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { isWorkspaceId } from "../../../../modules/contracts/workspace";
import { isDesktopHeadlessClientId, readHeadlessPlanReviewAgentResult } from "../../../../modules/contracts/headless";
import {
  DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS, readDesktopPlanApprovalDecision, readDesktopPlanApprovalList,
  readDesktopPlanApprovalSelection, readDesktopPlanApprovalView, sameDesktopPlanApproval,
  type DesktopPlanApprovalSelection,
} from "../../../../modules/contracts/headless/desktop-headless-plan-approval";
import type { composeDesktopHeadlessPlanApprovals } from "../../../../modules/hosts/desktop/composition/composeDesktopHeadlessPlanApprovals";

type Approvals = ReturnType<typeof composeDesktopHeadlessPlanApprovals>;
type ApprovalState = Extract<Awaited<ReturnType<Approvals["decide"]>>, { ok: true }>["state"];
const MAX_REQUESTS = 4;
const unavailable = { ok: false, code: "unavailable" } as const;

interface ApprovalWindow {
  /** Stable identity of the trusted current main frame, not a window title or request field. */
  readonly key: object;
  readonly isUsable: () => boolean;
}

export function registerDesktopHeadlessPlanApprovalIpc(options: {
  readonly ipcMain: IpcMainHandlePort;
  readonly getApprovals: () => Approvals | undefined;
  readonly resolveWindow: (event: unknown) => ApprovalWindow | undefined;
}) {
  const { ipcMain, getApprovals, resolveWindow } = options;
  const opened = new WeakMap<object, {
    readonly selection: DesktopPlanApprovalSelection;
    readonly service: Approvals;
    readonly viewId?: string;
    readonly revision?: number;
    readonly expiresAt?: number;
    readonly stepCount?: number;
  }>();
  let active = 0;

  async function withWindow<T>(
    event: unknown, work: (window: ApprovalWindow, service: Approvals, isCurrent: () => boolean,
      requirePublication: (fence: () => boolean) => void) => Promise<T>,
  ) {
    const window = resolveWindow(event);
    const service = getApprovals();
    if (!window?.isUsable() || !service || active >= MAX_REQUESTS) return unavailable;
    const isCurrent = () => window.isUsable() && getApprovals() === service;
    let mayPublish = () => true;
    active++;
    try {
      const result = await work(window, service, isCurrent, fence => { mayPublish = fence; });
      return isCurrent() && mayPublish() ? result : unavailable;
    }
    catch { return unavailable; }
    finally { active--; }
  }

  ipcMain.handle(DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS.list, (event, raw: unknown) => {
    if (!isWorkspaceId(raw)) return Promise.resolve(unavailable);
    return withWindow(event, async (_window, service, current) => {
      const result = await service.list(raw, current);
      if (!result.ok || !current() || result.requests.length > 32) return unavailable;
      const entries = readDesktopPlanApprovalList(result.requests.map(entry => ({ ...entry, workspaceId: raw })), raw);
      return entries ? { ok: true, entries: entries.filter(entry => entry.expiresAt > Date.now()) } as const : unavailable;
    });
  });

  ipcMain.handle(DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS.open, (event, raw: unknown) => {
    const selection = readDesktopPlanApprovalSelection(raw);
    if (!selection) return Promise.resolve(unavailable);
    return withWindow(event, async (window, service, current, requirePublication) => {
      const marker = { selection, service };
      opened.set(window.key, marker);
      const isCurrent = () => current() && opened.get(window.key) === marker;
      const result = await service.open(selection, { isCurrent, channel: "app-popup" });
      if (!result.ok || !isCurrent()) return unavailable;
      const view = readDesktopPlanApprovalView({
        selection, viewId: randomUUID(), preview: result.snapshot.preview,
        state: publicState(selection.fingerprint, result.snapshot.state),
      }, selection);
      if (!view) return unavailable;
      const fingerprint = createHash("sha256").update(JSON.stringify(view.preview), "utf8").digest("hex");
      if (fingerprint !== selection.fingerprint || !isCurrent() || view.state.expiresAt <= Date.now()) return unavailable;
      const issued = { selection, service, viewId: view.viewId, revision: view.state.revision,
        expiresAt: view.state.expiresAt, stepCount: view.state.stepCount };
      requirePublication(() => {
        if (opened.get(window.key) !== marker || issued.expiresAt <= Date.now()) return false;
        opened.set(window.key, issued);
        return true;
      });
      return { ok: true, view } as const;
    });
  });

  ipcMain.handle(DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS.dismiss, async (event, raw: unknown) => {
    if (!isDesktopHeadlessClientId(raw)) return false;
    const window = resolveWindow(event);
    if (!window?.isUsable() || opened.get(window.key)?.viewId !== raw) return false;
    return opened.delete(window.key);
  });

  ipcMain.handle(DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS.decide, (event, raw: unknown) => {
    const request = readDesktopPlanApprovalDecision(raw);
    if (!request) return Promise.resolve(unavailable);
    return withWindow(event, async (window, service, current, requirePublication) => {
      const previous = opened.get(window.key);
      const { selection, viewId, expectedRevision, decision } = request;
      if (!previous || previous.service !== service || previous.viewId !== viewId || previous.revision !== expectedRevision ||
          previous.expiresAt === undefined || previous.expiresAt <= Date.now() ||
          !sameDesktopPlanApproval(previous.selection, selection))
        return unavailable;
      const marker = { selection, service, viewId };
      opened.set(window.key, marker);
      const isCurrent = () => current() && opened.get(window.key) === marker;
      const result = await service.decide(selection, { fingerprint: selection.fingerprint, expectedRevision, decision },
        { isCurrent, channel: "app-popup" });
      if (!isCurrent() || !result.ok || result.state.revision !== expectedRevision + 1 ||
          result.state.expiresAt <= Date.now()) return unavailable;
      const state = readHeadlessPlanReviewAgentResult({ ok: true, value: publicState(selection.fingerprint, result.state) },
        selection.fingerprint, previous.stepCount);
      if (!state.ok) return unavailable;
      requirePublication(() => isCurrent() && state.value.expiresAt > Date.now());
      return { ok: true, state: state.value } as const;
    });
  });
}

function publicState(fingerprint: string, state: ApprovalState) {
  const { revision, stepCount, expiresAt, status, mode, approvedSteps } = state;
  return { fingerprint, revision, stepCount, expiresAt, status, approvedSteps, ...(mode === undefined ? {} : { mode }) };
}
