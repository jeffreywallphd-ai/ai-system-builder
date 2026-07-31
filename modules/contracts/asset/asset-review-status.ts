export const ASSET_REVIEW_STATUSES = [
  "unreviewed",
  "reviewed",
  "approved",
  "rejected",
] as const;

export type AssetReviewStatus = (typeof ASSET_REVIEW_STATUSES)[number];

export function isAssetReviewStatus(value: string): value is AssetReviewStatus {
  return ASSET_REVIEW_STATUSES.includes(value as AssetReviewStatus);
}

export function normalizeAssetReviewStatus(value: string): AssetReviewStatus {
  const normalized = value.trim().toLowerCase();

  if (!isAssetReviewStatus(normalized)) {
    throw new Error(
      `Asset review status must be one of ${ASSET_REVIEW_STATUSES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
