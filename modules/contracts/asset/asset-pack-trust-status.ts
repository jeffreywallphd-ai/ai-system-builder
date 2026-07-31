export const ASSET_PACK_TRUST_STATUSES = [
  "system-trusted",
  "trusted",
  "unverified",
  "restricted",
  "blocked",
] as const;

export type AssetPackTrustStatus =
  (typeof ASSET_PACK_TRUST_STATUSES)[number];

export function isAssetPackTrustStatus(
  value: string,
): value is AssetPackTrustStatus {
  return ASSET_PACK_TRUST_STATUSES.includes(value as AssetPackTrustStatus);
}

export function normalizeAssetPackTrustStatus(
  value: string,
): AssetPackTrustStatus {
  const normalized = value.trim().toLowerCase();

  if (!isAssetPackTrustStatus(normalized)) {
    throw new Error(
      `Asset pack trust status must be one of ${ASSET_PACK_TRUST_STATUSES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
