import { describe, expect, it, vi } from "vitest";

import { createDesktopDatasetPreparationClient } from "../api/desktopDatasetPreparationClient";
import { createFilesystemArtifactBrowserReadAdapter } from "../../../../../../../modules/adapters/storage/filesystem/artifact-store/createFilesystemArtifactBrowserReadAdapter";
import { BrowseArtifactsUseCase } from "../../../../../../../modules/application/use-cases/browse-artifacts.use-case";
import { ReadArtifactDetailUseCase } from "../../../../../../../modules/application/use-cases/read-artifact-detail.use-case";

describe("desktop dataset preparation client", () => {
  const makeReplayClient = (readArtifactDetail = vi.fn(async () => ({ ok: true, value: { artifact: { locator: { storageKey: "uploads/source.csv" }, originalName: "source.csv", mediaType: "text/csv" } } }))) => {
    const host = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    host.window ??= {} as Window & typeof globalThis;
    host.window.desktopApi = { readArtifactDetail } as never;
    return { client: createDesktopDatasetPreparationClient(), readArtifactDetail };
  };
  const reference = { artifactId: "uploads/source.csv", storageKey: "uploads/source.csv" };
  it("resolves exact key-derived source identity with explicit workspace and fixed sequential reads", async () => {
    let active = 0, peak = 0;
    const read = vi.fn(async (locator: { storageKey: string }) => {
      peak = Math.max(peak, ++active); await Promise.resolve(); --active;
      return { ok: true, value: { artifact: { locator, originalName: "source.csv", mediaType: "text/csv" } } };
    });
    const { client } = makeReplayClient(read as never);
    const refs = Array.from({ length: 100 }, (_, i) => ({ artifactId: `uploads/source-${i}.csv`, storageKey: `uploads/source-${i}.csv` }));
    const rows = await client.readReplaySourceArtifacts!("workspace-a", refs, () => true);
    expect(rows).toHaveLength(100); expect(peak).toBe(1);
    expect(rows[99].artifactId).toBe(refs[99].storageKey);
    expect(read.mock.calls.every((call: any) => call[1].workspaceId === "workspace-a")).toBe(true);
  });
  it.each([[], Array(101).fill(reference), [reference, reference], [{ ...reference, artifactId: "legacy-id" }], [{ ...reference, storageKey: "../source.csv" }]])("rejects invalid reference set before any metadata read", async refs => {
    const { client, readArtifactDetail } = makeReplayClient();
    await expect(client.readReplaySourceArtifacts!("workspace-a", refs, () => true)).rejects.toThrow("Saved source files could not be confirmed in this workspace.");
    expect(readArtifactDetail).not.toHaveBeenCalled();
  });
  it.each([undefined, { ok: false, error: { message: "private source detail" } }, { ok: true, value: {} }, { ok: true, value: { artifact: { locator: { storageKey: "other/source.csv" } } } }, { ok: true, value: { artifact: { locator: { storageKey: reference.storageKey }, mediaType: {} } } }])("rejects missing, denied, changed-key or malformed replies with fixed safe copy", async response => {
    const { client } = makeReplayClient(vi.fn(async () => response) as never);
    await expect(client.readReplaySourceArtifacts!("workspace-a", [reference], () => true)).rejects.toThrow("Saved source files could not be confirmed in this workspace.");
  });
  it("captures reference scalars and stops after a stale reply without reading another key", async () => {
    let resolve!: (value: any) => void, current = true;
    const read = vi.fn(() => new Promise<any>(yes => { resolve = yes; }));
    const { client } = makeReplayClient(read as never);
    const refs = [{ ...reference }, { artifactId: "uploads/next.csv", storageKey: "uploads/next.csv" }];
    const pending = client.readReplaySourceArtifacts!("workspace-a", refs, () => current);
    refs[1].artifactId = refs[1].storageKey = "uploads/mutated.csv";
    current = false; resolve({ ok: true, value: { artifact: { locator: { storageKey: reference.storageKey } } } });
    await expect(pending).rejects.toThrow("Saved source files could not be confirmed in this workspace.");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("uses captured keys after caller mutation while the first lookup is pending", async () => {
    let resolve!: (value: any) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<any>(yes => { resolve = yes; })).mockImplementation(async (locator: any) => ({ ok: true, value: { artifact: { locator } } }));
    const { client } = makeReplayClient(read as never);
    const refs = [{ ...reference }, { artifactId: "uploads/next.csv", storageKey: "uploads/next.csv" }];
    const pending = client.readReplaySourceArtifacts!("workspace-a", refs, () => true);
    refs[1].artifactId = refs[1].storageKey = "uploads/mutated.csv";
    resolve({ ok: true, value: { artifact: { locator: { storageKey: reference.storageKey } } } });
    expect((await pending)[1].artifactId).toBe("uploads/next.csv"); expect(read.mock.calls[1][0]).toEqual({ storageKey: "uploads/next.csv" });
  });
  it("bounds the whole metadata batch to15 seconds without claiming IPC cancellation", async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (value: any) => void;
      const read = vi.fn(() => new Promise<any>(yes => { resolve = yes; })); const { client } = makeReplayClient(read as never);
      const pending = client.readReplaySourceArtifacts!("workspace-a", [reference, { artifactId: "uploads/next.csv", storageKey: "uploads/next.csv" }], () => true);
      const denied = expect(pending).rejects.toThrow("Saved source files could not be confirmed in this workspace.");
      await vi.advanceTimersByTimeAsync(15_001); await denied; expect(read).toHaveBeenCalledTimes(1);
      resolve({ ok: true, value: { artifact: { locator: { storageKey: reference.storageKey } } } }); await Promise.resolve();
      expect(read).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("uses the real capped adapter/use cases and exact-key client to resolve a source older than the first250", async () => {
    const records = Array.from({ length: 251 }, (_, index) => ({ storageKey: `uploads/source-${index}.csv`, artifactFamily: "tabular", mediaType: "text/csv", originalName: `source-${index}.csv`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), sourceKind: "upload" }));
    const reads: string[] = [];
    const catalog = {
      browseArtifactCatalogRecords: async (_request: any, context: any) => ({ ok: true, value: { records: context.workspaceId === "workspace-a" ? records : [] } }),
      readArtifactCatalogRecord: async (request: any, context: any) => {
        reads.push(context.workspaceId); const record = context.workspaceId === "workspace-a" ? records.find(row => row.storageKey === request.storageKey) : undefined;
        return record ? { ok: true, value: { record } } : { ok: false, error: { code: "not-found", message: "Synthetic missing source" } };
      },
    };
    const adapter = createFilesystemArtifactBrowserReadAdapter({ rootDirectory: ".", artifactCatalogRead: catalog, artifactCatalogAppend: {} } as never);
    const workspaceRepository = { readWorkspace: async (id: string) => ({ id, status: "active" }) };
    const authority = vi.fn(async (request: any) => { if (request.workspace.id !== "workspace-a") throw new Error("Denied fixture workspace"); });
    const deps = { artifactBrowserMetadataRead: adapter, workspaceRepository, workspaceAuthorization: { authorizeWorkspaceOperation: authority } } as never;
    const browse = new BrowseArtifactsUseCase(deps), detail = new ReadArtifactDetailUseCase(deps);
    const readArtifactDetail = vi.fn((locator: any, context: any) => detail.execute({ locator }, context));
    const { client } = makeReplayClient(readArtifactDetail as never);
    (window.desktopApi as any).browseArtifacts = (input: any) => browse.execute({}, { workspaceId: input.workspaceId });
    const page = await client.browseSourceArtifacts("workspace-a");
    expect(page).toHaveLength(250); expect(page.some(row => row.storageKey === records[0].storageKey)).toBe(false);
    const refs = [{ artifactId: records[0].storageKey, storageKey: records[0].storageKey }];
    expect(await client.readReplaySourceArtifacts!("workspace-a", refs, () => true)).toEqual([{ artifactId: records[0].storageKey, storageKey: records[0].storageKey, label: records[0].originalName, mediaType: "text/csv" }]);
    expect(reads).toEqual(["workspace-a"]);
    expect(authority.mock.calls.some(([request]) => request.operation === "artifact.detail.read" && request.requiredScopes.includes("artifact:read"))).toBe(true);
    await expect(client.readReplaySourceArtifacts!("workspace-b", refs, () => true)).rejects.toThrow("Saved source files could not be confirmed in this workspace.");
    expect(reads).toEqual(["workspace-a"]);
  });
  it("rejects malformed source-list envelopes and preserves a genuinely empty result", async () => {
    const host = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    host.window ??= {} as Window & typeof globalThis;
    const browseArtifacts = vi.fn();
    host.window.desktopApi = { browseArtifacts } as never;
    const client = createDesktopDatasetPreparationClient();
    for (const value of [undefined, null, {}, { items: null }, { items: "invalid" }]) {
      browseArtifacts.mockResolvedValueOnce({ ok: true, value });
      await expect(client.browseSourceArtifacts("workspace-a")).rejects.toThrow("Source file list is incomplete.");
    }
    browseArtifacts.mockResolvedValueOnce({ ok: true, value: { items: [] } });
    expect(await client.browseSourceArtifacts("workspace-a")).toEqual([]);
  });
  it("rejects malformed version lists instead of reporting a successful empty history", async () => {
    const host = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    host.window ??= {} as Window & typeof globalThis;
    const listDatasetVersions = vi.fn();
    host.window.desktopApi = { listDatasetVersions } as never;
    const client = createDesktopDatasetPreparationClient();
    for (const value of [undefined, {}, { versions: null }, { versions: "invalid" }]) {
      listDatasetVersions.mockResolvedValueOnce({ ok: true, value });
      await expect(client.listVersions!("workspace-a")).rejects.toThrow("Dataset version history is incomplete.");
    }
    listDatasetVersions.mockResolvedValueOnce({ ok: true, value: { versions: [] } });
    expect(await client.listVersions!("workspace-a")).toEqual([]);
  });
  it("preserves cancellation truth and rejects substituted or inconsistent replies", async () => {
    const host = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    host.window ??= {} as Window & typeof globalThis;
    const cancelPrepareTrainingDatasetTask = vi.fn();
    host.window.desktopApi = { cancelPrepareTrainingDatasetTask } as never;
    const client = createDesktopDatasetPreparationClient();
    for (const value of [
      { requestId: "task", cancelled: false, status: "running" },
      { requestId: "task", cancelled: false, status: "unknown" },
      { requestId: "task", cancelled: true, status: "cancelled" },
    ]) {
      cancelPrepareTrainingDatasetTask.mockResolvedValueOnce({ ok: true, value });
      expect(await client.cancelPrepareTrainingDatasetTask("task", "workspace-a")).toEqual({ ok: true, value });
    }
    for (const value of [undefined, {}, { requestId: "other", cancelled: true, status: "cancelled" },
      { requestId: "task", cancelled: true, status: "running" }, { requestId: "task", cancelled: false, status: "cancelled" }]) {
      cancelPrepareTrainingDatasetTask.mockResolvedValueOnce({ ok: true, value });
      expect(await client.cancelPrepareTrainingDatasetTask("task", "workspace-a")).toMatchObject({ ok: false });
    }
    expect(cancelPrepareTrainingDatasetTask).toHaveBeenCalledWith({ requestId: "task", workspaceId: "workspace-a" });
  });

  it("maps success response from preload bridge", async () => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    const startPrepareTrainingDataset = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { requestId: "req-123" } });
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        result: {
          outputs: {
            local: {
              dataset: {
                sourceKind: "runtime",
                storage: {
                  key: "stored-dataset",
                  mediaType: "application/x-ndjson",
                  sizeBytes: 10,
                },
              },
            },
          },
          provenance: {
            sourceArtifactIds: ["artifact-1"],
            recipe: {
              normalization: { targetFormat: "markdown" },
              chunking: {
                strategy: "character",
                chunkSize: 1_000,
                chunkOverlap: 200,
              },
              generation: {
                mode: "qa",
                model: {
                  provider: "transformers",
                  modelId: "Qwen/Qwen2.5-1.5B-Instruct",
                },
              },
            },
            split: { trainRatio: 0.8, testRatio: 0.2 },
            output: { format: "jsonl" },
            generationModelId: "Qwen/Qwen2.5-1.5B-Instruct",
            summary: {
              sourceDocumentCount: 1,
              normalizedDocumentCount: 1,
              skippedDocumentCount: 0,
              chunkCount: 2,
              generatedExampleCount: 10,
              datasetRowCount: 10,
              trainRowCount: 10,
              testRowCount: 0,
            },
          },
          summary: {
            sourceDocumentCount: 1,
            normalizedDocumentCount: 1,
            skippedDocumentCount: 0,
            chunkCount: 2,
            generatedExampleCount: 10,
            datasetRowCount: 10,
            trainRowCount: 10,
            testRowCount: 0,
          },
        },
      },
    });

    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({
        ok: true,
        value: {
          items: [
            {
              artifactId: "artifact-1",
              storageKey:
                "workspaces/workspace-1/artifacts/files/uploads/a1.jsonl",
              artifactFamily: "structured-text",
              mediaType: "application/x-ndjson",
              sourceKind: "upload",
            },
          ],
        },
      }),
      readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }),
      readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }),
      verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }),
      localizeArtifactFromRepo: async () => ({ ok: false }),
      startPrepareTrainingDataset,
      readPrepareTrainingDatasetTask,
    };

    const client = createDesktopDatasetPreparationClient();
    const browseResult = await client.browseSourceArtifacts("workspace-1");
    const started = await client.startPrepareTrainingDataset(
      {
        sourceArtifactIds: ["artifact-1"],
        recipe: {
          normalization: { targetFormat: "markdown" },
          chunking: {
            strategy: "character",
            chunkSize: 1_000,
            chunkOverlap: 200,
          },
          generation: {
            mode: "qa",
            model: {
              provider: "transformers",
              modelId: "Qwen/Qwen2.5-1.5B-Instruct",
            },
            promptTemplate: "Prompt: {{text}}",
          },
        },
        split: { trainRatio: 0.8, testRatio: 0.2 },
        output: { format: "jsonl" },
      },
      {
        requestId: "req-123",
      },
    );

    expect(browseResult).toEqual([
      {
        artifactId: "artifact-1",
        label: "workspaces/workspace-1/artifacts/files/uploads/a1.jsonl",
        storageKey: "workspaces/workspace-1/artifacts/files/uploads/a1.jsonl",
        mediaType: "application/x-ndjson",
        sourceKind: "upload",
      },
    ]);
    expect(started).toEqual({ requestId: "req-123" });
    const response = await client.readPrepareTrainingDatasetTask("req-123");
    expect(response.ok).toBe(true);
    expect(startPrepareTrainingDataset).toHaveBeenCalledWith(
      expect.any(Object),
      { requestId: "req-123" },
    );
  });

  it("maps failure response from preload bridge", async () => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({ ok: true, value: { items: [] } }),
      readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }),
      readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }),
      verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }),
      localizeArtifactFromRepo: async () => ({ ok: false }),
      startPrepareTrainingDataset: async () => ({
        ok: false,
        error: { code: "validation", message: "bad input" },
      }),
    };

    const client = createDesktopDatasetPreparationClient();
    const started = await client.startPrepareTrainingDataset({
      sourceArtifactIds: [],
      recipe: {
        normalization: { targetFormat: "markdown" },
        chunking: {
          strategy: "character",
          chunkSize: 1_000,
          chunkOverlap: 200,
        },
        generation: {
          mode: "qa",
          model: {
            provider: "transformers",
            modelId: "Qwen/Qwen2.5-1.5B-Instruct",
          },
          promptTemplate: "",
        },
      },
      split: { trainRatio: 0.8, testRatio: 0.2 },
      output: { format: "jsonl" },
    });

    expect(started).toEqual({
      error: { code: "validation", message: "bad input" },
    });
  });

  it("preserves clear runtime start failure message and details", async () => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({ ok: true, value: { items: [] } }),
      readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }),
      readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }),
      verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }),
      localizeArtifactFromRepo: async () => ({ ok: false }),
      startPrepareTrainingDataset: async () => ({
        ok: false,
        error: {
          code: "internal",
          message:
            "Python runtime could not be started before dataset preparation.",
          details: { cause: "supervisor unavailable" },
        },
      }),
    };

    const client = createDesktopDatasetPreparationClient();
    const started = await client.startPrepareTrainingDataset({
      sourceArtifactIds: ["artifact-1"],
      recipe: {
        normalization: { targetFormat: "markdown" },
        chunking: {
          strategy: "character",
          chunkSize: 1_000,
          chunkOverlap: 200,
        },
        generation: {
          mode: "qa",
          model: {
            provider: "transformers",
            modelId: "Qwen/Qwen2.5-1.5B-Instruct",
          },
          promptTemplate: "Prompt",
        },
      },
      split: { trainRatio: 0.8, testRatio: 0.2 },
      output: { format: "jsonl" },
    });

    expect(started).toEqual({
      error: {
        code: "internal",
        message:
          "Python runtime could not be started before dataset preparation.",
        details: { cause: "supervisor unavailable" },
      },
    });
  });

  it("does not fall back to storageKey when artifactId is missing from browse items", async () => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({
        ok: true,
        value: {
          items: [
            {
              storageKey: "stored/a1.jsonl",
              artifactFamily: "structured-text",
            },
          ],
        },
      }),
      readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }),
      readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }),
      verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }),
      localizeArtifactFromRepo: async () => ({ ok: false }),
      startPrepareTrainingDataset: async () => ({ ok: false }),
    };

    const client = createDesktopDatasetPreparationClient();

    await expect(client.browseSourceArtifacts("workspace-1")).rejects.toThrow(
      "Artifact browse item is missing artifactId.",
    );
  });

  it("throws when browse items are missing storageKey", async () => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({
        ok: true,
        value: {
          items: [
            { artifactId: "artifact-1", artifactFamily: "structured-text" },
          ],
        },
      }),
      readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }),
      readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }),
      verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }),
      localizeArtifactFromRepo: async () => ({ ok: false }),
      startPrepareTrainingDataset: async () => ({ ok: false }),
    };

    const client = createDesktopDatasetPreparationClient();

    await expect(client.browseSourceArtifacts("workspace-1")).rejects.toThrow(
      "Artifact browse item is missing storageKey.",
    );
  });

  it("normalizes transient transport errors from preload requests", async () => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({ ok: true, value: { items: [] } }),
      readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }),
      readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }),
      verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }),
      localizeArtifactFromRepo: async () => ({ ok: false }),
      startPrepareTrainingDataset: async () => {
        throw new TypeError("Failed to fetch");
      },
    };

    const client = createDesktopDatasetPreparationClient();

    await expect(
      client.startPrepareTrainingDataset({
        sourceArtifactIds: ["artifact-1"],
        recipe: {
          normalization: { targetFormat: "markdown" },
          chunking: {
            strategy: "character",
            chunkSize: 1_000,
            chunkOverlap: 200,
          },
          generation: {
            mode: "qa",
            model: { provider: "transformers", modelId: "google/flan-t5-base" },
            promptTemplate: "Prompt: {{text}}",
          },
        },
        split: { trainRatio: 0.8, testRatio: 0.2 },
        output: { format: "jsonl" },
      }),
    ).rejects.toThrow("fetch failed");
  });

  it("maps task read statuses with discriminated status values", async () => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    const readPrepareTrainingDatasetTask = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          status: "running",
          progress: {
            message: "step",
            processed: 1,
            total: 2,
            details: {
              phase: "memory-overflow",
              memoryOverflowActive: true,
              estimatedMemoryOverflowBytes: 512 * 1024 ** 2,
              memoryOverflowLimitBytes: 1024 ** 3,
            },
          },
        },
      })
      .mockResolvedValueOnce({ ok: true, value: { status: "cancelled" } })
      .mockResolvedValueOnce({ ok: true, value: { status: "unknown" } })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          status: "failed",
          error: {
            code: "structured_output_settings_invalid",
            stage: "generation",
            message: "secret=/private/source",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          status: "failed",
          error: {
            code: "structured_source_read_failed",
            stage: "normalization",
            message: "C:\\private\\artifact.parquet could not be read",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          status: "failed",
          error: {
            code: "generation_runtime_dependency_unavailable",
            stage: "generation",
            message: "private runtime details",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          status: "failed",
          error: {
            code: "generation_model_load_failed",
            stage: "generation",
            message: "C:\\private\\cache\\token=secret",
          },
        },
      });
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({ ok: true, value: { items: [] } }),
      readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }),
      readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }),
      verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }),
      localizeArtifactFromRepo: async () => ({ ok: false }),
      startPrepareTrainingDataset: async () => ({
        ok: true,
        value: { requestId: "req" },
      }),
      readPrepareTrainingDatasetTask,
    };
    const client = createDesktopDatasetPreparationClient();
    await expect(
      client.readPrepareTrainingDatasetTask("req"),
    ).resolves.toMatchObject({
      ok: true,
      status: "running",
      progress: {
        phase: "memory-overflow",
        memoryOverflowActive: true,
        estimatedMemoryOverflowBytes: 512 * 1024 ** 2,
        memoryOverflowLimitBytes: 1024 ** 3,
      },
    });
    await expect(
      client.readPrepareTrainingDatasetTask("req"),
    ).resolves.toMatchObject({ ok: true, status: "cancelled" });
    await expect(
      client.readPrepareTrainingDatasetTask("req"),
    ).resolves.toMatchObject({ ok: true, status: "unknown" });
    const failed = await client.readPrepareTrainingDatasetTask("req");
    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: "structured_output_settings_invalid",
        message:
          "The desired output format needs review. Reset or correct it in Generation prompt, then retry.",
        details: {
          stage: "generation",
          reasonCode: "structured_output_settings_invalid",
        },
      },
    });
    expect(JSON.stringify(failed)).not.toContain("private/source");
    const structuredFailure =
      await client.readPrepareTrainingDatasetTask("req");
    expect(structuredFailure).toMatchObject({
      ok: false,
      error: {
        code: "structured_source_read_failed",
        message:
          "The selected structured file could not be read. Verify that it is a valid CSV, JSON, JSON Lines, or Parquet file, then retry.",
        details: {
          stage: "normalization",
          reasonCode: "structured_source_read_failed",
        },
      },
    });
    expect(JSON.stringify(structuredFailure)).not.toContain(
      "private\\artifact.parquet",
    );
    const dependencyFailure =
      await client.readPrepareTrainingDatasetTask("req");
    expect(dependencyFailure).toMatchObject({
      ok: false,
      error: {
        code: "generation_runtime_dependency_unavailable",
        message:
          "Local model generation needs repair. Restart the application to repair its managed components, then retry.",
        details: {
          stage: "generation",
          reasonCode: "generation_runtime_dependency_unavailable",
        },
      },
    });
    expect(JSON.stringify(dependencyFailure)).not.toContain(
      "private runtime details",
    );
    const modelLoadFailure = await client.readPrepareTrainingDatasetTask("req");
    expect(modelLoadFailure).toMatchObject({
      ok: false,
      error: {
        code: "generation_model_load_failed",
        message:
          "The selected model files could not be loaded. Verify or download the model again, or choose the compact model, then retry.",
        details: {
          stage: "generation",
          reasonCode: "generation_model_load_failed",
        },
      },
    });
    expect(JSON.stringify(modelLoadFailure)).not.toContain("private\\cache");
  });

  it.each([
    [
      "generation_model_download_incomplete",
      "The selected generation model download is incomplete. Resume the download in Step 3, then retry.",
    ],
    [
      "generation_constrained_decoding_failed",
      "Token-level JSON formatting could not complete with this model and desired output format. Review the format or turn off constrained decoding, then retry.",
    ],
    [
      "generation_constrained_decoding_unavailable",
      "Token-level JSON formatting is not available with the current local model tools. Restart after the tools are ready, or turn off Keep generated JSON well structured.",
    ],
    [
      "generation_constrained_decoding_truncated",
      "Token-level JSON formatting reached the output length limit. Increase Maximum new tokens or simplify the desired output format, then retry.",
    ],
    [
      "generation_output_invalid",
      "The model response did not match the desired output format. Review the Generation prompt and desired output format, then retry.",
    ],
    [
      "generation_inference_failed",
      "The selected model could not complete generation. Verify the model and available system resources, then retry.",
    ],
    [
      "generation_insufficient_resources",
      "The selected model cannot fit in the memory currently available. Close memory-heavy applications or select a smaller built-in model, then retry.",
    ],
  ])("maps %s to a safe actionable message", async (code, message) => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({ ok: true, value: { items: [] } }),
      readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }),
      readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }),
      verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }),
      localizeArtifactFromRepo: async () => ({ ok: false }),
      startPrepareTrainingDataset: async () => ({
        ok: true,
        value: { requestId: "req" },
      }),
      readPrepareTrainingDatasetTask: async () => ({
        ok: true,
        value: {
          status: "failed",
          error: {
            code,
            stage: "generation",
            message: "C:\\private\\cache\\token=secret",
          },
        },
      }),
    };

    const client = createDesktopDatasetPreparationClient();
    const result = await client.readPrepareTrainingDatasetTask("req");

    expect(result).toMatchObject({
      ok: false,
      error: {
        code,
        message,
        details: { stage: "generation", reasonCode: code },
      },
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it.each([
    [
      "ocr_unavailable",
      "ocr_unavailable",
      "Text recognition is unavailable. Choose an installed Windows recognition language, or turn off scanned-PDF recognition.",
      "normalization",
    ],
    [
      "ocr_input_invalid",
      "ocr_input_invalid",
      "The scanned PDF or its settings could not be verified. Select the source again and check the recognition language.",
      "normalization",
    ],
    [
      "ocr_unknown",
      "ocr_unknown",
      "Dataset preparation could not finish. Review the selected files and settings, then retry.",
      "normalization",
    ],
    [
      "ocr_unavailable/private",
      "task_failed",
      "Dataset preparation could not finish. Review the selected files and settings, then retry.",
      "normalization",
    ],
    [
      "ocr_unavailable",
      "ocr_unavailable",
      "Text recognition is unavailable. Choose an installed Windows recognition language, or turn off scanned-PDF recognition.",
      "private-stage",
    ],
  ])("safely projects OCR task failure case %# (%s)", async (inputCode, code, message, stage) => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    const previous = hostWindow.window.desktopApi;
    try {
      hostWindow.window.desktopApi = {
        ...previous,
        readPrepareTrainingDatasetTask: async () => ({
          ok: true,
          value: {
            status: "failed",
            error: {
              code: inputCode,
              stage,
              message: "C:\\private\\source.pdf token=secret prompt=private-content",
              details: { path: "private-content", diagnosticClass: "SupplierPrivateError" },
            },
          },
        }),
      } as never;
      const result = await createDesktopDatasetPreparationClient().readPrepareTrainingDatasetTask("ocr-task");
      expect(result).toEqual({
        ok: false,
        error: {
          code,
          message,
          ...(stage === "normalization" ? { details: { stage, reasonCode: code } } : {}),
        },
      });
      expect(JSON.stringify(result)).not.toMatch(/private|secret|SupplierPrivateError/);
    } finally {
      hostWindow.window.desktopApi = previous;
    }
  });

  it("maps workspace-bound dataset review bridge responses", async () => {
    const hostWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    hostWindow.window ??= {} as Window & typeof globalThis;
    const fingerprint = `sha256:${"c".repeat(64)}` as `sha256:${string}`;
    const listDatasetReviewTargets = vi.fn(async () => ({
      ok: true,
      value: { groups: [] },
    }));
    const readDatasetReviewPage = vi.fn(async () => ({
      ok: true,
      value: {
        page: {
          artifactKey: "dataset.parquet",
          page: 0,
          pageSize: 10,
          totalRows: 1,
          rows: [],
        },
      },
    }));
    const rejectDatasetReviewRow = vi.fn(async () => ({
      ok: true,
      value: {
        version: { versionId: "dataset:v2" },
        versionLabel: "1.1",
        rejectedRowIndex: 0,
      },
    }));
    const editDatasetReviewRow = vi.fn(async () => ({
      ok: true,
      value: {
        version: { versionId: "dataset:v3" },
        versionLabel: "1.2",
        editedRowIndex: 0,
      },
    }));
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({ ok: true, value: { items: [] } }),
      readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }),
      readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }),
      verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }),
      localizeArtifactFromRepo: async () => ({ ok: false }),
      listDatasetReviewTargets,
      readDatasetReviewPage,
      rejectDatasetReviewRow,
      editDatasetReviewRow,
    } as never;
    const client = createDesktopDatasetPreparationClient();

    await client.listReviewTargets!("workspace-review");
    await client.readReviewPage!({
      workspaceId: "workspace-review",
      artifactKey: "dataset.parquet",
      page: 0,
      pageSize: 10,
    });
    await client.rejectReviewRow!({
      workspaceId: "workspace-review",
      artifactKey: "dataset.parquet",
      rowIndex: 0,
      rowFingerprint: fingerprint,
    });
    await client.editReviewRow!({
      workspaceId: "workspace-review",
      artifactKey: "dataset.parquet",
      rowIndex: 0,
      rowFingerprint: fingerprint,
      values: { instruction: "Answer clearly." },
    });

    expect(listDatasetReviewTargets).toHaveBeenCalledWith({
      workspaceId: "workspace-review",
    });
    expect(readDatasetReviewPage).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 10 }),
    );
    expect(rejectDatasetReviewRow).toHaveBeenCalledWith(
      expect.objectContaining({ rowFingerprint: fingerprint }),
    );
    expect(editDatasetReviewRow).toHaveBeenCalledWith(
      expect.objectContaining({
        rowFingerprint: fingerprint,
        values: { instruction: "Answer clearly." },
      }),
    );
  });
  it("formats only validated memory facts from task errors", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    hostWindow.window ??= {} as Window & typeof globalThis;
    const previous = hostWindow.window.desktopApi;
    try {
      hostWindow.window.desktopApi = { ...previous, readPrepareTrainingDatasetTask: async () => ({ ok: true, value: { status: "failed", error: {
        code: "generation_insufficient_resources", stage: "generation", message: "private-fixture",
        memoryShortfall: { resource: "ram", requiredBytes: 3758096384, availableBytes: 3503902720, allowedOverflowBytes: 0, path: "private-fixture" },
      } } }) } as any;
      const result = await createDesktopDatasetPreparationClient().readPrepareTrainingDatasetTask("memory-task");
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).toContain("Free at least 243 MiB of RAM");
      expect(JSON.stringify(result)).not.toContain("private-fixture");
    } finally { hostWindow.window.desktopApi = previous; }
  });

});
