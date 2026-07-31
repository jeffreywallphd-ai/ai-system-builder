import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiImageGenerationClient } from "../api/apiImageGenerationClient";

describe("api image generation client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls endpoints and parses typed envelopes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 200, json: vi.fn().mockResolvedValue({ ok: true, value: { requestId: "r1" } }) })
      .mockResolvedValueOnce({ status: 200, json: vi.fn().mockResolvedValue({ ok: true, value: { requestId: "r1", taskType: "image-generation", status: "running", concurrencyClass: "gpu" } }) })
      .mockResolvedValueOnce({ status: 200, json: vi.fn().mockResolvedValue({ ok: true, value: { cancelled: true, message: "done" } }) })
      .mockResolvedValueOnce({ status: 200, json: vi.fn().mockResolvedValue({ ok: true, value: { finalized: true, assets: [{ assetId: "a1", artifactId: "art1", storageKey: "k1", mediaType: "image/png" }] } }) })
      .mockResolvedValueOnce({ status: 200, json: vi.fn().mockResolvedValue({ ok: true, value: { unloaded: true, message: "released" } }) })
      .mockResolvedValueOnce({ status: 200, json: vi.fn().mockResolvedValue({ ok: true, value: { memoryUsagePercent: 42, cpuUsagePercent: 11, gpuUsagePercent: 0 } }) });
    vi.stubGlobal("fetch", fetchMock);
    const c = createApiImageGenerationClient();
    const started = await c.startImageGeneration({ prompt: "cat" });
    const read = await c.readImageGeneration({ requestId: "r1" });
    const cancelled = await c.cancelImageGeneration({ requestId: "r1" });
    const fin = await c.finalizeImageGenerationIfCompleted({ requestId: "r1" });
    const unloaded = await c.unloadModel();
    const resources = await c.readRuntimeResources();
    expect(started.requestId).toBe("r1");
    expect(read.requestId).toBe("r1");
    expect(cancelled.cancelled).toBe(true);
    expect(fin.finalized).toBe(true);
    expect(unloaded.unloaded).toBe(true);
    expect(resources.memoryUsagePercent).toBe(42);
    expect(fetchMock.mock.calls[4][0]).toBe("/api/image-generation/unload-model");
    expect(c.createArtifactMediaViewUrl("foo/bar")).toBe("/api/artifact/media/view?storageKey=foo%2Fbar");
    expect(c.createArtifactMediaViewUrl("foo/bar", { workspaceId: "workspace-a" })).toBe("/api/artifact/media/view?storageKey=foo%2Fbar&workspaceId=workspace-a");
    expect(
      new Headers(fetchMock.mock.calls[0][1].headers).get("x-client-source"),
    ).toBe("thin-client.image-generation");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).not.toHaveProperty("source");
  });

  it("throws useful failure message with code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 400, json: vi.fn().mockResolvedValue({ ok: false, error: { code: "validation", message: "bad" } }) }));
    const c = createApiImageGenerationClient();
    await expect(c.startImageGeneration({ prompt: "cat" })).rejects.toThrow("bad");
  });

  it("coerces runtime resource percentages when API returns numeric strings", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue({ status: 200, json: vi.fn().mockResolvedValue({ ok: true, value: { memoryUsagePercent: "55.5", cpuUsagePercent: "12", gpuUsagePercent: "7" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const c = createApiImageGenerationClient();
    const resources = await c.readRuntimeResources();
    expect(resources).toEqual({ memoryUsagePercent: 55.5, cpuUsagePercent: 12, gpuUsagePercent: 7 });
  });
});


it("preserves security status/code on unauthorized", async()=>{
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401, json: vi.fn().mockResolvedValue({ ok:false, error:{ code:"security.invalid-token", message:"bad token" } }) }));
  const c = createApiImageGenerationClient();
  await expect(c.startImageGeneration({ prompt:"cat" })).rejects.toMatchObject({ status:401, code:"security.invalid-token" });
});
