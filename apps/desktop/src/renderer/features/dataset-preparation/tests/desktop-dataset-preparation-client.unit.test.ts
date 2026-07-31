import { describe, expect, it, vi } from "vitest";

import { createDesktopDatasetPreparationClient } from "../api/desktopDatasetPreparationClient";

describe("desktop dataset preparation client", () => {
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
});
