import { describe, expect, it, testDouble } from "../../../testing/node-test";

import { TaskType, type RuntimeTaskRegistryPort } from "../../../contracts/runtime";
import type { TaskPowerLifecyclePort } from "../../services/runtime";
import type { GeneratedModelStoragePort, ModelPublisherPort, ModelRegistryPort } from "../../ports/model";
import type { ArtifactObjectStoragePort, ArtifactStorageBindingPort } from "../../ports/storage";
import { TrainModelUseCase } from "../model/train-model.use-case";

describe("TrainModelUseCase", () => {
  const baseRequest = { baseModel: { modelRecordId: "base-1" }, datasets: [{ artifactId: "dataset-1", splitRole: "train" as const }], method: "lora" as const, commonParameters: {}, output: { outputModelName: "demo-adapter", destination: { local: { enabled: true } }, registration: { displayName: "Demo Adapter", artifactForm: "adapter" as const } } };
  const baseRegistry: ModelRegistryPort = {
    listModels: async () => ({ models: [] }), getModelRecord: async () => ({ modelRecordId: "base-1", displayName: "Base", source: "huggingface", lifecycleStatus: "saved-reference", artifactForm: "full-model", provider: "huggingface", modelId: "org/base", createdAt: "2026-04-27T00:00:00.000Z" }), saveModelReference: async () => { throw new Error("not used"); }, registerDownloadedModel: async () => { throw new Error("not used"); }, updateModelRecord: async () => { throw new Error("not used"); }, deleteModelRecord: async () => { throw new Error("not used"); },
  };

  const createLifecycleFake = (): TaskPowerLifecyclePort => ({
    startTask: testDouble.fn(async () => undefined),
    completeTask: testDouble.fn(async () => undefined),
  });

  const createRuntimeTaskRegistryFake = (): RuntimeTaskRegistryPort => ({
    startTask: testDouble.fn(async () => ({ requestId: "train-req-1", accepted: true, status: "queued" })),
    getTaskStatus: testDouble.fn(async () => ({ requestId: "train-req-1", taskType: TaskType.MODEL_TRAINING, status: "running", concurrencyClass: "unknown" })),
    cancelTask: testDouble.fn(async () => ({ requestId: "train-req-1", cancelled: false, status: "running" })),
    listTasks: testDouble.fn(async () => ({ tasks: [] })),
  });
  const createStorageBindingsFake = (): Pick<ArtifactStorageBindingPort, "readArtifactStorageBindings"> => ({
    readArtifactStorageBindings: testDouble.fn(async () => ({
      ok: true as const,
      value: {
        bindings: [{
          artifactId: "dataset-1",
          role: "primary",
          backing: { kind: "artifact-object", provider: "local-filesystem", locator: "/tmp/dataset-1.parquet" },
        }],
      },
    })),
  });
  const createStorageFake = (): Pick<ArtifactObjectStoragePort, "retrieveArtifact"> => ({
    retrieveArtifact: testDouble.fn(async () => ({
      ok: true as const,
      value: {
        descriptor: { key: "generated/dataset-1.parquet", mediaType: "application/x-parquet" },
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

  it("starts training with runtime task registry", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = new TrainModelUseCase({ runtimeTaskRegistry, modelRegistry: { ...baseRegistry, registerGeneratedModel: testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>() }, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: lifecycle });

    const result = await useCase.execute(baseRequest);

    expect(runtimeTaskRegistry.startTask).toHaveBeenCalledTimes(1);
    const startRequest = (runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>).mock.calls[0]?.[0];
    expect(startRequest.taskType).toBe(TaskType.MODEL_TRAINING);
    expect(startRequest.payload.datasets[0]).toMatchObject({ artifactId: "dataset-1", path: "/tmp/dataset-1.parquet" });
    expect(lifecycle.startTask).toHaveBeenCalledWith("train-req-1", TaskType.MODEL_TRAINING);
    expect(result).toEqual({ runId: "train-req-1", status: "queued" });
  });

  it("reads running status from runtime task registry", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = new TrainModelUseCase({ runtimeTaskRegistry, modelRegistry: { ...baseRegistry, registerGeneratedModel: testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>() }, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: lifecycle });

    const result = await useCase.read("train-req-1");

    expect(runtimeTaskRegistry.getTaskStatus).toHaveBeenCalledWith("train-req-1");
    expect(result.runId).toBe("train-req-1");
    expect(result.status).toBe("running");
  });

  it("maps runtime training progress into model training status reads", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
      status: "running",
      concurrencyClass: "unknown",
      progress: {
        message: "Epoch [0]/[1], Batch [0]/[59]",
        current: 0,
        total: 59,
        unit: "batch",
        details: { stage: "training", epoch: 0, totalEpochs: 1, batch: 0, totalBatches: 59 },
      },
    });
    const useCase = new TrainModelUseCase({ runtimeTaskRegistry, modelRegistry: { ...baseRegistry, registerGeneratedModel: testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>() }, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: lifecycle });

    const result = await useCase.read("train-req-1");

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
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
      status: "succeeded",
      concurrencyClass: "unknown",
      data: {
        runId: "train-req-1",
        status: "succeeded",
        generatedModelCandidate: { displayName: "Demo Adapter", provider: "huggingface", modelId: "org/demo-adapter", localPath: "/tmp/demo-adapter" },
      },
    });
    const registerGeneratedModel = testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>().mockResolvedValue({
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
    const useCase = new TrainModelUseCase({ runtimeTaskRegistry, modelRegistry: { ...baseRegistry, registerGeneratedModel }, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), generatedModelStorage: createGeneratedModelStorageFake(), taskPowerLifecycle: lifecycle });

    await useCase.execute(baseRequest);
    const first = await useCase.read("train-req-1");
    const second = await useCase.read("train-req-1");

    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(registerGeneratedModel).toHaveBeenCalledTimes(1);
    expect(registerGeneratedModel.mock.calls[0]?.[0].localPath).toBe("/models/generated/demo-adapter");
    expect(lifecycle.completeTask).toHaveBeenCalledWith("train-req-1", "succeeded");
  });

  it("publishes generated model to Hugging Face when selected", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
      status: "succeeded",
      concurrencyClass: "unknown",
      data: {
        runId: "train-req-1",
        status: "succeeded",
        outputModelName: "demo-adapter",
        generatedModelCandidate: { displayName: "Demo Adapter", localPath: "/tmp/demo-adapter", artifactForm: "adapter" },
      },
    });
    const registerGeneratedModel = testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>().mockResolvedValue({
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
    const updateModelRecord = testDouble.fn<ModelRegistryPort["updateModelRecord"]>().mockResolvedValue({
      model: {
        modelRecordId: "generated-1",
        displayName: "Demo Adapter",
        source: "generated",
        lifecycleStatus: "generated",
        artifactForm: "adapter",
        provider: "huggingface",
        modelId: "org/demo-adapter",
        createdAt: "2026-04-29T00:00:00.000Z",
        published: { provider: "huggingface", repository: "org/demo-adapter", publishedAt: "2026-04-29T00:00:00.000Z" },
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
      modelRegistry: { ...baseRegistry, registerGeneratedModel, updateModelRecord },
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
          huggingFace: { enabled: true, provider: "huggingface", repository: "org/demo-adapter", pathPrefix: "adapters" },
        },
      },
    });
    const result = await useCase.read("train-req-1");

    expect(modelPublisher.publishModel).toHaveBeenCalledWith({
      modelRecordId: "train-req-1",
      repository: "org/demo-adapter",
      revision: undefined,
      pathPrefix: "adapters",
      private: false,
      modelPath: "/tmp/demo-adapter",
    });
    expect(registerGeneratedModel.mock.calls[0]?.[0].modelId).toBe("org/demo-adapter");
    expect(result.outputModel?.published?.repository).toBe("org/demo-adapter");
  });

  for (const terminalStatus of ["failed", "cancelled"] as const) {
    it(`completes lifecycle for terminal status ${terminalStatus}`, async () => {
      const lifecycle = createLifecycleFake();
      const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
      (runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>).mockResolvedValue({
        requestId: "train-req-1",
        taskType: TaskType.MODEL_TRAINING,
        status: terminalStatus,
        concurrencyClass: "unknown",
        error: terminalStatus === "failed" ? { code: "failed", message: "boom" } : undefined,
      });
      const useCase = new TrainModelUseCase({ runtimeTaskRegistry, modelRegistry: { ...baseRegistry, registerGeneratedModel: testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>() }, storageBindings: createStorageBindingsFake(), storage: createStorageFake(), taskPowerLifecycle: lifecycle });

      const result = await useCase.read("train-req-1");
      expect(result.status).toBe(terminalStatus);
      expect(lifecycle.completeTask).toHaveBeenCalledWith("train-req-1", terminalStatus);
    });
  }


  it("falls back to local artifact-object binding when file binding is unavailable", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const storageBindings: Pick<ArtifactStorageBindingPort, "readArtifactStorageBindings"> = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true as const,
        value: {
          bindings: [{
            artifactId: "dataset-1",
            role: "primary",
            backing: { kind: "artifact-object", provider: "local", locator: "generated/dataset-1.parquet" },
          }],
        },
      })),
    };
    const useCase = new TrainModelUseCase({ runtimeTaskRegistry, modelRegistry: { ...baseRegistry, registerGeneratedModel: testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>() }, storageBindings, storage: createStorageFake(), taskPowerLifecycle: lifecycle });

    await useCase.execute(baseRequest);

    const startRequest = (runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>).mock.calls[0]?.[0];
    expect(startRequest.taskType).toBe(TaskType.MODEL_TRAINING);
    expect(startRequest.payload.datasets[0].artifactId).toBe("dataset-1");
    expect(startRequest.payload.datasets[0].path).toContain("dataset-1.parquet");
  });

  it("stages a generated local artifact-object storage key when no binding row exists", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const storageBindings: Pick<ArtifactStorageBindingPort, "readArtifactStorageBindings"> = {
      readArtifactStorageBindings: testDouble.fn(async () => ({ ok: true as const, value: { bindings: [] } })),
    };
    const storage = createStorageFake();
    const generatedDatasetRequest = {
      ...baseRequest,
      datasets: [{ artifactId: "generated/20260429160945623-2e7fe0660f46449f9ce819d011eb13f9-training-dataset.parquet", splitRole: "train" as const }],
    };
    const useCase = new TrainModelUseCase({ runtimeTaskRegistry, modelRegistry: { ...baseRegistry, registerGeneratedModel: testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>() }, storageBindings, storage, taskPowerLifecycle: lifecycle });

    await useCase.execute(generatedDatasetRequest);

    expect(storage.retrieveArtifact).toHaveBeenCalledWith({
      key: "generated/20260429160945623-2e7fe0660f46449f9ce819d011eb13f9-training-dataset.parquet",
      requestId: undefined,
      correlationId: undefined,
    });
    const startRequest = (runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>).mock.calls[0]?.[0];
    expect(startRequest.taskType).toBe(TaskType.MODEL_TRAINING);
    expect(startRequest.payload.datasets[0].artifactId).toBe("generated/20260429160945623-2e7fe0660f46449f9ce819d011eb13f9-training-dataset.parquet");
    expect(startRequest.payload.datasets[0].path).toContain("training-dataset.parquet");
    expect(startRequest.payload.datasets[0].format).toBe("parquet");
  });

});
