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
import { createLocalAssetDefinitionRepositoryAdapter } from "../../../../adapters/persistence/asset";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { AssetRegistryReadFacade } from "../../../services/asset/asset-registry-read-facade.service";

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
  for (const alternative of ["family", "exact-reference"] as const) {
    it(`retains a compatible ${alternative} alternative through the real filtered repository`, async () => {
      const alternativeChild = definition(`workspace.alternative.${alternative}`, "tool", "behavioral");
      const alternativeParent = {...parent, slots: [{...parent.slots![0]!,
        ...(alternative === "family" ? {acceptedAssetFamilies:["behavioral"]} : {acceptedDefinitionRefs:[exactReference(alternativeChild)]}),
      }]};
      const repository = createLocalAssetDefinitionRepositoryAdapter({rootDir:"composer-filter-regression",documents:createInMemoryStructuredDocumentStore()});
      await repository.saveDefinition(alternativeParent);
      await repository.saveDefinition(alternativeChild);
      const registry = new AssetRegistryReadFacade({definitionRepository:repository,instanceRepository:{} as never,compositionRepository:{} as never});
      const result = await new ListSystemBuilderComposerAssetsUseCase(registry).execute({workspaceId,parentDefinitionRef:exactReference(alternativeParent),slotId:"content",compatibleOnly:true,limit:1});
      expect(result.ok).toBe(true);
      if(result.ok) expect(result.value.items.map(item=>item.definitionId)).toEqual([alternativeChild.definitionId]);
    });
  }
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
    expect(registry.listQuery?.assetTypes).toEqual(["ui-component"]);
    expect(
      registry.readOptions.every(
        (options) =>
          options.workspaceId === workspaceId &&
          options.includeConfigurationSchema !== true &&
          options.includePorts === true,
      ),
    ).toBe(true);
  });

  it("preserves unfiltered compatibility explanations without pushing slot constraints",async()=>{
    const registry=new FakeRegistry(parent,child);
    const result=await new ListSystemBuilderComposerAssetsUseCase(registry).execute({workspaceId,parentDefinitionRef:exactReference(parent),slotId:"content",compatibleOnly:false,limit:20});
    expect(result.ok).toBe(true);
    expect(registry.listQuery?.assetTypes).toBeUndefined();
    expect(registry.listQuery?.assetFamilies).toBeUndefined();
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


it("traverses a sparse 1000-definition catalog completely with bounded versioned continuations", async () => {
  const definitions = Array.from({length: 1000}, (_, i) => definition(`candidate.${String(i).padStart(4, "0")}`, i % 10 === 0 ? "ui-component" : "tool", "structural"));
  const byId = new Map(definitions.map(value => [String(value.definitionId), value]));
  let individualReads = 0; let batchReads = 0;
  const registry: AssetRegistryDefinitionReadPort = {
    async listDefinitionCards(query = {}) {
      const offset = Number(query.cursor ?? "0"); const end = Math.min(definitions.length, offset + (query.limit ?? 25));
      return {items: definitions.slice(offset, end).map(card), ...(end < definitions.length ? {nextCursor: String(end)} : {})};
    },
    async readDefinitionDetail(ref) { individualReads++; return ref.id === parent.definitionId ? {definition: parent} : undefined; },
    async readDefinitionDetails(refs) { batchReads++; return refs.map(ref => ({definition: byId.get(String(ref.id))!})); },
  };
  const useCase = new ListSystemBuilderComposerAssetsUseCase(registry);
  const query = {workspaceId, parentDefinitionRef: exactReference(parent), slotId: "content", compatibleOnly: true, limit: 25};
  let cursor: string | undefined; const cursors = new Set<string>(); const actual: string[] = [];
  do {
    const result = await useCase.execute({...query, cursor});
    expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error.message);
    actual.push(...result.value.items.map(item => item.definitionId));
    cursor = result.value.nextCursor;
    if (cursor) { expect(cursors.has(cursor)).toBe(false); cursors.add(cursor); }
  } while (cursor);
  expect(actual).toEqual(definitions.filter((_, i) => i % 10 === 0).map(value => value.definitionId));
  expect(new Set(actual).size).toBe(100); expect(batchReads).toBeGreaterThan(0);
  expect(individualReads).toBe(cursors.size + 1); // Parent only, never one detail read per candidate.
  const saved = [...cursors][0]!;
  expect((await useCase.execute({...query, cursor: saved, workspaceId: "workspace.other"})).ok).toBe(false);
  expect((await useCase.execute({...query, cursor: "malformed"})).ok).toBe(false);
  registry.listDefinitionCards = async () => ({items: [], nextCursor: "loop"});
  expect((await useCase.execute(query)).ok).toBe(false);
});


it("real repository and facade preserve parent slots and omit property defaults from candidate details", async () => {
  const {AssetRegistryReadFacade} = await import("../../../services/asset/asset-registry-read-facade.service");
  const {createLocalAssetDefinitionRepositoryAdapter} = await import("../../../../adapters/persistence/asset");
  const {createInMemoryStructuredDocumentStore} = await import("../../../../adapters/persistence/shared");
  const repository = createLocalAssetDefinitionRepositoryAdapter({rootDir: "composer-regression", documents: createInMemoryStructuredDocumentStore()});
  await repository.saveDefinition(parent); await repository.saveDefinition(child);
  const registry = new AssetRegistryReadFacade({definitionRepository: repository, instanceRepository: {} as never, compositionRepository: {} as never});
  const detail = await registry.readDefinitionDetail(exactReference(parent), {includePorts: true});
  expect(detail?.definition.slots?.[0]?.slotId).toBe("content");
  const candidate = await registry.readDefinitionDetail(exactReference(child), {includePorts: true});
  expect(candidate?.definition.configurationSchema).toBeUndefined(); expect(candidate?.definition.defaultConfiguration).toBeUndefined();
  const selected = await registry.readDefinitionDetail(exactReference(child), {includePorts: true, includeConfigurationSchema: true});
  expect(selected?.definition.defaultConfiguration).toEqual(child.defaultConfiguration);
  const result = await new ListSystemBuilderComposerAssetsUseCase(registry).execute({workspaceId, parentDefinitionRef: exactReference(parent), slotId: "content", compatibleOnly: true, limit: 25});
  expect(result.ok).toBe(true); if (result.ok) expect(result.value.items.map(item => item.definitionId)).toEqual([child.definitionId]);
});

it("reduces measured real-store detail reads by half for the same complete sparse catalog and bytes", async () => {
  const {AssetRegistryReadFacade} = await import("../../../services/asset/asset-registry-read-facade.service");
  const {createLocalAssetDefinitionRepositoryAdapter, LocalAssetRecordStore} = await import("../../../../adapters/persistence/asset");
  const {createInMemoryStructuredDocumentStore} = await import("../../../../adapters/persistence/shared");
  const documents = createInMemoryStructuredDocumentStore();
  const options = {rootDir: "composer-io-fixture", documents};
  const definitions = Array.from({length: 1000}, (_, i) => definition(`io.candidate.${String(i).padStart(4, "0")}`, i % 10 === 0 ? "ui-component" : "tool", "structural"));
  await new LocalAssetRecordStore(options).writeCollection("definitions", [parent, ...definitions]);
  const repository = createLocalAssetDefinitionRepositoryAdapter(options);
  let detailCollectionReads = 0;
  const counted = {...repository, async getDefinition(ref: AssetReference) {detailCollectionReads++; return repository.getDefinition(ref);}, async getDefinitions(refs: readonly AssetReference[]) {detailCollectionReads++; return repository.getDefinitions!(refs);}};
  const facade = new AssetRegistryReadFacade({definitionRepository: counted, instanceRepository: {} as never, compositionRepository: {} as never});
  const baseline: AssetRegistryDefinitionReadPort = {listDefinitionCards: query => facade.listDefinitionCards(query), readDefinitionDetail: (ref, opts) => facade.readDefinitionDetail(ref, opts)};
  async function traverse(registry: AssetRegistryDefinitionReadPort) {
    detailCollectionReads = 0; let cursor: string | undefined; let bytes = 0; const resultIds: string[] = []; const cursors = new Set<string>();
    const useCase = new ListSystemBuilderComposerAssetsUseCase(registry);
    do {
      const result = await useCase.execute({workspaceId, text: "io.candidate.", parentDefinitionRef: exactReference(parent), slotId: "content", compatibleOnly: true, limit: 25, cursor});
      if (!result.ok) throw new Error(result.error.message);
      bytes += Buffer.byteLength(JSON.stringify(result.value));
      resultIds.push(...result.value.items.map(item => item.definitionId)); cursor = result.value.nextCursor;
      if (cursor) {expect(cursors.has(cursor)).toBe(false); cursors.add(cursor);}
    } while (cursor);
    return {resultIds, detailCollectionReads, bytes};
  }
  const before = await traverse(baseline); const after = await traverse(facade);
  expect(after.resultIds).toEqual(definitions.filter((_, i) => i % 10 === 0).map(value => value.definitionId)); expect(after.resultIds).toEqual(before.resultIds);
  expect(after.detailCollectionReads <= before.detailCollectionReads / 2).toBe(true); expect(after.bytes).toBe(before.bytes); expect(after.bytes).toBeGreaterThan(0);
  console.log(JSON.stringify({fixture: "1000-candidates-100-compatible-page25", baselineDetailCollectionReads: before.detailCollectionReads, candidateDetailCollectionReads: after.detailCollectionReads, baselineResponseBytes: before.bytes, candidateResponseBytes: after.bytes}));
});
