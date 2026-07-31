export const ASSET_PACK_SOURCE_KINDS = [
  "system",
  "workspace",
  "organization",
  "user",
  "imported",
  "community",
  "external",
] as const;

export type AssetPackSourceKind = (typeof ASSET_PACK_SOURCE_KINDS)[number];

export function isAssetPackSourceKind(
  value: string,
): value is AssetPackSourceKind {
  return ASSET_PACK_SOURCE_KINDS.includes(value as AssetPackSourceKind);
}

export function normalizeAssetPackSourceKind(value: string): AssetPackSourceKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetPackSourceKind(normalized)) {
    throw new Error(
      `Asset pack source kind must be one of ${ASSET_PACK_SOURCE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
