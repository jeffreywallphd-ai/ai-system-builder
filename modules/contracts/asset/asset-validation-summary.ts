import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";
import type { AssetValidationIssueSeverity } from "./asset-validation-issue";

export const ASSET_VALIDATION_SUMMARY_STATUSES = [
  "not-validated",
  "valid",
  "valid-with-warnings",
  "invalid",
  "unknown",
] as const;

export type AssetValidationSummaryStatus =
  (typeof ASSET_VALIDATION_SUMMARY_STATUSES)[number];

export interface AssetValidationSummary {
  readonly status?: AssetValidationSummaryStatus;
  readonly issueRefs?: readonly AssetReference[];
  readonly issueCounts?: Partial<Record<AssetValidationIssueSeverity, number>>;
  readonly validatedAt?: string;
  readonly metadata?: AssetMetadata;
}

export function isAssetValidationSummaryStatus(
  value: string,
): value is AssetValidationSummaryStatus {
  return ASSET_VALIDATION_SUMMARY_STATUSES.includes(
    value as AssetValidationSummaryStatus,
  );
}

export function normalizeAssetValidationSummaryStatus(
  value: string,
): AssetValidationSummaryStatus {
  const normalized = value.trim().toLowerCase();

  if (!isAssetValidationSummaryStatus(normalized)) {
    throw new Error(
      `Asset validation summary status must be one of ${ASSET_VALIDATION_SUMMARY_STATUSES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
