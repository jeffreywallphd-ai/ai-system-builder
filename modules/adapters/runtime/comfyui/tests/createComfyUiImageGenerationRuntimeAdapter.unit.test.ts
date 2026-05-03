import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { TaskType } from "../../../../contracts/runtime";

import { createComfyUiImageGenerationRuntimeAdapter } from "../createComfyUiImageGenerationRuntimeAdapter";

describe("createComfyUiImageGenerationRuntimeAdapter", () => {
  const baseSupervisor = {
    start: testDouble.fn(async () => {}),
    getRecentRuntimeOutput: testDouble.fn(() => []),
    getRuntimeDeviceMode: testDouble.fn(() => "auto"),
  };

  it("start ensures supervisor before submit and returns metadata", async () => {
    const supervisor = { ...baseSupervisor, start: testDouble.fn(async () => {}) };
    const client = { submitPrompt: testDouble.fn(async () => ({ prompt_id: "p1", number: 1 })), getQueue: testDouble.fn(), getHistory: testDouble.fn() };
    const adapter = createComfyUiImageGenerationRuntimeAdapter({ supervisor, client, mapperOptions: { defaultCheckpoint: "sdxl" }, now: () => "2026-04-30T00:00:00.000Z" });

    const result = await adapter.startTask({ taskType: TaskType.IMAGE_GENERATION, payload: { prompt: "cat" }, requestId: "r1" });
    expect(supervisor.start).toHaveBeenCalledOnce();
    expect(client.submitPrompt).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ requestId: "r1", status: "queued", metadata: { engine: "comfyui", comfyUiPromptId: "p1" } });
  });

  it("read maps running state", async () => {
    const adapter = createComfyUiImageGenerationRuntimeAdapter({
      supervisor: baseSupervisor,
      client: {
        submitPrompt: testDouble.fn(async () => ({ prompt_id: "p1", number: 1 })),
        getQueue: testDouble.fn(async () => ({ queue_running: [[1, "p1"]], queue_pending: [] })),
        getHistory: testDouble.fn(async () => ({})),
      }, mapperOptions: { defaultCheckpoint: "sdxl" },
    });
    await adapter.startTask({ taskType: TaskType.IMAGE_GENERATION, payload: { prompt: "cat" }, requestId: "r1" });
    const record = await adapter.getTaskStatus("r1");
    expect(record.status).toBe("running");
  });

  it("read maps succeeded outputs without bytes and unknown mapping", async () => {
    const adapter = createComfyUiImageGenerationRuntimeAdapter({
      supervisor: baseSupervisor,
      client: {
        submitPrompt: testDouble.fn(async () => ({ prompt_id: "p1" })),
        getQueue: testDouble.fn(async () => ({ queue_running: [], queue_pending: [] })),
        getHistory: testDouble.fn(async () => ({ p1: { outputs: { "7": { images: [{ filename: "x.png", subfolder: "", type: "output", data: "raw" }] } } } })),
      }, mapperOptions: { defaultCheckpoint: "sdxl" },
    });
    await adapter.startTask({ taskType: TaskType.IMAGE_GENERATION, payload: { prompt: "cat" }, requestId: "r1" });
    const record = await adapter.getTaskStatus("r1");
    expect(record.status).toBe("succeeded");
    expect(record.data).toEqual({ outputs: [{ fileName: "x.png", subfolder: undefined, type: "image", promptId: "p1", engine: "comfyui" }] });
    const unknown = await adapter.getTaskStatus("nope");
    expect(unknown.status).toBe("unknown");
  });

  it("uses generic fallback when history has no outputs and no error details", async () => {
    const adapter = createComfyUiImageGenerationRuntimeAdapter({
      supervisor: { ...baseSupervisor, getRecentRuntimeOutput: testDouble.fn(() => []) },
      client: {
        submitPrompt: testDouble.fn(async () => ({ prompt_id: "p1" })),
        getQueue: testDouble.fn(async () => ({ queue_running: [], queue_pending: [] })),
        getHistory: testDouble.fn(async () => ({ p1: { outputs: {} } })),
      }, mapperOptions: { defaultCheckpoint: "sdxl" },
    });
    await adapter.startTask({ taskType: TaskType.IMAGE_GENERATION, payload: { prompt: "cat" }, requestId: "r1" });
    const record = await adapter.getTaskStatus("r1");
    expect(record.status).toBe("failed");
    expect(record.error?.message).toBe("ComfyUI history entry did not contain image outputs.");
  });

  it("surfaces ComfyUI status exception details when history includes error metadata", async () => {
    const adapter = createComfyUiImageGenerationRuntimeAdapter({
      supervisor: { ...baseSupervisor, getRuntimeDeviceMode: testDouble.fn(() => "cuda") },
      client: {
        submitPrompt: testDouble.fn(async () => ({ prompt_id: "p1" })),
        getQueue: testDouble.fn(async () => ({ queue_running: [], queue_pending: [] })),
        getHistory: testDouble.fn(async () => ({ p1: { outputs: {}, status: { status_str: "error", messages: [["execution_error", { exception_message: "OOM on node", node_id: "12", node_type: "KSampler", traceback: ["a", "b", "c"] }]] } } })),
      }, mapperOptions: { defaultCheckpoint: "sdxl" },
    });
    await adapter.startTask({ taskType: TaskType.IMAGE_GENERATION, payload: { prompt: "cat" }, requestId: "r1" });
    const record = await adapter.getTaskStatus("r1");
    expect(record.status).toBe("failed");
    expect(record.error?.message).toContain("OOM on node");
    expect(record.metadata).toMatchObject({ runtimeDeviceMode: "cuda", failedNodeId: "12", failedNodeType: "KSampler" });
  });

  it("classifies DirectML OpaqueTensorImpl failure with actionable guidance", async () => {
    const adapter = createComfyUiImageGenerationRuntimeAdapter({
      supervisor: {
        ...baseSupervisor,
        getRuntimeDeviceMode: testDouble.fn(() => "directml"),
        getRecentRuntimeOutput: testDouble.fn(() => ["!!! Exception during processing !!! Cannot access storage of OpaqueTensorImpl", "NotImplementedError: Cannot access storage of OpaqueTensorImpl"]),
      },
      client: {
        submitPrompt: testDouble.fn(async () => ({ prompt_id: "p1" })),
        getQueue: testDouble.fn(async () => ({ queue_running: [], queue_pending: [] })),
        getHistory: testDouble.fn(async () => ({ p1: { outputs: {}, status: { status_str: "error" } } })),
      }, mapperOptions: { defaultCheckpoint: "sdxl" },
    });
    await adapter.startTask({ taskType: TaskType.IMAGE_GENERATION, payload: { prompt: "cat" }, requestId: "r1" });
    const record = await adapter.getTaskStatus("r1");
    expect(record.status).toBe("failed");
    expect(record.error?.message).toContain("ComfyUI failed during DirectML execution");
    expect(record.error?.message).toContain("Try CPU mode");
  });

  it("cancel returns truthful unsupported result", async () => {
    const adapter = createComfyUiImageGenerationRuntimeAdapter({
      supervisor: baseSupervisor,
      client: { submitPrompt: testDouble.fn(async () => ({ prompt_id: "p1" })), getQueue: testDouble.fn(), getHistory: testDouble.fn() },
      mapperOptions: { defaultCheckpoint: "sdxl" },
    });
    const result = await adapter.cancelTask("r1");
    expect(result).toEqual({ requestId: "r1", cancelled: false, status: "unknown", message: "ComfyUI image generation cancellation is not implemented yet." });
  });

  it("returns unknown with clear error when prompt disappears from queue and history", async () => {
    const adapter = createComfyUiImageGenerationRuntimeAdapter({
      supervisor: baseSupervisor,
      client: {
        submitPrompt: testDouble.fn(async () => ({ prompt_id: "p1" })),
        getQueue: testDouble.fn(async () => ({ queue_running: [], queue_pending: [] })),
        getHistory: testDouble.fn(async () => ({})),
      }, mapperOptions: { defaultCheckpoint: "sdxl" },
    });
    await adapter.startTask({ taskType: TaskType.IMAGE_GENERATION, payload: { prompt: "cat" }, requestId: "r1" });
    const record = await adapter.getTaskStatus("r1");
    expect(record.status).toBe("unknown");
    expect(record.error).toEqual({ code: "comfyui_task_missing", message: "ComfyUI prompt was not found in queue or history." });
  });

  it("rejects non-image runtime task types", async () => {
    const adapter = createComfyUiImageGenerationRuntimeAdapter({
      supervisor: baseSupervisor,
      client: { submitPrompt: testDouble.fn(async () => ({ prompt_id: "p1" })), getQueue: testDouble.fn(), getHistory: testDouble.fn() },
      mapperOptions: { defaultCheckpoint: "sdxl" },
    });
    await expect(adapter.startTask({ taskType: TaskType.TRAIN_MODEL, payload: {} })).rejects.toThrow("only supports image-generation tasks");
  });
});
