import {copyBoundedPassiveData, readStrictPassiveRecord, hasKnownPassiveCredential} from "../shared";
import {MAX_MODEL_SOURCE_FILES, MAX_MODEL_SOURCE_BYTES, readModelDownloadSourceRequest, type ModelDownloadSource} from "../model";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_MAX_BUILD_PLAN_STEPS} from "./headless-system-management";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export const HEADLESS_MODEL_TASK_CONTROL_PATH = "/aisb-headless/v1/model-task-control";
export const MANAGED_HEADLESS_MODEL_TASK_CONTROL_PATH = "/api/headless/agent/model-task-control";
export const HEADLESS_MODEL_TASK_READ_OPERATIONS = Object.freeze(["models.task", "models.review-download", "models.training-task"] as const);
export function isHeadlessModelTaskReadOperation(value: unknown): value is typeof HEADLESS_MODEL_TASK_READ_OPERATIONS[number] {
  return HEADLESS_MODEL_TASK_READ_OPERATIONS.some(operation => operation === value);
}

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
export interface HeadlessModelDownloadReviewRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.review-download";
  readonly input: HeadlessModelTaskRequest["input"];
}
/** Historical completion metadata. This grants no current file or save authority. */
export interface HeadlessModelDownloadReviewValue {
  readonly workspaceId: WorkspaceId;
  readonly taskId: string;
  readonly plan: {readonly fingerprint: string; readonly step: number};
  readonly modelId: string;
  readonly revision: string;
  readonly manifestDigest: string;
  readonly format: ModelDownloadSource["format"];
  readonly license: ModelDownloadSource["license"];
  readonly selectedFileCount: number;
  readonly totalBytes: number;
  readonly fromCache: boolean;
  readonly selectedFilesVerification: "verified-at-completion";
  readonly registration: "requires-separate-approval";
  readonly runtimeReadiness: "not-checked";
}
export type HeadlessModelDownloadReviewResult =
  | {readonly ok: true; readonly operation: "models.review-download"; readonly value: HeadlessModelDownloadReviewValue}
  | {readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed" | "headless.forbidden" |
      "headless.unavailable" | "headless.source-not-ready"};
