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
    const definitionCall = fetchMock.mock.calls.find(
      ([requestUrl]) =>
        String(requestUrl) ===
        "/api/assets/definitions?limit=50&workspaceId=w1",
    );
    expect(definitionCall).toBeDefined();
    const [url, init] = definitionCall!;
    expect(url).toBe("/api/assets/definitions?limit=50&workspaceId=w1");
    expect((init as RequestInit).method).toBe("GET");
    expect(
      ((init as RequestInit).headers as Headers).get("x-client-source"),
    ).toBe("thin-client");
  });

  it("opens a card in the exact thin-client customization target", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const url = String(input);
      if (
        url.includes("/customization-targets/implementation-release.button.1")
      ) {
        return Promise.resolve(
          response(200, {
            ok: true,
            value: {
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
          }),
        );
      }
      if (url.includes("/customization-targets")) {
        return Promise.resolve(
          response(200, {
            ok: true,
            value: {
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
          }),
        );
      }
      if (url.includes("/derived-customizations"))
        return Promise.resolve(
          response(200, { ok: true, value: { customizations: [] } }),
        );
      if (url.includes("/assets/definitions"))
        return Promise.resolve(
          response(200, {
            ok: true,
            value: {
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
            },
          }),
        );
      return Promise.resolve(response(200, { ok: true, value: { items: [] } }));
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
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
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Frontend styling"),
    );

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      urls.some((url) =>
        url.includes(
          "/customization-targets?text=builtin.button&eligibility=all",
        ),
      ),
    ).toBe(true);
    expect(
      urls.some((url) =>
        url.includes(
          "/customization-targets/implementation-release.button.1?definitionId=builtin.button&definitionVersion=1.0.0",
        ),
      ),
    ).toBe(true);
    expect(
      container.querySelector("[role='tab'][aria-selected='true']")
        ?.textContent,
    ).toBe("Customizations");
    expect(container.textContent).toContain("Backend logic");
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
