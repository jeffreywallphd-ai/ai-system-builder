import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {CONTEXT_GENERATION_LIMITS} from "../context-management";
import {HEADLESS_MAX_BUILD_PLAN_STEPS} from "./headless-system-management";
import {HEADLESS_CONTEXT_MAX_SOURCES} from "./headless-context-preview";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export type HeadlessContextTaskSelection = {readonly kind: "task"; readonly taskId: string} |
  {readonly kind: "plan-step"; readonly fingerprint: string; readonly step: number};
export interface HeadlessContextTaskRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "context.task";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly selection: HeadlessContextTaskSelection};
}
export interface HeadlessContextTaskReview {
  readonly reportFingerprint: string;
  readonly kind: "markdown-context-pack";
  readonly sourceCount: number;
  readonly chunkCount: number;
  readonly sizeBytes: number;
  readonly requiresExplicitSave: true;
}
export interface HeadlessContextTaskValue {
  readonly taskId: string;
  readonly state: "queued" | "running" | "review-required" | "saved" | "discarded" | "cancelled" | "failed";
  readonly review: HeadlessContextTaskReview | null;
}
const isDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const bounded = (value: unknown, maximum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;

export function readHeadlessContextTaskRequest(value: unknown, host: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "context.task") return invalid;
    const {hostIncarnationId, workspaceId, selection} = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "selection"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId)) return invalid;
    if (hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    const selected = readStrictPassiveRecord(selection, ["kind", "taskId", "fingerprint", "step"]);
    let exact: HeadlessContextTaskSelection;
    if (selected.kind === "task" && Object.keys(selected).length === 2 && isHeadlessHostIncarnationId(selected.taskId))
      exact = {kind: "task", taskId: selected.taskId};
    else if (selected.kind === "plan-step" && Object.keys(selected).length === 3 && isDigest(selected.fingerprint) &&
        bounded(selected.step, HEADLESS_MAX_BUILD_PLAN_STEPS) && selected.step > 0)
      exact = {kind: "plan-step", fingerprint: selected.fingerprint, step: selected.step};
    else return invalid;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "context.task",
      input: {hostIncarnationId, workspaceId, selection: exact}} satisfies HeadlessContextTaskRequest} as const;
  } catch {return invalid;}
}

/** Reconstruct only finite metadata. Never forward the owning processor result. */
export function readHeadlessContextTaskValue(value: unknown, selection: HeadlessContextTaskSelection): HeadlessContextTaskValue | undefined {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["taskId", "state", "review"]);
    if (!isHeadlessHostIncarnationId(outer.taskId) || (selection.kind === "task" && outer.taskId !== selection.taskId) ||
        !["queued", "running", "review-required", "saved", "discarded", "cancelled", "failed"].includes(outer.state as string)) return;
    const task = {taskId: outer.taskId, state: outer.state as HeadlessContextTaskValue["state"]};
    if (outer.review === null) return task.state === "review-required" ? undefined : {...task, review: null};
    if (task.state !== "review-required") return;
    const review = readStrictPassiveRecord(outer.review, ["reportFingerprint", "kind", "sourceCount", "chunkCount", "sizeBytes", "requiresExplicitSave"]);
    if (!isDigest(review.reportFingerprint) || review.kind !== "markdown-context-pack" ||
        !bounded(review.sourceCount, HEADLESS_CONTEXT_MAX_SOURCES) || review.sourceCount < 1 ||
        !bounded(review.chunkCount, 1000) || review.chunkCount < 1 || !bounded(review.sizeBytes, CONTEXT_GENERATION_LIMITS.maximumArtifactBytes) ||
        review.sizeBytes < 1 || review.requiresExplicitSave !== true) return;
    return {...task, review: {reportFingerprint: review.reportFingerprint, kind: review.kind, sourceCount: review.sourceCount,
      chunkCount: review.chunkCount, sizeBytes: review.sizeBytes, requiresExplicitSave: true}};
  } catch {return;}
}
