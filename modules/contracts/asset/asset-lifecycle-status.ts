export const ASSET_LIFECYCLE_STATUSES = [
  "draft",
  "validated",
  "published",
  "deprecated",
  "archived",
  "failed-validation",
] as const;

export type AssetLifecycleStatus = (typeof ASSET_LIFECYCLE_STATUSES)[number];

export function isAssetLifecycleStatus(value: string): value is AssetLifecycleStatus {
  return ASSET_LIFECYCLE_STATUSES.includes(value as AssetLifecycleStatus);
}

export function normalizeAssetLifecycleStatus(value: string): AssetLifecycleStatus {
  const normalized = value.trim().toLowerCase();

  if (!isAssetLifecycleStatus(normalized)) {
    throw new Error(
      `Asset lifecycle status must be one of ${ASSET_LIFECYCLE_STATUSES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
