export const ASSET_FAMILIES = [
  "structural",
  "behavioral",
  "resource-backed",
  "context",
  "composition",
] as const;

export type AssetFamily = (typeof ASSET_FAMILIES)[number];

export function isAssetFamily(value: string): value is AssetFamily {
  return ASSET_FAMILIES.includes(value as AssetFamily);
}

export function normalizeAssetFamily(value: string): AssetFamily {
  const normalized = value.trim().toLowerCase();

  if (!isAssetFamily(normalized)) {
    throw new Error(
      `Asset family must be one of ${ASSET_FAMILIES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
