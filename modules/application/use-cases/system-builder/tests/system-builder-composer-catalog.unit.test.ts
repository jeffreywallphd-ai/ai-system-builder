import { describe, expect, it } from "../../../../testing/node-test";
import type {
  AssetDefinition,
  AssetReference,
} from "../../../../contracts/asset";
import {
  ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetSlotId,
} from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { AssetRegistryDefinitionReadPort } from "../../../ports/asset";
import { SYSTEM_FOUNDATION_LAYOUT_DEFINITIONS } from "../../../services/asset-packs/system-packs/system-foundation-layout-presets";
import { SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST } from "../../../services/asset-packs/system-packs/system-foundation-pack-v3.manifest";
import type {
  AssetDefinitionCard,
  AssetDefinitionDetail,
  AssetRegistryListQuery,
  AssetRegistryReadOptions,
} from "../../../services/asset/asset-registry-read-facade.types";
import { ListSystemBuilderComposerAssetsUseCase } from "../list-system-builder-composer-assets.use-case";
import { ReadSystemBuilderComposerAssetUseCase } from "../read-system-builder-composer-asset.use-case";

const workspaceId = createWorkspaceId("workspace-composer");
const parent = definition("builtin.layout.parent", "system", "structural", {
  slots: [
    {
      schemaVersion: ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
      slotId: normalizeAssetSlotId("content"),
      displayName: "Content",
      cardinality: { minItems: 0, maxItems: 4 },
      acceptedAssetTypes: ["ui-component"],
    },
  ],
});
const child = definition("workspace.card", "ui-component", "structural", {
  metadata: { categoryId: "ui-structure" },
  configurationSchema: {
    fields: [
      {
        fieldId: "title",
        valueKind: "string",
        label: "Title",
        defaultValue: "Overview",
        uiHint: { hintKind: "text", section: "Content", order: 1 },
      },
    ],
  },
  defaultConfiguration: { title: "Overview" },
  ports: [{ portId: "selected", direction: "output" }],
});

