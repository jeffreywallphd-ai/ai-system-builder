import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, testDouble } from "../../../testing/node-test";
import { createStructuredDatasetVersionRepository } from "../../../adapters/persistence/dataset-version";
import { createInMemoryStructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createSha256DatasetVersionHasher } from "../../../adapters/storage/dataset-version";
import { DatasetVersionFinalizationService } from "../../services/dataset-version";
import type { ArtifactObjectStoragePort } from "../../ports/storage";
import {
  createDeleteArtifactSuccessResult,
  createHasArtifactSuccessResult,
  createRetrieveArtifactFailureResult,
  createRetrieveArtifactSuccessResult,
  createStoreArtifactFailureResult,
  createStoreArtifactSuccessResult,
} from "../../../contracts/storage";
import { createContractError } from "../../../contracts/shared";
import { createWorkspaceId } from "../../../contracts/workspace";
import { PrepareTrainingDatasetFromArtifactsUseCase } from "../prepare-training-dataset-from-artifacts.use-case";

describe("dataset preparation version finalization", () => {
  it("returns and persists one immutable version after output materialization", async () => {
    const hasher = createSha256DatasetVersionHasher();
    const bytes = new Map<string, Uint8Array>([
      ["source-1", new TextEncoder().encode("source content")],
    ]);
    const descriptors = new Map<string, any>([
      ["source-1", { key: "source-1", mediaType: "text/markdown", sizeBytes: 14 }],
    ]);
    const storage: ArtifactObjectStoragePort = {
      async storeArtifact(request, context) {
        const key = String(request.descriptor.key);
        if (bytes.has(key) && !request.overwrite) {
          return createStoreArtifactFailureResult(createContractError("conflict", "Artifact exists."), context);
        }
        const content = request.content as Uint8Array;
        const descriptor = {
          ...request.descriptor,
          key,
          sizeBytes: content.byteLength,
          checksum: {
            algorithm: "sha256",
            value: hasher.digest(content).slice("sha256:".length),
          },
        };
        bytes.set(key, content);
        descriptors.set(key, descriptor);
        return createStoreArtifactSuccessResult(descriptor, context);
      },
      retrieveArtifact: (async (request: any, context?: any) => {
        const content = bytes.get(request.key);
        return content
          ? createRetrieveArtifactSuccessResult(descriptors.get(request.key), content, context)
          : createRetrieveArtifactFailureResult(createContractError("not-found", "Artifact missing."), context);
      }) as ArtifactObjectStoragePort["retrieveArtifact"],
      async hasArtifact(request) {
        return createHasArtifactSuccessResult(bytes.has(request.key), {
          descriptor: descriptors.get(request.key),
        });
      },
      async deleteArtifact(request, context) {
        descriptors.delete(request.key);
        return createDeleteArtifactSuccessResult(bytes.delete(request.key), context);
      },
    };
    const repository = createStructuredDatasetVersionRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: {
        async startTask(request: any) {
          await writeFile(
            join(request.payload.runtime.runtimeWorkingDirectory, "prepared.jsonl"),
            '{"instruction":"hello","output":"world"}\n',
          );
          return {
            requestId: "version-task",
            taskType: "dataset-preparation",
            accepted: true,
            status: "queued",
          } as const;
        },
        async getTaskStatus() {
          return {
            requestId: "version-task",
            taskType: "dataset-preparation",
            status: "succeeded",
            concurrencyClass: "unknown",
            data: {
              outputs: [
                {
                  name: "support-answers",
                  role: "dataset",
                  outputHandle: "prepared.jsonl",
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
          } as any;
        },
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(async () => ({ tasks: [] })),
      },
      storageBindings: {
        readArtifactStorageBindings: testDouble.fn(async () => ({ ok: true, value: { bindings: [] } })),
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage,
      taskPowerLifecycle: {
        startTask: testDouble.fn(async () => undefined),
        completeTask: testDouble.fn(async () => undefined),
      },
      datasetVersioning: {
        hasher,
        finalizer: new DatasetVersionFinalizationService({
          repository,
          artifacts: storage,
          hasher,
        }),
      },
      now: () => "2026-07-29T15:00:00.000Z",
    });
    const command = {
      sourceArtifactIds: ["source-1"],
      recipe: {
        normalization: { targetFormat: "markdown" as const },
        chunking: { strategy: "character" as const, chunkSize: 256, chunkOverlap: 0 },
        generation: { mode: "qa" as const, model: { provider: "transformers" as const, modelId: "fixture-model" } },
      },
      split: { trainRatio: 0.8, testRatio: 0.2, seed: 42 },
      output: { format: "jsonl" as const, naming: { baseName: "Support Answers" } },
    };

    expect((await useCase.startPrepareTrainingDataset(command, { workspaceId: "workspace-a", principalId: "person-1" })).ok).toBe(true);
    const completed = await useCase.readPrepareTrainingDataset("version-task", { workspaceId: "workspace-a", principalId: "person-1" });
    expect(completed.ok).toBe(true);
    if (completed.ok && completed.value.status === "succeeded" && "result" in completed.value) {
      expect(completed.value.result.datasetVersion).toMatchObject({
        datasetId: "support-answers",
        versionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
    }
    const versions = await repository.listVersions(createWorkspaceId("workspace-a"));
    expect(versions.length).toBe(1);
    expect(versions[0]?.lineage.sources[0]).toMatchObject({
      sourceArtifactId: "source-1",
      artifactKey: "source-1",
      digest: hasher.digest("source content"),
    });
  });
});
