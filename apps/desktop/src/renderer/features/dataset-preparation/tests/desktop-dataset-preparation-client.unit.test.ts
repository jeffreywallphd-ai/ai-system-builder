import { describe, expect, it, vi } from "vitest";

import { createDesktopDatasetPreparationClient } from "../api/desktopDatasetPreparationClient";

describe("desktop dataset preparation client", () => {
  it("maps success response from preload bridge", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    hostWindow.window ??= {} as Window & typeof globalThis;
    const startPrepareTrainingDataset = vi.fn().mockResolvedValue({ ok: true, value: { requestId: "req-123" } });
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        result: {
          outputs: {
            local: {
              dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } },
            },
          },
          provenance: {
            sourceArtifactIds: ["artifact-1"],
            recipe: {
              normalization: { targetFormat: "markdown" },
              chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
              generation: {
                mode: "qa",
                model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" },
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
      browseArtifacts: async () => ({ ok: true, value: { items: [{ artifactId: "artifact-1", storageKey: "stored/a1.jsonl", artifactFamily: "structured-text" }] } }),
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
    const browseResult = await client.browseSourceArtifacts();
    const started = await client.startPrepareTrainingDataset({
      sourceArtifactIds: ["artifact-1"],
      recipe: {
        normalization: { targetFormat: "markdown" },
        chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
        generation: {
          mode: "qa",
          model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" },
          promptTemplate: "Prompt: {{text}}",
        },
      },
      split: { trainRatio: 0.8, testRatio: 0.2 },
      output: { format: "jsonl" },
    }, {
      requestId: "req-123",
    });

    expect(browseResult).toEqual([{ artifactId: "artifact-1", label: "stored/a1.jsonl", storageKey: "stored/a1.jsonl" }]);
    expect(started).toEqual({ requestId: "req-123" });
    const response = await client.readPrepareTrainingDatasetTask("req-123");
    expect(response.ok).toBe(true);
    expect(startPrepareTrainingDataset).toHaveBeenCalledWith(expect.any(Object), { requestId: "req-123" });
  });

  it("maps failure response from preload bridge", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
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
      startPrepareTrainingDataset: async () => ({ ok: false, error: { code: "validation", message: "bad input" } }),
    };

    const client = createDesktopDatasetPreparationClient();
    const started = await client.startPrepareTrainingDataset({
      sourceArtifactIds: [],
      recipe: {
        normalization: { targetFormat: "markdown" },
        chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
        generation: {
          mode: "qa",
          model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" },
          promptTemplate: "",
        },
      },
      split: { trainRatio: 0.8, testRatio: 0.2 },
      output: { format: "jsonl" },
    });

    expect(started).toEqual({ error: { code: "validation", message: "bad input" } });
  });

  it("preserves clear runtime start failure message and details", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
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
          message: "Python runtime could not be started before dataset preparation.",
          details: { cause: "supervisor unavailable" },
        },
      }),
    };

    const client = createDesktopDatasetPreparationClient();
    const started = await client.startPrepareTrainingDataset({
      sourceArtifactIds: ["artifact-1"],
      recipe: {
        normalization: { targetFormat: "markdown" },
        chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
        generation: {
          mode: "qa",
          model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" },
          promptTemplate: "Prompt",
        },
      },
      split: { trainRatio: 0.8, testRatio: 0.2 },
      output: { format: "jsonl" },
    });

    expect(started).toEqual({
      error: {
        code: "internal",
        message: "Python runtime could not be started before dataset preparation.",
        details: { cause: "supervisor unavailable" },
      },
    });
  });


  it("does not fall back to storageKey when artifactId is missing from browse items", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({
        ok: true,
        value: { items: [{ storageKey: "stored/a1.jsonl", artifactFamily: "structured-text" }] },
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

    await expect(client.browseSourceArtifacts()).rejects.toThrow(
      "Artifact browse item is missing artifactId.",
    );
  });

  it("throws when browse items are missing storageKey", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    hostWindow.window ??= {} as Window & typeof globalThis;
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }),
      getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({
        ok: true,
        value: { items: [{ artifactId: "artifact-1", artifactFamily: "structured-text" }] },
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

    await expect(client.browseSourceArtifacts()).rejects.toThrow(
      "Artifact browse item is missing storageKey.",
    );
  });

  it("normalizes transient transport errors from preload requests", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
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

    await expect(client.startPrepareTrainingDataset({
      sourceArtifactIds: ["artifact-1"],
      recipe: {
        normalization: { targetFormat: "markdown" },
        chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
        generation: {
          mode: "qa",
          model: { provider: "transformers", modelId: "google/flan-t5-base" },
          promptTemplate: "Prompt: {{text}}",
        },
      },
      split: { trainRatio: 0.8, testRatio: 0.2 },
      output: { format: "jsonl" },
    })).rejects.toThrow("fetch failed");
  });

  it("maps task read statuses with discriminated status values", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    hostWindow.window ??= {} as Window & typeof globalThis;
    const readPrepareTrainingDatasetTask = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { status: "running", progress: { message: "step", processed: 1, total: 2 } } })
      .mockResolvedValueOnce({ ok: true, value: { status: "cancelled" } })
      .mockResolvedValueOnce({ ok: true, value: { status: "unknown" } })
      .mockResolvedValueOnce({ ok: true, value: { status: "failed", error: { message: "boom" } } });
    hostWindow.window.desktopApi = {
      uploadArtifact: async () => ({ ok: false }), getArtifactUploadPolicy: async () => ({ ok: false }),
      browseArtifacts: async () => ({ ok: true, value: { items: [] } }), readArtifactDetail: async () => ({ ok: false }),
      readArtifactContentDescriptor: async () => ({ ok: false }), readArtifactViewerMedia: async () => ({ ok: false }),
      publishArtifactToRepo: async () => ({ ok: false }), verifyPublishedArtifactBacking: async () => ({ ok: false }),
      registerArtifactFromRepo: async () => ({ ok: false }), localizeArtifactFromRepo: async () => ({ ok: false }),
      startPrepareTrainingDataset: async () => ({ ok: true, value: { requestId: "req" } }), readPrepareTrainingDatasetTask,
    };
    const client = createDesktopDatasetPreparationClient();
    await expect(client.readPrepareTrainingDatasetTask("req")).resolves.toMatchObject({ ok: true, status: "running" });
    await expect(client.readPrepareTrainingDatasetTask("req")).resolves.toMatchObject({ ok: true, status: "cancelled" });
    await expect(client.readPrepareTrainingDatasetTask("req")).resolves.toMatchObject({ ok: true, status: "unknown" });
    await expect(client.readPrepareTrainingDatasetTask("req")).resolves.toMatchObject({ ok: false, error: { code: "failed", message: "boom" } });
  });
});
