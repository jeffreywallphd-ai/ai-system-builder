import assert from "node:assert/strict";
import test from "node:test";
import { registerAssetAuthoringIpc } from "../asset-authoring/registerAssetAuthoringIpc";
import { registerAssetPackageIpc } from "../asset-package/registerAssetPackageIpc";
import { registerAssetStudioIpc } from "../asset-studio/registerAssetStudioIpc";
import { isTrustedIpcSender } from "../../../../../apps/desktop/src/main/trustedIpcSender";
import type { IpcSenderTrustPolicy } from "../ipcMainHandlePort";
import { guardedIpcMainHandlePort } from "../guardedIpcMainHandlePort";
import { DESKTOP_ASSET_PACKAGE_CHANNELS } from "../../../../contracts/ipc";
import * as channels from "../../../../contracts/ipc";

const legacyRequests = Object.entries(channels)
  .filter(([key]) => key.startsWith("DESKTOP_ASSET_AUTHORING_") && key.endsWith("_REQUEST_CHANNEL"))
  .map(([, value]) => (value as { value: string }).value);
const expectedFamilies = [
  [...legacyRequests, ...Object.values(channels.DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS).map(value => value.request.value)],
  Object.values(channels.DESKTOP_ASSET_PACKAGE_CHANNELS).map(value => value.request.value),
  Object.values(channels.DESKTOP_ASSET_STUDIO_CHANNELS).map(value => value.request.value),
];

test("all Assets channels deny untrusted events before reading requests or resolving features", async () => {
  const mainFrame = {};
  let destroyedWindow = false;
  let destroyedContents = false;
  const sender = { mainFrame, isDestroyed: () => destroyedContents };
  const windows = [{ webContents: sender, isDestroyed: () => destroyedWindow }];
  const trust = { isTrustedSender: (event: unknown) => isTrustedIpcSender(event, windows) };
  const cases: Array<[IpcSenderTrustPolicy | undefined, unknown]> = [
    [undefined, {}],
    [trust, undefined],
    [trust, { sender }],
    [trust, { sender, senderFrame: {} }],
    [trust, { sender: { mainFrame }, senderFrame: mainFrame }],
    [{ isTrustedSender: () => false }, {}],
    [{ isTrustedSender: () => "true" as never }, {}],
    [{ isTrustedSender: () => Promise.resolve(true) as never }, {}],
    [{ isTrustedSender() { throw new Error("private trust detail"); } }, {}],
  ];
  for (const [family, register] of [registerAssetAuthoringIpc, registerAssetPackageIpc, registerAssetStudioIpc].entries()) {
    for (const [senderTrust, event] of cases) {
      const handlers = new Map<string, (event: unknown, request: unknown) => Promise<any>>();
      let effects = 0;
      const service = new Proxy({}, { get() { return async () => { effects++; throw new Error("private service detail"); }; } });
      register({
        ipcMain: { handle(channel: string, handler: any) { handlers.set(channel, handler); } }, senderTrust,
        start: service, list: service, read: service, propose: service, review: service, assetDrafts: service,
        inspect: service, admit: service, activate: service, disable: service, rollback: service,
        createWorkspaceAuthoredAssetUseCase: service, createAssetDraftUseCase: service,
        updateAssetDraftUseCase: service, publishAssetDraftUseCase: service,
        createAssetOverrideUseCase: service, updateAssetOverrideUseCase: service, disableAssetOverrideUseCase: service,
        authoredAssetRepository: service, assetDraftRepository: service, assetRevisionRepository: service, assetOverrideRepository: service,
        getDerivedCustomizations: async () => { effects++; return service; },
      } as never);
      assert.deepEqual([...handlers.keys()].sort(), [...expectedFamilies[family]].sort());
      const request = new Proxy({}, { get() { effects++; throw new Error("Untrusted request was read"); } });
      for (const [channel, handler] of handlers) {
        const result = await handler(event, request);
        assert.equal(result.ok, false, channel);
        assert.equal(result.error.code, "forbidden", channel);
        assert.equal(result.error.channel, channel.replace(/\.request$/, ".response"));
        assert.ok(!JSON.stringify(result).includes("private"));
        assert.equal(result.requestId, undefined);
      }
      assert.equal(effects, 0);
      destroyedWindow = true;
      for (const handler of handlers.values()) assert.equal((await handler({ sender, senderFrame: mainFrame }, request)).error.code, "forbidden");
      destroyedWindow = false;
      destroyedContents = true;
      for (const handler of handlers.values()) assert.equal((await handler({ sender, senderFrame: mainFrame }, request)).error.code, "forbidden");
      destroyedContents = false;
    }
  }
});

