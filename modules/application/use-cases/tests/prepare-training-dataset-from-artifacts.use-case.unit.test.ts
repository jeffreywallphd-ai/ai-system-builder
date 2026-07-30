import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, testDouble } from "../../../testing/node-test";
import type { TaskPowerLifecyclePort } from "../../services/runtime";
import { PrepareTrainingDatasetFromArtifactsUseCase } from "../prepare-training-dataset-from-artifacts.use-case";

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
const command = {
  sourceArtifactIds: ["a1"],
  recipe: {
    normalization: { targetFormat: "markdown" as const },
    chunking: { strategy: "character" as const, chunkSize: 1, chunkOverlap: 0 },
    generation: {
      mode: "qa" as const,
      model: { provider: "transformers" as const, modelId: "m" },
    },
  },
  split: { trainRatio: 0.8, testRatio: 0.2 },
  output: { format: "jsonl" as const },
};
const createLifecycleFake = (): TaskPowerLifecyclePort => ({
  startTask: testDouble.fn(async () => undefined),
  completeTask: testDouble.fn(async () => undefined),
});
const createRegistry = (overrides?: {
  startTask?: any;
  getTaskStatus?: any;
  cancelTask?: any;
}) => ({
  startTask: overrides?.startTask ?? testDouble.fn(),
  getTaskStatus: overrides?.getTaskStatus ?? testDouble.fn(),
  cancelTask: overrides?.cancelTask ?? testDouble.fn(),
  listTasks: testDouble.fn(async () => ({ tasks: [] })),
});

