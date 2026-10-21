import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { test as it } from "node:test";
import { expect } from "../../../../../../modules/testing/node-test";
import { ActiveWorkspaceProvider, useActiveWorkspace, type WorkspaceClient, type WorkspaceUiRecord } from "../hooks/useActiveWorkspace";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true });
function client(records: WorkspaceUiRecord[], selected?: string): WorkspaceClient {
  return { listWorkspaces: async () => records, readActiveWorkspaceSelection: async () => ({workspaceId: selected}),
  saveActiveWorkspaceSelection: async () => {}, clearActiveWorkspaceSelection: async () => {}, createWorkspace: async () => { throw new Error("not used"); } };
}
let container: HTMLDivElement;
let root: Root;
  it("preserves a confirmed workspace after failed selection/clear but gates a failed refresh", async () => {
    const records = [{ id: "workspace.alpha", displayName: "Alpha", status: "active", createdAt: "2026-05-14T00:00:00.000Z" }] as WorkspaceUiRecord[];
    const workspaceClient = client(records, "workspace.alpha");
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
    await act(async () => root.unmount()); container.remove();
  });
