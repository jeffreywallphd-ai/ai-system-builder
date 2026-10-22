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

      const binding = JSON.stringify({ ...normalized.value, cursor: undefined });
      const continuation = normalized.value.cursor ? JSON.parse(normalized.value.cursor) : { v: 1, b: binding, f: 0, r: null, d: false };
      if (!continuation || continuation.v !== 1 || continuation.b !== binding || !Number.isSafeInteger(continuation.f) || continuation.f < 0 || typeof continuation.d !== "boolean" || (continuation.r !== null && (typeof continuation.r !== "string" || continuation.r.length > 8192))) {
        return systemBuilderFailure("system-builder.composer-cursor-invalid", "The asset browse cursor is invalid.", "cursor");
      }
      const foundation = hasTrustedFoundation
        ? this.readCompatibleCurrentFoundationDefinitions(normalized.value, slot, normalized.value.parentDefinitionRef, parentDefinition)
        : [];
      if (continuation.f > foundation.length) return systemBuilderFailure("system-builder.composer-cursor-invalid", "The asset browse cursor is invalid.", "cursor");
      const items = [...foundation.slice(continuation.f, continuation.f + normalized.value.limit)];
      continuation.f += items.length;
      const seenCursors = new Set<string>();
      const seenItems = new Set(items.map(item => `${item.definitionId}@${item.version}`));
      const diagnostics: {severity: "info" | "warning" | "error"; code: string; message: string}[] = [];
      // Slot alternatives are OR predicates. A registry query combines filters
      // with AND, so push down only a sole necessary branch. Trusted Foundation
      // bridges are already projected above; otherwise keep their full scan.
      const canFilterSlot = normalized.value.compatibleOnly && slot &&
        (!projectCurrentFoundation || hasTrustedFoundation) &&
        !slot.acceptedDefinitionRefs?.length;
      const necessarySlotFilter = canFilterSlot && slot.acceptedAssetTypes?.length && !slot.acceptedAssetFamilies?.length
        ? {assetTypes: slot.acceptedAssetTypes}
        : canFilterSlot && slot.acceptedAssetFamilies?.length && !slot.acceptedAssetTypes?.length
          ? {assetFamilies: slot.acceptedAssetFamilies}
          : {};
      // Never fetch more raw candidates than remaining output capacity: there
      // is then no compatible result to discard when the page fills.
      for (let scan = 0; items.length < normalized.value.limit && !continuation.d && scan < 100; scan++) {
        const cursorKey = continuation.r ?? "";
        if (seenCursors.has(cursorKey)) throw new Error("Repeated source continuation.");
        seenCursors.add(cursorKey);
        const remaining = normalized.value.limit - items.length;
        const cards = await this.definitions.listDefinitionCards({
          workspaceId: normalized.value.workspaceId,
          // These are necessary slot predicates, never a replacement for the
          // authoritative detail compatibility check below. Filtering before
          // paging avoids repeatedly materializing unrelated sparse candidates.
          ...necessarySlotFilter,
          ...(normalized.value.searchText ? { searchText: normalized.value.searchText } : {}),
          ...(continuation.r ? { cursor: continuation.r } : {}), limit: remaining,
        });
        if (cards.items.length > remaining) throw new Error("Unbounded candidate page.");
        const refs = cards.items.map(card => card.definitionRef);
        const options = { workspaceId: normalized.value.workspaceId, includePorts: true };
        const details = this.definitions.readDefinitionDetails
          ? await this.definitions.readDefinitionDetails(refs, options)
          : await Promise.all(refs.map(ref => this.definitions.readDefinitionDetail(ref, options)));
        for (let index = 0; index < cards.items.length; index++) {
          const card = cards.items[index]!; const detail = details[index];
          if (!detail) continue;
          if (hasTrustedFoundation && CURRENT_COMPOSER_FOUNDATION_DEFINITION_IDS.has(String(detail.definition.definitionId)) &&
              (card.builtIn || detail.definition.version === CURRENT_COMPOSER_FOUNDATION_VERSION)) continue;
          const compatibility = describeCompatibility(slot, detail.definition, normalized.value.parentDefinitionRef, parentDefinition);
          if (normalized.value.compatibleOnly && compatibility.status !== "compatible") continue;
          const item = toSystemBuilderComposerAsset(detail.definition, card.builtIn, compatibility);
          const key = `${item.definitionId}@${item.version}`;
          if (!seenItems.has(key)) { seenItems.add(key); items.push(item); }
        }
        diagnostics.push(...(cards.diagnostics ?? []).map(({severity,code,message}) => ({severity,code,message})));
        continuation.r = cards.nextCursor ?? null;
        continuation.d = !cards.nextCursor;
        if (!continuation.d && seenCursors.has(continuation.r)) throw new Error("Repeated source continuation.");
      }
      return systemBuilderSuccess({ items,
        ...((continuation.f < foundation.length || !continuation.d) ? {nextCursor: JSON.stringify(continuation)} : {}),
        ...(diagnostics.length ? {diagnostics} : {}),
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
  if (!query || typeof query !== "object" || typeof query.workspaceId !== "string") return systemBuilderFailure("system-builder.composer-workspace-required", "Select a workspace before browsing compatible assets.", "workspaceId");
  const workspaceId = query.workspaceId.trim();
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
  if (cursor && cursor.length > 16384) {
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
