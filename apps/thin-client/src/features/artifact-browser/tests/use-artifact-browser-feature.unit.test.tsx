import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactBrowserFeature } from "../components/ArtifactBrowserFeature";

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ArtifactBrowserFeature", () => {
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

  it("publishes a selected artifact and shows published backing details", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/cat.png",
          artifactFamily: "image" as const,
          mediaType: "image/png",
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
        mediaType: "image/png",
        sizeBytes: 4,
        metadata: {
          publishedBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/cat.png",
              revision: "main",
              locator: "openai/demo/images/cat.png",
            },
            verification: {
              exists: false,
            },
          },
        },
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        mediaType: "image/png",
        sizeBytes: 4,
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue("/api/artifact/media/view?storageKey=uploads%2Fcat.png"),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn().mockResolvedValue({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-17T00:00:00.000Z",
        },
      }),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-17T00:00:00.000Z",
        },
      }),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    const artifactButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("uploads/cat.png")) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });

    const publishToggleButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Publish to Hugging Face") as HTMLButtonElement;
    await act(async () => {
      publishToggleButton.click();
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    setInputValue(inputs[1] as HTMLInputElement, "openai/demo");
    setInputValue(inputs[2] as HTMLInputElement, "images/cat.png");

    const publishButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Publish") as HTMLButtonElement;
    await act(async () => {
      publishButton.click();
    });

    expect(client.publishArtifactToHuggingFace).toHaveBeenCalledWith({
      artifactId: "uploads/cat.png",
      repository: "openai/demo",
      path: "images/cat.png",
      revision: "main",
      mediaType: "",
    });
    expect(container.textContent).toContain("Published Backing");
    expect(container.textContent).toContain("openai/demo");
    expect(container.textContent).toContain("Not yet verified");
  });

  it("shows publish failure message", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/cat.png",
          artifactFamily: "image" as const,
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue("/api/artifact/media/view?storageKey=uploads%2Fcat.png"),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn().mockRejectedValue(new Error("Missing Hugging Face token.")),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    const artifactButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("uploads/cat.png")) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });
    const publishToggleButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Publish to Hugging Face") as HTMLButtonElement;
    await act(async () => {
      publishToggleButton.click();
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    setInputValue(inputs[1] as HTMLInputElement, "openai/demo");
    setInputValue(inputs[2] as HTMLInputElement, "images/cat.png");

    const publishButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Publish") as HTMLButtonElement;
    await act(async () => {
      publishButton.click();
    });

    expect(container.textContent).toContain("Missing Hugging Face token.");
    expect(container.textContent).toContain("This Hugging Face repository may require an access token.");
  });

  it("saves and clears Hugging Face token from token settings", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••9999" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;
    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    const tokenInput = container.querySelector("input[type='password']") as HTMLInputElement;
    setInputValue(tokenInput, "hf_9999");
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save token") as HTMLButtonElement;
    await act(async () => {
      saveButton.click();
    });
    expect(client.setHuggingFaceToken).toHaveBeenCalledWith({ token: "hf_9999" });
    expect(container.textContent).toContain("Hugging Face token saved.");

    const clearButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Clear token") as HTMLButtonElement;
    await act(async () => {
      clearButton.click();
    });
    expect(client.clearHuggingFaceToken).toHaveBeenCalled();
  });

  it("disables repeat publish submit while pending", async () => {
    let resolvePublish: ((value: {
      target: {
        provider: string;
        repository: string;
        path: string;
        revision: string;
        locator: string;
      };
      verification: {
        exists: boolean;
      };
    }) => void) | undefined;
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/cat.png",
          artifactFamily: "image" as const,
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue("/api/artifact/media/view?storageKey=uploads%2Fcat.png"),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolvePublish = resolve;
      })),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    const artifactButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("uploads/cat.png")) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });
    const publishToggleButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Publish to Hugging Face") as HTMLButtonElement;
    await act(async () => {
      publishToggleButton.click();
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    setInputValue(inputs[1] as HTMLInputElement, "openai/demo");
    setInputValue(inputs[2] as HTMLInputElement, "images/cat.png");

    const publishButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Publish") as HTMLButtonElement;
    await act(async () => {
      publishButton.click();
    });
    expect(publishButton.disabled).toBe(true);
    expect(container.textContent).toContain("Publishing...");

    await act(async () => {
      resolvePublish?.({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
        },
      });
    });
  });

  it("re-checks published backing existence from the artifact detail panel", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        { storageKey: "uploads/cat.png", artifactFamily: "image" as const },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
        metadata: {
          publishedBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/cat.png",
              locator: "openai/demo/images/cat.png",
            },
            verification: { exists: false },
          },
        },
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue("/api/artifact/media/view?storageKey=uploads%2Fcat.png"),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-18T00:00:00.000Z",
        },
      }),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    const artifactButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("uploads/cat.png")) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });

    const recheckButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Re-check published backing") as HTMLButtonElement;
    await act(async () => {
      recheckButton.click();
    });

    expect(client.verifyPublishedArtifactBacking).toHaveBeenCalledWith({ artifactId: "uploads/cat.png" });
    expect(container.textContent).toContain("Last checked:");
  });

  it("registers an artifact from Hugging Face and selects it", async () => {
    const client = {
      browseArtifacts: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { storageKey: "imports/huggingface/openai/demo/main/images/cat.png", artifactFamily: "image" as const },
        ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "imports/huggingface/openai/demo/main/images/cat.png" },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi.fn().mockRejectedValue(new Error("missing local bytes")),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn().mockResolvedValue({
        artifactId: "imports/huggingface/openai/demo/main/images/cat.png",
        backing: {
          role: "imported-source" as const,
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            revision: "main",
            locator: "openai/demo/images/cat.png",
          },
          verification: {
            exists: true as const,
            verifiedAt: "2026-04-18T00:00:00.000Z",
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    const registerToggle = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Register from Hugging Face") as HTMLButtonElement;
    await act(async () => {
      registerToggle.click();
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    setInputValue(inputs[2] as HTMLInputElement, "openai/demo");
    setInputValue(inputs[3] as HTMLInputElement, "images/cat.png");

    const registerButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Register") as HTMLButtonElement;
    await act(async () => {
      registerButton.click();
    });

    expect(client.registerArtifactFromRepo).toHaveBeenCalledWith({
      repository: "openai/demo",
      path: "images/cat.png",
      revision: "main",
      mediaType: undefined,
    });
    expect(container.textContent).toContain("Registered imports/huggingface/openai/demo/main/images/cat.png from Hugging Face.");
  });

  it("renders dataset cards with per-card file viewer and register actions", async () => {
    const client = {
      browseArtifacts: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { storageKey: "imports/huggingface/openai/demo/main/data/train.parquet", artifactFamily: "image" as const },
        ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "imports/huggingface/openai/demo/main/data/train.parquet" },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi.fn().mockRejectedValue(new Error("missing local bytes")),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      browseHuggingFaceNamespaceDatasets: vi.fn().mockResolvedValue([
        { namespace: "openai", repository: "openai/demo" },
      ]),
      browseHuggingFaceDatasetParquetFiles: vi.fn().mockResolvedValue([
        { repository: "openai/demo", path: "data/train.parquet", revision: "main" },
      ]),
      registerArtifactFromRepo: vi.fn().mockResolvedValue({
        artifactId: "imports/huggingface/openai/demo/main/data/train.parquet",
        backing: {
          role: "imported-source" as const,
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "data/train.parquet",
            revision: "main",
            locator: "openai/demo/data/train.parquet",
          },
          verification: {
            exists: true as const,
            verifiedAt: "2026-04-18T00:00:00.000Z",
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    const registerToggle = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Register from Hugging Face") as HTMLButtonElement;
    await act(async () => {
      registerToggle.click();
    });

    const namespaceInput = Array.from(container.querySelectorAll("input"))[1] as HTMLInputElement;
    setInputValue(namespaceInput, "openai");
    const registerNamespaceButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Register namespace") as HTMLButtonElement;
    await act(async () => {
      registerNamespaceButton.click();
    });

    const datasetButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "View Files") as HTMLButtonElement;
    await act(async () => {
      datasetButton.click();
    });

    expect(client.browseHuggingFaceDatasetParquetFiles).toHaveBeenCalledWith({
      repository: "openai/demo",
      revision: "main",
    });
    expect(container.textContent).toContain("Dataset files");
    expect(container.textContent).toContain("data/train.parquet");

    const registerFileButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Register") as HTMLButtonElement;
    await act(async () => {
      registerFileButton.click();
    });

    expect(client.registerArtifactFromRepo).toHaveBeenCalledWith({
      repository: "openai/demo",
      path: "data/train.parquet",
      revision: "main",
      mediaType: undefined,
    });

    const closeButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Close") as HTMLButtonElement;
    await act(async () => {
      closeButton.click();
    });

    expect(container.textContent).not.toContain("Dataset files");
  });

  it("renders per-card dataset file errors", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      browseHuggingFaceNamespaceDatasets: vi.fn().mockResolvedValue([
        { namespace: "openai", repository: "openai/demo" },
      ]),
      browseHuggingFaceDatasetParquetFiles: vi.fn().mockRejectedValue(new Error("Failed to load dataset files.")),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    const registerToggle = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Register from Hugging Face") as HTMLButtonElement;
    await act(async () => {
      registerToggle.click();
    });

    const namespaceInput = Array.from(container.querySelectorAll("input"))[1] as HTMLInputElement;
    setInputValue(namespaceInput, "openai");
    const registerNamespaceButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Register namespace") as HTMLButtonElement;
    await act(async () => {
      registerNamespaceButton.click();
    });

    const datasetButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "View Files") as HTMLButtonElement;
    await act(async () => {
      datasetButton.click();
    });

    expect(container.textContent).toContain("Failed to load dataset files.");
  });

  it("localizes imported artifact bytes from the artifact panel", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        { storageKey: "artifacts/20260418000000-local01", artifactFamily: "image" as const },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "artifacts/20260418000000-local01" },
        artifactFamily: "image" as const,
        metadata: {
          importedSourceBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/cat.png",
              revision: "main",
            },
            verification: { exists: true },
          },
        },
      }),
      readArtifactContent: vi.fn()
        .mockResolvedValueOnce({
          locator: { storageKey: "artifacts/20260418000000-local01" },
          availability: "unavailable" as const,
          retrieval: "deferred" as const,
        })
        .mockResolvedValueOnce({
          locator: { storageKey: "artifacts/20260418000000-local01" },
          availability: "available" as const,
          retrieval: "deferred" as const,
        }),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue("/api/artifact/media/view?storageKey=artifacts%2F20260418000000-local01"),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        artifactId: "artifacts/20260418000000-local01",
        localObject: {
          key: "artifacts/20260418000000-local01",
          mediaType: "image/png",
          sizeBytes: 3,
        },
        source: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          locator: "openai/demo/images/cat.png",
        },
        localizedAt: "2026-04-18T00:00:00.000Z",
      }),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    const artifactButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("artifacts/20260418000000-local01")) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });

    const localizeButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Localize artifact") as HTMLButtonElement;
    await act(async () => {
      localizeButton.click();
    });

    expect(client.localizeArtifactFromRepo).toHaveBeenCalledWith({
      artifactId: "artifacts/20260418000000-local01",
    });
    expect(container.textContent).toContain("Localized artifacts/20260418000000-local01 to local object storage.");
  });

  it("shows source verification and remote-only/localized state cues based on backing state", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "artifacts/20260418000000-local01",
          artifactFamily: "image" as const,
          metadata: {
            backingState: {
              hasImportedSourceBacking: true,
              hasPublishedBacking: true,
              hasLocalObjectAvailable: false,
              isLocalized: false,
              isRemoteOnly: true,
            },
          },
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "artifacts/20260418000000-local01" },
        artifactFamily: "image" as const,
        metadata: {
          importedSourceBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/cat.png",
              revision: "main",
            },
            verification: { exists: true, verifiedAt: "2026-04-18T00:00:00.000Z" },
          },
          publishedBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo-public",
              path: "images/cat.png",
              revision: "main",
            },
            verification: { exists: true, verifiedAt: "2026-04-18T00:00:00.000Z" },
          },
        },
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "artifacts/20260418000000-local01" },
        availability: "unavailable" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi.fn().mockReturnValue(""),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn().mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      verifyImportedSourceBacking: vi.fn().mockResolvedValue({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
        },
        verification: { exists: true, verifiedAt: "2026-04-19T00:00:00.000Z" },
      }),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<ArtifactBrowserFeature client={client} />);
    });

    expect(container.textContent).toContain("Remote only");
    expect(container.textContent).toContain("Published");

    const artifactButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("artifacts/20260418000000-local01")) as HTMLButtonElement;
    await act(async () => {
      artifactButton.click();
    });

    expect(container.textContent).toContain("Remote-only artifact. Local preview is unavailable until localization.");
    expect(container.textContent).toContain("Re-check source backing");
    expect(container.textContent).toContain("Localize artifact");
  });
});

