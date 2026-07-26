import type { AssetDefinition, AssetReference } from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import type {
  SystemBuilderComposerAsset,
  SystemBuilderComposerAssetDetail,
  SystemBuilderComposerCompatibility,
} from "../../../contracts/system-builder";
import type { AssetRegistryDefinitionReadPort } from "../../ports/asset";
import { readSystemFoundationBackingResourceProgram } from "../../services/asset-packs/system-foundation-backing-resource-catalog";
import { readSystemFoundationLayoutPreset } from "../../services/asset-packs/system-packs/system-foundation-layout-presets";
import {
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
} from "../../services/asset-packs/system-packs/system-foundation-pack.constants";
import { SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST } from "../../services/asset-packs/system-packs/system-foundation-pack-v3.manifest";

export const CURRENT_COMPOSER_FOUNDATION_VERSION =
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION;

export const CURRENT_COMPOSER_FOUNDATION_DEFINITIONS =
  SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST.assets.map(
    (entry) => entry.definition,
  );

export const CURRENT_COMPOSER_FOUNDATION_DEFINITION_IDS = new Set(
  CURRENT_COMPOSER_FOUNDATION_DEFINITIONS.map((definition) =>
    String(definition.definitionId),
  ),
);

export function isCurrentComposerFoundationReference(
  reference: AssetReference,
): boolean {
  return (
    reference.kind === "asset-definition-version" &&
    reference.version === SYSTEM_FOUNDATION_CURRENT_PACK_VERSION &&
    CURRENT_COMPOSER_FOUNDATION_DEFINITION_IDS.has(String(reference.id))
  );
}

export async function hasTrustedComposerFoundationWorkspace(
  definitions: AssetRegistryDefinitionReadPort,
  workspaceId: string,
): Promise<boolean> {
  const rootCards = await definitions.listDefinitionCards({
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

export async function readExactComposerDefinition(
  definitions: AssetRegistryDefinitionReadPort,
  workspaceId: string,
  reference: AssetReference,
  includePropertyDetail: boolean,
): Promise<
  | {
      readonly definition: AssetDefinition;
      readonly builtIn: boolean;
    }
  | undefined
> {
  if (
    isCurrentComposerFoundationReference(reference) &&
    (await hasTrustedComposerFoundationWorkspace(definitions, workspaceId))
  ) {
    const definition = CURRENT_COMPOSER_FOUNDATION_DEFINITIONS.find(
      (candidate) =>
        String(candidate.definitionId) === String(reference.id) &&
        candidate.version === reference.version,
    );
    return definition ? { definition, builtIn: true } : undefined;
  }
  const detail = await definitions.readDefinitionDetail(reference, {
    workspaceId,
    ...(includePropertyDetail ? { includeConfigurationSchema: true } : {}),
    includePorts: true,
  });
  return detail
    ? { definition: detail.definition, builtIn: detail.builtIn === true }
    : undefined;
}

export function toSystemBuilderComposerAsset(
  definition: AssetDefinition,
  builtIn: boolean | undefined,
  compatibility: SystemBuilderComposerCompatibility,
): SystemBuilderComposerAsset {
  const categoryId = definition.metadata?.categoryId;
  const hasTrustedPreview = Boolean(
    readSystemFoundationBackingResourceProgram(
      String(definition.definitionId),
      definition.version,
    ),
  );
  const layoutPreset = readSystemFoundationLayoutPreset(
    String(definition.definitionId),
    definition.version,
  );
  const layoutGeometry = layoutPreset
    ? {
        columnPattern: layoutPreset.responsive.regular.columnPattern,
        areas: layoutPreset.responsive.regular.areas,
        sourceOrder: layoutPreset.sourceOrder,
        dimensionsLocked: true as const,
      }
    : abstractContainerGeometry(definition);
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
    ...(typeof categoryId === "string" && categoryId.trim()
      ? { categoryId: categoryId.trim() }
      : {}),
    lifecycleStatus: definition.lifecycleStatus,
    builtIn: builtIn === true,
    ...(layoutPreset ? { layoutRole: layoutPreset.kind } : {}),
    ...(layoutGeometry ? { layoutGeometry } : {}),
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

export function toSystemBuilderComposerAssetDetail(
  definition: AssetDefinition,
  builtIn: boolean | undefined,
): SystemBuilderComposerAssetDetail {
  return {
    ...toSystemBuilderComposerAsset(definition, builtIn, {
      status: "not-evaluated",
    }),
    ...(definition.configurationSchema
      ? { configurationSchema: definition.configurationSchema }
      : {}),
    ...(definition.defaultConfiguration
      ? { defaultConfiguration: definition.defaultConfiguration }
      : {}),
  };
}

function abstractContainerGeometry(
  definition: AssetDefinition,
): SystemBuilderComposerAsset["layoutGeometry"] | undefined {
  const sourceOrder = (definition.slots ?? []).map((slot) =>
    String(slot.slotId),
  );
  if (!sourceOrder.length) return undefined;
  return {
    columnPattern: "single",
    areas: sourceOrder.map((slotId) => [slotId]),
    sourceOrder,
    dimensionsLocked: true,
  };
}
