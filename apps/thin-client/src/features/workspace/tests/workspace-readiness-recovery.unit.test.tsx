// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createWorkspaceId } from "../../../../../../modules/contracts/workspace";
import { ActiveWorkspaceProvider, useActiveWorkspace, type WorkspaceClient, type WorkspaceUiRecord } from "../hooks/useActiveWorkspace";
function client(records: WorkspaceUiRecord[], selected?: ReturnType<typeof createWorkspaceId>) {
  return { listWorkspaces: async () => records, readActiveWorkspaceSelection: async () => ({workspaceId: selected}),
  saveActiveWorkspaceSelection: async () => {}, clearActiveWorkspaceSelection: async () => {}, createWorkspace: async () => { throw new Error("not used"); } } satisfies WorkspaceClient;
}
let container: HTMLDivElement | undefined;
let root: Root | undefined;
let previousActFlag: PropertyDescriptor | undefined;
beforeEach(() => {
  previousActFlag = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true, writable: true, value: true,
  });
});
afterEach(async () => {
  try {
    if (root) await act(async () => root?.unmount());
  } finally {
    container?.remove();
    root = undefined;
    container = undefined;
    if (previousActFlag) {
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActFlag);
    } else {
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  }
});
  it("preserves a confirmed workspace after failed selection/clear but gates a failed refresh", async () => {
    const records = [{ id: createWorkspaceId("workspace.alpha"), displayName: "Alpha", status: "active", createdAt: "2026-05-14T00:00:00.000Z" }] satisfies WorkspaceUiRecord[];
    const workspaceClient = client(records, records[0].id);
    workspaceClient.saveActiveWorkspaceSelection = async () => { throw new Error("private failure"); };
    workspaceClient.clearActiveWorkspaceSelection = async () => { throw new Error("private failure"); };
    let context: ReturnType<typeof useActiveWorkspace>;
    const Probe = () => { context = useActiveWorkspace(); return <span>{context.status}</span>; };
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root!.render(<ActiveWorkspaceProvider client={workspaceClient}><Probe /></ActiveWorkspaceProvider>); });
    expect(context!.status).toBe("ready");
    await act(async () => { await context!.selectWorkspace("workspace.alpha"); });
    expect(context!.status).toBe("ready"); expect(context!.error).toContain("could not be saved");
    await act(async () => { await context!.clearActiveWorkspace(); });
    expect(context!.status).toBe("ready"); expect(context!.activeWorkspaceId).toBe("workspace.alpha");
    workspaceClient.listWorkspaces = async () => { throw new Error("authorization unavailable"); };
    await act(async () => { await context!.refreshWorkspaces(); });
    expect(context!.status).toBe("error"); expect(context!.error).toBe("Workspace could not be loaded.");
    workspaceClient.listWorkspaces = async () => [];
    await act(async () => { await context!.refreshWorkspaces(); });
    expect(context!.status).toBe("unavailable");
  });
