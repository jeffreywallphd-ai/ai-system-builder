import type { AssetMutationActor } from "./asset-mutation-actor";
import type { AssetMutationApproval } from "./asset-mutation-approval";
import type { AssetMutationOperation } from "./asset-mutation-operation";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetProvenance } from "./asset-provenance";
import type { AssetReviewStatus } from "./asset-review-status";
import type { AssetSourceIdentity } from "./asset-source-identity";

export type AssetMutationApprovalSummary = Pick<
  AssetMutationApproval,
  | "userConfirmed"
  | "confirmationKind"
  | "confirmationTextVersion"
  | "allowNetworkAccess"
  | "allowFilesystemWrite"
  | "allowCredentialUse"
  | "allowPartialCompletion"
>;

export interface AssetMutationProvenance {
  readonly sourceIdentity: AssetSourceIdentity;
  readonly operation: AssetMutationOperation;
  readonly actor: AssetMutationActor;
  readonly approvalSummary: AssetMutationApprovalSummary;
  readonly createdProvenance?: AssetProvenance;
  readonly reviewStatus?: AssetReviewStatus;
  /**
   * Optional sanitized summary only. Do not store raw view payloads, paths,
   * secrets, tokens, signed URLs, bytes/base64, prompt text, workflow JSON,
   * stack traces, command lines, environment values, or provider payloads.
   */
  readonly sourceSnapshot?: AssetMetadata;
}
