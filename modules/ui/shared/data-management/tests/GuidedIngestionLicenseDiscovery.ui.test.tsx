// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GuidedIngestionTaskPanel } from "../GuidedIngestionTaskPanel";

it("filters provider-declared licenses and clears checked files when the filter changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const namespace = "example";
  const revision = "a".repeat(40);
  const browseFiles = vi.fn(async ({ repository }: { repository: string }) => [
    { repository, path: "data/train.parquet", revision },
  ]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <GuidedIngestionTaskPanel workspaceId="workspace-a" client={{ execute: vi.fn() }}
        sourceBrowserClient={{
          browseHuggingFaceNamespaceDatasets: async () => [
            { namespace, repository: "example/cc", licenseIds: ["cc-by-4.0"] },
            { namespace, repository: "example/mit", licenseIds: ["mit"] },
            { namespace, repository: "example/restricted", licenseIds: ["cc-by-nc-4.0", "mit"] },
            { namespace, repository: "example/unrecognized", licenseIds: ["UNTRUSTED_LABEL_CANARY"] },
          ],
          browseHuggingFaceDatasetParquetFiles: browseFiles,
        }}
      />,
    ));
    const radio = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .find((input) => input.parentElement?.textContent?.includes("Hugging Face dataset"))!;
    const button = (label: string) => Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent === label)!;
    await act(async () => radio.click());
    const namespaceInput = container.querySelector<HTMLInputElement>('input[placeholder="Hugging Face name"]')!;
    await act(async () => {
      namespaceInput.value = namespace;
      namespaceInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => button("Find datasets").click());
    const checkboxes = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label]'));
    const visibleRepositories = () => checkboxes().map((input) => input.getAttribute("aria-label"));
    const filter = Array.from(container.querySelectorAll("select"))
      .find((select) => select.options[0]?.text === "All data")!;
    const changeFilter = (value: string) => act(async () => {
      filter.value = value;
      filter.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(filter.value).toBe("all");
    expect(checkboxes()).toHaveLength(4);
    expect(container.textContent).toContain("Non-open license (cc-by-nc-4.0, mit)");
    expect(container.textContent).toContain("License unknown");
    expect(container.textContent).not.toContain("UNTRUSTED_LABEL_CANARY");

    await act(async () => checkboxes().find((input) => input.getAttribute("aria-label") === "example/restricted")!.click());
    await act(async () => button("View files from selected datasets").click());
    expect(container.textContent).toContain("data/train.parquet");

    await changeFilter("creative-commons");
    expect(visibleRepositories()).toEqual(["example/cc"]);
    expect(container.textContent).not.toContain("data/train.parquet");
    expect(button("View files from selected datasets").disabled).toBe(true);
    await act(async () => button("Select all").click());
    await act(async () => button("View files from selected datasets").click());
    expect(browseFiles.mock.calls).toEqual([
      [{ repository: "example/restricted" }],
      [{ repository: "example/cc" }],
    ]);

    await changeFilter("other-open");
    expect(visibleRepositories()).toEqual(["example/mit"]);
    await changeFilter("all");
    expect(checkboxes().every((input) => !input.checked)).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
