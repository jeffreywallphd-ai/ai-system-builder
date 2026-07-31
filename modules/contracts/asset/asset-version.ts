export type AssetVersion = string;

export function isAssetVersion(value: string): value is AssetVersion {
  return value.trim().length > 0;
}

export function normalizeAssetVersion(value: string): AssetVersion {
  const normalized = value.trim();

  if (!isAssetVersion(normalized)) {
    throw new Error(`Asset version must be a non-empty string. Received "${value}".`);
  }

  return normalized;
}
