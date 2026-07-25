import type {
  AssetDefinition,
  AssetReference,
  AssetSlotDefinition,
} from "../../../contracts/asset";
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
import {
  CURRENT_COMPOSER_FOUNDATION_DEFINITIONS,
  CURRENT_COMPOSER_FOUNDATION_DEFINITION_IDS,
  CURRENT_COMPOSER_FOUNDATION_VERSION,
  hasTrustedComposerFoundationWorkspace,
  isCurrentComposerFoundationReference,
  readExactComposerDefinition,
  toSystemBuilderComposerAsset,
} from "./system-builder-composer-projection";
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

      const projectCurrentFoundation =
        !normalized.value.parentDefinitionRef ||
        isCurrentComposerFoundationReference(
          normalized.value.parentDefinitionRef,
        );
      const hasTrustedFoundation = projectCurrentFoundation
        ? await hasTrustedComposerFoundationWorkspace(
            this.definitions,
            String(normalized.value.workspaceId),
          )
        : false;

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
              includePorts: true,
            },
          ),
        })),
      );
      const items = details.flatMap(({ card, detail }) => {
        if (!detail) return [];
        if (
          hasTrustedFoundation &&
          card.builtIn &&
          detail.definition.version !== CURRENT_COMPOSER_FOUNDATION_VERSION &&
          CURRENT_COMPOSER_FOUNDATION_DEFINITION_IDS.has(
            String(detail.definition.definitionId),
          )
        ) {
          return [];
        }
        const compatibility = describeCompatibility(
          slot,
          detail.definition,
          normalized.value.parentDefinitionRef,
          parentDefinition,
        );
        if (
          normalized.value.compatibleOnly &&
          compatibility.status !== "compatible"
        ) {
          return [];
        }
        return [
          toSystemBuilderComposerAsset(
            detail.definition,
            card.builtIn,
            compatibility,
          ),
        ];
      });
      const currentFoundation = hasTrustedFoundation
        ? this.readCompatibleCurrentFoundationDefinitions(
            normalized.value,
            slot,
            normalized.value.parentDefinitionRef,
            parentDefinition,
          )
        : [];
      const mergedItems = new Map<string, SystemBuilderComposerAsset>();
      // Exact current trusted Foundation definitions are the canonical
      // Composer-only projection. Let them replace older/partial persisted
      // cards so nested geometry and named slots cannot drift.
      for (const item of [...items, ...currentFoundation]) {
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
    return (
      await readExactComposerDefinition(
        this.definitions,
        workspaceId,
        reference,
        false,
      )
    )?.definition;
  }

  private readCompatibleCurrentFoundationDefinitions(
    query: ListSystemBuilderComposerAssetsQuery & { readonly limit: number },
    slot: AssetSlotDefinition | undefined,
    parentDefinitionRef: AssetReference | undefined,
    parentDefinition: AssetDefinition | undefined,
  ): readonly SystemBuilderComposerAsset[] {
    const search = query.searchText?.trim().toLowerCase();
    const definitions = CURRENT_COMPOSER_FOUNDATION_DEFINITIONS.filter(
      (definition) =>
        !search ||
        `${definition.definitionId} ${definition.displayName} ${definition.description}`
          .toLowerCase()
          .includes(search),
    );
    if (!definitions.length) return [];
    return definitions.flatMap((definition) => {
      const compatibility = describeCompatibility(
        slot,
        definition,
        parentDefinitionRef,
        parentDefinition,
      );
      return query.compatibleOnly && compatibility.status !== "compatible"
        ? []
        : [toSystemBuilderComposerAsset(definition, true, compatibility)];
    });
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
  parentDefinition: AssetDefinition | undefined,
): SystemBuilderComposerCompatibility {
  if (!slot || !parentDefinitionRef) return { status: "not-evaluated" };
  return systemBuilderSlotAcceptsDefinition(slot, child, parentDefinition)
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
