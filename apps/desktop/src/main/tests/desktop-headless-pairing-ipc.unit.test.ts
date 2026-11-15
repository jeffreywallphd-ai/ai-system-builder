import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { IpcMainHandlePort } from "../../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { DESKTOP_HEADLESS_PAIRING_CHANNELS, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal } from "../../../../../modules/contracts/headless";
import { DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS, type DesktopPlanApprovalView } from "../../../../../modules/contracts/headless/desktop-headless-plan-approval";
import { createWorkspaceId } from "../../../../../modules/contracts/workspace";
import type { composeDesktopHeadlessPlanApprovals } from "../../../../../modules/hosts/desktop/composition/composeDesktopHeadlessPlanApprovals";
import { createDesktopPreloadApi } from "../../preload/exposedApi";
import { captureDesktopHeadlessPairingWindow, registerDesktopHeadlessPairingIpc } from "../desktopHeadlessPairingIpc";
import { registerDesktopHeadlessPlanApprovalIpc } from "../desktopHeadlessPlanApprovalIpc";

const workspace = "fixture-workspace";
const clientId = "b02c24dc-0335-4675-ac71-f498ae703101";
const address = "https://127.0.0.1:13339";
const fingerprint = "1".repeat(64);
const code = "pairing-test-fixture";

test("trusted pairing requires a fresh window, explicit confirmation, and never returns codes to preload", async () => {
  const owned = {};
  let usable = true;
  let confirmed = false;
  let closeOnConfirm = false;
  let conversationAvailable = false;
  const effects: unknown[] = [];
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  const ipcMain: IpcMainHandlePort = {
    handle(channel, listener) {
      handlers.set(channel, (event, payload) => listener(event, payload as never));
    },
  };
  registerDesktopHeadlessPairingIpc({
    ipcMain,
    getConnection: () => ({
      async status() {
        const access = conversationAvailable ? { access: "conversation" as const } : {};
        return { status: "ready", running: true, endpoint: address, fingerprint,
          ...(conversationAvailable ? { conversationAvailable: true as const } : {}),
          clients: [{ registeredClientId: clientId, workspaceId: workspace as never,
            expiresAt: 5_000, internalCode: code, ...access }] };
      },
      async readWorkspaceLabel(id, access) {
        effects.push(["workspace", id, access]);
        return "Synthetic workspace\nname";
      },
      async beginPairing(id, _current, access) {
        effects.push(["begin", id, access]);
        return { status: "ready", endpoint: address, fingerprint, pairingCode: code };
      },
      async startExistingClients() { effects.push("start"); return "started"; },
      async capturePlanReviewClients() { return []; },
      async revoke(id) { effects.push(["revoke", id]); return id === clientId; },
      async close() {},
    }),
    resolveWindow: (event) => event === owned ? {
      isUsable: () => usable,
      async confirm(label, access) {
        effects.push(["confirm", label, access]);
        if (closeOnConfirm) usable = false;
        return confirmed;
      },
      async confirmStart() { return confirmed; },
      async showCode(endpoint, pin, pairingCode) { effects.push(["private native dialog", endpoint, pin, pairingCode]); },
    } : undefined,
  });
  const api = createDesktopPreloadApi({ ipcRenderer: { async invoke(channel, input) {
    const handler = handlers.get(channel);
    assert.ok(handler);
    return handler(owned, input);
  } } });
  const pair = handlers.get(DESKTOP_HEADLESS_PAIRING_CHANNELS.pair)!;
  assert.equal(await pair({}, workspace), "denied");
  assert.equal(await pair(owned, { workspaceId: workspace, principalId: "fixture" }), "denied");
  assert.deepEqual(effects, []);
  assert.equal(await api.beginHeadlessPairing(workspace), "canceled");
  assert.deepEqual(effects, [["workspace", workspace, "read"], ["confirm", "Synthetic workspace name (fixture-workspace)", "read"]]);
  confirmed = true;
  closeOnConfirm = true;
  assert.equal(await api.beginHeadlessPairing(workspace), "denied");
  assert.equal(effects.filter((event) => Array.isArray(event) && event[0] === "begin").length, 0);
  usable = true;
  closeOnConfirm = false;
  assert.equal(await api.beginHeadlessPairing(workspace), "shown");
  assert.deepEqual(effects.slice(-2), [["begin", workspace, "read"], ["private native dialog", address, fingerprint, code]]);
  confirmed = false;
  assert.equal(await api.beginHeadlessPairing(workspace, "author"), "canceled");
  assert.deepEqual(effects.slice(-2), [["workspace", workspace, "author"], ["confirm", "Synthetic workspace name (fixture-workspace)", "author"]]);
  confirmed = true;
  assert.equal(await api.beginHeadlessPairing(workspace, "author"), "shown");
  assert.deepEqual(effects.slice(-2), [["begin", workspace, "author"], ["private native dialog", address, fingerprint, code]]);
  confirmed = false;
  assert.equal(await api.beginHeadlessPairing(workspace, "conversation"), "canceled");
  assert.deepEqual(effects.slice(-2), [["workspace", workspace, "conversation"], ["confirm", "Synthetic workspace name (fixture-workspace)", "conversation"]]);
  confirmed = true;
  assert.equal(await api.beginHeadlessPairing(workspace, "conversation"), "shown");
  assert.deepEqual(effects.slice(-2), [["begin", workspace, "conversation"], ["private native dialog", address, fingerprint, code]]);
  assert.deepEqual(await api.readHeadlessPairingStatus(), { status: "ready", running: true, endpoint: address, fingerprint,
    clients: [{ registeredClientId: clientId, workspaceId: workspace, expiresAt: 5_000 }] });
  conversationAvailable = true;
  assert.deepEqual(await api.readHeadlessPairingStatus(), { status: "ready", running: true, endpoint: address, fingerprint,
    conversationAvailable: true,
    clients: [{ registeredClientId: clientId, workspaceId: workspace, expiresAt: 5_000, access: "conversation" }] });
  assert.equal(await api.startHeadlessConnector(), "started");
  assert.equal(await api.revokeHeadlessClient(clientId + "\n"), "denied");
  assert.equal(await api.revokeHeadlessClient(clientId), "revoked");
  assert.deepEqual(effects.slice(-2), ["start", ["revoke", clientId]]);
});

