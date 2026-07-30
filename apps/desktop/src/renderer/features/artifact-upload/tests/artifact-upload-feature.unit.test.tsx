import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationTestHarness, readNotificationMessages } from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { ArtifactIngestionFeature } from "../components/ArtifactIngestionFeature";

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ArtifactIngestionFeature", () => {
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

  it("renders Hugging Face ingestion controls in the upload card", async () => {
    const uploadClient = {
      uploadArtifact: vi.fn(),
      ingestWebsitePage: vi.fn(),
      ingestWebsitePagesBatch: vi.fn(),
      getAcceptedTypes: vi.fn().mockResolvedValue({ acceptedExtensions: [".md"], acceptedMediaTypes: ["text/markdown"] }),
    };
    const ingestionClient = {
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
      browseArtifacts: vi.fn(),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn(),
      readArtifactMedia: vi.fn(),
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
      root.render(<ArtifactIngestionFeature client={uploadClient} ingestionClient={ingestionClient} />);
    });

    expect(container.textContent).toContain("Data Artifact Ingester");
    expect(container.textContent).toContain("Scrape web data");
    expect(container.textContent).toContain("Import from Hugging Face");

    const scrapeToggle = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Scrape web data")) as HTMLButtonElement;
    await act(async () => {
      scrapeToggle.click();
    });
    expect(container.textContent).toContain("Ingest page");
    expect(container.textContent).toContain("Ingest batch");

    const huggingFaceToggle = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Import from Hugging Face")) as HTMLButtonElement;
    await act(async () => {
      huggingFaceToggle.click();
    });
    expect(container.textContent).toContain("Hugging Face settings");
    expect(container.textContent).toContain("Namespace (user/org)");
    expect(container.textContent).not.toContain("Register from Hugging Face");
  });

  it("toggles Hugging Face dataset selection and renders import action labels", async () => {
    const uploadClient = {
      uploadArtifact: vi.fn(),
      ingestWebsitePage: vi.fn(),
      ingestWebsitePagesBatch: vi.fn(),
      getAcceptedTypes: vi.fn().mockResolvedValue({ acceptedExtensions: [".md"], acceptedMediaTypes: ["text/markdown"] }),
    };
    const ingestionClient = {
      browseHuggingFaceNamespaceDatasets: vi.fn().mockResolvedValue([
        { repository: "openai/dataset-one", id: "openai/dataset-one" },
        { repository: "openai/dataset-two", id: "openai/dataset-two" },
      ]),
      browseHuggingFaceDatasetParquetFiles: vi.fn(async ({ repository, revision }: { repository: string; revision?: string }) => [
        { repository, revision: revision ?? "main", path: `${repository.split("/").pop() ?? "dataset"}.parquet` },
      ]),
      getHuggingFaceTokenStatus: vi.fn().mockResolvedValue({ configured: false }),
      setHuggingFaceToken: vi.fn(),
      clearHuggingFaceToken: vi.fn(),
      browseArtifacts: vi.fn(),
      readArtifactDetail: vi.fn(),
      readArtifactContent: vi.fn(),
      createArtifactMediaViewUrl: vi.fn(),
      readArtifactMedia: vi.fn(),
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
        <NotificationTestHarness>
          <ArtifactIngestionFeature client={uploadClient} ingestionClient={ingestionClient} />
        </NotificationTestHarness>,
      );
    });

    const huggingFaceToggle = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Import from Hugging Face")) as HTMLButtonElement;
    await act(async () => {
      huggingFaceToggle.click();
    });

    const namespaceInput = Array.from(container.querySelectorAll("input")).find((input) => input.getAttribute("placeholder") === "user or organization") as HTMLInputElement;
    await act(async () => {
      setInputValue(namespaceInput, "openai");
    });

    const findDatasetsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Find datasets") as HTMLButtonElement;
    await act(async () => {
      findDatasetsButton.click();
    });

    expect(ingestionClient.browseHuggingFaceNamespaceDatasets).toHaveBeenCalledWith({ namespace: "openai" });
    expect(readNotificationMessages(container)).not.toContain("Found 2 dataset(s).");
    expect(container.textContent).not.toContain("Found 2 dataset(s).");
    expect(container.textContent).toContain("View importable files from dataset");
    expect(container.textContent).toContain("Import all files from selected datasets");

    const selectAllButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Select all") as HTMLButtonElement;
    await act(async () => {
      selectAllButton.click();
    });

    const checkboxes = Array.from(container.querySelectorAll("input[type=\"checkbox\"]")) as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);
    expect(container.textContent).toContain("Deselect all");

    const deselectAllButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Deselect all") as HTMLButtonElement;
    await act(async () => {
      deselectAllButton.click();
    });

    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(false);
    expect(container.textContent).toContain("Select all");

    const selectAllDatasetsAgainButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Select all") as HTMLButtonElement;
    await act(async () => {
      selectAllDatasetsAgainButton.click();
    });

    const viewImportableFilesButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "View importable files from dataset") as HTMLButtonElement;
    await act(async () => {
      viewImportableFilesButton.click();
    });

    expect(ingestionClient.browseHuggingFaceDatasetParquetFiles).toHaveBeenCalledTimes(2);
    const fileCheckboxes = Array.from(container.querySelectorAll("label"))
      .filter((label) => label.textContent?.includes(".parquet"))
      .map((label) => label.querySelector("input") as HTMLInputElement);
    expect(fileCheckboxes).toHaveLength(2);

    const selectAllFilesButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Select all files") as HTMLButtonElement;
    await act(async () => {
      selectAllFilesButton.click();
    });

    expect(fileCheckboxes.every((checkbox) => checkbox.checked)).toBe(true);
    expect(container.textContent).toContain("Deselect all files");

    const deselectAllFilesButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Deselect all files") as HTMLButtonElement;
    await act(async () => {
      deselectAllFilesButton.click();
    });

    expect(fileCheckboxes.every((checkbox) => checkbox.checked)).toBe(false);
    expect(container.textContent).toContain("Select all files");
  });
});
