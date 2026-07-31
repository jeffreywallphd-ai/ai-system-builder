export const ASSET_PACK_ID_FORMAT_DESCRIPTION =
  "a stable, namespaced, non-empty manifest-safe string that is not a path, URL, provider locator, or file name";

export type AssetPackId = string & { readonly __assetPackIdBrand: unique symbol };

const FILE_NAME_EXTENSIONS = /\.(?:json|ya?ml|toml|zip|tgz|tar|gz)$/i;

function invalidAssetPackIdMessage(packId: string): string {
  return `Asset pack id must be ${ASSET_PACK_ID_FORMAT_DESCRIPTION}. Received "${packId}".`;
}

function looksLikeUnsafePathUrlOrFile(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    /^https?:\/\//i.test(value) ||
    /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*(?:\/|$)/i.test(value) ||
    FILE_NAME_EXTENSIONS.test(value)
  );
}

export function isAssetPackId(packId: string): packId is AssetPackId {
  const normalized = packId.trim();

  return (
    normalized.length > 0 &&
    normalized.includes(".") &&
    /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/.test(normalized) &&
    !looksLikeUnsafePathUrlOrFile(normalized)
  );
}

export function normalizeAssetPackId(packId: string): AssetPackId {
  const normalized = packId.trim();

  if (!isAssetPackId(normalized)) {
    throw new Error(invalidAssetPackIdMessage(packId));
  }

  return normalized as AssetPackId;
}
