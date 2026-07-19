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
      const parent = normalized.value.parentDefinitionRef
        ? await this.definitions.readDefinitionDetail(
            normalized.value.parentDefinitionRef,
            {
              workspaceId: normalized.value.workspaceId,
              includeConfigurationSchema: true,
              includePorts: true,
            },
          )
        : undefined;
      if (normalized.value.parentDefinitionRef && !parent) {
        return systemBuilderFailure(
          "system-builder.composer-parent-not-found",
          "The selected parent asset is unavailable in this workspace.",
          "parentDefinitionRef",
        );
      }
      const slot = parent
        ? parent.definition.slots?.find(
            (item) => item.slotId === normalized.value.slotId,
          )
        : undefined;
      if (parent && !slot) {
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
      return systemBuilderSuccess({
        items,
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
    ...(String(definition.definitionId).startsWith(
      "builtin.layout.application.",
    )
      ? { layoutRole: "application-shell" as const }
      : String(definition.definitionId).startsWith("builtin.layout.page.")
        ? { layoutRole: "page-layout" as const }
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
