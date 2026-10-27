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

// The actual static document and controller run against a finite monotonic clock.
// No app process, model, provider or remote resource is started by these cases.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createDesktopStartupController, type DesktopStartupHost } from "../startup/desktopStartup";

function startupFixture(options: { reduced?: boolean; alreadyShown?: boolean } = {}) {
  const source = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const fixture = new JSDOM(source, { url: "http://127.0.0.1:3005/", pretendToBeVisual: true });
  const d = fixture.window.document;
  let hidden = false;
  Object.defineProperty(d, "hidden", { get: () => hidden });
  let time = 0;
  let sequence = 0;
  let reloads = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const frames = new Map<number, () => void>();
  const mediaListeners = new Set<() => void>();
  const motion = {
    matches: options.reduced ?? false,
    addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => { mediaListeners.add(listener as () => void); },
    removeEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => { mediaListeners.delete(listener as () => void); },
  };
  const host: DesktopStartupHost = {
    now: () => time,
    setTimeout: (callback, ms) => { const id = ++sequence; timers.set(id, { due: time + ms, callback }); return id; },
    clearTimeout: id => { timers.delete(id); },
    requestFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelFrame: id => { frames.delete(id); },
    motion: motion as DesktopStartupHost["motion"],
    reload: () => { reloads += 1; },
  };
  if (options.alreadyShown) d.documentElement.dataset.desktopWindowShown = "true";
  const controller = createDesktopStartupController(d, host);
  const e = (id: string) => d.getElementById(id)!;
  const fixtureApi = {
    controller, d, source, timers, frames, mediaListeners, e,
    get reloads() { return reloads; },
    tick(ms: number) {
      const end = time + ms;
      let steps = 0;
      for (;;) {
        const next = [...timers].filter(([, v]) => v.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        assert.ok(++steps < 1_000, "controller must not spin a zero-delay loop");
        time = next[1].due; timers.delete(next[0]); next[1].callback();
      }
      time = end;
    },
    frame() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); },
    show() { d.documentElement.dataset.desktopWindowShown = "true"; d.dispatchEvent(new fixture.window.Event("desktop-window-shown")); },
    hidden(value: boolean) { hidden = value; d.dispatchEvent(new fixture.window.Event("visibilitychange")); },
    reduce(value: boolean) { motion.matches = value; for (const fn of [...mediaListeners]) fn(); },
    close() { controller.dispose(); fixture.window.close(); },
  };
  return fixtureApi;
}

async function usingStartup(run: (f: ReturnType<typeof startupFixture>) => void | Promise<void>, options?: Parameters<typeof startupFixture>[0]) {
  const f = startupFixture(options);
  try { await run(f); } finally { f.close(); }
}