export type HeadlessModelTaskCancellationResult =
  | {readonly ok: true; readonly operation: "models.cancel-download"; readonly value: HeadlessModelTaskCancellationValue}
  | {readonly ok: false; readonly code: "headless.invalid-request" | "headless.unsupported-operation" | "headless.host-changed" | "headless.forbidden" |
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
export function readHeadlessModelDownloadReviewRequest(value: unknown, host: HeadlessHostIncarnationId) {
  try {
    const raw = record(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (raw.version !== HEADLESS_CONTRACT_VERSION || raw.operation !== "models.review-download") return invalid;
    const parsed = readHeadlessModelTaskRequest({version: raw.version, operation: "models.task", input: raw.input}, host);
    if (!parsed.ok) return parsed;
    return {ok: true, request: Object.freeze({version: HEADLESS_CONTRACT_VERSION, operation: "models.review-download",
      input: parsed.request.input}) satisfies HeadlessModelDownloadReviewRequest} as const;
  } catch {return invalid;}
}
function readTaskIdentity(raw: Record<string, unknown>, target: HeadlessModelTaskRequest["input"]) {
  const plan = record(raw.plan, ["fingerprint", "step"]);
  const selection = readHeadlessModelTaskSelection({kind: "plan-step", ...plan});
  if (!selection || selection.kind !== "plan-step" || (target.selection.kind === "plan-step" &&
      (selection.fingerprint !== target.selection.fingerprint || selection.step !== target.selection.step)) ||
      raw.workspaceId !== target.workspaceId || !isHeadlessHostIncarnationId(raw.taskId) ||
      (target.selection.kind === "task" && raw.taskId !== target.selection.taskId)) return;
  return {workspaceId: target.workspaceId, taskId: raw.taskId, plan: {fingerprint: selection.fingerprint, step: selection.step}};
}
export function readHeadlessModelDownloadReviewValue(value: unknown,
  target: HeadlessModelTaskRequest["input"]): HeadlessModelDownloadReviewValue | undefined {
  try {
    const raw = record(copyBoundedPassiveData(value), ["workspaceId", "taskId", "plan", "modelId", "revision", "manifestDigest",
      "format", "license", "selectedFileCount", "totalBytes", "fromCache", "selectedFilesVerification", "registration", "runtimeReadiness"]);
    const identity = readTaskIdentity(raw, target);
    const source = readModelDownloadSourceRequest({provider: "huggingface", modelId: raw.modelId, revision: raw.revision});
    if (!identity || source.revision === undefined || source.revision !== raw.revision ||
        typeof raw.manifestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(raw.manifestDigest) ||
        raw.format !== "transformers-safetensors" || !Number.isSafeInteger(raw.selectedFileCount) ||
        (raw.selectedFileCount as number) < 3 || (raw.selectedFileCount as number) > MAX_MODEL_SOURCE_FILES ||
        !Number.isSafeInteger(raw.totalBytes) || (raw.totalBytes as number) < (raw.selectedFileCount as number) ||
        (raw.totalBytes as number) > MAX_MODEL_SOURCE_BYTES || typeof raw.fromCache !== "boolean" ||
        raw.selectedFilesVerification !== "verified-at-completion" || raw.registration !== "requires-separate-approval" ||
        raw.runtimeReadiness !== "not-checked") return;
    const suppliedLicense = readStrictPassiveRecord(raw.license, ["kind", "identifier"]);
    let license: ModelDownloadSource["license"];
    if (suppliedLicense.kind === "unknown" && Object.keys(suppliedLicense).length === 1) license = {kind: "unknown"};
    else if (suppliedLicense.kind === "provider-declared" && Object.keys(suppliedLicense).length === 2 &&
        typeof suppliedLicense.identifier === "string" && /^[A-Za-z0-9][A-Za-z0-9+._-]{0,79}$/.test(suppliedLicense.identifier) &&
        !hasKnownPassiveCredential(suppliedLicense.identifier)) license = {kind: "provider-declared", identifier: suppliedLicense.identifier};
    else return;
    return Object.freeze({...identity, plan: Object.freeze(identity.plan), modelId: source.modelId, revision: source.revision,
      manifestDigest: raw.manifestDigest, format: "transformers-safetensors", license: Object.freeze(license),
      selectedFileCount: raw.selectedFileCount as number, totalBytes: raw.totalBytes as number, fromCache: raw.fromCache,
      selectedFilesVerification: "verified-at-completion", registration: "requires-separate-approval", runtimeReadiness: "not-checked"});
  } catch {return;}
}
export function readHeadlessModelDownloadReviewResult(value: unknown,
  target: HeadlessModelTaskRequest["input"]): HeadlessModelDownloadReviewResult {
  const unavailable = {ok: false, code: "headless.unavailable"} as const;
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["ok", "operation", "value", "code"]);
    if (raw.ok === false && Object.keys(raw).length === 2 && typeof raw.code === "string" &&
        ["headless.invalid-request", "headless.host-changed", "headless.forbidden", "headless.unavailable", "headless.source-not-ready"].includes(raw.code))
      return {ok: false, code: raw.code as Extract<HeadlessModelDownloadReviewResult, {ok: false}>["code"]};
    if (raw.ok !== true || Object.keys(raw).length !== 3 || raw.operation !== "models.review-download") return unavailable;
    const review = readHeadlessModelDownloadReviewValue(raw.value, target);
    return review ? {ok: true, operation: "models.review-download", value: review} : unavailable;
  } catch {return unavailable;}
}
/** Finite observation only. A succeeded transfer does not save or qualify a model. */
export function readHeadlessModelTaskValue(value: unknown, target: HeadlessModelTaskRequest["input"]): HeadlessModelTaskValue | undefined {
  try {
    const raw = record(copyBoundedPassiveData(value), ["workspaceId", "taskId", "plan", "state", "percent", "registration", "runtimeReadiness"]);
    const identity = readTaskIdentity(raw, target);
    if (!identity ||
        !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(raw.state as string) ||
        !(raw.percent === null || typeof raw.percent === "number" && Number.isFinite(raw.percent) && raw.percent >= 0 && raw.percent <= 100) ||
        raw.registration !== "requires-separate-approval" || raw.runtimeReadiness !== "not-checked") return;
    return {...identity,
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
/** A malformed reply after dispatch cannot prove that cancellation did not occur. */
export function readHeadlessModelTaskCancellationResult(value: unknown,
  target: HeadlessModelTaskRequest["input"]): HeadlessModelTaskCancellationResult {
  const unconfirmed = {ok: false, code: "headless.operation-unconfirmed"} as const;
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["ok", "operation", "value", "code"]);
    if (raw.ok === false && Object.keys(raw).length === 2 && typeof raw.code === "string" &&
        ["headless.invalid-request", "headless.unsupported-operation", "headless.host-changed", "headless.forbidden",
          "headless.unavailable", "headless.operation-unconfirmed"].includes(raw.code))
      return {ok: false, code: raw.code as Extract<HeadlessModelTaskCancellationResult, {ok: false}>["code"]};
    if (raw.ok !== true || Object.keys(raw).length !== 3 || raw.operation !== "models.cancel-download") return unconfirmed;
    const task = readHeadlessModelTaskCancellationValue(raw.value, target);
    return task ? {ok: true, operation: "models.cancel-download", value: task} : unconfirmed;
  } catch {return unconfirmed;}
}
