import type { PythonRuntimePort } from "../../../../application/ports/runtime";
import type {
  PythonRuntimeTaskStatusResult,
  StartPythonRuntimeTaskRequest,
} from "../../../../contracts/runtime";
import { TaskType } from "../../../../contracts/runtime";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { describe, expect, expectTypeOf, it, testDouble } from "../../../../testing/node-test";
import { createPythonRuntimeTaskRegistryAdapter } from "../createPythonRuntimeTaskRegistryAdapter";

describe("createPythonRuntimeTaskRegistryAdapter", () => {
  const workspaceId = createWorkspaceId("workspace.test");

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

    await adapter.startTask({ workspaceId, requestId: "req-ensure", taskType: TaskType.DATASET_PREPARATION, payload: {} });

    expect(callOrder).toEqual(["ensureRuntimeReady", "startTask"]);
  });

  it("does not start task when ensureRuntimeReady fails", async () => {
    const runtimePort: any = { startTask: testDouble.fn(async (request) => ({ requestId: request.requestId })), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const ensureRuntimeReady = testDouble.fn(async () => { throw new Error("supervisor unavailable"); });
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, { ensureRuntimeReady });

    await expect(adapter.startTask({ workspaceId, requestId: "req-fail", taskType: TaskType.DATASET_PREPARATION, payload: {} }))
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
    await adapter.startTask({ workspaceId, requestId: "req-1", taskType: TaskType.DATASET_PREPARATION, payload: { a: 1 } });
    expect(runtimePort.startTask).toHaveBeenCalledWith({ requestId: "req-1", taskType: "prepare-training-dataset", payload: { a: 1 }, metadata: { workspaceId } });
  });

  it("maps MODEL_TRAINING startTask to train-model", async () => {
    const runtimePort: any = { startTask: testDouble.fn(async (request) => ({ requestId: request.requestId })), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ workspaceId, requestId: "req-2", taskType: TaskType.MODEL_TRAINING, payload: {} });
    expect(runtimePort.startTask).toHaveBeenCalledWith({ requestId: "req-2", taskType: "train-model", payload: {}, metadata: { workspaceId } });
  });

  it("maps MODEL_DOWNLOAD progress and keeps the resolved local path private", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(async (request) => ({ requestId: request.requestId, status: "queued" })),
      readTaskStatus: testDouble.fn(async () => ({
        requestId: "download-1",
        taskType: "ensure-model-download",
        status: "succeeded",
        metadata: { workspaceId },
        progress: { message: "Downloading C:\\private\\model", progressUnit: "bytes", downloadedBytes: 25, totalBytes: 100, downloadPercent: 25, token: "secret" },
        data: { provider: "transformers", modelId: "org/model", downloaded: true, fromCache: false, modelHandle: "models--org--model/snapshots/revision" },
      })),
      resolveModelDownloadTaskResult: testDouble.fn(async () => ({ provider: "transformers", modelId: "org/model", downloaded: true, fromCache: false, localPath: "C:\\cache\\private" })),
      cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ workspaceId, requestId: "download-1", taskType: TaskType.MODEL_DOWNLOAD, concurrencyClass: "io", payload: { provider: "transformers", modelId: "org/model" } });
    const record = await adapter.getTaskStatus("download-1");

    expect(runtimePort.startTask.mock.calls[0]?.[0]?.taskType).toBe("ensure-model-download");
    expect(record).toMatchObject({ taskType: TaskType.MODEL_DOWNLOAD, status: "succeeded", progress: { current: 25, total: 100, percent: 25, unit: "bytes" }, data: { modelId: "org/model" } });
    expect(JSON.stringify(record)).not.toContain("modelHandle");
    expect(JSON.stringify(record)).not.toContain("C:\\cache");
    expect(JSON.stringify(record)).not.toContain("secret");
    expect((await adapter.readCompletedModelDownload("download-1"))?.localPath).toBe("C:\\cache\\private");

    const listed = await adapter.listTasks({ workspaceId, taskTypes: [TaskType.MODEL_DOWNLOAD], includeCompleted: true });
    expect(listed.tasks.map((task) => task.requestId)).toEqual(["download-1"]);
  });

  
  it("maps MODEL_VALIDATION startTask type", async () => {
    const runtimePort: any = { startTask: testDouble.fn(async (request) => ({ requestId: request.requestId })), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ workspaceId, requestId: "req-v", taskType: TaskType.MODEL_VALIDATION, payload: { hello: 1 } });
    expect(runtimePort.startTask.mock.calls[0]?.[0]?.taskType).toBe("validate-model");
  });
  it("rejects MODEL_PUBLISHING startTask until implemented", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await expect(adapter.startTask({ workspaceId, requestId: "req-p", taskType: TaskType.MODEL_PUBLISHING, payload: { world: 2 } })).rejects.toThrow("model publishing runtime task is not implemented");
    expect(runtimePort.startTask).not.toHaveBeenCalled();
  });
it("generates non-timestamp request ids when caller does not provide one", async () => {
    const runtimePort: any = { startTask: testDouble.fn(async (request) => ({ requestId: request.requestId })), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ workspaceId, taskType: TaskType.MODEL_TRAINING, payload: {} });
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

  it("returns explicit unsupported metadata only for unsupported task families", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const result = await adapter.listTasks({ workspaceId, taskTypes: [TaskType.MODEL_PUBLISHING] });
    expect(result).toMatchObject({
      tasks: [],
      unsupportedTaskTypes: [TaskType.MODEL_PUBLISHING],
      warnings: [{ code: "python_runtime_task_listing_unsupported", taskTypes: [TaskType.MODEL_PUBLISHING] }],
    });
    expect(result.warnings?.[0]?.details).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("/tmp");
    expect(JSON.stringify(result)).not.toContain("TOKEN=");
  });

  it("does not call ensureRuntimeReady when listing tasks", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const ensureRuntimeReady = testDouble.fn(async () => undefined);
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, { ensureRuntimeReady });

    await adapter.listTasks({});

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
    expect(runtimePort.startTask).not.toHaveBeenCalled();
  });

  it("maps unknown runtime status without a task type to structured not-found", async () => {
    const runtimePort: any = { startTask: testDouble.fn(), readTaskStatus: testDouble.fn(async () => ({ requestId: "req-404", status: "unknown" })), cancelTask: testDouble.fn(), getHealthStatus: testDouble.fn(), getCapabilities: testDouble.fn(), ensureModelDownloaded: testDouble.fn(), getModelStatus: testDouble.fn(), unloadModels: testDouble.fn() };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const record = await adapter.getTaskStatus("req-404");
    expect(record).toMatchObject({ recordType: "not-found", requestId: "req-404", status: "unknown", error: { code: "python_runtime_task_not_found" } });
    expect("taskType" in record).toBe(false);
  });
});
