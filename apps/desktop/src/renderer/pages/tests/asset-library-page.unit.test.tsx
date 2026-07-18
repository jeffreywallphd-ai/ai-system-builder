// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetLibraryPage } from "../AssetLibraryPage";
import { desktopPageDefinitions } from "../../routes/desktopPages";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function success(value: unknown) {
  return { ok: true, value };
}

describe("AssetLibraryPage", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => mountedRoot?.unmount());
    }
    mountedContainer?.remove();
    delete (window as Window & { desktopApi?: unknown }).desktopApi;
    mountedRoot = undefined;
    mountedContainer = undefined;
  });

  it("renders title and subtitle", async () => {
    (window as any).desktopApi = {
      listAssetDefinitions: vi.fn().mockResolvedValue(success({ items: [] })),
      readAssetDefinition: vi
        .fn()
        .mockResolvedValue(success({ definition: {} })),
      readAssetDefinitionVersion: vi
        .fn()
        .mockResolvedValue(success({ definition: {} })),
      listAssetResourceBackedViews: vi
        .fn()
        .mockResolvedValue(success({ items: [] })),
      readAssetResourceBackedView: vi
        .fn()
        .mockResolvedValue(success({ view: {} })),
      registerResourceBackedViewAsAsset: vi.fn().mockResolvedValue(
        success({
          ok: true,
          operation: "asset.register-resource-backed-view",
          status: "created",
        }),
      ),
      finalizeGeneratedOutputAsAsset: vi.fn().mockResolvedValue(
        success({
          ok: true,
          operation: "asset.finalize-generated-output",
          status: "created",
        }),
      ),
      importExternalRepositoryObjectAsAsset: vi.fn().mockResolvedValue(
        success({
          ok: true,
          operation: "asset.import-external-repository-object",
          status: "created",
        }),
      ),
      localizeExternalRepositoryObjectAsAsset: vi.fn().mockResolvedValue(
        success({
          ok: true,
          operation: "asset.localize-external-repository-object",
          status: "created",
        }),
      ),
    };

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
  });

  it("registers a top-level Assets navigation item", () => {
    expect(
      desktopPageDefinitions.some(
        (page) => page.key === "assets" && page.label === "Assets",
      ),
    ).toBe(true);
  });
});
