import type { AssetMetadata } from "./asset-metadata";

export const ASSET_PACK_LICENSE_KINDS = [
  "internal",
  "proprietary",
  "permissive",
  "copyleft",
  "public-domain",
  "unknown",
] as const;

export type AssetPackLicenseKind =
  (typeof ASSET_PACK_LICENSE_KINDS)[number];

export interface AssetPackLicense {
  readonly kind: AssetPackLicenseKind;
  readonly name?: string;
  readonly url?: string;
  readonly metadata?: AssetMetadata;
}

export function isAssetPackLicenseKind(
  value: string,
): value is AssetPackLicenseKind {
  return ASSET_PACK_LICENSE_KINDS.includes(value as AssetPackLicenseKind);
}

export function normalizeAssetPackLicenseKind(
  value: string,
): AssetPackLicenseKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetPackLicenseKind(normalized)) {
    throw new Error(
      `Asset pack license kind must be one of ${ASSET_PACK_LICENSE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
