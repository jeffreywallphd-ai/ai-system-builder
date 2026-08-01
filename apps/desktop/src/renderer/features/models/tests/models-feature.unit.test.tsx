// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelsFeature } from "../components/ModelsFeature";

async function flushUi(): Promise<void> {
  await Promise.resolve();
}

function createClientDouble() {
  return {
    browseModels: vi.fn().mockResolvedValue({
      models: [
        {
          provider: "huggingface",
          modelId: "org/demo-model",
          displayName: "Demo Model",
          authorOrOrg: "org",
          taskTags: ["text-generation"],
          downloads: 100,
          likes: 10,
          license: "apache-2.0",
          inferenceMode: "causal",
        },
      ],
    }),
    getModelDetails: vi.fn().mockResolvedValue({
      provider: "huggingface",
      modelId: "org/demo-model",
      displayName: "Demo Model",
      description: "Demo description",
      tags: ["text-generation"],
      siblings: ["model.safetensors", "tokenizer.json"],
      tokenizerAvailable: true,
      safetensorsAvailable: true,
      adapterAvailable: false,
      recommendedInferenceMode: "causal",
      warnings: ["gated model"],
    }),
    listModels: vi.fn().mockResolvedValue([
      {
        modelRecordId: "saved-1",
        displayName: "Saved Ref",
        source: "huggingface",
        lifecycleStatus: "saved-reference",
        artifactForm: "full-model",
        provider: "huggingface",
        modelId: "org/demo-model",
        localFilesAvailable: true,
        createdAt: "2026-04-27T00:00:00.000Z",
      },
    ]),
    saveModelReference: vi.fn().mockResolvedValue({
      modelRecordId: "saved-2",
      displayName: "Demo Model",
      source: "huggingface",
      lifecycleStatus: "saved-reference",
      artifactForm: "full-model",
      provider: "huggingface",
      modelId: "org/demo-model",
      createdAt: "2026-04-27T00:03:00.000Z",
    }),
    downloadModel: vi.fn().mockResolvedValue({
      model: {
        modelRecordId: "downloaded-1",
        displayName: "Demo Model",
        source: "huggingface",
        lifecycleStatus: "downloaded",
        artifactForm: "full-model",
        provider: "huggingface",
        modelId: "org/demo-model",
        localPath: "/models/org/demo-model",
        createdAt: "2026-04-27T00:04:00.000Z",
      },
      download: {
        provider: "transformers",
        modelId: "org/demo-model",
        downloaded: true,
        fromCache: false,
        localPath: "/models/org/demo-model",
      },
    }),
    updateModelRecord: vi.fn(),
    deleteModelRecord: vi.fn().mockResolvedValue({
      deletedModelRecordId: "saved-1",
      deletedRegistryRecord: true,
      deletedLocalFiles: true,
      deletedBackingArtifactIds: [],
    }),
    revealModelInFolder: vi.fn().mockResolvedValue({
      modelRecordId: "saved-1",
      revealed: true,
    }),
    trainModel: vi.fn().mockResolvedValue({
      runId: "run-1",
      status: "succeeded",
      outputModel: {
        modelRecordId: "generated-1",
        displayName: "My LoRA Adapter",
        source: "generated",
        lifecycleStatus: "generated",
        artifactForm: "adapter",
        provider: "unknown",
        createdAt: "2026-04-27T00:05:00.000Z",
      },
    }),
    readModelTrainingStatus: vi
      .fn()
      .mockResolvedValue({ runId: "run-1", status: "succeeded" }),
    cancelModelTraining: vi
      .fn()
      .mockResolvedValue({ runId: "run-1", status: "cancelled" }),
    saveModelTraining: vi
      .fn()
      .mockResolvedValue({
        runId: "run-1",
        status: "succeeded",
        outputModel: {
          modelRecordId: "generated-1",
          displayName: "My LoRA Adapter",
          source: "generated",
          lifecycleStatus: "generated",
          artifactForm: "adapter",
          provider: "unknown",
          createdAt: "2026-04-27T00:05:00.000Z",
        },
      }),
    discardModelTraining: vi
      .fn()
      .mockResolvedValue({ runId: "run-1", status: "cancelled" }),
    validateModel: vi
      .fn()
      .mockResolvedValue({
        modelRecordId: "generated-1",
        status: "valid",
        reportPath: "/tmp/report.md",
      }),
    publishModel: vi
      .fn()
      .mockResolvedValue({
        modelRecordId: "generated-1",
        published: true,
        provider: "huggingface",
        repository: "owner/repo",
      }),
  };
}