describe("PrepareTrainingDatasetFromArtifactsUseCase", () => {
  it("uses runtime task registry for start/read and materializes", async () => {
    const lifecycle = createLifecycleFake();
    const runtimeStart = testDouble.fn(async (request: any) => {
      await writeFile(
        join(request.payload.runtime.runtimeWorkingDirectory, "d.jsonl"),
        `{"x":1}\n`,
      );
      return {
        requestId: "r1",
        taskType: "prepare-training-dataset",
        accepted: true,
        status: "queued",
      };
    });
    const runtimeStatus = testDouble.fn(async () => ({
      requestId: "r1",
      taskType: "dataset-preparation",
      status: "succeeded",
      concurrencyClass: "unknown",
      data: {
        outputs: [
          {
            name: "d",
            role: "dataset",
            outputHandle: "d.jsonl",
            mediaType: "application/x-ndjson",
          },
        ],
        summary: {
          sourceDocumentCount: 1,
          normalizedDocumentCount: 1,
          skippedDocumentCount: 0,
          chunkCount: 1,
          generatedExampleCount: 1,
          datasetRowCount: 1,
          trainRowCount: 1,
          testRowCount: 0,
        },
      },
    }));
    let storedDatasetRequest: any;
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({
        startTask: runtimeStart,
        getTaskStatus: runtimeStatus,
      }),
      storageBindings: {
        readArtifactStorageBindings: testDouble.fn(async () => ({
          ok: true,
          value: { bindings: [] },
        })),
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: testDouble.fn(async () => ({
          ok: true,
          value: {
            descriptor: { key: "a1", mediaType: "text/markdown", metadata: {} },
            content: new TextEncoder().encode("hi"),
          },
        })),
        storeArtifact: testDouble.fn(async (request: any) => {
          storedDatasetRequest = request;
          return { ok: true, value: request.descriptor };
        }),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      taskPowerLifecycle: lifecycle,
    });
    const started = await useCase.startPrepareTrainingDataset(command, {
      workspaceId: "workspace-a",
    });
    expect(started.ok).toBe(true);
    const status = await useCase.readPrepareTrainingDataset("r1", {
      workspaceId: "workspace-a",
    });
    expect(status.ok).toBe(true);
    expect(runtimeStart).toHaveBeenCalledTimes(1);
    expect(runtimeStatus).toHaveBeenCalledWith("r1");
    expect(
      storedDatasetRequest.descriptor.metadata.datasetPreparationTask,
    ).toMatchObject({
      taskType: "llm-instruction",
      modelFamily: "llm",
      outputSchema: "instruction-response",
      runtimeSupport: "supported",
    });
  });

  it("completes lifecycle on materialization failure", async () => {
    const lifecycle = createLifecycleFake();
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({
        startTask: testDouble.fn(async (request: any) => {
          await writeFile(
            join(request.payload.runtime.runtimeWorkingDirectory, "d.jsonl"),
            `{"x":1}\n`,
          );
          return {
            requestId: "r1",
            taskType: "prepare-training-dataset",
            accepted: true,
            status: "queued",
          };
        }),
        getTaskStatus: testDouble.fn(async () => ({
          requestId: "r1",
          taskType: "dataset-preparation",
          status: "succeeded",
          concurrencyClass: "unknown",
          data: {
            outputs: [
              {
                name: "d",
                role: "dataset",
                outputHandle: "d.jsonl",
                mediaType: "application/x-ndjson",
              },
            ],
            summary: {
              sourceDocumentCount: 1,
              normalizedDocumentCount: 1,
              skippedDocumentCount: 0,
              chunkCount: 1,
              generatedExampleCount: 1,
              datasetRowCount: 1,
              trainRowCount: 1,
              testRowCount: 0,
            },
          },
        })),
      }),
      storageBindings: {
        readArtifactStorageBindings: testDouble.fn(async () => ({
          ok: true,
          value: { bindings: [] },
        })),
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: testDouble.fn(async () => ({
          ok: true,
          value: {
            descriptor: { key: "a1", mediaType: "text/markdown", metadata: {} },
            content: new TextEncoder().encode("hi"),
          },
        })),
        storeArtifact: testDouble.fn(async () => ({
          ok: false,
          error: { code: "internal", message: "store failed" },
        })),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      taskPowerLifecycle: lifecycle,
    });
    await useCase.startPrepareTrainingDataset(command, {
      workspaceId: "workspace-a",
    });
    const status = await useCase.readPrepareTrainingDataset("r1", {
      workspaceId: "workspace-a",
    });
    expect(status.ok).toBe(false);
    expect(lifecycle.completeTask).toHaveBeenCalledWith("r1", "failed");
  });

  it("rejects worker-supplied paths and traversal handles", async () => {
    const lifecycle = createLifecycleFake();
    const statusData = {
      outputs: [
        {
          name: "d",
          role: "dataset",
          outputHandle: "../outside.jsonl",
          tempPath: "C:/private/outside.jsonl",
          mediaType: "application/x-ndjson",
        },
      ],
      summary: {
        sourceDocumentCount: 1,
        normalizedDocumentCount: 1,
        skippedDocumentCount: 0,
        chunkCount: 1,
        generatedExampleCount: 1,
        datasetRowCount: 1,
        trainRowCount: 1,
        testRowCount: 0,
      },
    };
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({
        startTask: testDouble.fn(async () => ({
          requestId: "r-unsafe",
          taskType: "prepare-training-dataset",
          accepted: true,
          status: "queued",
        })),
        getTaskStatus: testDouble.fn(async () => ({
          requestId: "r-unsafe",
          taskType: "dataset-preparation",
          status: "succeeded",
          concurrencyClass: "unknown",
          data: statusData,
        })),
      }),
      storageBindings: {
        readArtifactStorageBindings: testDouble.fn(async () => ({
          ok: true,
          value: { bindings: [] },
        })),
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: testDouble.fn(async () => ({
          ok: true,
          value: {
            descriptor: { key: "a1", mediaType: "text/markdown", metadata: {} },
            content: new TextEncoder().encode("hi"),
          },
        })),
        storeArtifact: testDouble.fn(),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      taskPowerLifecycle: lifecycle,
    });

    await useCase.startPrepareTrainingDataset(command, {
      workspaceId: "workspace-a",
    });
    const result = await useCase.readPrepareTrainingDataset("r-unsafe", {
      workspaceId: "workspace-a",
    });

    expect(result.ok).toBe(false);
    expect(lifecycle.completeTask).toHaveBeenCalledWith("r-unsafe", "failed");
  });

  it("cleans runtime working dir on terminal status", async () => {
    const lifecycle = createLifecycleFake();
    let runtimeDir = "";
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({
        startTask: testDouble.fn(async (request: any) => {
          runtimeDir = request.payload.runtime.runtimeWorkingDirectory;
          return {
            requestId: "r1",
            taskType: "prepare-training-dataset",
            accepted: true,
            status: "queued",
          };
        }),
        getTaskStatus: testDouble.fn(async () => ({
          requestId: "r1",
          taskType: "dataset-preparation",
          status: "failed",
          concurrencyClass: "unknown",
          error: { code: "failed", message: "boom" },
        })),
      }),
      storageBindings: {
        readArtifactStorageBindings: testDouble.fn(async () => ({
          ok: true,
          value: { bindings: [] },
        })),
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: testDouble.fn(async () => ({
          ok: true,
          value: {
            descriptor: { key: "a1", mediaType: "text/markdown", metadata: {} },
            content: new TextEncoder().encode("hi"),
          },
        })),
        storeArtifact: testDouble.fn(),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      taskPowerLifecycle: lifecycle,
    });
    await useCase.startPrepareTrainingDataset(command, {
      workspaceId: "workspace-a",
    });
    expect(await exists(runtimeDir)).toBe(true);
    await useCase.readPrepareTrainingDataset("r1", {
      workspaceId: "workspace-a",
    });
    expect(await exists(runtimeDir)).toBe(false);
  });

  it("returns clear start failure when python runtime is unavailable", async () => {
    const lifecycle = createLifecycleFake();
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({
        startTask: testDouble.fn(async () => {
          throw new Error(
            "Python runtime failed to start or become ready before starting task: fetch failed",
          );
        }),
      }),
      storageBindings: {
        readArtifactStorageBindings: testDouble.fn(async () => ({
          ok: true,
          value: { bindings: [] },
        })),
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: testDouble.fn(async () => ({
          ok: true,
          value: {
            descriptor: { key: "a1", mediaType: "text/markdown", metadata: {} },
            content: new TextEncoder().encode("hi"),
          },
        })),
        storeArtifact: testDouble.fn(),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      taskPowerLifecycle: lifecycle,
    });

    const started = await useCase.startPrepareTrainingDataset(command, {
      workspaceId: "workspace-a",
    });

    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.message).toContain(
        "Python runtime could not be started before dataset preparation.",
      );
      expect(started.error.message).toContain(
        "Python runtime failed to start or become ready",
      );
    }
  });

  it("cancels runtime work and cleans its staged working directory", async () => {
    const lifecycle = createLifecycleFake();
    let runtimeDir = "";
    const cancelTask = testDouble.fn(async () => ({
      requestId: "r-cancel",
      cancelled: true,
      status: "cancelled" as const,
    }));
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({
        startTask: testDouble.fn(async (request: any) => {
          runtimeDir = request.payload.runtime.runtimeWorkingDirectory;
          return {
            requestId: "r-cancel",
            taskType: "prepare-training-dataset",
            accepted: true,
            status: "queued",
          };
        }),
        cancelTask,
      }),
      storageBindings: {
        readArtifactStorageBindings: testDouble.fn(async () => ({
          ok: true,
          value: { bindings: [] },
        })),
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: testDouble.fn(async () => ({
          ok: true,
          value: {
            descriptor: { key: "a1", mediaType: "text/markdown", metadata: {} },
            content: new TextEncoder().encode("hi"),
          },
        })),
        storeArtifact: testDouble.fn(),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      taskPowerLifecycle: lifecycle,
    });

    await useCase.startPrepareTrainingDataset(command, {
      workspaceId: "workspace-a",
    });
    expect(await exists(runtimeDir)).toBe(true);
    const cancelled = await useCase.cancelPrepareTrainingDataset("r-cancel", {
      workspaceId: "workspace-a",
    });

    expect(cancelled).toMatchObject({
      ok: true,
      value: { requestId: "r-cancel", cancelled: true, status: "cancelled" },
    });
    expect(cancelTask).toHaveBeenCalledWith("r-cancel");
    expect(lifecycle.completeTask).toHaveBeenCalledWith(
      "r-cancel",
      "cancelled",
    );
    expect(await exists(runtimeDir)).toBe(false);
  });
});

