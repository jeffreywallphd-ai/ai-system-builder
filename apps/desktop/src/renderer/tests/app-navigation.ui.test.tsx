import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";

describe("desktop renderer page composition", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => {
        mountedRoot?.unmount();
      });
    }
    mountedContainer?.remove();
    delete window.desktopApi;
    mountedRoot = undefined;
    mountedContainer = undefined;
  });

  it("renders landing Home page by default and switches to Data/Settings/System pages", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi.fn().mockRejectedValue(new Error("unused")),
      registerArtifactFromRepo: vi.fn().mockRejectedValue(new Error("unused")),
      localizeArtifactFromRepo: vi.fn().mockRejectedValue(new Error("unused")),
      readPythonRuntimeStatus: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          supervisorStatus: "stopped",
          healthy: false,
          runtimeStatus: "stopped",
          capabilities: [],
          logs: [],
        },
      }),
      controlPythonRuntime: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          supervisorStatus: "starting",
          healthy: false,
          runtimeStatus: "starting",
          capabilities: [],
          logs: [],
        },
      }),
      browseModels: vi.fn().mockResolvedValue({ ok: true, value: { models: [] } }),
      getModelDetails: vi.fn().mockResolvedValue({ ok: true, value: { model: { provider: "huggingface", modelId: "org/demo", displayName: "Demo" } } }),
      listModels: vi.fn().mockResolvedValue({ ok: true, value: { models: [] } }),
      saveModelReference: vi.fn().mockResolvedValue({ ok: true, value: { model: { modelRecordId: "m1", displayName: "Demo", source: "huggingface", lifecycleStatus: "saved-reference", artifactForm: "full-model", provider: "huggingface", createdAt: "2026-04-27T00:00:00.000Z" } } }),
      updateModelRecord: vi.fn().mockResolvedValue({ ok: true, value: { model: { modelRecordId: "m1", displayName: "Demo", source: "huggingface", lifecycleStatus: "saved-reference", artifactForm: "full-model", provider: "huggingface", createdAt: "2026-04-27T00:00:00.000Z" } } }),
      deleteModelRecord: vi.fn().mockResolvedValue({ ok: true, value: { deletedModelRecordId: "m1", deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] } }),
    };

    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("Build visual AI workflows from your artifacts");

    const artifactsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Data",
    );
    expect(artifactsButton).toBeDefined();

    await act(async () => {
      artifactsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Data Artifact Ingester");
    expect(container.textContent).not.toContain("Data Artifact Browser");

    const artifactBrowserTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Artifact Browser",
    );
    expect(artifactBrowserTab).toBeDefined();

    await act(async () => {
      artifactBrowserTab?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Artifact Browser");

    const datasetPreparationTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Dataset Preparation",
    );
    expect(datasetPreparationTab).toBeDefined();

    await act(async () => {
      datasetPreparationTab?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Python Runtime");

    const modelsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Models",
    );
    expect(modelsButton).toBeDefined();

    await act(async () => {
      modelsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Model Management");
    expect(container.textContent).toContain("Browse Models");


    const imageGenerationButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Image Generation",
    );
    expect(imageGenerationButton).toBeDefined();

    await act(async () => {
      imageGenerationButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Run runtime-backed image generation tasks");

    const settingsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Settings",
    );
    expect(settingsButton).toBeDefined();

    await act(async () => {
      settingsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Manage global desktop defaults used by feature workflows.");

    const systemButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "System",
    );
    expect(systemButton).toBeDefined();

    await act(async () => {
      systemButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("System workspace scaffolding for upcoming desktop surfaces.");
  });
});
