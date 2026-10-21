import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesktopPreloadApi } from "../exposedApi";
import { createDesktopImageGenerationClient } from "../../renderer/features/image-generation/api/desktopImageGenerationClient";
import { registerImageGenerationIpc } from "../../../../../modules/adapters/transport/ipc-electron/image-generation/registerImageGenerationIpc";

test("real image client/preload/IPC round trip preserves workspace for start, read and cancel", async () => {
  const handlers = new Map<string, any>(); const seen: unknown[] = [];
  registerImageGenerationIpc({ ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } }, generateImageUseCase: {
    startImageGeneration: async (_request, context) => { seen.push(context?.workspaceId); return { requestId: "image-1", status: "queued" }; },
    readImageGeneration: async (_id, context) => { seen.push(context?.workspaceId); return { requestId: "image-1", workspaceId: context?.workspaceId as never, taskType: "image-generation" as never, status: "running", concurrencyClass: "gpu-exclusive" }; },
    cancelImageGeneration: async (_id, context) => { seen.push(context?.workspaceId); return { requestId: "image-1", cancelled: true, status: "cancelled" }; },
  } });
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke: async (channel, request) => handlers.get(channel)({}, request) } });
  const previous = (globalThis as any).window;
  try {
    (globalThis as any).window = { desktopApi: api };
    const client = createDesktopImageGenerationClient();
    assert.equal((await client.startImageGeneration({ prompt: "fixture", workspaceId: "workspace-a" })).ok, true);
    assert.equal((await client.readImageGeneration({ requestId: "image-1", workspaceId: "workspace-a" })).ok, true);
    assert.equal((await client.cancelImageGeneration({ requestId: "image-1", workspaceId: "workspace-a" })).ok, true);
    assert.deepEqual(seen, ["workspace-a", "workspace-a", "workspace-a"]);
  } finally { (globalThis as any).window = previous; }
});

test("readiness client operations are exposed through their finite preload IPC channels", async () => {
  const calls: Array<[string, any]> = [];
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke: async (channel, request) => { calls.push([channel, request]); return { ok: true, value: undefined }; } } });
  await api.readLatestRuntimeReadinessForCompositionPlan({ targetWorkspaceId: "workspace-a", compositionPlanId: "plan-a" });
  await api.readRuntimeReadinessDetail({ targetWorkspaceId: "workspace-a", readinessBindingId: "binding-a" });
  assert.deepEqual(calls.map(([channel]) => channel), ["ipc.runtime-readiness.read-latest-for-composition-plan.request", "ipc.runtime-readiness.read-detail.request"]);
  assert.ok(calls.every(([, request]) => request.payload.targetWorkspaceId === "workspace-a"));
});
