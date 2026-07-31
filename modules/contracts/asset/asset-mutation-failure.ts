import type { AssetValidationIssue } from "./asset-validation-issue";
import type { AssetMutationDiagnostic } from "./asset-mutation-diagnostic";
import type { AssetMutationOperation } from "./asset-mutation-operation";
import type { AssetMetadata } from "./asset-metadata";

export const ASSET_MUTATION_FAILURE_CODES = [
  "validation",
  "approval-required",
  "permission",
  "not-found",
  "conflict",
  "unavailable",
  "partial-failure",
  "internal",
] as const;

export type AssetMutationFailureCode =
  (typeof ASSET_MUTATION_FAILURE_CODES)[number];

export interface AssetMutationFailure {
  readonly code: AssetMutationFailureCode;
  readonly message: string;
  readonly operation: AssetMutationOperation;
  readonly validationIssues?: readonly AssetValidationIssue[];
  readonly diagnostics?: readonly AssetMutationDiagnostic[];
  readonly safeDetails?: AssetMetadata;
}

export function isAssetMutationFailureCode(
  value: string,
): value is AssetMutationFailureCode {
  return ASSET_MUTATION_FAILURE_CODES.includes(
    value as AssetMutationFailureCode,
  );
}
