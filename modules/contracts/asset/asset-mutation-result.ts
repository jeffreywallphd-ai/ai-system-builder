import type { AssetInstance } from "./asset-instance";
import type { AssetReference } from "./asset-reference";
import type { AssetValidationIssue } from "./asset-validation-issue";
import type { AssetMutationDiagnostic } from "./asset-mutation-diagnostic";
import type { AssetMutationFailure } from "./asset-mutation-failure";
import type { AssetMutationOperation } from "./asset-mutation-operation";
import type { AssetMutationProvenance } from "./asset-mutation-provenance";
import type { AssetSourceIdentity } from "./asset-source-identity";

export const ASSET_MUTATION_RESULT_STATUSES = [
  "created",
  "existing",
  "skipped",
  "pending",
  "partial",
] as const;

export type AssetMutationResultStatus =
  (typeof ASSET_MUTATION_RESULT_STATUSES)[number];

export interface AssetMutationResult {
  readonly ok: boolean;
  readonly operation: AssetMutationOperation;
  readonly status?: AssetMutationResultStatus;
  readonly assetInstanceRef?: AssetReference;
  readonly assetInstance?: AssetInstance;
  readonly sourceIdentity?: AssetSourceIdentity;
  readonly provenance?: AssetMutationProvenance;
  readonly validationIssues?: readonly AssetValidationIssue[];
  readonly diagnostics?: readonly AssetMutationDiagnostic[];
  readonly failure?: AssetMutationFailure;
}

export function createAssetMutationUnavailableResult(
  operation: AssetMutationOperation,
  message = "Asset mutation behavior is not implemented yet.",
): AssetMutationResult {
  return {
    ok: false,
    operation,
    failure: {
      code: "unavailable",
      message,
      operation,
    },
  };
}
