import { act, useEffect } from "react";
import { NotificationProvider, useNotificationCenter } from "../../../../../../modules/ui/shared";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function MemoryNotificationProbe() {
  const notifications = useNotificationCenter();
  useEffect(() => notifications.setActiveWorkspaceId("workspace-a"), [notifications.setActiveWorkspaceId]);
  return <output data-memory-records>{JSON.stringify(notifications.records)}</output>;
}

describe("optional low-memory preparation journeys", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
  const capacity = (available: boolean) => ({ schemaVersion: "1", capturedAt: new Date().toISOString(), decoderAvailable: false, schemaSupported: true, logicalProcessorCount: 20, totalSystemMemoryBytes: 16 * 1024 ** 3, offloadAvailable: available });
  const artifactClient = { browseArtifacts: async () => [{ artifactId: "guide", storageKey: "uploads/guide.md", originalName: "guide.md", mediaType: "text/markdown", artifactFamily: "document" }] } as any;
  const control = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => Array.from(container.querySelectorAll("label")).find((label) => label.textContent?.trim().startsWith(name))?.querySelector("input,select") as T;
  const change = async (name: string, value: string) => {
    const element = control(name);
    expect(element).toBeTruthy();
    await act(async () => {
      const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      await flush();
    });
  };
  const selectSource = async () => {
    await act(async () => { control<HTMLInputElement>("guide.md").click(); await flush(); });
  };
  const start = async () => {
    const button = Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent === "Run checks and prepare")!;
    await act(async () => { button.click(); await flush(); });
  };
  const render = async (client: any, workspaceId = "workspace-a") => {
    if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
    await act(async () => { root!.render(<NotificationProvider><MemoryNotificationProbe /><DatasetPreparationFeature workspaceId={workspaceId} artifactClient={artifactClient} preparationClient={client} /></NotificationProvider>); await flush(); });
  };

  it("retains explicit settings on reopen and recovers capability changes without remounting", async () => {
    vi.useFakeTimers();
    window.localStorage.clear();
    let available = true;
    const submit = vi.fn(async () => ({ requestId: "profile-task", accepted: true, status: "queued" }));
    const client = { readGenerationCapacity: async () => capacity(available), start: submit, read: async () => ({ requestId: "profile-task", status: "cancelled" }), cancel: vi.fn() };
    await render(client); await selectSource();
    await change("Local generation model", "Qwen/Qwen2.5-1.5B-Instruct");
    await change("Model device", "cpu"); await change("Torch dtype", "bfloat16");
    await change("Model memory mode", "offload-v1");
    expect(container.textContent).toContain("not process-memory limits");
    await act(async () => { root!.unmount(); }); root = createRoot(container);
    await render(client); await selectSource();
    expect(control<HTMLSelectElement>("Model memory mode").value).toBe("offload-v1");
    expect(control<HTMLInputElement>("Local generation model").value).toBe("Qwen/Qwen2.5-1.5B-Instruct");
    available = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(control<HTMLSelectElement>("Model memory mode").value).toBe("offload-v1");
    await start(); expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("unavailable in the current worker");
    available = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await start();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]?.command.recipe.generation.model).toMatchObject({ modelId: "Qwen/Qwen2.5-1.5B-Instruct", device: "cpu", torchDtype: "bfloat16", memoryMode: "offload-v1", memoryOverflowPolicy: "none" });
  });

  it("rejects invalid saved modes and an explicitly cleared model instead of sending defaults", async () => {
    window.localStorage.clear();
    window.localStorage.setItem("ai-system-builder.dataset-preparation.structured-output.v1:workspace-a", JSON.stringify({ memoryMode: "offload-v99", localModel: { modelId: "fixture/model", device: "cpu", torchDtype: "float32" } }));
    const submit = vi.fn();
    const client = { readGenerationCapacity: async () => capacity(true), start: submit };
    await render(client); await selectSource(); await start();
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Saved local inference settings are unsupported");
    await change("Model memory mode", "standard");
    await change("Local generation model", ""); await start();
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a local generation model identifier");
  });

  it("does not adopt a late capability reply from another workspace", async () => {
    window.localStorage.clear();
    let resolveOld: ((value: any) => void) | undefined;
    const client = { readGenerationCapacity: ({ workspaceId }: any) => workspaceId === "workspace-a"
      ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(capacity(false)), start: vi.fn() };
    await render(client); await render(client, "workspace-b"); await selectSource();
    const option = () => control<HTMLSelectElement>("Model memory mode").querySelector<HTMLOptionElement>('option[value="offload-v1"]')!;
    expect(option().disabled).toBe(true);
    await act(async () => { resolveOld!(capacity(true)); await flush(); });
    expect(option().disabled).toBe(true);
    expect(control<HTMLSelectElement>("Model memory mode").value).toBe("standard");
  });

  it("keeps Standard preparation usable when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    const submit = vi.fn(async () => ({ requestId: "standard-task", accepted: true, status: "queued" }));
    const client = { readGenerationCapacity: async () => capacity(false), start: submit, read: async () => ({ requestId: "standard-task", status: "cancelled" }) };
    await render(client); await selectSource(); await start();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Saved local inference settings are unsupported");
    expect(control<HTMLSelectElement>("Model memory mode").value).toBe("standard");
  });

  it.each(["null", "[]", "3", "{broken"])("denies present malformed saved settings: %s", async (saved) => {
    window.localStorage.setItem("ai-system-builder.dataset-preparation.structured-output.v1:workspace-a", saved);
    const submit = vi.fn();
    await render({ readGenerationCapacity: async () => capacity(false), start: submit });
    await selectSource(); await start();
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Saved local inference settings are unsupported");
  });
  it("notifies measured admission failures returned before a task starts", async () => {
    const submit = vi.fn(async () => { throw Object.assign(new Error("private-fixture"), {
      code: "generation_insufficient_resources",
      details: { memoryShortfall: { resource: "ram", requiredBytes: 3758096384, availableBytes: 3503902720, allowedOverflowBytes: 0 } },
    }); });
    await render({ readGenerationCapacity: async () => capacity(false), start: submit });
    await selectSource(); await start();
    expect(container.querySelector('p[role="alert"]')).toBeNull();
    const records = JSON.parse(container.querySelector("[data-memory-records]")!.textContent!);
    expect(records).toHaveLength(1);
    expect(records[0].message).toContain("Free at least 243 MiB of RAM");
    expect(container.textContent).not.toContain("private-fixture");
  });

  it("places measured worker RAM denial in notification history without an inline error or private payload", async () => {
    const submit = vi.fn(async () => ({ requestId: "memory-task", accepted: true, status: "queued" }));
    const client = {
      readGenerationCapacity: async () => capacity(false), start: submit,
      read: async () => ({ requestId: "memory-task", status: "failed", error: {
        code: "generation_insufficient_resources", message: "private-fixture",
        memoryShortfall: { resource: "ram", requiredBytes: 3758096384, availableBytes: 3503902720, allowedOverflowBytes: 0, path: "private-fixture" },
      } }),
    };
    await render(client); await selectSource(); await start();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(container.querySelector('p[role="alert"]')).toBeNull();
    const records = JSON.parse(container.querySelector("[data-memory-records]")!.textContent!);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tone: "error", workspaceId: "workspace-a" });
    expect(records[0].message).toContain("Free at least 243 MiB of RAM");
    expect(container.textContent).not.toContain("private-fixture");
  });

});
