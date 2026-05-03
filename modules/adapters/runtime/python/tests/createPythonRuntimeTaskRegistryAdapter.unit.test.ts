import type { PythonRuntimePort } from "../../../../application/ports/runtime";
import type {
  PythonRuntimeTaskStatusResult,
  StartPythonRuntimeTaskRequest,
} from "../../../../contracts/runtime";
import { TaskType } from "../../../../contracts/runtime";
import { describe, expect, expectTypeOf, it, testDouble } from "../../../../testing/node-test";
import { createPythonRuntimeTaskRegistryAdapter } from "../createPythonRuntimeTaskRegistryAdapter";

describe("createPythonRuntimeTaskRegistryAdapter", () => {
  it("keeps the python runtime port on python-specific task contracts", () => {
    expectTypeOf<Parameters<PythonRuntimePort["startTask"]>[0]>()
      .toEqualTypeOf<StartPythonRuntimeTaskRequest>();
    expectTypeOf<Awaited<ReturnType<PythonRuntimePort["readTaskStatus"]>>>()
      .toEqualTypeOf<PythonRuntimeTaskStatusResult>();
  });

  
  it("calls ensureRuntimeReady before startTask", async () => {
    const callOrder: string[] = [];
    const runtimePort: any = { startTask: testDouble.fn(async (request) => { callOrder.push("startTask"); return ({ requestId: request.requestId }); }), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const ensureRuntimeReady = testDouble.fn(async () => { callOrder.push("ensureRuntimeReady"); });
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, { ensureRuntimeReady });

    await adapter.startTask({ requestId: "req-ensure", taskType: TaskType.DATASET_PREPARATION, payload: {} });

    expect(callOrder).toEqual(["ensureRuntimeReady", "startTask"]);
  });

  it("does not start task when ensureRuntimeReady fails", async () => {
    const runtimePort: any = { startTask: testDouble.fn(async (request) => ({ requestId: request.requestId })), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const ensureRuntimeReady = testDouble.fn(async () => { throw new Error("supervisor unavailable"); });
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, { ensureRuntimeReady });

    await expect(adapter.startTask({ requestId: "req-fail", taskType: TaskType.DATASET_PREPARATION, payload: {} }))
      .rejects.toThrow("Python runtime failed to start or become ready");
    expect(runtimePort.startTask).not.toHaveBeenCalled();
  });

  it("does not call ensureRuntimeReady when reading task status", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(async () => ({ requestId: "req-1", taskType: "prepare-training-dataset", status: "queued" })), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const ensureRuntimeReady = testDouble.fn(async () => undefined);
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, { ensureRuntimeReady });

    await adapter.getTaskStatus("req-1");

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
  });

  it("does not call ensureRuntimeReady when cancelling task", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(async () => ({ requestId: "req-1", cancelled: true, status: "cancelled" })), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const ensureRuntimeReady = testDouble.fn(async () => undefined);
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, { ensureRuntimeReady });

    await adapter.cancelTask("req-1");

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
  });
it("maps DATASET_PREPARATION startTask to python runtime task type", async () => {
    const runtimePort: any = { startTask: testDouble.fn(async (request) => ({ requestId: request.requestId })), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ requestId: "req-1", taskType: TaskType.DATASET_PREPARATION, payload: { a: 1 } });
    expect(runtimePort.startTask).toHaveBeenCalledWith({ requestId: "req-1", taskType: "prepare-training-dataset", payload: { a: 1 }, metadata: undefined });
  });

  it("maps MODEL_TRAINING startTask to train-model", async () => {
    const runtimePort: any = { startTask: testDouble.fn(async (request) => ({ requestId: request.requestId })), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ requestId: "req-2", taskType: TaskType.MODEL_TRAINING, payload: {} });
    expect(runtimePort.startTask).toHaveBeenCalledWith({ requestId: "req-2", taskType: "train-model", payload: {}, metadata: undefined });
  });

  
  it("maps MODEL_VALIDATION startTask type", async () => {
    const runtimePort: any = { startTask: testDouble.fn(async (request) => ({ requestId: request.requestId })), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ requestId: "req-v", taskType: TaskType.MODEL_VALIDATION, payload: { hello: 1 } });
    expect(runtimePort.startTask.mock.calls[0]?.[0]?.taskType).toBe("validate-model");
  });
  it("rejects MODEL_PUBLISHING startTask until implemented", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await expect(adapter.startTask({ requestId: "req-p", taskType: TaskType.MODEL_PUBLISHING, payload: { world: 2 } })).rejects.toThrow("model publishing runtime task is not implemented");
    expect(runtimePort.startTask).not.toHaveBeenCalled();
  });
it("generates non-timestamp request ids when caller does not provide one", async () => {
    const runtimePort: any = { startTask: testDouble.fn(async (request) => ({ requestId: request.requestId })), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ taskType: TaskType.MODEL_TRAINING, payload: {} });
    const requestId = runtimePort.startTask.mock.calls[0]?.[0]?.requestId as string;
    expect(requestId.startsWith("runtime-task-")).toBe(false);
    expect(typeof requestId).toBe("string");
    expect(requestId.length).toBe(36);
  });

  it("throws clear error for unknown python task type in status", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(async () => ({ requestId: "req-1", taskType: "mystery-task", status: "running" })), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await expect(adapter.getTaskStatus("req-1")).rejects.toThrow("Unknown python runtime task type");
  });
  it("maps python chunk progress into generic runtime progress fields", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(async () => ({ requestId: "req-1", taskType: "prepare-training-dataset", status: "running", progress: { message: "Processing chunk 2/8...", processedChunkCount: 2, totalChunkCount: 8, generatedRowCount: 40 } })), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const record = await adapter.getTaskStatus("req-1");
    expect(record.progress).toMatchObject({ message: "Processing chunk 2/8...", current: 2, total: 8, unit: "chunk" });
    expect(record.progress?.details).toMatchObject({ generatedRowCount: 40 });
  });

  it("keeps generic progress mapping when chunk fields are not present", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(async () => ({ requestId: "req-train", taskType: "train-model", status: "running", progress: { stage: "training", message: "Epoch [0]/[1], Batch [0]/[59]", epoch: 0, totalEpochs: 1, batch: 0, totalBatches: 59 } })), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const record = await adapter.getTaskStatus("req-train");
    expect(record.progress).toMatchObject({ message: "Epoch [0]/[1], Batch [0]/[59]" });
    expect(record.progress?.current).toBeUndefined();
    expect(record.progress?.total).toBeUndefined();
    expect(record.progress?.unit).toBeUndefined();
    expect(record.progress?.details).toMatchObject({ stage: "training", totalBatches: 59 });
  });

  it("maps cancel status and preserves message", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(async () => ({ requestId: "req-1", cancelled: false, status: "running", message: "Task is already running." })), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const result = await adapter.cancelTask("req-1");
    expect(result).toEqual({ requestId: "req-1", cancelled: false, status: "running", message: "Task is already running." });
  });

  it("maps unknown cancel status to unknown", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(async () => ({ requestId: "req-404", cancelled: false, status: "not-found" })), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const result = await adapter.cancelTask("req-404");
    expect(result.status).toBe("unknown");
  });

  it("rejects listTasks when python runtime list endpoint is unavailable", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await expect(adapter.listTasks({})).rejects.toThrow("task listing is not supported");
  });
});
