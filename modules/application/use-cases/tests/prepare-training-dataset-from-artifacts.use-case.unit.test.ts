import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, testDouble } from "../../../testing/node-test";
import { createContractError } from "../../../contracts/shared";
import { PythonDatasetPreparationError } from "../../ports/runtime";
import {
  PrepareTrainingDatasetFromArtifactsUseCase,
} from "../prepare-training-dataset-from-artifacts.use-case";

const recipe = {
  normalization: { targetFormat: "markdown" as const },
  chunking: { strategy: "character" as const, chunkSize: 1000, chunkOverlap: 100 },
  generation: {
    mode: "qa" as const,
    model: { provider: "transformers" as const, modelId: "test-model", device: "cpu" as const, torchDtype: "float32" as const },
  },
};

const split = { trainRatio: 0.5, testRatio: 0.5 };

async function setupRuntimeOutputs() {
  const tempDir = await mkdtemp(join(tmpdir(), "dataset-use-case-test-"));
  const runtimeDataset = join(tempDir, "dataset.jsonl");
  await writeFile(runtimeDataset, '{"text":"train"}\n{"text":"test"}\n', "utf-8");
  return { runtimeDataset };
}

async function expectFileMissing(path: string) {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(`Expected file to be removed: ${path}`);
}

function createDeps(runtimeDataset: string) {
  const readArtifactStorageBindings = testDouble.fn(async ({ artifactId }: { artifactId: string }) => ({
    ok: true as const,
    value: {
      bindings: [{
        artifactId,
        backing: {
          kind: "artifact-object",
          provider: "local",
          locator: `key-${artifactId}`,
        },
        role: "primary",
      }],
    },
  }));

  const retrieveArtifact = testDouble.fn(async ({ key }: { key: string }) => ({
    ok: true as const,
    value: {
      descriptor: {
        key,
        mediaType: "application/x-ndjson",
        metadata: { originalName: `${key}.md` },
      },
      content: new TextEncoder().encode('{"text":"a"}\n{"text":"b"}\n'),
    },
  }));

  const storeArtifact = testDouble.fn(async () => ({
    ok: true as const,
    value: { key: "stored-dataset", mediaType: "application/x-ndjson" },
  }));

  const storeArtifactInRepo = testDouble.fn(async ({ target }: { target: { repository: string; path: string; revision?: string } }) => ({
    ok: true as const,
    value: {
      descriptor: {
        target: { provider: "huggingface", repository: target.repository, path: target.path, revision: target.revision },
        mediaType: "application/x-ndjson",
        sizeBytes: 20,
      },
    },
  }));

  const hasArtifactInRepo = testDouble.fn(async () => ({ ok: true as const, value: { exists: true } }));

  const prepareTrainingDataset = testDouble.fn(async (request) => {
    return {
      outputs: [
        {
          name: "dataset",
          role: "dataset",
          tempPath: runtimeDataset,
          mediaType: "application/x-ndjson",
          metadata: { stage: "generated-examples", generationMode: "qa" },
        },
      ],
      summary: {
        sourceDocumentCount: 1,
        normalizedDocumentCount: 1,
        skippedDocumentCount: 0,
        chunkCount: 1,
        generatedExampleCount: 2,
        datasetRowCount: 2,
        trainRowCount: 2,
        testRowCount: 0,
      },
      request,
    };
  });

  return {
    readArtifactStorageBindings,
    retrieveArtifact,
    storeArtifact,
    storeArtifactInRepo,
    hasArtifactInRepo,
    prepareTrainingDataset,
  };
}

