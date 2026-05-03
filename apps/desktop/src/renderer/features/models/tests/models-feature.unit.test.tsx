// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelsFeature } from "../components/ModelsFeature";

async function flushUi(): Promise<void> {
  await Promise.resolve();
}

function createClientDouble() {
  return {
    browseModels: vi.fn().mockResolvedValue({
      models: [{
        provider: "huggingface",
        modelId: "org/demo-model",
        displayName: "Demo Model",
        authorOrOrg: "org",
        taskTags: ["text-generation"],
        downloads: 100,
        likes: 10,
        license: "apache-2.0",
        inferenceMode: "causal",
      }],
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
      download: { provider: "transformers", modelId: "org/demo-model", downloaded: true, fromCache: false, localPath: "/models/org/demo-model" },
    }),
    updateModelRecord: vi.fn(),
    deleteModelRecord: vi.fn().mockResolvedValue({
      deletedModelRecordId: "saved-1",
      deletedRegistryRecord: true,
      deletedLocalFiles: false,
      deletedBackingArtifactIds: [],
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
    readModelTrainingStatus: vi.fn().mockResolvedValue({ runId: "run-1", status: "succeeded" }),
    validateModel: vi.fn().mockResolvedValue({ modelRecordId: "generated-1", status: "valid", reportPath: "/tmp/report.md" }),
    publishModel: vi.fn().mockResolvedValue({ modelRecordId: "generated-1", published: true, provider: "huggingface", repository: "owner/repo" }),
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

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => {
        mountedRoot?.unmount();
      });
    }
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
  });

  it("shows browse result actions in two-column results without a details card", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ModelsFeature client={client as never} />);
      await flushUi();
    });

    expect(client.browseModels).toHaveBeenCalledWith({
      provider: "huggingface",
      limit: 25,
      sort: "downloads",
      direction: "desc",
    });

    const searchButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Search Models") as HTMLButtonElement;
    await act(async () => {
      searchButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(container.textContent).toContain("Demo Model");
    expect(container.textContent).toContain("org/demo-model");
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Save")).toBe(true);
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Download")).toBe(true);
    expect(container.textContent).not.toContain("Model Details");
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "View Details")).toBe(false);
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
      root.render(<ModelsFeature client={client as never} />);
      await flushUi();
    });

    const searchButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Search Models") as HTMLButtonElement;
    await act(async () => {
      searchButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });
    await act(async () => {
      searchButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(client.browseModels).toHaveBeenCalledTimes(3);
  });

  it("renders train form content through dedicated training flow", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ModelsFeature client={client as never} />);
      await flushUi();
    });

    const trainTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Train Model");
    await act(async () => {
      trainTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(container.textContent).toContain("Current backend support: LoRA, QLoRA, and full fine-tuning");
    expect(container.textContent).toContain("Training datasets (Parquet artifacts)");
    expect(container.querySelector("select[multiple]")).toBeTruthy();
    expect(Array.from(container.querySelectorAll("input")).some((input) => input.value === "512")).toBe(true);
    expect(container.textContent).toContain("Start Training");
  });

  it("shows validate and disabled publish actions in manage models tab", async () => {
    const client = createClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ModelsFeature client={client as never} />);
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Manage Models");
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Details") as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(container.textContent).toContain("Validate");
    const publishButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Publish") as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
  });

  it("treats warning validation as not safely publishable", async () => {
    const client = createWarningModelClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ModelsFeature client={client as never} />);
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Manage Models");
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Details") as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    expect(container.textContent).toContain("Warning validation is not safely publishable by default.");
    const publishButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Publish") as HTMLButtonElement;
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
      root.render(<ModelsFeature client={client as never} />);
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Manage Models");
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Details") as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const publishButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Publish") as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
  });

  it("shows repository input before publish action", async () => {
    const client = createValidModelClientDouble();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ModelsFeature client={client as never} />);
      await flushUi();
    });

    const manageTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Manage Models");
    await act(async () => {
      manageTab?.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Details") as HTMLButtonElement;
    await act(async () => {
      detailsButton.dispatchEvent(new Event("click", { bubbles: true }));
      await flushUi();
    });

    const repositoryInput = container.querySelector("input[placeholder='owner/model-name']") as HTMLInputElement;
    const publishButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Publish") as HTMLButtonElement;
    expect(repositoryInput.compareDocumentPosition(publishButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(publishButton.disabled).toBe(true);
  });
});
