import type { PythonRuntimePort } from "../../../../application/ports/runtime";
import type {
  PythonRuntimeTaskStatusResult,
  StartPythonRuntimeTaskRequest,
  StartPythonRuntimeTaskResult,
} from "../../../../contracts/runtime";
import { TaskType } from "../../../../contracts/runtime";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  describe,
  expect,
  expectTypeOf,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { createPythonRuntimeTaskRegistryAdapter } from "../createPythonRuntimeTaskRegistryAdapter";
import { PYTHON_RUNTIME_TASK_TIMEOUTS } from "../pythonRuntimeTaskTimeoutPolicy";

describe("createPythonRuntimeTaskRegistryAdapter", () => {
  const workspaceId = createWorkspaceId("workspace.test");
  const acceptWorkerStart = async (request: StartPythonRuntimeTaskRequest): Promise<StartPythonRuntimeTaskResult> => ({
    requestId: request.requestId, taskType: request.taskType, accepted: true, status: "queued",
  });

  it("keeps the python runtime port on python-specific task contracts", () => {
    expectTypeOf<
      Parameters<PythonRuntimePort["startTask"]>[0]
    >().toEqualTypeOf<StartPythonRuntimeTaskRequest>();
    expectTypeOf<
      Awaited<ReturnType<PythonRuntimePort["readTaskStatus"]>>
    >().toEqualTypeOf<PythonRuntimeTaskStatusResult>();
  });

  it("calls ensureRuntimeReady before startTask", async () => {
    const callOrder: string[] = [];
    const runtimePort: any = {
      startTask: testDouble.fn(async (request) => {
        callOrder.push("startTask");
        return { requestId: request.requestId };
      }),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const ensureRuntimeReady = testDouble.fn(async () => {
      callOrder.push("ensureRuntimeReady");
    });
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, {
      ensureRuntimeReady,
    });

    await adapter.startTask({
      workspaceId,
      requestId: "req-ensure",
      taskType: TaskType.DATASET_PREPARATION,
      payload: {},
    });

    expect(callOrder).toEqual(["ensureRuntimeReady", "startTask"]);
    expect(ensureRuntimeReady).toHaveBeenCalledTimes(1);
    expect(ensureRuntimeReady.mock.calls[0]?.[0]).toMatchObject({
      requestId: "req-ensure",
      taskType: TaskType.DATASET_PREPARATION,
    });
  });

  it("does not start task when ensureRuntimeReady fails", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(async (request) => ({
        requestId: request.requestId,
      })),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const ensureRuntimeReady = testDouble.fn(async () => {
      throw new Error("supervisor unavailable");
    });
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, {
      ensureRuntimeReady,
    });

    await expect(
      adapter.startTask({
        workspaceId,
        requestId: "req-fail",
        taskType: TaskType.DATASET_PREPARATION,
        payload: {},
      }),
    ).rejects.toThrow("Python runtime failed to start or become ready");
    expect(runtimePort.startTask).not.toHaveBeenCalled();
  });

  it("lists sanitized Context dependency installation progress before worker acceptance", async () => {
    let releaseEnsure!: () => void;
    const ensureGate = new Promise<void>((resolve) => {
      releaseEnsure = resolve;
    });
    const runtimePort: any = {
      startTask: testDouble.fn(async (request) => ({
        requestId: request.requestId,
        status: "queued",
      })),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, {
      async ensureRuntimeReady(_request, control) {
        control.reportProgress({
          message: "Installing C:\\Users\\private\\lancedb token=secret",
        });
        await ensureGate;
      },
    });

    const start = adapter.startTask({
      workspaceId,
      requestId: "context-install",
      taskType: TaskType.CONTEXT_GENERATION,
      payload: { kind: "rag-database" },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const listed = await adapter.listTasks({
      workspaceId,
      taskTypes: [TaskType.CONTEXT_GENERATION],
      includeCompleted: true,
    });

    expect(listed.tasks.length).toBe(1);
    expect(listed.tasks[0]).toMatchObject({
      requestId: "context-install",
      status: "running",
      progress: { message: expect.stringMatching(/\[local path\]/u) },
    });
    expect(JSON.stringify(listed)).not.toContain("secret");
    expect(runtimePort.startTask).not.toHaveBeenCalled();
    releaseEnsure();
    await start;
    expect(runtimePort.startTask).toHaveBeenCalledTimes(1);
  });

  it("retains a sanitized retryable Context setup failure for notifications", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, {
      async ensureRuntimeReady(_request, control) {
        control.reportProgress({
          message: "Installing local vector database.",
        });
        throw new Error("C:\\private\\runtime token=secret");
      },
    });

    await expect(
      adapter.startTask({
        workspaceId,
        requestId: "context-install-failed",
        taskType: TaskType.CONTEXT_GENERATION,
        payload: { kind: "rag-database" },
      }),
    ).rejects.toThrow("Python runtime failed to prepare Context dependencies");
    const listed = await adapter.listTasks({
      workspaceId,
      taskTypes: [TaskType.CONTEXT_GENERATION],
      includeCompleted: true,
    });
    expect(listed.tasks[0]).toMatchObject({
      requestId: "context-install-failed",
      status: "failed",
      error: {
        code: "python_runtime_context_setup_failed",
        retryable: true,
      },
    });
    expect(JSON.stringify(listed)).not.toContain("private");
    expect(JSON.stringify(listed)).not.toContain("secret");
  });

  it("does not call ensureRuntimeReady when reading task status", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(async () => ({
        requestId: "req-1",
        taskType: "prepare-training-dataset",
        status: "queued",
      })),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const ensureRuntimeReady = testDouble.fn(async () => undefined);
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, {
      ensureRuntimeReady,
    });

    await adapter.getTaskStatus("req-1");

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
  });

  it("does not call ensureRuntimeReady when cancelling task", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(async () => ({
        requestId: "req-1",
        cancelled: true,
        status: "cancelled",
      })),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const ensureRuntimeReady = testDouble.fn(async () => undefined);
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, {
      ensureRuntimeReady,
    });

    await adapter.cancelTask("req-1");

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
  });
  it("maps DATASET_PREPARATION startTask to python runtime task type", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(async (request) => ({
        requestId: request.requestId,
      })),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({
      workspaceId,
      requestId: "req-1",
      taskType: TaskType.DATASET_PREPARATION,
      payload: { a: 1 },
    });
    expect(runtimePort.startTask).toHaveBeenCalledWith({
      requestId: "req-1",
      taskType: "prepare-training-dataset",
      payload: { a: 1 },
      metadata: { workspaceId },
      timeoutMs: PYTHON_RUNTIME_TASK_TIMEOUTS.datasetPreparation,
    });
  });

  it("maps DATASET_REVIEW to bounded long-running parquet work", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(async (request) => ({
        requestId: request.requestId,
      })),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({
      workspaceId,
      requestId: "review-1",
      taskType: TaskType.DATASET_REVIEW,
      payload: { operation: "read" },
    });
    expect(runtimePort.startTask).toHaveBeenCalledWith({
      requestId: "review-1",
      taskType: "review-dataset",
      payload: { operation: "read" },
      metadata: { workspaceId },
      timeoutMs: PYTHON_RUNTIME_TASK_TIMEOUTS.datasetReview,
    });
  });

  it("maps CONTEXT_GENERATION to bounded context artifact work", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(async (request) => ({
        requestId: request.requestId,
      })),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({
      workspaceId,
      requestId: "context-1",
      taskType: TaskType.CONTEXT_GENERATION,
      payload: { kind: "rag-database" },
    });
    expect(runtimePort.startTask).toHaveBeenCalledWith({
      requestId: "context-1",
      taskType: "generate-context-artifact",
      payload: { kind: "rag-database" },
      metadata: { workspaceId },
      timeoutMs: PYTHON_RUNTIME_TASK_TIMEOUTS.contextGeneration,
    });
  });

  it("maps MODEL_TRAINING startTask to train-model", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(acceptWorkerStart),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({
      workspaceId,
      requestId: "req-2",
      taskType: TaskType.MODEL_TRAINING,
      payload: {},
    });
    expect(runtimePort.startTask).toHaveBeenCalledWith({
      requestId: "req-2",
      taskType: "train-model",
      payload: {},
      metadata: { workspaceId },
      timeoutMs: PYTHON_RUNTIME_TASK_TIMEOUTS.modelTraining,
    });
  });

  for (const [label, replacement] of [
    ["a different request ID", { requestId: "unrelated-run" }],
    ["a different task type", { taskType: "prepare-training-dataset" }],
    ["a refused start", { accepted: false }],
    ["a different workspace", { metadata: { workspaceId: "workspace.other" } }],
    ["a terminal status", { status: "succeeded" }],
    ["an incomplete acknowledgement", { accepted: undefined }],
  ] as const) {
    it(`does not track a model training start reply with ${label}`, async () => {
      const adapter = createPythonRuntimeTaskRegistryAdapter({
        startTask: async (request: StartPythonRuntimeTaskRequest) => ({
          ...await acceptWorkerStart(request), ...replacement,
        }),
      } as unknown as PythonRuntimePort, {
        ensureRuntimeReady: async (_request, control) => { control.reportProgress({ message: "Preparing" }); },
      });
      await expect(adapter.startTask({
        workspaceId, requestId: "training-1", taskType: TaskType.MODEL_TRAINING, payload: {},
      })).rejects.toThrow("Model training start did not match its requested task.");
      expect((await adapter.listTasks({ workspaceId })).tasks).toEqual([]);
    });
  }

  it("protects a tracked training start from another request or a substituted reply", async () => {
    const other = createWorkspaceId("workspace.other");
    const workerStart = testDouble.fn(async (request: StartPythonRuntimeTaskRequest) => ({
      ...await acceptWorkerStart(request),
      requestId: "training-1",
    }));
    const adapter = createPythonRuntimeTaskRegistryAdapter({
      startTask: workerStart,
      readTaskStatus: async () => { throw new Error("Synthetic status unavailable."); },
    } as unknown as PythonRuntimePort);
    const request = { workspaceId, requestId: "training-1", taskType: TaskType.MODEL_TRAINING, payload: {} };
    await adapter.startTask(request);
    await expect(adapter.startTask({ ...request, workspaceId: other, taskType: TaskType.DATASET_PREPARATION }))
      .rejects.toThrow("Model training start did not match its requested task.");
    expect(workerStart).toHaveBeenCalledTimes(1);
    await expect(adapter.startTask({ ...request, workspaceId: other, requestId: "dataset-1", taskType: TaskType.DATASET_PREPARATION }))
      .rejects.toThrow("Model training start did not match its requested task.");
    expect(workerStart).toHaveBeenCalledTimes(2);
    const listed = (await adapter.listTasks({ workspaceId })).tasks;
    expect(listed.length).toBe(1);
    expect(listed[0]).toMatchObject({ workspaceId, requestId: "training-1", taskType: TaskType.MODEL_TRAINING });
    expect((await adapter.listTasks({ workspaceId: other })).tasks).toEqual([]);
  });

  it("maps MODEL_DOWNLOAD progress and keeps the resolved local path private", async () => {
    let status: PythonRuntimeTaskStatusResult["status"] = "running";
    const runtimePort: any = {
      startTask: testDouble.fn(acceptWorkerStart),
      readTaskStatus: testDouble.fn(async () => ({
        requestId: "download-1",
        taskType: "ensure-model-download",
        status,
        metadata: { workspaceId },
        progress: {
          message: "Downloading C:\\private\\model",
          progressUnit: "bytes",
          downloadedBytes: 25,
          totalBytes: 100,
          downloadPercent: 25,
          token: "secret",
        },
        data: {
          provider: "transformers",
          modelId: "org/model",
          downloaded: true,
          fromCache: false,
          modelHandle: "models--org--model/snapshots/revision",
        },
      })),
      resolveModelDownloadTaskResult: testDouble.fn(async () => ({
        provider: "transformers",
        modelId: "org/model",
        downloaded: true,
        fromCache: false,
        localPath: "C:\\cache\\private",
      })),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({
      workspaceId,
      requestId: "download-1",
      taskType: TaskType.MODEL_DOWNLOAD,
      concurrencyClass: "io",
      payload: { provider: "transformers", modelId: "org/model" },
    });
    const progress = await adapter.getTaskStatus("download-1");
    expect(JSON.stringify(progress)).not.toContain("modelHandle");
    expect(runtimePort.resolveModelDownloadTaskResult).not.toHaveBeenCalled();
    status = "succeeded";
    const record = await adapter.getTaskStatus("download-1");

    expect(runtimePort.startTask.mock.calls[0]?.[0]?.taskType).toBe(
      "ensure-model-download",
    );
    expect(runtimePort.startTask.mock.calls[0]?.[0]?.timeoutMs).toBe(
      PYTHON_RUNTIME_TASK_TIMEOUTS.modelDownload,
    );
    expect(record).toMatchObject({
      taskType: TaskType.MODEL_DOWNLOAD,
      status: "succeeded",
      progress: { current: 25, total: 100, percent: 25, unit: "bytes" },
      data: { modelId: "org/model" },
    });
    expect(JSON.stringify(record)).not.toContain("modelHandle");
    expect(JSON.stringify(record)).not.toContain("C:\\cache");
    expect(JSON.stringify(record)).not.toContain("secret");
    expect(
      (await adapter.readCompletedModelDownload("download-1"))?.localPath,
    ).toBe("C:\\cache\\private");

    const listed = await adapter.listTasks({
      workspaceId,
      taskTypes: [TaskType.MODEL_DOWNLOAD],
      includeCompleted: true,
    });
    expect(listed.tasks.map((task) => task.requestId)).toEqual(["download-1"]);
  });

  for (const [label, replacement] of [
    ["an unowned request", undefined],
    ["a different request", { requestId: "download-other" }],
    ["a different task type", { taskType: "train-model" }],
    ["a different workspace", { metadata: { workspaceId: "workspace.other" } }],
    ["a malformed workspace", { metadata: { workspaceId: false } }],
    ["a different workspace during progress", { status: "running", metadata: { workspaceId: "workspace.other" } }],
  ] satisfies Array<[string, Partial<PythonRuntimeTaskStatusResult> | undefined]>) {
    it(`refuses model download status for ${label} before resolving a private result`, async () => {
      const accepted: PythonRuntimeTaskStatusResult = {
        requestId: "download-1",
        taskType: "ensure-model-download",
        status: "succeeded",
      };
      let status = accepted;
      const resolveModelDownloadTaskResult = testDouble.fn(async () => ({
        provider: "transformers" as const,
        modelId: "org/model",
        downloaded: true,
        fromCache: false,
        localPath: "C:\\synthetic\\model",
      }));
      const runtimePort = {
        startTask: testDouble.fn(acceptWorkerStart),
        readTaskStatus: testDouble.fn(async () => status),
        resolveModelDownloadTaskResult,
      } as unknown as PythonRuntimePort;
      const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
      const start = () => adapter.startTask({ workspaceId, requestId: accepted.requestId, taskType: TaskType.MODEL_DOWNLOAD, payload: {} });
      if (replacement) {
        await start();
        status = { ...accepted, ...replacement };
      }
      await expect(adapter.getTaskStatus(accepted.requestId)).rejects.toThrow("Model download status did not match its accepted task.");
      expect(resolveModelDownloadTaskResult).not.toHaveBeenCalled();

      // A valid reply without optional metadata uses the already accepted workspace.
      if (!replacement) await start();
      status = accepted;
      const record = await adapter.getTaskStatus(accepted.requestId);
      expect(record).toMatchObject({ workspaceId, status: "succeeded", taskType: TaskType.MODEL_DOWNLOAD });
      expect(JSON.stringify(record)).not.toContain("C:\\synthetic");
      expect((await adapter.readCompletedModelDownload(accepted.requestId))?.localPath).toBe("C:\\synthetic\\model");
      expect(resolveModelDownloadTaskResult).toHaveBeenCalledTimes(1);
    });
  }

  it("does not treat progress before worker acceptance as download ownership", async () => {
    let finishStatus!: () => void;
    let finishReadiness!: () => void;
    const statusReady = new Promise<void>((resolve) => { finishStatus = resolve; });
    const readiness = new Promise<void>((resolve) => { finishReadiness = resolve; });
    const startTask = testDouble.fn(acceptWorkerStart);
    const resolveModelDownloadTaskResult = testDouble.fn(async () => ({
      provider: "transformers" as const, modelId: "org/model", downloaded: true, fromCache: false, localPath: "C:\\synthetic\\model",
    }));
    const adapter = createPythonRuntimeTaskRegistryAdapter({
      startTask,
      readTaskStatus: async (requestId: string) => {
        await statusReady;
        return { requestId, taskType: "ensure-model-download", status: "succeeded" };
      },
      resolveModelDownloadTaskResult,
    } as unknown as PythonRuntimePort, {
      ensureRuntimeReady: async (_request, control) => {
        control.reportProgress({ message: "Preparing" });
        await readiness;
      },
    });

    const reading = adapter.getTaskStatus("download-1");
    const starting = adapter.startTask({ workspaceId, requestId: "download-1", taskType: TaskType.MODEL_DOWNLOAD, payload: {} });
    try {
      expect(startTask).not.toHaveBeenCalled();
      finishStatus();
      await expect(reading).rejects.toThrow("Model download status did not match its accepted task.");
      expect(resolveModelDownloadTaskResult).not.toHaveBeenCalled();
    } finally {
      finishStatus();
      finishReadiness();
      await starting;
    }
    expect((await adapter.readCompletedModelDownload("download-1"))?.localPath).toBe("C:\\synthetic\\model");
  });

  it("does not cache a model cancellation acknowledgement for a different ID", async () => {
    let replyId = "download-other";
    const adapter = createPythonRuntimeTaskRegistryAdapter({
      startTask: acceptWorkerStart,
      cancelTask: async () => ({ requestId: replyId, status: "cancelled", cancelled: true }),
    } as unknown as PythonRuntimePort);
    for (const requestId of ["download-1", "download-other"]) {
      await adapter.startTask({ workspaceId, requestId, taskType: TaskType.MODEL_DOWNLOAD, payload: {} });
    }
    for (const requestId of ["download-1", "untracked-id"]) {
      await expect(adapter.cancelTask(requestId)).rejects.toThrow("Model download cancellation did not match its accepted task.");
    }
    const list = () => adapter.listTasks({ workspaceId, taskTypes: [TaskType.MODEL_DOWNLOAD], includeCompleted: true });
    expect((await list()).tasks.map(({ status }) => status)).toEqual(["queued", "queued"]);
    replyId = "download-1";
    expect(await adapter.cancelTask("download-1")).toMatchObject({ requestId: "download-1", status: "cancelled", cancelled: true });
    const { tasks } = await list();
    expect(tasks.find(({ requestId }) => requestId === "download-1")?.status).toBe("cancelled");
    expect(tasks.find(({ requestId }) => requestId === "download-other")?.status).toBe("queued");
  });

  it("refuses to cancel a model download before the worker accepts it", async () => {
    let accept!: () => void;
    const readiness = new Promise<void>((resolve) => { accept = resolve; });
    const cancelTask = testDouble.fn<PythonRuntimePort["cancelTask"]>(async (requestId) =>
      ({ requestId, status: "cancelled", cancelled: true }));
    const adapter = createPythonRuntimeTaskRegistryAdapter({
      startTask: acceptWorkerStart, cancelTask,
    } as unknown as PythonRuntimePort, { ensureRuntimeReady: () => readiness });
    const starting = adapter.startTask({ workspaceId, requestId: "download-1", taskType: TaskType.MODEL_DOWNLOAD, payload: {} });
    try {
      await expect(adapter.cancelTask("download-1")).rejects.toThrow("Model download cancellation did not match its accepted task.");
      expect(cancelTask).not.toHaveBeenCalled();
    } finally {
      accept();
      await starting;
    }
    expect(await adapter.cancelTask("download-1")).toMatchObject({ requestId: "download-1", status: "cancelled" });
    expect(cancelTask).toHaveBeenCalledTimes(1);
  });

  it("does not mark a replacement download cancelled when its predecessor's reply arrives late", async () => {
    let reply!: (value: Awaited<ReturnType<PythonRuntimePort["cancelTask"]>>) => void;
    const pending = new Promise<Awaited<ReturnType<PythonRuntimePort["cancelTask"]>>>((resolve) => { reply = resolve; });
    const adapter = createPythonRuntimeTaskRegistryAdapter({
      startTask: acceptWorkerStart, cancelTask: () => pending,
    } as unknown as PythonRuntimePort);
    const requestId = "download-1";
    await adapter.startTask({ workspaceId, requestId, taskType: TaskType.MODEL_DOWNLOAD, payload: {} });
    const cancelled = Promise.allSettled([adapter.cancelTask(requestId)]);
    const other = createWorkspaceId("workspace.other");
    try {
      for (let index = 0; index < 256; index++) {
        await adapter.startTask({ workspaceId, requestId: "fixture-task-" + index, taskType: TaskType.MODEL_DOWNLOAD, payload: {} });
      }
      await adapter.startTask({ workspaceId: other, requestId, taskType: TaskType.MODEL_DOWNLOAD, payload: {} });
      reply({ requestId, status: "cancelled", cancelled: true });
      expect((await cancelled)[0]).toMatchObject({ status: "rejected", reason: { message: "Model download cancellation did not match its accepted task." } });
      const { tasks } = await adapter.listTasks({ workspaceId: other, taskTypes: [TaskType.MODEL_DOWNLOAD], includeCompleted: true });
      expect(tasks.length).toBe(1);
      expect(tasks[0]).toMatchObject({ requestId, workspaceId: other, status: "queued" });
    } finally {
      reply({ requestId, status: "cancelled", cancelled: true });
      await cancelled;
    }
  });

  for (const [label, replacement] of [
    ["a different request ID", { requestId: "download-other" }],
    ["a different task type", { taskType: "train-model" }],
    ["a refused start", { accepted: false }],
    ["a different workspace", { metadata: { workspaceId: "workspace.other" } }],
    ["a terminal status", { status: "failed" }],
  ] as const) {
    it(`refuses a model download start acknowledgment with ${label}`, async () => {
      const adapter = createPythonRuntimeTaskRegistryAdapter({
        startTask: async (request: StartPythonRuntimeTaskRequest) => ({ ...await acceptWorkerStart(request), ...replacement }),
      } as unknown as PythonRuntimePort);
      await expect(adapter.startTask({ workspaceId, requestId: "download-1", taskType: TaskType.MODEL_DOWNLOAD, payload: {} }))
        .rejects.toThrow("Model download status did not match its accepted task.");
    });
  }

  it("admits one worker start while the exact model download ID is pending", async () => {
    let enterStart!: () => void;
    let finishStart!: () => void;
    const entered = new Promise<void>((resolve) => { enterStart = resolve; });
    const release = new Promise<void>((resolve) => { finishStart = resolve; });
    let calls = 0;
    const adapter = createPythonRuntimeTaskRegistryAdapter({
      startTask: async (request: StartPythonRuntimeTaskRequest) => {
        if (++calls === 1) {
          enterStart();
          await release;
        }
        return acceptWorkerStart(request);
      },
    } as unknown as PythonRuntimePort);
    const request = { workspaceId, requestId: "download-1", taskType: TaskType.MODEL_DOWNLOAD, payload: {} } as const;
    const first = adapter.startTask(request);
    await Promise.race([entered, first.then(() => { throw new Error("Expected a pending worker start."); })]);
    try {
      await expect(adapter.startTask({ ...request, workspaceId: createWorkspaceId("workspace.other") }))
        .rejects.toThrow("Model download status did not match its accepted task.");
      expect(calls).toBe(1);
    } finally {
      finishStart();
      await first;
    }
  });

  it("does not let another task response overwrite an accepted download", async () => {
    const runtimePort = {
      startTask: acceptWorkerStart,
      readTaskStatus: async (requestId: string) => requestId === "download-1"
        ? { requestId, taskType: "ensure-model-download", status: "running" }
        : { requestId: "download-1", taskType: "review-dataset", status: "succeeded", metadata: { workspaceId: "workspace.other" } },
    } as unknown as PythonRuntimePort;
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ workspaceId, requestId: "download-1", taskType: TaskType.MODEL_DOWNLOAD, payload: {} });
    await expect(adapter.getTaskStatus("review-1")).rejects.toThrow("Model download status did not match its accepted task.");
    expect((await adapter.listTasks({ workspaceId, taskTypes: [TaskType.MODEL_DOWNLOAD] })).tasks)
      .toMatchObject([{ requestId: "download-1", workspaceId, taskType: TaskType.MODEL_DOWNLOAD }]);
  });

  for (const reused of [false, true]) it(`does not publish an old download after eviction${reused ? " and task ID reuse" : ""}`, async () => {
    let enterResolver!: () => void;
    let finishResolver!: () => void;
    let resolutions = 0;
    const entered = new Promise<void>((resolve) => { enterResolver = resolve; });
    const release = new Promise<void>((resolve) => { finishResolver = resolve; });
    const runtimePort = {
      startTask: acceptWorkerStart,
      readTaskStatus: async (requestId: string) => ({ requestId, taskType: "ensure-model-download", status: "succeeded" }),
      resolveModelDownloadTaskResult: async () => {
        const resolution = ++resolutions;
        if (resolution === 1) {
          enterResolver();
          await release;
        }
        return { provider: "transformers", modelId: "org/model", downloaded: true, fromCache: false, localPath: `C:\\synthetic\\model-${resolution}` };
      },
    } as unknown as PythonRuntimePort;
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({ workspaceId, requestId: "download-1", taskType: TaskType.MODEL_DOWNLOAD, payload: {} });

    const reading = adapter.getTaskStatus("download-1");
    await Promise.race([entered, reading.then(() => { throw new Error("Expected private resolution."); })]);
    try {
      for (let index = 0; index < 256; index++) {
        await adapter.startTask({ workspaceId, requestId: `review-${index}`, taskType: TaskType.DATASET_REVIEW, payload: {} });
      }
      if (reused) await adapter.startTask({ workspaceId, requestId: "download-1", taskType: TaskType.MODEL_DOWNLOAD, payload: {} });
    } finally {
      finishResolver();
    }
    await expect(reading).rejects.toThrow("Model download status did not match its accepted task.");
    if (reused) {
      expect((await adapter.readCompletedModelDownload("download-1"))?.localPath).toBe("C:\\synthetic\\model-2");
    } else {
      await expect(adapter.readCompletedModelDownload("download-1")).rejects.toThrow("Model download status did not match its accepted task.");
    }
  });

  it("maps MODEL_VALIDATION startTask type", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(async (request) => ({
        requestId: request.requestId,
      })),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({
      workspaceId,
      requestId: "req-v",
      taskType: TaskType.MODEL_VALIDATION,
      payload: { hello: 1 },
    });
    expect(runtimePort.startTask.mock.calls[0]?.[0]?.taskType).toBe(
      "validate-model",
    );
    expect(runtimePort.startTask.mock.calls[0]?.[0]?.timeoutMs).toBe(
      PYTHON_RUNTIME_TASK_TIMEOUTS.validation,
    );
  });
  it("rejects MODEL_PUBLISHING startTask until implemented", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await expect(
      adapter.startTask({
        workspaceId,
        requestId: "req-p",
        taskType: TaskType.MODEL_PUBLISHING,
        payload: { world: 2 },
      }),
    ).rejects.toThrow("model publishing runtime task is not implemented");
    expect(runtimePort.startTask).not.toHaveBeenCalled();
  });
  it("generates non-timestamp request ids when caller does not provide one", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(acceptWorkerStart),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await adapter.startTask({
      workspaceId,
      taskType: TaskType.MODEL_TRAINING,
      payload: {},
    });
    const requestId = runtimePort.startTask.mock.calls[0]?.[0]
      ?.requestId as string;
    expect(requestId.startsWith("runtime-task-")).toBe(false);
    expect(typeof requestId).toBe("string");
    expect(requestId.length).toBe(36);
  });

  it("throws clear error for unknown python task type in status", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(async () => ({
        requestId: "req-1",
        taskType: "mystery-task",
        status: "running",
      })),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    await expect(adapter.getTaskStatus("req-1")).rejects.toThrow(
      "Unknown python runtime task type",
    );
  });
  it("maps python chunk progress into generic runtime progress fields", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(async () => ({
        requestId: "req-1",
        taskType: "prepare-training-dataset",
        status: "running",
        progress: {
          message: "Processing chunk 2/8...",
          processedChunkCount: 2,
          totalChunkCount: 8,
          generatedRowCount: 40,
        },
      })),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const record = await adapter.getTaskStatus("req-1");
    expect(record.progress).toMatchObject({
      message: "Processing chunk 2/8...",
      current: 2,
      total: 8,
      unit: "chunk",
    });
    expect(record.progress?.details).toMatchObject({ generatedRowCount: 40 });
  });

  it("keeps generic progress mapping when chunk fields are not present", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(async () => ({
        requestId: "req-train",
        taskType: "train-model",
        status: "running",
        progress: {
          stage: "training",
          message: "Epoch [0]/[1], Batch [0]/[59]",
          epoch: 0,
          totalEpochs: 1,
          batch: 0,
          totalBatches: 59,
        },
      })),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const record = await adapter.getTaskStatus("req-train");
    expect(record.progress).toMatchObject({
      message: "Epoch [0]/[1], Batch [0]/[59]",
    });
    expect(record.progress?.current).toBeUndefined();
    expect(record.progress?.total).toBeUndefined();
    expect(record.progress?.unit).toBeUndefined();
    expect(record.progress?.details).toMatchObject({
      stage: "training",
      totalBatches: 59,
    });
  });

  it("maps cancel status and preserves message", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(async () => ({
        requestId: "req-1",
        cancelled: false,
        status: "running",
        message: "Task is already running.",
      })),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const result = await adapter.cancelTask("req-1");
    expect(result).toEqual({
      requestId: "req-1",
      cancelled: false,
      status: "running",
      message: "Task is already running.",
    });
  });

  it("maps unknown cancel status to unknown", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(async () => ({
        requestId: "req-404",
        cancelled: false,
        status: "not-found",
      })),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const result = await adapter.cancelTask("req-404");
    expect(result.status).toBe("unknown");
  });

  it("returns explicit unsupported metadata only for unsupported task families", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const result = await adapter.listTasks({
      workspaceId,
      taskTypes: [TaskType.MODEL_PUBLISHING],
    });
    expect(result).toMatchObject({
      tasks: [],
      unsupportedTaskTypes: [TaskType.MODEL_PUBLISHING],
      warnings: [
        {
          code: "python_runtime_task_listing_unsupported",
          taskTypes: [TaskType.MODEL_PUBLISHING],
        },
      ],
    });
    expect(result.warnings?.[0]?.details).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("/tmp");
    expect(JSON.stringify(result)).not.toContain("TOKEN=");
  });

  it("does not call ensureRuntimeReady when listing tasks", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const ensureRuntimeReady = testDouble.fn(async () => undefined);
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort, {
      ensureRuntimeReady,
    });

    await adapter.listTasks({});

    expect(ensureRuntimeReady).not.toHaveBeenCalled();
    expect(runtimePort.startTask).not.toHaveBeenCalled();
  });

  it("maps unknown runtime status without a task type to structured not-found", async () => {
    const runtimePort: any = {
      startTask: testDouble.fn(),
      readTaskStatus: testDouble.fn(async () => ({
        requestId: "req-404",
        status: "unknown",
      })),
      cancelTask: testDouble.fn(),
      getHealthStatus: testDouble.fn(),
      getCapabilities: testDouble.fn(),
      ensureModelDownloaded: testDouble.fn(),
      getModelStatus: testDouble.fn(),
      unloadModels: testDouble.fn(),
    };
    const adapter = createPythonRuntimeTaskRegistryAdapter(runtimePort);
    const record = await adapter.getTaskStatus("req-404");
    expect(record).toMatchObject({
      recordType: "not-found",
      requestId: "req-404",
      status: "unknown",
      error: { code: "python_runtime_task_not_found" },
    });
    expect("taskType" in record).toBe(false);
  });
});
