import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactIngestionFeature } from "../components/ArtifactIngestionFeature";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
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

  it("renders only the guided ingestion workflow", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactIngestionFeature
          ingestionClient={
            {
              getHuggingFaceTokenStatus: vi
                .fn()
                .mockResolvedValue({ configured: false }),
              browseHuggingFaceNamespaceDatasets: vi.fn(),
              browseHuggingFaceDatasetParquetFiles: vi.fn(),
            } as never
          }
        />,
      );
    });

    expect(container.textContent).toContain("1. Choose a source");
    expect(container.textContent).toContain("2. Select the data");
    expect(container.textContent).toContain("3. Add data");
    expect(container.textContent).toContain("Files");
    expect(container.textContent).toContain("Website pages");
    expect(container.textContent).toContain("Hugging Face dataset");
    expect(container.textContent).not.toContain("Other import tools");
    expect(container.textContent).not.toContain("Upload data");
    expect(container.textContent).not.toContain("Scrape web data");
    expect(container.textContent).not.toContain("Import from Hugging Face");
  });

  it("uses the supplied host browser and shows the token-only settings card in Step 2", async () => {
    const getHuggingFaceTokenStatus = vi
      .fn()
      .mockResolvedValue({ configured: false });
    const browseHuggingFaceNamespaceDatasets = vi
      .fn()
      .mockResolvedValue([
        { namespace: "openai", repository: "openai/example-data" },
      ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <ArtifactIngestionFeature
          ingestionClient={
            {
              getHuggingFaceTokenStatus,
              setHuggingFaceToken: vi.fn(),
              clearHuggingFaceToken: vi.fn(),
              browseHuggingFaceNamespaceDatasets,
              browseHuggingFaceDatasetParquetFiles: vi.fn(),
            } as never
          }
        />,
      );
    });
    const providerChoice = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((input) =>
      input.parentElement?.textContent?.includes("Hugging Face dataset"),
    )!;
    await act(async () => {
      providerChoice.click();
      await Promise.resolve();
    });

    expect(getHuggingFaceTokenStatus).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Hugging Face settings");
    expect(container.textContent).toContain("Hugging Face token");
    expect(container.textContent).not.toContain("Default namespace");
    expect(container.textContent).not.toContain(
      "Hugging Face browsing is not available in the current session.",
    );

    const namespaceInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Hugging Face name"]',
    )!;
    await act(async () => setInputValue(namespaceInput, "openai"));
    const findDatasets = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Find datasets",
    )!;
    await act(async () => {
      findDatasets.click();
      await Promise.resolve();
    });

    expect(browseHuggingFaceNamespaceDatasets).toHaveBeenCalledWith({
      namespace: "openai",
    });
    expect(container.textContent).toContain("openai/example-data");
  });
});
