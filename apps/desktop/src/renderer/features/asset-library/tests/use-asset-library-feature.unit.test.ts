import { JSDOM } from "jsdom";
import { act, useEffect } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, describe, expect, it, testDouble } from "../../../../../../../modules/testing/node-test";
import type { AssetLibraryClient, AssetLibraryDefinitionCard, AssetLibraryResourceBackedViewCard } from "../../../../../../../modules/ui/shared/asset-library";
import { useAssetLibraryFeature, type AssetLibraryFeatureState } from "../hooks/useAssetLibraryFeature";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;

const card: AssetLibraryDefinitionCard = {
  id: "builtin.document@1.0.0",
  definitionId: "builtin.document",
  version: "1.0.0",
  displayName: "Document",
  summary: "Document building block",
  assetType: "document",
  assetFamily: "resource-backed",
  lifecycleStatus: "published",
  builtIn: true,
  updatedAt: "2026-05-02T00:00:00.000Z",
};

const alternateCard: AssetLibraryDefinitionCard = {
  ...card,
  id: "builtin.dataset@1.0.0",
  definitionId: "builtin.dataset",
  displayName: "Dataset",
  summary: "Dataset building block",
  assetType: "dataset",
};

const resourceViewCard: AssetLibraryResourceBackedViewCard = {
  id: "asset-view.external-repository-object.internal.1",
  viewId: "asset-view.external-repository-object.internal.1",
  displayName: "External object",
  viewKind: "external-repository-object",
  viewKindLabel: "External Repository Object",
  assetType: "data-source",
  assetTypeLabel: "Data Source",
  assetFamily: "resource-backed",
  assetFamilyLabel: "Resource Backed",
  lifecycleStatusLabel: "Not registered",
  sourceKind: "external-repository",
  registrationStatusLabel: "Not imported or registered",
};

function createClient(overrides: Partial<AssetLibraryClient> = {}): AssetLibraryClient {
  return {
    listAssetDefinitions: testDouble.fn().mockResolvedValue({ ok: true, value: { items: [card] } }),
    readAssetDefinition: testDouble.fn().mockResolvedValue({ ok: true, value: { ...card } }),
    readAssetDefinitionVersion: testDouble.fn().mockResolvedValue({ ok: true, value: { ...card, overview: { description: "Reusable document descriptor" } } }),
    listAssetResourceBackedViews: testDouble.fn().mockResolvedValue({ ok: true, value: { items: [resourceViewCard] } }),
    readAssetResourceBackedView: testDouble.fn().mockResolvedValue({ ok: true, value: { ...resourceViewCard } }),
    registerResourceBackedViewAsAsset: testDouble.fn().mockResolvedValue({ ok: true, value: { ok: true, operation: "asset.register-resource-backed-view", status: "created" } }),
    finalizeGeneratedOutputAsAsset: testDouble.fn().mockResolvedValue({ ok: true, value: { ok: true, operation: "asset.finalize-generated-output", status: "created" } }),
    importExternalRepositoryObjectAsAsset: testDouble.fn().mockResolvedValue({ ok: true, value: { ok: true, operation: "asset.import-external-repository-object", status: "created" } }),
    localizeExternalRepositoryObjectAsAsset: testDouble.fn().mockResolvedValue({ ok: true, value: { ok: true, operation: "asset.localize-external-repository-object", status: "created" } }),
    ...overrides,
  };
}

