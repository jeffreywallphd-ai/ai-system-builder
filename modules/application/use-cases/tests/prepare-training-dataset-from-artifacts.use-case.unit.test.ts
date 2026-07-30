import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, testDouble } from "../../../testing/node-test";
import { createOrganizationId } from "../../../contracts/organization";
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
        })) as any,
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

  it("materializes aggregate, train, validation, and test outputs with truthful counts", async () => {
    const outputFiles = [
      ["dataset", "d.jsonl", 4],
      ["train", "d-train.jsonl", 2],
      ["validation", "d-validation.jsonl", 1],
      ["test", "d-test.jsonl", 1],
    ] as const;
    const startTask = testDouble.fn(async (request: any) => {
      for (const [, fileName, rowCount] of outputFiles) {
        await writeFile(
          join(request.payload.runtime.runtimeWorkingDirectory, fileName),
          Array.from({ length: rowCount }, (_, index) =>
            JSON.stringify({ value: index }),
          ).join("\n"),
        );
      }
      return {
        requestId: "split-task",
        taskType: "prepare-training-dataset",
        accepted: true,
        status: "queued",
      };
    });
    const getTaskStatus = testDouble.fn(async () => ({
      requestId: "split-task",
      taskType: "dataset-preparation",
      status: "succeeded",
      concurrencyClass: "unknown",
      data: {
        outputs: outputFiles.map(([role, outputHandle, rowCount]) => ({
          name: role === "dataset" ? "d" : "d-" + role,
          role,
          outputHandle,
          mediaType: "application/x-ndjson",
          metadata: role === "dataset" ? {} : { rowCount },
        })),
        summary: {
          sourceDocumentCount: 4,
          normalizedDocumentCount: 4,
          skippedDocumentCount: 0,
          chunkCount: 4,
          generatedExampleCount: 4,
          datasetRowCount: 4,
          trainRowCount: 2,
          validationRowCount: 1,
          testRowCount: 1,
        },
      },
    }));
    const storeArtifact = testDouble.fn(async (request: any) => ({
      ok: true,
      value: request.descriptor,
    })) as any;
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({ startTask, getTaskStatus }),
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
        })) as any,
        storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      taskPowerLifecycle: createLifecycleFake(),
    });

    await useCase.startPrepareTrainingDataset(command, {
      workspaceId: "workspace-a",
    });
    const result = await useCase.readPrepareTrainingDataset("split-task", {
      workspaceId: "workspace-a",
    });

    expect(result.ok).toBe(true);
    if (
      result.ok &&
      result.value.status === "succeeded" &&
      "result" in result.value
    ) {
      expect(result.value.result.outputs.local).toMatchObject({
        dataset: { storage: { mediaType: "application/x-ndjson" } },
        train: { storage: { mediaType: "application/x-ndjson" } },
        validation: { storage: { mediaType: "application/x-ndjson" } },
        test: { storage: { mediaType: "application/x-ndjson" } },
      });
      expect(result.value.result.summary).toMatchObject({
        datasetRowCount: 4,
        trainRowCount: 2,
        validationRowCount: 1,
        testRowCount: 1,
      });
    }
    expect(storeArtifact).toHaveBeenCalledTimes(4);
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
        })) as any,
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
        })) as any,
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
        })) as any,
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
        })) as any,
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
        getTaskStatus: testDouble.fn(async () => ({
          requestId: "r-cancel",
          workspaceId: "workspace-a",
          taskType: "dataset-preparation",
          status: "running",
          concurrencyClass: "unknown",
        })),
        cancelTask,
      }),
      storageBindings: {
        readArtifactStorageBindings: testDouble.fn(async () => ({
          ok: true,
          value: { bindings: [] },
        })) as any,
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

  it("does not reveal or cancel a dataset task from another workspace or organization", async () => {
    const cancelTask = testDouble.fn(async () => ({
      requestId: "r-owned",
      cancelled: true,
      status: "cancelled" as const,
    }));
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({
        startTask: testDouble.fn(async () => ({
          requestId: "r-owned",
          taskType: "prepare-training-dataset",
          accepted: true,
          status: "queued",
        })),
        getTaskStatus: testDouble.fn(async () => ({
          requestId: "r-owned",
          workspaceId: "workspace-a",
          taskType: "dataset-preparation",
          status: "running",
          concurrencyClass: "unknown",
        })),
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
        })) as any,
        storeArtifact: testDouble.fn(),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      taskPowerLifecycle: createLifecycleFake(),
    });

    const started = await useCase.startPrepareTrainingDataset(command, {
      workspaceId: "workspace-a",
      organizationId: createOrganizationId("org-a"),
    });
    expect(started.ok).toBe(true);

    const read = await useCase.readPrepareTrainingDataset("r-owned", {
      workspaceId: "workspace-b",
    });
    expect(read).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });

    const otherOrganizationRead =
      await useCase.readPrepareTrainingDataset("r-owned", {
        workspaceId: "workspace-a",
        organizationId: createOrganizationId("org-b"),
      });
    expect(otherOrganizationRead).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });

    const cancelled = await useCase.cancelPrepareTrainingDataset("r-owned", {
      workspaceId: "workspace-a",
      organizationId: createOrganizationId("org-b"),
    });
    expect(cancelled).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it("rejects an unsupported source format before runtime work starts", async () => {
    const startTask = testDouble.fn();
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({ startTask }),
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
            descriptor: {
              key: "a1",
              mediaType: "application/vnd.ms-excel",
              metadata: { originalName: "legacy.xls" },
            },
            content: new Uint8Array([1, 2, 3]),
          },
        })) as any,
        storeArtifact: testDouble.fn(),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      taskPowerLifecycle: createLifecycleFake(),
    });

    const result = await useCase.startPrepareTrainingDataset(command, {
      workspaceId: "workspace-a",
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation",
        details: { code: "source-format-unsupported" },
      },
    });
    expect(startTask).not.toHaveBeenCalled();
  });

  it("rejects unsupported goals and oversized source batches before staging", async () => {
    const startTask = testDouble.fn();
    const readArtifactStorageBindings = testDouble.fn();
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({ startTask }),
      storageBindings: {
        readArtifactStorageBindings,
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
    });

    const unsupportedGoal = await useCase.startPrepareTrainingDataset(
      {
        ...command,
        recipe: {
          ...command.recipe,
          task: { taskType: "unknown-goal" as never },
        },
      },
      { workspaceId: "workspace-a" },
    );
    expect(unsupportedGoal).toMatchObject({
      ok: false,
      error: { code: "validation" },
    });

    const oversizedBatch = await useCase.startPrepareTrainingDataset(
      {
        ...command,
        sourceArtifactIds: Array.from(
          { length: 257 },
          (_, index) => "artifact-" + index,
        ),
      },
      { workspaceId: "workspace-a" },
    );
    expect(oversizedBatch).toMatchObject({
      ok: false,
      error: { code: "validation" },
    });
    expect(readArtifactStorageBindings).not.toHaveBeenCalled();
    expect(startTask).not.toHaveBeenCalled();
  });

  it("localizes a registered repository source before starting the task", async () => {
    const startTask = testDouble.fn(async () => ({
      requestId: "remote-task",
      taskType: "prepare-training-dataset",
      accepted: true,
      status: "queued",
    }));
    const retrieveArtifact = testDouble
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "not-found", message: "not local" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          descriptor: {
            key: "a1",
            mediaType: "application/vnd.apache.parquet",
            metadata: {
              originalName: "0.parquet",
              sourceRevision: "refs/convert/parquet",
            },
          },
          content: new Uint8Array([80, 65, 82, 49]),
        },
      }) as any;
    const storeArtifact = testDouble.fn(async (request: any) => ({
      ok: true,
      value: request.descriptor,
    })) as any;
    const upsertArtifactStorageBinding = testDouble.fn(
      async (request: any) => ({
        ok: true,
        value: request,
      }),
    ) as any;
    const retrieveArtifactFromRepo = testDouble.fn(async () => ({
      ok: true,
      value: {
        descriptor: {
          target: {
            provider: "huggingface",
            repository: "owner/data",
            revision: "refs/convert/parquet",
            path: "default/train/0.parquet",
          },
          mediaType: "application/vnd.apache.parquet",
          sizeBytes: 4,
        },
        content: new Uint8Array([80, 65, 82, 49]),
      },
    })) as any;
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: createRegistry({ startTask }),
      storageBindings: {
        readArtifactStorageBindings: testDouble.fn(async () => ({
          ok: true,
          value: {
            bindings: [
              {
                artifactId: "a1",
                role: "imported-source",
                backing: {
                  kind: "artifact-repo",
                  provider: "huggingface",
                  locator: "owner/data/default/train/0.parquet",
                  target: {
                    provider: "huggingface",
                    repository: "owner/data",
                    revision: "refs/convert/parquet",
                    path: "default/train/0.parquet",
                  },
                },
              },
            ],
          },
        })),
        upsertArtifactStorageBinding,
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact,
        storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      artifactRepoStorage: {
        retrieveArtifactFromRepo,
        storeArtifactInRepo: testDouble.fn(),
        hasArtifactInRepo: testDouble.fn(),
      },
      taskPowerLifecycle: createLifecycleFake(),
    });

    const result = await useCase.startPrepareTrainingDataset(
      {
        ...command,
        recipe: {
          ...command.recipe,
          task: {
            taskType: "llm-classification",
            textField: "text",
            labelField: "label",
          },
        },
      },
      {
        workspaceId: "workspace-a",
      },
    );

    expect(result.ok).toBe(true);
    expect(retrieveArtifactFromRepo).toHaveBeenCalledTimes(1);
    expect(storeArtifact).toHaveBeenCalledTimes(1);
    expect(upsertArtifactStorageBinding).toHaveBeenCalledTimes(1);
    expect(startTask).toHaveBeenCalledTimes(1);
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
