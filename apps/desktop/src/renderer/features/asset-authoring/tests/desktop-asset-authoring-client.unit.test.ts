// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createDesktopAssetAuthoringClient } from "../api/desktopAssetAuthoringClient";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createDesktopPreloadApi } from "../../../../preload/exposedApi";
import { registerAssetAuthoringIpc } from "../../../../../../../modules/adapters/transport/ipc-electron/asset-authoring/registerAssetAuthoringIpc";
import { DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL } from "../../../../../../../modules/contracts/ipc";
import { normalizeAuthoredAssetDraftRecord, normalizeAssetDraftId } from "../../../../../../../modules/contracts/asset-authoring";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import { SavedAssetDrafts } from "../../../../../../../modules/ui/shared/asset-studio/UnifiedAssetStudio";
import { NotificationTestHarness, readNotificationMessages } from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";


describe("desktopAssetAuthoringClient", () => {
  it("parses preload envelopes, preserves failure codes, and sends explicit workspace ids", async () => {
    const listAuthoredAssets = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { assets: [] } });
    const listAssetDrafts = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        error: { code: "unavailable", message: "no" },
      });
    const listAssetOverrides = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        error: { code: "conflict", message: "conflict" },
      });
    (window as any).desktopApi = {
      listAuthoredAssets,
      listAssetDrafts,
      listAssetOverrides,
    };
    const c = createDesktopAssetAuthoringClient();
    expect((await c.listAuthoredAssets("w1")).ok).toBe(true);
    const d = await c.listDrafts("w1");
    const o = await c.listOverrides("w1");
    expect(d.ok === true ? "" : d.error.code).toBe("unavailable");
    expect(o.ok === true ? "" : o.error.code).toBe("conflict");
    expect(listAuthoredAssets).toHaveBeenCalledWith({ workspaceId: "w1" });
    expect(listAssetDrafts).toHaveBeenCalledWith({ targetWorkspaceId: "w1" });
  });
  it("sends canonical draft editable command fields", async () => {
    const createAssetDraft = vi
      .fn()
      .mockResolvedValue({ status: "success", payload: {} });
    const updateAssetDraft = vi
      .fn()
      .mockResolvedValue({ status: "success", payload: {} });
    (window as any).desktopApi = { createAssetDraft, updateAssetDraft };
    const c = createDesktopAssetAuthoringClient();
    await c.createDraft({
      workspaceId: "w1",
      displayName: "Draft Name",
      summary: "Summary",
    });
    await c.updateDraft({
      workspaceId: "w1",
      draftId: "d1",
      summary: "Updated",
    });
    expect(createAssetDraft).toHaveBeenCalledWith({
      targetWorkspaceId: "w1",
      draftEditableValues: {
        "display-name": "Draft Name",
        summary: "Summary",
        description: undefined,
      },
    });
    expect(updateAssetDraft).toHaveBeenCalledWith({
      targetWorkspaceId: "w1",
      draftId: "d1",
      draftEditablePatch: {
        "display-name": undefined,
        summary: "Updated",
        description: undefined,
      },
    });
  });
  it("maps target detail and derived customization lifecycle operations", async () => {
    const listAssetDerivedCustomizationTargets = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        value: { targets: [{ displayName: "Button" }] },
      });
    const readAssetDerivedCustomizationTarget = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        value: {
          displayName: "Button",
          backingResources: [
            { path: "frontend/component.tsx", content: "source" },
          ],
        },
      });
    const createAssetDerivedCustomization = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        value: { customizationId: "customization-1" },
      });
    (window as any).desktopApi = {
      listAssetDerivedCustomizationTargets,
      readAssetDerivedCustomizationTarget,
      createAssetDerivedCustomization,
    };
    const c = createDesktopAssetAuthoringClient();
    const listed = await c.listCustomizationTargets({
      workspaceId: "w1",
      text: "button",
    });
    const target = {
      kind: "asset-definition-version",
      id: "builtin.button",
      version: "1.0.0",
    } as any;
    const detail = await c.readCustomizationTarget({
      workspaceId: "w1",
      definitionRef: target,
      implementationReleaseId: "implementation-release.button.1",
    });
    await c.createDerivedCustomization({
      workspaceId: "w1",
      baseDefinitionRef: target,
      baseImplementationReleaseId: "implementation-release.button.1",
      derivedDefinitionRef: { ...target, id: "workspace.button" },
      semanticPatch: { "display-name": "My Button" },
    });
    expect(listed.ok && listed.value.items[0]?.displayName).toBe("Button");
    expect(detail.ok && detail.value.backingResources[0]?.path).toBe(
      "frontend/component.tsx",
    );
    expect(createAssetDerivedCustomization.mock.calls[0][0]).toMatchObject({
      workspaceId: "w1",
      baseImplementationReleaseId: "implementation-release.button.1",
      semanticPatch: { "display-name": "My Button" },
    });
  });
});

