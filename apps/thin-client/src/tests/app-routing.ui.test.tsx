import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";

function json(payload: unknown): Response {
  return { status: 200, headers: { get: () => "application/json" }, json: async () => payload } as Response;
}

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
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("gates workspace pages until a workspace is selected and keeps global-safe pages accessible", async () => {
    const workspaces = [{ workspaceId: "thin-workspace", displayName: "Thin Workspace", status: "active", createdAt: "2026-05-14T00:00:00.000Z" }];
    let selectedWorkspaceId: string | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (url.endsWith("/api/workspaces")) return json({ ok: true, value: { workspaces } });
      if (url.endsWith("/api/workspaces/active-selection") && init?.method === "GET") return json({ ok: true, value: selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : {} });
      if (url.endsWith("/api/workspaces/active-selection")) { selectedWorkspaceId = body.selection?.workspaceId; return json({ ok: true, value: { selection: body.selection } }); }
      if (url.endsWith("/api/model/list")) return json({ ok: true, value: { models: [] } });
      if (url.endsWith("/api/artifact/browse")) return json({ ok: true, value: { items: [] } });
      return json({ ok: true, value: { items: [], models: [] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("Build and manage");
    expect(container.textContent).toContain("Manage and Train Models");

    const imageButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Image Generation");
    expect(imageButton).toBeDefined();

    await act(async () => {
      imageButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Create a workspace to use Assets, Artifacts, Data, Models, and Images.");
    expect(container.textContent).toContain("Include System Foundation assets");
    expect(container.textContent).not.toContain("Open Models");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/model/list"), expect.anything());

    selectedWorkspaceId = "thin-workspace";
    await act(async () => {
      root.unmount();
    });
    const remountedRoot = createRoot(container);
    mountedRoot = remountedRoot;
    await act(async () => {
      remountedRoot.render(<App />);
    });
    const imageButtonAfterWorkspace = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Image Generation");
    await act(async () => {
      imageButtonAfterWorkspace?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Current Workspace");
    expect(container.textContent).toContain("Thin Workspace");
    expect(container.textContent).toContain("Open Models");
    expect(container.textContent).not.toContain("thin-workspace");

    const openModelsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Open Models");
    await act(async () => {
      openModelsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(window.location.pathname).toBe("/models");
    expect(container.textContent).toContain("Browse models");

    const artifactsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Artifacts");
    await act(async () => {
      artifactsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Data Management");
    expect(container.querySelector(".ui-panel__section-header h2")?.textContent).toBe("Add data");

    const browserTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Artifact Browser");
    await act(async () => {
      browserTab?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(container.querySelector(".ui-panel__section-header h2")?.textContent).toBe("Artifact Browser");

    const securityButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Security");
    await act(async () => { securityButton?.dispatchEvent(new Event("click", { bubbles: true })); });
    expect(container.textContent).toContain("Security");
    expect(window.location.pathname).toBe("/security");
  });
});
