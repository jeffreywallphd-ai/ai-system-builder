/** Training controls stay private. The read-only specialization enables no host by itself. */
import {copyBoundedPassiveData, readStrictPassiveRecord, hasKnownPassiveCredential, isUnsafePassiveText} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {normalizeDatasetId, normalizeDatasetVersionId, normalizeDatasetVersionDigest} from "../dataset";
import {DATASET_PREPARATION_TASK_TYPES} from "../runtime";
import {isHeadlessModelRecordId, isHeadlessModelTimestamp} from "./headless-model-metadata";
import {MODEL_TRAINING_STATUSES, MODEL_TRAINING_METHODS, readModelTrainingExecutionHistory,
  type ModelTrainingExecutionHistory, type ModelTrainingMethod, type ModelTrainingStatus} from "../model";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";
import {readHeadlessModelTaskSelection, type HeadlessModelTaskSelection} from "./headless-model-task";

export type HeadlessTrainingTaskOperation = "models.training-task" | "models.cancel-training";
export interface HeadlessTrainingTaskRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: HeadlessTrainingTaskOperation;
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly selection: HeadlessModelTaskSelection};
}
export type HeadlessTrainingTaskReadRequest = Omit<HeadlessTrainingTaskRequest, "operation"> & {
  readonly operation: "models.training-task";
};
export interface HeadlessTrainingTaskValue {
  readonly workspaceId: WorkspaceId;
  readonly taskId: string;
  readonly plan: {readonly fingerprint: string; readonly step: number};
  readonly state: ModelTrainingStatus;
  readonly percent: number | null;
  readonly progress: {readonly epoch: number | null; readonly totalEpochs: number | null;
    readonly batch: number | null; readonly totalBatches: number | null};
  readonly resultReview: "not-ready" | "pending";
  readonly registration: "requires-separate-approval";
  readonly runtimeReadiness: "not-checked";
  readonly outputQuality: "not-evaluated";
}
export interface HeadlessTrainingCancellationValue extends HeadlessTrainingTaskValue {
  /** A request or a previously observed terminal task, never native retirement. */
  readonly cancellation: "requested-unconfirmed" | "not-needed";
}
export type HeadlessTrainingTaskResult =
  | {readonly ok: true; readonly operation: "models.training-task"; readonly value: HeadlessTrainingTaskValue}
  | {readonly ok: true; readonly operation: "models.cancel-training"; readonly value: HeadlessTrainingCancellationValue}
  | {readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed" | "headless.forbidden" |
      "headless.unavailable" | "headless.operation-unconfirmed"};
