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
import type {
  AssetDefinitionCard,
  AssetDefinitionDetail,
  AssetRegistryListQuery,
  AssetRegistryReadOptions,
} from "../../../services/asset/asset-registry-read-facade.types";
import { ListSystemBuilderComposerAssetsUseCase } from "../list-system-builder-composer-assets.use-case";

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
    expect(result.value.items[0]?.configurationSchema?.fields[0]?.fieldId).toBe(
      "title",
    );
    expect(result.value.items[0]?.ports[0]?.portId).toBe("selected");
    expect(registry.listQuery?.workspaceId).toBe(workspaceId);
    expect(registry.listQuery?.limit).toBe(20);
    expect(
      registry.readOptions.every(
        (options) =>
          options.workspaceId === workspaceId &&
          options.includeConfigurationSchema === true &&
          options.includePorts === true,
      ),
    ).toBe(true);
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
