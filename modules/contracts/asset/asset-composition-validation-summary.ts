import {
  ASSET_VALIDATION_SUMMARY_STATUSES,
  isAssetValidationSummaryStatus,
  normalizeAssetValidationSummaryStatus,
  type AssetValidationSummaryStatus,
} from "./asset-validation-summary";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";

export const ASSET_COMPOSITION_VALIDATION_STATUSES =
  ASSET_VALIDATION_SUMMARY_STATUSES;

export type AssetCompositionValidationStatus = AssetValidationSummaryStatus;

export interface AssetCompositionValidationSummary {
  readonly status: AssetCompositionValidationStatus;
  readonly issueRefs?: readonly AssetReference[];
  readonly issueCount?: number;
  readonly lastValidatedAt?: string;
  readonly metadata?: AssetMetadata;
}

export function isAssetCompositionValidationStatus(
  value: string,
): value is AssetCompositionValidationStatus {
  return isAssetValidationSummaryStatus(value);
}

export function normalizeAssetCompositionValidationStatus(
  value: string,
): AssetCompositionValidationStatus {
  return normalizeAssetValidationSummaryStatus(value);
}
