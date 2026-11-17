import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export type HeadlessDatasetTaskSelection = {readonly kind: "task"; readonly taskId: string} |
  {readonly kind: "plan-step"; readonly fingerprint: string; readonly step: number};
export interface HeadlessDatasetTaskStatusRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.dataset-task-status";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly selection: HeadlessDatasetTaskSelection};
}
export interface HeadlessDatasetTaskStatus {
  readonly taskId: string;
  readonly state: "queued" | "running" | "processing-result" | "review-required" | "succeeded" | "failed" | "cancelled";
}
export function readHeadlessDatasetTaskStatusRequest(value: unknown, currentHost: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "data.dataset-task-status") return invalid;
    const {hostIncarnationId, workspaceId, selection} = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "selection"]);
    if (!isHeadlessHostIncarnationId(currentHost) || !isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId)) return invalid;
    if (hostIncarnationId !== currentHost) return {ok: false, code: "headless.host-changed"} as const;
    const selected = readStrictPassiveRecord(selection, ["kind", "taskId", "fingerprint", "step"]);
    let exact: HeadlessDatasetTaskSelection;
    if (selected.kind === "task" && Object.keys(selected).length === 2 && isHeadlessHostIncarnationId(selected.taskId))
      exact = {kind: "task", taskId: selected.taskId};
    else if (selected.kind === "plan-step" && Object.keys(selected).length === 3 &&
        typeof selected.fingerprint === "string" && /^[a-f0-9]{64}$/.test(selected.fingerprint) &&
        typeof selected.step === "number" && Number.isSafeInteger(selected.step) && selected.step >= 1 && selected.step <= 8)
      exact = {kind: "plan-step", fingerprint: selected.fingerprint, step: selected.step};
    else return invalid;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "data.dataset-task-status",
      input: {hostIncarnationId, workspaceId, selection: exact}} satisfies HeadlessDatasetTaskStatusRequest} as const;
  } catch {return invalid;}
}

export function readHeadlessDatasetTaskStatusValue(value: unknown, selection: HeadlessDatasetTaskSelection): HeadlessDatasetTaskStatus | undefined {
  try {
    const {taskId, state} = readStrictPassiveRecord(copyBoundedPassiveData(value), ["taskId", "state"]);
    if (!isHeadlessHostIncarnationId(taskId) || (selection.kind === "task" && taskId !== selection.taskId) ||
        (state !== "queued" && state !== "running" && state !== "processing-result" && state !== "review-required" &&
          state !== "succeeded" && state !== "failed" && state !== "cancelled")) return;
    return {taskId, state};
  } catch {return;}
}
