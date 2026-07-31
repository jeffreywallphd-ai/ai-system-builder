import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatasetPreparationFeature as DatasetPreparationFeatureComponent } from "../components/DatasetPreparationFeature";
import { resetDatasetPreparationPageStateForTests } from "../hooks/useDatasetPreparationFeature";
import {
  NotificationProvider,
  NotificationViewport,
} from "../../../../../../../modules/ui/shared";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function DatasetPreparationFeature(
  props: ComponentProps<typeof DatasetPreparationFeatureComponent>,
) {
  return (
    <DatasetPreparationFeatureComponent workspaceId="workspace-a" {...props} />
  );
}

const settingsClient = {
  listDefinitions: vi.fn(),
  readSettings: vi.fn().mockResolvedValue({ values: [] }),
  updateSetting: vi.fn(),
  clearSetting: vi.fn(),
  resolveModelDefault: vi.fn().mockResolvedValue({
    resolved: {
      provider: "transformers",
      modelId: "Qwen/Qwen2.5-7B-Instruct",
      inferenceMode: "text2text",
      source: "global",
      device: "auto",
    },
  }),
};

async function flushAsyncWork(iterations = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
}

function successfulDatasetResult(datasetKey = "stored-dataset") {
  return {
    outputs: {
      local: {
        dataset: {
          sourceKind: "runtime",
          storage: { key: datasetKey },
        },
      },
    },
    provenance: {},
    summary: {
      sourceDocumentCount: 1,
      normalizedDocumentCount: 1,
      skippedDocumentCount: 0,
      chunkCount: 1,
      generatedExampleCount: 1,
      datasetRowCount: 1,
      trainRowCount: 1,
      validationRowCount: 0,
      testRowCount: 0,
    },
  };
}

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
    const startPrepareTrainingDataset = vi
      .fn()
      .mockResolvedValue({ requestId: "task-1" });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={settingsClient}
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({
              ok: true,
              status: "succeeded",
              value: {
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
                      chunkSize: 1000,
                      chunkOverlap: 200,
                    },
                    generation: {
                      mode: "qa",
                      model: {
                        provider: "transformers",
                        modelId: "Qwen/Qwen2.5-7B-Instruct",
                      },
                    },
                  },
                  split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
                  output: { format: "parquet" },
                  generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
            }),
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Instruction tuning");
    expect(container.textContent).not.toContain("Available now");
    expect(container.textContent).not.toContain(
      "models.tasks.qaGeneration.default",
    );
    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const formattingToggle = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Generation prompt"));
    await act(async () => {
      formattingToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(container.textContent).toContain("Inference mode");
    expect(container.textContent).toContain("System prompt instructions");
    expect(container.textContent).toContain("Desired output format");
    expect(container.textContent).toContain("JSON output preview");
    expect(container.textContent).toContain("Advanced structure preview");
    const attributionLabel = Array.from(
      container.querySelectorAll("label"),
    ).find((label) =>
      label.textContent?.includes(
        "Include source attribution with each example",
      ),
    ) as HTMLLabelElement;
    await act(async () => {
      (attributionLabel.querySelector("input") as HTMLInputElement).click();
    });
    expect(container.textContent).toContain(
      "Source attribution added automatically",
    );

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });

    expect(startPrepareTrainingDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceArtifactIds: ["artifact-1"],
        preparation: {
          schemaVersion: "1",
          inputIntent: "create-from-source-material",
          method: "topic-aware",
          sourceKinds: ["document"],
          generationMode: "task-examples",
        },
        advanced: expect.objectContaining({
          preset: "topic-aware",
          content: expect.objectContaining({
            strategy: "semantic",
            maxTokensPerChunk: 320,
            semanticBoundaryThreshold: 0.22,
          }),
          semantic: expect.objectContaining({
            similarityThreshold: 0.9,
          }),
        }),
        quality: expect.objectContaining({
          policy: expect.objectContaining({
            includeSourceAttribution: true,
          }),
        }),
        recipe: expect.objectContaining({
          task: {
            taskType: "llm-instruction",
            textInputMode: "generate",
            promptStyle: "instruction-response",
            inputField: "input",
            outputField: "output",
            sourceContextPolicy: "include",
          },
          normalization: {
            targetFormat: "markdown",
            normalizationMode: undefined,
            unsupportedDocumentPolicy: undefined,
          },
          generation: expect.objectContaining({
            mode: "qa",
            promptTemplate: expect.stringContaining("instruction-tuning"),
            model: {
              provider: "transformers",
              modelId: "Qwen/Qwen2.5-7B-Instruct",
              inferenceMode: "chat",
              device: "auto",
              torchDtype: "auto",
              memoryOverflowPolicy: "limited",
            },
            batchSize: 4,
            failurePolicy: "skip",
            generationParams: {
              temperature: 0.7,
              topP: 0.8,
              maxNewTokens: 512,
            },
            structuredOutput: expect.objectContaining({
              constrainedDecoding: false,
              visualShape: expect.objectContaining({
                schemaVersion: "1",
                taskType: "llm-instruction",
              }),
            }),
          }),
        }),
        output: {
          format: "parquet",
          naming: { baseName: undefined },
          destinations: {
            local: { enabled: true },
            huggingFace: undefined,
          },
        },
      }),
      expect.objectContaining({
        requestId: expect.stringMatching(/^dataset-preparation-/),
      }),
    );
    expect(
      startPrepareTrainingDataset.mock.calls[0]?.[0].recipe.chunking,
    ).toBeUndefined();
    expect(container.textContent).toContain("stored-dataset");
  });

  it("saves and loads workflow settings from the unnumbered section", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
                mediaType: "text/markdown",
              },
            ],
            startPrepareTrainingDataset: async () => ({
              ok: false,
              error: { code: "internal", message: "failed" },
            }),
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Training settings");
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save training settings",
    ) as HTMLButtonElement;
    expect(saveButton).toBeTruthy();
    expect(saveButton.disabled).toBe(true);

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const formattingToggle = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("Generation prompt"),
    ) as HTMLButtonElement;
    await act(async () => {
      formattingToggle.click();
    });

    const modelPresetSelect = Array.from(
      container.querySelectorAll("select"),
    ).find((select) =>
      Array.from(select.options).some(
        (option) => option.value === "compact-3b",
      ),
    ) as HTMLSelectElement;
    await act(async () => {
      modelPresetSelect.value = "compact-3b";
      modelPresetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(saveButton.disabled).toBe(false);
    await act(async () => {
      saveButton.click();
    });

    expect(container.textContent).toContain("Saved training settings");

    await act(async () => {
      modelPresetSelect.value = "quality-7b";
      modelPresetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const savedSettingsSelect = Array.from(
      container.querySelectorAll("select"),
    ).find((select) =>
      Array.from(select.options).some((option) =>
        option.textContent?.includes("llm instruction settings"),
      ),
    ) as HTMLSelectElement;
    const savedOption = Array.from(savedSettingsSelect.options).find(
      (option) => option.value.length > 0,
    );
    expect(savedOption).toBeTruthy();
    await act(async () => {
      savedSettingsSelect.value = savedOption?.value ?? "";
      savedSettingsSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const loadButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Load settings",
    ) as HTMLButtonElement;
    await act(async () => {
      loadButton.click();
    });

    const modelIdInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "Qwen/Qwen2.5-3B-Instruct",
    ) as HTMLInputElement | undefined;
    expect(modelIdInput).toBeTruthy();
    expect(container.textContent).not.toContain("Training settings loaded.");
  });

  it("shows supported text sources and only renders task settings when needed", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          client={
            {
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-json",
                  label: "examples.json",
                  storageKey: "uploads/examples.json",
                  mediaType: "application/json",
                },
                {
                  artifactId: "artifact-pdf",
                  label: "guide.pdf",
                  storageKey: "uploads/guide.pdf",
                  mediaType: "application/pdf",
                },
              ],
              startPrepareTrainingDataset: async () => ({
                ok: false,
                error: { code: "internal", message: "not used" },
              }),
            } as any
          }
        />,
      );
    });

    expect(container.textContent).toContain(
      "Accepted text sources: .csv, .json, .jsonl/.ndjson",
    );
    expect(container.textContent).toContain(
      "Convert legacy .doc files to .docx and Excel .xls/.xlsx files to .csv",
    );
    expect(container.textContent).toContain("examples.json");
    expect(container.textContent).toContain("guide.pdf");
    expect(container.textContent).not.toContain("Task settings");

    const taskSelect = Array.from(container.querySelectorAll("select")).find(
      (select) =>
        Array.from(select.options).some(
          (option) => option.value === "llm-classification",
        ),
    ) as HTMLSelectElement;
    await act(async () => {
      taskSelect.value = "llm-classification";
      taskSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Task settings");
    const taskSettingsToggle = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Task settings"));
    await act(async () => {
      taskSettingsToggle?.click();
    });
    expect(container.textContent).toContain("Allowed labels");
  });

  it("opens the notification card when a model download is started", async () => {
    const downloadModel = vi.fn(() => new Promise<never>(() => undefined));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <NotificationProvider>
          <DatasetPreparationFeatureComponent
            workspaceId="workspace-a"
            modelsClient={
              {
                listModels: async () => [],
                downloadModel,
              } as any
            }
            client={{
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                  mediaType: "text/markdown",
                },
              ],
              startPrepareTrainingDataset: async () => ({
                ok: false,
                error: { code: "internal", message: "not used" },
              }),
            }}
          />
          <NotificationViewport />
        </NotificationProvider>,
      );
    });

    await act(async () => {
      (
        container?.querySelector("input[type='checkbox']") as HTMLInputElement
      ).click();
    });
    const exampleCreation = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Generation prompt"));
    await act(async () => {
      exampleCreation?.click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const downloadButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Download model");
    expect(
      downloadButton?.closest(".dataset-preparation__advanced-settings"),
    ).toBeNull();
    await act(async () => {
      downloadButton?.click();
      await flushAsyncWork();
    });

    expect(downloadModel).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Notifications",
    );
  });

  it("offers model repair when a persisted downloaded record fails runtime validation", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeatureComponent
          workspaceId="workspace-a"
          modelsClient={
            {
              listModels: async () => [
                {
                  modelRecordId: "model-record-1",
                  workspaceId: "workspace-a",
                  displayName: "Qwen 7B",
                  source: "huggingface",
                  lifecycleStatus: "downloaded",
                  artifactForm: "full-model",
                  provider: "huggingface",
                  modelId: "Qwen/Qwen2.5-7B-Instruct",
                  createdAt: "2026-07-31T00:00:00.000Z",
                },
              ],
              downloadModel: vi.fn(),
            } as any
          }
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
                mediaType: "text/markdown",
              },
            ],
            startPrepareTrainingDataset: async () => ({
              ok: true,
              requestId: "request-model-repair",
            }),
            readPrepareTrainingDatasetTask: async () => ({
              ok: false,
              error: {
                code: "generation_model_load_failed",
                message:
                  "The selected model files could not be loaded. Verify or download the model again, or choose the compact model, then retry.",
              },
            }),
          }}
        />,
      );
      await flushAsyncWork();
    });

    await act(async () => {
      (
        container?.querySelector("input[type='checkbox']") as HTMLInputElement
      ).click();
    });
    expect(container.textContent).not.toContain("Download model");

    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Download model");
    expect(container.textContent).toContain(
      "The selected model files could not be loaded.",
    );
  });

  it("shows error state when preparation fails", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset: async () => ({
              ok: false,
              error: { code: "internal", message: "failed" },
            }),
          }}
        />,
      );
    });

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).toContain("failed");
  });

  it("saves locally first and defers provider publishing until after version creation", async () => {
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
            chunking: {
              strategy: "character",
              chunkSize: 1_000,
              chunkOverlap: 200,
            },
            generation: {
              mode: "qa",
              model: {
                provider: "transformers",
                modelId: "Qwen/Qwen2.5-7B-Instruct",
              },
            },
          },
          split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
          output: { format: "parquet" },
          generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({
              ok: true,
              value: {
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
                      chunkSize: 1000,
                      chunkOverlap: 200,
                    },
                    generation: {
                      mode: "qa",
                      model: {
                        provider: "transformers",
                        modelId: "Qwen/Qwen2.5-7B-Instruct",
                      },
                    },
                  },
                  split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
                  output: { format: "parquet" },
                  generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
            }),
          }}
        />,
      );
    });

    const sourceCheckbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      sourceCheckbox.click();
    });

    expect(container.textContent).not.toContain("Publish to Hugging Face");
    expect(container.textContent).toContain(
      "saved locally as a reusable version first",
    );

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    await vi.waitFor(() =>
      expect(startPrepareTrainingDataset).toHaveBeenCalledOnce(),
    );
    expect(startPrepareTrainingDataset.mock.calls[0]?.[0]).toMatchObject({
      output: { destinations: { local: { enabled: true } } },
    });
    expect(
      startPrepareTrainingDataset.mock.calls[0]?.[0].output.destinations
        .huggingFace,
    ).toBeUndefined();
  });

  it("defaults to the next smaller model on a tightly constrained machine", async () => {
    const runtimeStatusClient = {
      readStatus: vi.fn().mockResolvedValue({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        loadedModels: [],
        activeTaskCount: 0,
        generationCapacity: {
          schemaVersion: "1",
          capturedAt: new Date().toISOString(),
          decoderAvailable: false,
          schemaSupported: true,
          logicalProcessorCount: 20,
          totalSystemMemoryBytes: 16 * 1024 ** 3,
        },
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
          settingsClient={settingsClient}
          runtimeStatusClient={runtimeStatusClient}
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "source.pdf",
                storageKey: "uploads/source.pdf",
                mediaType: "application/pdf",
              },
            ],
            startPrepareTrainingDataset: vi.fn(),
            readPrepareTrainingDatasetTask: vi.fn(),
            cancelPrepareTrainingDatasetTask: vi.fn(),
            approvePreparedTrainingDataset: vi.fn(),
          }}
        />,
      );
      await flushAsyncWork();
    });

    const sourceCheckbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      sourceCheckbox.click();
      await flushAsyncWork();
    });

    const advancedToggle = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Advanced settings"));
    await act(async () => {
      advancedToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      const modelPreset = Array.from(
        container?.querySelectorAll("select") ?? [],
      ).find((select) =>
        Array.from(select.options).some(
          (option) => option.textContent === "Quality (7B)",
        ),
      );
      expect(modelPreset?.value).toBe("compact-3b");
      expect(
        Array.from(container?.querySelectorAll("input") ?? []).some(
          (input) => input.value === "Qwen/Qwen2.5-3B-Instruct",
        ),
      ).toBe(true);
      const memoryOverflow = Array.from(
        container?.querySelectorAll("select") ?? [],
      ).find((select) =>
        Array.from(select.options).some((option) =>
          option.textContent?.includes("Use a little disk space"),
        ),
      );
      expect(memoryOverflow?.value).toBe("limited");
      expect(
        Array.from(memoryOverflow?.options ?? []).map(
          (option) => option.value,
        ),
      ).toEqual(["limited", "none", "extended"]);
      const constrainedControl = Array.from(
        container?.querySelectorAll("label") ?? [],
      ).find((label) =>
        label.textContent?.includes("Keep generated JSON well structured"),
      );
      const constrainedCheckbox = constrainedControl?.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement | null;
      expect(constrainedCheckbox?.checked).toBe(false);
      expect(constrainedCheckbox?.disabled).toBe(true);
    });
  });

  it("defaults below Compact when current available memory cannot fit 3B", async () => {
    const runtimeStatusClient = {
      readStatus: vi.fn().mockResolvedValue({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        loadedModels: [],
        activeTaskCount: 0,
        generationCapacity: {
          schemaVersion: "1",
          capturedAt: new Date().toISOString(),
          decoderAvailable: false,
          schemaSupported: true,
          logicalProcessorCount: 20,
          totalSystemMemoryBytes: 16 * 1024 ** 3,
          availableSystemMemoryBytes: 5 * 1024 ** 3,
        },
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
          settingsClient={settingsClient}
          runtimeStatusClient={runtimeStatusClient}
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "source.pdf",
                storageKey: "uploads/source.pdf",
                mediaType: "application/pdf",
              },
            ],
            startPrepareTrainingDataset: vi.fn(),
            readPrepareTrainingDatasetTask: vi.fn(),
            cancelPrepareTrainingDatasetTask: vi.fn(),
            approvePreparedTrainingDataset: vi.fn(),
          }}
        />,
      );
      await flushAsyncWork();
    });

    const sourceCheckbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      sourceCheckbox.click();
      await flushAsyncWork();
    });

    await vi.waitFor(() => {
      const modelPreset = Array.from(
        container?.querySelectorAll("select") ?? [],
      ).find((select) =>
        Array.from(select.options).some(
          (option) => option.textContent === "Lightweight (1.5B)",
        ),
      );
      expect(modelPreset?.value).toBe("lightweight-1-5b");
      expect(
        Array.from(container?.querySelectorAll("input") ?? []).some(
          (input) => input.value === "Qwen/Qwen2.5-1.5B-Instruct",
        ),
      ).toBe(true);
    });
  });

  it("shows model download progress reported by the active dataset task", async () => {
    let resolvePreparation:
      ((value: { ok: true; value: any }) => void) | undefined;
    const startPrepareTrainingDataset = vi
      .fn()
      .mockResolvedValue({ requestId: "progress-task" });
    const runtimeStatusClient = {
      readStatus: vi.fn().mockResolvedValue({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        loadedModels: [],
        activeTaskCount: 1,
        logs: [
          {
            timestamp: new Date(Date.now() + 1_000).toISOString(),
            level: "warn",
            message:
              "Python runtime stderr: Fetching 14 files: 43%|####2 | 6/14 [00:00<00:00, 11.15it/s]",
          },
        ],
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
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({
              ok: true,
              status: "running",
              progress: {
                message:
                  "Downloading model Qwen/Qwen2.5-7B-Instruct: 43% (6/14 files).",
              },
              value: {
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
                      chunkSize: 1000,
                      chunkOverlap: 200,
                    },
                    generation: {
                      mode: "qa",
                      model: {
                        provider: "transformers",
                        modelId: "Qwen/Qwen2.5-7B-Instruct",
                      },
                    },
                  },
                  split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
                  output: { format: "parquet" },
                  generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
            }),
          }}
        />,
      );
    });

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
      await flushAsyncWork();
    });

    expect(container.textContent).toContain(
      "Downloading model Qwen/Qwen2.5-7B-Instruct: 43% (6/14 files).",
    );

    await act(async () => {
      resolvePreparation?.({
        ok: true,
        value: {
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
                  modelId: "Qwen/Qwen2.5-7B-Instruct",
                },
              },
            },
            split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
            output: { format: "parquet" },
            generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
      await flushAsyncWork();
    });
  });

  it("cancels active dataset preparation without stopping the shared Python runtime", async () => {
    let cancelled = false;
    const startPrepareTrainingDataset = vi
      .fn()
      .mockResolvedValue({ requestId: "stop-task" });
    const cancelPrepareTrainingDatasetTask = vi.fn(async () => {
      cancelled = true;
      return { ok: true as const };
    });
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
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset,
            cancelPrepareTrainingDatasetTask,
            readPrepareTrainingDatasetTask: async () => ({
              ok: true,
              status: cancelled ? "cancelled" : "running",
              value: {
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
                      chunkSize: 1000,
                      chunkOverlap: 200,
                    },
                    generation: {
                      mode: "qa",
                      model: {
                        provider: "transformers",
                        modelId: "Qwen/Qwen2.5-7B-Instruct",
                      },
                    },
                  },
                  split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
                  output: { format: "parquet" },
                  generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
            }),
          }}
        />,
      );
    });

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Stop training");

    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Stop training",
    ) as HTMLButtonElement;
    await act(async () => {
      stopButton.click();
      await flushAsyncWork();
    });

    expect(cancelPrepareTrainingDatasetTask).toHaveBeenCalledWith(
      "stop-task",
      "workspace-a",
    );
    expect(runtimeStatusClient.controlRuntime).not.toHaveBeenCalled();
    await vi.waitFor(
      () => expect(container.textContent).toContain("Training stopped."),
      { timeout: 2_000 },
    );
  });

  it("keeps loading status when transport fails but runtime task is still active", async () => {
    vi.useFakeTimers();
    try {
      let readCount = 0;
      let taskReadCount = 0;
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
            logs:
              activeTaskCount > 0
                ? [
                    {
                      timestamp: new Date(
                        Date.now() + readCount * 1000,
                      ).toISOString(),
                      level: "info" as const,
                      message: JSON.stringify({
                        event:
                          "runtime.dataset_preparation.generation.progress",
                        requestId,
                        processedChunkCount,
                        totalChunkCount: 162,
                      }),
                    },
                    {
                      timestamp: new Date(
                        Date.now() + readCount * 1000 + 10,
                      ).toISOString(),
                      level: "info" as const,
                      message: JSON.stringify({
                        event:
                          activeTaskCount > 0
                            ? "runtime.dataset_preparation.task.started"
                            : "runtime.dataset_preparation.task.succeeded",
                        requestId,
                      }),
                    },
                  ]
                : [
                    {
                      timestamp: new Date(
                        Date.now() + readCount * 1000,
                      ).toISOString(),
                      level: "info" as const,
                      message: JSON.stringify({
                        event: "runtime.dataset_preparation.task.succeeded",
                        requestId,
                      }),
                    },
                  ],
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
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async (_input, context) => {
                requestId = context?.requestId;
                throw new Error("fetch failed");
              },
              readPrepareTrainingDatasetTask: async () => {
                taskReadCount += 1;
                return taskReadCount < 2
                  ? {
                      ok: true as const,
                      status: "running" as const,
                      progress: {
                        message: "Preparing training dataset...",
                        processed: 4,
                        total: 162,
                      },
                    }
                  : {
                      ok: true as const,
                      status: "succeeded" as const,
                      value: successfulDatasetResult(),
                    };
              },
            }}
          />,
        );
        await flushAsyncWork();
      });

      const checkbox = container.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await flushAsyncWork();
      });

      expect(container.textContent).not.toContain("fetch failed");

      await act(async () => {
        vi.advanceTimersByTime(1_000);
        await flushAsyncWork();
      });

      expect(container.textContent).toContain("stored-dataset");
      expect(taskReadCount).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers when task progress appears after transient task-read failures", async () => {
    vi.useFakeTimers();
    try {
      let requestId: string | undefined;
      let readCount = 0;
      let taskReadCount = 0;
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
            logs: [
              {
                timestamp: new Date(
                  Date.now() + readCount * 1000,
                ).toISOString(),
                level: "info" as const,
                message: JSON.stringify({
                  event: "runtime.dataset_preparation.generation.progress",
                  requestId,
                  processedChunkCount: 4,
                  totalChunkCount: 100,
                }),
              },
            ],
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
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async (_input, context) => {
                requestId = context?.requestId;
                throw new Error("fetch failed");
              },
              readPrepareTrainingDatasetTask: async () => {
                taskReadCount += 1;
                if (taskReadCount < 3) {
                  return {
                    ok: false as const,
                    error: {
                      code: "transport",
                      message: "fetch failed",
                      details: { retryable: true },
                    },
                  };
                }
                return {
                  ok: true as const,
                  status: "running" as const,
                  progress: {
                    message: "Processing chunk 5/100",
                    processed: 5,
                    total: 100,
                  },
                };
              },
            }}
          />,
        );
        await flushAsyncWork();
      });

      const checkbox = container.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await flushAsyncWork();
      });

      expect(container.textContent).not.toContain("fetch failed");

      await act(async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          vi.advanceTimersByTime(800);
          await flushAsyncWork();
        }
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
          logs: [
            {
              timestamp: new Date().toISOString(),
              level: "info" as const,
              message: JSON.stringify({
                event: "runtime.dataset_preparation.task.started",
                requestId: "different-request",
              }),
            },
          ],
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
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async () => {
                throw new Error("fetch failed");
              },
              readPrepareTrainingDatasetTask: async () => ({
                ok: false as const,
                error: {
                  code: "transport",
                  message: "fetch failed",
                  details: { retryable: true },
                },
              }),
            }}
          />,
        );
        await flushAsyncWork();
      });

      const checkbox = container.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await flushAsyncWork();
      });

      expect(container.textContent).toContain(
        "Reconnecting to dataset preparation task",
      );
      expect(container.textContent).not.toContain(
        "still running in the background",
      );
      expect(container.textContent).not.toContain("fetch failed");

      await act(async () => {
        vi.advanceTimersByTime(31_000);
        await flushAsyncWork();
      });

      expect(container.textContent).toContain("fetch failed");
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
          logs: [
            {
              timestamp: new Date().toISOString(),
              level: "error" as const,
              message: JSON.stringify({
                event: "runtime.dataset_preparation.task.failed",
                requestId: capturedRequestId,
                status: "failed",
                error: { message: "runtime generation exploded" },
              }),
            },
          ],
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
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async (_input, context) => {
                capturedRequestId = context?.requestId;
                throw new Error("fetch failed");
              },
              readPrepareTrainingDatasetTask: async () => ({
                ok: false as const,
                error: {
                  code: "failed",
                  message: "runtime generation exploded",
                },
              }),
            }}
          />,
        );
        await flushAsyncWork();
      });

      const checkbox = container.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await flushAsyncWork();
      });
      await act(async () => {
        vi.advanceTimersByTime(1_000);
        await flushAsyncWork();
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
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: "warn" as const,
            message: JSON.stringify({
              event: "runtime.dataset_preparation.task.cancelled",
              requestId: capturedRequestId,
              status: "cancelled",
            }),
          },
        ],
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
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset: async (_input, context) => {
              capturedRequestId = context?.requestId;
              throw new Error("fetch failed");
            },
            readPrepareTrainingDatasetTask: async () => ({
              ok: true as const,
              status: "cancelled" as const,
            }),
          }}
        />,
      );
      await flushAsyncWork();
    });

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
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
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset: async () => {
              throw new Error("permission denied");
            },
          }}
        />,
      );
      await flushAsyncWork();
    });

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
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
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async () => {
                throw new Error("fetch failed");
              },
            }}
          />,
        );
      });

      const checkbox = container.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await flushAsyncWork();
      });

      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await flushAsyncWork();
      });

      expect(
        runtimeStatusClient.readStatus.mock.calls.length,
      ).toBeLessThanOrEqual(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains in-progress status and locks form controls across remounts", async () => {
    let resolvePreparation:
      ((value: { ok: true; value: any }) => void) | undefined;
    const startPrepareTrainingDataset = vi.fn(
      () =>
        new Promise<{ ok: true; value: any }>((resolve) => {
          resolvePreparation = resolve;
        }),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={settingsClient}
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({
              ok: true,
              value: {
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
                      chunkSize: 1000,
                      chunkOverlap: 200,
                    },
                    generation: {
                      mode: "qa",
                      model: {
                        provider: "transformers",
                        modelId: "Qwen/Qwen2.5-7B-Instruct",
                      },
                    },
                  },
                  split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
                  output: { format: "parquet" },
                  generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
            }),
          }}
        />,
      );
    });

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const formattingToggle = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("Generation prompt"),
    ) as HTMLButtonElement;
    await act(async () => {
      formattingToggle.click();
    });
    expect(container.textContent).toContain("Inference mode");

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Stop training");
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(
      true,
    );

    await act(async () => {
      root?.unmount();
    });
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={settingsClient}
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({
              ok: true,
              value: {
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
                      chunkSize: 1000,
                      chunkOverlap: 200,
                    },
                    generation: {
                      mode: "qa",
                      model: {
                        provider: "transformers",
                        modelId: "Qwen/Qwen2.5-7B-Instruct",
                      },
                    },
                  },
                  split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
                  output: { format: "parquet" },
                  generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
            }),
          }}
        />,
      );
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Checking model");
    expect(container.textContent).toContain("Stop training");
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(
      true,
    );

    await act(async () => {
      resolvePreparation?.({
        ok: true,
        value: {
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
                  modelId: "Qwen/Qwen2.5-7B-Instruct",
                },
              },
            },
            split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
            output: { format: "parquet" },
            generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
      await flushAsyncWork();
    });
  });

  it("shows reconnecting status after a task-read failure and recovers chunk progress", async () => {
    vi.useFakeTimers();
    let resolvePreparation:
      ((value: { ok: true; value: any }) => void) | undefined;
    let requestId: string | undefined;
    let taskReadCount = 0;
    const startPrepareTrainingDataset = vi
      .fn()
      .mockResolvedValue({ requestId: "poll-recovery-task" });
    const runtimeStatusClient = {
      readStatus: vi
        .fn()
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
          logs: [
            {
              timestamp: new Date().toISOString(),
              level: "info" as const,
              message: JSON.stringify({
                event: "runtime.dataset_preparation.generation.progress",
                requestId,
                processedChunkCount: 1,
                totalChunkCount: 4,
              }),
            },
          ],
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
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async (input, context) => {
                requestId = context?.requestId;
                return startPrepareTrainingDataset(input, context);
              },
              readPrepareTrainingDatasetTask: async () => {
                taskReadCount += 1;
                return taskReadCount === 1
                  ? {
                      ok: false as const,
                      error: {
                        code: "transport",
                        message: "fetch failed",
                        details: { retryable: true },
                      },
                    }
                  : {
                      ok: true as const,
                      status: "running" as const,
                      progress: {
                        message: "Processing chunk 1/4",
                        processed: 1,
                        total: 4,
                      },
                    };
              },
            }}
          />,
        );
        await flushAsyncWork();
      });

      const checkbox = container.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await flushAsyncWork();
      });

      expect(container.textContent).toContain(
        "Reconnecting to dataset preparation task...",
      );

      await act(async () => {
        vi.advanceTimersByTime(800);
        await flushAsyncWork();
      });
      expect(container.textContent).toContain("Processing chunk 1/4");

      await act(async () => {
        resolvePreparation?.({
          ok: true,
          value: {
            outputs: {},
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
                    modelId: "Qwen/Qwen2.5-7B-Instruct",
                  },
                },
              },
              split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
              output: { format: "parquet" },
              generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
        await flushAsyncWork();
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
          logs: [
            {
              timestamp: new Date().toISOString(),
              level: "info" as const,
              message: JSON.stringify({
                event: "runtime.dataset_preparation.generation.progress",
                requestId: capturedRequestId,
                processedChunkCount: 1,
                totalChunkCount: 10,
              }),
            },
          ],
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
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async (_input, context) => {
                capturedRequestId = context?.requestId;
                throw new Error("fetch failed");
              },
            }}
          />,
        );
        await flushAsyncWork();
      });

      const checkbox = container.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await flushAsyncWork();
      });

      await act(async () => {
        vi.advanceTimersByTime(2_500);
        await flushAsyncWork();
      });

      expect(
        runtimeStatusClient.readStatus.mock.calls.length,
      ).toBeLessThanOrEqual(6);
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
        loadedModels: [
          {
            provider: "transformers" as const,
            modelId: "Qwen/Qwen2.5-7B-Instruct",
            inferenceMode: "text2text" as const,
            localPath: "/models/Qwen/Qwen2.5-7B-Instruct",
          },
        ],
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
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset: async () => ({
              ok: false,
              error: { code: "internal", message: "failed" },
            }),
          }}
        />,
      );
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Unload model");

    const unloadButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Unload model",
    ) as HTMLButtonElement;
    await act(async () => {
      unloadButton.click();
      await flushAsyncWork();
    });

    expect(runtimeStatusClient.controlRuntime).toHaveBeenCalledWith(
      "unload-model",
    );
    expect(container.textContent).not.toContain("Model unloaded from memory.");
  });

  it("does not render model generation settings keys", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          settingsClient={{
            ...settingsClient,
            resolveModelDefault: vi
              .fn()
              .mockRejectedValue(new Error("settings failed")),
          }}
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset: async () => ({
              ok: false,
              error: { code: "internal", message: "failed" },
            }),
          }}
        />,
      );
    });

    expect(container.textContent).not.toContain(
      "features.datasetPreparation.qaGeneration.default",
    );
    expect(container.textContent).not.toContain(
      "models.tasks.qaGeneration.default",
    );
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
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset: async () => ({
              ok: false,
              error: { code: "internal", message: "failed" },
            }),
          }}
        />,
      );
    });

    expect(container.textContent).toContain(
      "Hugging Face namespace default could not be loaded.",
    );
  });

  it("keeps submit behavior stable when rerendered with a new options object shape", async () => {
    const startPrepareTrainingDataset = vi
      .fn()
      .mockResolvedValue({ requestId: "rerender-task" });
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
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({
              ok: true,
              status: "succeeded",
              value: {
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
                      chunkSize: 1000,
                      chunkOverlap: 200,
                    },
                    generation: {
                      mode: "qa",
                      model: {
                        provider: "transformers",
                        modelId: "Qwen/Qwen2.5-7B-Instruct",
                      },
                    },
                  },
                  split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
                  output: { format: "parquet" },
                  generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
            }),
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
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset,
            readPrepareTrainingDatasetTask: async () => ({
              ok: true,
              status: "succeeded",
              value: {
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
                      chunkSize: 1000,
                      chunkOverlap: 200,
                    },
                    generation: {
                      mode: "qa",
                      model: {
                        provider: "transformers",
                        modelId: "Qwen/Qwen2.5-7B-Instruct",
                      },
                    },
                  },
                  split: { trainRatio: 0.8, testRatio: 0.2, shuffle: true },
                  output: { format: "parquet" },
                  generationModelId: "Qwen/Qwen2.5-7B-Instruct",
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
            }),
          }}
        />,
      );
    });

    const checkbox = container.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });

    expect(startPrepareTrainingDataset).toHaveBeenCalledTimes(1);
    expect(onPrepared).toHaveBeenCalledTimes(1);
  });

  it("does not continue polling updates after unmount during in-flight task read", async () => {
    let resolveRead: ((value: unknown) => void) | undefined;
    const readPrepareTrainingDatasetTask = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatasetPreparationFeature
          client={{
            browseSourceArtifacts: async () => [
              {
                artifactId: "artifact-1",
                label: "artifact-1.md",
                storageKey: "uploads/artifact-1.md",
              },
            ],
            startPrepareTrainingDataset: async (_input, context) => ({
              requestId: context?.requestId ?? "req-1",
            }),
            readPrepareTrainingDatasetTask:
              readPrepareTrainingDatasetTask as never,
          }}
        />,
      );
    });
    await act(async () => {
      (
        container?.querySelector("input[type='checkbox']") as HTMLInputElement
      ).click();
    });
    await act(async () => {
      (container?.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });
    expect(readPrepareTrainingDatasetTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      root?.unmount();
    });
    await act(async () => {
      resolveRead?.({
        ok: true,
        status: "running",
        progress: { message: "still running", processed: 1, total: 4 },
      });
      await flushAsyncWork();
    });
  });

  it("does not clear cached active request id when unmounting during reconnect sleep", async () => {
    vi.useFakeTimers();
    try {
      const readPrepareTrainingDatasetTask = vi
        .fn()
        .mockResolvedValue({ ok: false, error: { message: "fetch failed" } });
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(
          <DatasetPreparationFeature
            client={{
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async (_input, context) => ({
                requestId: context?.requestId ?? "req-1",
              }),
              readPrepareTrainingDatasetTask,
            }}
          />,
        );
      });
      await act(async () => {
        (
          container?.querySelector("input[type='checkbox']") as HTMLInputElement
        ).click();
      });
      await act(async () => {
        (container?.querySelector("form") as HTMLFormElement).dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await flushAsyncWork();
      });
      expect(container?.textContent).toContain(
        "Reconnecting to dataset preparation task...",
      );
      await act(async () => {
        root?.unmount();
      });
      root = createRoot(container as HTMLDivElement);
      await act(async () => {
        root?.render(
          <DatasetPreparationFeature
            client={{
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async () => ({
                ok: false,
                error: { code: "internal", message: "unused" },
              }),
              readPrepareTrainingDatasetTask: async () => ({
                ok: true,
                status: "running",
                progress: { message: "running" },
              }),
            }}
          />,
        );
      });
      expect(container?.textContent).toContain("Stop training");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes active dataset preparation progress after page remount", async () => {
    vi.useFakeTimers();
    try {
      const readPrepareTrainingDatasetTask = vi
        .fn()
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
        root?.render(
          <DatasetPreparationFeature
            client={{
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async (_input, context) => ({
                requestId: context?.requestId ?? "req-1",
              }),
              readPrepareTrainingDatasetTask,
              cancelPrepareTrainingDatasetTask: async () => ({ ok: true }),
            }}
          />,
        );
      });

      await act(async () => {
        (
          container?.querySelector("input[type='checkbox']") as HTMLInputElement
        ).click();
      });
      await act(async () => {
        (container?.querySelector("form") as HTMLFormElement).dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        await flushAsyncWork();
      });

      expect(container?.textContent).toContain("Processing chunk (1/4)");

      await act(async () => {
        root?.unmount();
      });
      root = createRoot(container as HTMLDivElement);
      await act(async () => {
        root?.render(
          <DatasetPreparationFeature
            client={{
              browseSourceArtifacts: async () => [
                {
                  artifactId: "artifact-1",
                  label: "artifact-1.md",
                  storageKey: "uploads/artifact-1.md",
                },
              ],
              startPrepareTrainingDataset: async () => ({
                error: { code: "unused", message: "unused" },
              }),
              readPrepareTrainingDatasetTask,
              cancelPrepareTrainingDatasetTask: async () => ({ ok: true }),
            }}
          />,
        );
        await flushAsyncWork();
      });

      expect(container?.textContent).toContain("Processing chunk (2/4)");
      expect(container?.textContent).not.toContain("Training stopped.");
      expect(readPrepareTrainingDatasetTask).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
