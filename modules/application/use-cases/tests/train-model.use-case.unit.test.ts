import { OwnedTaskReconcilerService } from "../../services/runtime/owned-task-reconciler.service";
import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it, testDouble } from "../../../testing/node-test";

import {
  TaskType,
  type RuntimeTaskRegistryPort,
  type StartRuntimeTaskRequest,
} from "../../../contracts/runtime";
import type { TaskPowerLifecyclePort } from "../../services/runtime";
import type {
  GeneratedModelStoragePort,
  ModelPublisherPort,
  ModelRegistryPort,
} from "../../ports/model";
import type {
  ArtifactObjectStoragePort,
  ArtifactStorageBindingPort,
} from "../../ports/storage";
import { TrainModelUseCase } from "../model/train-model.use-case";
import { RuntimeCapabilityUnavailableError } from "../../services/runtime/runtime-capability-guard.service";

describe("TrainModelUseCase", () => {
  const baseRequest = {
    workspaceId: "workspace-a" as never,
    trainingTask: "llm-classification",
    baseModel: { modelRecordId: "base-1" },
    datasets: [{ artifactId: "dataset-1", splitRole: "train" as const }],
    method: "lora" as const,
    commonParameters: {},
    output: {
      outputModelName: "demo-adapter",
      destination: { local: { enabled: true } },
      registration: {
        displayName: "Demo Adapter",
        artifactForm: "adapter" as const,
      },
    },
  };
  const baseRegistry: ModelRegistryPort = {
    listModels: async () => ({ models: [] }),
    getModelRecord: async () => ({
      modelRecordId: "base-1",
      displayName: "Base",
      source: "huggingface",
      lifecycleStatus: "saved-reference",
      artifactForm: "full-model",
      provider: "huggingface",
      modelId: "org/base",
      createdAt: "2026-04-27T00:00:00.000Z",
    }),
    saveModelReference: async () => {
      throw new Error("not used");
    },
    registerDownloadedModel: async () => {
      throw new Error("not used");
    },
    updateModelRecord: async () => {
      throw new Error("not used");
    },
    deleteModelRecord: async () => {
      throw new Error("not used");
    },
  };

  const createLifecycleFake = (): TaskPowerLifecyclePort => ({
    startTask: testDouble.fn(async () => undefined),
    completeTask: testDouble.fn(async () => undefined),
  });

  const ownedStages = new Map<string, { dev: bigint; ino: bigint }>();
  const stagePath = (request: StartRuntimeTaskRequest) =>
    (request.payload as { output: { outputDirectory: string } }).output.outputDirectory;
  const rememberStage = async (request: StartRuntimeTaskRequest) => {
    const stage = stagePath(request);
    expect(dirname(stage)).toBe(await realpath(tmpdir()));
    expect(basename(stage)).toMatch(/^ai-system-builder-training-output-[A-Za-z0-9]{6}$/);
    const stats = await lstat(stage, { bigint: true });
    expect(stats.isDirectory()).toBe(true);
    ownedStages.set(stage, { dev: stats.dev, ino: stats.ino });
    for (const dataset of (request.payload as {datasets: {path: string}[]}).datasets) {
      const directory = dirname(dataset.path);
      expect(dirname(directory)).toBe(await realpath(tmpdir()));
      expect(basename(directory)).toMatch(/^ai-system-builder-training-datasets-[A-Za-z0-9]{6}$/);
      const identity = await lstat(directory, {bigint: true});
      expect(identity.isDirectory()).toBe(true);
      ownedStages.set(directory, {dev: identity.dev, ino: identity.ino});
    }
  };
  const stagedOutputFrom = (runtime: RuntimeTaskRegistryPort) => stagePath(
    (runtime.startTask as ReturnType<typeof testDouble.fn>).mock.calls[0][0],
  );
  afterEach(async () => {
    for (const [stage, original] of ownedStages) {
      const current = await lstat(stage, { bigint: true }).catch(() => undefined);
      if (current?.isDirectory() && current.dev === original.dev && current.ino === original.ino
          && await realpath(stage) === stage && dirname(stage) === await realpath(tmpdir())) {
        await rm(stage, { recursive: true });
      }
    }
    ownedStages.clear();
  });

  const createRuntimeTaskRegistryFake = (): RuntimeTaskRegistryPort => ({
    startTask: testDouble.fn(async (request: StartRuntimeTaskRequest) => {
      await rememberStage(request);
      return { requestId: "train-req-1", accepted: true, status: "queued" };
    }),
    getTaskStatus: testDouble.fn(async () => ({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
      workspaceId: "workspace-a" as never,
      status: "running",
      concurrencyClass: "unknown",
    })),
    cancelTask: testDouble.fn(async () => ({
      requestId: "train-req-1",
      cancelled: false,
      status: "running",
    })),
    listTasks: testDouble.fn(async () => ({ tasks: [] })),
  });
  const createStorageBindingsFake = (): Pick<
    ArtifactStorageBindingPort,
    "readArtifactStorageBindings"
  > => ({
    readArtifactStorageBindings: testDouble.fn(async () => ({
      ok: true as const,
      value: {
        bindings: [
          {
            artifactId: "dataset-1",
            workspaceId: "workspace-a" as never,
            role: "primary",
            backing: {
              kind: "artifact-object",
              provider: "local-filesystem",
              locator: "datasets/dataset-1.parquet",
            },
          },
        ],
      },
    })),
  });
  const createStorageFake = (): Pick<
    ArtifactObjectStoragePort,
    "retrieveArtifact"
  > => ({
    retrieveArtifact: testDouble.fn(async () => ({
      ok: true as const,
      value: {
        descriptor: {
          key: "generated/dataset-1.parquet",
          mediaType: "application/x-parquet",
          metadata: {
            structuredOutput: {
              schemaFingerprint: "a".repeat(64),
              purposePaths: {
                text: ["result", "body"],
                label: ["result", "category"],
              },
            },
          },
        },
        content: new TextEncoder().encode("dataset-bytes"),
      },
    })),
  });
  const createGeneratedModelStorageFake = (): GeneratedModelStoragePort => ({
    storeGeneratedModel: testDouble.fn(async () => ({
      localPath: "/models/generated/demo-adapter",
      modelId: "generated/demo-adapter",
    })),
  });

  for (const stage of ["request-validation", "runtime-readiness", "base-model", "dataset-resolution", "task-dispatch", "task-registration"] as const) it(`keeps the original training-start failure and adds only a safe ${stage} code`, async () => {
    const failure = new Error("private-synthetic-start-detail");
    const runtime = createRuntimeTaskRegistryFake();
    if (stage === "task-dispatch") runtime.startTask = async (request: StartRuntimeTaskRequest) => { await rememberStage(request); throw failure; };
    if (stage === "task-registration") runtime.startTask = async (request: StartRuntimeTaskRequest) => {
      await rememberStage(request);
      return { requestId: "", accepted: true, status: "queued" };
    };
    const bindings = createStorageBindingsFake();
    if (stage === "dataset-resolution") bindings.readArtifactStorageBindings = async () => { throw failure; };
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry: runtime,
      modelRegistry: stage === "base-model" ? { ...baseRegistry, getModelRecord: async () => { throw failure; } } : baseRegistry,
      storageBindings: bindings, storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake(),
      runtimeCapabilityGuard: { requireCapabilityReady: async () => { if (stage === "runtime-readiness") throw failure; return {} as never; } },
    });
    let caught: unknown;
    try { await useCase.execute(stage === "request-validation" ? { ...baseRequest, workspaceId: undefined } : baseRequest); } catch (error) { caught = error; }
    expect((caught as Error & { code?: string }).code).toBe(`MODEL_TRAINING_START_${stage.replaceAll("-", "_").toUpperCase()}`);
    if (stage !== "request-validation" && stage !== "task-registration") expect(caught).toBe(failure);
    expect(Object.getOwnPropertyDescriptor(caught, "code")?.enumerable).toBe(false);
    expect(JSON.stringify(caught)).not.toContain("private-synthetic-start-detail");
    if (stage === "task-dispatch" || stage === "task-registration") {
      expect(ownedStages.size).toBe(2);
      expect([...ownedStages.keys()].filter(directory => basename(directory).startsWith("ai-system-builder-training-output-")).length).toBe(1);
      expect([...ownedStages.keys()].filter(directory => basename(directory).startsWith("ai-system-builder-training-datasets-")).length).toBe(1);
      for (const directory of ownedStages.keys()) await expect(access(directory)).resolves.toBeUndefined();
    }
  });

  for (const kind of ["typed-readiness", "existing-code", "frozen", "proxy", "accessor-code", "primitive"] as const) it(`preserves protected ${kind} training failures without inspecting private fields`, async () => {
    let inspections = 0;
    const original = new Error("private-synthetic-detail");
    const typed = new RuntimeCapabilityUnavailableError({ capabilityId: "model-training", status: "unavailable", summary: "Unavailable", available: false, healthy: false, updatedAt: "2026-01-01T00:00:00Z" } as never);
    const failure = kind === "typed-readiness" ? typed : kind === "primitive" ? "private-synthetic-detail" : kind === "proxy" ? new Proxy(original, { get() { inspections++; throw new Error("must not inspect"); }, getPrototypeOf() { inspections++; throw new Error("must not inspect"); } }) : original;
    if (kind === "existing-code") Object.defineProperty(original, "code", { value: "ENOENT" });
    if (kind === "frozen") Object.freeze(original);
    if (kind === "accessor-code") Object.defineProperty(original, "code", { get() { inspections++; throw new Error("must not inspect"); } });
    const useCase = new TrainModelUseCase({ runtimeTaskRegistry: createRuntimeTaskRegistryFake(), modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake(), runtimeCapabilityGuard: { requireCapabilityReady: async () => { throw failure; } } });
    let caught: unknown;
    try { await useCase.execute(baseRequest); } catch (error) { caught = error; }
    expect(caught).toBe(failure); expect(inspections).toBe(0);
    if (kind === "typed-readiness") expect(typed.code).toBe("unavailable");
    if (kind === "existing-code") expect((original as Error & { code?: string }).code).toBe("ENOENT");
    if (kind === "frozen") expect(Object.getOwnPropertyDescriptor(original, "code")).toBeUndefined();
  });

  for (const data of [undefined, { runId: "train-req-1", status: "invalid" },
    { runId: "train-req-1", status: "succeeded" },
  ]) it("settles malformed successful training output without a renderer", async () => {
    const lifecycle = createLifecycleFake(); const reconciler = new OwnedTaskReconcilerService();
    const runtime = createRuntimeTaskRegistryFake();
    (runtime.getTaskStatus as ReturnType<typeof testDouble.fn>).mockResolvedValue({ requestId: "train-req-1", workspaceId: "workspace-a", taskType: TaskType.MODEL_TRAINING, status: "succeeded", data });
    const registration = testDouble.fn();
    const useCase = new TrainModelUseCase({ runtimeTaskRegistry: runtime, taskReconciler: reconciler, modelRegistry: { ...baseRegistry, registerGeneratedModel: registration }, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: lifecycle });
    await useCase.execute(baseRequest); await reconciler.reconcileNow();
    expect(reconciler.status.pending).toBe(0);
    expect(await useCase.read("train-req-1", "workspace-a")).toMatchObject({ status: "failed", error: { code: "invalid_runtime_result" } });
    expect(lifecycle.completeTask).toHaveBeenCalledWith("train-req-1", "failed"); expect(registration).not.toHaveBeenCalled();
  });

  it("starts training with runtime task registry", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: {
        ...baseRegistry,
        registerGeneratedModel:
          testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>(),
      },
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      taskPowerLifecycle: lifecycle,
    });

    const result = await useCase.execute(baseRequest);

    expect(runtimeTaskRegistry.startTask).toHaveBeenCalledTimes(1);
    const startRequest = (
      runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>
    ).mock.calls[0]?.[0];
    expect(startRequest.workspaceId).toBe(baseRequest.workspaceId);
    expect(startRequest.taskType).toBe(TaskType.MODEL_TRAINING);
    expect(startRequest.payload.trainingTask).toBe("llm-classification");
    expect(startRequest.payload.runMetadata.trainingTask).toBe(
      "llm-classification",
    );
    expect(startRequest.payload.datasets[0]).toMatchObject({
      artifactId: "dataset-1",
    });
    expect(startRequest.payload.datasets[0].path).toContain("dataset-1.parquet");
    expect(startRequest.payload.datasets[0].path.startsWith("/tmp/dataset")).toBe(false);
    expect(lifecycle.startTask).toHaveBeenCalledWith(
      "train-req-1",
      TaskType.MODEL_TRAINING,
    );
    expect(result).toEqual({ runId: "train-req-1", status: "queued" });
  });

  it("reads running status from runtime task registry", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: {
        ...baseRegistry,
        registerGeneratedModel:
          testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>(),
      },
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      taskPowerLifecycle: lifecycle,
    });

    await useCase.execute(baseRequest);
    const result = await useCase.read("train-req-1", "workspace-a");

    expect(runtimeTaskRegistry.getTaskStatus).toHaveBeenCalledWith(
      "train-req-1",
    );
    expect(result.runId).toBe("train-req-1");
    expect(result.status).toBe("running");
  });

  it("cancels a running training task owned by the active workspace", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (
      runtimeTaskRegistry.cancelTask as ReturnType<typeof testDouble.fn>
    ).mockResolvedValue({
      requestId: "train-req-1",
      cancelled: true,
      status: "cancelled",
    });
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: {
        ...baseRegistry,
        registerGeneratedModel:
          testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>(),
      },
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      taskPowerLifecycle: lifecycle,
    });
    await useCase.execute(baseRequest);

    const result = await useCase.cancel("train-req-1", "workspace-a");

    expect(runtimeTaskRegistry.cancelTask).toHaveBeenCalledWith("train-req-1");
    expect(result).toMatchObject({ runId: "train-req-1", status: "cancelled" });
    await expect(access(stagedOutputFrom(runtimeTaskRegistry))).rejects.toThrow();
    expect(lifecycle.completeTask).toHaveBeenCalledWith(
      "train-req-1",
      "cancelled",
    );
  });

  it("fails closed when another workspace tries to cancel training", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: {
        ...baseRegistry,
        registerGeneratedModel:
          testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>(),
      },
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      taskPowerLifecycle: createLifecycleFake(),
    });
    await useCase.execute(baseRequest);

    await expect(useCase.cancel("train-req-1", "workspace-b")).rejects.toThrow(
      "Model training run was not found in this workspace.",
    );
    expect(runtimeTaskRegistry.cancelTask).not.toHaveBeenCalled();
  });

  it("retains the assigned output until cancellation is confirmed for that run", async () => {
    const runtime = createRuntimeTaskRegistryFake();
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry: runtime, modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake(),
    });
    await useCase.execute(baseRequest);
    const staged = stagedOutputFrom(runtime);
    await writeFile(join(staged, "partial-model.txt"), "synthetic partial output");
    expect((await useCase.cancel("train-req-1", "workspace-a")).status).toBe("running");
    (runtime.cancelTask as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      requestId: "different-run", status: "cancelled", cancelled: true,
    });
    await expect(useCase.cancel("train-req-1", "workspace-a")).rejects.toThrow("Model training cancellation could not be verified.");
    expect(await readFile(join(staged, "partial-model.txt"), "utf8")).toBe("synthetic partial output");
  });

  it("maps runtime training progress into model training status reads", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (
      runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>
    ).mockResolvedValue({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
      workspaceId: "workspace-a" as never,
      status: "running",
      concurrencyClass: "unknown",
      progress: {
        message: "Epoch [0]/[1], Batch [0]/[59]",
        current: 0,
        total: 59,
        unit: "batch",
        details: {
          stage: "training",
          epoch: 0,
          totalEpochs: 1,
          batch: 0,
          totalBatches: 59,
        },
      },
    });
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: {
        ...baseRegistry,
        registerGeneratedModel:
          testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>(),
      },
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      taskPowerLifecycle: lifecycle,
    });

    await useCase.execute(baseRequest);
    const result = await useCase.read("train-req-1", "workspace-a");

    expect(result.progress).toEqual({
      stage: "training",
      message: "Epoch [0]/[1], Batch [0]/[59]",
      epoch: 0,
      totalEpochs: 1,
      batch: 0,
      totalBatches: 59,
    });
  });

  it("registers generated model on succeeded status only once", async () => {
    const lifecycle = createLifecycleFake();
    const reconciler = new OwnedTaskReconcilerService();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (
      runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>
    ).mockImplementation(async () => ({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
      workspaceId: "workspace-a" as never,
      status: "succeeded",
      concurrencyClass: "unknown",
      data: {
        runId: "worker-train-run-1",
        status: "succeeded",
        generatedModelCandidate: {
          displayName: "Demo Adapter",
          provider: "huggingface",
          modelId: "org/demo-adapter",
          localPath: stagedOutputFrom(runtimeTaskRegistry),
          generatedFromRunId: "worker-train-run-1",
        },
      },
    }));
    const registerGeneratedModel = testDouble
      .fn<ModelRegistryPort["registerGeneratedModel"]>()
      .mockResolvedValue({
        model: {
          modelRecordId: "generated-1",
          displayName: "Demo Adapter",
          source: "generated",
          lifecycleStatus: "saved-reference",
          artifactForm: "adapter",
          provider: "huggingface",
          modelId: "org/demo-adapter",
          createdAt: "2026-04-29T00:00:00.000Z",
        },
      });
    const useCase = new TrainModelUseCase({
      taskReconciler: reconciler,
      runtimeTaskRegistry,
      modelRegistry: { ...baseRegistry, registerGeneratedModel },
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      generatedModelStorage: createGeneratedModelStorageFake(),
      taskPowerLifecycle: lifecycle,
    });

    const cleanup = (useCase as any).cleanupRuntimeDatasetDir.bind(useCase); let cleanupCalls = 0;
    (useCase as any).cleanupRuntimeDatasetDir = async (id: string) => { if (++cleanupCalls === 1) throw new Error("temporary cleanup failure"); await cleanup(id); };
    await useCase.execute(baseRequest);
    await reconciler.reconcileNow(); expect(reconciler.status.pending).toBe(1);
    await Promise.all([reconciler.reconcileNow(), reconciler.reconcileNow()]);
    expect(cleanupCalls).toBe(2);
    expect(reconciler.status.pending).toBe(0);
    const pending = await useCase.read("train-req-1", "workspace-a");
    expect(pending).toMatchObject({
      runId: "train-req-1",
      status: "succeeded",
      reviewPending: true,
      generatedModelCandidate: {
        generatedFromRunId: "train-req-1",
      },
    });
    expect(pending.generatedModelCandidate?.localPath).toBeUndefined();
    expect(registerGeneratedModel).not.toHaveBeenCalled();

    const first = await useCase.save("train-req-1", "workspace-a");
    const second = await useCase.read("train-req-1", "workspace-a");
    await expect(access(stagedOutputFrom(runtimeTaskRegistry))).rejects.toThrow();

    expect(first.status).toBe("succeeded");
    expect(first.reviewPending).toBe(false);
    expect(second.status).toBe("succeeded");
    expect(registerGeneratedModel).toHaveBeenCalledTimes(1);
    expect(registerGeneratedModel.mock.calls[0]?.[0].localPath).toBe(
      "/models/generated/demo-adapter",
    );
    expect(registerGeneratedModel.mock.calls[0]?.[0]).toMatchObject({
      artifactForm: "adapter",
      baseModelId: "org/base",
      adapterOfModelId: "org/base",
      metadata: { baseModelRecordId: "base-1" },
    });
    expect(lifecycle.completeTask).toHaveBeenCalledWith(
      "train-req-1",
      "succeeded",
    );
  });

  it("publishes generated model to Hugging Face when selected", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (
      runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>
    ).mockImplementation(async () => ({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
      workspaceId: "workspace-a" as never,
      status: "succeeded",
      concurrencyClass: "unknown",
      data: {
        runId: "train-req-1",
        status: "succeeded",
        outputModelName: "demo-adapter",
        generatedModelCandidate: {
          displayName: "Demo Adapter",
          localPath: stagedOutputFrom(runtimeTaskRegistry),
          artifactForm: "adapter",
        },
      },
    }));
    const registerGeneratedModel = testDouble
      .fn<ModelRegistryPort["registerGeneratedModel"]>()
      .mockResolvedValue({
        model: {
          modelRecordId: "generated-1",
          displayName: "Demo Adapter",
          source: "generated",
          lifecycleStatus: "generated",
          artifactForm: "adapter",
          provider: "huggingface",
          modelId: "org/demo-adapter",
          createdAt: "2026-04-29T00:00:00.000Z",
        },
      });
    const updateModelRecord = testDouble
      .fn<ModelRegistryPort["updateModelRecord"]>()
      .mockResolvedValue({
        model: {
          modelRecordId: "generated-1",
          displayName: "Demo Adapter",
          source: "generated",
          lifecycleStatus: "generated",
          artifactForm: "adapter",
          provider: "huggingface",
          modelId: "org/demo-adapter",
          createdAt: "2026-04-29T00:00:00.000Z",
          published: {
            provider: "huggingface",
            repository: "org/demo-adapter",
            publishedAt: "2026-04-29T00:00:00.000Z",
          },
        },
      });
    const modelPublisher: ModelPublisherPort = {
      publishModel: testDouble.fn(async () => ({
        modelRecordId: "train-req-1",
        published: true,
        provider: "huggingface",
        repository: "org/demo-adapter",
        url: "https://huggingface.co/org/demo-adapter",
      })),
    };
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: {
        ...baseRegistry,
        registerGeneratedModel,
        updateModelRecord,
      },
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      generatedModelStorage: createGeneratedModelStorageFake(),
      modelPublisher,
      taskPowerLifecycle: lifecycle,
    });

    await useCase.execute({
      ...baseRequest,
      output: {
        ...baseRequest.output,
        destination: {
          local: { enabled: true },
          huggingFace: {
            enabled: true,
            provider: "huggingface",
            repository: "org/demo-adapter",
            pathPrefix: "adapters",
          },
        },
      },
    });
    const pending = await useCase.read("train-req-1", "workspace-a");
    expect(pending.reviewPending).toBe(true);
    expect(modelPublisher.publishModel).not.toHaveBeenCalled();
    const result = await useCase.save("train-req-1", "workspace-a");

    expect(modelPublisher.publishModel).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      modelRecordId: "train-req-1",
      repository: "org/demo-adapter",
      revision: undefined,
      pathPrefix: "adapters",
      private: false,
      modelPath: "/models/generated/demo-adapter",
    });
    expect(registerGeneratedModel.mock.calls[0]?.[0].modelId).toBe(
      "org/demo-adapter",
    );
    expect(result.outputModel?.published?.repository).toBe("org/demo-adapter");
  });

  it("does not offer review when the worker returns a foreign output folder", async () => {
    const foreign = await mkdtemp(join(tmpdir(), "training-unrelated-fixture-"));
    const retained = join(foreign, "retained.txt");
    try {
      await writeFile(retained, "unrelated synthetic output");
      const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
      (runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>).mockResolvedValue({
        requestId: "train-req-1", workspaceId: "workspace-a", taskType: TaskType.MODEL_TRAINING,
        status: "succeeded", concurrencyClass: "unknown",
        data: {
          runId: "train-req-1", status: "succeeded",
          generatedModelCandidate: { displayName: "Demo Adapter", artifactForm: "adapter", localPath: foreign },
        },
      });
      const generatedModelStorage = createGeneratedModelStorageFake();
      const useCase = new TrainModelUseCase({
        runtimeTaskRegistry, modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(),
        storage: createStorageFake(), generatedModelStorage, taskPowerLifecycle: createLifecycleFake(),
      });
      await useCase.execute(baseRequest);
      expect(await useCase.read("train-req-1", "workspace-a")).toMatchObject({
        status: "failed", error: { code: "invalid_runtime_result", message: "Training output could not be verified." },
      });
      await expect(useCase.discard("train-req-1", "workspace-a")).rejects.toThrow("Model training review was not found");
      expect(generatedModelStorage.storeGeneratedModel).not.toHaveBeenCalled();
      expect(await readFile(retained, "utf8")).toBe("unrelated synthetic output");
    } finally {
      await rm(foreign, { recursive: true, force: true });
    }
  });

  it("discards staged output and denies review actions from another workspace", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (
      runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>
    ).mockImplementation(async () => ({
      requestId: "train-req-1",
      workspaceId: "workspace-a" as never,
      taskType: TaskType.MODEL_TRAINING,
      status: "succeeded",
      concurrencyClass: "unknown",
      data: {
        runId: "train-req-1",
        status: "succeeded",
        generatedModelCandidate: {
          displayName: "Demo Adapter",
          localPath: stagedOutputFrom(runtimeTaskRegistry),
          artifactForm: "adapter",
        },
      },
    }));
    const registerGeneratedModel =
      testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>();
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: { ...baseRegistry, registerGeneratedModel },
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      taskPowerLifecycle: createLifecycleFake(),
    });

    await useCase.execute(baseRequest);
    const outputDirectory = stagedOutputFrom(runtimeTaskRegistry);
    await writeFile(join(outputDirectory, "adapter.safetensors"), "weights");
    const pending = await useCase.read("train-req-1", "workspace-a");
    expect(pending.reviewPending).toBe(true);

    await expect(useCase.read("train-req-1", "workspace-b")).rejects.toThrow(
      "Model training run was not found in this workspace.",
    );
    await expect(useCase.save("train-req-1", "workspace-b")).rejects.toThrow(
      "Model training review was not found in this workspace.",
    );
    await expect(
      useCase.discard("train-req-1", "workspace-b"),
    ).rejects.toThrow(
      "Model training review was not found in this workspace.",
    );
    await expect(access(outputDirectory)).resolves.toBeUndefined();

    const discarded = await useCase.discard("train-req-1", "workspace-a");

    expect(discarded).toMatchObject({
      runId: "train-req-1",
      status: "cancelled",
    });
    expect(registerGeneratedModel).not.toHaveBeenCalled();
    await expect(access(outputDirectory)).rejects.toThrow();
    expect(await useCase.read("train-req-1", "workspace-a")).toMatchObject({
      status: "cancelled",
    });
  });

  it("refuses to discard output when the reviewed staging folder was replaced", async () => {
    const runtime = createRuntimeTaskRegistryFake();
    (runtime.getTaskStatus as ReturnType<typeof testDouble.fn>).mockImplementation(async () => ({
      requestId: "train-req-1", workspaceId: "workspace-a", taskType: TaskType.MODEL_TRAINING,
      status: "succeeded", concurrencyClass: "unknown",
      data: {
        runId: "train-req-1", status: "succeeded",
        generatedModelCandidate: { displayName: "Demo Adapter", artifactForm: "adapter", localPath: stagedOutputFrom(runtime) },
      },
    }));
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry: runtime, modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake(),
    });
    await useCase.execute(baseRequest);
    const stage = stagedOutputFrom(runtime);
    const held = `${stage}-original`;
    await writeFile(join(stage, "original.txt"), "owned synthetic output");
    expect((await useCase.read("train-req-1", "workspace-a")).reviewPending).toBe(true);
    await rename(stage, held);
    let replacement: { dev: bigint; ino: bigint } | undefined;
    try {
      await mkdir(stage);
      replacement = await lstat(stage, { bigint: true });
      await writeFile(join(stage, "replacement.txt"), "replacement synthetic output");
      await expect(useCase.discard("train-req-1", "workspace-a")).rejects.toThrow("Training output folder could not be verified.");
      expect(await readFile(join(stage, "replacement.txt"), "utf8")).toBe("replacement synthetic output");
      expect(await readFile(join(held, "original.txt"), "utf8")).toBe("owned synthetic output");
    } finally {
      const current = await lstat(stage, { bigint: true }).catch(() => undefined);
      if (current) {
        if (!replacement || !current.isDirectory() || current.dev !== replacement.dev || current.ino !== replacement.ino
            || await realpath(stage) !== stage) throw new Error("The test no longer owns the replacement folder.");
        await rm(stage, { recursive: true });
      }
      await rename(held, stage);
    }
  });

  for (const reply of ["lost", "missing-id"] as const) {
    it(`retains input bytes, output and host custody after a ${reply} start reply until actual runtime stop`, async () => {
      const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
      const runtime = createRuntimeTaskRegistryFake(); let dispatched: StartRuntimeTaskRequest | undefined, starts = 0;
      const failure = new Error("Synthetic lost training reply.");
      runtime.startTask = async request => {starts++; dispatched = request; await rememberStage(request);
        if (reply === "lost") throw failure;
        return {requestId: "", status: "queued"};};
      const useCase = new TrainModelUseCase({taskReconciler: reconciler, runtimeTaskRegistry: runtime,
        modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake()});
      await assert.rejects(useCase.execute(baseRequest), error => reply === "lost" ? error === failure : /missing requestId/.test(String(error)));
      assert.ok(dispatched);
      const input = (dispatched.payload as {datasets: {path: string}[]}).datasets[0].path, output = stagePath(dispatched);
      assert.equal(await readFile(input, "utf8"), "dataset-bytes"); assert.equal(reconciler.status.pending, 1);
      await reconciler.reconcileNow(); await reconciler.cancelAndReconcile();
      assert.equal(await readFile(input, "utf8"), "dataset-bytes"); await access(output);
      assert.equal(starts, 1); expect(runtime.getTaskStatus).not.toHaveBeenCalled(); expect(runtime.cancelTask).not.toHaveBeenCalled();
      await reconciler.settleAfterRuntimeStop(["python"]);
      assert.equal(reconciler.status.pending, 0); await assert.rejects(access(input)); await assert.rejects(access(output));
    });
  }

  it("a repeated start ID retains the second attempt without adopting or deleting the first task", async () => {
    const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
    const runtime = createRuntimeTaskRegistryFake(), attempts: StartRuntimeTaskRequest[] = [];
    runtime.startTask = async request => {attempts.push(request); await rememberStage(request); return {requestId: "train-req-1", status: "queued"};};
    const useCase = new TrainModelUseCase({taskReconciler: reconciler, runtimeTaskRegistry: runtime,
      modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake()});
    assert.equal((await useCase.execute(baseRequest)).runId, "train-req-1");
    await assert.rejects(useCase.execute(baseRequest), /repeated an existing task/);
    assert.equal(attempts.length, 2); assert.equal(reconciler.status.pending, 2);
    for (const request of attempts) {assert.equal(await readFile((request.payload as {datasets: {path: string}[]}).datasets[0].path, "utf8"), "dataset-bytes"); await access(stagePath(request));}
    expect(runtime.getTaskStatus).not.toHaveBeenCalled(); expect(runtime.cancelTask).not.toHaveBeenCalled();
    await reconciler.settleAfterRuntimeStop(["python"]); assert.equal(reconciler.status.pending, 0);
    for (const request of attempts) {await assert.rejects(access((request.payload as {datasets: {path: string}[]}).datasets[0].path)); await assert.rejects(access(stagePath(request)));}
  });

  for (const kind of ["input", "output"] as const) {
    it(`refuses a replaced uncertain ${kind} folder and retries cleanup only for the original identity`, async () => {
      const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
      const runtime = createRuntimeTaskRegistryFake(); let dispatched: StartRuntimeTaskRequest | undefined;
      runtime.startTask = async request => {dispatched = request; await rememberStage(request); throw new Error("Synthetic lost reply.");};
      const useCase = new TrainModelUseCase({taskReconciler: reconciler, runtimeTaskRegistry: runtime,
        modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake()});
      await assert.rejects(useCase.execute(baseRequest)); assert.ok(dispatched);
      const input = (dispatched.payload as {datasets: {path: string}[]}).datasets[0].path, output = stagePath(dispatched);
      const directory = kind === "input" ? dirname(input) : output, moved = directory + "-original";
      const original = await lstat(directory, {bigint: true}), boundary = await realpath(tmpdir());
      assert.equal(dirname(directory), boundary); assert.equal(await realpath(directory), directory);
      await rename(directory, moved); await mkdir(directory); const replacement = await lstat(directory, {bigint: true});
      const sentinel = join(directory, "replacement-sentinel.txt"); await writeFile(sentinel, "Synthetic replacement must survive.");
      try {
        await reconciler.settleAfterRuntimeStop(["python"]);
        assert.equal(reconciler.status.pending, 1); assert.equal(reconciler.status.retrying, 1);
        assert.equal(await readFile(sentinel, "utf8"), "Synthetic replacement must survive.");
        expect(runtime.getTaskStatus).not.toHaveBeenCalled(); expect(runtime.cancelTask).not.toHaveBeenCalled();
      } finally {
        // Both directories are fresh test-owned fixtures, never historical data.
        // Verify each identity before deleting the replacement/restoring our original.
        const current = await lstat(directory, {bigint: true}), retained = await lstat(moved, {bigint: true});
        assert.equal(dirname(directory), boundary); assert.equal(dirname(moved), boundary);
        assert.equal(await realpath(directory), directory); assert.equal(await realpath(moved), moved);
        assert.ok(current.isDirectory() && !current.isSymbolicLink() && retained.isDirectory() && !retained.isSymbolicLink());
        assert.equal(current.dev, replacement.dev); assert.equal(current.ino, replacement.ino);
        assert.equal(retained.dev, original.dev); assert.equal(retained.ino, original.ino);
        await rm(directory, {recursive: true}); await rename(moved, directory);
      }
      await reconciler.reconcileNow(); assert.equal(reconciler.status.pending, 0);
      await assert.rejects(access(input)); await assert.rejects(access(output));
    });
  }

  for (const preparation of ["second-source-failure", "stop-during-input", "stop-during-output-identity"] as const) {
  it(`${preparation} denies late dispatch and cleans only verified pre-dispatch staging`, async () => {
    const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(join(boundary, "training-pre-dispatch-test-")));
    const identity = await lstat(directory, {bigint: true});
    const previous = {TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR};
    process.env.TEMP = directory; process.env.TMP = directory; process.env.TMPDIR = directory;
    const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
    const runtime = createRuntimeTaskRegistryFake(), bindings = createStorageBindingsFake(), read = bindings.readArtifactStorageBindings, storage = createStorageFake();
    const failure = new Error("Synthetic second input failure."); let calls = 0;
    bindings.readArtifactStorageBindings = async (...args) => {if (++calls === 2 && preparation === "second-source-failure") throw failure; return read(...args);};
    const originalLstat = fsPromises.lstat; let stopped = false;
    if (preparation === "stop-during-input") {
      const retrieve = storage.retrieveArtifact;
      storage.retrieveArtifact = async (...args) => {const result = await retrieve(...args);
        stopped = true; await reconciler.settleAfterRuntimeStop(["python"]); return result;};
    }
    if (preparation === "stop-during-output-identity") {
      fsPromises.lstat = (async (...args: any[]) => {
        const result = await (originalLstat as any)(...args);
        if (!stopped && basename(String(args[0])).startsWith("ai-system-builder-training-output-")) {
          stopped = true; await reconciler.settleAfterRuntimeStop(["python"]);
        }
        return result;
      }) as typeof fsPromises.lstat;
      syncBuiltinESMExports();
    }
    try {
      const useCase = new TrainModelUseCase({taskReconciler: reconciler, runtimeTaskRegistry: runtime,
        modelRegistry: baseRegistry, storageBindings: bindings, storage, taskPowerLifecycle: createLifecycleFake()});
      await assert.rejects(useCase.execute({...baseRequest, datasets: preparation === "second-source-failure"
        ? [...baseRequest.datasets, {artifactId: "dataset-2", splitRole: "train"}] : baseRequest.datasets}),
        error => preparation === "second-source-failure" ? error === failure : /Background task lifecycle is unavailable/.test(String(error)));
      await reconciler.reconcileNow();
      assert.equal(calls, preparation === "second-source-failure" ? 2 : 1);
      if (preparation !== "second-source-failure") assert.equal(stopped, true);
      assert.equal(reconciler.status.pending, 0); assert.deepEqual(await readdir(directory), []);
      expect(runtime.startTask).not.toHaveBeenCalled(); expect(runtime.getTaskStatus).not.toHaveBeenCalled(); expect(runtime.cancelTask).not.toHaveBeenCalled();
    } finally {
      fsPromises.lstat = originalLstat; syncBuiltinESMExports(); await reconciler.reconcileNow();
      for (const key of ["TEMP", "TMP", "TMPDIR"] as const) {const value = previous[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value;}
      const current = await lstat(directory, {bigint: true});
      assert.equal(dirname(directory), boundary); assert.equal(await realpath(directory), directory);
      assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
      await rm(directory, {recursive: true});
    }
  });
  }

  for (const mode of ["pending", "committed", "saving"] as const) {
    const saved = mode !== "pending";
    it(`preserves ${mode} successful output when the host stops before reconciliation`, async () => {
      const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
      const runtime = createRuntimeTaskRegistryFake();
      (runtime.getTaskStatus as ReturnType<typeof testDouble.fn>).mockImplementation(async () => ({requestId: "train-req-1", workspaceId: "workspace-a",
        taskType: TaskType.MODEL_TRAINING, status: "succeeded", concurrencyClass: "unknown", data: {runId: "train-req-1", status: "succeeded",
          generatedModelCandidate: {displayName: "Synthetic adapter", artifactForm: "adapter", localPath: stagedOutputFrom(runtime)}}}));
      const registerGeneratedModel = testDouble.fn(async (request: any) => ({model: {modelRecordId: "generated-1", displayName: "Synthetic adapter",
        source: "generated", lifecycleStatus: "saved-reference", artifactForm: "adapter", provider: "huggingface", localPath: request.localPath,
        createdAt: "2026-11-21T00:00:00.000Z"}}));
      let release!: () => void, enter!: () => void;
      const held = new Promise<void>(resolve => {release = resolve;}), entered = new Promise<void>(resolve => {enter = resolve;});
      const useCase = new TrainModelUseCase({taskReconciler: reconciler, runtimeTaskRegistry: runtime,
        modelRegistry: {...baseRegistry, registerGeneratedModel} as ModelRegistryPort,
        storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake(),
        generatedModelStorage: {async storeGeneratedModel(request) {if (mode === "saving") {enter(); await held;}
          return {localPath: request.sourceDirectory, modelId: "generated/synthetic"};}}});
      await useCase.execute(baseRequest); const output = stagedOutputFrom(runtime);
      await writeFile(join(output, "synthetic-model.txt"), "Synthetic successful output.");
      const pending = await useCase.read("train-req-1", "workspace-a"); assert.equal(pending.reviewPending, true);
      if (mode === "committed") {
        const cleanup = (useCase as any).cleanupRuntimeDatasetDir.bind(useCase); let calls = 0;
        // Commit succeeds, then a cleanup failure leaves the existing host lease pending.
        (useCase as any).cleanupRuntimeDatasetDir = async (id: string) => {if (++calls === 1) throw new Error("Synthetic cleanup failure after commit."); await cleanup(id);};
        await assert.rejects(useCase.save("train-req-1", "workspace-a"), /cleanup failure after commit/);
        expect(registerGeneratedModel).toHaveBeenCalledTimes(1);
      }
      if (mode === "saving") {
        const saving = useCase.save("train-req-1", "workspace-a"); await entered;
        try {
          await reconciler.settleAfterRuntimeStop(["python"]); assert.equal(reconciler.status.pending, 1);
          assert.equal(await readFile(join(output, "synthetic-model.txt"), "utf8"), "Synthetic successful output.");
        } finally {release();}
        assert.equal((await saving).status, "succeeded"); await reconciler.reconcileNow();
      } else {assert.equal(reconciler.status.pending, 1); await reconciler.settleAfterRuntimeStop(["python"]);}
      assert.equal(reconciler.status.pending, 0); assert.equal(await readFile(join(output, "synthetic-model.txt"), "utf8"), "Synthetic successful output.");
      const retained = await useCase.read("train-req-1", "workspace-a"); assert.equal(retained.status, "succeeded");
      assert.equal(retained.reviewPending, !saved);
      if (saved) {assert.equal(retained.outputModel?.localPath, output); expect(registerGeneratedModel).toHaveBeenCalledTimes(1);}
      else expect(registerGeneratedModel).not.toHaveBeenCalled();
    });
  }

  it("waits for an in-flight read at runtime stop and refuses late or fresh worker access", async () => {
    const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
    const runtime = createRuntimeTaskRegistryFake(); let release!: () => void, enter!: () => void;
    const held = new Promise<void>(resolve => {release = resolve;}), entered = new Promise<void>(resolve => {enter = resolve;});
    (runtime.getTaskStatus as ReturnType<typeof testDouble.fn>).mockImplementation(async () => {enter(); await held;
      return {requestId: "train-req-1", workspaceId: "workspace-a", taskType: TaskType.MODEL_TRAINING, status: "running", concurrencyClass: "unknown"};});
    const useCase = new TrainModelUseCase({taskReconciler: reconciler, runtimeTaskRegistry: runtime,
      modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake()});
    await useCase.execute(baseRequest); const output = stagedOutputFrom(runtime);
    const reading = useCase.read("train-req-1", "workspace-a"); await entered;
    await reconciler.settleAfterRuntimeStop(["python"]);
    assert.equal(reconciler.status.pending, 1); await access(output);
    const cancellation = useCase.cancel("train-req-1", "workspace-a");
    const settling = Promise.allSettled([reading, cancellation]); release();
    const results = await settling;
    assert.ok(results.every(result => result.status === "rejected" && /stopped before a result/.test(String(result.reason))));
    await assert.rejects(useCase.read("train-req-1", "workspace-a"), /stopped before a result/);
    await reconciler.reconcileNow();
    assert.equal(reconciler.status.pending, 0); await assert.rejects(access(output));
    assert.equal((await useCase.read("train-req-1", "workspace-a")).status, "failed");
    expect(runtime.getTaskStatus).toHaveBeenCalledTimes(1); expect(runtime.cancelTask).not.toHaveBeenCalled();
  });

  it("a stop during the cancellation status wait cannot issue a late cancellation", async () => {
    const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
    const runtime = createRuntimeTaskRegistryFake(); let release!: () => void, enter!: () => void;
    const held = new Promise<void>(resolve => {release = resolve;}), entered = new Promise<void>(resolve => {enter = resolve;});
    (runtime.getTaskStatus as ReturnType<typeof testDouble.fn>).mockImplementation(async () => {enter(); await held;
      return {requestId: "train-req-1", workspaceId: "workspace-a", taskType: TaskType.MODEL_TRAINING, status: "running", concurrencyClass: "unknown"};});
    const useCase = new TrainModelUseCase({taskReconciler: reconciler, runtimeTaskRegistry: runtime,
      modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake()});
    await useCase.execute(baseRequest);
    const cancelling = useCase.cancel("train-req-1", "workspace-a"); await entered;
    await reconciler.settleAfterRuntimeStop(["python"]); assert.equal(reconciler.status.pending, 0);
    release(); assert.equal((await cancelling).status, "failed");
    expect(runtime.getTaskStatus).toHaveBeenCalledTimes(1); expect(runtime.cancelTask).not.toHaveBeenCalled();
  });

  it("cancelling a completed pending review does not reopen a worker after its lease retired", async () => {
    const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
    const runtime = createRuntimeTaskRegistryFake();
    (runtime.getTaskStatus as ReturnType<typeof testDouble.fn>).mockImplementation(async () => ({requestId: "train-req-1", workspaceId: "workspace-a",
      taskType: TaskType.MODEL_TRAINING, status: "succeeded", concurrencyClass: "unknown", data: {runId: "train-req-1", status: "succeeded",
        generatedModelCandidate: {displayName: "Synthetic adapter", artifactForm: "adapter", localPath: stagedOutputFrom(runtime)}}}));
    const useCase = new TrainModelUseCase({taskReconciler: reconciler, runtimeTaskRegistry: runtime,
      modelRegistry: baseRegistry, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: createLifecycleFake()});
    await useCase.execute(baseRequest); assert.equal((await useCase.read("train-req-1", "workspace-a")).reviewPending, true);
    await reconciler.reconcileNow(); assert.equal(reconciler.status.pending, 0);
    await reconciler.settleAfterRuntimeStop(["python"]);
    const result = await useCase.cancel("train-req-1", "workspace-a"); assert.equal(result.status, "succeeded"); assert.equal(result.reviewPending, true);
    await access(stagedOutputFrom(runtime));
    expect(runtime.getTaskStatus).toHaveBeenCalledTimes(1); expect(runtime.cancelTask).not.toHaveBeenCalled();
  });

  for (const terminal of [
    { status: "failed", code: "failed" },
    { status: "cancelled", code: undefined },
    { status: "failed", code: "task_timeout" },
  ] as const) {
    it(`reconciles training ${terminal.code ?? terminal.status} without feature reads and releases staging/power once`, async () => {
      const reconciler = new OwnedTaskReconcilerService();
      const lifecycle = createLifecycleFake();
      const runtime = createRuntimeTaskRegistryFake();
      (runtime.getTaskStatus as ReturnType<typeof testDouble.fn>).mockResolvedValue({
        requestId: "train-req-1", taskType: TaskType.MODEL_TRAINING,
        workspaceId: "workspace-a", concurrencyClass: "unknown", status: terminal.status,
        ...(terminal.code ? { error: { code: terminal.code, message: "Synthetic terminal condition." } } : {}),
      });
      const registerGeneratedModel = testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>();
      const useCase = new TrainModelUseCase({
        taskReconciler: reconciler, runtimeTaskRegistry: runtime,
        modelRegistry: { ...baseRegistry, registerGeneratedModel },
        storageBindings: createStorageBindingsFake(), storage: createStorageFake(),
        taskPowerLifecycle: lifecycle,
      });
      const cleanup = (useCase as any).cleanupRuntimeDatasetDir.bind(useCase);
      let cleanupCalls = 0;
      (useCase as any).cleanupRuntimeDatasetDir = async (id: string) => { cleanupCalls++; await cleanup(id); };
      const request = { ...baseRequest };
      try {
        await useCase.execute(request);
        const dispatched = (runtime.startTask as ReturnType<typeof testDouble.fn>).mock.calls[0][0];
        const stagedInput = dispatched.payload.datasets[0].path;
        const stagedOutput = stagedOutputFrom(runtime);
        await writeFile(join(stagedOutput, "partial-model.txt"), "synthetic partial output");
        expect(dispatched.workspaceId).toBe("workspace-a");
        await expect(access(stagedInput)).resolves.toBeUndefined();
        expect(reconciler.status.pending).toBe(1);
        request.workspaceId = "workspace-b" as never;
        // Only the registered host callback reads the task. No feature read or
        // cancel occurs, including for the real failed/task_timeout shape.
        await reconciler.reconcileNow();
        await reconciler.reconcileNow();
        expect(reconciler.status.pending).toBe(0);
        expect(runtime.getTaskStatus).toHaveBeenCalledTimes(1);
        expect(runtime.getTaskStatus).toHaveBeenCalledWith("train-req-1");
        expect(runtime.cancelTask).not.toHaveBeenCalled();
        await expect(access(stagedInput)).rejects.toThrow();
        await expect(access(stagedOutput)).rejects.toThrow();
        expect(cleanupCalls).toBe(1);
        expect(lifecycle.completeTask).toHaveBeenCalledTimes(1);
        expect(lifecycle.completeTask).toHaveBeenCalledWith("train-req-1", terminal.status);
        expect(registerGeneratedModel).not.toHaveBeenCalled();
      } finally {
        reconciler.stopObservation();
        await cleanup("train-req-1");
      }
    });
  }

  for (const terminalStatus of ["failed", "cancelled"] as const) {
    it(`completes lifecycle for terminal status ${terminalStatus}`, async () => {
      const lifecycle = createLifecycleFake();
      const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
      (
        runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>
      ).mockResolvedValue({
        requestId: "train-req-1",
        taskType: TaskType.MODEL_TRAINING,
      workspaceId: "workspace-a" as never,
        status: terminalStatus,
        concurrencyClass: "unknown",
        error:
          terminalStatus === "failed"
            ? { code: "failed", message: "boom" }
            : undefined,
      });
      const useCase = new TrainModelUseCase({
        runtimeTaskRegistry,
        modelRegistry: {
          ...baseRegistry,
          registerGeneratedModel:
            testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>(),
        },
        storageBindings: createStorageBindingsFake(),
        storage: createStorageFake(),
        taskPowerLifecycle: lifecycle,
      });

      await useCase.execute(baseRequest);
      const result = await useCase.read("train-req-1", "workspace-a");
      expect(result.status).toBe(terminalStatus);
      expect(lifecycle.completeTask).toHaveBeenCalledWith(
        "train-req-1",
        terminalStatus,
      );
    });
  }

  it("falls back to local artifact-object binding when file binding is unavailable", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const storageBindings: Pick<
      ArtifactStorageBindingPort,
      "readArtifactStorageBindings"
    > = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true as const,
        value: {
          bindings: [
            {
              artifactId: "dataset-1",
              workspaceId: "workspace-a" as never,
              role: "primary",
              backing: {
                kind: "artifact-object",
                provider: "local",
                locator: "generated/dataset-1.parquet",
              },
            },
          ],
        },
      })),
    };
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: {
        ...baseRegistry,
        registerGeneratedModel:
          testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>(),
      },
      storageBindings,
      storage: createStorageFake(),
      taskPowerLifecycle: lifecycle,
    });

    await useCase.execute(baseRequest);

    const startRequest = (
      runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>
    ).mock.calls[0]?.[0];
    expect(startRequest.taskType).toBe(TaskType.MODEL_TRAINING);
    expect(startRequest.payload.datasets[0].artifactId).toBe("dataset-1");
    expect(startRequest.payload.datasets[0].path).toContain(
      "dataset-1.parquet",
    );
  });

  it("denies unbound artifacts and caller-provided training paths before retrieval or dispatch", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake(); const storage = createStorageFake();
    const useCase = new TrainModelUseCase({ runtimeTaskRegistry, modelRegistry: baseRegistry, storageBindings: { readArtifactStorageBindings: async () => ({ ok: true, value: { bindings: [] } }) } as never, storage, taskPowerLifecycle: createLifecycleFake() });
    await expect(useCase.execute({ ...baseRequest, datasets: [{ ...baseRequest.datasets[0], path: "C:/private/foreign.parquet" }] })).rejects.toThrow("workspace-owned local training artifact binding");
    expect(storage.retrieveArtifact).not.toHaveBeenCalled(); expect(runtimeTaskRegistry.startTask).not.toHaveBeenCalled();
  });

  it("stages source artifact paths for image training datasets", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const storageBindings: Pick<
      ArtifactStorageBindingPort,
      "readArtifactStorageBindings"
    > = {
      readArtifactStorageBindings: testDouble.fn(
        async ({ artifactId }: { artifactId: string }) => ({
          ok: true as const,
          value: {
            bindings: [{ artifactId, workspaceId: "workspace-a" as never, role: "primary", backing: { kind: "artifact-object" as const, provider: "local" as const, locator: artifactId === "source-image-1" ? "uploads/source-image-1.png" : artifactId } }],
          },
        }),
      ),
    };
    const storage: Pick<ArtifactObjectStoragePort, "retrieveArtifact"> = {
      retrieveArtifact: testDouble.fn(async ({ key }: { key: string }) => ({
        ok: true as const,
        value:
          key === "uploads/source-image-1.png"
            ? {
                descriptor: { key, mediaType: "image/png" },
                content: new Uint8Array([137, 80, 78, 71]),
              }
            : {
                descriptor: {
                  key,
                  mediaType: "application/x-ndjson",
                  metadata: { sourceArtifactIds: ["source-image-1"] },
                },
                content: new TextEncoder().encode(
                  '{"image":"source-image-1","caption":"demo"}\n',
                ),
              },
      })),
    };
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: {
        ...baseRegistry,
        registerGeneratedModel:
          testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>(),
      },
      storageBindings,
      storage,
      taskPowerLifecycle: lifecycle,
    });

    await useCase.execute({
      ...baseRequest,
      trainingTask: "diffusion-lora",
      datasets: [
        {
          artifactId: "generated/image-dataset.jsonl",
          splitRole: "train" as const,
        },
      ],
    });

    const startRequest = (
      runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>
    ).mock.calls[0]?.[0];
    const dataset = startRequest.payload.datasets[0];
    expect(dataset.path).toContain("image-dataset.jsonl");
    expect(dataset.metadata.sourceArtifactIds).toEqual(["source-image-1"]);
    expect(
      dataset.metadata.stagedSourceArtifactPaths["source-image-1"],
    ).toContain("source-image-1.png");
  });

  it("rejects model training start when runtime capability is not ready", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const unavailable = new Error(
      "Runtime capability 'model-training' is failed.",
    ) as Error & { code: "unavailable"; details: Record<string, unknown> };
    unavailable.name = "RuntimeCapabilityUnavailableError";
    unavailable.code = "unavailable";
    unavailable.details = {
      capabilityId: "model-training",
      status: "failed",
      recommendedActions: ["retry", "view-logs"],
    };
    const useCase = new TrainModelUseCase({
      runtimeTaskRegistry,
      modelRegistry: baseRegistry,
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      taskPowerLifecycle: lifecycle,
      runtimeCapabilityGuard: {
        requireCapabilityReady: testDouble.fn(async () => {
          throw unavailable;
        }),
      },
    });

    await useCase
      .execute({
        workspaceId: "workspace-a" as never,
        baseModel: { modelId: "base", localPath: "/models/base" },
        datasets: [{ artifactId: "dataset-1", splitRole: "train" }],
        method: "lora",
        commonParameters: {},
        output: {
          outputModelName: "demo",
          destination: { local: { enabled: true } },
        },
      })
      .catch((error) =>
        expect(error).toMatchObject({
          code: "unavailable",
          details: { capabilityId: "model-training", status: "failed" },
        }),
      );
    expect(runtimeTaskRegistry.startTask).not.toHaveBeenCalled();
  });
});
