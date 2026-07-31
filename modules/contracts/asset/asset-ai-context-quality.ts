import type { AssetConfigurationMetadata } from "./asset-configuration-value";

export const ASSET_AI_CONTEXT_QUALITY_STATUSES = [
  "draft",
  "incomplete",
  "review-ready",
  "approved",
  "needs-revision",
] as const;

export type AssetAiContextQualityStatus =
  (typeof ASSET_AI_CONTEXT_QUALITY_STATUSES)[number];

export interface AssetAiContextQuality {
  readonly qualityStatus?: AssetAiContextQualityStatus;
  readonly lastReviewedAt?: string;
  readonly reviewedBy?: string;
  readonly missingSections?: readonly string[];
  readonly notes?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetAiContextQualityStatus(
  value: string,
): value is AssetAiContextQualityStatus {
  return ASSET_AI_CONTEXT_QUALITY_STATUSES.includes(
    value as AssetAiContextQualityStatus,
  );
}

export function normalizeAssetAiContextQualityStatus(
  value: string,
): AssetAiContextQualityStatus {
  const normalized = value.trim().toLowerCase();

  if (!isAssetAiContextQualityStatus(normalized)) {
    throw new Error(
      `Asset AI-context quality status must be one of ${ASSET_AI_CONTEXT_QUALITY_STATUSES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
