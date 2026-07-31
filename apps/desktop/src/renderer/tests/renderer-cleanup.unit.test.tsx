// @vitest-environment jsdom
// @ts-expect-error jsdom test helper types are not installed in this repo.
import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, testDouble as vi } from "../../../../../modules/testing/node-test";

import { useAsyncSection } from "../hooks/useAsyncSection";
import { useArtifactSelectionContent } from "../features/artifact-browser/hooks/useArtifactSelectionContent";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
(globalThis as any).InputEvent = dom.window.InputEvent;
(globalThis as any).FormData = dom.window.FormData;
(globalThis as any).Blob = dom.window.Blob;
(globalThis as any).URL = dom.window.URL;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).sessionStorage = dom.window.sessionStorage;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;


async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function SectionHarness({ loader }: { loader: () => Promise<string> }) {
  const section = useAsyncSection({ pageKey: "cleanup", sectionKey: "cleanup.section", loadOnMount: true, loader });
  return <p>{section.status}:{section.data ?? ""}</p>;
}

function ArtifactPreviewHarness({ client }: { client: any }) {
  const feature = useArtifactSelectionContent(client, vi.fn(), "workspace.cleanup" as never);
  return <button type="button" onClick={() => { void feature.selectArtifact("artifact.cleanup"); }}>Preview</button>;
}

describe("renderer cleanup policies", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.restoreAllMocks();
    delete window.desktopApi;
  });

  function mount(element: ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root?.render(element); });
    return container;
  }

  it("does not apply in-flight section state updates after unmount and records gated cleanup diagnostics", async () => {
    window.desktopApi = { memoryDiagnosticsEnabled: true } as never;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const pending = deferred<string>();
    const c = mount(<SectionHarness loader={() => pending.promise} />);
    expect(c.textContent).toContain("loading");

    await act(async () => root?.unmount());
    root = undefined;
    await act(async () => { pending.resolve("late data"); await pending.promise; });

    expect(c.textContent).toBe("");
    const lines = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(lines).toContain("renderer.section.cleanup.started");
    expect(lines).toContain("renderer.section.request.ignored-after-unmount");
    expect(lines).toContain("renderer.section.cleanup.completed");
  });


  it("keeps renderer cleanup diagnostics gated when memory diagnostics are disabled", async () => {
    window.desktopApi = { memoryDiagnosticsEnabled: false } as never;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const pending = deferred<string>();
    mount(<SectionHarness loader={() => pending.promise} />);

    await act(async () => root?.unmount());
    root = undefined;
    await act(async () => { pending.resolve("late data"); await pending.promise; });

    expect(log).not.toHaveBeenCalled();
  });

  it("keeps section retry functional after a failed load", async () => {
    let loadCount = 0;
    function RetryHarness() {
      const section = useAsyncSection({
        pageKey: "cleanup",
        sectionKey: "retry.section",
        loadOnMount: false,
        loader: async () => {
          loadCount += 1;
          if (loadCount === 1) throw new Error("first failure");
          return "retry ok";
        },
      });
      return <><button type="button" onClick={() => { void section.load("open"); }}>Load</button><button type="button" onClick={() => { void section.retry(); }}>Retry</button><p>{section.status}:{section.data ?? section.error}</p></>;
    }
    const c = mount(<RetryHarness />);
    await act(async () => { c.querySelectorAll("button")[0].click(); await flushAsync(); });
    expect(c.textContent).toContain("error:first failure");
    await act(async () => { c.querySelectorAll("button")[1].click(); await flushAsync(); });
    expect(c.textContent).toContain("success:retry ok");
  });

  it("revokes artifact preview object URLs on unmount", async () => {
    window.desktopApi = { memoryDiagnosticsEnabled: true } as never;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const revoke = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revoke });
    const client = {
      readArtifactDetail: vi.fn().mockResolvedValue({
        artifactId: "artifact.cleanup",
        locator: { storageKey: "artifact.cleanup" },
        originalName: "artifact-cleanup.png",
        mediaType: "image/png",
        artifactFamily: "image",
      }),
      readArtifactContent: vi.fn().mockResolvedValue({
        locator: { storageKey: "artifact.cleanup" },
        mediaType: "image/png",
        availability: "available",
      }),
      createArtifactMediaViewUrl: vi.fn().mockResolvedValue("blob:artifact-cleanup"),
    };
    const c = mount(<ArtifactPreviewHarness client={client} />);

    await act(async () => { c.querySelector("button")?.click(); await flushAsync(); });
    await act(async () => root?.unmount());
    root = undefined;

    expect(revoke).toHaveBeenCalledWith("blob:artifact-cleanup");
    expect(log.mock.calls.map(([line]) => String(line)).join("\n")).toContain("renderer.preview.object-url.revoked");
  });
});
