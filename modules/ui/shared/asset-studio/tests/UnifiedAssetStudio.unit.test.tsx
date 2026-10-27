import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";

import {
  afterEach,
  before,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import type { AssetStudioClient } from "../AssetStudioManager";
import {
  AssetStudioWorkspace,
  SavedAssetDrafts,
  createAssetStudioEditorState,
} from "../UnifiedAssetStudio";
import { NotificationTestHarness, readNotificationMessages } from "../../notifications/tests/NotificationTestHarness";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Load the browser renderer after installing the DOM, so native text input
// events take the browser path instead of React's non-DOM fallback.
let createRoot: typeof import("react-dom/client")["createRoot"];
before(async () => { createRoot = (await import("react-dom/client")).createRoot; });

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
});

const pending = new Promise<never>(() => undefined);

function createClient(
  overrides: Partial<AssetStudioClient> = {},
): AssetStudioClient {
  return {
    start: () => pending,
    propose: () => pending,
    review: () => pending,
    list: () => pending,
    createAssetDraft: () => pending,
    updateAssetDraft: () => pending,
    readAssetDraft: () => pending,
    listAssetDrafts: () => pending,
    reviewAssetDraft: () => pending,
    publishAssetDraft: () => pending,
    abandonAssetDraft: () => pending,
    ...overrides,
  };
}

const savedView = {
  record: {
    draftId: "studio-draft-1",
    workspaceId: "workspace-a",
    definitionRef: {
      kind: "asset-definition-version",
      id: "workspace.account-card",
      version: "2.1.0",
    },
    semanticDefinition: {
      assetType: "ui-component",
      assetFamily: "resource-backed",
      displayName: "Account card",
      description: "Shows account information.",
      configurationSchema: { type: "object" },
      ports: [{ id: "account", direction: "input" }],
    },
    status: "draft",
    revision: 4,
  },
  resources: [
    {
      path: "frontend/AccountCard.tsx",
      role: "frontend-structure",
      mediaType: "text/typescript",
      content: "export const AccountCard = () => <article>Account</article>;",
    },
    {
      path: "frontend/account-card.css",
      role: "frontend-style",
      mediaType: "text/css",
      content: ".account-card { display: grid; }",
    },
    {
      path: "backend/loadAccount.ts",
      role: "backend-logic",
      mediaType: "text/typescript",
      content: "export async function loadAccount() { return { id: 1 }; }",
    },
  ],
} as any;

