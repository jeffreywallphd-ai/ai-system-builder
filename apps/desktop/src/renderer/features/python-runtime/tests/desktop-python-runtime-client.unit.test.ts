// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopPythonRuntimeClient } from "../api/desktopPythonRuntimeClient";

const valid = () => ({ supervisorStatus: "ready", healthy: true, runtimeStatus: "ready", capabilities: ["prepare-training-dataset"], logs: [], loadedModels: [], activeTaskCount: 0, systemResources: { memoryUsagePercent: 20, cpuUsagePercent: 10, gpuUsagePercent: 0 } });
let previous: typeof window.desktopApi;
beforeEach(() => { previous = window.desktopApi; });
afterEach(() => { if (previous) window.desktopApi = previous; else delete window.desktopApi; });
function bridge(value: unknown) {
  const readPythonRuntimeStatus = vi.fn(async () => value);
  const controlPythonRuntime = vi.fn(async (_input: { action: string }) => value);
  window.desktopApi = { readPythonRuntimeStatus, controlPythonRuntime } as unknown as NonNullable<typeof window.desktopApi>;
  return { readPythonRuntimeStatus, controlPythonRuntime };
}
describe("desktop Python runtime client", () => {
  it.each(["stopped", "starting", "ready", "failed"])("preserves the canonical %s status without a control action", async supervisorStatus => {
    const api = bridge({ ok: true, value: { ...valid(), supervisorStatus } });
    expect((await createDesktopPythonRuntimeClient().readStatus()).supervisorStatus).toBe(supervisorStatus);
    expect(api.controlPythonRuntime).not.toHaveBeenCalled();
  });
  it.each([null, [], { ok: "yes", value: valid() }, { ok: true, value: null }, { ok: true, value: [] }])("refuses a malformed envelope or container %#", async value => {
    bridge(value);
    await expect(createDesktopPythonRuntimeClient().readStatus()).rejects.toThrow();
  });
  it("keeps fixed failure text for a denied host response", async () => {
    bridge({ ok: false, error: { message: "token=synthetic-runtime-secret C:\\private\\worker.py" } });
    await expect(createDesktopPythonRuntimeClient().readStatus()).rejects.toThrow("Failed to read Python runtime status.");
    await expect(createDesktopPythonRuntimeClient().controlRuntime("start")).rejects.toThrow("Failed to control Python runtime.");
  });
  it("copies known consumed rows and preserves existing model fields", async () => {
    const row = { timestamp: "2026-10-28T00:00:00Z", level: "info", message: "Ready.", privateExtra: "not-consumed" };
    const model = { provider: "transformers", modelId: "fixture", inferenceMode: "chat", memoryMode: "standard", device: "cpu", torchDtype: "float32", localPath: "local-fixture", privateExtra: "not-consumed" };
    const payload = { ...valid(), logs: [row], loadedModels: [model], privateExtra: "not-consumed" };
    bridge({ ok: true, value: payload });
    const result = await createDesktopPythonRuntimeClient().readStatus();
    row.message = "Changed after reply."; model.modelId = "Changed after reply.";
    expect(result.logs).toEqual([{ timestamp: "2026-10-28T00:00:00Z", level: "info", message: "Ready." }]);
    expect(result.loadedModels).toEqual([{ provider: "transformers", modelId: "fixture", inferenceMode: "chat", memoryMode: "standard", device: "cpu", torchDtype: "float32", localPath: "local-fixture" }]);
    expect(JSON.stringify(result)).not.toContain("not-consumed");
  });
  it("keeps resource percentages finite and does not coerce text to a measurement", async () => {
    bridge({ ok: true, value: { ...valid(), systemResources: { memoryUsagePercent: "50", cpuUsagePercent: Infinity, gpuUsagePercent: NaN }, activeTaskCount: -1 } });
    const result = await createDesktopPythonRuntimeClient().readStatus();
    expect(result.systemResources).toEqual({ memoryUsagePercent: 0, cpuUsagePercent: 0, gpuUsagePercent: 0 });
    expect(result.activeTaskCount).toBe(0);
  });
  it("passes only existing explicit actions to the same bridge", async () => {
    const api = bridge({ ok: true, value: valid() }), client = createDesktopPythonRuntimeClient();
    for (const action of ["start", "stop", "restart", "unload-model", "clear-logs"] as const) await client.controlRuntime(action);
    await expect(client.controlRuntime("unknown" as never)).rejects.toThrow();
    expect(api.controlPythonRuntime.mock.calls.map(([input]) => input.action)).toEqual(["start", "stop", "restart", "unload-model", "clear-logs"]);
    expect(api.readPythonRuntimeStatus).not.toHaveBeenCalled();
  });
  it("reports unavailable IPC without a fallback control or false status", async () => {
    window.desktopApi = {} as NonNullable<typeof window.desktopApi>;
    const client = createDesktopPythonRuntimeClient();
    await expect(client.readStatus()).rejects.toThrow("Python runtime status API is unavailable.");
    await expect(client.controlRuntime("stop")).rejects.toThrow("Python runtime control API is unavailable.");
  });
});
