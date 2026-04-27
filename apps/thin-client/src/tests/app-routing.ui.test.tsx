import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";

describe("thin-client routing and page composition", () => {
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
    window.history.pushState({}, "", "/");
    vi.unstubAllGlobals();
  });

  it("renders landing Home content and navigates to Artifacts workflow page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }) })
      .mockResolvedValue({ json: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }) });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("Build visual AI workflows from your artifacts");

    const artifactsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Artifacts");

    await act(async () => {
      artifactsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Data Artifact Ingester");
    expect(container.textContent).not.toContain("Data Artifact Browser");

    const browserTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Artifact Browser");
    expect(browserTab).toBeDefined();

    await act(async () => {
      browserTab?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Data Artifact Browser");
    expect(window.location.pathname).toBe("/artifacts");
  });
});