it("rejects dataset preparation start when runtime capability is not ready", async () => {
  const startTask = testDouble.fn();
  const unavailable = new Error(
    "Runtime capability 'dataset-preparation' is not-installed.",
  ) as Error & { code: "unavailable"; details: Record<string, unknown> };
  unavailable.code = "unavailable";
  unavailable.details = {
    capabilityId: "dataset-preparation",
    status: "not-installed",
    recommendedActions: ["install"],
  };
  const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
    runtimeTaskRegistry: createRegistry({ startTask }),
    storageBindings: {
      readArtifactStorageBindings: testDouble.fn(),
      upsertArtifactStorageBinding: testDouble.fn(),
      deleteArtifactStorageBindings: testDouble.fn(),
    },
    storage: {
      retrieveArtifact: testDouble.fn(),
      storeArtifact: testDouble.fn(),
      hasArtifact: testDouble.fn(),
      deleteArtifact: testDouble.fn(),
    },
    taskPowerLifecycle: createLifecycleFake(),
    runtimeCapabilityGuard: {
      requireCapabilityReady: testDouble.fn(async () => {
        throw unavailable;
      }),
    },
  });

  const result = await useCase.startPrepareTrainingDataset(command, {
    requestId: "req-dataset",
    correlationId: "corr-dataset",
    workspaceId: "workspace-a",
  });

  expect(result).toMatchObject({
    ok: false,
    requestId: "req-dataset",
    correlationId: "corr-dataset",
    error: {
      code: "unavailable",
      details: { capabilityId: "dataset-preparation", status: "not-installed" },
    },
  });
  expect(startTask).not.toHaveBeenCalled();
});
