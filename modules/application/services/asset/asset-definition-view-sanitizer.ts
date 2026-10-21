import type { AssetAuthoringEffectiveSourceSummary } from "../../../contracts/asset-authoring";
import type { AssetDefinitionCard, AssetDefinitionDetail, AssetRegistryListResult } from "./asset-registry-read-facade.types";
import { sanitizeAssetJsonValue, sanitizeAssetViewValue } from "./asset-safe-metadata";

// This is a contract projection, not an exception to the metadata key filter.
const SOURCE_FIELDS = ["targetWorkspaceId", "effectiveSourceKind", "authoredAssetId", "draftId", "revisionId", "revisionLabel", "overrideId", "assetReference", "effectiveAssetReference", "baseAssetReference", "baseRevision", "currentRevision", "customizationTargetKind", "overrideStatus", "conflictStatus", "provenanceKind", "diagnostics"] as const satisfies readonly (keyof AssetAuthoringEffectiveSourceSummary)[];

export function sanitizeAssetDefinitionView<T extends AssetDefinitionCard | AssetDefinitionDetail>(value: T): T {
  const safe = sanitizeAssetViewValue(value);
  const source = value.assetAuthoringEffectiveSourceSummary;
  if (!source || typeof source !== "object") return safe;
  const projected = Object.fromEntries(SOURCE_FIELDS.flatMap(key => {
    const entry = sanitizeAssetJsonValue(source[key]);
    return entry === undefined ? [] : [[key, entry]];
  }));
  return { ...safe, assetAuthoringEffectiveSourceSummary: projected };
}

export function sanitizeAssetDefinitionList(value: AssetRegistryListResult<AssetDefinitionCard>): AssetRegistryListResult<AssetDefinitionCard> {
  return { ...sanitizeAssetViewValue(value), items: value.items.map(sanitizeAssetDefinitionView) };
}