function HookHarness({ client, onState, workspaceId }: { readonly client: AssetLibraryClient; readonly onState: (state: AssetLibraryFeatureState) => void; readonly workspaceId?: string }) {
  const state = useAssetLibraryFeature(client, workspaceId);
  useEffect(() => {
    onState(state);
  }, [onState, state]);

  return createElement("div", null,
    createElement("button", { type: "button", onClick: () => state.setSearchText("doc") }, "search"),
    createElement("button", { type: "button", onClick: () => state.setAssetType("document") }, "type"),
    createElement("button", { type: "button", onClick: () => state.setAssetFamily("resource-backed") }, "family"),
    createElement("button", { type: "button", onClick: () => state.setLifecycleStatus("published") }, "status"),
    createElement("button", { type: "button", onClick: () => state.setBuiltIn("built-in") }, "source"),
    createElement("button", { type: "button", onClick: () => void state.selectDefinition(card) }, "select"),
    createElement("button", { type: "button", onClick: () => void state.selectResourceBackedView(resourceViewCard) }, "select-resource-view"),
    createElement("button", { type: "button", onClick: () => void state.loadValidationDetails() }, "validation"),
    createElement("button", { type: "button", onClick: () => void state.refresh() }, "refresh"),
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useAssetLibraryFeature", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => mountedRoot?.unmount());
    }
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
  });

  async function render(client: AssetLibraryClient, workspaceId: string | null = "workspace.alpha") {
    const states: AssetLibraryFeatureState[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(createElement(HookHarness, { client, workspaceId: workspaceId ?? undefined, onState: (state) => states.push(state) }));
    });
    await flush();
    return { container, states };
  }

  it("does not call the Asset Library client without an active workspace", async () => {
    const client = createClient();
    await render(client, null);

    expect(client.listAssetDefinitions).not.toHaveBeenCalled();
    expect(client.listAssetResourceBackedViews).not.toHaveBeenCalled();
  });

  it("does not call resource-backed detail clients without an active workspace", async () => {
    const client = createClient();
    const { states } = await render(client, null);

    await act(async () => {
      await states[states.length - 1]?.selectResourceBackedView(resourceViewCard);
    });
    await flush();

    expect(client.readAssetResourceBackedView).not.toHaveBeenCalled();
    expect(states[states.length - 1]?.detailError).toBe("Select a workspace before loading resource-backed views.");
  });

  it("loads definitions once on initial render without background repeat calls", async () => {
    const client = createClient();
    await render(client);

    expect(client.listAssetDefinitions).toHaveBeenCalledTimes(1);
    expect(client.listAssetResourceBackedViews).not.toHaveBeenCalled();
    expect(client.listAssetDefinitions).toHaveBeenCalledWith({ limit: 50, workspaceId: "workspace.alpha" });
  });

  it("sends supported query fields when filters change and refreshes the current query", async () => {
    const client = createClient();
    const { container } = await render(client);
    const buttons = Array.from(container.querySelectorAll("button"));

    await act(async () => buttons.find((button) => button.textContent === "search")?.click());
    await flush();
    await act(async () => buttons.find((button) => button.textContent === "type")?.click());
    await flush();
    await act(async () => buttons.find((button) => button.textContent === "family")?.click());
    await flush();
    await act(async () => buttons.find((button) => button.textContent === "status")?.click());
    await flush();
    await act(async () => buttons.find((button) => button.textContent === "source")?.click());
    await flush();

    expect(client.listAssetDefinitions).toHaveBeenCalledWith({
      limit: 50,
      searchText: "doc",
      assetTypes: ["document"],
      assetFamilies: ["resource-backed"],
      lifecycleStatuses: ["published"],
      builtIn: "built-in",
      workspaceId: "workspace.alpha",
    });

    const callsBeforeRefresh = (client.listAssetDefinitions as ReturnType<typeof testDouble.fn>).mock.calls.length;
    await act(async () => buttons.find((button) => button.textContent === "refresh")?.click());
    await flush();

    expect(client.listAssetDefinitions).toHaveBeenCalledTimes(callsBeforeRefresh + 1);
    expect(client.listAssetDefinitions).toHaveBeenCalledWith({
      limit: 50,
      searchText: "doc",
      assetTypes: ["document"],
      assetFamilies: ["resource-backed"],
      lifecycleStatuses: ["published"],
      builtIn: "built-in",
      workspaceId: "workspace.alpha",
    });
  });

  it("selecting a versioned definition reads detail without requesting validation", async () => {
    const client = createClient();
    const { container, states } = await render(client);

    const selectButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "select");
    await act(async () => selectButton?.dispatchEvent(new Event("click", { bubbles: true })));
    await flush();

    expect(client.readAssetDefinitionVersion).toHaveBeenCalledWith(
      { definitionId: "builtin.document", version: "1.0.0" },
      {
        expand: ["aiContext", "configurationSchema", "ports", "requirements", "provenance", "metadata"],
        workspaceId: "workspace.alpha",
      },
    );
    expect((client.readAssetDefinitionVersion as ReturnType<typeof testDouble.fn>).mock.calls
      .some((call) => call[1]?.includeValidation === true)).toBe(false);
    expect(states[states.length - 1]?.selectedDetail?.definitionId).toBe("builtin.document");
  });

  it("keeps the newest modal detail when an older read finishes later", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const readAssetDefinitionVersion = testDouble.fn().mockImplementation(
      (input: { definitionId: string }) =>
        new Promise((resolve) => {
          if (input.definitionId === card.definitionId) {
            resolveFirst = resolve;
          } else {
            resolveSecond = resolve;
          }
        }),
    );
    const client = createClient({
      listAssetDefinitions: testDouble.fn().mockResolvedValue({
        ok: true,
        value: { items: [card, alternateCard] },
      }),
      readAssetDefinitionVersion,
    });
    const { states } = await render(client);

    const firstRead = states[states.length - 1]?.selectDefinition(card);
    const secondRead = states[states.length - 1]?.selectDefinition(alternateCard);
    await act(async () => {
      resolveSecond({
        ok: true,
        value: {
          ...alternateCard,
          overview: { description: "Newest detail" },
        },
      });
      await secondRead;
    });
    await act(async () => {
      resolveFirst({
        ok: true,
        value: { ...card, overview: { description: "Stale detail" } },
      });
      await firstRead;
    });

    expect(states[states.length - 1]?.selectedDetail?.definitionId).toBe(
      alternateCard.definitionId,
    );
  });

  it("loads validation only through the explicit validation action", async () => {
    const client = createClient();
    const { container, states } = await render(client);
    const buttons = Array.from(container.querySelectorAll("button"));

    await act(async () => buttons.find((button) => button.textContent === "select")?.click());
    await flush();
    await act(async () => buttons.find((button) => button.textContent === "validation")?.click());
    await flush();

    const calls = (client.readAssetDefinitionVersion as ReturnType<typeof testDouble.fn>).mock.calls;
    expect(calls[calls.length - 1]).toEqual([
      { definitionId: "builtin.document", version: "1.0.0" },
      {
        expand: ["aiContext", "configurationSchema", "ports", "requirements", "provenance", "metadata"],
        includeValidation: true,
        workspaceId: "workspace.alpha",
      },
    ]);
    expect(states[states.length - 1]?.validationError).toBeUndefined();
  });

  it("selects resource-backed views through read-only detail reads", async () => {
    const client = createClient();
    const { container, states } = await render(client);
    const buttons = Array.from(container.querySelectorAll("button"));

    await act(async () => buttons.find((button) => button.textContent === "select-resource-view")?.click());
    await flush();

    expect(client.readAssetResourceBackedView).toHaveBeenCalledWith(
      { viewId: "asset-view.external-repository-object.internal.1" },
      { expand: ["metadata", "resourceBackings"], workspaceId: "workspace.alpha" },
    );
    expect(states[states.length - 1]?.selectedResourceBackedViewDetail?.registrationStatusLabel).toBe("Not imported or registered");
  });

  it("exposes safe load errors from the client", async () => {
    const client = createClient({
      listAssetDefinitions: testDouble.fn().mockResolvedValue({
        ok: false,
        error: { code: "internal", message: "Unable to read Asset Library data." },
      }),
    });
    const { states } = await render(client);

    expect(states[states.length - 1]?.listError).toBe("Unable to read Asset Library data.");
    expect(states[states.length - 1]?.definitions).toEqual([]);
  });

  it("converts rejected workspace reads into a safe recoverable error", async () => {
    const client = createClient({
      listAssetDefinitions: testDouble
        .fn()
        .mockRejectedValue(new Error("C:\\private\\asset-library.json")),
    });
    const { states } = await render(client);
    const latest = states[states.length - 1];

    expect(latest?.listError).toBe("Unable to read Asset Library data.");
    expect(latest?.isLoadingList).toBe(false);
    expect(JSON.stringify(latest)).not.toContain("private");
  });
});
