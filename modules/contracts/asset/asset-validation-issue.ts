import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";

export const ASSET_VALIDATION_ISSUE_SEVERITIES = [
  "info",
  "warning",
  "error",
] as const;

export const ASSET_VALIDATION_ISSUE_CATEGORIES = [
  "identity",
  "lifecycle",
  "configuration",
  "ai-context",
  "binding",
  "composition",
  "requirement",
  "provenance",
  "security",
  "resource",
  "unknown",
] as const;

export type AssetValidationIssueSeverity =
  (typeof ASSET_VALIDATION_ISSUE_SEVERITIES)[number];

export type AssetValidationIssueCategory =
  (typeof ASSET_VALIDATION_ISSUE_CATEGORIES)[number];

export interface AssetValidationIssue {
  readonly issueId?: string;
  readonly severity: AssetValidationIssueSeverity;
  readonly category: AssetValidationIssueCategory;
  readonly message: string;
  readonly assetRef?: AssetReference;
  readonly path?: readonly string[];
  readonly details?: AssetMetadata;
  readonly createdAt?: string;
}


export function isAssetValidationIssueSeverity(
  value: string,
): value is AssetValidationIssueSeverity {
  return ASSET_VALIDATION_ISSUE_SEVERITIES.includes(
    value as AssetValidationIssueSeverity,
  );
}

export function normalizeAssetValidationIssueSeverity(
  value: string,
): AssetValidationIssueSeverity {
  const normalized = value.trim().toLowerCase();

  if (!isAssetValidationIssueSeverity(normalized)) {
    throw new Error(
      `Asset validation issue severity must be one of ${ASSET_VALIDATION_ISSUE_SEVERITIES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function isAssetValidationIssueCategory(
  value: string,
): value is AssetValidationIssueCategory {
  return ASSET_VALIDATION_ISSUE_CATEGORIES.includes(
    value as AssetValidationIssueCategory,
  );
}

export function normalizeAssetValidationIssueCategory(
  value: string,
): AssetValidationIssueCategory {
  const normalized = value.trim().toLowerCase();

  if (!isAssetValidationIssueCategory(normalized)) {
    throw new Error(
      `Asset validation issue category must be one of ${ASSET_VALIDATION_ISSUE_CATEGORIES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