function createWarningModelClientDouble() {
  const client = createClientDouble();
  client.listModels = vi.fn().mockResolvedValue([
    {
      modelRecordId: "generated-1",
      displayName: "Generated Warning Model",
      source: "generated",
      lifecycleStatus: "generated",
      artifactForm: "adapter",
      provider: "unknown",
      validationStatus: "warning",
      createdAt: "2026-04-27T00:00:00.000Z",
    },
  ]);
  return client;
}

function createValidModelClientDouble() {
  const client = createClientDouble();
  client.listModels = vi.fn().mockResolvedValue([
    {
      modelRecordId: "generated-valid-1",
      displayName: "Generated Valid Model",
      source: "generated",
      lifecycleStatus: "validated",
      artifactForm: "adapter",
      provider: "unknown",
      validationStatus: "valid",
      createdAt: "2026-04-27T00:00:00.000Z",
    },
  ]);
  return client;
}

describe("ModelsFeature", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  beforeEach(() => {
    window.desktopApi = {
      readPythonRuntimeStatus: vi
        .fn()
        .mockResolvedValue({
          ok: true,
          value: {
            supervisorStatus: "stopped",
            healthy: false,
            runtimeStatus: "stopped",
            capabilities: [],
            logs: [],
            loadedModels: [],
            activeTaskCount: 0,
          },
        }),
      controlPythonRuntime: vi
        .fn()
        .mockResolvedValue({
          ok: true,
          value: {
            supervisorStatus: "stopped",
            healthy: false,
            runtimeStatus: "stopped",
            capabilities: [],
            logs: [],
            loadedModels: [],
            activeTaskCount: 0,
          },
        }),
      browseArtifacts: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [] },
      }),
    } as never;
  });

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => {
        mountedRoot?.unmount();
      });
    }
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
    delete window.desktopApi;
  });

  it("shows browse result actions in two-column results without a details card", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    expect(client.browseModels).not.toHaveBeenCalled();
    expect(client.trainModel).not.toHaveBeenCalled();
    expect(client.validateModel).not.toHaveBeenCalled();
    expect(client.publishModel).not.toHaveBeenCalled();

    const searchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Search Models",
    ) as HTMLButtonElement;
    await act(async () => {
      searchButton.click();
      await flushUi();
    });

    expect(container.textContent).toContain("Demo Model");
    expect(container.textContent).toContain("org/demo-model");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Save",
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Download",
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain("Model Details");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "View Details",
      ),
    ).toBe(false);
    expect(client.getModelDetails).not.toHaveBeenCalled();
  });

  it("runs each browse search request", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    const searchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Search Models",
    ) as HTMLButtonElement;
    await act(async () => {
      searchButton.click();
      await flushUi();
    });
    await act(async () => {
      searchButton.click();
      await flushUi();
    });

    expect(client.browseModels).toHaveBeenCalledTimes(2);
  });

  it("submits the Find Models form, supports Other task tags, and enforces the selected page limit", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ModelsFeature client={client as never} workspaceId="workspace-a" />);
      await flushUi();
    });

    expect(container.textContent).toContain("Find Models");
    const taskSelect = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "other"),
    ) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(taskSelect, "other");
      taskSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await flushUi();
    });

    const otherInput = container.querySelector("input[placeholder='Enter a Hugging Face task tag']") as HTMLInputElement;
    const limitSelect = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "50"),
    ) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(otherInput, "image-classification");
      otherInput.dispatchEvent(new Event("input", { bubbles: true }));
      otherInput.dispatchEvent(new Event("change", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(limitSelect, "50");
      limitSelect.dispatchEvent(new Event("change", { bubbles: true }));
      (container.querySelector("form") as HTMLFormElement).requestSubmit();
      await flushUi();
    });

    expect(client.browseModels).toHaveBeenCalledWith(expect.objectContaining({
      provider: "huggingface",
      customTaskTag: "image-classification",
      limit: 50,
    }));
    expect(container.textContent).toContain("Results per page");
  });

  it("moves through cursor-backed model result pages", async () => {
    const client = createClientDouble();
    client.browseModels
      .mockResolvedValueOnce({
        models: [{ provider: "huggingface", modelId: "org/page-1", displayName: "Page 1" }],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        models: [{ provider: "huggingface", modelId: "org/page-2", displayName: "Page 2" }],
      });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ModelsFeature client={client as never} workspaceId="workspace-a" />);
      await flushUi();
    });
    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).requestSubmit();
      await flushUi();
    });
    const nextButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next") as HTMLButtonElement;
    await act(async () => {
      nextButton.click();
      await flushUi();
    });

    expect(client.browseModels.mock.calls[1]?.[0]).toMatchObject({ cursor: "page-2", limit: 25 });
    expect(container.textContent).toContain("Page 2");
  });

  it("renders train form content through dedicated training flow", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    const trainTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Train Model",
    );
    await act(async () => {
      trainTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(container.textContent).toContain(
      "Current backend support: LoRA, QLoRA, and full fine-tuning",
    );
    expect(container.textContent).toContain(
      "Training datasets (Parquet artifacts)",
    );
    expect(
      container.querySelector(".model-training-workflow__datasets"),
    ).toBeTruthy();
    expect(
      container.querySelectorAll(".ui-workflow__step").length,
    ).toBeGreaterThan(5);
    expect(
      container
        .querySelector(".models-feature")
        ?.classList.contains("ui-panel"),
    ).toBe(false);
    expect(
      Array.from(container.querySelectorAll("input")).some(
        (input) => input.value === "512",
      ),
    ).toBe(true);
    expect(container.textContent).toContain("Recommended range: 1 to 5.");
    expect(container.textContent).toContain(
      "Recommended range: 0.00001 to 0.0005.",
    );
    const advancedSettings = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Advanced training settings");
    await act(async () => {
      advancedSettings?.click();
      await flushUi();
    });
    expect(container.textContent).toContain("Recommended range: 4 to 64.");
    expect(container.textContent).toContain("q_proj,v_proj");
    expect(container.textContent).toContain("Start Training");
  });

  it("lists canonical Parquet artifacts from the active workspace for training", async () => {
    const client = createClientDouble();
    client.trainModel = vi.fn().mockResolvedValue({
      runId: "run-1",
      status: "queued",
    });
    client.readModelTrainingStatus = vi.fn().mockResolvedValue({
      runId: "run-1",
      status: "cancelled",
    });
    client.listModels = vi.fn().mockResolvedValue([
      {
        modelRecordId: "bitnet-base",
        displayName: "BitNet Base",
        source: "huggingface",
        lifecycleStatus: "downloaded",
        artifactForm: "full-model",
        provider: "huggingface",
        modelId: "microsoft/bitnet-b1.58-2B-4T",
        localPath: "C:\\models\\bitnet",
        inferenceMode: "causal",
        createdAt: "2026-07-31T23:00:00.000Z",
      },
      {
        modelRecordId: "qwen-small",
        displayName: "Qwen 2.5 1.5B Instruct",
        source: "huggingface",
        lifecycleStatus: "downloaded",
        artifactForm: "full-model",
        provider: "huggingface",
        modelId: "Qwen/Qwen2.5-1.5B-Instruct",
        localPath: "C:\\models\\qwen-small",
        inferenceMode: "chat",
        taskTags: ["text-generation"],
        metadata: {
          source: "dataset-preparation",
          usage: "text-field-generation",
        },
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
    const browseArtifacts = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        items: [
          {
            artifactId: "prepared-dataset-1",
            storageKey: "workspaces/workspace-a/artifacts/generated/opaque-1",
            artifactFamily: "tabular",
            mediaType: "application/vnd.apache.parquet",
            originalName: "reviewed-billing-dataset",
          },
          {
            artifactId: "prepared-dataset-2",
            storageKey: "workspaces/workspace-a/artifacts/generated/opaque-2",
            artifactFamily: "tabular",
            mediaType: "application/octet-stream",
            originalName: "reviewed-support-dataset.parquet",
          },
          {
            artifactId: "notes-1",
            storageKey: "workspaces/workspace-a/artifacts/files/notes.txt",
            artifactFamily: "document",
            mediaType: "text/plain",
            originalName: "notes.txt",
          },
        ],
      },
    });
    const controlPythonRuntime = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: [],
        logs: [],
        loadedModels: [],
        activeTaskCount: 0,
      },
    });
    window.desktopApi = {
      ...window.desktopApi,
      browseArtifacts,
      readPythonRuntimeStatus: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          supervisorStatus: "ready",
          healthy: true,
          runtimeStatus: "ready",
          capabilities: [],
          logs: [],
          loadedModels: [],
          activeTaskCount: 0,
        },
      }),
      controlPythonRuntime,
    } as never;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    const trainTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Train Model",
    );
    await act(async () => {
      trainTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    await vi.waitFor(() => {
      expect(
        Array.from(
          container.querySelectorAll<HTMLInputElement>(
            "input[name='training-dataset']",
          ),
        ).map(
          (input) =>
            input.parentElement?.querySelector("span:last-child")?.textContent,
        ),
      ).toEqual([
        "reviewed-billing-dataset",
        "reviewed-support-dataset.parquet",
      ]);
    });
    const datasetCheckboxes = container.querySelectorAll<HTMLInputElement>(
      "input[name='training-dataset']",
    );
    const baseModelSelect =
      container.querySelector<HTMLSelectElement>(
        ".model-training-workflow select",
      );
    expect(baseModelSelect?.value).toBe("qwen-small");
    expect(container.textContent).not.toContain("Unload model");
    await act(async () => {
      datasetCheckboxes[0]?.click();
      await flushUi();
    });
    expect(datasetCheckboxes[0]?.checked).toBe(true);
    expect(datasetCheckboxes[1]?.checked).toBe(false);
    expect(browseArtifacts).toHaveBeenCalledWith(
      {
        artifactFamily: undefined,
        workspaceId: "workspace-a",
      },
      { workspaceId: "workspace-a" },
    );

    const startTraining = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Start Training"));
    await act(async () => {
      startTraining?.click();
      await flushUi();
    });
    await vi.waitFor(() => expect(client.trainModel).toHaveBeenCalled());
    expect(client.trainModel).toHaveBeenCalledWith(
      expect.objectContaining({
        baseModel: { modelRecordId: "qwen-small" },
        datasets: [
          {
            artifactId: "prepared-dataset-1",
            splitRole: "train",
            format: "parquet",
          },
        ],
      }),
    );

    const stopTraining = await vi.waitFor(() => {
      const button = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) => candidate.textContent === "Stop training");
      expect(button).toBeDefined();
      return button as HTMLButtonElement;
    });
    await act(async () => {
      stopTraining.click();
      await flushUi();
    });
    expect(client.cancelModelTraining).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: "workspace-a",
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Training cancelled.");
      expect(container.textContent).toContain("Unload model");
    });

    const unloadModel = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent === "Unload model");
    await act(async () => {
      unloadModel?.click();
      await flushUi();
    });
    expect(controlPythonRuntime).toHaveBeenCalledWith({ action: "unload-model" });
    expect(container.textContent).not.toContain("Unload model");

    await new Promise((resolve) => window.setTimeout(resolve, 550));
    const pendingReviewResult = {
      runId: "run-review",
      status: "succeeded" as const,
      reviewPending: true,
      outputModelName: "my-lora-adapter",
      generatedModelCandidate: {
        displayName: "My LoRA Adapter",
        artifactForm: "adapter" as const,
      },
    };
    client.trainModel.mockResolvedValueOnce(pendingReviewResult);
    const startReviewTraining = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Start Training"));
    await act(async () => {
      startReviewTraining?.click();
      await flushUi();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Save model");
      expect(container.textContent).toContain("Discard model");
      expect(container.textContent).toContain("Unload model");
    });
    const discardModel = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Discard model");
    await act(async () => {
      discardModel?.click();
      await flushUi();
    });
    expect(client.discardModelTraining).toHaveBeenCalledWith({
      runId: "run-review",
      workspaceId: "workspace-a",
    });

    client.trainModel.mockResolvedValueOnce({
      ...pendingReviewResult,
      runId: "run-save",
    });
    const startSaveTraining = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Start Training"));
    await act(async () => {
      startSaveTraining?.click();
      await flushUi();
    });
    const saveModel = await vi.waitFor(() => {
      const button = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) => candidate.textContent === "Save model");
      expect(button).toBeDefined();
      return button as HTMLButtonElement;
    });
    await act(async () => {
      saveModel.click();
      await flushUi();
    });
    expect(client.saveModelTraining).toHaveBeenCalledWith({
      runId: "run-save",
      workspaceId: "workspace-a",
    });
  });

  it("does not browse training artifacts without an active workspace", async () => {
    const client = createClientDouble();
    const browseArtifacts = vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [] },
    });
    window.desktopApi = {
      ...window.desktopApi,
      browseArtifacts,
    } as never;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ModelsFeature client={client as never} />);
      await flushUi();
    });

    const trainTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Train Model",
    );
    await act(async () => {
      trainTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(browseArtifacts).not.toHaveBeenCalled();
    expect(client.listModels).not.toHaveBeenCalled();
  });

  it("refreshes the model inventory whenever Manage Models is opened", async () => {
    const client = createClientDouble();
    client.listModels
      .mockResolvedValueOnce([
        {
          modelRecordId: "saved-1",
          displayName: "Existing Model",
          source: "huggingface",
          lifecycleStatus: "saved-reference",
          artifactForm: "full-model",
          provider: "huggingface",
          modelId: "org/existing",
          createdAt: "2026-04-27T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          modelRecordId: "generated-2",
          displayName: "Newly Generated Model",
          source: "generated",
          lifecycleStatus: "generated",
          artifactForm: "adapter",
          provider: "unknown",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });
    await vi.waitFor(() => expect(client.listModels).toHaveBeenCalledTimes(1));

    const manageTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage Models",
    );
    await act(async () => {
      manageTab?.click();
      await flushUi();
    });

    await vi.waitFor(() => {
      expect(client.listModels).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("Newly Generated Model");
      expect(container.textContent).not.toContain("Existing Model");
    });
  });

  it("shows validate and disabled publish actions in manage models tab", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage Models",
    );
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Details",
    ) as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(document.body.textContent).toContain("Validate");
    const publishButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Publish",
    ) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
  });

  it("opens model details and delete confirmation in modals and reveals local files by record id", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ModelsFeature client={client as never} workspaceId="workspace-a" />);
      await flushUi();
    });
    const manageTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Manage Models") as HTMLButtonElement;
    await act(async () => {
      manageTab.click();
      await flushUi();
    });

    expect(container.querySelector(".models-feature__card-grid")).toBeTruthy();
    const detailsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Details") as HTMLButtonElement;
    await act(async () => {
      detailsButton.click();
      await flushUi();
    });
    expect(document.body.querySelector("[role='dialog']")?.textContent).toContain("Model details");
    const openButton = Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent === "Open in folder") as HTMLButtonElement;
    await act(async () => {
      openButton.click();
      await flushUi();
    });
    expect(client.revealModelInFolder).toHaveBeenCalledWith({ workspaceId: "workspace-a", modelRecordId: "saved-1" });

    await act(async () => {
      (document.body.querySelector("button[aria-label='Close model details']") as HTMLButtonElement).click();
      await flushUi();
    });
    const deleteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Delete Record") as HTMLButtonElement;
    await act(async () => {
      deleteButton.click();
      await flushUi();
    });
    expect(document.body.querySelector("[role='dialog']")?.textContent).toContain("Delete model record");
    const deleteDialog = document.body.querySelector("[role='dialog']") as HTMLElement;
    const confirmationInput = deleteDialog.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(confirmationInput, "Delete");
      confirmationInput.dispatchEvent(new Event("input", { bubbles: true }));
      await flushUi();
    });
    const confirmDeleteButton = Array.from(
      deleteDialog.querySelectorAll("button"),
    ).find((button) => button.textContent === "Delete model") as HTMLButtonElement;
    await act(async () => {
      confirmDeleteButton.click();
      await flushUi();
    });
    expect(client.deleteModelRecord).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      modelRecordId: "saved-1",
      deleteBackingArtifacts: false,
      deleteLocalFiles: true,
    });
  });

  it("treats warning validation as not safely publishable", async () => {
    const client = createWarningModelClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage Models",
    );
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Details",
    ) as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(document.body.textContent).toContain(
      "Warning validation is not safely publishable by default.",
    );
    const publishButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Publish",
    ) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
  });

  it("keeps publish disabled when repository is blank even for valid models", async () => {
    const client = createValidModelClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage Models",
    );
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Details",
    ) as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const publishButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Publish",
    ) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
  });

  it("passes active workspace id when validating a managed model", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage Models",
    );
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });
    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Details",
    ) as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });
    const validateButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Validate") as HTMLButtonElement;
    await act(async () => {
      validateButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(client.validateModel).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      modelRecordId: "saved-1",
    });
  });

  it("passes active workspace id when publishing a managed model and blocks without workspace", async () => {
    const client = createValidModelClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage Models",
    );
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });
    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Details",
    ) as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });
    const repositoryInput = document.body.querySelector(
      "input[placeholder='owner/model-name']",
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(repositoryInput, "owner/repo");
      repositoryInput.dispatchEvent(new Event("input", { bubbles: true }));
      repositoryInput.dispatchEvent(new Event("change", { bubbles: true }));
      await flushUi();
    });
    const publishButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Publish",
    ) as HTMLButtonElement;
    await act(async () => {
      publishButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(client.publishModel).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      modelRecordId: "generated-valid-1",
      repository: "owner/repo",
    });
  });

  it("shows repository input before publish action", async () => {
    const client = createValidModelClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ModelsFeature client={client as never} workspaceId="workspace-a" />,
      );
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Manage Models",
    );
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Details",
    ) as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const repositoryInput = document.body.querySelector(
      "input[placeholder='owner/model-name']",
    ) as HTMLInputElement;
    const publishButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Publish",
    ) as HTMLButtonElement;
    expect(
      repositoryInput.compareDocumentPosition(publishButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(publishButton.disabled).toBe(true);
  });
});
