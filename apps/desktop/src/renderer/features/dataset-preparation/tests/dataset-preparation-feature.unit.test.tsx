import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";
import { resetDatasetPreparationPageStateForTests } from "../hooks/useDatasetPreparationFeature";

const settingsClient = {
  listDefinitions: vi.fn(),
  readSettings: vi.fn().mockResolvedValue({ values: [] }),
  updateSetting: vi.fn(),
  clearSetting: vi.fn(),
  resolveModelDefault: vi.fn().mockResolvedValue({
    resolved: {
      provider: "transformers",
      modelId: "google/flan-t5-base",
      inferenceMode: "text2text",
      source: "global",
      device: "auto",
    },
  }),
};

describe("DatasetPreparationFeature", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = undefined;
    container = undefined;
    resetDatasetPreparationPageStateForTests();
    delete window.desktopApi;
  });

  it("constructs request, shows loading, and renders success output summary", async () => {
    const startPrepareTrainingDataset = vi.fn().mockImplementation(async () => {
      await Promise.resolve();
      return {
        ok: true,
        value: {
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
              generation: { mode: "qa", model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" } },
            },
            split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
            output: { format: "parquet" },
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
      };
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={settingsClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({ ok: true, value: {
              outputs: { local: { dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } } } },
              provenance: { sourceArtifactIds: ["artifact-1"], recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 1000, chunkOverlap: 200 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } } }, split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true }, output: { format: "parquet" }, generationModelId: "google/flan-t5-base", summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } },
              summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 },
            } }),
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Dataset preparation model defaults");
    const modelOverridesToggle = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Model override defaults"));
    await act(async () => {
      modelOverridesToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Inference mode");

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(startPrepareTrainingDataset).toHaveBeenCalledWith(expect.objectContaining({
      sourceArtifactIds: ["artifact-1"],
      recipe: {
        normalization: {
          targetFormat: "markdown",
          normalizationMode: undefined,
          unsupportedDocumentPolicy: undefined,
        },
        chunking: {
          strategy: "character",
          chunkSize: 1000,
          chunkOverlap: 200,
          preserveDocumentBoundaries: true,
          maxChunkCount: undefined,
        },
        generation: {
          mode: "qa",
            model: {
              provider: "transformers",
              modelId: "google/flan-t5-base",
              inferenceMode: "text2text",
              device: "auto",
              torchDtype: undefined,
            },
          maxExamplesPerChunk: 4,
          batchSize: 4,
          failurePolicy: "skip",
          generationParams: {
            temperature: undefined,
            topP: undefined,
            maxNewTokens: undefined,
          },
        },
      },
      output: {
        format: "parquet",
        naming: { baseName: undefined },
        destinations: {
          local: { enabled: true },
          huggingFace: undefined,
        },
      },
    }), expect.objectContaining({
      requestId: expect.stringMatching(/^dataset-preparation-/),
    }));
    expect(settingsClient.resolveModelDefault).toHaveBeenCalled();
    expect(container.textContent).toContain("stored-dataset");
  });

  it("shows error state when preparation fails", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async () => ({ ok: false, error: { code: "internal", message: "failed" } }),
          }}
        />,
      );
    });

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("failed");
  });

  it("uses default Hugging Face namespace when only dataset repository name is provided", async () => {
    settingsClient.readSettings.mockResolvedValueOnce({
      values: [{ key: "huggingface.defaultNamespace", value: "OpenFinAL" }],
    });
    const startPrepareTrainingDataset = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        outputs: {},
        provenance: {
          sourceArtifactIds: ["artifact-1"],
          recipe: {
            normalization: { targetFormat: "markdown" },
            chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
            generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } },
          },
          split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
          output: { format: "parquet" },
          generationModelId: "google/flan-t5-base",
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
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={settingsClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({ ok: true, value: {
              outputs: { local: { dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } } } },
              provenance: { sourceArtifactIds: ["artifact-1"], recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 1000, chunkOverlap: 200 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } } }, split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true }, output: { format: "parquet" }, generationModelId: "google/flan-t5-base", summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } },
              summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 },
            } }),
          }}
        />,
      );
    });

    const sourceCheckbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      sourceCheckbox.click();
    });

    const publishCheckbox = Array.from(container.querySelectorAll("input[type='checkbox']"))
      .find((input) => (input.parentElement?.textContent ?? "").includes("Publish to Hugging Face")) as HTMLInputElement;
    await act(async () => {
      publishCheckbox.click();
    });

    const repositoryInput = container.querySelector("input[placeholder='your-dataset-repo']") as HTMLInputElement;
    await act(async () => {
      repositoryInput.value = "AISysBuilderTest";
      repositoryInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("Namespace: OpenFinAL");
  });

  it("shows model download progress from Python runtime logs while preparation is running", async () => {
    let resolvePreparation: ((value: { ok: true; value: any }) => void) | undefined;
    const startPrepareTrainingDataset = vi.fn(() => new Promise<{ ok: true; value: any }>((resolve) => {
      resolvePreparation = resolve;
    }));
    const runtimeStatusClient = {
      readStatus: vi.fn().mockResolvedValue({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        loadedModels: [],
        activeTaskCount: 1,
        logs: [{
          timestamp: new Date(Date.now() + 1_000).toISOString(),
          level: "warn",
          message: "Python runtime stderr: Fetching 14 files: 43%|####2 | 6/14 [00:00<00:00, 11.15it/s]",
        }],
      }),
      controlRuntime: vi.fn(),
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={settingsClient}
          runtimeStatusClient={runtimeStatusClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({ ok: true, value: {
              outputs: { local: { dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } } } },
              provenance: { sourceArtifactIds: ["artifact-1"], recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 1000, chunkOverlap: 200 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } } }, split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true }, output: { format: "parquet" }, generationModelId: "google/flan-t5-base", summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } },
              summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 },
            } }),
          }}
        />,
      );
    });

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Downloading model google/flan-t5-base: 43% (6/14 files).");

    await act(async () => {
      resolvePreparation?.({
        ok: true,
        value: {
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
              generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } },
            },
            split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
            output: { format: "parquet" },
            generationModelId: "google/flan-t5-base",
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
      });
      await Promise.resolve();
    });
  });

  it("shows stop training while preparation is active and stops the Python runtime", async () => {
    let rejectPreparation: ((error: Error) => void) | undefined;
    const startPrepareTrainingDataset = vi.fn(() => new Promise<any>((_resolve, reject) => {
      rejectPreparation = reject;
    }));
    const runtimeStatusClient = {
      readStatus: vi.fn().mockResolvedValue({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        loadedModels: [],
        activeTaskCount: 1,
        logs: [],
      }),
      controlRuntime: vi.fn().mockResolvedValue({
        supervisorStatus: "stopped",
        healthy: false,
        runtimeStatus: "stopped",
        capabilities: [],
        loadedModels: [],
        activeTaskCount: 0,
        logs: [],
      }),
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={settingsClient}
          runtimeStatusClient={runtimeStatusClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({ ok: true, value: {
              outputs: { local: { dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } } } },
              provenance: { sourceArtifactIds: ["artifact-1"], recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 1000, chunkOverlap: 200 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } } }, split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true }, output: { format: "parquet" }, generationModelId: "google/flan-t5-base", summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } },
              summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 },
            } }),
          }}
        />,
      );
    });

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Stop training");

    const stopButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Stop training") as HTMLButtonElement;
    await act(async () => {
      stopButton.click();
      await Promise.resolve();
    });

    expect(runtimeStatusClient.controlRuntime).toHaveBeenCalledWith("stop");

    await act(async () => {
      rejectPreparation?.(new Error("runtime stopped"));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Training stopped.");
  });

  it("keeps loading status when transport fails but runtime task is still active", async () => {
    vi.useFakeTimers();
    try {
      let readCount = 0;
      let requestId: string | undefined;
      const runtimeStatusClient = {
        readStatus: vi.fn().mockImplementation(async () => {
          readCount += 1;
          const activeTaskCount = readCount < 4 ? 1 : 0;
          const processedChunkCount = readCount < 3 ? 4 : 5;
          return {
            supervisorStatus: "ready",
            healthy: true,
            runtimeStatus: "ready",
            capabilities: ["prepare-training-dataset"],
            loadedModels: [],
            activeTaskCount,
            logs: activeTaskCount > 0 ? [{
              timestamp: new Date(Date.now() + readCount * 1000).toISOString(),
              level: "info" as const,
              message: JSON.stringify({
                event: "runtime.dataset_preparation.generation.progress",
                requestId,
                processedChunkCount,
                totalChunkCount: 162,
              }),
            }, {
              timestamp: new Date(Date.now() + readCount * 1000 + 10).toISOString(),
              level: "info" as const,
              message: JSON.stringify({
                event: activeTaskCount > 0
                  ? "runtime.dataset_preparation.task.started"
                  : "runtime.dataset_preparation.task.succeeded",
                requestId,
              }),
            }] : [{
              timestamp: new Date(Date.now() + readCount * 1000).toISOString(),
              level: "info" as const,
              message: JSON.stringify({
                event: "runtime.dataset_preparation.task.succeeded",
                requestId,
              }),
            }],
          };
        }),
        controlRuntime: vi.fn(),
      };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

      await act(async () => {
        root?.render(
          <DatasetPreparationFeature
            runtimeStatusClient={runtimeStatusClient}
            client={{
              browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async (_input, context) => {
              requestId = context?.requestId;
              throw new Error("fetch failed");
            },
          }}
          />,
        );
        await Promise.resolve();
      });

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("fetch failed");

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });

      expect(container.textContent).toContain("Dataset preparation completed in Python runtime after reconnecting");
      expect(runtimeStatusClient.readStatus.mock.calls.length).toBeGreaterThan(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers when matching progress appears after initial empty runtime status", async () => {
    vi.useFakeTimers();
    try {
      let requestId: string | undefined;
      let readCount = 0;
      const runtimeStatusClient = {
        readStatus: vi.fn().mockImplementation(async () => {
          readCount += 1;
          if (readCount < 3) {
            return {
              supervisorStatus: "ready",
              healthy: true,
              runtimeStatus: "ready",
              capabilities: ["prepare-training-dataset"],
              loadedModels: [],
              activeTaskCount: 0,
              logs: [],
            };
          }

          return {
            supervisorStatus: "ready",
            healthy: true,
            runtimeStatus: "ready",
            capabilities: ["prepare-training-dataset"],
            loadedModels: [],
            activeTaskCount: 1,
            logs: [{
              timestamp: new Date(Date.now() + readCount * 1000).toISOString(),
              level: "info" as const,
              message: JSON.stringify({
                event: "runtime.dataset_preparation.generation.progress",
                requestId,
                processedChunkCount: 4,
                totalChunkCount: 100,
              }),
            }],
          };
        }),
        controlRuntime: vi.fn(),
      };

      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <DatasetPreparationFeature
            runtimeStatusClient={runtimeStatusClient}
            client={{
              browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
              startPrepareTrainingDataset: async (_input, context) => {
                requestId = context?.requestId;
                throw new Error("fetch failed");
              },
            }}
          />,
        );
        await Promise.resolve();
      });

      const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      expect(container.textContent).not.toContain("fetch failed");

      await act(async () => {
        vi.advanceTimersByTime(2_500);
        await Promise.resolve();
      });

      expect(container.textContent).toContain("Processing chunk 5/100");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not treat unrelated active runtime tasks as matching dataset preparation during recovery", async () => {
    vi.useFakeTimers();
    try {
    const runtimeStatusClient = {
      readStatus: vi.fn().mockImplementation(async () => ({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        loadedModels: [],
        activeTaskCount: 1,
        logs: [{
          timestamp: new Date().toISOString(),
          level: "info" as const,
          message: JSON.stringify({
            event: "runtime.dataset_preparation.task.started",
            requestId: "different-request",
          }),
        }],
      })),
      controlRuntime: vi.fn(),
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          runtimeStatusClient={runtimeStatusClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async () => {
              throw new Error("fetch failed");
            },
          }}
        />,
      );
      await Promise.resolve();
    });

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Reconnecting to runtime progress");
    expect(container.textContent).not.toContain("still running in the background");
    expect(container.textContent).not.toContain("fetch failed");

    await act(async () => {
      vi.advanceTimersByTime(121_000);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("could not be recovered");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows recovery failure when matching dataset preparation task fails", async () => {
    vi.useFakeTimers();
    try {
    let capturedRequestId: string | undefined;
    const runtimeStatusClient = {
      readStatus: vi.fn().mockImplementation(async () => ({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        loadedModels: [],
        activeTaskCount: 0,
        logs: [{
          timestamp: new Date().toISOString(),
          level: "error" as const,
          message: JSON.stringify({
            event: "runtime.dataset_preparation.task.failed",
            requestId: capturedRequestId,
            status: "failed",
            error: { message: "runtime generation exploded" },
          }),
        }],
      })),
      controlRuntime: vi.fn(),
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          runtimeStatusClient={runtimeStatusClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async (_input, context) => {
              capturedRequestId = context?.requestId;
              throw new Error("fetch failed");
            },
          }}
        />,
      );
      await Promise.resolve();
    });

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("runtime generation exploded");
    expect(container.textContent).not.toContain("fetch failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows stopped state when matching recovered task is cancelled", async () => {
    let capturedRequestId: string | undefined;
    const runtimeStatusClient = {
      readStatus: vi.fn().mockImplementation(async () => ({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        loadedModels: [],
        activeTaskCount: 0,
        logs: [{
          timestamp: new Date().toISOString(),
          level: "warn" as const,
          message: JSON.stringify({
            event: "runtime.dataset_preparation.task.cancelled",
            requestId: capturedRequestId,
            status: "cancelled",
          }),
        }],
      })),
      controlRuntime: vi.fn(),
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          runtimeStatusClient={runtimeStatusClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async (_input, context) => {
              capturedRequestId = context?.requestId;
              throw new Error("fetch failed");
            },
          }}
        />,
      );
      await Promise.resolve();
    });

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Training stopped.");
  });

  it("shows non-transient transport errors as failures", async () => {
    const runtimeStatusClient = {
      readStatus: vi.fn().mockResolvedValue({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        loadedModels: [],
        activeTaskCount: 1,
        logs: [],
      }),
      controlRuntime: vi.fn(),
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          runtimeStatusClient={runtimeStatusClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async () => {
              throw new Error("permission denied");
            },
          }}
        />,
      );
      await Promise.resolve();
    });

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("permission denied");
    expect(container.textContent).not.toContain("fetch failed");
  });

  it("uses a single recovery polling loop after transient disconnect", async () => {
    vi.useFakeTimers();
    try {
      const runtimeStatusClient = {
        readStatus: vi.fn().mockResolvedValue({
          supervisorStatus: "ready",
          healthy: true,
          runtimeStatus: "ready",
          capabilities: ["prepare-training-dataset"],
          loadedModels: [],
          activeTaskCount: 0,
          logs: [],
        }),
        controlRuntime: vi.fn(),
      };

      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <DatasetPreparationFeature
            runtimeStatusClient={runtimeStatusClient}
            client={{
              browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
              startPrepareTrainingDataset: async () => {
                throw new Error("fetch failed");
              },
            }}
          />,
        );
      });

      const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });

      expect(runtimeStatusClient.readStatus.mock.calls.length).toBeLessThanOrEqual(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains in-progress status and locks form controls across remounts", async () => {
    let resolvePreparation: ((value: { ok: true; value: any }) => void) | undefined;
    const startPrepareTrainingDataset = vi.fn(() => new Promise<{ ok: true; value: any }>((resolve) => {
      resolvePreparation = resolve;
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={settingsClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({ ok: true, value: {
              outputs: { local: { dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } } } },
              provenance: { sourceArtifactIds: ["artifact-1"], recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 1000, chunkOverlap: 200 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } } }, split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true }, output: { format: "parquet" }, generationModelId: "google/flan-t5-base", summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } },
              summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 },
            } }),
          }}
        />,
      );
    });

    const modelOverridesToggle = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Model override defaults")) as HTMLButtonElement;
    await act(async () => {
      modelOverridesToggle.click();
    });
    expect(container.textContent).toContain("Inference mode");

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Stop training");
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      root?.unmount();
    });
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={settingsClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({ ok: true, value: {
              outputs: { local: { dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } } } },
              provenance: { sourceArtifactIds: ["artifact-1"], recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 1000, chunkOverlap: 200 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } } }, split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true }, output: { format: "parquet" }, generationModelId: "google/flan-t5-base", summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } },
              summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 },
            } }),
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Checking model");
    expect(container.textContent).toContain("Stop training");
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolvePreparation?.({
        ok: true,
        value: {
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
              generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } },
            },
            split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
            output: { format: "parquet" },
            generationModelId: "google/flan-t5-base",
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
      });
      await Promise.resolve();
    });
  });

  it("shows reconnecting status after progress poll failure and recovers chunk progress updates", async () => {
    vi.useFakeTimers();
    let resolvePreparation: ((value: { ok: true; value: any }) => void) | undefined;
    let requestId: string | undefined;
    const startPrepareTrainingDataset = vi.fn(() => new Promise<{ ok: true; value: any }>((resolve) => {
      resolvePreparation = resolve;
    }));
    const runtimeStatusClient = {
      readStatus: vi.fn()
        .mockResolvedValueOnce({
          supervisorStatus: "ready",
          healthy: true,
          runtimeStatus: "ready",
          capabilities: ["prepare-training-dataset"],
          loadedModels: [],
          activeTaskCount: 0,
          logs: [],
        })
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValue({
          supervisorStatus: "ready",
          healthy: true,
          runtimeStatus: "ready",
          capabilities: ["prepare-training-dataset"],
          loadedModels: [],
          activeTaskCount: 1,
          logs: [{
            timestamp: new Date().toISOString(),
            level: "info" as const,
            message: JSON.stringify({
              event: "runtime.dataset_preparation.generation.progress",
              requestId,
              processedChunkCount: 1,
              totalChunkCount: 4,
            }),
          }],
        }),
      controlRuntime: vi.fn(),
    };

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <DatasetPreparationFeature
            runtimeStatusClient={runtimeStatusClient}
            client={{
              browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
              startPrepareTrainingDataset: async (input, context) => {
                requestId = context?.requestId;
                return startPrepareTrainingDataset(input, context);
              },
            }}
          />,
        );
        await Promise.resolve();
      });

      const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      expect(container.textContent).toContain("Reconnecting to progress monitor...");

      await act(async () => {
        vi.advanceTimersByTime(800);
        await Promise.resolve();
      });
      expect(container.textContent).toContain("Reconnecting to progress monitor...");

      await act(async () => {
        resolvePreparation?.({
          ok: true,
          value: {
            outputs: {},
            provenance: {
              sourceArtifactIds: ["artifact-1"],
              recipe: {
                normalization: { targetFormat: "markdown" },
                chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
                generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } },
              },
              split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
              output: { format: "parquet" },
              generationModelId: "google/flan-t5-base",
              summary: {
                sourceDocumentCount: 1,
                normalizedDocumentCount: 1,
                skippedDocumentCount: 0,
                chunkCount: 4,
                generatedExampleCount: 4,
                datasetRowCount: 4,
                trainRowCount: 3,
                testRowCount: 1,
              },
            },
            summary: {
              sourceDocumentCount: 1,
              normalizedDocumentCount: 1,
              skippedDocumentCount: 0,
              chunkCount: 4,
              generatedExampleCount: 4,
              datasetRowCount: 4,
              trainRowCount: 3,
              testRowCount: 1,
            },
          },
        });
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not run duplicate runtime polling loops during transport recovery", async () => {
    vi.useFakeTimers();
    try {
      let capturedRequestId: string | undefined;
      const runtimeStatusClient = {
        readStatus: vi.fn().mockImplementation(async () => ({
          supervisorStatus: "ready",
          healthy: true,
          runtimeStatus: "ready",
          capabilities: ["prepare-training-dataset"],
          loadedModels: [],
          activeTaskCount: 1,
          logs: [{
            timestamp: new Date().toISOString(),
            level: "info" as const,
            message: JSON.stringify({
              event: "runtime.dataset_preparation.generation.progress",
              requestId: capturedRequestId,
              processedChunkCount: 1,
              totalChunkCount: 10,
            }),
          }],
        })),
        controlRuntime: vi.fn(),
      };

      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          <DatasetPreparationFeature
            runtimeStatusClient={runtimeStatusClient}
            client={{
              browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
              startPrepareTrainingDataset: async (_input, context) => {
                capturedRequestId = context?.requestId;
                throw new Error("fetch failed");
              },
            }}
          />,
        );
        await Promise.resolve();
      });

      const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(2_500);
        await Promise.resolve();
      });

      expect(runtimeStatusClient.readStatus.mock.calls.length).toBeLessThanOrEqual(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows unload model when a model is loaded and no training is active", async () => {
    const runtimeStatusClient = {
      readStatus: vi.fn().mockResolvedValue({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset", "unload-model"],
        loadedModels: [{
          provider: "transformers" as const,
          modelId: "google/flan-t5-base",
          inferenceMode: "text2text" as const,
          localPath: "/models/google/flan-t5-base",
        }],
        activeTaskCount: 0,
        logs: [],
      }),
      controlRuntime: vi.fn().mockResolvedValue({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset", "unload-model"],
        loadedModels: [],
        activeTaskCount: 0,
        logs: [],
      }),
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          runtimeStatusClient={runtimeStatusClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async () => ({ ok: false, error: { code: "internal", message: "failed" } }),
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Unload model");

    const unloadButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Unload model") as HTMLButtonElement;
    await act(async () => {
      unloadButton.click();
      await Promise.resolve();
    });

    expect(runtimeStatusClient.controlRuntime).toHaveBeenCalledWith("unload-model");
    expect(container.textContent).toContain("Model unloaded from memory.");
  });

  it("surfaces warning when model default settings resolution fails", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={{
            ...settingsClient,
            resolveModelDefault: vi.fn().mockRejectedValue(new Error("settings failed")),
          }}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async () => ({ ok: false, error: { code: "internal", message: "failed" } }),
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Using built-in model defaults because settings could not be loaded.");
  });

  it("surfaces warning when Hugging Face namespace settings cannot be read", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={{
            ...settingsClient,
            readSettings: vi.fn().mockRejectedValue(new Error("read failed")),
          }}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async () => ({ ok: false, error: { code: "internal", message: "failed" } }),
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Hugging Face namespace default could not be loaded.");
  });

  it("keeps submit behavior stable when rerendered with a new options object shape", async () => {
    const startPrepareTrainingDataset = vi.fn().mockResolvedValue({
      ok: true,
      value: {
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
            generation: { mode: "qa", model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" } },
          },
          split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
          output: { format: "parquet" },
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
    });
    const onPrepared = vi.fn();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          onPrepared={onPrepared}
          settingsClient={settingsClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({ ok: true, value: {
              outputs: { local: { dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } } } },
              provenance: { sourceArtifactIds: ["artifact-1"], recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 1000, chunkOverlap: 200 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } } }, split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true }, output: { format: "parquet" }, generationModelId: "google/flan-t5-base", summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } },
              summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 },
            } }),
          }}
        />,
      );
    });

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          onPrepared={onPrepared}
          settingsClient={settingsClient}
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({ ok: true, value: {
              outputs: { local: { dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } } } },
              provenance: { sourceArtifactIds: ["artifact-1"], recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 1000, chunkOverlap: 200 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "google/flan-t5-base" } } }, split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true }, output: { format: "parquet" }, generationModelId: "google/flan-t5-base", summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } },
              summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 },
            } }),
          }}
        />,
      );
    });

    const checkbox = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(startPrepareTrainingDataset).toHaveBeenCalledTimes(1);
    expect(onPrepared).toHaveBeenCalledTimes(1);
  });

  it("does not continue polling updates after unmount during in-flight task read", async () => {
    let resolveRead: ((value: unknown) => void) | undefined;
    const readPrepareTrainingDatasetTask = vi.fn(() => new Promise((resolve) => {
      resolveRead = resolve;
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          client={{
            browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
            startPrepareTrainingDataset: async (_input, context) => ({ ok: true, value: { requestId: context?.requestId ?? "req-1", acceptedAt: new Date().toISOString() } }),
            readPrepareTrainingDatasetTask: readPrepareTrainingDatasetTask as never,
          }}
        />,
      );
    });
    await act(async () => { (container?.querySelector("input[type='checkbox']") as HTMLInputElement).click(); });
    await act(async () => { (container?.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(readPrepareTrainingDatasetTask).toHaveBeenCalledTimes(1);
    await act(async () => { root?.unmount(); });
    await act(async () => {
      resolveRead?.({ ok: true, status: "running", progress: { message: "still running", processed: 1, total: 4 } });
      await Promise.resolve();
    });
  });

  it("does not clear cached active request id when unmounting during reconnect sleep", async () => {
    vi.useFakeTimers();
    try {
      const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValue({ ok: false, error: { message: "fetch failed" } });
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(<DatasetPreparationFeature client={{
          browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
          startPrepareTrainingDataset: async (_input, context) => ({ ok: true, value: { requestId: context?.requestId ?? "req-1", acceptedAt: new Date().toISOString() } }),
          readPrepareTrainingDatasetTask,
        }} />);
      });
      await act(async () => { (container?.querySelector("input[type='checkbox']") as HTMLInputElement).click(); });
      await act(async () => { (container?.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(container?.textContent).toContain("Reconnecting to dataset preparation task...");
      await act(async () => { root?.unmount(); });
      root = createRoot(container as HTMLDivElement);
      await act(async () => {
        root?.render(<DatasetPreparationFeature client={{
          browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
          startPrepareTrainingDataset: async () => ({ ok: false, error: { code: "internal", message: "unused" } }),
          readPrepareTrainingDatasetTask: async () => ({ ok: true, status: "running", progress: { message: "running" } }),
        }} />);
      });
      expect(container?.textContent).toContain("Stop training");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes active dataset preparation progress after page remount", async () => {
    vi.useFakeTimers();
    try {
      const readPrepareTrainingDatasetTask = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: "running",
          progress: { message: "Processing chunk", processed: 1, total: 4 },
        })
        .mockResolvedValue({
          ok: true,
          status: "running",
          progress: { message: "Processing chunk", processed: 2, total: 4 },
        });

      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(<DatasetPreparationFeature client={{
          browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
          startPrepareTrainingDataset: async (_input, context) => ({ requestId: context?.requestId ?? "req-1" }),
          readPrepareTrainingDatasetTask,
          cancelPrepareTrainingDatasetTask: async () => ({ ok: true }),
        }} />);
      });

      await act(async () => { (container?.querySelector("input[type='checkbox']") as HTMLInputElement).click(); });
      await act(async () => {
        (container?.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      expect(container?.textContent).toContain("Processing chunk (1/4)");

      await act(async () => { root?.unmount(); });
      root = createRoot(container as HTMLDivElement);
      await act(async () => {
        root?.render(<DatasetPreparationFeature client={{
          browseSourceArtifacts: async () => [{ artifactId: "artifact-1", label: "artifact-1.jsonl", storageKey: "uploads/artifact-1.jsonl" }],
          startPrepareTrainingDataset: async () => ({ error: { code: "unused", message: "unused" } }),
          readPrepareTrainingDatasetTask,
          cancelPrepareTrainingDatasetTask: async () => ({ ok: true }),
        }} />);
        await Promise.resolve();
      });

      expect(container?.textContent).toContain("Processing chunk (2/4)");
      expect(container?.textContent).not.toContain("Training stopped.");
      expect(readPrepareTrainingDatasetTask).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
