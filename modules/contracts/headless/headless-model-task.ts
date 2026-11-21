import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_MAX_BUILD_PLAN_STEPS} from "./headless-system-management";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export type HeadlessModelTaskSelection = {readonly kind: "task"; readonly taskId: string} |
  {readonly kind: "plan-step"; readonly fingerprint: string; readonly step: number};
export interface HeadlessModelTaskRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.task";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly selection: HeadlessModelTaskSelection};
}
export interface HeadlessModelTaskValue {
  readonly workspaceId: WorkspaceId;
  readonly taskId: string;
  readonly plan: {readonly fingerprint: string; readonly step: number};
  readonly state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  readonly percent: number | null;
  readonly registration: "requires-separate-approval";
  readonly runtimeReadiness: "not-checked";
}
export interface HeadlessModelTaskCancellationRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.cancel-download";
  readonly input: HeadlessModelTaskRequest["input"];
}
export interface HeadlessModelTaskCancellationValue extends HeadlessModelTaskValue {
  /** Request acknowledgement only. Observe the original task for actual settlement. */
  readonly cancellationAccepted: boolean;
}
export type HeadlessModelTaskCancellationResult =
  | {readonly ok: true; readonly operation: "models.cancel-download"; readonly value: HeadlessModelTaskCancellationValue}
  | {readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed" | "headless.forbidden" |
      "headless.unavailable" | "headless.operation-unconfirmed"};
const invalid = {ok: false, code: "headless.invalid-request"} as const;
function record(value: unknown, names: readonly string[]) {
  const result = readStrictPassiveRecord(value, names);
  if (Object.keys(result).length !== names.length) throw new Error("Incomplete Model task metadata.");
  return result;
}
export function readHeadlessModelTaskSelection(value: unknown): HeadlessModelTaskSelection | undefined {
  try {
    const selected = readStrictPassiveRecord(copyBoundedPassiveData(value), ["kind", "taskId", "fingerprint", "step"]);
    if (selected.kind === "task" && Object.keys(selected).length === 2 && isHeadlessHostIncarnationId(selected.taskId))
      return Object.freeze({kind: "task", taskId: selected.taskId});
    if (selected.kind === "plan-step" && Object.keys(selected).length === 3 && typeof selected.fingerprint === "string" &&
        /^[a-f0-9]{64}$/.test(selected.fingerprint) && typeof selected.step === "number" && Number.isSafeInteger(selected.step) &&
        selected.step >= 1 && selected.step <= HEADLESS_MAX_BUILD_PLAN_STEPS)
      return Object.freeze({kind: "plan-step", fingerprint: selected.fingerprint, step: selected.step});
  } catch {return;}
}
export function readHeadlessModelTaskRequest(value: unknown, host: HeadlessHostIncarnationId) {
  try {
    const outer = record(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "models.task") return invalid;
    const input = record(outer.input, ["hostIncarnationId", "workspaceId", "selection"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(input.hostIncarnationId) || !isWorkspaceId(input.workspaceId)) return invalid;
    if (input.hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    const selection = readHeadlessModelTaskSelection(input.selection);
    if (!selection) return invalid;
    return {ok: true, request: Object.freeze({version: HEADLESS_CONTRACT_VERSION, operation: "models.task",
      input: Object.freeze({hostIncarnationId: host, workspaceId: input.workspaceId, selection})}) satisfies HeadlessModelTaskRequest} as const;
  } catch {return invalid;}
}
export function readHeadlessModelTaskCancellationRequest(value: unknown, host: HeadlessHostIncarnationId) {
  try {
    const raw = record(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (raw.version !== HEADLESS_CONTRACT_VERSION || raw.operation !== "models.cancel-download") return invalid;
    const parsed = readHeadlessModelTaskRequest({version: raw.version, operation: "models.task", input: raw.input}, host);
    if (!parsed.ok) return parsed;
    return {ok: true, request: Object.freeze({version: HEADLESS_CONTRACT_VERSION, operation: "models.cancel-download",
      input: parsed.request.input}) satisfies HeadlessModelTaskCancellationRequest} as const;
  } catch {return invalid;}
}
/** Finite observation only. A succeeded transfer does not save or qualify a model. */
export function readHeadlessModelTaskValue(value: unknown, target: HeadlessModelTaskRequest["input"]): HeadlessModelTaskValue | undefined {
  try {
    const raw = record(copyBoundedPassiveData(value), ["workspaceId", "taskId", "plan", "state", "percent", "registration", "runtimeReadiness"]);
    const plan = record(raw.plan, ["fingerprint", "step"]);
    const selection = readHeadlessModelTaskSelection({kind: "plan-step", ...plan});
    if (!selection || selection.kind !== "plan-step" || (target.selection.kind === "plan-step" &&
        (selection.fingerprint !== target.selection.fingerprint || selection.step !== target.selection.step))) return;
    if (raw.workspaceId !== target.workspaceId || !isHeadlessHostIncarnationId(raw.taskId) ||
        (target.selection.kind === "task" && raw.taskId !== target.selection.taskId) ||
        !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(raw.state as string) ||
        !(raw.percent === null || typeof raw.percent === "number" && Number.isFinite(raw.percent) && raw.percent >= 0 && raw.percent <= 100) ||
        raw.registration !== "requires-separate-approval" || raw.runtimeReadiness !== "not-checked") return;
    return {workspaceId: target.workspaceId, taskId: raw.taskId, plan: {fingerprint: selection.fingerprint, step: selection.step},
      state: raw.state as HeadlessModelTaskValue["state"],
      percent: raw.percent as number | null, registration: "requires-separate-approval", runtimeReadiness: "not-checked"};
  } catch {return;}
}
export function readHeadlessModelTaskCancellationValue(value: unknown,
  target: HeadlessModelTaskRequest["input"]): HeadlessModelTaskCancellationValue | undefined {
  try {
    const raw = record(copyBoundedPassiveData(value), ["workspaceId", "taskId", "plan", "state", "percent", "registration",
      "runtimeReadiness", "cancellationAccepted"]);
    const {cancellationAccepted, ...metadata} = raw;
    const task = readHeadlessModelTaskValue(metadata, target);
    return task && typeof cancellationAccepted === "boolean" ? {...task, cancellationAccepted} : undefined;
  } catch {return;}
}
