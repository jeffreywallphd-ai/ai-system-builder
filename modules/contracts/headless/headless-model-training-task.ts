/** Training controls stay private. The read-only specialization enables no host by itself. */
import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {MODEL_TRAINING_STATUSES, type ModelTrainingStatus} from "../model";
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
