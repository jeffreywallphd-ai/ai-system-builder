import type {
  AssetDefinition,
  AssetReference,
  AssetSlotDefinition,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import {
  SYSTEM_BUILDER_COMPOSER_DEFAULT_LIMIT,
  SYSTEM_BUILDER_COMPOSER_MAX_LIMIT,
  type ListSystemBuilderComposerAssetsQuery,
  type SystemBuilderComposerAsset,
  type SystemBuilderComposerCatalog,
  type SystemBuilderComposerCompatibility,
  type SystemBuilderResult,
  systemBuilderFailure,
  systemBuilderSuccess,
} from "../../../contracts/system-builder";
import type { AssetRegistryDefinitionReadPort } from "../../ports/asset";
import { readSystemFoundationBackingResourceProgram } from "../../services/asset-packs/system-foundation-backing-resource-catalog";
import {
  readSystemFoundationLayoutPreset,
  SYSTEM_FOUNDATION_LAYOUT_DEFINITIONS,
} from "../../services/asset-packs/system-packs/system-foundation-layout-presets";
import {
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
} from "../../services/asset-packs/system-packs/system-foundation-pack.constants";
import { systemBuilderSlotAcceptsDefinition } from "../../services/system-builder";

export class ListSystemBuilderComposerAssetsUseCase {
  public constructor(
    private readonly definitions: AssetRegistryDefinitionReadPort,
  ) {}

  public async execute(
    query: ListSystemBuilderComposerAssetsQuery,
  ): Promise<SystemBuilderResult<SystemBuilderComposerCatalog>> {
    const normalized = normalizeQuery(query);
    if (!normalized.ok) return normalized;

    try {
      const parentDefinition = normalized.value.parentDefinitionRef
        ? await this.readComposerParentDefinition(
            normalized.value.parentDefinitionRef,
            normalized.value.workspaceId,
          )
        : undefined;
      if (normalized.value.parentDefinitionRef && !parentDefinition) {
        return systemBuilderFailure(
          "system-builder.composer-parent-not-found",
          "The selected parent asset is unavailable in this workspace.",
          "parentDefinitionRef",
        );
      }
      const slot = parentDefinition
        ? parentDefinition.slots?.find(
            (item) => item.slotId === normalized.value.slotId,
          )
        : undefined;
      if (parentDefinition && !slot) {
        return systemBuilderFailure(
          "system-builder.composer-slot-not-found",
          "The selected parent slot is unavailable.",
          "slotId",
        );
      }

      const cards = await this.definitions.listDefinitionCards({
        workspaceId: normalized.value.workspaceId,
        ...(normalized.value.searchText
          ? { searchText: normalized.value.searchText }
          : {}),
        ...(normalized.value.cursor ? { cursor: normalized.value.cursor } : {}),
        limit: normalized.value.limit,
      });
      const details = await Promise.all(
        cards.items.slice(0, normalized.value.limit).map(async (card) => ({
          card,
          detail: await this.definitions.readDefinitionDetail(
            card.definitionRef,
            {
              workspaceId: normalized.value.workspaceId,
              includeConfigurationSchema: true,
              includePorts: true,
            },
          ),
        })),
      );
      const items = details.flatMap(({ card, detail }) => {
        if (!detail) return [];
        const compatibility = describeCompatibility(
          slot,
          detail.definition,
          normalized.value.parentDefinitionRef,
        );
        if (
          normalized.value.compatibleOnly &&
          compatibility.status !== "compatible"
        ) {
          return [];
        }
        return [
          toComposerAsset(detail.definition, card.builtIn, compatibility),
        ];
      });
      const foundationLayouts =
        normalized.value.parentDefinitionRef &&
        !isCurrentFoundationLayoutReference(
          normalized.value.parentDefinitionRef,
        )
          ? []
          : await this.readCompatibleFoundationLayouts(
              normalized.value,
              slot,
              normalized.value.parentDefinitionRef,
            );
      const mergedItems = new Map<string, SystemBuilderComposerAsset>();
      for (const item of [...foundationLayouts, ...items]) {
        mergedItems.set(`${item.definitionId}@${item.version}`, item);
      }
      return systemBuilderSuccess({
        items: [...mergedItems.values()].slice(0, normalized.value.limit),
        ...(cards.nextCursor ? { nextCursor: cards.nextCursor } : {}),
        ...(cards.diagnostics?.length
          ? {
              diagnostics: cards.diagnostics.map((diagnostic) => ({
                severity: diagnostic.severity,
                code: diagnostic.code,
                message: diagnostic.message,
              })),
            }
          : {}),
      });
    } catch {
      return systemBuilderFailure(
        "system-builder.composer-unavailable",
        "Unable to read compatible assets for this workspace.",
      );
    }
  }

  private async readComposerParentDefinition(
    reference: AssetReference,
    workspaceId: string,
  ): Promise<AssetDefinition | undefined> {
    try {
      const detail = await this.definitions.readDefinitionDetail(reference, {
        workspaceId,
        includeConfigurationSchema: true,
        includePorts: true,
      });
      if (detail) return detail.definition;
    } catch {
      // A trusted older Foundation activation cannot read current layout
      // definitions through its exact-version asset view. The bounded fallback
      // below is available only for exact built-in application layouts.
    }
    if (
      !isCurrentFoundationLayoutReference(reference) ||
      !(await this.hasTrustedFoundationWorkspace(workspaceId))
    ) {
      return undefined;
    }
    return SYSTEM_FOUNDATION_LAYOUT_DEFINITIONS.find(
      (definition) =>
        String(definition.definitionId) === String(reference.id) &&
        definition.version === reference.version,
    );
  }

  private async readCompatibleFoundationLayouts(
    query: ListSystemBuilderComposerAssetsQuery & { readonly limit: number },
    slot: AssetSlotDefinition | undefined,
    parentDefinitionRef: AssetReference | undefined,
  ): Promise<readonly SystemBuilderComposerAsset[]> {
    const search = query.searchText?.trim().toLowerCase();
    const definitions = SYSTEM_FOUNDATION_LAYOUT_DEFINITIONS.filter(
      (definition) =>
        !search ||
        `${definition.definitionId} ${definition.displayName} ${definition.description}`
          .toLowerCase()
          .includes(search),
    );
    if (!definitions.length) return [];

    const hasTrustedFoundation = await this.hasTrustedFoundationWorkspace(
      String(query.workspaceId),
    );
    return hasTrustedFoundation
      ? definitions.flatMap((definition) => {
          const compatibility = describeCompatibility(
            slot,
            definition,
            parentDefinitionRef,
          );
          return query.compatibleOnly && compatibility.status !== "compatible"
            ? []
            : [toComposerAsset(definition, true, compatibility)];
        })
      : [];
  }

  private async hasTrustedFoundationWorkspace(
    workspaceId: string,
  ): Promise<boolean> {
    const rootCards = await this.definitions.listDefinitionCards({
      workspaceId,
      searchText: "builtin.system.system",
      includeBuiltIns: true,
      includeCustom: false,
      limit: 1,
    });
    return rootCards.items.some(
      (card) =>
        card.definitionId === "builtin.system.system" &&
        card.builtIn === true &&
        card.sourcePackId === SYSTEM_FOUNDATION_PACK_ID &&
        card.sourceKind === SYSTEM_FOUNDATION_PACK_SOURCE_KIND &&
        card.sourceLayer === SYSTEM_FOUNDATION_PACK_SOURCE_LAYER &&
        card.trustStatus === SYSTEM_FOUNDATION_PACK_TRUST_STATUS &&
        card.systemDefault === true,
    );
  }
}

function isCurrentFoundationLayoutReference(
  reference: AssetReference,
): boolean {
  return (
    reference.kind === "asset-definition-version" &&
    reference.version === SYSTEM_FOUNDATION_CURRENT_PACK_VERSION &&
    Boolean(readSystemFoundationLayoutPreset(String(reference.id)))
  );
}

function normalizeQuery(query: ListSystemBuilderComposerAssetsQuery):
  | {
      readonly ok: true;
      readonly value: ListSystemBuilderComposerAssetsQuery & {
        readonly limit: number;
      };
    }
  | SystemBuilderResult<never> {
  const workspaceId = String(query.workspaceId).trim();
  const searchText = query.searchText?.trim();
  const cursor = query.cursor?.trim();
  const slotId = query.slotId ? String(query.slotId).trim() : undefined;
  const limit = query.limit ?? SYSTEM_BUILDER_COMPOSER_DEFAULT_LIMIT;
  if (!workspaceId) {
    return systemBuilderFailure(
      "system-builder.composer-workspace-required",
      "Select a workspace before browsing compatible assets.",
      "workspaceId",
    );
  }
  if (searchText && searchText.length > 200) {
    return systemBuilderFailure(
      "system-builder.composer-search-invalid",
      "Asset search text must be 200 characters or fewer.",
      "searchText",
    );
  }
  if (cursor && cursor.length > 512) {
    return systemBuilderFailure(
      "system-builder.composer-cursor-invalid",
      "The asset browse cursor is invalid.",
      "cursor",
    );
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > SYSTEM_BUILDER_COMPOSER_MAX_LIMIT
  ) {
    return systemBuilderFailure(
      "system-builder.composer-limit-invalid",
      `Asset results must be limited to between 1 and ${SYSTEM_BUILDER_COMPOSER_MAX_LIMIT}.`,
      "limit",
    );
  }
  if (Boolean(query.parentDefinitionRef) !== Boolean(slotId)) {
    return systemBuilderFailure(
      "system-builder.composer-target-invalid",
      "Select both a parent asset and one of its slots.",
      query.parentDefinitionRef ? "slotId" : "parentDefinitionRef",
    );
  }
  return {
    ok: true,
    value: {
      workspaceId,
      limit,
      ...(searchText ? { searchText } : {}),
      ...(cursor ? { cursor } : {}),
      ...(query.parentDefinitionRef
        ? { parentDefinitionRef: query.parentDefinitionRef }
        : {}),
      ...(slotId ? { slotId } : {}),
      ...(query.compatibleOnly !== undefined
        ? { compatibleOnly: query.compatibleOnly }
        : {}),
    },
  };
}

function describeCompatibility(
  slot: AssetSlotDefinition | undefined,
  child: AssetDefinition,
  parentDefinitionRef: AssetReference | undefined,
): SystemBuilderComposerCompatibility {
  if (!slot || !parentDefinitionRef) return { status: "not-evaluated" };
  return systemBuilderSlotAcceptsDefinition(slot, child)
    ? {
        status: "compatible",
        parentDefinitionRef,
        slotId: slot.slotId,
      }
    : {
        status: "incompatible",
        reason: "This asset type is not accepted by the selected slot.",
        parentDefinitionRef,
        slotId: slot.slotId,
      };
}

function toComposerAsset(
  definition: AssetDefinition,
  builtIn: boolean | undefined,
  compatibility: SystemBuilderComposerCompatibility,
): SystemBuilderComposerAsset {
  const hasTrustedPreview = Boolean(
    readSystemFoundationBackingResourceProgram(String(definition.definitionId)),
  );
  const layoutPreset = readSystemFoundationLayoutPreset(
    String(definition.definitionId),
  );
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(String(definition.definitionId)),
      version: definition.version,
    },
    definitionId: String(definition.definitionId),
    version: definition.version,
    displayName: definition.displayName,
    description: definition.description,
    assetType: definition.assetType,
    assetFamily: definition.assetFamily,
    lifecycleStatus: definition.lifecycleStatus,
    builtIn: builtIn === true,
    ...(layoutPreset
      ? {
          layoutRole: layoutPreset.kind,
          layoutGeometry: {
            columnPattern: layoutPreset.responsive.regular.columnPattern,
            areas: layoutPreset.responsive.regular.areas,
            sourceOrder: layoutPreset.sourceOrder,
            dimensionsLocked: true as const,
          },
        }
      : {}),
    ...(definition.configurationSchema
      ? { configurationSchema: definition.configurationSchema }
      : {}),
    ...(definition.defaultConfiguration
      ? { defaultConfiguration: definition.defaultConfiguration }
      : {}),
    ports: definition.ports ?? [],
    slots: definition.slots ?? [],
    compatibility,
    implementationAvailability: hasTrustedPreview
      ? "trusted-system-foundation"
      : "definition-only",
    previewAvailability: hasTrustedPreview
      ? "trusted-declarative"
      : "unavailable",
  };
}