describe("desktop Saved read through client, preload and registered IPC", () => {
  let previousApi: PropertyDescriptor | undefined;
  let previousAct: PropertyDescriptor | undefined;
  let root: import("react-dom/client").Root | undefined;
  let panel: HTMLDivElement | undefined;

  beforeEach(() => {
    previousApi = Object.getOwnPropertyDescriptor(window, "desktopApi");
    previousAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = undefined;
    panel?.remove();
    panel = undefined;
    if (previousApi) Object.defineProperty(window, "desktopApi", previousApi);
    else delete (window as any).desktopApi;
    if (previousAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
    else delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  function row(workspaceId: string, draftId: string, name: string) {
    return normalizeAuthoredAssetDraftRecord({
      draftId: normalizeAssetDraftId(draftId), targetWorkspaceId: createWorkspaceId(workspaceId),
      draftEditableValues: { "display-name": name, summary: "Preserve the incident location and severity.", classification: "component-asset" },
      status: "draft", provenance: { kind: "authored-from-scratch", operationAt: "2026-10-27T00:00:00Z" },
      createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z",
    });
  }

  function joined(list?: (query: any) => Promise<any>) {
    const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
    registerAssetAuthoringIpc({
      ipcMain: { handle(channel, handler) { handlers.set(channel, handler as any); } },
      ...{ senderTrust: { isTrustedSender: () => true } },
      ...(list ? { assetDraftRepository: { listAssetDraftRecords: list } as any } : {}),
    });
    const invoke = vi.fn(async (channel: string, request: unknown) => {
      expect(channel).toBe(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value);
      const handler = handlers.get(channel);
      if (!handler) throw new Error("Missing test-owned handler.");
      return handler({}, request);
    });
    const preload = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    Object.defineProperty(window, "desktopApi", { configurable: true, writable: true, value: preload });
    return { preload, invoke, client: createDesktopAssetAuthoringClient() };
  }

  async function show(workspaceId: string, legacyClient: ReturnType<typeof createDesktopAssetAuthoringClient>, studioClient: any) {
    if (!panel) { panel = document.createElement("div"); document.body.append(panel); root = createRoot(panel); }
    await act(async () => {
      root!.render(createElement(NotificationTestHarness, null,
        createElement(SavedAssetDrafts, { workspaceId, client: studioClient, legacyClient, onOpenDraft: vi.fn() })));
    });
    expect(panel.querySelector("[aria-busy]")?.getAttribute("aria-busy")).toBe("false");
  }

  it("shows exact legacy cards and replaces them when the Saved workspace changes", async () => {
    const records = [row("workspace.dispatch", "asset-draft.intake", "Incident intake card"), row("workspace.operations", "asset-draft.status", "Operations status card")];
    const original = JSON.stringify(records);
    const list = vi.fn(async (query: any) => {
      if (!query.workspaceId) throw new Error("Unscoped test read denied.");
      return { records: records.filter(record => record.targetWorkspaceId === query.workspaceId) };
    });
    const { client, invoke } = joined(list);
    const studio = { listAssetDrafts: vi.fn(async () => ({ ok: true, value: { drafts: [] } })) };
    await show("workspace.dispatch", client, studio);
    expect(panel!.textContent).toContain("Incident intake card");
    expect(panel!.textContent).not.toContain("Operations status card");
    expect(list.mock.calls[0][0]).toEqual({ workspaceId: "workspace.dispatch" });
    await show("workspace.operations", client, studio);
    expect(panel!.textContent).toContain("Operations status card");
    expect(panel!.textContent).not.toContain("Incident intake card");
    expect(list.mock.calls[1][0]).toEqual({ workspaceId: "workspace.operations" });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(records)).toBe(original);
    expect(readNotificationMessages(panel!)).toEqual([]);
  });

  it("reports a safe failed read through notifications and recovers on an explicit Search", async () => {
    let available = false;
    const record = row("workspace.dispatch", "asset-draft.intake", "Incident intake card");
    const list = vi.fn(async () => {
      if (!available) throw new Error("synthetic-private-adapter-detail");
      return { records: [record] };
    });
    const { client } = joined(list);
    const studio = { listAssetDrafts: vi.fn(async () => ({ ok: true, value: { drafts: [] } })) };
    await show("workspace.dispatch", client, studio);
    expect(panel!.textContent).not.toContain("Incident intake card");
    expect(readNotificationMessages(panel!)).toContain("Saved asset reads are unavailable or forbidden.");
    expect(JSON.stringify(readNotificationMessages(panel!))).not.toContain("synthetic-private-adapter-detail");
    expect(panel!.textContent).not.toContain("synthetic-private-adapter-detail");
    available = true;
    const form = panel!.querySelector("form")!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(panel!.textContent).toContain("Incident intake card");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("maps only the public target and supported filters, preserving response context", async () => {
    const record = row("workspace.dispatch", "asset-draft.intake", "Incident intake card");
    const list = vi.fn(async (_query: unknown) => ({ records: [record], nextCursor: "next.synthetic" }));
    const { preload } = joined(list);
    const reply = await preload.listAssetDrafts({ targetWorkspaceId: "workspace.dispatch", workspaceId: "workspace.other", status: "draft", authoredAssetId: "asset.intake", limit: 7, cursor: "cursor.synthetic" } as any,
      { requestId: "request.synthetic", correlationId: "correlation.synthetic" });
    expect(list.mock.calls[0][0]).toEqual({ workspaceId: "workspace.dispatch", status: "draft", authoredAssetId: "asset.intake", limit: 7, cursor: "cursor.synthetic" });
    expect(reply).toMatchObject({ ok: true, value: { drafts: [record], nextCursor: "next.synthetic" }, requestId: "request.synthetic", correlationId: "correlation.synthetic" });
  });

  for (const targetWorkspaceId of [undefined, "", "   ", 42]) {
    it(`refuses an invalid target before repository access: ${String(targetWorkspaceId)}`, async () => {
      const list = vi.fn(async () => ({ records: [] }));
      const { client } = joined(list);
      const result = await client.listDrafts(targetWorkspaceId as any);
      expect(result.ok).toBe(false);
      expect(list).not.toHaveBeenCalled();
    });
  }

  it("returns a settled unavailable result when the repository is absent", async () => {
    const { client } = joined();
    expect(await client.listDrafts("workspace.dispatch")).toEqual({ ok: false, error: { code: "unavailable", message: "Read unavailable." } });
  });
});