describe("Unified Asset Studio", () => {
  it("maps a saved draft back to exact semantic data and backing-resource content", () => {
    const state = createAssetStudioEditorState(savedView);
    expect(state.definitionId).toBe("workspace.account-card");
    expect(state.definitionVersion).toBe("2.1.0");
    expect(state.displayName).toBe("Account card");
    expect(JSON.parse(state.json.configurationSchema)).toEqual({
      type: "object",
    });
    expect(state.resources).toEqual(savedView.resources);
    expect(state.resources).not.toBe(savedView.resources);
  });

  it("reopens an exact saved draft in the single ordered Studio surface", async () => {
    const readAssetDraft = testDouble.fn(async () => ({
      ok: true as const,
      value: savedView,
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <NotificationTestHarness>
          <AssetStudioWorkspace
            workspaceId="workspace-a"
            client={createClient({ readAssetDraft })}
            initialDraftId="studio-draft-1"
          />
        </NotificationTestHarness>,
      );
      await Promise.resolve();
    });

    expect(readAssetDraft).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      draftId: "studio-draft-1",
    });
    expect(container.textContent).toContain("Identity and classification");
    expect(container.textContent).toContain("Frontend structure");
    expect(container.textContent).toContain("Styling logic");
    expect(container.textContent).toContain("Backend logic");
    expect(container.textContent).toContain("Save, review, and publish");
    const workflow = container.querySelector(
      '[role="list"][aria-label="Unified Asset Studio sections"]',
    );
    expect(workflow).toBeDefined();
    expect(workflow?.querySelectorAll('[role="listitem"]').length).toBe(9);
    expect(
      Array.from(container.querySelectorAll("input, select, textarea")).every(
        (control) => control.closest("label") !== null,
      ),
    ).toBe(true);
    const sources = Array.from(
      container.querySelectorAll<HTMLTextAreaElement>(
        "textarea.asset-studio__source",
      ),
    ).map((element) => element.value);
    expect(sources).toEqual([
      savedView.resources[0].content,
      savedView.resources[1].content,
      savedView.resources[2].content,
    ]);
    expect(readNotificationMessages(container)).not.toContain(
      "Saved draft reopened with its semantic data and backing resources.",
    );
  });

  it("lists only unpublished saved assets and opens the selected draft", async () => {
    const onOpenDraft = testDouble.fn();
    const listAssetDrafts = testDouble.fn(async () => ({
      ok: true as const,
      value: {
        drafts: [
          {
            draftId: "studio-draft-1",
            definitionRef: savedView.record.definitionRef,
            implementationDraftId: "implementation-draft-1",
            displayName: "Account card",
            assetType: "ui-component",
            assetFamily: "resource-backed",
            status: "draft",
            revision: 4,
            resourceCount: 3,
            updatedAt: "2026-07-18T00:00:00.000Z",
          },
        ],
      },
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <SavedAssetDrafts
          workspaceId="workspace-a"
          client={createClient({ listAssetDrafts })}
          onOpenDraft={onOpenDraft}
        />,
      );
      await Promise.resolve();
    });

    expect(listAssetDrafts).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      unpublishedOnly: true,
    });
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Open in Studio"),
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
    expect(onOpenDraft).toHaveBeenCalledWith("studio-draft-1");
  });
  it("upgrades a legacy saved draft once and opens the resource-backed Studio draft", async () => {
    const legacyDraft = {
      draftId: "asset-draft.legacy-1",
      targetWorkspaceId: "workspace-a",
      draftEditableValues: {
        "display-name": "Legacy card",
        summary: "Preserved summary",
        description: "Preserved description",
        classification: "component-asset",
      },
      status: "draft",
      provenance: { sourceKind: "human-authored" },
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    } as any;
    const listAssetDrafts = testDouble.fn(async () => ({
      ok: true as const,
      value: { drafts: [] },
    }));
    const createAssetDraft = testDouble.fn(async () => ({
      ok: true as const,
      value: { draftId: "studio-draft.upgraded-1" },
    }));
    const legacyClient = {
      listDrafts: testDouble.fn(async () => ({
        ok: true as const,
        value: { items: [legacyDraft] },
      })),
    };
    const onOpenDraft = testDouble.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <SavedAssetDrafts
          workspaceId="workspace-a"
          client={createClient({ listAssetDrafts, createAssetDraft })}
          legacyClient={legacyClient}
          onOpenDraft={onOpenDraft}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Legacy card");
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Open in Studio"),
    );
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(createAssetDraft.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      sourceLegacyDraftId: "asset-draft.legacy-1",
      semanticDefinition: {
        displayName: "Legacy card",
        description: "Preserved description",
      },
    });
    expect(
      createAssetDraft.mock.calls[0][0].resources.map(
        (resource: any) => resource.role,
      ),
    ).toEqual(["frontend-structure", "frontend-style", "backend-logic"]);
    expect(onOpenDraft).toHaveBeenCalledWith("studio-draft.upgraded-1");
  });

  it("announces a sanitized Saved adapter failure and returns the surface to an idle state", async () => {
    const listAssetDrafts = testDouble.fn(async () => ({
      ok: false as const,
      error: {
        code: "asset-studio.asset-draft.unavailable",
        message: "Saved assets are unavailable.",
      },
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <NotificationTestHarness>
          <SavedAssetDrafts
            workspaceId="workspace-a"
            client={createClient({ listAssetDrafts: listAssetDrafts as any })}
            onOpenDraft={() => undefined}
          />
        </NotificationTestHarness>,
      );
      await Promise.resolve();
    });

    expect(readNotificationMessages(container)).toContain("Saved assets are unavailable.");
    expect(container.textContent).not.toContain("Saved assets are unavailable.");
    expect(readNotificationMessages(container).join(" ")).not.toContain("stack");
    expect(
      container
        .querySelector(".asset-studio--saved")
        ?.getAttribute("aria-busy"),
    ).toBe("false");
  });
});


function studioDeferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function studioButton(panel: HTMLElement, name: string) {
  const value = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(control => control.textContent?.trim() === name);
  if (!value) throw new Error(`Missing Studio button: ${name}`);
  return value;
}
function studioField(panel: HTMLElement, name: string) {
  const label = [...panel.querySelectorAll("label")].find(value => value.firstChild?.textContent?.trim() === name);
  const input = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea");
  if (!input) throw new Error(`Missing Studio field: ${name}`);
  return input;
}
function studioInput(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = control.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
  control.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
async function mountStudioSession(client: AssetStudioClient, workspaceId = "workspace-a", initialDraftId?: string) {
  const panel = document.createElement("div"); document.body.append(panel);
  const root = createRoot(panel); roots.push(root);
  const render = async (scope = workspaceId, source = client, draftId = initialDraftId) => act(async () => root.render(<NotificationTestHarness><AssetStudioWorkspace workspaceId={scope} client={source} initialDraftId={draftId}/></NotificationTestHarness>));
  await render();
  return { panel, root, render };
}
async function fillNewStudio(panel: HTMLElement) {
  await act(async () => {
    studioInput(studioField(panel, "Asset ID"), String(savedView.record.definitionRef.id));
    studioInput(studioField(panel, "Version"), savedView.record.definitionRef.version);
    studioInput(studioField(panel, "Display name"), "Account card");
    studioInput(studioField(panel, "Definition"), "Shows the selected account and status.");
  });
}

describe("Studio draft session ownership and retry", () => {
  it("admits one create before the busy render", async () => {
    const pending = studioDeferred(); let calls = 0;
    const client = createClient({ createAssetDraft: async () => { calls++; return pending.promise; } });
    const { panel } = await mountStudioSession(client); await fillNewStudio(panel);
    try {
      await act(async () => { const save = studioButton(panel, "Save new draft"); save.click(); save.click(); });
      expect(calls).toBe(1);
    } finally { await act(async () => pending.resolve({ ok: true, value: { ...savedView.record, status: "draft", revision: 1 } })); }
  });

  it("does not install a former workspace create reply in the new editor", async () => {
    const pending = studioDeferred(), client = createClient({ createAssetDraft: () => pending.promise });
    const { panel, render } = await mountStudioSession(client); await fillNewStudio(panel);
    await act(async () => studioButton(panel, "Save new draft").click());
    await render("workspace-b");
    await act(async () => pending.resolve({ ok: true, value: { ...savedView.record, status: "draft", revision: 1 } }));
    expect(studioButton(panel, "Save new draft").disabled).toBe(false);
    expect(studioField(panel, "Asset ID").value).toBe("");
    expect(studioField(panel, "Asset ID").disabled).toBe(false);
    expect(readNotificationMessages(panel).join(" ")).not.toContain("Draft saved");
  });
});


function studioFixtureView(workspaceId = "workspace-a", draftId = "studio.current", status = "draft", revision = 1) {
  return { record: { ...structuredClone(savedView.record), workspaceId, draftId, status, revision }, resources: structuredClone(savedView.resources) };
}
describe("Studio resource-backed lifecycle controls", () => {
  it("creates, reopens, edits, saves, reviews and explicitly publishes exact semantic and resource values", async () => {
    let view = studioFixtureView(); const calls: { action: string; command: any }[] = [];
    const record = (action: string, input: any, status: string) => {
      calls.push({ action, command: structuredClone(input) });
      view = { record: { ...view.record, definitionRef: input.definitionRef ?? view.record.definitionRef,
        semanticDefinition: input.semanticDefinition ?? view.record.semanticDefinition, status,
        revision: action === "create" ? 1 : view.record.revision + 1 }, resources: structuredClone(input.resources ?? view.resources) };
      return { ok: true as const, value: structuredClone(view.record) };
    };
    const client = createClient({ createAssetDraft: async input => record("create", input, "draft"), updateAssetDraft: async input => record("update", input, "draft"),
      readAssetDraft: async input => { calls.push({ action: "read", command: structuredClone(input) }); return { ok: true, value: structuredClone(view) }; },
      reviewAssetDraft: async input => record("review", input, "reviewed"), publishAssetDraft: async input => record("publish", input, "published") });
    const { panel, render } = await mountStudioSession(client); await fillNewStudio(panel);
    const schema = { type: "object", properties: { accountId: { type: "string" } }, required: ["accountId"] };
    const source = "export const AccountCard = () => <article role='status'>Account status</article>;";
    await act(async () => { studioInput(studioField(panel, "Configuration schema"), JSON.stringify(schema)); studioInput(panel.querySelector<HTMLTextAreaElement>("textarea.asset-studio__source")!, source); });
    expect(calls.length).toBe(0); expect(studioButton(panel, "Review draft").disabled).toBe(true);
    await act(async () => studioButton(panel, "Save new draft").click());
    expect(calls.map(value => value.action)).toEqual(["create"]);
    expect(calls[0].command).toMatchObject({ workspaceId: "workspace-a", definitionRef: savedView.record.definitionRef, semanticDefinition: { displayName: "Account card", description: "Shows the selected account and status.", configurationSchema: schema } });
    expect(calls[0].command.resources.length).toBe(3); expect(calls[0].command.resources[0].content).toBe(source);
    await render("workspace-a", client, "studio.current");
    expect(studioField(panel, "Display name").value).toBe("Account card");
    expect(JSON.parse(studioField(panel, "Configuration schema").value)).toEqual(schema);
    expect([...panel.querySelectorAll<HTMLTextAreaElement>("textarea.asset-studio__source")].map(value => value.value)).toEqual(view.resources.map((value: any) => value.content));
    await act(async () => studioInput(studioField(panel, "Display name"), "Current account status"));
    expect(studioButton(panel, "Review draft").disabled).toBe(true);
    await act(async () => studioButton(panel, "Save draft").click());
    expect(calls.find(value => value.action === "update")!.command).toMatchObject({ draftId: "studio.current", expectedRevision: 1, workspaceId: "workspace-a", semanticDefinition: { displayName: "Current account status" } });
    await act(async () => studioButton(panel, "Review draft").click());
    expect(calls.filter(value => value.action === "publish").length).toBe(0); expect(studioButton(panel, "Publish asset").disabled).toBe(false);
    await act(async () => studioInput(studioField(panel, "Definition"), "Newer account description"));
    expect(studioButton(panel, "Publish asset").disabled).toBe(true);
    await act(async () => studioButton(panel, "Save draft").click());
    expect(view.record.status).toBe("draft"); expect(studioButton(panel, "Publish asset").disabled).toBe(true);
    await act(async () => studioButton(panel, "Review draft").click());
    await act(async () => studioButton(panel, "Publish asset").click());
    expect(calls.filter(value => value.action === "publish").map(value => value.command)).toEqual([{ workspaceId: "workspace-a", draftId: "studio.current", expectedRevision: 5 }]);
    expect(panel.textContent).toContain("published - revision 6");
    for (const label of ["Save draft", "Review draft", "Publish asset", "Abandon draft"]) expect(studioButton(panel, label).disabled).toBe(true);
    expect(view.resources[0].content).toBe(source);
  });

  it("retries a refused saved-draft read through an explicit control", async () => {
    let reads = 0; const view = studioFixtureView();
    const client = createClient({ readAssetDraft: async () => ++reads === 1
      ? { ok: false, error: { code: "unavailable", message: "Saved asset is unavailable." } } as any
      : { ok: true, value: view } });
    const { panel } = await mountStudioSession(client, "workspace-a", "studio.current");
    expect(panel.querySelector(".asset-studio--unified")!.getAttribute("aria-busy")).toBe("false");
    await act(async () => studioButton(panel, "Retry opening saved asset").click());
    expect(reads).toBe(2); expect(studioField(panel, "Display name").value).toBe(view.record.semanticDefinition.displayName);
  });
});


const studioOperations = [
  { method: "createAssetDraft", button: "Save new draft", status: "draft", create: true },
  { method: "updateAssetDraft", button: "Save draft", status: "draft", create: false },
  { method: "reviewAssetDraft", button: "Review draft", status: "reviewed", create: false },
  { method: "publishAssetDraft", button: "Publish asset", status: "published", create: false },
  { method: "abandonAssetDraft", button: "Abandon draft", status: "abandoned", create: false },
] as const;
describe("Studio mutation admission, acknowledgement and failure matrix", () => {
  for (const operation of studioOperations) {
    const originalView = () => studioFixtureView("workspace-a", "studio.original", operation.method === "publishAssetDraft" ? "reviewed" : "draft");
    if (!operation.create) it(`admits only one ${operation.method} before React renders busy`, async () => {
      const pending = studioDeferred(); let calls = 0; const view = originalView();
      const client = createClient({ readAssetDraft: async () => ({ ok: true, value: view }), [operation.method]: () => { calls++; return pending.promise; } });
      const { panel } = await mountStudioSession(client, "workspace-a", view.record.draftId);
      try { await act(async () => { const button = studioButton(panel, operation.button); button.click(); button.click(); }); expect(calls).toBe(1); }
      finally { await act(async () => pending.resolve({ ok: true, value: { ...view.record, status: operation.status, revision: 2 } })); }
    });
    for (const failure of ["throw", "reject"] as const) it(`releases ${operation.method} after ${failure}, preserves content and permits explicit retry`, async () => {
      const view = originalView(); let calls = 0;
      const mutate = () => { calls++; if (calls === 1) { const error = new Error("synthetic-private-studio-adapter-detail"); if (failure === "throw") throw error; return Promise.reject(error); } return Promise.resolve({ ok: true, value: { ...view.record, status: operation.status, revision: operation.create ? 1 : 2 } }); };
      const client = createClient({ readAssetDraft: async () => ({ ok: true, value: view }), [operation.method]: mutate });
      const { panel } = await mountStudioSession(client, "workspace-a", operation.create ? undefined : view.record.draftId);
      if (operation.create) await fillNewStudio(panel);
      const before = [...panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].map(value => value.value);
      await act(async () => studioButton(panel, operation.button).click());
      expect(panel.querySelector(".asset-studio--unified")!.getAttribute("aria-busy")).toBe("false");
      expect(studioButton(panel, operation.button).disabled).toBe(false);
      expect([...panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].map(value => value.value)).toEqual(before);
      expect(readNotificationMessages(panel).join(" ")).toContain("could not");
      expect(panel.textContent).not.toContain("synthetic-private-studio-adapter-detail");
      await act(async () => studioButton(panel, operation.button).click()); expect(calls).toBe(2);
      expect(panel.textContent).toContain(`${operation.status} - revision ${operation.create ? 1 : 2}`);
    });
    for (const foreign of ["workspace", "draft", "definition", "revision", "state"] as const) {
      if (operation.create && foreign === "draft") continue; // Create assigns a new opaque draft identity.
      it(`refuses a ${foreign} acknowledgement for ${operation.method}`, async () => {
        const view = originalView(), result = { ...view.record, definitionRef: { ...view.record.definitionRef }, status: operation.status as string, revision: operation.create ? 1 : 2 };
        if (foreign === "workspace") result.workspaceId = "workspace.foreign";
        if (foreign === "draft") result.draftId = "studio.foreign";
        if (foreign === "definition") result.definitionRef.id = "workspace.foreign-definition";
        if (foreign === "revision") result.revision += 7;
        if (foreign === "state") result.status = operation.status === "published" ? "draft" : "published";
        let calls = 0; const client = createClient({ readAssetDraft: async () => ({ ok: true, value: view }), [operation.method]: async () => { calls++; return { ok: true, value: result }; } });
        const { panel } = await mountStudioSession(client, "workspace-a", operation.create ? undefined : view.record.draftId);
        if (operation.create) await fillNewStudio(panel);
        await act(async () => studioButton(panel, operation.button).click());
        expect(calls).toBe(1); expect(studioButton(panel, operation.button).disabled).toBe(false);
        expect(panel.textContent).not.toContain("workspace.foreign");
        if (!operation.create) expect(panel.textContent).toContain(`${view.record.status} - revision 1`);
        expect(readNotificationMessages(panel).join(" ")).toContain("could not");
      });
    }
  }

  it("keeps text and resource changes made while saving dirty until a second explicit save", async () => {
    const view = studioFixtureView(); const pending = studioDeferred(); const commands: any[] = [];
    const client = createClient({ readAssetDraft: async () => ({ ok: true, value: view }), updateAssetDraft: async input => {
      commands.push(structuredClone(input)); return commands.length === 1 ? pending.promise : { ok: true, value: { ...view.record, semanticDefinition: input.semanticDefinition, revision: 3 } };
    } });
    const { panel } = await mountStudioSession(client, "workspace-a", view.record.draftId);
    await act(async () => studioButton(panel, "Save draft").click());
    await act(async () => { studioInput(studioField(panel, "Display name"), "Newer unsaved card"); studioInput(panel.querySelector<HTMLTextAreaElement>("textarea.asset-studio__source")!, "export const NewerCard = () => <article>Newer content</article>;"); });
    await act(async () => pending.resolve({ ok: true, value: { ...view.record, revision: 2 } }));
    expect(studioField(panel, "Display name").value).toBe("Newer unsaved card");
    expect(studioButton(panel, "Review draft").disabled).toBe(true);
    expect(commands[0].semanticDefinition.displayName).toBe(view.record.semanticDefinition.displayName);
    expect(commands[0].resources[0].content).toBe(view.resources[0].content);
    await act(async () => studioButton(panel, "Save draft").click());
    expect(commands[1]).toMatchObject({ expectedRevision: 2, semanticDefinition: { displayName: "Newer unsaved card" } });
    expect(commands[1].resources[0].content).toContain("Newer content"); expect(studioButton(panel, "Review draft").disabled).toBe(false);
  });
});

describe("Studio delayed mutation ownership", () => {
  for (const operation of studioOperations) for (const replacement of ["workspace", "client", "draft", "unmount"] as const) for (const outcome of ["accepted", "rejected"] as const) {
    it(`ignores ${outcome} ${operation.method} after ${replacement} replacement`, async () => {
      const pending = studioDeferred(), original = studioFixtureView("workspace-a", "studio.original", operation.method === "publishAssetDraft" ? "reviewed" : "draft");
      const current = studioFixtureView(replacement === "workspace" ? "workspace-b" : "workspace-a", replacement === "client" ? original.record.draftId : "studio.next", "draft", 9);
      current.record.semanticDefinition.displayName = "Current session card";
      const client = createClient({ readAssetDraft: async input => ({ ok: true, value: input.draftId === "studio.next" ? current : original }), [operation.method]: () => pending.promise });
      const nextClient = createClient({ readAssetDraft: async () => ({ ok: true, value: current }) });
      const mounted = await mountStudioSession(client, "workspace-a", operation.create ? undefined : original.record.draftId);
      if (operation.create) await fillNewStudio(mounted.panel);
      await act(async () => studioButton(mounted.panel, operation.button).click());
      if (replacement === "unmount") { await act(async () => mounted.root.unmount()); roots.splice(roots.indexOf(mounted.root), 1); }
      else await mounted.render(current.record.workspaceId, replacement === "client" ? nextClient : client,
        operation.create && replacement !== "draft" ? undefined : current.record.draftId);
      await act(async () => outcome === "accepted" ? pending.resolve({ ok: true, value: { ...original.record, status: operation.status, revision: operation.create ? 1 : 2 } }) : pending.reject(new Error("synthetic-obsolete-studio-error")));
      expect(readNotificationMessages(mounted.panel)).toEqual([]);
      expect(mounted.panel.textContent).not.toContain("synthetic-obsolete-studio-error");
      if (replacement !== "unmount") {
        if (operation.create && replacement !== "draft") { expect(studioButton(mounted.panel, "Save new draft").disabled).toBe(false); expect(studioField(mounted.panel, "Asset ID").value).toBe(""); }
        else { expect(studioField(mounted.panel, "Display name").value).toBe("Current session card"); expect(mounted.panel.textContent).toContain("draft - revision 9"); }
        expect(mounted.panel.querySelector(".asset-studio--unified")!.getAttribute("aria-busy")).toBe("false");
      }
    });
  }
});

describe("Studio saved-read rejection and identity", () => {
  for (const fault of ["throw", "reject", "workspace", "draft", "definition", "revision"] as const) it(`refuses ${fault} read output and allows explicit retry`, async () => {
    let reads = 0; const view = studioFixtureView();
    const client = createClient({ readAssetDraft: () => {
      if (++reads > 1) return Promise.resolve({ ok: true, value: view });
      if (fault === "throw") throw new Error("synthetic-private-read-error");
      if (fault === "reject") return Promise.reject(new Error("synthetic-private-read-error"));
      const foreign = structuredClone(view);
      if (fault === "workspace") foreign.record.workspaceId = "workspace.foreign";
      if (fault === "draft") foreign.record.draftId = "studio.foreign";
      if (fault === "definition") foreign.record.definitionRef.kind = "artifact";
      if (fault === "revision") foreign.record.revision = 0;
      return Promise.resolve({ ok: true, value: foreign });
    } });
    const { panel } = await mountStudioSession(client, "workspace-a", view.record.draftId);
    expect(panel.querySelector(".asset-studio--unified")!.getAttribute("aria-busy")).toBe("false");
    expect(studioField(panel, "Display name").value).toBe(""); expect(panel.textContent).not.toContain("synthetic-private-read-error");
    await act(async () => studioButton(panel, "Retry opening saved asset").click());
    expect(reads).toBe(2); expect(studioField(panel, "Display name").value).toBe(view.record.semanticDefinition.displayName);
  });
});


describe("Studio delayed saved-read ownership", () => {
  for (const replacement of ["workspace", "client", "draft", "unmount"] as const) for (const outcome of ["accepted", "rejected"] as const) {
    it(`ignores ${outcome} saved read after ${replacement} replacement`, async () => {
      const pending = studioDeferred(), old = studioFixtureView("workspace-a", "studio.original"); old.record.semanticDefinition.displayName = "Former session private card";
      const current = studioFixtureView(replacement === "workspace" ? "workspace-b" : "workspace-a", replacement === "client" ? old.record.draftId : "studio.next", "draft", 9);
      current.record.semanticDefinition.displayName = "Current session card";
      const client = createClient({ readAssetDraft: input => input.draftId === old.record.draftId ? pending.promise : Promise.resolve({ ok: true, value: current }) });
      const nextClient = createClient({ readAssetDraft: async () => ({ ok: true, value: current }) });
      const mounted = await mountStudioSession(client, "workspace-a", old.record.draftId);
      if (replacement === "unmount") { await act(async () => mounted.root.unmount()); roots.splice(roots.indexOf(mounted.root), 1); }
      else await mounted.render(current.record.workspaceId, replacement === "client" ? nextClient : client, current.record.draftId);
      await act(async () => outcome === "accepted" ? pending.resolve({ ok: true, value: old }) : pending.reject(new Error("synthetic-obsolete-read-error")));
      expect(mounted.panel.textContent).not.toContain("Former session private card"); expect(mounted.panel.textContent).not.toContain("synthetic-obsolete-read-error");
      expect(readNotificationMessages(mounted.panel)).toEqual([]);
      if (replacement !== "unmount") {
        expect(studioField(mounted.panel, "Display name").value).toBe("Current session card");
        expect(mounted.panel.textContent).toContain("draft - revision 9");
        expect(mounted.panel.querySelector(".asset-studio--unified")!.getAttribute("aria-busy")).toBe("false");
      }
    });
  }
});


describe("Studio saved-read admission", () => {
  for (const retry of [false, true]) it(`keeps the saved editor unavailable until ${retry ? "retry" : "initial"} read is admitted`, async () => {
    const pending = studioDeferred(); let calls = 0;
    const client = createClient({ readAssetDraft: async () => {
      calls++; if (retry && calls === 1) throw new Error("synthetic-first-read-failure");
      return pending.promise;
    } });
    const { panel } = await mountStudioSession(client, "workspace-a", "studio.current");
    if (retry) await act(async () => studioButton(panel, "Retry opening saved asset").click());
    for (const control of panel.querySelectorAll("input,textarea,select")) expect(control.matches(":disabled")).toBe(true);
    expect(studioButton(panel, "Save new draft").matches(":disabled")).toBe(true);
    await act(async () => pending.resolve({ ok: true, value: studioFixtureView() }));
    expect(studioField(panel, "Display name").value).toBe(savedView.record.semanticDefinition.displayName);
    expect(studioField(panel, "Display name").matches(":disabled")).toBe(false);
    await act(async () => studioInput(studioField(panel, "Display name"), "Admitted saved editor"));
    expect(studioField(panel, "Display name").value).toBe("Admitted saved editor");
    expect(studioButton(panel, "Review draft").disabled).toBe(true);
  });

  it("does not dispatch a saved read after retirement before the first promise turn", async () => {
    const { flushSync } = await import("react-dom"); let calls = 0;
    const client = createClient({ readAssetDraft: async () => { calls++; return { ok: true, value: studioFixtureView() }; } });
    const panel = document.createElement("div"); document.body.append(panel); const root = createRoot(panel); roots.push(root);
    await act(async () => {
      flushSync(() => root.render(<NotificationTestHarness><AssetStudioWorkspace workspaceId="workspace-a" client={client} initialDraftId="studio.current"/></NotificationTestHarness>));
      root.unmount(); roots.splice(roots.indexOf(root), 1);
    });
    expect(calls).toBe(0); expect(panel.textContent).toBe("");
  });
});