describe("System Builder composer catalog", () => {
  it("returns exact effective details and shared slot compatibility", async () => {
    const registry = new FakeRegistry(parent, child);
    const result = await new ListSystemBuilderComposerAssetsUseCase(
      registry,
    ).execute({
      workspaceId,
      parentDefinitionRef: exactReference(parent),
      slotId: "content",
      compatibleOnly: true,
      limit: 20,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBe(1);
    expect(result.value.items[0]?.definitionId).toBe("workspace.card");
    expect(result.value.items[0]?.version).toBe("1.0.0");
    expect(result.value.items[0]?.compatibility.status).toBe("compatible");
    expect(result.value.items[0]?.compatibility.slotId).toBe("content");
    expect(result.value.items[0]?.implementationAvailability).toBe(
      "definition-only",
    );
    expect(result.value.items[0]?.previewAvailability).toBe("unavailable");
    expect(result.value.items[0]?.categoryId).toBe("ui-structure");
    expect("configurationSchema" in result.value.items[0]!).toBe(false);
    expect("defaultConfiguration" in result.value.items[0]!).toBe(false);
    expect(result.value.items[0]?.ports[0]?.portId).toBe("selected");
    expect(registry.listQuery?.workspaceId).toBe(workspaceId);
    expect(registry.listQuery?.limit).toBe(20);
    expect(
      registry.readOptions.every(
        (options) =>
          options.workspaceId === workspaceId &&
          options.includeConfigurationSchema !== true &&
          options.includePorts === true,
      ),
    ).toBe(true);
  });

  it("loads property schema and defaults only through an exact workspace-scoped detail read", async () => {
    const registry = new FakeRegistry(parent, child);
    const result = await new ReadSystemBuilderComposerAssetUseCase(
      registry,
    ).execute({
      workspaceId,
      definitionRef: exactReference(child),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definitionId).toBe("workspace.card");
    expect(result.value.configurationSchema?.fields[0]?.fieldId).toBe("title");
    expect(result.value.defaultConfiguration).toEqual({ title: "Overview" });
    expect(result.value.ports[0]?.portId).toBe("selected");
    expect(registry.readOptions).toEqual([
      {
        workspaceId,
        includeConfigurationSchema: true,
        includePorts: true,
      },
    ]);
  });

  it("fails exact detail reads closed without exposing registry errors", async () => {
    const registry: AssetRegistryDefinitionReadPort = {
      listDefinitionCards: async () => ({ items: [] }),
      readDefinitionDetail: async () => {
        throw new Error("C:\\private\\workspace\\definition.json");
      },
    };
    const result = await new ReadSystemBuilderComposerAssetUseCase(
      registry,
    ).execute({
      workspaceId,
      definitionRef: exactReference(child),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "system-builder.composer-detail-unavailable",
      );
      expect(result.error.message.includes("private")).toBe(false);
    }
  });

  it("bounds queries and reports unavailable slots without reading candidates", async () => {
    const registry = new FakeRegistry(parent, child);
    const invalidLimit = await new ListSystemBuilderComposerAssetsUseCase(
      registry,
    ).execute({ workspaceId, limit: 201 });
    expect(invalidLimit.ok).toBe(false);
    if (!invalidLimit.ok) {
      expect(invalidLimit.error.code).toBe(
        "system-builder.composer-limit-invalid",
      );
    }

    const missingSlot = await new ListSystemBuilderComposerAssetsUseCase(
      registry,
    ).execute({
      workspaceId,
      parentDefinitionRef: exactReference(parent),
      slotId: "missing",
    });
    expect(missingSlot.ok).toBe(false);
    if (!missingSlot.ok) {
      expect(missingSlot.error.code).toBe(
        "system-builder.composer-slot-not-found",
      );
    }
    expect(registry.listCalls).toBe(0);
  });

  it("projects trusted foundation layouts as dimension-locked abstract geometry", async () => {
    const standardLayout = SYSTEM_FOUNDATION_LAYOUT_DEFINITIONS.find(
      (item) =>
        String(item.definitionId) === "builtin.layout.application.standard",
    );
    if (!standardLayout) throw new Error("Missing standard layout fixture.");
    const registry = new FakeRegistry(parent, standardLayout);
    const result = await new ListSystemBuilderComposerAssetsUseCase(
      registry,
    ).execute({ workspaceId, limit: 20 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]?.layoutRole).toBe("application-shell");
    expect(result.value.items[0]?.layoutGeometry).toEqual({
      columnPattern: "single",
      areas: [["top-bar"], ["content"]],
      sourceOrder: ["top-bar", "content"],
      dimensionsLocked: true,
    });
    expect(
      result.value.items[0]?.slots.map((slot) => String(slot.slotId)),
    ).toEqual(["top-bar", "content"]);
    expect("configurationSchema" in result.value.items[0]!).toBe(false);
  });

  it("offers current application layouts to a trusted Foundation 1.0 workspace without widening ordinary asset visibility", async () => {
    const legacyRoot = definition(
      "builtin.system.system",
      "system",
      "structural",
    );
    const standardLayout = SYSTEM_FOUNDATION_LAYOUT_DEFINITIONS.find(
      (item) =>
        String(item.definitionId) === "builtin.layout.application.standard",
    );
    if (!standardLayout) throw new Error("Missing standard layout fixture.");
    const staleStandardLayout = { ...standardLayout, slots: [] };
    const registry: AssetRegistryDefinitionReadPort = {
      listDefinitionCards: async (query = {}) => {
        if (query.searchText === "builtin.system.system") {
          return {
            items: [
              {
                ...card(legacyRoot),
                builtIn: true,
                sourcePackId: "system.foundation" as never,
                sourcePackVersion: "1.0.0",
                sourceKind: "system",
                sourceLayer: "system-default",
                trustStatus: "system-trusted",
                systemDefault: true,
              },
            ],
          };
        }
        return {
          items: [{ ...card(staleStandardLayout), builtIn: true }],
        };
      },
      readDefinitionDetail: async (reference) =>
        String(reference.id) === String(staleStandardLayout.definitionId)
          ? { definition: staleStandardLayout, builtIn: true }
          : undefined,
    };

    const result = await new ListSystemBuilderComposerAssetsUseCase(
      registry,
    ).execute({
      workspaceId,
      searchText: "builtin.layout.application",
      limit: 20,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBe(8);
    expect(
      result.value.items.every(
        (item) =>
          item.layoutRole === "application-shell" &&
          item.version === "3.0.0" &&
          item.builtIn,
      ),
    ).toBe(true);
    expect(
      result.value.items
        .find(
          (item) => item.definitionId === "builtin.layout.application.standard",
        )
        ?.slots.map((slot) => String(slot.slotId)),
    ).toEqual(["top-bar", "content"]);
  });

  it("projects current nested Foundation containers for a trusted Foundation 1.0 workspace", async () => {
    const legacyRoot = definition(
      "builtin.system.system",
      "system",
      "structural",
    );
    const legacyPage = definition("builtin.shell.page", "page", "structural");
    const registry: AssetRegistryDefinitionReadPort = {
      listDefinitionCards: async (query = {}) => {
        if (query.searchText === "builtin.system.system") {
          return {
            items: [
              {
                ...card(legacyRoot),
                builtIn: true,
                sourcePackId: "system.foundation" as never,
                sourcePackVersion: "1.0.0",
                sourceKind: "system",
                sourceLayer: "system-default",
                trustStatus: "system-trusted",
                systemDefault: true,
              },
            ],
          };
        }
        return { items: [{ ...card(legacyPage), builtIn: true }] };
      },
      readDefinitionDetail: async (reference) =>
        String(reference.id) === String(legacyPage.definitionId)
          ? { definition: legacyPage, builtIn: true }
          : undefined,
    };
    const useCase = new ListSystemBuilderComposerAssetsUseCase(registry);

    const result = await useCase.execute({ workspaceId, limit: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const currentPage = result.value.items.find(
      (item) =>
        item.definitionId === "builtin.shell.page" && item.version === "3.0.0",
    );
    const assistant = result.value.items.find(
      (item) => item.definitionId === "conversation.basic-assistant-system",
    );
    const chatShell = result.value.items.find(
      (item) => item.definitionId === "conversation.chat-shell",
    );
    const composer = result.value.items.find(
      (item) => item.definitionId === "conversation.message-composer",
    );
    expect(currentPage?.slots.map((slot) => String(slot.slotId))).toEqual([
      "content",
      "actions",
    ]);
    expect(assistant?.slots.map((slot) => String(slot.slotId))).toEqual([
      "interface",
    ]);
    expect(assistant?.layoutGeometry).toEqual({
      columnPattern: "single",
      areas: [["interface"]],
      sourceOrder: ["interface"],
      dimensionsLocked: true,
    });
    expect(chatShell?.slots.map((slot) => String(slot.slotId))).toEqual([
      "status",
      "history",
      "composer",
      "states",
    ]);
    expect(composer?.slots.map((slot) => String(slot.slotId))).toEqual([
      "input",
      "actions",
    ]);
    expect(composer?.layoutGeometry?.areas).toEqual([["input"], ["actions"]]);
    expect(
      result.value.items.some(
        (item) =>
          item.definitionId === "builtin.shell.page" &&
          item.version === "1.0.0",
      ),
    ).toBe(false);

    const compatible = await useCase.execute({
      workspaceId,
      parentDefinitionRef: currentPage?.definitionRef,
      slotId: "content",
      compatibleOnly: true,
      limit: 200,
    });
    expect(compatible.ok).toBe(true);
    if (!compatible.ok) return;
    expect(
      compatible.value.items.some(
        (item) => item.definitionId === "conversation.basic-assistant-system",
      ),
    ).toBe(true);
  });

  it("evaluates legacy workspace assets against an exact trusted current layout parent", async () => {
    const legacyRoot = definition(
      "builtin.system.system",
      "system",
      "structural",
    );
    const legacyPage = definition("builtin.shell.page", "page", "structural");
    const standard = SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST.assets.find(
      (entry) =>
        String(entry.definition.definitionId) ===
        "builtin.layout.application.standard",
    )?.definition;
    if (!standard) throw new Error("Missing standard layout fixture.");
    const registry: AssetRegistryDefinitionReadPort = {
      listDefinitionCards: async (query = {}) => {
        if (query.searchText === "builtin.system.system") {
          return {
            items: [
              {
                ...card(legacyRoot),
                builtIn: true,
                sourcePackId: "system.foundation" as never,
                sourcePackVersion: "1.0.0",
                sourceKind: "system",
                sourceLayer: "system-default",
                trustStatus: "system-trusted",
                systemDefault: true,
              },
            ],
          };
        }
        return { items: [card(legacyPage)] };
      },
      readDefinitionDetail: async (reference) => {
        if (String(reference.id).startsWith("builtin.layout.application.")) {
          return {
            definition: { ...standard, slots: [] },
            builtIn: true,
          };
        }
        return String(reference.id) === String(legacyPage.definitionId)
          ? { definition: legacyPage, builtIn: true }
          : undefined;
      },
    };

    const result = await new ListSystemBuilderComposerAssetsUseCase(
      registry,
    ).execute({
      workspaceId,
      parentDefinitionRef: exactReference(standard),
      slotId: "content",
      compatibleOnly: true,
      limit: 20,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.definitionId)).toContain(
      "builtin.layout.page.single",
    );
    expect(result.value.items.map((item) => item.definitionId)).not.toContain(
      "builtin.shell.page",
    );
    expect(
      result.value.items.every(
        (item) =>
          item.layoutRole === "page-layout" &&
          item.compatibility.status === "compatible",
      ),
    ).toBe(true);
  });

  it("fails closed with a bounded message when workspace resolution fails", async () => {
    const registry: AssetRegistryDefinitionReadPort = {
      listDefinitionCards: async () => {
        throw new Error("C:\\private\\workspace\\secret.json");
      },
      readDefinitionDetail: async () => undefined,
    };
    const result = await new ListSystemBuilderComposerAssetsUseCase(
      registry,
    ).execute({ workspaceId });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(
        "Unable to read compatible assets for this workspace.",
      );
      expect(result.error.message.includes("private")).toBe(false);
    }
  });
});

class FakeRegistry implements AssetRegistryDefinitionReadPort {
  public listCalls = 0;
  public listQuery?: AssetRegistryListQuery;
  public readonly readOptions: AssetRegistryReadOptions[] = [];

  public constructor(
    private readonly parent: AssetDefinition,
    private readonly child: AssetDefinition,
  ) {}

  public async listDefinitionCards(query: AssetRegistryListQuery = {}) {
    this.listCalls += 1;
    this.listQuery = query;
    return { items: [card(this.child)] };
  }

  public async readDefinitionDetail(
    reference: AssetReference,
    options: AssetRegistryReadOptions = {},
  ): Promise<AssetDefinitionDetail | undefined> {
    this.readOptions.push(options);
    if (String(reference.id) === String(this.parent.definitionId)) {
      return { definition: this.parent, builtIn: true };
    }
    if (String(reference.id) === String(this.child.definitionId)) {
      return { definition: this.child, builtIn: false };
    }
    return undefined;
  }
}

function definition(
  definitionId: string,
  assetType: AssetDefinition["assetType"],
  assetFamily: AssetDefinition["assetFamily"],
  overrides: Partial<AssetDefinition> = {},
): AssetDefinition {
  return {
    definitionId: normalizeAssetId(definitionId),
    assetType,
    assetFamily,
    version: "1.0.0",
    displayName: definitionId,
    description: `${definitionId} description`,
    lifecycleStatus: "published",
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

function exactReference(value: AssetDefinition): AssetReference {
  return {
    kind: "asset-definition-version",
    id: normalizeAssetId(String(value.definitionId)),
    version: value.version,
  };
}

function card(value: AssetDefinition): AssetDefinitionCard {
  return {
    definitionRef: exactReference(value),
    definitionId: String(value.definitionId),
    version: value.version,
    assetType: value.assetType,
    assetFamily: value.assetFamily,
    displayName: value.displayName,
    summary: value.description,
    lifecycleStatus: value.lifecycleStatus,
    builtIn: false,
  };
}
