import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { composeDesktopHost } from "../composeDesktopHost";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { DESKTOP_ASSET_PACKAGE_CHANNELS, DESKTOP_ASSET_STUDIO_CHANNELS, DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS, DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL } from "../../../../contracts/ipc";
import * as channels from "../../../../contracts/ipc";

test("actual desktop Assets registration enforces the supplied trust policy before deferred composition", async () => {
  const ownedRoot = await mkdtemp(join(tmpdir(), "assets-ipc-trust-"));
  const exactRoot = await realpath(ownedRoot);
  try {
    const handlers = new Map<string, any>();
    const trustedEvent = {};
    let calls = 0;
    const host = composeDesktopHost({ persistence: { documents: createInMemoryStructuredDocumentStore() } });
    host.registerDesktopIpc({
      ipcMain: { handle(channel, listener) { handlers.set(channel, listener); } },
      senderTrust: { isTrustedSender(event) { calls++; return event === trustedEvent; } },
      storageRootDirectory: join(ownedRoot, "storage"), runtimeRootDirectory: join(ownedRoot, "runtime"),
    });
    const requests = [
      ...Object.values(DESKTOP_ASSET_PACKAGE_CHANNELS), ...Object.values(DESKTOP_ASSET_STUDIO_CHANNELS),
      ...Object.values(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS),
    ].map(value => value.request.value);
    requests.push(...Object.entries(channels)
      .filter(([key]) => key.startsWith("DESKTOP_ASSET_AUTHORING_") && key.endsWith("_REQUEST_CHANNEL"))
      .map(([, value]) => (value as { value: string }).value));
    assert.equal(requests.length, new Set(requests).size);
    const unreadable = new Proxy({}, { get() { throw new Error("Request must remain unread"); } });
    for (const channel of requests) {
      const result = await handlers.get(channel)({}, unreadable);
      assert.equal(result.error.code, "forbidden", channel);
    }
    assert.equal(calls, requests.length);
    assert.equal(host.getInternalAssetRegistry(), undefined);
    assert.ok(host.getFeatureLifecycleState().every(entry => entry.loaded === false));
    for (const channel of [DESKTOP_ASSET_PACKAGE_CHANNELS.list.request.value, DESKTOP_ASSET_STUDIO_CHANNELS.list.request.value, DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value]) {
      const result = await handlers.get(channel)(trustedEvent, { payload: {} });
      assert.equal(result.error.code, "validation", channel);
    }
    assert.equal(calls, requests.length + 3);
    assert.equal(host.getInternalAssetRegistry(), undefined);
    assert.ok(host.getFeatureLifecycleState().every(entry => entry.loaded === false));
  } finally {
    assert.equal(await realpath(ownedRoot), exactRoot);
    assert.equal(resolve(ownedRoot), exactRoot);
    await rm(ownedRoot, { recursive: true, force: true });
  }
});