describe("desktop first document startup", () => {
  it("supplies themed, accessible static feedback before any React module runs", () => usingStartup(f => {
    assert.equal(f.e("root").getAttribute("aria-hidden"), "true");
    assert.equal(f.e("root").hasAttribute("inert"), true);
    assert.equal(f.e("desktop-startup").hidden, false);
    assert.equal(f.e("desktop-startup-status").getAttribute("role"), "status");
    assert.equal(f.e("desktop-startup-tip").closest("section")!.getAttribute("aria-live"), "off");
    assert.equal(f.e("desktop-startup-reload").getAttribute("href"), "./index.html");
    assert.match(f.source, /rel="stylesheet" href="\.\/styles\/startup\.css"/);
    assert.match(f.source, /type="module" src="\.\/startup\.ts"/);
    assert.match(f.e("desktop-startup-stage").textContent!, /document opened/i);
  }));

  it("holds a fast committed shell until native reveal, two paints and1500 visible milliseconds", () => usingStartup(f => {
    f.controller.initialize(); f.controller.loaded(); f.controller.ready();
    f.tick(10_000);
    assert.equal(f.e("desktop-startup").hidden, false, "hidden-window time does not count");
    f.show(); f.tick(5_000); f.frame(); f.tick(5_000); f.frame();
    f.tick(1_499); assert.equal(f.e("desktop-startup").hidden, false);
    f.tick(1); assert.equal(f.e("desktop-startup").hidden, true);
    assert.equal(f.e("root").inert, false);
    assert.equal(f.e("root").hasAttribute("aria-hidden"), false);
    assert.equal(f.timers.size + f.frames.size + f.mediaListeners.size, 0);
  }));

  it("replays an early native cue and ignores duplicate show/StrictMode ready notifications", () => usingStartup(f => {
    f.controller.initialize(); f.controller.initialize(); f.frame(); f.frame();
    f.controller.ready(); f.tick(1_000); f.show(); f.controller.ready();
    f.tick(499); assert.equal(f.e("desktop-startup").hidden, false);
    f.tick(1); assert.equal(f.e("desktop-startup").hidden, true);
    f.controller.ready(); f.show(); f.tick(30_000);
    assert.equal(f.e("desktop-startup").hidden, true);
    assert.equal(f.timers.size + f.frames.size, 0);
  }, { alreadyShown: true }));

  it("does not count hidden time toward the minimum visible display", () => usingStartup(f => {
    f.controller.initialize(); f.show(); f.frame(); f.frame(); f.controller.ready();
    f.tick(700); f.hidden(true); f.tick(30_000);
    assert.equal(f.e("desktop-startup").hidden, false);
    assert.equal(f.timers.size + f.frames.size, 0);
    f.hidden(false); f.frame(); f.frame(); f.tick(799); assert.equal(f.e("desktop-startup").hidden, false);
    f.tick(1); assert.equal(f.e("desktop-startup").hidden, true);
  }));

  it("waits for restored paint opportunities even with only1ms visible time remaining", () => usingStartup(f => {
    f.controller.initialize(); f.show(); f.frame(); f.frame(); f.controller.ready();
    f.tick(1_499); f.hidden(true); f.tick(10_000); f.hidden(false);
    f.tick(1_000); assert.equal(f.e("desktop-startup").hidden, false);
    f.frame(); f.tick(1_000); assert.equal(f.e("desktop-startup").hidden, false);
    f.frame(); assert.equal(f.e("desktop-startup").hidden, false);
    f.tick(1); assert.equal(f.e("desktop-startup").hidden, true);
  }));

  it("retires explicit reload so late module, failure or frame callbacks cannot restart it", () => usingStartup(async f => {
    const pending = deferred<unknown>(); const running = f.controller.start(() => pending.promise);
    f.show(); const frame = [...f.frames.values()][0]; assert.ok(frame);
    f.e("desktop-startup-reload").click(); frame();
    pending.resolve({}); await running; f.controller.loaded(); f.controller.ready(); f.controller.fail();
    let starts = 0; await f.controller.start(async () => { starts += 1; });
    f.tick(60_000);
    assert.equal(f.reloads, 1); assert.equal(starts, 0);
    assert.equal(f.timers.size + f.frames.size + f.mediaListeners.size, 0);
    assert.notEqual(f.e("desktop-startup").dataset.state, "failed");
  }));

  it("keeps a pending module visible, reports only actual milestones and permits late success", () => usingStartup(async f => {
    const main = deferred<unknown>();
    const running = f.controller.start(() => main.promise);
    assert.match(f.e("desktop-startup-stage").textContent!, /Loading interface modules/);
    f.show(); f.frame(); f.frame(); f.tick(20_000);
    assert.equal(f.e("desktop-startup").dataset.state, "delayed");
    assert.match(f.e("desktop-startup-message").textContent!, /still starting/);
    assert.equal(f.e("desktop-startup").hidden, false);
    main.resolve({}); await running; f.controller.loaded();
    assert.match(f.e("desktop-startup-stage").textContent!, /modules loaded/);
    f.controller.ready(); assert.equal(f.e("desktop-startup").hidden, true);
  }));

  it("rotates accurate tips with working Pause, Resume and Next controls", () => usingStartup(f => {
    f.controller.initialize(); const first = f.e("desktop-startup-tip").textContent;
    f.tick(6_499); assert.equal(f.e("desktop-startup-tip").textContent, first);
    f.tick(1); assert.match(f.e("desktop-startup-tip").textContent!, /Artifact Ingestion/);
    f.e("desktop-startup-tip-pause").click();
    assert.equal(f.e("desktop-startup-tip-pause").getAttribute("aria-pressed"), "true");
    f.tick(13_000); assert.match(f.e("desktop-startup-tip").textContent!, /Artifact Ingestion/);
    f.e("desktop-startup-tip-next").click(); assert.match(f.e("desktop-startup-tip").textContent!, /aisb-package/);
    f.e("desktop-startup-tip-pause").click(); f.tick(6_500);
    assert.match(f.e("desktop-startup-tip").textContent!, /Refresh Models/);
    f.tick(6_500); assert.equal(f.e("desktop-startup-tip").textContent, first);
  }));

  it("pauses hidden activity without a catch-up burst", () => usingStartup(f => {
    f.controller.initialize(); f.tick(6_000); f.hidden(true);
    const tip = f.e("desktop-startup-tip").textContent;
    f.tick(60_000); assert.equal(f.timers.size + f.frames.size, 0);
    f.hidden(false); assert.equal(f.e("desktop-startup-tip").textContent, tip);
    f.tick(6_499); assert.equal(f.e("desktop-startup-tip").textContent, tip);
    f.tick(1); assert.notEqual(f.e("desktop-startup-tip").textContent, tip);
  }));

  it("honors reduced motion while leaving Next available and adapting to preference changes", () => usingStartup(f => {
    f.controller.initialize(); const tip = f.e("desktop-startup-tip").textContent;
    f.tick(10_000); assert.equal(f.e("desktop-startup-tip").textContent, tip);
    assert.equal(f.e("desktop-startup-tip-pause").hidden, true);
    assert.equal(f.e("desktop-startup").dataset.motion, "paused");
    f.e("desktop-startup-tip-next").click(); assert.notEqual(f.e("desktop-startup-tip").textContent, tip);
    f.reduce(false); assert.equal(f.e("desktop-startup-tip-pause").hidden, false);
    f.tick(6_500); assert.match(f.e("desktop-startup-tip").textContent!, /aisb-package/);
  }, { reduced: true }));

  for (const failure of ["throw", "reject"] as const) {
    it(`recovers a ${failure} from bootstrap without exposing exception details`, () => usingStartup(async f => {
      const sensitive = "SYNTHETIC_PRIVATE_PATH_OR_TOKEN";
      await f.controller.start(() => { if (failure === "throw") throw new Error(sensitive); return Promise.reject(new Error(sensitive)); });
      assert.equal(f.e("desktop-startup").dataset.state, "failed");
      assert.equal(f.e("desktop-startup-status").getAttribute("role"), "alert");
      assert.equal(f.d.body.textContent!.includes(sensitive), false);
      assert.equal(f.d.activeElement, f.e("desktop-startup-title"));
      assert.equal(f.timers.size + f.frames.size + f.mediaListeners.size, 0);
      f.e("desktop-startup-reload").click(); assert.equal(f.reloads, 1);
    }));
  }

  it("does not dismiss an error that arrives during the minimum display", () => usingStartup(f => {
    f.controller.initialize(); f.show(); f.frame(); f.frame(); f.controller.ready();
    f.tick(700); f.controller.fail(); f.tick(5_000); f.controller.ready();
    assert.equal(f.e("desktop-startup").hidden, false);
    assert.equal(f.e("desktop-startup").dataset.state, "failed");
    assert.equal(f.e("root").inert, true);
  }));

  it("can restore the safe failure surface after the shell was already shown", () => usingStartup(f => {
    f.controller.initialize(); f.show(); f.frame(); f.frame(); f.controller.ready(); f.tick(1_500);
    assert.equal(f.e("desktop-startup").hidden, true);
    f.controller.fail(); assert.equal(f.e("desktop-startup").hidden, false);
    assert.equal(f.e("desktop-startup-progress").hidden, true);
    assert.equal(f.e("desktop-startup-tip-controls").hidden, true);
  }));

  it("transfers focus from a loading control only at final dismissal", () => usingStartup(f => {
    f.e("root").innerHTML = '<main><h1>Home</h1><button>App action</button></main>';
    f.controller.initialize(); f.show(); f.frame(); f.frame();
    f.e("desktop-startup-tip-next").focus(); f.controller.ready(); f.controller.ready();
    f.tick(1_499); assert.equal(f.d.activeElement, f.e("desktop-startup-tip-next"));
    f.tick(1); const heading = f.e("root").querySelector("h1")!;
    assert.equal(f.d.activeElement, heading);
    f.e("root").querySelector("button")!.focus(); assert.equal(heading.hasAttribute("tabindex"), false);
  }));

  it("does not steal existing app focus and cleans up an explicit reload", () => usingStartup(f => {
    f.e("root").innerHTML = '<button>App action</button>';
    f.controller.initialize(); f.show(); f.frame(); f.frame();
    const button = f.e("root").querySelector("button")!; button.focus();
    f.controller.ready(); f.tick(1_500); assert.equal(f.d.activeElement, button);
    f.controller.fail(); f.e("desktop-startup-reload").click();
    assert.equal(f.reloads, 1); assert.equal(f.timers.size + f.frames.size + f.mediaListeners.size, 0);
  }));

  for (const fails of [false, true]) {
    it(`uses the actual renderer entry to ${fails ? "recover an uncaught React error" : "commit the shell behind the minimum display"}`, () => usingStartup(async f => {
      const { transform } = await import("esbuild");
      const source = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
      const compiled = await transform(source, { loader: "tsx", format: "cjs", jsx: "automatic", target: "node24" });
      let mounted: Root | undefined;
      let signal!: () => void;
      const settled = new Promise<void>(resolve => { signal = resolve; });
      const flag = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
      f.controller.initialize(); f.show(); f.frame(); f.frame();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        runInNewContext(compiled.code, {
          document: f.d,
          require(specifier: string) {
            if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier);
            if (specifier === "react-dom/client") return { createRoot: (node: HTMLElement, options: Parameters<typeof createRoot>[1]) => (mounted = createRoot(node, options)) };
            if (specifier === "./App") return { __esModule: true, default: () => {
              if (fails) throw new Error("SYNTHETIC_PRIVATE_REACT_DETAIL");
              return require("react").createElement("main", null, require("react").createElement("h1", null, "Fixture shell"));
            } };
            if (specifier === "./styles/app.css") return {};
            if (specifier === "./startup/desktopStartup") return {
              markDesktopRendererLoaded: () => f.controller.loaded(),
              markDesktopRendererReady: () => { f.controller.ready(); signal(); },
              showDesktopStartupFailure: () => { f.controller.fail(); signal(); },
            };
            throw new Error("Unexpected bootstrap fixture dependency");
          },
        });
        await Promise.race([settled, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Renderer entry did not report its outcome")), 1_000); })]);
        if (fails) {
          assert.equal(f.e("desktop-startup").dataset.state, "failed");
          assert.equal(f.e("desktop-startup").hidden, false);
          assert.equal(f.d.body.textContent!.includes("SYNTHETIC_PRIVATE_REACT_DETAIL"), false);
        } else {
          assert.match(f.e("root").textContent!, /Fixture shell/);
          f.tick(1_499); assert.equal(f.e("desktop-startup").hidden, false);
          f.tick(1); assert.equal(f.e("desktop-startup").hidden, true);
        }
      } finally {
        if (deadline !== undefined) clearTimeout(deadline);
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = flag;
        if (mounted) await act(async () => mounted!.unmount());
      }
    }));
  }
});
