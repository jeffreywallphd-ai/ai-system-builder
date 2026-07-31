import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
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

function json(payload: unknown): Response {
  return { status: 200, headers: { get: () => "application/json" }, json: async () => payload } as Response;
}

function workspaceRecord(id = "thin-workspace", displayName = "Thin Workspace") {
  return { workspaceId: id, displayName, status: "active", createdAt: "2026-05-14T00:00:00.000Z" };
}

function installFetch(options: { readonly selectedWorkspaceId?: string; readonly workspaces?: readonly ReturnType<typeof workspaceRecord>[] }) {
  let selectedWorkspaceId = options.selectedWorkspaceId;
  const workspaces = [...(options.workspaces ?? [])];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.endsWith("/api/workspaces")) return json({ ok: true, value: { workspaces } });
    if (url.endsWith("/api/workspaces/active-selection") && init?.method === "GET") return json({ ok: true, value: selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : {} });
    if (url.endsWith("/api/workspaces/active-selection")) { selectedWorkspaceId = body.selection?.workspaceId; return json({ ok: true, value: { selection: body.selection } }); }
    if (url.endsWith("/api/model/list")) return json({ ok: true, value: { models: [] } });
    if (url.endsWith("/api/artifact/browse")) return json({ ok: true, value: { items: [] } });
    if (url.endsWith("/api/asset/definitions")) return json({ ok: true, value: { items: [] } });
    return json({ ok: true, value: { items: [], models: [] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderAt(path: string) {
  window.history.pushState({}, "", path);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await act(async () => {});
  return { container, root };
}

describe("thin-client app workspace route boundary", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    window.history.pushState({}, "", "/");
    vi.unstubAllGlobals();
  });

  for (const [path, blockedPageText] of [
    ["/models", "Model Management"],
    ["/assets", "Asset Library"],
    ["/artifacts", "Data Management"],
    ["/image-generation", "Generate images from a prompt"],
  ] as const) {
    it(`renders only workspace setup for direct ${path} loads without an active workspace`, async () => {
      const fetchMock = installFetch({ workspaces: [] });
      ({ container, root } = await renderAt(path));

      expect(window.location.pathname).toBe(path);
      expect(container.textContent).toContain("Workspace required");
      expect(container.textContent).toContain("Create a workspace to use Assets, Artifacts, Data, Models, and Images.");
      expect(container.textContent).not.toContain(blockedPageText);
      expect(container.querySelector("button[aria-current='page']")?.textContent).not.toBe("Models");
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/model/list"), expect.anything());
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/artifact/browse"), expect.anything());
    });
  }

  it("keeps the pending browser path stable while workspace setup is shown", async () => {
    installFetch({ workspaces: [] });
    ({ container, root } = await renderAt("/models"));

    expect(window.location.pathname).toBe("/models");
    await act(async () => {});
    expect(window.location.pathname).toBe("/models");
    expect(container.textContent).toContain("Workspace required");
    expect(container.querySelector("button[aria-current='page']")?.textContent).not.toBe("Models");
  });

  it("renders the pending direct workspace page with required workspace props after a workspace is selected", async () => {
    installFetch({ workspaces: [workspaceRecord()], selectedWorkspaceId: "thin-workspace" });
    ({ container, root } = await renderAt("/models"));

    expect(window.location.pathname).toBe("/models");
    expect(container.textContent).toContain("Current Workspace");
    expect(container.textContent).toContain("Thin Workspace");
    expect(container.textContent).toContain("Model Management");
    expect(
      container.querySelector("[aria-label='Workspace required']"),
    ).toBeNull();
    expect(container.querySelector("button[aria-current='page']")?.textContent).toBe("Models");
  });
});
