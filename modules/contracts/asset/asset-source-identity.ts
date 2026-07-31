import type { AssetResourceBackedViewKind } from "./asset-resource-backed-view";
import type { AssetResourceBacking } from "./asset-resource-backing";
import type { AssetResourceKind } from "./asset-resource-kind";
import type { AssetType } from "./asset-type";

export const ASSET_SOURCE_IDENTITY_KINDS = [
  "resource-backed-view",
  "artifact",
  "image-asset",
  "generated-output",
  "dataset",
  "model",
  "external-repository-object",
  "artifact-repository-object",
  "preview",
  "unknown",
] as const;

export type AssetSourceIdentityKind =
  (typeof ASSET_SOURCE_IDENTITY_KINDS)[number];

export const ASSET_SOURCE_SYSTEMS = [
  "asset-resource-backed-view",
  "artifact",
  "image-asset",
  "generated-output",
  "dataset",
  "model",
  "external-repository-object",
  "artifact-repository",
  "image-generation",
  "unknown",
] as const;

export type AssetSourceSystem = (typeof ASSET_SOURCE_SYSTEMS)[number];

export interface AssetSourceIdentity {
  readonly sourceKind: AssetSourceIdentityKind;
  readonly sourceViewId?: string;
  readonly sourceViewKind?: AssetResourceBackedViewKind;
  readonly sourceAssetType?: AssetType;
  readonly sourceResourceKind?: AssetResourceKind;
  readonly sourceSystem: AssetSourceSystem;
  /**
   * Safe source identifier or stable safe fingerprint. Do not store path-like
   * ids, tokens, signed URLs, provider-native payloads, bytes, or prompt text.
   */
  readonly sourceId: string;
  readonly sourceVersion?: string;
  readonly sourceFingerprint?: string;
  readonly backingRefs?: readonly AssetResourceBacking[];
  /**
   * Deterministic non-secret key used by later mutation use cases to detect
   * duplicate registrations/imports and to make retries idempotent.
   */
  readonly deduplicationKey: string;
}

export function isAssetSourceSystem(value: string): value is AssetSourceSystem {
  return ASSET_SOURCE_SYSTEMS.includes(value as AssetSourceSystem);
}

export function isAssetSourceIdentityKind(
  value: string,
): value is AssetSourceIdentityKind {
  return ASSET_SOURCE_IDENTITY_KINDS.includes(value as AssetSourceIdentityKind);
}
