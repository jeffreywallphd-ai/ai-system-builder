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
import type { WorkspaceClient, WorkspaceUiRecord } from "../features/workspace";
import { ActiveWorkspaceProvider } from "../features/workspace";
import {
  createLazyDesktopPageRegistry,
  type DesktopLazyPageModule,
  type DesktopLazyPageRegistry,
} from "../routes/lazyDesktopPages";
import type { DesktopPageKey } from "../routes/desktopPages";
import { NotificationProvider } from "../../../../../modules/ui/shared";

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
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).sessionStorage = dom.window.sessionStorage;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function pageModule(label: string): DesktopLazyPageModule<any> {
  return {
    default: (props: Record<string, unknown>) => (
      <section
        data-testid={`${label}-page`}
        data-workspace-name={String(props.workspaceName ?? "")}
      >
        Lazy {label} page
      </section>
    ),
  };
}

function createControlledRegistry() {
  const calls = new Map<DesktopPageKey, number>();
  const pending = new Map<
    DesktopPageKey,
    Deferred<DesktopLazyPageModule<any>>
  >();

  const loaderFor = (pageKey: DesktopPageKey) => () => {
    calls.set(pageKey, (calls.get(pageKey) ?? 0) + 1);
    const control =
      pending.get(pageKey) ?? deferred<DesktopLazyPageModule<any>>();
    pending.set(pageKey, control);
    return control.promise;
  };

  return {
    registry: createLazyDesktopPageRegistry({
      home: loaderFor("home"),
      artifacts: loaderFor("artifacts"),
      assets: loaderFor("assets"),
      models: loaderFor("models"),
      "image-generation": loaderFor("image-generation"),
      settings: loaderFor("settings"),
      systems: loaderFor("systems"),
    }),
    calls,
    resolve(pageKey: DesktopPageKey, label = pageKey) {
      const control = pending.get(pageKey);
      if (!control) {
        throw new Error(`No pending loader for ${pageKey}.`);
      }
      control.resolve(pageModule(label));
    },
  };
}

function workspaceClient(
  records: readonly WorkspaceUiRecord[] = [],
  selectedWorkspaceId?: string,
): WorkspaceClient {
  return {
    listWorkspaces: testDouble.fn(async () => records),
    readActiveWorkspaceSelection: testDouble.fn(async () =>
      selectedWorkspaceId ? { workspaceId: selectedWorkspaceId as any } : {},
    ),
    saveActiveWorkspaceSelection: testDouble.fn(async () => undefined),
    clearActiveWorkspaceSelection: testDouble.fn(async () => undefined),
    createWorkspace: testDouble.fn(async () => {
      throw new Error("unused");
    }),
  };
}

function readyWorkspace(): WorkspaceUiRecord {
  return {
    id: "workspace.ready",
    displayName: "Ready Workspace",
    status: "active",
    createdAt: "2026-05-14T00:00:00.000Z",
  };
}

async function mountWithRegistry(
  lazyPages: DesktopLazyPageRegistry,
  client: WorkspaceClient,
) {
  const { WorkspaceAwareDesktopApp } = await import("../App");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <ActiveWorkspaceProvider client={client}>
        <NotificationProvider>
          <WorkspaceAwareDesktopApp lazyPages={lazyPages} />
        </NotificationProvider>
      </ActiveWorkspaceProvider>,
    );
  });

  return { root, container };
}

async function settle() {
  await act(async () => {});
}

