import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

require.extensions[".svg"] = (module: NodeModule) => {
  module.exports = "logo.svg";
};
require.extensions[".png"] = (module: NodeModule) => {
  module.exports = "page-art.png";
};

import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../modules/testing/node-test";

let AppComponent: typeof import("../App").App | undefined;

async function loadApp() {
  AppComponent ??= (await import("../App")).App;
  return AppComponent;
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
(globalThis as any).InputEvent = dom.window.InputEvent;
(globalThis as any).FormData = dom.window.FormData;
(globalThis as any).Request = dom.window.Request;
(globalThis as any).Response = dom.window.Response;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).sessionStorage = dom.window.sessionStorage;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function waitForText(container: HTMLElement, text: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (container.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

describe("desktop renderer page composition", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => {
        mountedRoot?.unmount();
      });
    }
    mountedContainer?.remove();
    delete window.desktopApi;
    window.localStorage.clear();
    mountedRoot = undefined;
    mountedContainer = undefined;
  });

  it("renders Home and switches between workspace pages, Settings, and Systems", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const App = await loadApp();
    mountedRoot = root;
    mountedContainer = container;

    const workspaces = [
      {
        workspaceId: "research-workspace",
        displayName: "Research Workspace",
        status: "active",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ];
    let selectedWorkspaceId: string | undefined;
    window.desktopApi = {
      listWorkspaces: testDouble.fn(async () => ({
        ok: true,
        value: { workspaces },
      })),
      readActiveWorkspaceSelection: testDouble.fn(async () => ({
        ok: true,
        value: selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : {},
      })),
      saveActiveWorkspaceSelection: testDouble.fn(
        async (selection: { workspaceId?: string }) => {
          selectedWorkspaceId = selection.workspaceId;
          return { ok: true, value: { selection } };
        },
      ),
      clearActiveWorkspaceSelection: testDouble.fn(async () => {
        selectedWorkspaceId = undefined;
        return { ok: true, value: {} };
      }),
      createWorkspace: testDouble.fn(
        async (input: {
          command: {
            displayName: string;
            includeSystemFoundationAssets?: boolean;
          };
        }) => {
          const workspace = {
            workspaceId: "workspace.created",
            displayName: input.command.displayName,
            status: "active",
            createdAt: "2026-05-14T00:00:00.000Z",
            settings: {
              defaultIncludeSystemFoundationAssets:
                input.command.includeSystemFoundationAssets,
            },
          };
          workspaces.push(workspace);
          selectedWorkspaceId = workspace.workspaceId;
          return { ok: true, value: { workspace } };
        },
      ),
      uploadArtifact: testDouble.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: testDouble
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      registerArtifactFromRepo: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      localizeArtifactFromRepo: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      listAssetDefinitions: testDouble
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readAssetDefinition: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      readAssetDefinitionVersion: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      listAssetResourceBackedViews: testDouble
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readAssetResourceBackedView: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      registerResourceBackedViewAsAsset: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      finalizeGeneratedOutputAsAsset: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      importExternalRepositoryObjectAsAsset: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      localizeExternalRepositoryObjectAsAsset: testDouble
        .fn()
        .mockRejectedValue(new Error("unused")),
      readPythonRuntimeStatus: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          supervisorStatus: "stopped",
          healthy: false,
          runtimeStatus: "stopped",
          capabilities: [],
          logs: [],
        },
      }),
      controlPythonRuntime: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          supervisorStatus: "starting",
          healthy: false,
          runtimeStatus: "starting",
          capabilities: [],
          logs: [],
        },
      }),
      browseModels: testDouble
        .fn()
        .mockResolvedValue({ ok: true, value: { models: [] } }),
      getModelDetails: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          model: {
            provider: "huggingface",
            modelId: "org/demo",
            displayName: "Demo",
          },
        },
      }),
      listModels: testDouble
        .fn()
        .mockResolvedValue({ ok: true, value: { models: [] } }),
      saveModelReference: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          model: {
            modelRecordId: "m1",
            displayName: "Demo",
            source: "huggingface",
            lifecycleStatus: "saved-reference",
            artifactForm: "full-model",
            provider: "huggingface",
            createdAt: "2026-04-27T00:00:00.000Z",
          },
        },
      }),
      updateModelRecord: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          model: {
            modelRecordId: "m1",
            displayName: "Demo",
            source: "huggingface",
            lifecycleStatus: "saved-reference",
            artifactForm: "full-model",
            provider: "huggingface",
            createdAt: "2026-04-27T00:00:00.000Z",
          },
        },
      }),
      deleteModelRecord: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          deletedModelRecordId: "m1",
          deletedRegistryRecord: true,
          deletedLocalFiles: false,
          deletedBackingArtifactIds: [],
        },
      }),
    };

    await act(async () => {
      root.render(<App />);
    });

    await waitForText(container, "Choose a Workspace");
    expect(container.textContent).toContain("Choose a Workspace");
    expect(container.querySelector("#home-title")?.tagName).toBe("H1");
    expect(container.textContent).toContain(
      "The project context that controls which data, assets, models, and settings are visible while you work.",
    );
    expect(container.querySelector("header")?.textContent).toContain(
      "AI System Builder",
    );
    expect(container.textContent).toContain("Build & Run Systems");
    expect(container.textContent).toContain("Manage Data & Build Datasets");
    expect(container.textContent).toContain("Manage System Assets");
    expect(container.textContent).toContain("Manage and Train Models");
    expect(container.textContent).toContain("Generate Images");
    expect(container.querySelector("header")?.textContent).not.toContain(
      "Create workspace",
    );
    expect(
      container
        .querySelector(".home-workspace-card")
        ?.classList.contains("ui-panel"),
    ).toBe(false);
    expect(
      container
        .querySelector(".home-area-card__main")
        ?.firstElementChild?.classList.contains("home-card-illustration"),
    ).toBe(true);

    const buildGroupButton = Array.from(
      container.querySelectorAll(".ui-shell__sidebar-label"),
    ).find((button) => button.textContent?.trim() === "Build");
    expect(buildGroupButton?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      buildGroupButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(buildGroupButton?.getAttribute("aria-expanded")).toBe("false");
    expect(
      buildGroupButton?.parentElement
        ?.querySelector(".ui-shell__sidebar-items")
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      window.localStorage.getItem(
        "ai-system-builder.ui.collapsed-navigation-groups",
      ),
    ).toContain("build");

    await act(async () => {
      buildGroupButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(buildGroupButton?.getAttribute("aria-expanded")).toBe("true");

    const collapseButton = container.querySelector(
      "button[aria-label='Collapse sidebar']",
    );
    expect(Boolean(collapseButton)).toBe(true);

    await act(async () => {
      collapseButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.querySelector(".ui-shell")?.className).toContain(
      "ui-shell--sidebar-collapsed",
    );
    expect(
      Boolean(container.querySelector("button[aria-label='Expand sidebar']")),
    ).toBe(true);
    expect(
      window.localStorage.getItem("ai-system-builder.ui.sidebar-collapsed"),
    ).toBe("true");

    await act(async () => {
      container
        .querySelector("button[aria-label='Expand sidebar']")
        ?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    const menu = container.querySelector(
      ".ui-shell__menu",
    ) as HTMLDetailsElement | null;
    expect(menu).toBeDefined();
    if (menu) {
      menu.open = true;
      await act(async () => {
        document.dispatchEvent(new Event("mousedown", { bubbles: true }));
      });
      expect(menu.open).toBe(false);
    }

    const artifactsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Data");
    expect(artifactsButton).toBeDefined();

    await act(async () => {
      artifactsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain(
      "Create a workspace to use Systems, Assets, Artifacts, Data, Models, and Images.",
    );
    expect(container.textContent).toContain("Create workspace");
    expect(container.textContent).not.toContain("Data Artifact Ingester");
    expect(window.desktopApi?.browseArtifacts).not.toHaveBeenCalled();

    selectedWorkspaceId = "research-workspace";
    await act(async () => {
      root.unmount();
    });
    const remountedRoot = createRoot(container);
    mountedRoot = remountedRoot;
    await act(async () => {
      remountedRoot.render(<App />);
    });
    const assetsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Assets",
    );
    expect(assetsButton).toBeDefined();

    await act(async () => {
      assetsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await waitForText(container, "Search assets");
    expect(container.textContent).toContain("Search assets");
    expect(container.textContent).toContain("Assets Used");
    expect(container.querySelector(".ui-shell__page-art")).toBe(null);
    expect(
      container.querySelector("button[aria-current='page']")?.textContent,
    ).toBe("Assets");
    expect(window.desktopApi?.listAssetDefinitions).toHaveBeenCalled();

    const settingsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Settings");
    expect(settingsButton).toBeDefined();

    await act(async () => {
      settingsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await waitForText(container, "Manage global desktop defaults");
    expect(container.textContent).toContain("Settings");
    expect(container.textContent).toContain("Software status");
    expect(
      container
        .querySelector("button[aria-current='page']")
        ?.getAttribute("aria-label"),
    ).toBe("Settings");

    const systemsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Systems",
    );
    expect(systemsButton).toBeDefined();

    await act(async () => {
      systemsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    await waitForText(container, "System Builder");
    expect(container.textContent).toContain("System Builder");
    expect(container.textContent).not.toContain("Basic diagnostics");
    expect(window.desktopApi?.readPythonRuntimeStatus).not.toHaveBeenCalled();
    expect(
      container.querySelector("button[aria-current='page']")?.textContent,
    ).toBe("Systems");
  });
});
