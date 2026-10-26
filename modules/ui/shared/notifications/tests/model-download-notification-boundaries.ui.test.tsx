// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import { JSDOM } from "jsdom";
import { after, afterEach, it } from "node:test";
import assert from "node:assert/strict";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ModelDownloadTaskActivity } from "../../../../contracts/model";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { ModelDownloadNotificationBridge, type ModelDownloadNotificationClient } from "../ModelDownloadNotificationBridge";
import { NotificationProvider, useNotificationCenter } from "../NotificationProvider";
import { NotificationViewport } from "../NotificationCenter";
import { useTaskObservationManager } from "../TaskObservationProvider";
import type { TaskObservationManager } from "../taskObservation";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, MouseEvent: dom.window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
const workspaceId = createWorkspaceId("workspace.downloads");
let root: Root | undefined, container: HTMLDivElement | undefined;
let observer!: TaskObservationManager, notifications!: ReturnType<typeof useNotificationCenter>;
function Ready({ workspace }: { workspace: string }) {
  notifications = useNotificationCenter(); observer = useTaskObservationManager();
  useEffect(() => { notifications.setActiveWorkspaceId(workspace); notifications.setPanelOpen(true); }, [workspace, notifications.setActiveWorkspaceId, notifications.setPanelOpen]);
  return <NotificationViewport />;
}
function activity(overrides: Partial<ModelDownloadTaskActivity> = {}): ModelDownloadTaskActivity {
  return { requestId: "download-1", workspaceId, modelId: "org/model", displayName: "Test model", status: "running", ...overrides };
}
async function mount(client: ModelDownloadNotificationClient, workspace = workspaceId, enabled = true) {
  if (!container) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  await act(async () => { root!.render(<NotificationProvider>{enabled && <ModelDownloadNotificationBridge client={client} workspaceId={workspace} />}<Ready workspace={workspace} /></NotificationProvider>); await Promise.resolve(); });
}
async function refresh() { await act(async () => { observer.invalidate({ workspaceId, family: "model-download" }); await Promise.resolve(); }); }
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); root = undefined; container = undefined; });
after(() => dom.window.close());

it("keeps numeric download progress without copying runtime message or unit", async () => {
  await mount({ listModelDownloads: async () => ({ activities: [activity({ progress: { current: 25, total: 100, percent: 25, unit: "PRIVATE_UNIT", message: "PRIVATE_PROGRESS" } })] }) });
  assert.match(container!.textContent!, /Downloading model\./);
  assert.doesNotMatch(container!.textContent!, /PRIVATE/);
  assert.equal(container!.querySelector("progress")?.getAttribute("value"), "25");
});

it("keeps a failed download actionable without provider error text", async () => {
  let value = activity(); const client = { listModelDownloads: async () => ({ activities: [value] }) };
  await mount(client); value = activity({ status: "failed", error: { code: "PRIVATE_CODE", message: "PRIVATE_FAILURE" } }); await refresh();
  assert.match(container!.textContent!, /Model download failed\. Open Models to review the download and retry\./);
  assert.doesNotMatch(container!.textContent!, /PRIVATE/);
});

for (const invalid of [
  { label: "foreign workspace", rows: [activity({ workspaceId: createWorkspaceId("workspace.foreign"), displayName: "PRIVATE_FOREIGN" })] },
  { label: "duplicate identities", rows: [activity(), activity()] },
  { label: "oversized page", rows: Array.from({ length: 101 }, (_, i) => activity({ requestId: `download-${i}` })) },
  { label: "unsupported status", rows: [activity({ status: "unexpected" as never })] },
  { label: "malformed identity", rows: [activity({ requestId: "invalid/id" })] },
]) it(`rejects ${invalid.label} and recovers on a valid next page`, async () => {
  let rows = invalid.rows;
  await mount({ listModelDownloads: async () => ({ activities: rows }) });
  assert.match(container!.textContent!, /Download status unavailable/);
  assert.equal(notifications.records.filter(v => v.kind === "activity").length, 0);
  assert.doesNotMatch(JSON.stringify(notifications.records), /PRIVATE_FOREIGN/);
  rows = [activity()]; await refresh(); assert.match(container!.textContent!, /Test model/);
});

it("validates the whole page before any optional download-completion call", async () => {
  let completed = 0;
  await mount({ listModelDownloads: async () => ({ activities: [activity({ status: "succeeded" }), activity({ workspaceId: createWorkspaceId("workspace.foreign"), requestId: "foreign" })] }), completeModelDownload: async () => { completed++; return { activity: activity({ status: "succeeded" }) }; } });
  assert.equal(completed, 0); assert.match(container!.textContent!, /Download status unavailable/);
});

