// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetLibraryPage } from "../AssetLibraryPage";
import { thinClientPageDefinitions } from "../../routes/thinClientPages";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function response(status: number, body: unknown) {
  return {
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("thin-client AssetLibraryPage", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => mountedRoot?.unmount());
    }
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it("renders title and subtitle using the thin-client API client", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(200, { ok: true, value: { items: [] } }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(
        <AssetLibraryPage workspaceId="w1" workspaceName="Workspace" />,
      );
    });
    await act(async () => {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    });

    expect(container.textContent).toContain("Assets");
    expect(container.textContent).not.toContain("Run & Test");
    expect(container.textContent).not.toContain("Plans");
    expect(container.textContent).toContain("Search assets");
    expect(container.textContent).toContain("Import Assets");
    expect(container.textContent).not.toContain("Import packages");
    const tabList = container.querySelector<HTMLElement>("[role='tablist']");
    const activePanel =
      container.querySelector<HTMLElement>("[role='tabpanel']");
    expect(tabList?.classList.contains("ui-tabbed-panel__tablist")).toBe(true);
    expect(activePanel?.classList.contains("ui-tabbed-panel__panel")).toBe(
      true,
    );
    expect(
      container
        .querySelector<HTMLElement>("[role='tab'][aria-selected='true']")
        ?.getAttribute("aria-controls"),
    ).toBe(activePanel?.id);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/assets/definitions?limit=50&workspaceId=w1");
    expect((init as RequestInit).method).toBe("GET");
    expect(
      ((init as RequestInit).headers as Headers).get("x-client-source"),
    ).toBe("thin-client");
  });

  it("registers the Assets navigation item and path", () => {
    expect(
      thinClientPageDefinitions.some(
        (page) =>
          page.key === "assets" &&
          page.label === "Assets" &&
          page.path === "/assets",
      ),
    ).toBe(true);
  });
});
