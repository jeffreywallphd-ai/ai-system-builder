import type { AssetMetadata } from "./asset-metadata";
import type { AssetProvenance } from "./asset-provenance";
import type { AssetReference } from "./asset-reference";
import type { AssetExternalRepositoryObjectReference } from "./asset-external-repository-object";
import type { AssetGeneratedOutputReference } from "./asset-generated-output-reference";
import type { AssetResourceKind } from "./asset-resource-kind";
import type { AssetResourcePreviewReference } from "./asset-resource-preview";

export const ASSET_RESOURCE_BACKING_ROLES = [
  "primary",
  "source",
  "derived",
  "preview",
  "thumbnail",
  "materialization",
  "checkpoint",
  "adapter",
  "metadata",
  "custom",
] as const;

export type AssetResourceBackingRole =
  (typeof ASSET_RESOURCE_BACKING_ROLES)[number];

export type AssetResourceReference =
  | AssetReference
  | AssetExternalRepositoryObjectReference
  | AssetGeneratedOutputReference
  | AssetResourcePreviewReference;

export interface AssetResourceBacking {
  readonly backingId: string;
  readonly resourceKind: AssetResourceKind;
  readonly ref: AssetResourceReference;
  readonly role?: AssetResourceBackingRole;
  readonly displayName?: string;
  readonly description?: string;
  readonly contentType?: string;
  readonly format?: string;
  readonly sizeBytes?: number;
  readonly checksum?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly provenance?: AssetProvenance;
  readonly metadata?: AssetMetadata;
}

export function isAssetResourceBackingRole(
  value: string,
): value is AssetResourceBackingRole {
  return ASSET_RESOURCE_BACKING_ROLES.includes(value as AssetResourceBackingRole);
}

export function normalizeAssetResourceBackingRole(
  value: string,
): AssetResourceBackingRole {
  const normalized = value.trim().toLowerCase();

  if (!isAssetResourceBackingRole(normalized)) {
    throw new Error(
      `Asset resource backing role must be one of ${ASSET_RESOURCE_BACKING_ROLES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