describe("desktop renderer lazy page loading", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;
  let consoleLogSpy: { mockRestore: () => void } | undefined;

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => mountedRoot?.unmount());
    }
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
    delete window.desktopApi;
    consoleLogSpy?.mockRestore();
    consoleLogSpy = undefined;
  });

  it("renders the app shell and navigation while the active page module is still pending", async () => {
    window.desktopApi = { memoryDiagnosticsEnabled: false } as any;
    const controlled = createControlledRegistry();
    const mounted = await mountWithRegistry(
      controlled.registry,
      workspaceClient(),
    );
    mountedRoot = mounted.root;
    mountedContainer = mounted.container;

    expect(mounted.container.textContent).toContain("Home");
    expect(mounted.container.textContent).toContain("Data");
    expect(mounted.container.textContent).toContain("Assets");
    expect(mounted.container.textContent).toContain("Models");
    expect(mounted.container.textContent).toContain("Image Generation");
    expect(mounted.container.textContent).toContain("Systems");
    expect(mounted.container.textContent).toContain("Loading page…");
    expect(
      Boolean(mounted.container.querySelector(".ui-page-loading-surface")),
    ).toBe(true);
    expect(controlled.calls.get("home")).toBe(1);
    expect(controlled.calls.get("artifacts") ?? 0).toBe(0);
    expect(controlled.calls.get("models") ?? 0).toBe(0);
  });

  it("renders the active lazy page after resolution and keeps unrelated page modules unloaded", async () => {
    window.desktopApi = { memoryDiagnosticsEnabled: false } as any;
    const controlled = createControlledRegistry();
    const mounted = await mountWithRegistry(
      controlled.registry,
      workspaceClient([readyWorkspace()], "workspace.ready"),
    );
    mountedRoot = mounted.root;
    mountedContainer = mounted.container;

    await act(async () => controlled.resolve("home", "home"));
    expect(mounted.container.textContent).toContain("Lazy home page");

    const modelsButton = Array.from(
      mounted.container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Models");
    await act(async () =>
      modelsButton?.dispatchEvent(new Event("click", { bubbles: true })),
    );

    expect(mounted.container.textContent).toContain("Loading page…");
    expect(
      Boolean(mounted.container.querySelector(".ui-page-loading-surface")),
    ).toBe(true);
    expect(controlled.calls.get("models")).toBe(1);
    expect(controlled.calls.get("image-generation") ?? 0).toBe(0);
    expect(controlled.calls.get("artifacts") ?? 0).toBe(0);

    await act(async () => controlled.resolve("models", "models"));
    await settle();

    expect(mounted.container.textContent).toContain("Lazy models page");
    expect(mounted.container.textContent).not.toContain(
      "Lazy image-generation page",
    );
    expect(
      mounted.container.querySelector("button[aria-current='page']")
        ?.textContent,
    ).toBe("Models");
  });

  it("does not import workspace-required page modules when the workspace gate blocks the route", async () => {
    window.desktopApi = { memoryDiagnosticsEnabled: false } as any;
    const controlled = createControlledRegistry();
    const mounted = await mountWithRegistry(
      controlled.registry,
      workspaceClient(),
    );
    mountedRoot = mounted.root;
    mountedContainer = mounted.container;

    await act(async () => controlled.resolve("home", "home"));
    await settle();

    const artifactsButton = Array.from(
      mounted.container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Data");
    await act(async () =>
      artifactsButton?.dispatchEvent(new Event("click", { bubbles: true })),
    );
    await settle();

    expect(mounted.container.textContent).toContain("Workspace required");
    expect(mounted.container.textContent).not.toContain("Lazy artifacts page");
    expect(controlled.calls.get("artifacts") ?? 0).toBe(0);
    expect(
      mounted.container.querySelector("button[aria-current='page']")
        ?.textContent,
    ).not.toBe("Data");
  });

  it("emits lazy page milestones only when renderer diagnostics are enabled", async () => {
    const lines: string[] = [];
    consoleLogSpy = testDouble.spyOn(console, "log").mockImplementation(((
      line: string,
    ) => {
      lines.push(line);
    }) as typeof console.log);

    window.desktopApi = { memoryDiagnosticsEnabled: true } as any;
    const enabledRegistry = createControlledRegistry();
    const enabledMount = await mountWithRegistry(
      enabledRegistry.registry,
      workspaceClient(),
    );
    mountedRoot = enabledMount.root;
    mountedContainer = enabledMount.container;

    const startSnapshot = lines
      .map((line) => JSON.parse(line))
      .find(
        (snapshot) => snapshot.milestone === "renderer.page.lazy-load.start",
      );
    expect(startSnapshot?.detail).toMatchObject({
      activePage: "home",
      visibleActivePage: "home",
      workspaceStatus: "loading",
      routeRequiresWorkspace: false,
    });
    expect(lines.map((line) => JSON.parse(line).milestone)).toContain(
      "renderer.page.lazy-render.fallback",
    );
    await act(async () => enabledRegistry.resolve("home", "home"));
    await settle();
    expect(lines.map((line) => JSON.parse(line).milestone)).toContain(
      "renderer.page.lazy-load.resolved",
    );
    expect(lines.map((line) => JSON.parse(line).milestone)).toContain(
      "renderer.page.active.changed",
    );

    await act(async () => mountedRoot?.unmount());
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
    lines.splice(0, lines.length);
    window.desktopApi = { memoryDiagnosticsEnabled: false } as any;

    const disabledRegistry = createControlledRegistry();
    const disabledMount = await mountWithRegistry(
      disabledRegistry.registry,
      workspaceClient(),
    );
    mountedRoot = disabledMount.root;
    mountedContainer = disabledMount.container;
    await act(async () => disabledRegistry.resolve("home", "home"));
    await settle();

    expect(lines).toEqual([]);
  });
});