for (const mismatch of [
  { requestId: "other-download" }, { workspaceId: createWorkspaceId("workspace.foreign") }, { modelId: "org/other" },
]) it(`refuses a mismatched completion: ${Object.keys(mismatch)[0]}`, async () => {
  let value = activity(), completed = 0;
  const client = { listModelDownloads: async () => ({ activities: [value] }), completeModelDownload: async () => { completed++; return { activity: activity({ ...mismatch, status: "succeeded" }) }; } };
  await mount(client); value = activity({ status: "succeeded" }); await refresh();
  assert.equal(completed, 1); assert.match(container!.textContent!, /Download status unavailable/);
  assert.equal(notifications.records.find(v => v.id === `model-download:${workspaceId}:download-1`)?.status, "running");
  assert.doesNotMatch(container!.textContent!, /Model download completed/);
});

it("preserves matching optional completion and its exact scoped request", async () => {
  let value = activity(), input: unknown;
  const client = { listModelDownloads: async () => ({ activities: [value] }), completeModelDownload: async (request: unknown) => { input = request; return { activity: activity({ status: "succeeded" }) }; } };
  await mount(client); value = activity({ status: "succeeded" }); await refresh();
  assert.deepEqual(input, { workspaceId, requestId: "download-1" }); assert.match(container!.textContent!, /Model download completed/);
});

for (const progress of [
  { current: -1, total: 100, percent: 50 }, { current: 101, total: 100, percent: 100 },
  { current: 0.5, total: 100, percent: 50 }, { current: 1, total: Number.MAX_SAFE_INTEGER + 1 },
  { percent: 101 }, { percent: -1 }, { percent: Number.NaN },
]) it(`omits invalid download progress ${JSON.stringify(progress)}`, async () => {
  await mount({ listModelDownloads: async () => ({ activities: [activity({ progress })] }) });
  assert.equal(container!.querySelector("progress") === null, true); assert.match(container!.textContent!, /Downloading model\./);
});

it("accepts finite percentage-only progress and known byte counts", async () => {
  let progress = { percent: 12.5 }; const client = { listModelDownloads: async () => ({ activities: [activity({ progress })] }) };
  await mount(client); assert.equal(container!.querySelector("progress")?.getAttribute("value"), "12.5");
  progress = { current: 0, total: 200, unit: "bytes", percent: 0 } as typeof progress; await refresh();
  assert.equal(container!.querySelector("progress")?.getAttribute("value"), "0");
});

it("ignores a delayed retired client result after a committed replacement", async () => {
  let resolve!: (value: { activities: ModelDownloadTaskActivity[] }) => void;
  await mount({ listModelDownloads: () => new Promise(done => { resolve = done; }) });
  const next = { listModelDownloads: async () => ({ activities: [activity({ requestId: "new-download", displayName: "Current model" })] }) };
  await mount(next); await act(async () => { resolve({ activities: [activity({ displayName: "PRIVATE_RETIRED" })] }); await Promise.resolve(); });
  assert.doesNotMatch(JSON.stringify(notifications.records), /PRIVATE_RETIRED/); assert.match(container!.textContent!, /Current model/);
});

it("compares completion against the captured task when a caller mutates its list", async () => {
  let value = activity(), retained: ModelDownloadTaskActivity[] = [];
  const client = { listModelDownloads: async () => { retained = [value]; return { activities: retained }; }, completeModelDownload: async () => {
    Object.assign(retained[0], { requestId: "mutated-download", modelId: "org/other" });
    return { activity: activity({ requestId: "mutated-download", modelId: "org/other", status: "succeeded" }) };
  } };
  await mount(client); value = activity({ status: "succeeded" }); await refresh();
  assert.match(container!.textContent!, /Download status unavailable/);
  assert.equal(notifications.records.some(v => v.status === "succeeded"), false);
});

it("checks an existing shared snapshot before publishing it", async () => {
  const client = { listModelDownloads: async () => ({ activities: [activity()] }) };
  await mount(client, workspaceId, false);
  let stop!: () => void;
  await act(async () => {
    stop = observer.subscribe({ workspaceId, family: "model-download", requestId: "list" }, async () => ({ value: [activity({ workspaceId: createWorkspaceId("workspace.foreign"), displayName: "PRIVATE_CACHED" })], activity: "idle" }), () => {});
    await Promise.resolve();
  });
  await mount(client);
  assert.match(container!.textContent!, /Download status unavailable/);
  assert.doesNotMatch(JSON.stringify(notifications.state.records), /PRIVATE_CACHED/);
  await act(async () => { stop(); await Promise.resolve(); }); await refresh();
  assert.match(container!.textContent!, /Test model/);
});
