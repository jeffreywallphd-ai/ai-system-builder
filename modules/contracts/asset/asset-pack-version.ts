export type AssetPackVersion = string;

const SEMVER_LIKE_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function isAssetPackVersion(value: string): value is AssetPackVersion {
  return SEMVER_LIKE_PATTERN.test(value.trim());
}

export function normalizeAssetPackVersion(value: string): AssetPackVersion {
  const normalized = value.trim();

  if (!isAssetPackVersion(normalized)) {
    throw new Error(
      `Asset pack version must be semver-like. Received "${value}".`,
    );
  }

  return normalized;
}