describe("PrepareTrainingDatasetFromArtifactsUseCase", () => {
  it("passes originalName to runtime source inputs and stores local outputs by default", async () => {
    const { runtimeDataset } = await setupRuntimeOutputs();
    const deps = createDeps(runtimeDataset);

    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      datasetPreparation: { prepareTrainingDataset: deps.prepareTrainingDataset },
      storageBindings: {
        readArtifactStorageBindings: deps.readArtifactStorageBindings,
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: deps.retrieveArtifact,
        storeArtifact: deps.storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
    });

    const result = await useCase.execute({
      sourceArtifactIds: ["artifact-1"],
      recipe,
      split,
      output: { format: "jsonl" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const runtimeRequest = deps.prepareTrainingDataset.mock.calls[0]?.[0];
    expect(runtimeRequest.sourceInputs[0]?.originalName).toBe("key-artifact-1.md");
    expect(runtimeRequest.runtime).toBeUndefined();
    expect(deps.storeArtifact).toHaveBeenCalledTimes(1);
    expect(result.value.outputs.local?.dataset.storage.key).toBe("stored-dataset");
    expect(result.value.outputs.huggingFace).toBeUndefined();
    expect((result.value as Record<string, unknown>).train).toBeUndefined();
    expect((result.value as Record<string, unknown>).localOutputs).toBeUndefined();
    expect(result.value.provenance.generationModelId).toBe("test-model");
    await expectFileMissing(runtimeDataset);
  });

  it("uses artifact id as storage key when artifact has no storage bindings", async () => {
    const { runtimeDataset } = await setupRuntimeOutputs();
    const deps = createDeps(runtimeDataset);
    deps.readArtifactStorageBindings.mockImplementation(async () => ({
      ok: true as const,
      value: { bindings: [] },
    }));

    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      datasetPreparation: { prepareTrainingDataset: deps.prepareTrainingDataset },
      storageBindings: {
        readArtifactStorageBindings: deps.readArtifactStorageBindings,
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: deps.retrieveArtifact,
        storeArtifact: deps.storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
    });

    const artifactId = "uploads/session/source-a.md";
    const result = await useCase.execute({
      sourceArtifactIds: [artifactId],
      recipe,
      split,
      output: { format: "jsonl" },
    });

    expect(result.ok).toBe(true);
    expect(deps.retrieveArtifact.mock.calls[0]?.[0]?.key).toBe(artifactId);
    expect(deps.retrieveArtifact.mock.calls[0]?.[1]).toBeUndefined();
    await expectFileMissing(runtimeDataset);
  });

  it("uses artifact id as storage key when binding read returns not-found", async () => {
    const { runtimeDataset } = await setupRuntimeOutputs();
    const deps = createDeps(runtimeDataset);
    deps.readArtifactStorageBindings.mockImplementation(async () => ({
      ok: false as const,
      error: {
        code: "not-found",
        message: "No storage binding found for artifact 'uploads/session/source-a.md'.",
      },
    }));

    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      datasetPreparation: { prepareTrainingDataset: deps.prepareTrainingDataset },
      storageBindings: {
        readArtifactStorageBindings: deps.readArtifactStorageBindings,
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: deps.retrieveArtifact,
        storeArtifact: deps.storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
    });

    const artifactId = "uploads/session/source-a.md";
    const result = await useCase.execute({
      sourceArtifactIds: [artifactId],
      recipe,
      split,
      output: { format: "jsonl" },
    });

    expect(result.ok).toBe(true);
    expect(deps.retrieveArtifact.mock.calls[0]?.[0]?.key).toBe(artifactId);
    expect(deps.retrieveArtifact.mock.calls[0]?.[1]).toBeUndefined();
    await expectFileMissing(runtimeDataset);
  });

  it("materializes runtime source input files for nested upload artifact ids", async () => {
    const { runtimeDataset } = await setupRuntimeOutputs();
    const deps = createDeps(runtimeDataset);
    deps.readArtifactStorageBindings.mockImplementation(async () => ({
      ok: false as const,
      error: {
        code: "not-found",
        message: "No storage binding found.",
      },
    }));

    deps.retrieveArtifact.mockImplementation(async ({ key }: { key: string }) => ({
      ok: true as const,
      value: {
        descriptor: {
          key,
          mediaType: "text/markdown",
          metadata: { originalName: "source-a.md" },
        },
        content: new TextEncoder().encode("# source-a\n\nmarkdown input\n"),
      },
    }));

    deps.prepareTrainingDataset.mockImplementation(async (request) => {
      const runtimeLocalPath = request.sourceInputs[0]?.localPath;
      expect(typeof runtimeLocalPath).toBe("string");
      const runtimeSourceBytes = await readFile(runtimeLocalPath as string, "utf-8");
      expect(runtimeSourceBytes).toContain("markdown input");
      return {
        outputs: [
          {
            name: "dataset",
            role: "dataset",
            tempPath: runtimeDataset,
            mediaType: "application/x-ndjson",
            metadata: { stage: "generated-examples", generationMode: "qa" },
          },
        ],
        summary: {
          sourceDocumentCount: 1,
          normalizedDocumentCount: 1,
          skippedDocumentCount: 0,
          chunkCount: 1,
          generatedExampleCount: 2,
          datasetRowCount: 2,
          trainRowCount: 2,
          testRowCount: 0,
        },
      };
    });

    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      datasetPreparation: { prepareTrainingDataset: deps.prepareTrainingDataset },
      storageBindings: {
        readArtifactStorageBindings: deps.readArtifactStorageBindings,
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: deps.retrieveArtifact,
        storeArtifact: deps.storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
    });

    const result = await useCase.execute({
      sourceArtifactIds: ["uploads/session/source-a.md"],
      recipe,
      split,
      output: { format: "jsonl" },
    });

    expect(result.ok).toBe(true);
    await expectFileMissing(runtimeDataset);
  });

  it("supports huggingface-only output destination", async () => {
    const { runtimeDataset } = await setupRuntimeOutputs();
    const deps = createDeps(runtimeDataset);

    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      datasetPreparation: { prepareTrainingDataset: deps.prepareTrainingDataset },
      storageBindings: {
        readArtifactStorageBindings: deps.readArtifactStorageBindings,
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: deps.retrieveArtifact,
        storeArtifact: deps.storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      artifactRepoStorage: {
        storeArtifactInRepo: deps.storeArtifactInRepo,
        hasArtifactInRepo: deps.hasArtifactInRepo,
        retrieveArtifactFromRepo: testDouble.fn(),
      },
      now: () => "2026-04-20T00:00:00.000Z",
    });

    const result = await useCase.execute({
      sourceArtifactIds: ["artifact-1"],
      recipe,
      split,
      output: {
        format: "jsonl",
        destinations: {
          local: { enabled: false },
          huggingFace: { enabled: true, repository: "org/repo", pathPrefix: "datasets" },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(deps.storeArtifact).not.toHaveBeenCalled();
    expect(deps.storeArtifactInRepo).toHaveBeenCalledTimes(1);
    expect(result.value.outputs.local).toBeUndefined();
    expect(result.value.outputs.huggingFace?.dataset.path).toBe("datasets/dataset.jsonl");
    expect(result.value.outputs.huggingFace?.dataset.repository).toBe("org/repo");
    await expectFileMissing(runtimeDataset);
  });

  it("supports local + huggingface output destinations", async () => {
    const { runtimeDataset } = await setupRuntimeOutputs();
    const deps = createDeps(runtimeDataset);

    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      datasetPreparation: { prepareTrainingDataset: deps.prepareTrainingDataset },
      storageBindings: {
        readArtifactStorageBindings: deps.readArtifactStorageBindings,
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: deps.retrieveArtifact,
        storeArtifact: deps.storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      artifactRepoStorage: {
        storeArtifactInRepo: deps.storeArtifactInRepo,
        hasArtifactInRepo: deps.hasArtifactInRepo,
        retrieveArtifactFromRepo: testDouble.fn(),
      },
      now: () => "2026-04-20T00:00:00.000Z",
    });

    const result = await useCase.execute({
      sourceArtifactIds: ["artifact-1"],
      recipe,
      split,
      output: {
        format: "jsonl",
        destinations: {
          local: { enabled: true },
          huggingFace: { enabled: true, repository: "org/repo" },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(deps.storeArtifact).toHaveBeenCalledTimes(1);
    expect(deps.storeArtifactInRepo).toHaveBeenCalledTimes(1);
    expect(result.value.outputs.local?.dataset.storage.key).toBe("stored-dataset");
    expect(result.value.outputs.huggingFace?.dataset.path).toBe("dataset.jsonl");
    expect(result.value.summary.datasetRowCount).toBe(2);
    expect(result.value.provenance.output.destinations?.huggingFace?.repository).toBe("org/repo");
    const firstStoreMetadata = deps.storeArtifact.mock.calls[0]?.[0]?.descriptor?.metadata;
    expect(firstStoreMetadata).toMatchObject({
      sourceArtifactIds: ["artifact-1"],
      summary: { generatedExampleCount: 2 },
      destination: { provider: "local" },
      generationModel: { modelId: "test-model" },
    });
    await expectFileMissing(runtimeDataset);
  });

  it("fails without storing when runtime output is invalid JSONL", async () => {
    const { runtimeDataset } = await setupRuntimeOutputs();
    await writeFile(runtimeDataset, "not-json\n", "utf-8");
    const deps = createDeps(runtimeDataset);
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      datasetPreparation: { prepareTrainingDataset: deps.prepareTrainingDataset },
      storageBindings: {
        readArtifactStorageBindings: deps.readArtifactStorageBindings,
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: deps.retrieveArtifact,
        storeArtifact: deps.storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
    });

    const result = await useCase.execute({
      sourceArtifactIds: ["artifact-1"],
      recipe,
      split,
      output: { format: "jsonl" },
    });

    expect(result.ok).toBe(false);
    expect(deps.storeArtifact).not.toHaveBeenCalled();
    await expectFileMissing(runtimeDataset);
  });

  it("cleans runtime files on partial destination failure", async () => {
    const { runtimeDataset } = await setupRuntimeOutputs();
    const deps = createDeps(runtimeDataset);
    deps.storeArtifact.mockImplementation(async () => ({
      ok: false as const,
      error: { code: "unavailable", message: "store failed" },
    }));
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      datasetPreparation: { prepareTrainingDataset: deps.prepareTrainingDataset },
      storageBindings: {
        readArtifactStorageBindings: deps.readArtifactStorageBindings,
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: deps.retrieveArtifact,
        storeArtifact: deps.storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
    });

    const result = await useCase.execute({
      sourceArtifactIds: ["artifact-1"],
      recipe,
      split,
      output: { format: "jsonl" },
    });

    expect(result.ok).toBe(false);
    await expectFileMissing(runtimeDataset);
  });

  it("returns mapped structured runtime contract errors", async () => {
    const { runtimeDataset } = await setupRuntimeOutputs();
    const deps = createDeps(runtimeDataset);
    deps.prepareTrainingDataset.mockImplementation(async () => {
      throw new PythonDatasetPreparationError(
        createContractError("internal", "[generation] runtime timeout", {
          details: { stage: "generation", runtimeErrorCode: "runtime_timeout" },
        }),
      );
    });

    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      datasetPreparation: { prepareTrainingDataset: deps.prepareTrainingDataset },
      storageBindings: {
        readArtifactStorageBindings: deps.readArtifactStorageBindings,
        upsertArtifactStorageBinding: testDouble.fn(),
        deleteArtifactStorageBindings: testDouble.fn(),
      },
      storage: {
        retrieveArtifact: deps.retrieveArtifact,
        storeArtifact: deps.storeArtifact,
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
    });

    const result = await useCase.execute({
      sourceArtifactIds: ["artifact-1"],
      recipe,
      split,
      output: { format: "jsonl" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toBe("[generation] runtime timeout");
    expect(result.error.details).toMatchObject({ stage: "generation", runtimeErrorCode: "runtime_timeout" });
    await rm(runtimeDataset, { force: true });
  });
});
