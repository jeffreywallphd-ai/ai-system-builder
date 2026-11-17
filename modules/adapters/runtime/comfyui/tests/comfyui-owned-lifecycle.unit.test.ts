import assert from "node:assert/strict";
import { test } from "node:test";
import { createComfyUiHttpClient } from "../createComfyUiHttpClient";
import { createComfyUiImageGenerationRuntimeAdapter } from "../createComfyUiImageGenerationRuntimeAdapter";
import { TaskType } from "../../../../contracts/runtime";
import { createWorkspaceId } from "../../../../contracts/workspace";

const workspaceId = createWorkspaceId("workspace.test");
const request = { workspaceId, requestId: "owned", taskType: TaskType.IMAGE_GENERATION, payload: { prompt: "cat", latentSource: { kind: "artifact", artifactId: "input" } } };
function fixture(overrides: Record<string, unknown> = {}) {
  let cleaned = 0;
  const adapter = createComfyUiImageGenerationRuntimeAdapter({
    supervisor: { start: async () => {} }, mapperOptions: { defaultCheckpoint: "sdxl" },
    prepareLatentReferenceImage: async () => ({ imageName: "prepared.png", cleanup: async () => { cleaned++; } }),
    client: { submitPrompt: async () => ({ prompt_id: "prompt" }), getQueue: async () => ({ queue_running: [[0, "prompt"]], queue_pending: [] }), getHistory: async () => ({}), cancelPrompt: async () => ({ cancelled: false }) },
    ...overrides,
  });
  return { adapter, cleaned: () => cleaned };
}
test("HTTP queue-delete acknowledgment cannot cancel a running prompt or clean its inputs", async () => {
  const routes: string[] = [];
  const client = createComfyUiHttpClient({ baseUrl: "http://fixture.invalid", fetchImplementation: async (url, init) => {
    const route = new URL(String(url)).pathname; routes.push(`${init?.method} ${route}`);
    return new Response(JSON.stringify(route === "/prompt" ? { prompt_id: "prompt" } : route === "/history" ? {} : { queue_running: [[0, "prompt"]], queue_pending: [] }), { status: 200 });
  } });
  const f = fixture({ client }); await f.adapter.startTask(request);
  assert.equal((await f.adapter.cancelTask("owned")).cancelled, false); assert.equal(f.cleaned(), 0);
  assert.equal((await f.adapter.getTaskStatus("owned")).status, "running");
  assert.ok(routes.includes("POST /queue")); assert.equal(routes.some((r) => r.includes("interrupt")), false);
  await f.adapter.settleAfterRuntimeStop(); assert.equal(f.cleaned(), 1);
});
test("shutdown drains late submission acceptance and never leaves queued work after confirmed stop", async () => {
  let accept!: (value: { prompt_id: string }) => void;
  const submitted = new Promise<{ prompt_id: string }>((resolve) => { accept = resolve; });
  const f = fixture({ client: { submitPrompt: () => submitted } });
  const start = f.adapter.startTask(request);
  await new Promise((resolve) => setImmediate(resolve));
  f.adapter.closeAdmission(); const stopped = f.adapter.settleAfterRuntimeStop();
  accept({ prompt_id: "prompt" }); await assert.rejects(start, /stopped/); await stopped;
  assert.equal(f.cleaned(), 1); assert.equal((await f.adapter.getTaskStatus("owned")).status, "failed");
});
test("ambiguous submission retains inputs and capacity until confirmed stop", async () => {
  const f = fixture({ maximumActiveTasks: 1, client: { submitPrompt: async () => { throw new Error("lost reply"); } } });
  await assert.rejects(f.adapter.startTask(request)); assert.equal(f.cleaned(), 0);
  await assert.rejects(f.adapter.startTask({ ...request, requestId: "other" }), /capacity/);
  await f.adapter.settleAfterRuntimeStop(); assert.equal(f.cleaned(), 1);
});
test("unconfirmed timeout retains inputs, and nonfinite bounds fail before dispatch", async () => {
  let time = 0; const f = fixture({ now: () => new Date(time).toISOString(), maximumTaskDurationMs: 1000 });
  await f.adapter.startTask(request); time = 1000;
  assert.equal((await f.adapter.getTaskStatus("owned")).status, "unknown"); assert.equal(f.cleaned(), 0);
  await f.adapter.settleAfterRuntimeStop(); assert.equal(f.cleaned(), 1);
  assert.throws(() => fixture({ maximumActiveTasks: NaN }), /bounds/);
});

test("completed history after the deadline settles output and cleanup instead of remaining cancellation-pending", async () => {
  let time = 0;
  const client = createComfyUiHttpClient({ baseUrl: "http://fixture.invalid", fetchImplementation: async (url) => {
    const route = new URL(String(url)).pathname;
    return new Response(JSON.stringify(route === "/prompt" ? { prompt_id: "prompt" } : route === "/history" ? { prompt: { outputs: { image: { images: [{ filename: "out.png" }] } } } } : { queue_running: [], queue_pending: [] }), { status: 200 });
  } });
  const f = fixture({ client, now: () => new Date(time).toISOString(), maximumTaskDurationMs: 1000 });
  await f.adapter.startTask(request); time = 1001;
  assert.equal((await f.adapter.getTaskStatus("owned")).status, "succeeded");
  assert.equal((await f.adapter.getTaskStatus("owned")).status, "succeeded"); assert.equal(f.cleaned(), 1);
});
