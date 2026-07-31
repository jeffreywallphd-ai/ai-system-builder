import type { AssetMetadata } from "./asset-metadata";
import type { AssetPackId } from "./asset-pack-id";
import type { AssetPackVersion } from "./asset-pack-version";
import type { AssetReference } from "./asset-reference";
import type { AssetSourceLayer } from "./asset-source-layer";

export const ASSET_PACK_OVERRIDE_SCOPES = [
  "workspace",
  "organization",
  "user",
  "system",
] as const;

export type AssetPackOverrideScope =
  (typeof ASSET_PACK_OVERRIDE_SCOPES)[number];

export const ASSET_PACK_OVERRIDE_CONFLICT_POLICIES = [
  "prefer-replacement",
  "prefer-existing",
  "report-conflict",
  "disabled",
] as const;

export type AssetPackOverrideConflictPolicy =
  (typeof ASSET_PACK_OVERRIDE_CONFLICT_POLICIES)[number];

export interface AssetPackReference {
  readonly packId: AssetPackId;
  readonly version?: AssetPackVersion;
}

export interface AssetPackOverrideRule {
  readonly ruleId: string;
  readonly targetRef: AssetReference;
  readonly replacementRef: AssetReference;
  readonly scope: AssetPackOverrideScope;
  readonly sourceLayer: AssetSourceLayer;
  readonly priority: number;
  readonly enabled: boolean;
  readonly conflictPolicy: AssetPackOverrideConflictPolicy;
  readonly reason?: string;
  readonly createdByPackRef?: AssetPackReference;
  readonly metadata?: AssetMetadata;
}

export function isAssetPackOverrideScope(
  value: string,
): value is AssetPackOverrideScope {
  return ASSET_PACK_OVERRIDE_SCOPES.includes(value as AssetPackOverrideScope);
}

export function normalizeAssetPackOverrideScope(
  value: string,
): AssetPackOverrideScope {
  const normalized = value.trim().toLowerCase();

  if (!isAssetPackOverrideScope(normalized)) {
    throw new Error(
      `Asset pack override scope must be one of ${ASSET_PACK_OVERRIDE_SCOPES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function isAssetPackOverrideConflictPolicy(
  value: string,
): value is AssetPackOverrideConflictPolicy {
  return ASSET_PACK_OVERRIDE_CONFLICT_POLICIES.includes(
    value as AssetPackOverrideConflictPolicy,
  );
}

export function normalizeAssetPackOverrideConflictPolicy(
  value: string,
): AssetPackOverrideConflictPolicy {
  const normalized = value.trim().toLowerCase();

  if (!isAssetPackOverrideConflictPolicy(normalized)) {
    throw new Error(
      `Asset pack override conflict policy must be one of ${ASSET_PACK_OVERRIDE_CONFLICT_POLICIES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