test("a live owned main frame keeps ordinary success and request context in each Assets family", async () => {
  const mainFrame = {};
  const sender = { mainFrame, isDestroyed: () => false };
  const event = { sender, senderFrame: mainFrame };
  const windows = [{ webContents: sender, isDestroyed: () => false }];
  const request = { requestId: "synthetic-request", correlationId: "synthetic-correlation", payload: { workspaceId: "workspace-a", targetWorkspaceId: "workspace-a" } };
  const fixtures = [
    { register: registerAssetAuthoringIpc, channel: channels.DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value,
      dependencies: { assetDraftRepository: { listAssetDraftRecords: async () => ({ records: [] }) } }, expected: { drafts: [], nextCursor: undefined } },
    { register: registerAssetPackageIpc, channel: channels.DESKTOP_ASSET_PACKAGE_CHANNELS.list.request.value,
      dependencies: { list: { execute: async () => ({ records: [] }) } }, expected: { records: [] } },
    { register: registerAssetStudioIpc, channel: channels.DESKTOP_ASSET_STUDIO_CHANNELS.list.request.value,
      dependencies: { list: { execute: async () => ({ records: [] }) } }, expected: { records: [] } },
  ];
  for (const { register, channel, dependencies, expected } of fixtures) {
    const handlers = new Map<string, any>();
    let calls = 0;
    register({ ...dependencies, ipcMain: { handle(name: string, listener: any) { handlers.set(name, listener); } },
      senderTrust: { isTrustedSender(actual: unknown) { calls++; assert.equal(actual, event); return isTrustedIpcSender(actual, windows); } },
    } as never);
    const result = await handlers.get(channel)(event, request);
    assert.equal(calls, 1);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, expected);
    assert.equal(result.requestId, request.requestId);
    assert.equal(result.correlationId, request.correlationId);
    assert.equal(result.channel, channel.replace(/\.request$/, ".response"));
  }
});

test("guard accepts only fixed matched unique channel descriptors and preserves a trusted result", async () => {
  const handlers = new Map<string, any>();
  const ipcMain: any = { handle(channel: string, listener: any) { handlers.set(channel, listener); } };
  const policy = { isTrustedSender: () => true };
  const descriptor = DESKTOP_ASSET_PACKAGE_CHANNELS.list;
  for (const descriptors of [[descriptor, descriptor], [{ ...descriptor, response: DESKTOP_ASSET_PACKAGE_CHANNELS.inspect.response }], [{ ...descriptor, response: descriptor.request }]]) {
    assert.throws(() => guardedIpcMainHandlePort(ipcMain, policy, descriptors as never), /Invalid fixed/);
  }
  const guarded = guardedIpcMainHandlePort(ipcMain, policy, [descriptor]);
  assert.throws(() => guarded.handle("arbitrary-channel", async () => undefined), /Unregistered/);
  assert.equal(handlers.size, 0);
  const result = { ok: true, value: "unchanged", requestId: "synthetic-request" };
  const event = {};
  const request = {};
  guarded.handle(descriptor.request.value, async (actualEvent, actualRequest) => {
    assert.equal(actualEvent, event);
    assert.equal(actualRequest, request);
    return result;
  });
  assert.equal(await handlers.get(descriptor.request.value)(event, request), result);
});
