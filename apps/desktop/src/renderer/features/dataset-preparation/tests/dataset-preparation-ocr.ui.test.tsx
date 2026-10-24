import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";
import { resetDatasetPreparationPageStateForTests, useDatasetPreparationFeature } from "../hooks/useDatasetPreparationFeature";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const STORAGE = "ai-system-builder.datasetPreparation.trainingSettings.v1";

describe("desktop scanned-PDF preparation", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const field = (name: string) => Array.from(container.querySelectorAll("label"))
    .find((label) => label.textContent?.includes(name))?.querySelector("input,select") as HTMLInputElement | HTMLSelectElement;
  async function change(name: string, value: string) {
    const input = field(name); expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); await flush();
    });
  }
  async function toggle(name: string) {
    const input = field(name) as HTMLInputElement; expect(input).toBeTruthy();
    await act(async () => { input.click(); await flush(); });
  }
  async function click(name: string) {
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === name);
    expect(button).toBeTruthy(); await act(async () => { button!.click(); await flush(); });
  }
  async function render() {
    const submit = vi.fn(async (..._args: any[]) => ({ error: { code: "fixture", message: "Synthetic task request observed." } }));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => {
      root!.render(<DatasetPreparationFeature workspaceId="workspace-a" client={{
        browseSourceArtifacts: async () => [
          { artifactId: "pdf", label: "scanned.pdf", storageKey: "uploads/scanned.pdf", mediaType: "application/pdf" },
          { artifactId: "text", label: "guide.md", storageKey: "uploads/guide.md", mediaType: "text/markdown" },
        ], startPrepareTrainingDataset: submit,
      } as any} />); await flush();
    });
    await toggle("scanned.pdf");
    return submit;
  }
  afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); resetDatasetPreparationPageStateForTests(); });

  it("requires a language, sends only public options, and clears the opt-in on an explicit method change", async () => {
    const submit = await render();
    expect(field("Read text from scanned PDF pages")).toBeUndefined();
    await change("How should the source material be divided?", "structure-aware");
    expect((field("Read text from scanned PDF pages") as HTMLInputElement).checked).toBe(false);
    await toggle("Read text from scanned PDF pages");
    expect(field("Text recognition language").value).toBe("");
    await click("Run checks and prepare");
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("exact installed Windows language tag");
    await change("Text recognition language", "en-US");
    await click("Run checks and prepare");
    expect(submit).toHaveBeenCalledTimes(1);
    const command = submit.mock.calls[0]![0];
    expect(command.advanced.content).toMatchObject({ strategy: "layout", ocrEnabled: true, ocrLanguage: "en-US" });
    expect(command).not.toHaveProperty("runtime");
    expect(JSON.stringify(command)).not.toContain("staged-pdf-ocr");
    await change("How should the source material be divided?", "topic-aware");
    await click("Run checks and prepare");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]![0].advanced.content.ocrEnabled).toBe(false);
    expect(submit.mock.calls[1]![0].advanced.content.ocrLanguage).toBeUndefined();
  });

  it("does not silently downgrade OCR when a non-PDF is added", async () => {
    const submit = await render();
    await change("How should the source material be divided?", "structure-aware");
    await toggle("Read text from scanned PDF pages"); await change("Text recognition language", "en-US");
    await toggle("guide.md"); await click("Run checks and prepare");
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Select only PDF files");
    const checkbox = field("Read text from scanned PDF pages") as HTMLInputElement;
    expect(checkbox.checked).toBe(true); expect(checkbox.disabled).toBe(false);
    await toggle("Read text from scanned PDF pages"); await click("Run checks and prepare");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![0].advanced.content.ocrLanguage).toBeUndefined();
  });

  it("restores an explicit saved OCR choice after a fresh page-state load", async () => {
    await render(); await change("How should the source material be divided?", "structure-aware");
    await toggle("Read text from scanned PDF pages"); await change("Text recognition language", "en-US");
    await click("Save training settings");
    const savedBytes = window.localStorage.getItem(STORAGE)!;
    expect(JSON.parse(savedBytes)[0].settings).toMatchObject({ ocrEnabled: true, ocrLanguage: "en-US", preparationMethodId: "structure-aware" });
    expect(savedBytes).not.toContain("staged-pdf-ocr");
    await act(async () => root!.unmount()); root = undefined; container.remove();
    resetDatasetPreparationPageStateForTests(); window.localStorage.setItem(STORAGE, savedBytes);
    await render();
    const select = field("Saved training settings") as HTMLSelectElement;
    await change("Saved training settings", select.options[1]!.value); await click("Load settings");
    expect((field("Read text from scanned PDF pages") as HTMLInputElement).checked).toBe(true);
    expect(field("Text recognition language").value).toBe("en-US");
    expect(field("How should the source material be divided?").value).toBe("structure-aware");
  });

  it.each([undefined, "yes", null])("migrates old settings without activation and rejects a malformed saved flag (%s)", async flag => {
    resetDatasetPreparationPageStateForTests();
    window.localStorage.setItem(STORAGE, JSON.stringify([{ id: "old", label: "Old setup", savedAt: "2026-10-24T00:00:00Z", settings: {
      taskType: "llm-instruction", preparationMethodId: "structure-aware", ...(flag === undefined ? {} : { ocrEnabled: flag }), ocrLanguage: "en-US",
    } }]));
    const submit = await render(); await change("Saved training settings", "old"); await click("Load settings");
    if (flag === undefined) {
      expect((field("Read text from scanned PDF pages") as HTMLInputElement).checked).toBe(false);
      await click("Run checks and prepare");
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0]![0].advanced.content.ocrLanguage).toBeUndefined();
    } else {
      expect(submit).not.toHaveBeenCalled();
      expect(container.textContent).toContain("was not restored; your current setup is unchanged");
      expect(field("Read text from scanned PDF pages")).toBeUndefined();
      expect(field("How should the source material be divided?").value).toBe("topic-aware");
    }
  });

  it("does not copy an oversized saved language into the form", async () => {
    resetDatasetPreparationPageStateForTests();
    window.localStorage.setItem(STORAGE, JSON.stringify([{ id: "large", label: "Oversized setup", savedAt: "2026-10-24T00:00:00Z", settings: {
      taskType: "llm-instruction", preparationMethodId: "structure-aware", ocrEnabled: true, ocrLanguage: "private-value".repeat(400),
    } }]));
    const submit = await render(); await change("Saved training settings", "large"); await click("Load settings");
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("was not restored");
    expect(container.textContent).not.toContain("private-value");
    expect(field("Text recognition language")).toBeUndefined();
  });

  it("restores version OCR settings only for sources actually present as PDFs", async () => {
    let feature!: ReturnType<typeof useDatasetPreparationFeature>;
    const client = { browseSourceArtifacts: async () => [{ artifactId: "pdf", label: "scanned.pdf", storageKey: "uploads/scanned.pdf", mediaType: "application/pdf" }] } as any;
    function Probe() { feature = useDatasetPreparationFeature({ workspaceId: "workspace-a", client }); return null; }
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root!.render(<Probe />); await flush(); });
    const reproduction = { sourceArtifactIds: ["pdf"], recipeSnapshot: {
      recipe: { normalization: { targetFormat: "markdown" }, task: { taskType: "llm-instruction" } },
      // Match the actual finalizer snapshot, which stores advanced settings
      // without a separate preparation plan.
      advanced: { preset: "structure-aware", content: { strategy: "layout", layoutEnabled: true, ocrEnabled: true, ocrLanguage: "en-US" } },
    } } as any;
    await act(async () => { feature.onReuseDatasetVersion(reproduction); await flush(); });
    expect(feature.ocrEnabled).toBe(true);
    expect(feature.ocrLanguage).toBe("en-US");
    expect(feature.preparationMethodId).toBe("structure-aware");
    await act(async () => { feature.onReuseDatasetVersion({ ...reproduction, sourceArtifactIds: ["not-present"] }); await flush(); });
    expect(feature.selectedArtifactIds).toEqual(["pdf"]);
    expect(feature.status.message).toContain("was not restored");
    expect(feature.ocrLanguage).toBe("en-US");
  });

  it("refuses contradictory version settings atomically even with an explicit structure-aware plan", async () => {
    let feature!: ReturnType<typeof useDatasetPreparationFeature>;
    const client = { browseSourceArtifacts: async () => [{ artifactId: "pdf", label: "scanned.pdf", storageKey: "uploads/scanned.pdf", mediaType: "application/pdf" }] } as any;
    function Probe() { feature = useDatasetPreparationFeature({ workspaceId: "workspace-a", client }); return null; }
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root!.render(<Probe />); await flush(); });
    const plan = { schemaVersion: "1", inputIntent: "create-from-source-material", method: "structure-aware", sourceKinds: ["document"], generationMode: "task-examples" };
    const recipe = { normalization: { targetFormat: "markdown" }, task: { taskType: "llm-instruction" } };
    const advanced = { preset: "structure-aware", content: { strategy: "layout", layoutEnabled: true, ocrEnabled: true, ocrLanguage: "en-US" } };
    const patches = [
      { advanced: { preset: "standard", content: { ...advanced.content, strategy: "token", layoutEnabled: false } } },
      { preparation: { ...plan, generationMode: "none" } },
      { preparation: { ...plan, schemaVersion: "2" } },
      { preparation: { ...plan, sourceKinds: ["document", "image"] } },
      { preparation: { ...plan, inputIntent: "use-existing-dataset" } },
      { preparation: null },
      { recipe: { ...recipe, normalization: { targetFormat: "text" } } },
      { recipe: { ...recipe, task: { taskType: "vision-classification" } } },
    ];
    for (const patch of patches) {
      await act(async () => { feature.onReuseDatasetVersion({ sourceArtifactIds: ["pdf"], recipeSnapshot: { recipe, preparation: plan, advanced, ...patch } } as any); await flush(); });
      expect(feature.selectedArtifactIds).toEqual([]);
      expect(feature.ocrEnabled).toBe(false);
      expect(feature.ocrLanguage).toBe("");
      expect(feature.status.message).toContain("was not restored");
    }
  });
});
