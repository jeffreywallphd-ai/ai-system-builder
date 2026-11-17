import { act, useEffect } from "react";
import { NotificationProvider, useNotificationCenter } from "../../../../../../../modules/ui/shared";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";
import { resetDatasetPreparationPageStateForTests } from "../hooks/useDatasetPreparationFeature";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function MemoryNotificationProbe() {
  const notifications = useNotificationCenter();
  useEffect(() => notifications.setActiveWorkspaceId("workspace-a"), [notifications.setActiveWorkspaceId]);
  return <output data-memory-records>{JSON.stringify(notifications.records)}</output>;
}

describe("desktop optional low-memory settings", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  afterEach(async () => {
    await act(async () => root?.unmount()); root = undefined;
    container?.remove(); resetDatasetPreparationPageStateForTests();
    window.localStorage.clear(); vi.useRealTimers();
  });
  const flush = async () => { for (let index = 0; index < 15; index++) await Promise.resolve(); };
  const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => Array.from(container.querySelectorAll("label")).find((label) => label.textContent?.trim().startsWith(name))?.querySelector("input,select") as T;
  const change = async (name: string, value: string) => {
    const element = field(name); expect(element).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); await flush();
    });
  };
  const button = (name: string) => Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === name)!;
  const click = async (name: string) => { await act(async () => { button(name).click(); await flush(); }); };

  it("saves and restores the mode, refuses a missing capability, and preserves the selected model", async () => {
    vi.useFakeTimers(); window.localStorage.clear(); resetDatasetPreparationPageStateForTests();
    let available = true;
    const submit = vi.fn(async () => ({ error: { code: "synthetic", message: "Synthetic operation completed." } }));
    const runtimeStatusClient = {
      readStatus: async () => ({ supervisorStatus: "ready", healthy: true, runtimeStatus: "ready", capabilities: [], logs: [], loadedModels: [], activeTaskCount: 0,
        generationCapacity: { schemaVersion: "1", capturedAt: new Date().toISOString(), decoderAvailable: false, schemaSupported: true, offloadAvailable: available } }),
      controlRuntime: vi.fn(),
    } as any;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root!.render(<DatasetPreparationFeature workspaceId="workspace-a" runtimeStatusClient={runtimeStatusClient}
      client={{ browseSourceArtifacts: async () => [{ artifactId: "guide", label: "guide.md", storageKey: "uploads/guide.md", mediaType: "text/markdown" }], startPrepareTrainingDataset: submit } as any} />); await flush(); });
    await act(async () => { (container.querySelector(".dataset-preparation__artifact-group input[type='checkbox']") as HTMLInputElement).click(); await flush(); });
    const generationPrompt = Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent?.includes("Generation prompt"))!;
    await act(async () => { generationPrompt.click(); await flush(); });
    for (const name of ["Model ID", "Inference mode", "Model device", "Torch dtype"]) {
      expect(field(name).getAttribute("aria-label")).toBe(name);
    }
    await change("Model ID", "Qwen/Qwen2.5-1.5B-Instruct");
    await change("Model device", "cpu"); await change("Torch dtype", "bfloat16");
    await change("Model memory mode", "offload-v1");
    await click("Save training settings");
    await change("Model memory mode", "standard");
    const saved = Array.from(container.querySelectorAll("select")).find((select) => Array.from(select.options).some((option) => option.textContent?.includes("llm instruction settings")))!;
    await act(async () => { saved.value = saved.options[1]!.value; saved.dispatchEvent(new Event("change", { bubbles: true })); await flush(); });
    await click("Load settings");
    expect(field<HTMLSelectElement>("Model memory mode").value).toBe("offload-v1");
    expect(field<HTMLSelectElement>("When memory is full").value).toBe("none");
    expect(field<HTMLSelectElement>("When memory is full").disabled).toBe(true);
    available = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await click("Run checks and prepare"); expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("unavailable in the current worker");
    available = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await click("Run checks and prepare"); expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]?.recipe.generation.model).toMatchObject({ modelId: "Qwen/Qwen2.5-1.5B-Instruct", memoryMode: "offload-v1", device: "cpu", torchDtype: "bfloat16", memoryOverflowPolicy: "none" });
  });

  it("reports malformed saved profile validation inline instead of an unhandled event failure", async () => {
    resetDatasetPreparationPageStateForTests(); window.localStorage.clear();
    window.localStorage.setItem("ai-system-builder.datasetPreparation.trainingSettings.v1", JSON.stringify([{ id: "malformed", label: "Malformed fixture", savedAt: "2026-10-22T04:00:00Z", settings: { taskType: "llm-instruction", modelMemoryMode: "offload-v99" } }]));
    const submit = vi.fn();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root!.render(<DatasetPreparationFeature workspaceId="workspace-a"
      client={{ browseSourceArtifacts: async () => [{ artifactId: "guide", label: "guide.md", storageKey: "uploads/guide.md", mediaType: "text/markdown" }], startPrepareTrainingDataset: submit } as any} />); await flush(); });
    await act(async () => { (container.querySelector(".dataset-preparation__artifact-group input[type='checkbox']") as HTMLInputElement).click(); await flush(); });
    const saved = Array.from(container.querySelectorAll("select")).find((select) => Array.from(select.options).some((option) => option.value === "malformed"))!;
    await act(async () => { saved.value = "malformed"; saved.dispatchEvent(new Event("change", { bubbles: true })); await flush(); });
    await click("Load settings"); await click("Run checks and prepare");
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Saved local inference settings are unsupported");
  });
  it("sends measured preflight RAM guidance only to the notification center and never starts the task", async () => {
    const submit = vi.fn();
    const runtimeStatusClient = {
      readStatus: async () => ({ supervisorStatus: "ready", healthy: true, runtimeStatus: "ready", capabilities: [], logs: [], loadedModels: [], activeTaskCount: 0,
        generationCapacity: { schemaVersion: "1", capturedAt: new Date().toISOString(), decoderAvailable: false, schemaSupported: true,
          totalSystemMemoryBytes: 16 * 1024 ** 3, availableSystemMemoryBytes: 3.25 * 1024 ** 3 } }),
      controlRuntime: vi.fn(),
    } as any;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root!.render(<NotificationProvider><MemoryNotificationProbe /><DatasetPreparationFeature workspaceId="workspace-a" runtimeStatusClient={runtimeStatusClient}
      client={{ browseSourceArtifacts: async () => [{ artifactId: "guide", label: "guide.md", storageKey: "uploads/guide.md", mediaType: "text/markdown" }], startPrepareTrainingDataset: submit } as any} /></NotificationProvider>); await flush(); });
    await act(async () => { (container.querySelector(".dataset-preparation__artifact-group input[type='checkbox']") as HTMLInputElement).click(); await flush(); });
    await act(async () => { Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent?.includes("Generation prompt"))!.click(); await flush(); });
    await change("Model ID", "Qwen/Qwen2.5-1.5B-Instruct");
    await change("Model device", "cpu"); await change("When memory is full", "none");
    await click("Run checks and prepare");
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector('.dataset-preparation__status[role="alert"]')).toBeNull();
    const records = JSON.parse(container.querySelector("[data-memory-records]")!.textContent!);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tone: "error", workspaceId: "workspace-a" });
    expect(records[0].message).toContain("Free at least 1536 MiB of RAM");
    await click("Run checks and prepare");
    expect(JSON.parse(container.querySelector("[data-memory-records]")!.textContent!)).toHaveLength(1);
    expect(submit).not.toHaveBeenCalled();
  });

});
