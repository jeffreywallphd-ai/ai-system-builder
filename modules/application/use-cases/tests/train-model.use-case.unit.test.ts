import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, testDouble } from "../../../testing/node-test";

import {
  TaskType,
  type RuntimeTaskRegistryPort,
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

  const createRuntimeTaskRegistryFake = (): RuntimeTaskRegistryPort => ({
    startTask: testDouble.fn(async () => ({
      requestId: "train-req-1",
      accepted: true,
      status: "queued",
    })),
    getTaskStatus: testDouble.fn(async () => ({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
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
            role: "primary",
            backing: {
              kind: "artifact-object",
              provider: "local-filesystem",
              locator: "/tmp/dataset-1.parquet",
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
      path: "/tmp/dataset-1.parquet",
    });
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

  it("maps runtime training progress into model training status reads", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (
      runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>
    ).mockResolvedValue({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
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
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    (
      runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>
    ).mockResolvedValue({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
      status: "succeeded",
      concurrencyClass: "unknown",
      data: {
        runId: "worker-train-run-1",
        status: "succeeded",
        generatedModelCandidate: {
          displayName: "Demo Adapter",
          provider: "huggingface",
          modelId: "org/demo-adapter",
          localPath: "/tmp/demo-adapter",
          generatedFromRunId: "worker-train-run-1",
        },
      },
    });
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
      runtimeTaskRegistry,
      modelRegistry: { ...baseRegistry, registerGeneratedModel },
      storageBindings: createStorageBindingsFake(),
      storage: createStorageFake(),
      generatedModelStorage: createGeneratedModelStorageFake(),
      taskPowerLifecycle: lifecycle,
    });

    await useCase.execute(baseRequest);
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
    ).mockResolvedValue({
      requestId: "train-req-1",
      taskType: TaskType.MODEL_TRAINING,
      status: "succeeded",
      concurrencyClass: "unknown",
      data: {
        runId: "train-req-1",
        status: "succeeded",
        outputModelName: "demo-adapter",
        generatedModelCandidate: {
          displayName: "Demo Adapter",
          localPath: "/tmp/demo-adapter",
          artifactForm: "adapter",
        },
      },
    });
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

  it("discards staged output and denies review actions from another workspace", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "trained-model-review-"),
    );
    const outputDirectory = join(temporaryRoot, "output");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "adapter.safetensors"), "weights");
    try {
      const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
      (
        runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>
      ).mockResolvedValue({
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
            localPath: outputDirectory,
            artifactForm: "adapter",
          },
        },
      });
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
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  for (const terminalStatus of ["failed", "cancelled"] as const) {
    it(`completes lifecycle for terminal status ${terminalStatus}`, async () => {
      const lifecycle = createLifecycleFake();
      const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
      (
        runtimeTaskRegistry.getTaskStatus as ReturnType<typeof testDouble.fn>
      ).mockResolvedValue({
        requestId: "train-req-1",
        taskType: TaskType.MODEL_TRAINING,
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

  it("stages a generated local artifact-object storage key when no binding row exists", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const storageBindings: Pick<
      ArtifactStorageBindingPort,
      "readArtifactStorageBindings"
    > = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true as const,
        value: { bindings: [] },
      })),
    };
    const storage = createStorageFake();
    const generatedDatasetRequest = {
      ...baseRequest,
      datasets: [
        {
          artifactId:
            "generated/20260429160945623-2e7fe0660f46449f9ce819d011eb13f9-training-dataset.parquet",
          splitRole: "train" as const,
        },
      ],
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

    await useCase.execute(generatedDatasetRequest);

    expect(storage.retrieveArtifact).toHaveBeenCalledWith({
      key: "generated/20260429160945623-2e7fe0660f46449f9ce819d011eb13f9-training-dataset.parquet",
      requestId: undefined,
      correlationId: undefined,
    });
    const startRequest = (
      runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>
    ).mock.calls[0]?.[0];
    expect(startRequest.taskType).toBe(TaskType.MODEL_TRAINING);
    expect(startRequest.payload.datasets[0].artifactId).toBe(
      "generated/20260429160945623-2e7fe0660f46449f9ce819d011eb13f9-training-dataset.parquet",
    );
    expect(startRequest.payload.datasets[0].path).toContain(
      "training-dataset.parquet",
    );
    expect(startRequest.payload.datasets[0].format).toBe("parquet");
    expect(
      startRequest.payload.datasets[0].metadata.artifactMetadata
        .structuredOutput,
    ).toEqual({
      schemaFingerprint: "a".repeat(64),
      purposePaths: {
        text: ["result", "body"],
        label: ["result", "category"],
      },
    });
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
            bindings:
              artifactId === "source-image-1"
                ? [
                    {
                      artifactId,
                      role: "primary",
                      backing: {
                        kind: "artifact-object" as const,
                        provider: "local" as const,
                        locator: "uploads/source-image-1.png",
                      },
                    },
                  ]
                : [],
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
