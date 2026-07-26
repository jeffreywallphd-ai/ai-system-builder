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

  it("opens the exact card asset in the ordered Customizations tab", async () => {
    const listTargets = vi.fn().mockResolvedValue({
      status: "success",
      payload: {
        targets: [
          {
            workspaceId: "w1",
            sourceKind: "system-owned-asset",
            definitionRef: {
              kind: "asset-definition-version",
              id: "builtin.button",
              version: "1.0.0",
            },
            implementationReleaseId: "implementation-release.button.1",
            displayName: "Button",
            description: "Reusable button",
            eligibility: {
              eligible: true,
              code: "eligible",
              message: "Eligible",
            },
            resources: {
              total: 3,
              editable: 3,
              frontendStructure: 1,
              frontendStyle: 1,
              backendLogic: 1,
              other: 0,
            },
          },
        ],
      },
    });
    const readTarget = vi.fn().mockResolvedValue({
      status: "success",
      payload: {
        workspaceId: "w1",
        sourceKind: "system-owned-asset",
        definitionRef: {
          kind: "asset-definition-version",
          id: "builtin.button",
          version: "1.0.0",
        },
        implementationReleaseId: "implementation-release.button.1",
        displayName: "Button",
        description: "Reusable button",
        eligibility: { eligible: true, code: "eligible", message: "Eligible" },
        resources: {
          total: 3,
          editable: 3,
          frontendStructure: 1,
          frontendStyle: 1,
          backendLogic: 1,
          other: 0,
        },
        definition: {
          definitionId: "builtin.button",
          assetType: "ui-component",
          assetFamily: "structural",
          version: "1.0.0",
          displayName: "Button",
          description: "Reusable button",
          lifecycleStatus: "published",
          provenance: {},
        },
        backingResources: [
          {
            path: "frontend/Button.tsx",
            role: "frontend-structure",
            mediaType: "text/typescript",
            sizeCharacters: 10,
            editable: true,
            content: "export {};",
          },
          {
            path: "styles/button.css",
            role: "frontend-style",
            mediaType: "text/css",
            sizeCharacters: 9,
            editable: true,
            content: ".button{}",
          },
          {
            path: "backend/button.json",
            role: "backend-logic",
            mediaType: "application/json",
            sizeCharacters: 2,
            editable: true,
            content: "{}",
          },
        ],
        protectedFields: ["asset-identity", "ownership"],
      },
    });
    (window as any).desktopApi = {
      listAssetDefinitions: vi
        .fn()
        .mockResolvedValue(
          success({
            items: [
              {
                id: "builtin.button@1.0.0",
                definitionId: "builtin.button",
                version: "1.0.0",
                displayName: "Button",
                summary: "Reusable button",
                assetType: "ui-component",
                assetFamily: "structural",
                lifecycleStatus: "published",
                builtIn: true,
                sourcePackId: "system.foundation",
                sourcePackVersion: "1.0.0",
                sourceKind: "system",
                sourceLayer: "system-default",
              },
            ],
          }),
        ),
      readAssetDefinition: vi.fn(),
      readAssetDefinitionVersion: vi.fn(),
      listAssetResourceBackedViews: vi
        .fn()
        .mockResolvedValue(success({ items: [] })),
      readAssetResourceBackedView: vi.fn(),
      registerResourceBackedViewAsAsset: vi.fn(),
      finalizeGeneratedOutputAsAsset: vi.fn(),
      importExternalRepositoryObjectAsAsset: vi.fn(),
      localizeExternalRepositoryObjectAsAsset: vi.fn(),
      listAssetDerivedCustomizationTargets: listTargets,
      readAssetDerivedCustomizationTarget: readTarget,
      listAssetDerivedCustomizations: vi
        .fn()
        .mockResolvedValue({
          status: "success",
          payload: { customizations: [] },
        }),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;
    await act(async () =>
      root.render(
        <AssetLibraryPage workspaceId="w1" workspaceName="Workspace" />,
      ),
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Customize"),
    );

    const customize = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Customize",
    ) as HTMLButtonElement;
    await act(async () => customize.click());
    await vi.waitFor(() => expect(readTarget).toHaveBeenCalled());

    expect(listTargets).toHaveBeenCalledWith({
      workspaceId: "w1",
      text: "builtin.button",
      eligibility: "all",
    });
    expect(readTarget).toHaveBeenCalledWith({
      workspaceId: "w1",
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.button",
        version: "1.0.0",
      },
      implementationReleaseId: "implementation-release.button.1",
    });
    expect(
      container.querySelector("[role='tab'][aria-selected='true']")
        ?.textContent,
    ).toBe("Customizations");
    expect(container.textContent).toContain("Frontend structure");
    expect(container.textContent).toContain("Backend logic");
  });

  it("registers a top-level Assets navigation item", () => {
    expect(
      desktopPageDefinitions.some(
        (page) => page.key === "assets" && page.label === "Assets",
      ),
    ).toBe(true);
  });
});
