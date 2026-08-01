import { access, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  CONTEXT_RAG_DATABASE_MEDIA_TYPE,
  type StartContextGenerationCommand,
} from "../../../../contracts/context-management";
import { TaskType, type ContextGenerationTaskRequest } from "../../../../contracts/runtime";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { ContextGenerationUseCase } from "../context-generation.use-case";

function digest(bytes: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function command(): StartContextGenerationCommand {
  return {
    kind: "rag-database",
    name: "Release knowledge",
    sources: [{ artifactId: "artifact.source" }],
    chunking: {
      strategy: "fixed-length",
      chunkCharacters: 256,
      overlapCharacters: 32,
    },
    embedding: {
      provider: "transformers",
      modelId: "local/test-embedding",
      dimensions: 3,
      batchSize: 2,
    },
  };
}

function createHarness(options?: {
  readonly appendFails?: boolean;
  readonly bindingFails?: boolean;
  readonly outputDigestMismatch?: boolean;
}) {
  const workspaceId = createWorkspaceId("workspace.context");
  const sourceBytes = new TextEncoder().encode(
    "# Releases\n\nEvery release requires verification.",
  );
  const outputBytes = new TextEncoder().encode("bounded sqlite artifact");
  let runtimeRequest: ContextGenerationTaskRequest | undefined;
  let runtimeDirectory: string | undefined;
  const stored: Array<any> = [];
  const deleted: string[] = [];
  const catalogRecords: Array<any> = [];
  const deletedCatalogRecords: string[] = [];
  const upsertedBindings: Array<any> = [];
  const powerStarts: Array<any> = [];
  const powerCompletions: Array<any> = [];
  const runtimeTaskRegistry: any = {
    startTask: testDouble.fn(async (request: any) => {
      runtimeRequest = request.payload;
      runtimeDirectory = runtimeRequest!.runtime.runtimeWorkingDirectory;
      await writeFile(
        join(runtimeDirectory, "Release-knowledge.sqlite3"),
        outputBytes,
      );
      return {
        requestId: request.requestId ?? "context-request",
        status: "queued",
      };
    }),
    getTaskStatus: testDouble.fn(async () => {
      const source = runtimeRequest!.sources[0]!;
      const outputDigest = options?.outputDigestMismatch
        ? "sha256:" + "0".repeat(64)
        : digest(outputBytes);
      return {
        requestId: "context-request",
        workspaceId,
        taskType: TaskType.CONTEXT_GENERATION,
        status: "succeeded",
        concurrencyClass: "cpu-heavy",
        data: {
          output: {
            name: "Release-knowledge.sqlite3",
            outputHandle: "Release-knowledge.sqlite3",
            mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
            sizeBytes: outputBytes.byteLength,
            digest: outputDigest,
          },
          sourceInspections: [{
            artifactId: source.artifactId,
            digest: source.sourceDigest,
            mediaType: source.mediaType,
            originalName: source.originalName,
            sizeBytes: source.sizeBytes,
            ready: true,
            sourceKind: "document",
            format: "md",
            alreadyChunked: false,
            chunkCount: 1,
          }],
          preview: {
            kind: "rag-database",
            name: "Release knowledge",
            sourceCount: 1,
            manualEntryCount: 0,
            chunkCount: 1,
            items: [{
              id: "artifact.source:document:0",
              kind: "chunk",
              text: "Every release requires verification.",
              citations: [{
                sourceArtifactId: "artifact.source",
                chunkIndex: 0,
              }],
            }],
          },
          manifest: {
            schemaVersion: "1",
            kind: "rag-database",
            name: "Release knowledge",
            mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
            createdAt: "2026-08-01T00:00:00.000Z",
            sources: [{
              artifactId: source.artifactId,
              digest: source.sourceDigest,
              mediaType: source.mediaType,
              originalName: source.originalName,
              sizeBytes: source.sizeBytes,
              chunkCount: 1,
              chunkingMode: "extracted",
            }],
            manualEntries: [],
            chunking: runtimeRequest!.chunking,
            embedding: {
              provider: "transformers",
              modelId: "local/test-embedding",
              dimensions: 3,
            },
          },
        },
      };
    }),
    cancelTask: testDouble.fn(async () => ({
      requestId: "context-request",
      status: "cancelled",
      cancelled: true,
    })),
    listTasks: testDouble.fn(),
  };
  const storage: any = {
    retrieveArtifact: testDouble.fn(async (request: any) => {
      if (request.key !== "artifact.source") {
        return { ok: false, error: { code: "not-found", message: "missing" } };
      }
      return {
        ok: true,
        value: {
          descriptor: {
            key: "artifact.source",
            mediaType: "text/markdown",
            sizeBytes: sourceBytes.byteLength,
            metadata: { originalFileName: "release.md" },
          },
          content: sourceBytes,
        },
      };
    }),
    storeArtifact: testDouble.fn(async (request: any) => {
      stored.push(request);
      return {
        ok: true,
        value: {
          ...request.descriptor,
          key: request.descriptor.key,
          sizeBytes: request.content.byteLength,
        },
      };
    }),
    deleteArtifact: testDouble.fn(async (request: any) => {
      deleted.push(request.key);
      return { ok: true, value: { deleted: true } };
    }),
    hasArtifact: testDouble.fn(),
  };
  const storageBindings: any = {
    readArtifactStorageBindings: testDouble.fn(async () => ({
      ok: false,
      error: { code: "not-found", message: "no explicit binding" },
    })),
    upsertArtifactStorageBinding: testDouble.fn(async (request: any) => {
      if (options?.bindingFails) {
        return {
          ok: false,
          error: { code: "internal", message: "binding unavailable" },
        };
      }
      upsertedBindings.push(request.binding);
      return { ok: true, value: { binding: request.binding } };
    }),
    deleteArtifactStorageBindings: testDouble.fn(),
  };
  const artifactCatalog: any = {
    readArtifactCatalogRecord: testDouble.fn(async () => ({
      ok: false,
      error: { code: "not-found", message: "not catalogued" },
    })),
    browseArtifactCatalogRecords: testDouble.fn(),
    appendArtifactCatalogRecord: testDouble.fn(async (request: any) => {
      if (options?.appendFails) {
        return {
          ok: false,
          error: { code: "internal", message: "catalog unavailable" },
        };
      }
      catalogRecords.push(request.record);
      return { ok: true, value: { storageKey: request.record.storageKey } };
    }),
    deleteArtifactCatalogRecord: testDouble.fn(async (request: any) => {
      deletedCatalogRecords.push(request.storageKey);
      return { ok: true, value: { deleted: true } };
    }),
  };
  const taskPowerLifecycle: any = {
    startTask: testDouble.fn(async (...args: any[]) => {
      powerStarts.push(args);
    }),
    completeTask: testDouble.fn(async (...args: any[]) => {
      powerCompletions.push(args);
    }),
  };
  const useCase = new ContextGenerationUseCase({
    runtimeTaskRegistry,
    storageBindings,
    storage,
    artifactCatalog,
    taskPowerLifecycle,
    now: () => "2026-08-01T00:00:00.000Z",
    createId: () => "context-artifact-1",
  });
  const context = {
    requestId: "context-request",
    workspaceId,
    principalId: "principal-1",
  };
  return {
    useCase,
    context,
    runtimeTaskRegistry,
    stored,
    deleted,
    catalogRecords,
    deletedCatalogRecords,
    upsertedBindings,
    powerStarts,
    powerCompletions,
    getRuntimeDirectory: () => runtimeDirectory,
  };
}

describe("ContextGenerationUseCase", () => {
  it("keeps successful generation staged for review, then saves and catalogs it", async () => {
    const harness = createHarness();

    const started = await harness.useCase.start(command(), harness.context);
    expect(started).toMatchObject({
      ok: true,
      value: {
        requestId: "context-request",
        taskType: "generate-context-artifact",
      },
    });
    expect(harness.stored.length).toBe(0);

    const review = await harness.useCase.read(
      "context-request",
      harness.context,
    );
    expect(review).toMatchObject({
      ok: true,
      value: {
        state: "review-required",
        preview: { chunkCount: 1 },
      },
    });
    expect(harness.stored.length).toBe(0);

    const saved = await harness.useCase.save(
      "context-request",
      harness.context,
    );
    expect(saved).toMatchObject({
      ok: true,
      value: {
        state: "saved",
        savedArtifact: {
          artifactId:
            "generated/context/context-artifact-1/Release-knowledge.sqlite3",
          name: "Release knowledge",
          mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
        },
      },
    });
    expect(harness.stored.length).toBe(1);
    expect(harness.catalogRecords.length).toBe(1);
    expect(harness.upsertedBindings.length).toBe(1);
    expect(harness.powerStarts).toEqual([
      [
        "context-request",
        TaskType.CONTEXT_GENERATION,
        "Generating context artifact",
      ],
    ]);
    expect(harness.powerCompletions).toEqual([
      ["context-request", "succeeded"],
    ]);
    await expect(access(harness.getRuntimeDirectory()!)).rejects.toThrow();
  });

  it("discards reviewed output without creating an artifact", async () => {
    const harness = createHarness();
    await harness.useCase.start(command(), harness.context);
    await harness.useCase.read("context-request", harness.context);

    const discarded = await harness.useCase.discard(
      "context-request",
      harness.context,
    );

    expect(discarded).toMatchObject({
      ok: true,
      value: { state: "discarded" },
    });
    expect(harness.stored.length).toBe(0);
    expect(harness.catalogRecords.length).toBe(0);
    await expect(access(harness.getRuntimeDirectory()!)).rejects.toThrow();
  });

  it("denies cross-workspace review and leaves the staged task private", async () => {
    const harness = createHarness();
    await harness.useCase.start(command(), harness.context);

    const result = await harness.useCase.read("context-request", {
      ...harness.context,
      workspaceId: createWorkspaceId("workspace.other"),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });

  it("compensates stored bytes when catalog append fails", async () => {
    const harness = createHarness({ appendFails: true });
    await harness.useCase.start(command(), harness.context);
    await harness.useCase.read("context-request", harness.context);

    const result = await harness.useCase.save(
      "context-request",
      harness.context,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "internal", message: "catalog unavailable" },
    });
    expect(harness.deleted).toEqual([
      "generated/context/context-artifact-1/Release-knowledge.sqlite3",
    ]);
  });

  it("compensates catalog and stored bytes when binding creation fails", async () => {
    const harness = createHarness({ bindingFails: true });
    await harness.useCase.start(command(), harness.context);
    await harness.useCase.read("context-request", harness.context);

    const result = await harness.useCase.save(
      "context-request",
      harness.context,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "internal", message: "binding unavailable" },
    });
    expect(harness.deletedCatalogRecords).toEqual([
      "generated/context/context-artifact-1/Release-knowledge.sqlite3",
    ]);
    expect(harness.deleted).toEqual([
      "generated/context/context-artifact-1/Release-knowledge.sqlite3",
    ]);
  });

  it("rejects changed runtime output and cleans the private staging directory", async () => {
    const harness = createHarness({ outputDigestMismatch: true });
    await harness.useCase.start(command(), harness.context);

    const result = await harness.useCase.read(
      "context-request",
      harness.context,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "internal",
        message: "Context runtime output digest does not match.",
      },
    });
    await expect(access(harness.getRuntimeDirectory()!)).rejects.toThrow();
  });
});