test("the desktop approval bridge accepts decisions only for the exact view issued to a trusted current window", async () => {
  const owned = {};
  const second = {};
  const selectedWorkspace = createWorkspaceId(workspace);
  const hostIncarnationId = "d5ed1db7-f069-4c48-bbc4-815697889c5d";
  assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const proposal = { hostIncarnationId, workspaceId: selectedWorkspace, steps: [
    { operation: "systems.create", name: "Fixture proposal", templateId: "reference.secured-data-review@1.0.0",
      idempotencyKey: "c6acfd8a-7c11-486a-95af-e1a7b08d16ef" },
  ] };
  const plan = parseHeadlessBuildPlanProposal(proposal, hostIncarnationId);
  const alternative = parseHeadlessBuildPlanProposal({ ...proposal, steps: [
    { ...proposal.steps[0], name: "Different proposal" },
  ] }, hostIncarnationId);
  assert.ok(plan.ok && alternative.ok);
  const hash = (preview: typeof plan.preview) => createHash("sha256").update(JSON.stringify(preview), "utf8").digest("hex");
  const proposalFingerprint = hash(plan.preview);
  const selection = { workspaceId: selectedWorkspace, registeredClientId: clientId, fingerprint: proposalFingerprint };
  const other = { ...selection, fingerprint: hash(alternative.preview) };
  const expectedRevision = 1;
  const deadline = Date.now() + 60_000;
  const initial = { revision: 1, stepCount: 1, approvedSteps: 0, status: "pending", expiresAt: deadline } as const;
  const approved = { ...initial, revision: 2, approvedSteps: 1, mode: "whole-plan", status: "approved" } as const;
  const choice = { kind: "approve", mode: "whole-plan" };
  const decisionFor = (viewId: string) => ({ selection, viewId, expectedRevision, decision: choice });
  const unavailable = { ok: false, code: "unavailable" };

  let usable = true;
  let corruptView = false;
  let changedProposal = false;
  let retireAtPublication = false;
  let pauseDecision: (() => Promise<void>) | undefined;
  let decisionCalls = 0;
  let commits = 0;
  const service: ReturnType<typeof composeDesktopHeadlessPlanApprovals> = {
    async list(id, current) {
      assert.equal(id, selectedWorkspace);
      assert.equal(current(), true);
      return { ok: true, requests: [{ registeredClientId: clientId, fingerprint: proposalFingerprint, expiresAt: deadline }] };
    },
    async open(target, caller) {
      assert.equal(caller.channel, "app-popup");
      assert.equal(caller.isCurrent(), true);
      const preview = corruptView ? { ...plan.preview, workspaceId: createWorkspaceId("different-fixture-workspace") }
        : changedProposal || target.fingerprint === other.fingerprint ? alternative.preview : plan.preview;
      if (retireAtPublication) queueMicrotask(() => queueMicrotask(() => { usable = false; }));
      return { ok: true, snapshot: { state: initial, preview } };
    },
    async decide(chosen, raw, caller) {
      assert.deepEqual(chosen, selection);
      assert.deepEqual(raw, { fingerprint: proposalFingerprint, expectedRevision, decision: choice });
      assert.equal(caller.channel, "app-popup");
      decisionCalls++;
      await pauseDecision?.();
      if (!caller.isCurrent()) return { ok: false, code: "forbidden" };
      commits++;
      return { ok: true, state: approved };
    },
  };
  let currentService = service;
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  registerDesktopHeadlessPlanApprovalIpc({
    ipcMain: { handle(channel, listener) { handlers.set(channel, async (event, raw) => listener(event, raw as never)); } },
    getApprovals: () => currentService,
    resolveWindow: event => event === owned || event === second ? { key: event, isUsable: () => usable } : undefined,
  });
  const invoke = (operation: keyof typeof DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS, input: unknown, window: object = owned) =>
    handlers.get(DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS[operation])!(window, input);
  async function show(target = selection, preview = plan.preview) {
    const result = await invoke("open", target) as { ok: boolean; view?: DesktopPlanApprovalView };
    assert.ok(result.ok && result.view);
    const { viewId, ...shown } = result.view;
    assert.match(viewId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(shown, { selection: target, preview, state: { fingerprint: target.fingerprint, ...initial } });
    return decisionFor(viewId);
  }

  assert.deepEqual(await invoke("list", workspace, {}), unavailable);
  assert.deepEqual(await invoke("list", workspace), { ok: true, entries: [{ ...selection, expiresAt: deadline }] });
  const unseen = decisionFor("eb49f5b8-e0ab-4fd9-aab7-9452426c1800");
  assert.deepEqual(await invoke("decide", unseen), unavailable);
  corruptView = true;
  assert.deepEqual(await invoke("open", selection), unavailable);
  corruptView = false;
  changedProposal = true;
  assert.deepEqual(await invoke("open", selection), unavailable);
  changedProposal = false;
  retireAtPublication = true;
  assert.deepEqual(await invoke("open", selection), unavailable);
  assert.equal(usable, false);
  retireAtPublication = false;
  usable = true;
  assert.deepEqual(await invoke("decide", unseen), unavailable);
  const retired = await show();
  const decision = await show();
  assert.notEqual(retired.viewId, decision.viewId);
  assert.equal(await invoke("dismiss", retired.viewId), false);
  assert.equal(await invoke("dismiss", decision.viewId, second), false);
  assert.deepEqual(await invoke("decide", retired), unavailable);
  assert.deepEqual(await invoke("decide", decision, second), unavailable);
  assert.deepEqual(await invoke("decide", { ...decision, expectedRevision: 2 }), unavailable);
  assert.deepEqual(await invoke("decide", { ...decision, channel: "authenticated-chat" }), unavailable);

  await show(other, alternative.preview);
  assert.deepEqual(await invoke("decide", decision), unavailable);
  const dismissed = await show();
  assert.equal(await invoke("dismiss", dismissed.viewId), true);
  assert.deepEqual(await invoke("decide", dismissed), unavailable);
  const beforeReplacement = await show();
  currentService = { ...service };
  assert.deepEqual(await invoke("decide", beforeReplacement), unavailable);
  assert.equal(decisionCalls, 0);

  const beforeWrite = await show();
  let entered!: () => void;
  let release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const releaseWrite = new Promise<void>(resolve => { release = resolve; });
  pauseDecision = async () => { entered(); await releaseWrite; };
  const pending = invoke("decide", beforeWrite);
  await writing;
  try { await invoke("open", other); }
  finally { release(); }
  assert.deepEqual(await pending, unavailable);
  assert.equal(commits, 0);

  pauseDecision = undefined;
  const available = await show();
  usable = false;
  assert.deepEqual(await invoke("decide", available), unavailable);
  usable = true;
  assert.deepEqual(await invoke("decide", available), { ok: true, state: { fingerprint: proposalFingerprint, ...approved } });
  assert.deepEqual(await invoke("decide", available), unavailable);
  assert.equal(commits, 1);
});

test("the production resolver fences a captured main frame when focus or trust changes", () => {
  const original = {};
  const other = {};
  const mainFrame = {};
  let focused: object | null = original;
  let frameIsCurrent = true;
  const capture = (event: unknown) => captureDesktopHeadlessPairingWindow(event, {
    getFocusedWindow: () => focused,
    ownsAndTrusts: (window, caller) => window === original && caller === mainFrame && frameIsCurrent,
    dialogs: () => ({ async confirm() { return true; }, async confirmStart() { return true; }, async showCode() {} }),
  });
  assert.equal(capture({}), undefined);
  const handle = capture(mainFrame);
  assert.ok(handle);
  assert.equal(handle.isUsable(), true);
  focused = other;
  assert.equal(handle.isUsable(), false);
  focused = original;
  frameIsCurrent = false;
  assert.equal(handle.isUsable(), false);
});
