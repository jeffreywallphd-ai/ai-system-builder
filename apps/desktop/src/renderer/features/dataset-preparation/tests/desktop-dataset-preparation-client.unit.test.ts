import { describe, expect, it, vi } from "vitest";

import { createDesktopDatasetPreparationClient } from "../api/desktopDatasetPreparationClient";

describe("desktop dataset preparation client", () => {
  it("maps success response from preload bridge", async () => {
    const hostWindow = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
    hostWindow.window ??= {} as Window & typeof globalThis;
    const prepareTrainingDatasetFromArtifacts = vi.fn().mockResolvedValue({
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
      prepareTrainingDatasetFromArtifacts,
    };

    const client = createDesktopDatasetPreparationClient();
    const browseResult = await client.browseSourceArtifacts();
    const response = await client.prepareTrainingDatasetFromArtifacts({
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

    expect(browseResult).toEqual([{ artifactId: "artifact-1", label: "stored/a1.jsonl" }]);
    expect(response.ok).toBe(true);
    expect(prepareTrainingDatasetFromArtifacts).toHaveBeenCalledWith(expect.any(Object), { requestId: "req-123" });
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
      prepareTrainingDatasetFromArtifacts: async () => ({ ok: false, error: { code: "validation", message: "bad input" } }),
    };

    const client = createDesktopDatasetPreparationClient();
    const response = await client.prepareTrainingDatasetFromArtifacts({
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

    expect(response).toEqual({
      ok: false,
      error: { code: "validation", message: "bad input" },
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
      prepareTrainingDatasetFromArtifacts: async () => ({ ok: false }),
    };

    const client = createDesktopDatasetPreparationClient();

    await expect(client.browseSourceArtifacts()).rejects.toThrow(
      "Artifact browse item is missing artifactId.",
    );
  });
});
