import assert from "node:assert/strict";
import { test } from "node:test";
import type { IpcMainHandlePort } from "../../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { DESKTOP_HEADLESS_PAIRING_CHANNELS } from "../../../../../modules/contracts/headless";
import { createDesktopPreloadApi } from "../../preload/exposedApi";
import { captureDesktopHeadlessPairingWindow, registerDesktopHeadlessPairingIpc } from "../desktopHeadlessPairingIpc";

const workspace = "fixture-workspace";
const clientId = "b02c24dc-0335-4675-ac71-f498ae703101";
const address = "http://127.0.0.1:13339";
const code = "pairing-test-fixture";

test("trusted pairing requires a fresh window, explicit confirmation, and never returns codes to preload", async () => {
  const owned = {};
  let usable = true;
  let confirmed = false;
  let closeOnConfirm = false;
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
        return { status: "ready", running: true, endpoint: address, clients: [{ registeredClientId: clientId,
          workspaceId: workspace as never, expiresAt: 5_000, internalCode: code }] };
      },
      async readWorkspaceLabel(id) {
        effects.push(["workspace", id]);
        return "Synthetic workspace\nname";
      },
      async beginPairing(id) {
        effects.push(["begin", id]);
        return { status: "ready", endpoint: address, pairingCode: code };
      },
      async startExistingClients() { effects.push("start"); return "started"; },
      async revoke(id) { effects.push(["revoke", id]); return id === clientId; },
      async close() {},
    }),
    resolveWindow: (event) => event === owned ? {
      isUsable: () => usable,
      async confirm(label) {
        effects.push(["confirm", label]);
        if (closeOnConfirm) usable = false;
        return confirmed;
      },
      async confirmStart() { return confirmed; },
      async showCode(endpoint, pairingCode) { effects.push(["private native dialog", endpoint, pairingCode]); },
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
  assert.deepEqual(effects, [["workspace", workspace], ["confirm", "Synthetic workspace name (fixture-workspace)"]]);
  confirmed = true;
  closeOnConfirm = true;
  assert.equal(await api.beginHeadlessPairing(workspace), "denied");
  assert.equal(effects.filter((event) => Array.isArray(event) && event[0] === "begin").length, 0);
  usable = true;
  closeOnConfirm = false;
  assert.equal(await api.beginHeadlessPairing(workspace), "shown");
  assert.deepEqual(effects.slice(-2), [["begin", workspace], ["private native dialog", address, code]]);
  assert.deepEqual(await api.readHeadlessPairingStatus(), { status: "ready", running: true, endpoint: address,
    clients: [{ registeredClientId: clientId, workspaceId: workspace, expiresAt: 5_000 }] });
  assert.equal(await api.startHeadlessConnector(), "started");
  assert.equal(await api.revokeHeadlessClient(clientId + "\n"), "denied");
  assert.equal(await api.revokeHeadlessClient(clientId), "revoked");
  assert.deepEqual(effects.slice(-2), ["start", ["revoke", clientId]]);
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
