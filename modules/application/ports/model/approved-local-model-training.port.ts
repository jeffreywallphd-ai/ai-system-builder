import type {ModelTrainingRequest, ModelTrainingResult, ModelTrainingExecutionHistory} from "../../../contracts/model";
import type {WorkspaceId} from "../../../contracts/workspace";
import type {RuntimeTaskRecord, CancelRuntimeTaskResult} from "../../../contracts/runtime";
import type {ApplicationRequestContext} from "../application-request-context";
import type {TrainingResultVerifiedFiles} from "./training-result-file-byte-storage.port";

/** Internal replaceable storage for the explicitly trusted-local profile.
 * Paths stay between the owning adapter and safe local loader, never API/IPC
 * tool responses. This is not exclusive Native custody or a physical quota. */
export interface BoundedLocalTrainingModelSource {
  readonly modelRecordId: string;
  readonly modelUpdatedAt: string;
  readonly logicalPath: string;
  readonly files: readonly Readonly<{name: string; sizeBytes: number; sha256: string}>[];
}
export interface BoundedLocalTrainingModelCopyStoragePort {
  readonly profile: "bounded-local-v1";
  readonly identity: Readonly<{requestId: string; workspaceId: WorkspaceId; modelRecordId: string; modelUpdatedAt: string}>;
  prepare(context: ApplicationRequestContext): Promise<void>;
  /** Private loader locator only. The caller retains original worker ownership. */
  modelDirectory(context: ApplicationRequestContext): Promise<string>;
  fence(): void;
  inspect(): Readonly<{
    phase: "bound" | "preparing" | "ready" | "unconfirmed" | "discarded";
    fenced: boolean; pendingOperations: number; sourceHandlesOpen: number;
    destinationIoClosed: boolean; fileCount: number; declaredBytes: number;
    preparationFinished: boolean; physicalQuotaEnforced: false;
  }>;
  /** Separately captured cleanup authority must prove original worker/SDK/Job
   * use has ended. This result grants no global quota or service credit. */
  discard(context: ApplicationRequestContext): Promise<boolean>;
}

/** Internal configured capabilities only. These objects never cross API/IPC. */
export interface ApprovedLocalTrainingControl {
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
}
/** Preparation-only current ModelRead owner; not a byte/native/readiness proof. */
export interface ApprovedLocalTrainingModelSelection {
  readonly modelRecordId: string;
  readonly modelUpdatedAt: string;
  readonly localModelReference: string;
}
export interface ApprovedLocalTrainingModelReader {
  read(): Promise<ApprovedLocalTrainingModelSelection | undefined>;
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
  /** Captured separately; outward startup admission must not govern accepted work. */
  readonly modelSource?: ApprovedLocalTrainingModelReader;
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
  /** Optional private current observation, only after original successful
   * delivery and permanent worker/IO retirement. Fresh caller/original read
   * authority remains mandatory. This never starts work or grants Save. */
  verifyRetainedFiles?(control: ApprovedLocalTrainingControl): Promise<TrainingResultVerifiedFiles>;
}
export interface ApprovedLocalModelTrainingPort {
  /** Synchronous binding only: no IO, acquisition or task start. Undefined
   * proves no preparation occurred. Capture the returned retirement owner first. */
  createSession(definition: ApprovedLocalTrainingDefinition, control: ApprovedLocalTrainingControl,
    modelSource?: ApprovedLocalTrainingModelReader): ApprovedLocalTrainingSession | undefined;
}
/** Host-private capability to the accepted original task. Read/cancel need fresh
 * caller policy AFTER original lineage lookup. This object has no Save method. */
export interface ApprovedLocalTrainingTask {
  readonly requestId: string;
  readonly workspaceId: WorkspaceId;
  read(control: ApprovedLocalTrainingControl): Promise<ModelTrainingResult>;
  cancel(control: ApprovedLocalTrainingControl): Promise<ModelTrainingResult>;
  /** Optional original cached read; absence grants no generic read fallback.
   * Never starts/observes a runtime, reads files or saves a candidate. */
  reviewCompletion?(control: ApprovedLocalTrainingControl): Promise<ApprovedLocalTrainingCompletionReview>;
  /** Separate current-file observation through the original settled session.
   * It does not poll/settle a runtime, register a Model or grant Save. */
  reviewCandidate?(control: ApprovedLocalTrainingControl): Promise<ApprovedLocalTrainingCandidateReview>;
}
export type ApprovedLocalTrainingCandidateReview = {readonly kind: "not-ready"} | {
  readonly kind: "ready";
  readonly requestId: string;
  readonly workspaceId: WorkspaceId;
  readonly history: Extract<ApprovedLocalTrainingCompletionReview, {kind: "ready"}>;
  readonly retainedFiles: TrainingResultVerifiedFiles;
  /** Original pipeline facts, not task UUID, resource proof or Save authority. */
  readonly execution?: ModelTrainingExecutionHistory;
  /** Exact original scope/history/content identity, never approval authority. */
  readonly candidateDigest: string;
};
/** Historical approved facts, not current file, native, resource or quality proof.
 * Private host data only; no public transport is enabled by this shape. */
export type ApprovedLocalTrainingCompletionReview = {readonly kind: "not-ready"} | {
  readonly kind: "ready";
  readonly requestId: string;
  readonly workspaceId: WorkspaceId;
  readonly provenance: {
    readonly modelRecordId: string;
    readonly modelUpdatedAt: string;
    readonly datasetId: string;
    readonly versionId: string;
    readonly versionDigest: string;
    readonly recipeDigest: string;
    readonly proposalDigest: string;
    readonly trainingTask: ModelTrainingRequest["trainingTask"];
    readonly method: ModelTrainingRequest["method"];
    readonly trainingInputCount: number;
    readonly validationInputCount: number;
    readonly inputBytes: number;
    readonly recipeBytes: number;
  };
  readonly candidate: {readonly requestedName: string;
    readonly artifactForm: "adapter" | "merged-model" | "full-model" | "checkpoint" | null;
    readonly serializationFormat: "safetensors" | "sharded-safetensors" | "adapter-safetensors" | null;
    readonly recordedSizeBytes: number | null};
  readonly comparison: {readonly state: "not-recorded"} | {readonly state: "recorded"; readonly report: {
    readonly protocol: "fixed-first-32-validation-loss-v1"; readonly maximumRows: 32; readonly sampleCount: number;
    readonly baselineLoss: number; readonly trainedLoss: number; readonly lossDelta: number;
    readonly interpretation: "measurement-only"}};
  readonly verification: {readonly inputs: "recorded-not-rechecked"; readonly retainedFiles: "not-checked";
    readonly runtimeReadiness: "not-checked"; readonly hardware: "not-recorded"; readonly outputQuality: "not-evaluated"};
  readonly registration: "requires-separate-approval";
};
export type ApprovedLocalTrainingStart =
  {readonly kind: "accepted"; readonly value: ModelTrainingResult; readonly task: ApprovedLocalTrainingTask} |
  {readonly kind: "unavailable" | "unconfirmed"};
