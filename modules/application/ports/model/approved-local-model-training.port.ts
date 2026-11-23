import type {ModelTrainingRequest, ModelTrainingResult} from "../../../contracts/model";
import type {WorkspaceId} from "../../../contracts/workspace";
import type {RuntimeTaskRecord, CancelRuntimeTaskResult} from "../../../contracts/runtime";

/** Internal configured capabilities only. These objects never cross API/IPC. */
export interface ApprovedLocalTrainingControl {
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
}
export interface ApprovedLocalTrainingBytes {
  /** Private runtime alias, not an Artifact Registry lookup or authority. */
  readonly artifactId: string;
  readonly role: "train" | "validation";
  readonly mediaType: string;
  readonly digest: string;
  readonly content: Uint8Array;
}
export interface ApprovedLocalTrainingAdmission {
  readonly requestId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly clientId: string;
  readonly hostIncarnationId: string;
  readonly modelUpdatedAt: string;
  readonly datasetId: string;
  readonly versionId: string;
  readonly versionDigest: string;
  readonly proposalDigest: string;
  readonly inputs: readonly ApprovedLocalTrainingBytes[];
  readonly recipe: {readonly digest: string; readonly content: Uint8Array};
  readonly control: ApprovedLocalTrainingControl;
  readonly isAdmissionCurrent: () => boolean;
  readonly acknowledgeIssued: () => Promise<boolean>;
}
export interface ApprovedLocalTrainingDefinition {
  readonly requestId: string;
  readonly workspaceId: WorkspaceId;
  readonly owner: {readonly organizationId: string; readonly principalId: string; readonly clientId: string; readonly hostIncarnationId: string};
  readonly request: ModelTrainingRequest;
  readonly modelUpdatedAt: string;
  readonly dataset: {readonly datasetId: string; readonly versionId: string; readonly versionDigest: string; readonly recipeDigest: string};
  readonly proposalDigest: string;
  readonly inputs: readonly {readonly artifactId: string; readonly role: "train" | "validation"; readonly mediaType: string; readonly digest: string; readonly sizeBytes: number}[];
  readonly recipeSizeBytes: number;
}
export interface ApprovedLocalTrainingStagedInput {
  readonly payload: ModelTrainingRequest;
  readonly recipe: {readonly path: string; readonly digest: string; readonly sizeBytes: number};
  readonly outputDirectory: string;
}
export type ApprovedLocalTrainingStartAck =
  {readonly kind: "accepted"; readonly requestId: string; readonly workspaceId: WorkspaceId; readonly status: "queued" | "running"} |
  {readonly kind: "unavailable" | "unconfirmed"};

/** Original preparation/retirement owner captured BEFORE any awaited IO.
 * prepare proves installed-only readiness, exact bytes/custody and host limits.
 * start uses only the fixed local text-causal full-base loader; no generic flag,
 * provider/installer fallback or caller-selected function. All data is rechecked.
 *
 * settle proves this OWN session's worker AND Node/native readers/IO stopped.
 * Generic Python shutdown, task status, PID absence or metadata cannot replace
 * that proof. False/unknown retains custody. It supplies no Save/retention grant
 * and does not release accounting for retained output bytes. */
// Settlement is permanent. Subsequent reads serve cached metadata only. Repeated
// settle calls may observe that original retirement, never repeat an unknown
// close/cancel/start, acquire readers or create a fresh lease.
export interface ApprovedLocalTrainingSession {
  readonly requestId: string;
  readonly workspaceId: WorkspaceId;
  prepare(): Promise<"ready" | "unavailable" | "unconfirmed">;
  /** Capture this original synchronous admission fence. Recheck it immediately
   * before physical dispatch and after the adapter's own waits, together with
   * fresh business permission. It is never serialized or native/resource proof.
   * Admission loss after dispatch cannot erase the original accepted outcome. */
  start(input: ApprovedLocalTrainingStagedInput, isAdmissionCurrent: () => boolean): Promise<ApprovedLocalTrainingStartAck>;
  read(): Promise<RuntimeTaskRecord>;
  cancel(): Promise<CancelRuntimeTaskResult>;
  settle(): Promise<boolean>;
}
export interface ApprovedLocalModelTrainingPort {
  /** Synchronous binding only: no IO, acquisition or task start. Undefined
   * proves no preparation occurred. Capture the returned retirement owner first. */
  createSession(definition: ApprovedLocalTrainingDefinition, control: ApprovedLocalTrainingControl): ApprovedLocalTrainingSession | undefined;
}
/** Host-private capability to the accepted original task. Read/cancel need fresh
 * caller policy AFTER original lineage lookup. This object has no Save method. */
export interface ApprovedLocalTrainingTask {
  readonly requestId: string;
  readonly workspaceId: WorkspaceId;
  read(control: ApprovedLocalTrainingControl): Promise<ModelTrainingResult>;
  cancel(control: ApprovedLocalTrainingControl): Promise<ModelTrainingResult>;
}
export type ApprovedLocalTrainingStart =
  {readonly kind: "accepted"; readonly value: ModelTrainingResult; readonly task: ApprovedLocalTrainingTask} |
  {readonly kind: "unavailable" | "unconfirmed"};
