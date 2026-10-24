import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationProvider } from "../../../../../../modules/ui/shared";
import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("checked output intent in the mounted thin-client renderer", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  let availableRam = 8 * 1024 ** 3;
  let decoderAvailable = true;
  const source = { browseArtifacts: async () => [{ artifactId: "guide", storageKey: "uploads/guide.md", originalName: "guide.md", mediaType: "text/markdown", artifactFamily: "document" }] } as any;
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  const checkbox = () => Array.from(container.querySelectorAll("label"))
    .find(label => label.textContent?.trim() === "Keep generated JSON well structured")!
    .querySelector<HTMLInputElement>("input")!;
  afterEach(async () => {
    await act(async () => root?.unmount()); root = undefined;
    container?.remove(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks();
  });
  const render = async (preference?: boolean) => {
    vi.useFakeTimers(); availableRam = 8 * 1024 ** 3; decoderAvailable = true;
    localStorage.clear();
    localStorage.setItem("ai-system-builder.dataset-preparation.structured-output.v1:workspace-a", JSON.stringify({
      constrainedDecodingPreference: preference,
      localModel: { modelId: "Qwen/Qwen2.5-1.5B-Instruct", device: "cpu", torchDtype: "bfloat16" },
    }));
    const submit = vi.fn(async (..._args: any[]) => ({ requestId: "checked-test", status: "queued", accepted: true }));
    const preparation = { start: submit, read: async () => ({ requestId: "checked-test", status: "cancelled" }),
      readGenerationCapacity: async () => ({ schemaVersion: "1", capturedAt: new Date().toISOString(),
        decoderAvailable, schemaSupported: true, logicalProcessorCount: 16,
        totalSystemMemoryBytes: 16 * 1024 ** 3, availableSystemMemoryBytes: availableRam }) } as any;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root!.render(<NotificationProvider><DatasetPreparationFeature workspaceId="workspace-a" artifactClient={source} preparationClient={preparation} /></NotificationProvider>); await flush(); });
    const select = Array.from(container.querySelectorAll("label")).find(label => label.textContent?.trim().startsWith("guide.md"))!.querySelector<HTMLInputElement>("input")!;
    await act(async () => { select.click(); await flush(); });
    return submit;
  };
  const refresh = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await flush(); }); };
  const start = async () => {
    const button = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Run checks and prepare")!;
    expect(Boolean(button)).toBe(true);
    await act(async () => { button.click(); await flush(); });
  };

  it("keeps an untouched sufficient CPU recommendation when available RAM falls", async () => {
    await render();
    expect(checkbox().checked).toBe(true);
    availableRam = 2 * 1024 ** 3; await refresh();
    expect(checkbox().checked).toBe(true);
  });

  it("keeps a checked preference visible when decoder readiness disappears", async () => {
    await render(true);
    expect(checkbox().checked).toBe(true);
    decoderAvailable = false; await refresh();
    expect(checkbox().checked).toBe(true);
  });

  it("does not dispatch unchecked generation after a checked choice loses readiness", async () => {
    const submit = await render(true);
    decoderAvailable = false; await refresh(); await start();
    // Counts only: a failing assertion must not serialize a generation request.
    expect(submit.mock.calls.length).toBe(0);
  });

  it("lets the person explicitly turn off an unavailable checked mode", async () => {
    const submit = await render(true); decoderAvailable = false; await refresh();
    expect(checkbox().disabled).toBe(false);
    await act(async () => { checkbox().click(); await flush(); });
    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(true);
    await start(); expect(submit.mock.calls.length).toBe(1);
    expect(submit.mock.calls[0]?.[0]?.command.recipe.generation.structuredOutput.constrainedDecoding).toBe(false);
  });

  it("resumes the same checked intent after readiness returns", async () => {
    const submit = await render(true); decoderAvailable = false; await refresh();
    await start(); expect(submit.mock.calls.length).toBe(0);
    decoderAvailable = true; await refresh(); await start();
    expect(submit.mock.calls.length).toBe(1);
    expect(submit.mock.calls[0]?.[0]?.command.recipe.generation.structuredOutput.constrainedDecoding).toBe(true);
  });
});
