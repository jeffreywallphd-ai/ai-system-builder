import type { AssetMetadata } from "./asset-metadata";
import type { AssetId } from "./asset-id";
import type { AssetVersion } from "./asset-version";

export const ASSET_REFERENCE_KINDS = [
  "asset-definition",
  "asset-definition-version",
  "asset-instance",
  "asset-composition",
  "asset-binding",
  "asset-placement",
  "asset-requirement",
  "resource-backed-asset",
  "asset-resource-backing",
  "artifact",
  "resource",
  "external-repository-object",
] as const;

export type AssetReferenceKind = (typeof ASSET_REFERENCE_KINDS)[number];

export interface AssetReference {
  readonly kind: AssetReferenceKind;
  readonly id: AssetId;
  readonly version?: AssetVersion;
  readonly label?: string;
  readonly metadata?: AssetMetadata;
}

export function isAssetReferenceKind(value: string): value is AssetReferenceKind {
  return ASSET_REFERENCE_KINDS.includes(value as AssetReferenceKind);
}

export function normalizeAssetReferenceKind(value: string): AssetReferenceKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetReferenceKind(normalized)) {
    throw new Error(
      `Asset reference kind must be one of ${ASSET_REFERENCE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
