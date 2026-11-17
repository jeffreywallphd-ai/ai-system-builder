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

function workspaceRecord(
  id = "workspace.ready",
  displayName = "Ready Workspace",
) {
  return {
    workspaceId: id,
    displayName,
    status: "active",
    createdAt: "2026-05-14T00:00:00.000Z",
  };
}

function installDesktopApi(options: {
  readonly workspaces?: readonly ReturnType<typeof workspaceRecord>[];
  readonly selectedWorkspaceId?: string;
  readonly loading?: boolean;
}) {
  let selectedWorkspaceId = options.selectedWorkspaceId;
  const workspaces = [...(options.workspaces ?? [])];
  let resolveList: ((value: unknown) => void) | undefined;
  const listWorkspaces = options.loading
    ? testDouble.fn(
        () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      )
    : testDouble.fn(async () => ({ ok: true, value: { workspaces } }));

  window.desktopApi = {
    listWorkspaces,
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
        const workspace = workspaceRecord(
          "workspace.created",
          input.command.displayName,
        );
        workspaces.push(workspace);
        selectedWorkspaceId = workspace.workspaceId;
        return { ok: true, value: { workspace } };
      },
    ),
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

  return { resolveList };
}

async function waitForText(container: HTMLElement, text: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (container.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function renderAndNavigateToModels(container: HTMLDivElement) {
  const root = createRoot(container);
  const App = await loadApp();
  await act(async () => {
    root.render(<App />);
  });
  const modelsButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Models",
  );
  await act(async () => {
    modelsButton?.dispatchEvent(new Event("click", { bubbles: true }));
  });
  return root;
}

describe("desktop app workspace route boundary", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    delete window.desktopApi;
    root = undefined;
    container = undefined;
  });

  it("renders only the workspace loading surface for a requested workspace page while workspaces load", async () => {
    const loadingControl = installDesktopApi({ loading: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = await renderAndNavigateToModels(container);

    expect(container.textContent).toContain("Loading workspaces...");
    expect(Boolean(container.querySelector(".ui-page-loading-surface"))).toBe(
      true,
    );
    expect(container.textContent).not.toContain("Model Management");
    expect(window.desktopApi?.listModels).not.toHaveBeenCalled();
    expect(
      container.querySelector("button[aria-current='page']")?.textContent,
    ).not.toBe("Models");
    loadingControl.resolveList?.({ ok: true, value: { workspaces: [] } });
    await act(async () => {});
  });

  it("renders only the workspace setup surface for a missing workspace on a requested workspace page", async () => {
    installDesktopApi({ workspaces: [] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = await renderAndNavigateToModels(container);
    await act(async () => {});

    expect(container.textContent).toContain("Workspace required");
    expect(container.textContent).toContain(
      "Create a workspace to use Systems, Assets, Artifacts, Data, Context, Models, and Images.",
    );
    expect(container.textContent).not.toContain("Model Management");
    expect(window.desktopApi?.listModels).not.toHaveBeenCalled();
    expect(
      container.querySelector("button[aria-current='page']")?.textContent,
    ).not.toBe("Models");
  });

  it("renders only the workspace unavailable surface when the selected workspace is invalid", async () => {
    installDesktopApi({
      workspaces: [],
      selectedWorkspaceId: "workspace.missing",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = await renderAndNavigateToModels(container);
    await act(async () => {});

    expect(container.textContent).toContain(
      "This workspace is unavailable. Select or create another workspace.",
    );
    expect(container.textContent).not.toContain("Model Management");
    expect(window.desktopApi?.listModels).not.toHaveBeenCalled();
    expect(
      container.querySelector("button[aria-current='page']")?.textContent,
    ).not.toBe("Models");
  });

  it("loads the workspace page once the workspace is ready", async () => {
    installDesktopApi({
      workspaces: [workspaceRecord()],
      selectedWorkspaceId: "workspace.ready",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = await renderAndNavigateToModels(container);
    await act(async () => {});

    await waitForText(container, "Model Management");
    expect(container.textContent).toContain("Model Management");
    const workspaceSelect = container.querySelector<HTMLSelectElement>(
      "select[aria-label='Select current workspace']",
    );
    expect(workspaceSelect?.value).toBe("workspace.ready");
    expect(workspaceSelect?.selectedOptions[0]?.textContent).toBe(
      "Ready Workspace",
    );
    expect(window.desktopApi?.listModels).toHaveBeenCalled();
    expect(
      container.querySelector("button[aria-current='page']")?.textContent,
    ).toBe("Models");
  });
});
