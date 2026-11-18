import type { DatasetVersionRecord } from "../../../contracts/dataset";
import type { DatasetQualityReport } from "../../../contracts/runtime";

/** Internal application admission, never accepted from a transport request.
 * The adapter commits the immutable version and its causal approval receipt
 * together. Artifact IO belongs before this metadata-only transaction.
 */
export interface DatasetVersionCommitAdmission {
  readonly workspaceId: DatasetVersionRecord["workspaceId"];
  readonly organizationId: DatasetVersionRecord["organizationId"];
  readonly principalId: string;
  commit(version: DatasetVersionRecord): Promise<{
    readonly version: DatasetVersionRecord;
    readonly created: boolean;
  }>;
}

/** Minimized application metadata; never a materializing read or approval. */
export interface PreparedLocalDatasetReview {
  readonly taskId: string;
  readonly reportFingerprint: string;
  readonly policyFingerprint: `sha256:${string}`;
  readonly status: DatasetQualityReport["status"];
  readonly counts: DatasetQualityReport["counts"];
  readonly reasonCounts: DatasetQualityReport["reasonCounts"];
  readonly splits: {readonly trainRows: number; readonly validationRows: number; readonly testRows: number};
  readonly approvalAllowed: boolean;
  readonly saveAvailable: boolean;
}

/** Private compilation metadata. The original accepted digest binds sources,
 * recipe, split and processing policy; it is never part of the public review.
 */
export interface PreparedLocalDatasetResultInputs {
  readonly review: PreparedLocalDatasetReview;
  readonly admittedSourceDigest: string;
}

/** The host mints this internal effect and binds its transaction callbacks. */
export interface PreparedLocalDatasetSaveAdmission extends DatasetVersionCommitAdmission {
  readonly effectId: string;
  readonly taskId: string;
  readonly reportFingerprint: string;
  readonly outputBaseName: string;
  isCurrent(): boolean;
  stillAllowed(): Promise<boolean>;
  issue(): Promise<"issued" | "denied" | "unconfirmed">;
}

/** A commit attempt may have succeeded. Preserve its artifacts and evidence. */
export class DatasetVersionCommitUnconfirmedError extends Error {
  constructor() {
    super("The approved dataset save could not be confirmed.");
    this.name = "DatasetVersionCommitUnconfirmedError";
  }
}
