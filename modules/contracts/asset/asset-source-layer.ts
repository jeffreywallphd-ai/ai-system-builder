export const ASSET_SOURCE_LAYERS = [
  "system-default",
  "installed-pack",
  "workspace-pack",
  "organization-override",
  "user-override",
  "imported-pack",
] as const;

export type AssetSourceLayer = (typeof ASSET_SOURCE_LAYERS)[number];

export function isAssetSourceLayer(value: string): value is AssetSourceLayer {
  return ASSET_SOURCE_LAYERS.includes(value as AssetSourceLayer);
}

export function normalizeAssetSourceLayer(value: string): AssetSourceLayer {
  const normalized = value.trim().toLowerCase();

  if (!isAssetSourceLayer(normalized)) {
    throw new Error(
      `Asset source layer must be one of ${ASSET_SOURCE_LAYERS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
