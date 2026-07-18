import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  afterEach,
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

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
        <AssetStudioWorkspace
          workspaceId="workspace-a"
          client={createClient({ readAssetDraft })}
          initialDraftId="studio-draft-1"
        />,
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
        <SavedAssetDrafts
          workspaceId="workspace-a"
          client={createClient({ listAssetDrafts: listAssetDrafts as any })}
          onOpenDraft={() => undefined}
        />,
      );
      await Promise.resolve();
    });

    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toBe("Saved assets are unavailable.");
    expect(alert?.textContent).not.toContain("stack");
    expect(
      container
        .querySelector(".asset-studio--saved")
        ?.getAttribute("aria-busy"),
    ).toBe("false");
  });
});
