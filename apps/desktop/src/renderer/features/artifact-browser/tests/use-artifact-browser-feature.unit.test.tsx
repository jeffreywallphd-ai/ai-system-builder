import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactBrowserFeature } from "../components/ArtifactBrowserFeature";
import {
  NotificationTestHarness,
  readNotificationMessages,
} from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  );
  descriptor?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function findArtifactDetailsButton(
  container: HTMLElement,
  storageKey: string,
): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) =>
      candidate.textContent === "View Details" &&
      Boolean(
        candidate
          .closest("article, section, li")
          ?.textContent?.includes(storageKey),
      ),
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Unable to find View Details button for ${storageKey}.`);
  }

  return button;
}

describe("Desktop ArtifactBrowserFeature publish flow", () => {
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
    vi.unstubAllGlobals();
  });

  it("opens the requested saved artifact in the detail dialog", async () => {
    const storageKey = "datasets/support-tickets-2026.parquet";
    const onInitialSelectionHandled = vi.fn();
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey,
          originalName: "support-tickets-2026.parquet",
          artifactFamily: "tabular" as const,
          mediaType: "application/vnd.apache.parquet",
          sourceKind: "runtime",
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey },
        originalName: "support-tickets-2026.parquet",
        artifactFamily: "tabular" as const,
        mediaType: "application/vnd.apache.parquet",
        sizeBytes: 4,
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey },
        mediaType: "application/vnd.apache.parquet",
        sizeBytes: 4,
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi.fn().mockResolvedValue(""),
      readArtifactMedia: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountedContainer = container;
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <ArtifactBrowserFeature
          client={client}
          workspaceId="workspace-a"
          initialSelectedStorageKey={storageKey}
          onInitialSelectionHandled={onInitialSelectionHandled}
        />,
      );
    });

    await vi.waitFor(() =>
      expect(client.readArtifactDetail).toHaveBeenCalledWith(
        { storageKey },
        { workspaceId: "workspace-a" },
      ),
    );
    expect(document.body.textContent).toContain(storageKey);
    expect(onInitialSelectionHandled).toHaveBeenCalledOnce();
  });

  it("enables Convert to RAG only after authoritative readiness and forwards the artifact id", async () => {
    const storageKey = "datasets/chunked-support.parquet";
    const onConvertToRag = vi.fn();
    const readContextConversionReadiness = vi.fn().mockResolvedValue({
      artifactId: storageKey,
      ready: true,
      locallyReadable: true,
      textFields: ["question", "answer"],
      alreadyChunked: true,
      chunkCount: 4,
    });
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey,
          originalName: "chunked-support.parquet",
          artifactFamily: "tabular" as const,
          mediaType: "application/vnd.apache.parquet",
          sourceKind: "runtime",
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey },
        originalName: "chunked-support.parquet",
        artifactFamily: "tabular" as const,
        mediaType: "application/vnd.apache.parquet",
        sizeBytes: 4,
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey },
        mediaType: "application/vnd.apache.parquet",
        sizeBytes: 4,
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi.fn().mockResolvedValue(""),
      readArtifactMedia: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
      publishArtifactToHuggingFace: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountedContainer = container;
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <ArtifactBrowserFeature
          client={client}
          workspaceId="workspace-a"
          initialSelectedStorageKey={storageKey}
          readContextConversionReadiness={readContextConversionReadiness}
          onConvertToRag={onConvertToRag}
        />,
      );
    });

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "4 persisted chunks are ready to reuse.",
      ),
    );
    const convert = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((candidate) => candidate.textContent === "Convert to RAG database")!;
    expect(convert.disabled).toBe(false);
    await act(async () => convert.click());
    expect(readContextConversionReadiness).toHaveBeenCalledWith(storageKey);
    expect(onConvertToRag).toHaveBeenCalledWith(storageKey);
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
      createArtifactMediaViewUrl: vi
        .fn()
        .mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
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
      root.render(
        <NotificationTestHarness>
          <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />
        </NotificationTestHarness>,
      );
    });

    const artifactButton = findArtifactDetailsButton(
      container,
      "uploads/cat.png",
    );
    await act(async () => {
      artifactButton.click();
    });

    const publishToggleButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Publish to Hugging Face",
    ) as HTMLButtonElement;
    await act(async () => {
      publishToggleButton.click();
    });

    const inputs = Array.from(document.body.querySelectorAll("input"));
    setInputValue(inputs[0] as HTMLInputElement, "openai/demo");
    setInputValue(inputs[2] as HTMLInputElement, "images");
    const creationCheckbox = document.body.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    await act(async () => {
      creationCheckbox.click();
    });
    expect(document.body.textContent).toContain("Private (recommended)");

    const publishButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Publish") as HTMLButtonElement;
    await act(async () => {
      publishButton.click();
    });

    expect(client.publishArtifactToHuggingFace).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      artifactId: "uploads/cat.png",
      repository: "openai/demo",
      path: "images/cat.png",
      revision: "main",
      mediaType: "",
      repositoryCreation: { approved: true, visibility: "private" },
    });
    expect(document.body.textContent).toContain("Published Backing");
    expect(document.body.textContent).toContain("openai/demo");
    expect(document.body.textContent).toContain("Not yet verified");
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
      createArtifactMediaViewUrl: vi
        .fn()
        .mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
      clearHuggingFaceToken: vi.fn().mockResolvedValue({ configured: false }),
      publishArtifactToHuggingFace: vi
        .fn()
        .mockRejectedValue(new Error("Missing Hugging Face token.")),
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
      root.render(
        <NotificationTestHarness>
          <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />
        </NotificationTestHarness>,
      );
    });

    const artifactButton = findArtifactDetailsButton(
      container,
      "uploads/cat.png",
    );
    await act(async () => {
      artifactButton.click();
    });
    const publishToggleButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Publish to Hugging Face",
    ) as HTMLButtonElement;
    await act(async () => {
      publishToggleButton.click();
    });

    const inputs = Array.from(document.body.querySelectorAll("input"));
    setInputValue(inputs[0] as HTMLInputElement, "openai/demo");
    setInputValue(inputs[2] as HTMLInputElement, "images");

    const publishButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Publish") as HTMLButtonElement;
    await act(async () => {
      publishButton.click();
    });

    const notificationMessages = readNotificationMessages(container);
    expect(
      notificationMessages.some((message) =>
        message.includes("Missing Hugging Face token."),
      ),
    ).toBe(true);
    expect(
      notificationMessages.some((message) =>
        message.includes(
          "This Hugging Face repository may require an access token.",
        ),
      ),
    ).toBe(true);
  });

  it("renders Hugging Face defaults collapsed by default", async () => {
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
      createArtifactMediaViewUrl: vi
        .fn()
        .mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const artifactButton = findArtifactDetailsButton(
      container,
      "uploads/cat.png",
    );
    await act(async () => {
      artifactButton.click();
    });

    const defaultsPanelToggle = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("Hugging Face defaults"),
    ) as HTMLButtonElement;

    expect(defaultsPanelToggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps browser card focused on browsing and excludes ingestion controls", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi
        .fn()
        .mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    expect(document.body.textContent).toContain("Artifact Browser");
    expect(document.body.textContent).toContain("Artifact family");
    expect(document.body.textContent).toContain(
      "There are currently no uploaded artifacts in the workspace.",
    );
    expect(document.body.textContent).toContain(
      "There are currently no generated artifacts in the workspace.",
    );
    expect(document.body.textContent).not.toContain(
      "Register from Hugging Face",
    );
  });

  it("lists non-image artifacts and only renders image preview for image media types", async () => {
    const readParquetPreview = vi.fn().mockResolvedValue({
      totalRows: 12,
      rows: Array.from({ length: 10 }, (_, index) => ({
        values: {
          instruction: `Instruction ${index + 1}`,
          output: `Output ${index + 1}`,
        },
      })),
    });
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/cat.png",
          artifactFamily: "image" as const,
          mediaType: "image/png",
        },
        {
          storageKey: "uploads/train.parquet",
          artifactFamily: "tabular" as const,
          mediaType: "application/x-parquet",
        },
        {
          storageKey: "generated/train.json",
          originalName: "train.json",
          sourceKind: "generated",
          artifactFamily: "structured-text" as const,
          mediaType: "application/json",
        },
      ]),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/train.parquet" },
        artifactFamily: "tabular" as const,
        mediaType: "application/x-parquet",
        sourceKind: "upload",
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/train.parquet" },
        mediaType: "application/x-parquet",
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi
        .fn()
        .mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
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
      root.render(
        <ArtifactBrowserFeature
          client={client}
          workspaceId="workspace-a"
          readParquetPreview={readParquetPreview}
        />,
      );
    });

    expect(document.body.textContent).toContain("uploads/train.parquet");
    const generatedSection = document.body.querySelector<HTMLElement>(
      "[aria-label='Generated artifacts']",
    );
    const generatedCard = generatedSection?.querySelector<HTMLElement>(
      ".artifact-browser__artifact-card",
    );
    expect(
      generatedSection?.classList.contains("artifact-browser__uploaded-grid"),
    ).toBe(true);
    expect(generatedCard?.querySelector("h4")?.textContent).toBe("train.json");
    expect(generatedCard?.textContent).toContain("generated/train.json");
    expect(generatedCard?.textContent).toContain("Status: generated");
    const parquetButton = findArtifactDetailsButton(
      container,
      "uploads/train.parquet",
    );

    await act(async () => {
      parquetButton.click();
    });

    expect(client.createArtifactMediaViewUrl).not.toHaveBeenCalled();
    expect(document.body.querySelector("img")).toBeNull();
    expect(document.body.textContent).toContain("application/x-parquet");
    expect(document.body.textContent).toContain("tabular");
    expect(document.body.textContent).toContain("upload");
    expect(readParquetPreview).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      artifactKey: "uploads/train.parquet",
    });
    expect(document.body.textContent).toContain(
      "Showing the first 10 of 12 rows.",
    );
    expect(document.body.textContent).toContain("Instruction 1");
    expect(document.body.textContent).toContain("Instruction 10");
    expect(document.body.textContent).not.toContain("Instruction 11");
  });

  it("renders Unregistered Artifacts section and deletes only after exact typed confirmation", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      browseUnregisteredArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/orphan/report.pdf",
          relativePath: "orphan/report.pdf",
          fileName: "report.pdf",
          mediaType: "application/pdf",
        },
      ]),
      registerUnregisteredArtifact: vi
        .fn()
        .mockResolvedValue({ storageKey: "uploads/orphan/report.pdf" }),
      deleteUnregisteredArtifact: vi
        .fn()
        .mockResolvedValue({ storageKey: "uploads/orphan/report.pdf" }),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn(),
      readArtifactMedia: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    expect(document.body.textContent).toContain("Unregistered Artifacts");
    expect(document.body.textContent).toContain("orphan/report.pdf");

    const registerButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Register") as HTMLButtonElement;
    const deleteButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Delete") as HTMLButtonElement;

    await act(async () => {
      registerButton.click();
    });
    await act(async () => {
      deleteButton.click();
    });
    expect(document.body.textContent).toContain(
      "Type Delete to confirm this destructive action.",
    );

    const confirmationInput = Array.from(
      document.body.querySelectorAll("input"),
    ).find(
      (input) => input.getAttribute("placeholder") === "Delete",
    ) as HTMLInputElement;
    setInputValue(confirmationInput, "Delete");

    const confirmDeleteButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Confirm delete",
    ) as HTMLButtonElement;
    await act(async () => {
      confirmDeleteButton.click();
    });

    expect(client.registerUnregisteredArtifact).toHaveBeenCalledWith({
      storageKey: "uploads/orphan/report.pdf",
      workspaceId: "workspace-a",
    });
    expect(client.deleteUnregisteredArtifact).toHaveBeenCalledWith({
      storageKey: "uploads/orphan/report.pdf",
      workspaceId: "workspace-a",
    });
  });

  it("blocks unregistered delete when typed confirmation is not exact and supports cancel", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      browseUnregisteredArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "uploads/orphan/report.pdf",
          relativePath: "orphan/report.pdf",
          fileName: "report.pdf",
          mediaType: "application/pdf",
        },
      ]),
      registerUnregisteredArtifact: vi
        .fn()
        .mockResolvedValue({ storageKey: "uploads/orphan/report.pdf" }),
      deleteUnregisteredArtifact: vi
        .fn()
        .mockResolvedValue({ storageKey: "uploads/orphan/report.pdf" }),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn(),
      readArtifactMedia: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const deleteButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Delete") as HTMLButtonElement;

    await act(async () => {
      deleteButton.click();
    });

    const confirmationInput = Array.from(
      document.body.querySelectorAll("input"),
    ).find(
      (input) => input.getAttribute("placeholder") === "Delete",
    ) as HTMLInputElement;
    setInputValue(confirmationInput, "delete");

    const confirmDeleteButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Confirm delete",
    ) as HTMLButtonElement;
    await act(async () => {
      confirmDeleteButton.click();
    });

    expect(client.deleteUnregisteredArtifact).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Type Delete to confirm this destructive action.",
    );

    const cancelButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "Cancel") as HTMLButtonElement;
    await act(async () => {
      cancelButton.click();
    });

    expect(document.body.textContent).not.toContain("Confirm delete");
  });

  it("blocks registered delete when typed confirmation is not exact and does not use browser prompt", async () => {
    const promptSpy = vi.fn(() => "Delete");
    vi.stubGlobal("prompt", promptSpy);
    const client = {
      browseArtifacts: vi
        .fn()
        .mockResolvedValue([
          { storageKey: "uploads/cat.png", artifactFamily: "image" as const },
        ]),
      deleteRegisteredArtifact: vi
        .fn()
        .mockResolvedValue({ storageKey: "uploads/cat.png" }),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi
        .fn()
        .mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const artifactButton = findArtifactDetailsButton(
      container,
      "uploads/cat.png",
    );
    await act(async () => {
      artifactButton.click();
    });

    const deleteButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Delete registered artifact",
    ) as HTMLButtonElement;

    await act(async () => {
      deleteButton.click();
    });

    const confirmationInput = Array.from(
      document.body.querySelectorAll("input"),
    ).find(
      (input) => input.getAttribute("placeholder") === "Delete",
    ) as HTMLInputElement;
    setInputValue(confirmationInput, "DELETE");

    const confirmDeleteButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Confirm delete",
    ) as HTMLButtonElement;
    await act(async () => {
      confirmDeleteButton.click();
    });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(client.deleteRegisteredArtifact).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Type Delete to confirm this destructive action.",
    );
  });

  it("deletes registered artifact only after exact typed confirmation", async () => {
    const client = {
      browseArtifacts: vi
        .fn()
        .mockResolvedValue([
          { storageKey: "uploads/cat.png", artifactFamily: "image" as const },
        ]),
      deleteRegisteredArtifact: vi
        .fn()
        .mockResolvedValue({ storageKey: "uploads/cat.png" }),
      readArtifactDetail: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        artifactFamily: "image" as const,
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "uploads/cat.png" },
        availability: "available" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi
        .fn()
        .mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const artifactButton = findArtifactDetailsButton(
      container,
      "uploads/cat.png",
    );
    await act(async () => {
      artifactButton.click();
    });

    const deleteButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Delete registered artifact",
    ) as HTMLButtonElement;
    await act(async () => {
      deleteButton.click();
    });

    const confirmationInput = Array.from(
      document.body.querySelectorAll("input"),
    ).find(
      (input) => input.getAttribute("placeholder") === "Delete",
    ) as HTMLInputElement;
    setInputValue(confirmationInput, "Delete");

    const confirmDeleteButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Confirm delete",
    ) as HTMLButtonElement;
    await act(async () => {
      confirmDeleteButton.click();
    });

    expect(client.deleteRegisteredArtifact).toHaveBeenCalledWith({
      storageKey: "uploads/cat.png",
      workspaceId: "workspace-a",
    });
  });

  it("renders family filter select and requests filtered browse", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([]),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn(),
      readArtifactMedia: vi.fn(),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    expect(document.body.textContent).toContain("Artifact family");
    const familySelect = document.body.querySelector(
      "select",
    ) as HTMLSelectElement;
    expect(familySelect).toBeTruthy();
    expect(
      Array.from(familySelect.options).map((option) => option.value),
    ).toContain("all");
    expect(
      Array.from(familySelect.options).map((option) => option.value),
    ).toContain("structured-text");

    await act(async () => {
      setSelectValue(familySelect, "tabular");
    });

    expect(client.browseArtifacts).toHaveBeenCalledWith({
      artifactFamily: "tabular",
      workspaceId: "workspace-a",
    });
  });

  it("re-checks published backing existence from the artifact detail panel", async () => {
    const client = {
      browseArtifacts: vi
        .fn()
        .mockResolvedValue([
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
      createArtifactMediaViewUrl: vi
        .fn()
        .mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const artifactButton = findArtifactDetailsButton(
      container,
      "uploads/cat.png",
    );
    await act(async () => {
      artifactButton.click();
    });

    const recheckButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Re-check published backing",
    ) as HTMLButtonElement;
    await act(async () => {
      recheckButton.click();
    });

    expect(client.verifyPublishedArtifactBacking).toHaveBeenCalledWith({
      artifactId: "uploads/cat.png",
    });
    expect(document.body.textContent).toContain("Last checked:");
  });

  it("localizes imported artifact bytes from the artifact panel", async () => {
    const client = {
      browseArtifacts: vi.fn().mockResolvedValue([
        {
          storageKey: "artifacts/20260418000000-local01",
          artifactFamily: "image" as const,
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
            verification: { exists: true },
          },
        },
      }),
      readArtifactContent: vi
        .fn()
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
      createArtifactMediaViewUrl: vi
        .fn()
        .mockResolvedValue("blob:desktop-preview"),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    const artifactButton = findArtifactDetailsButton(
      container,
      "artifacts/20260418000000-local01",
    );
    await act(async () => {
      artifactButton.click();
    });

    const localizeButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find(
      (button) => button.textContent === "Localize artifact",
    ) as HTMLButtonElement;
    await act(async () => {
      localizeButton.click();
    });

    expect(client.localizeArtifactFromRepo).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      artifactId: "artifacts/20260418000000-local01",
    });
    expect(document.body.textContent).toContain(
      "Localized bytes key: artifacts/20260418000000-local01",
    );
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
            verification: {
              exists: true,
              verifiedAt: "2026-04-18T00:00:00.000Z",
            },
          },
          publishedBacking: {
            target: {
              provider: "huggingface",
              repository: "openai/demo-public",
              path: "images/cat.png",
              revision: "main",
            },
            verification: {
              exists: true,
              verifiedAt: "2026-04-18T00:00:00.000Z",
            },
          },
        },
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "artifacts/20260418000000-local01" },
        availability: "unavailable" as const,
        retrieval: "deferred" as const,
      }),
      createArtifactMediaViewUrl: vi.fn().mockResolvedValue(""),
      readArtifactMedia: vi.fn().mockResolvedValue({
        mediaType: "text/plain",
        bytes: new Uint8Array([97]),
      }),
      getHuggingFaceTokenStatus: vi
        .fn()
        .mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi
        .fn()
        .mockResolvedValue({ configured: true, maskedToken: "••••1234" }),
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
      root.render(
        <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
      );
    });

    expect(document.body.textContent).toContain("Remote only");
    expect(document.body.textContent).toContain("Published");

    const artifactButton = findArtifactDetailsButton(
      container,
      "artifacts/20260418000000-local01",
    );
    await act(async () => {
      artifactButton.click();
    });

    expect(document.body.textContent).toContain(
      "Remote-only artifact. Local preview is unavailable until localization.",
    );
    expect(document.body.textContent).toContain("Re-check source backing");
    expect(document.body.textContent).toContain("Localize artifact");
  });
});

it("renders website capture metadata and HTML source preview for website-ingested artifacts", async () => {
  const client = {
    browseArtifacts: vi.fn().mockResolvedValue([
      {
        storageKey: "staged/website/example.com/index.html",
        artifactFamily: "structured-text" as const,
        mediaType: "text/html",
      },
    ]),
    readArtifactDetail: vi.fn().mockResolvedValue({
      locator: { storageKey: "staged/website/example.com/index.html" },
      artifactFamily: "structured-text" as const,
      mediaType: "text/html",
      sourceKind: "scrape",
      metadata: {
        websiteCapture: {
          sourceUrl: "https://example.com",
          resolvedUrl: "https://example.com/",
          requestedMode: "automatic",
          acquisitionMechanismUsed: "simple-http",
          retrievedAt: "2026-04-18T00:00:00.000Z",
          httpStatus: 200,
          contentTypeHeader: "text/html; charset=utf-8",
        },
      },
    }),
    readArtifactContent: vi.fn().mockResolvedValue({
      locator: { storageKey: "staged/website/example.com/index.html" },
      mediaType: "text/html",
      availability: "available" as const,
      retrieval: "deferred" as const,
    }),
    createArtifactMediaViewUrl: vi
      .fn()
      .mockResolvedValue("blob:desktop-preview"),
    readArtifactMedia: vi.fn().mockResolvedValue({
      mediaType: "text/html",
      bytes: new TextEncoder().encode(
        "<html><body><h1>Hello</h1></body></html>",
      ),
    }),
    getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
    setHuggingFaceToken: vi.fn(),
    clearHuggingFaceToken: vi.fn(),
    publishArtifactToHuggingFace: vi.fn(),
    verifyPublishedArtifactBacking: vi.fn(),
    registerArtifactFromRepo: vi.fn(),
    localizeArtifactFromRepo: vi.fn(),
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
    );
  });

  const artifactButton = findArtifactDetailsButton(
    container,
    "staged/website/example.com/index.html",
  );

  await act(async () => {
    artifactButton.click();
  });

  expect(document.body.textContent).toContain("Website capture metadata");
  expect(document.body.textContent).toContain("https://example.com/");
  expect(document.body.textContent).toContain("simple-http");
  expect(document.body.textContent).toContain("HTML source preview");
  expect(document.body.textContent).toContain(
    "<html><body><h1>Hello</h1></body></html>",
  );
  expect(client.createArtifactMediaViewUrl).not.toHaveBeenCalled();
  expect(client.readArtifactMedia).toHaveBeenCalledWith(
    { storageKey: "staged/website/example.com/index.html" },
    { maximumBytes: 65_536, workspaceId: "workspace-a" },
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();
});

it("revokes prior object URLs when image preview selection changes and on unmount", async () => {
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });

  const client = {
    browseArtifacts: vi.fn().mockResolvedValue([
      {
        storageKey: "uploads/cat-1.png",
        artifactFamily: "image" as const,
        mediaType: "image/png",
      },
      {
        storageKey: "uploads/cat-2.png",
        artifactFamily: "image" as const,
        mediaType: "image/png",
      },
    ]),
    readArtifactDetail: vi
      .fn()
      .mockImplementation(async ({ storageKey }: { storageKey: string }) => ({
        locator: { storageKey },
        artifactFamily: "image" as const,
        mediaType: "image/png",
      })),
    readArtifactContent: vi.fn().mockResolvedValue({
      locator: { storageKey: "uploads/cat-1.png" },
      mediaType: "image/png",
      availability: "available" as const,
      retrieval: "deferred" as const,
    }),
    createArtifactMediaViewUrl: vi
      .fn()
      .mockResolvedValueOnce("blob:desktop-preview-1")
      .mockResolvedValueOnce("blob:desktop-preview-2"),
    readArtifactMedia: vi.fn(),
    getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
    setHuggingFaceToken: vi.fn(),
    clearHuggingFaceToken: vi.fn(),
    publishArtifactToHuggingFace: vi.fn(),
    verifyPublishedArtifactBacking: vi.fn(),
    registerArtifactFromRepo: vi.fn(),
    localizeArtifactFromRepo: vi.fn(),
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <ArtifactBrowserFeature client={client} workspaceId="workspace-a" />,
    );
  });

  const first = findArtifactDetailsButton(container, "uploads/cat-1.png");
  const second = findArtifactDetailsButton(container, "uploads/cat-2.png");

  await act(async () => {
    first.click();
  });

  await act(async () => {
    second.click();
  });

  expect(revokeObjectURL).toHaveBeenCalledWith("blob:desktop-preview-1");

  await act(async () => {
    root.unmount();
  });

  expect(revokeObjectURL).toHaveBeenCalledWith("blob:desktop-preview-2");
  container.remove();
});
