export const ASSET_ID_FORMAT_DESCRIPTION =
  "a non-empty, trimmed, transport-neutral string that is not a filesystem path or provider-native locator";

export type AssetId = string & { readonly __assetIdBrand: unique symbol };

function invalidAssetIdMessage(assetId: string): string {
  return `Asset id must be ${ASSET_ID_FORMAT_DESCRIPTION}. Received "${assetId}".`;
}

function looksLikeUnsafePathOrLocator(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    /^https?:\/\//i.test(value) ||
    /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*(?:\/|$)/i.test(value)
  );
}

export function isAssetId(assetId: string): assetId is AssetId {
  return assetId.trim().length > 0 && !looksLikeUnsafePathOrLocator(assetId.trim());
}

export function normalizeAssetId(assetId: string): AssetId {
  const normalizedAssetId = assetId.trim();

  if (!isAssetId(normalizedAssetId)) {
    throw new Error(invalidAssetIdMessage(assetId));
  }

  return normalizedAssetId as AssetId;
}