const invalid = {ok: false, code: "headless.invalid-request"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const readFailures = ["headless.invalid-request", "headless.host-changed", "headless.forbidden",
  "headless.unavailable", "headless.unsupported-operation", "headless.not-found"] as const;
export type HeadlessTrainingTaskReadResult =
  | {readonly ok: true; readonly operation: "models.training-task"; readonly value: HeadlessTrainingTaskValue}
  | {readonly ok: false; readonly code: typeof readFailures[number]};
function exact(raw: unknown, keys: readonly string[]) {
  const result = readStrictPassiveRecord(raw, keys);
  if (Object.keys(result).length !== keys.length) throw new Error("Incomplete private training task summary.");
  return result;
}
export function readHeadlessTrainingTaskRequest(raw: unknown, host: HeadlessHostIncarnationId) {
  try {
    const value = exact(copyBoundedPassiveData(raw), ["version", "operation", "input"]);
    if (value.version !== HEADLESS_CONTRACT_VERSION ||
        (value.operation !== "models.training-task" && value.operation !== "models.cancel-training")) return invalid;
    const input = exact(value.input, ["hostIncarnationId", "workspaceId", "selection"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(input.hostIncarnationId) || !isWorkspaceId(input.workspaceId)) return invalid;
    if (input.hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    const selection = readHeadlessModelTaskSelection(input.selection); if (!selection) return invalid;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: value.operation,
      input: {hostIncarnationId: host, workspaceId: input.workspaceId, selection}} as HeadlessTrainingTaskRequest} as const;
  } catch {return invalid;}
}
/** A read endpoint must never accept the private cancellation operation. */
export function readHeadlessTrainingTaskReadRequest(raw: unknown, host: HeadlessHostIncarnationId) {
  const parsed = readHeadlessTrainingTaskRequest(raw, host);
  if (!parsed.ok) return parsed;
  if (parsed.request.operation !== "models.training-task") return invalid;
  Object.freeze(parsed.request.input.selection);
  Object.freeze(parsed.request.input);
  return {ok: true, request: Object.freeze(parsed.request) as HeadlessTrainingTaskReadRequest} as const;
}

/** Independently copy and correlate a finite reply before later policy waits. */
export function readHeadlessTrainingTaskReadResult(raw: unknown,
  expected: HeadlessTrainingTaskReadRequest["input"]): HeadlessTrainingTaskReadResult {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(raw), ["ok", "operation", "value", "code"]);
    if (outer.ok === false) {
      return Object.keys(outer).length === 2 && readFailures.some(code => code === outer.code)
        ? {ok: false, code: outer.code as typeof readFailures[number]} : unavailable;
    }
    if (outer.ok !== true || outer.operation !== "models.training-task" || Object.keys(outer).length !== 3) return unavailable;
    const target = readHeadlessTrainingTaskReadRequest({version: HEADLESS_CONTRACT_VERSION,
      operation: "models.training-task", input: expected}, expected.hostIncarnationId);
    if (!target.ok) return unavailable;
    const value = readHeadlessTrainingTaskValue(outer.value);
    const selection = target.request.input.selection;
    if (!value || value.workspaceId !== target.request.input.workspaceId || (selection.kind === "task"
      ? value.taskId !== selection.taskId
      : value.plan.fingerprint !== selection.fingerprint || value.plan.step !== selection.step)) return unavailable;
    return {ok: true, operation: "models.training-task", value};
  } catch {return unavailable;}
}
export function readHeadlessTrainingTaskValue(raw: unknown, cancellation = false): HeadlessTrainingTaskValue | HeadlessTrainingCancellationValue | undefined {
  try {
    const value = exact(copyBoundedPassiveData(raw), ["workspaceId", "taskId", "plan", "state", "percent", "progress",
      "resultReview", "registration", "runtimeReadiness", "outputQuality", ...(cancellation ? ["cancellation"] : [])]);
    const plan = exact(value.plan, ["fingerprint", "step"]);
    const selection = readHeadlessModelTaskSelection({kind: "plan-step", ...plan});
    if (!selection || !isWorkspaceId(value.workspaceId) || !isHeadlessHostIncarnationId(value.taskId) ||
        !MODEL_TRAINING_STATUSES.includes(value.state as ModelTrainingStatus) ||
        (value.percent !== null && (typeof value.percent !== "number" || !Number.isFinite(value.percent) || value.percent < 0 || value.percent > 100)) ||
        !["not-ready", "pending"].includes(value.resultReview as string) || (value.resultReview === "pending" && value.state !== "succeeded") ||
        value.registration !== "requires-separate-approval" || value.runtimeReadiness !== "not-checked" || value.outputQuality !== "not-evaluated") return;
    const progress = exact(value.progress, ["epoch", "totalEpochs", "batch", "totalBatches"]);
    if (Object.values(progress).some(number => number !== null && (!Number.isSafeInteger(number) || (number as number) < 0)) ||
        (cancellation && !["requested-unconfirmed", "not-needed"].includes(value.cancellation as string)) ||
        (cancellation && value.cancellation === "not-needed" && !["succeeded", "failed", "cancelled"].includes(value.state as string))) return;
    const epoch = progress.epoch as number | null, epochs = progress.totalEpochs as number | null;
    const batch = progress.batch as number | null, batches = progress.totalBatches as number | null;
    if (epochs !== null && epochs > 0 && epoch !== null && epoch > epochs ||
        batches !== null && batches > 0 && batch !== null && batch > batches) return;
    const percent = batch !== null && batches !== null && batches > 0 ? batch / batches * 100 : null;
    if (value.percent !== percent) return;
    return value as unknown as HeadlessTrainingTaskValue | HeadlessTrainingCancellationValue;
  } catch {return;}
}

/** Cached history by default; current file observation requires explicit mode.
 * This codec does not advertise or enable a transport operation. */
export interface HeadlessTrainingCompletionRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.review-training";
  readonly input: HeadlessTrainingTaskReadRequest["input"] & {readonly mode?: "current-files"};
}
export interface HeadlessTrainingCurrentCandidateSummary {
  readonly verification: "sha256-current-local-v1";
  readonly candidateDigest: string;
  readonly manifestDigest: string;
  readonly fileCount: number;
  readonly candidateFileCount: number;
  readonly totalBytes: number;
  readonly execution: {readonly state: "not-recorded"} | {readonly state: "recorded"; readonly report: ModelTrainingExecutionHistory};
}
export interface HeadlessTrainingCompletionValue {
  readonly workspaceId: WorkspaceId;
  readonly taskId: string;
  readonly plan: {readonly fingerprint: string; readonly step: number};
  readonly provenance: {
    readonly modelRecordId: string; readonly modelUpdatedAt: string;
    readonly datasetId: string; readonly versionId: string; readonly versionDigest: string;
    readonly recipeDigest: string; readonly proposalDigest: string;
    readonly trainingTask: string; readonly method: ModelTrainingMethod;
    readonly trainingInputCount: number; readonly validationInputCount: number;
    readonly inputBytes: number; readonly recipeBytes: number;
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
  /** Current original-owner observation only; no locators or Save authority. */
  readonly currentCandidate?: HeadlessTrainingCurrentCandidateSummary;
  readonly registration: "requires-separate-approval";
}
const completionFailures = [...readFailures, "headless.source-not-ready"] as const;
export type HeadlessTrainingCompletionResult =
  | {readonly ok: true; readonly operation: "models.review-training"; readonly value: HeadlessTrainingCompletionValue}
  | {readonly ok: false; readonly code: typeof completionFailures[number]};
export function readHeadlessTrainingCompletionRequest(raw: unknown, host: HeadlessHostIncarnationId) {
  try {
    const outer = exact(copyBoundedPassiveData(raw), ["version", "operation", "input"]);
    if (outer.operation !== "models.review-training") return invalid;
    const input = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "selection", "mode"]);
    if (input.mode !== undefined && input.mode !== "current-files" || Object.keys(input).length !== (input.mode === undefined ? 3 : 4)) return invalid;
    const {mode, ...target} = input;
    const parsed = readHeadlessTrainingTaskReadRequest({...outer, operation: "models.training-task", input: target}, host);
    if (!parsed.ok) return parsed;
    return {ok: true, request: Object.freeze({...parsed.request, operation: "models.review-training" as const,
      input: Object.freeze({...parsed.request.input, ...(mode === "current-files" ? {mode: "current-files" as const} : {})})})} as const;
  } catch {return invalid;}
}
export function readHeadlessTrainingCompletionValue(raw: unknown): HeadlessTrainingCompletionValue | undefined {
  try {
    const value = readStrictPassiveRecord(copyBoundedPassiveData(raw), ["workspaceId", "taskId", "plan", "provenance", "candidate", "comparison", "verification", "registration", "currentCandidate"]);
    if (Object.keys(value).length !== (value.currentCandidate === undefined ? 8 : 9)) return;
    const plan = exact(value.plan, ["fingerprint", "step"]);
    if (!isWorkspaceId(value.workspaceId) || !isHeadlessHostIncarnationId(value.taskId) ||
        !readHeadlessModelTaskSelection({kind: "plan-step", ...plan}) || value.registration !== "requires-separate-approval") return;
    const p = exact(value.provenance, ["modelRecordId", "modelUpdatedAt", "datasetId", "versionId", "versionDigest", "recipeDigest", "proposalDigest",
      "trainingTask", "method", "trainingInputCount", "validationInputCount", "inputBytes", "recipeBytes"]);
    const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
    const digest = (v: unknown) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
    if (!isHeadlessModelRecordId(p.modelRecordId) || !isHeadlessModelTimestamp(p.modelUpdatedAt) ||
        typeof p.datasetId !== "string" || normalizeDatasetId(p.datasetId) !== p.datasetId ||
        typeof p.versionId !== "string" || normalizeDatasetVersionId(p.versionId) !== p.versionId ||
        typeof p.versionDigest !== "string" || normalizeDatasetVersionDigest(p.versionDigest) !== p.versionDigest ||
        !digest(p.recipeDigest) || !digest(p.proposalDigest) ||
        !MODEL_TRAINING_METHODS.includes(p.method as never) || !DATASET_PREPARATION_TASK_TYPES.includes(p.trainingTask as never) ||
        [p.datasetId, p.versionId].some(v => hasKnownPassiveCredential(v as string)) ||
        !integer(p.trainingInputCount, 1, 16) || !integer(p.validationInputCount, 0, 16) || p.trainingInputCount + p.validationInputCount > 16 ||
        !integer(p.inputBytes, 1, 256 * 1024 ** 2) || !integer(p.recipeBytes, 1, 512 * 1024) || p.inputBytes + p.recipeBytes > 256 * 1024 ** 2) return;
    const c = exact(value.candidate, ["requestedName", "artifactForm", "serializationFormat", "recordedSizeBytes"]);
    if (typeof c.requestedName !== "string" || !c.requestedName.trim() || c.requestedName.length > 200 || isUnsafePassiveText(c.requestedName) ||
        ![null, "adapter", "merged-model", "full-model", "checkpoint"].includes(c.artifactForm as never) ||
        ![null, "safetensors", "sharded-safetensors", "adapter-safetensors"].includes(c.serializationFormat as never) ||
        c.recordedSizeBytes !== null && !integer(c.recordedSizeBytes, 0, Number.MAX_SAFE_INTEGER)) return;
    const comparison = readStrictPassiveRecord(value.comparison, ["state", "report"]);
    if (comparison.state === "not-recorded") {if (Object.keys(comparison).length !== 1) return;}
    else {
      if (comparison.state !== "recorded" || Object.keys(comparison).length !== 2) return;
      const r = exact(comparison.report, ["protocol", "maximumRows", "sampleCount", "baselineLoss", "trainedLoss", "lossDelta", "interpretation"]);
      const loss = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
      if (r.protocol !== "fixed-first-32-validation-loss-v1" || r.maximumRows !== 32 || !integer(r.sampleCount, 1, 32) ||
          !loss(r.baselineLoss) || !loss(r.trainedLoss) || r.lossDelta !== r.trainedLoss - r.baselineLoss || r.interpretation !== "measurement-only") return;
    }
    const v = exact(value.verification, ["inputs", "retainedFiles", "runtimeReadiness", "hardware", "outputQuality"]);
    if (v.inputs !== "recorded-not-rechecked" || v.retainedFiles !== "not-checked" || v.runtimeReadiness !== "not-checked" ||
        v.hardware !== "not-recorded" || v.outputQuality !== "not-evaluated") return;
    if (value.currentCandidate === undefined) return value as unknown as HeadlessTrainingCompletionValue;
    const current = exact(value.currentCandidate, ["verification", "candidateDigest", "manifestDigest", "fileCount", "candidateFileCount", "totalBytes", "execution"]);
    if (current.verification !== "sha256-current-local-v1" || !digest(current.candidateDigest) || !digest(current.manifestDigest) || !integer(current.fileCount, 3, 256) ||
        !integer(current.candidateFileCount, 3, current.fileCount as number) || !integer(current.totalBytes, current.fileCount as number, Number.MAX_SAFE_INTEGER)) return;
    const observation = readStrictPassiveRecord(current.execution, ["state", "report"]);
    let execution: HeadlessTrainingCurrentCandidateSummary["execution"];
    if (observation.state === "not-recorded" && Object.keys(observation).length === 1) execution = {state: "not-recorded"};
    else {
      if (observation.state !== "recorded" || Object.keys(observation).length !== 2) return;
      const report = readModelTrainingExecutionHistory(observation.report); if (!report) return;
      execution = {state: "recorded", report};
    }
    return {...value, currentCandidate: {...current, execution}} as unknown as HeadlessTrainingCompletionValue;
  } catch {return;}
}
/** Repeat correlation independently at each broker boundary; copy before awaits. */
export function readHeadlessTrainingCompletionResult(raw: unknown,
  expected: HeadlessTrainingCompletionRequest["input"]): HeadlessTrainingCompletionResult {
  try {
    const target = readHeadlessTrainingCompletionRequest({version: HEADLESS_CONTRACT_VERSION, operation: "models.review-training", input: expected}, expected.hostIncarnationId);
    if (!target.ok) return unavailable;
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(raw), ["ok", "operation", "value", "code"]);
    if (outer.ok === false) return Object.keys(outer).length === 2 && completionFailures.some(code => code === outer.code)
      ? {ok: false, code: outer.code as typeof completionFailures[number]} : unavailable;
    if (outer.ok !== true || outer.operation !== "models.review-training" || Object.keys(outer).length !== 3) return unavailable;
    const value = readHeadlessTrainingCompletionValue(outer.value), selection = target.request.input.selection;
    if (!value || Boolean(value.currentCandidate) !== (target.request.input.mode === "current-files") ||
      value.workspaceId !== target.request.input.workspaceId || (selection.kind === "task" ? value.taskId !== selection.taskId
      : value.plan.fingerprint !== selection.fingerprint || value.plan.step !== selection.step)) return unavailable;
    return {ok: true, operation: "models.review-training", value};
  } catch {return unavailable;}
}
