import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("browser scanned-PDF preparation", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const field = (name: string) => Array.from(container.querySelectorAll("label"))
    .find((label) => label.textContent?.trim().startsWith(name))?.querySelector("input,select") as HTMLInputElement | HTMLSelectElement;
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
  async function render(read = async () => ({ requestId: "ocr-browser", status: "cancelled" })) {
    window.localStorage.clear();
    const submit = vi.fn(async (..._args: any[]) => ({ requestId: "ocr-browser", accepted: true, status: "queued" }));
    const cancel = vi.fn(async () => ({ requestId: "ocr-browser", cancelled: false, status: "running" }));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => {
      root!.render(<DatasetPreparationFeature workspaceId="workspace-a" artifactClient={{ browseArtifacts: async () => [
        { artifactId: "pdf", originalName: "scanned.pdf", storageKey: "uploads/scanned.pdf", mediaType: "application/pdf" },
        { artifactId: "text", originalName: "guide.md", storageKey: "uploads/guide.md", mediaType: "text/markdown" },
      ] } as any} preparationClient={{ start: submit, read, cancel } as any} />); await flush();
    });
    await toggle("scanned.pdf");
    return { submit, cancel };
  }
  afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); window.localStorage.clear(); vi.useRealTimers(); });

  it("requires an explicit language and sends no host-private bindings", async () => {
    const { submit } = await render();
    expect(field("Read text from scanned PDF pages")).toBeUndefined();
    await change("Preparation method", "structure-aware");
    expect((field("Read text from scanned PDF pages") as HTMLInputElement).checked).toBe(false);
    await toggle("Read text from scanned PDF pages"); await click("Run checks and prepare");
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("exact installed Windows language tag");
    await change("Text recognition language", "en-US"); await click("Run checks and prepare");
    expect(submit).toHaveBeenCalledTimes(1);
    const { command, workspaceId } = submit.mock.calls[0]![0];
    expect(workspaceId).toBe("workspace-a");
    expect(command.advanced.content).toMatchObject({ strategy: "layout", layoutEnabled: true, ocrEnabled: true, ocrLanguage: "en-US" });
    expect(command).not.toHaveProperty("runtime");
    expect(JSON.stringify(command)).not.toContain("staged-pdf-ocr");
  });
  it("refuses mixed sources without silently unchecking the explicit choice", async () => {
    const { submit } = await render(); await change("Preparation method", "structure-aware");
    await toggle("Read text from scanned PDF pages"); await change("Text recognition language", "en-US");
    await toggle("guide.md"); await click("Run checks and prepare");
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Select only PDF files");
    expect((field("Read text from scanned PDF pages") as HTMLInputElement).checked).toBe(true);
    await toggle("Read text from scanned PDF pages"); await click("Run checks and prepare");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![0].command.advanced.content.ocrLanguage).toBeUndefined();
  });
  it("omits stale language settings after an explicit method change", async () => {
    const { submit } = await render(); await change("Preparation method", "structure-aware");
    await toggle("Read text from scanned PDF pages"); await change("Text recognition language", "en-US");
    await change("Preparation method", "topic-aware"); await click("Run checks and prepare");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![0].command.advanced.content.ocrEnabled).toBe(false);
    expect(submit.mock.calls[0]![0].command.advanced.content.ocrLanguage).toBeUndefined();
  });
  it("keeps the OCR settings locked until cancellation is actually observed", async () => {
    vi.useFakeTimers(); let cancelled = false;
    const { cancel } = await render(async () => ({ requestId: "ocr-browser", status: cancelled ? "cancelled" : "running" }));
    await change("Preparation method", "structure-aware"); await toggle("Read text from scanned PDF pages");
    await change("Text recognition language", "en-US"); await click("Run checks and prepare");
    expect(field("Text recognition language").matches(":disabled")).toBe(true);
    const stop = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Stop"))!;
    await act(async () => { stop.click(); await flush(); });
    expect(cancel).toHaveBeenCalledWith({ workspaceId: "workspace-a", requestId: "ocr-browser" });
    expect(container.textContent).not.toContain("Dataset preparation stopped.");
    expect(field("Text recognition language").matches(":disabled")).toBe(true);
    cancelled = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); await flush(); });
    expect(container.textContent).toContain("Dataset preparation stopped.");
    expect(field("Text recognition language").matches(":disabled")).toBe(false);
    expect(field("Text recognition language").value).toBe("en-US");
  });
});
