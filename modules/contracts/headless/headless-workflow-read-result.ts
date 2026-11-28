import {normalizeConversationTurnStatus} from "../conversations";
import {isExecutionRunStatus} from "../execution-runs";
import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {isHeadlessWorkflowId, type HeadlessReadRequest, type HeadlessWorkflowSource} from "./headless-read-request";
import type {HeadlessReadResult} from "./headless-read-result";

export const HEADLESS_WORKFLOW_READ_OPERATIONS = ["workflows.list", "workflows.prepare", "conversation-tasks.read"] as const;
export function isHeadlessWorkflowReadOperation(value: unknown): value is typeof HEADLESS_WORKFLOW_READ_OPERATIONS[number] {
  return HEADLESS_WORKFLOW_READ_OPERATIONS.some(operation => operation === value);
}
const profiles = {
  "builtin.workflow.conversation@1.0.0": {kind: "reviewed-execution-plan", title: "Controlled conversation", actions: ["refresh"]},
  "builtin.workflow.records.service-request@1.0.0": {kind: "approved-release", title: "Service request records", actions: ["refresh", "read-record"]},
  "builtin.workflow.artifact-review@1.0.0": {kind: "approved-release", title: "Artifact review", actions: ["refresh", "search", "open-artifact"]},
} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
function invalid(): never {throw new Error("Workflow read result is invalid.");}
function id(value: unknown): string {return isHeadlessWorkflowId(value) ? value : invalid();}
function array<T>(value: unknown, maximum: number, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value.map(read);
}
function source(raw: unknown): HeadlessWorkflowSource {
  const base = readStrictPassiveRecord(raw, ["kind", "sourceId", "sourceDigest", "sourceRevision"]);
  if (base.kind === "approved-release") {
    const value = readStrictPassiveRecord(raw, ["kind", "sourceId", "sourceDigest"]);
    if (typeof value.sourceDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.sourceDigest)) invalid();
    return {kind: "approved-release", sourceId: id(value.sourceId), sourceDigest: value.sourceDigest};
  }
  const value = readStrictPassiveRecord(raw, ["kind", "sourceId", "sourceRevision"]);
  if (value.kind !== "reviewed-execution-plan") invalid();
  return {kind: value.kind, sourceId: id(value.sourceId), sourceRevision: id(value.sourceRevision)};
}
function profile(raw: unknown) {
  const value = readStrictPassiveRecord(raw, ["profileId", "source", "title", "availability", "blockers"]);
  const profileId = id(value.profileId);
  if (!Object.prototype.hasOwnProperty.call(profiles, profileId)) invalid();
  const expected = profiles[profileId as keyof typeof profiles], selected = source(value.source);
  if (selected.kind !== expected.kind || value.title !== expected.title ||
      value.availability !== "available" && value.availability !== "blocked") invalid();
  const availability: "available" | "blocked" = value.availability;
  return {profileId, source: selected, title: expected.title, availability,
    blockers: array(value.blockers, 16, item => ({code: id(readStrictPassiveRecord(item, ["code"]).code)}))};
}
type Field = Extract<HeadlessReadResult, {ok: true; operation: "workflows.prepare"}>["value"]["actions"][number]["fields"][number];
function field(raw: unknown): Field {
  const value = readStrictPassiveRecord(raw, ["fieldId", "kind", "required", "minimum", "maximum", "maximumLength", "options"]);
  const kinds = ["text", "multiline", "integer", "number", "boolean", "select"] as const;
  const kind = kinds.find(item => item === value.kind);
  if (!kind || typeof value.required !== "boolean") invalid();
  const numeric = (key: "minimum" | "maximum" | "maximumLength") => {
    const number = value[key];
    if (number === undefined) return undefined;
    if (typeof number !== "number" || !Number.isFinite(number) ||
        key === "maximumLength" && (!Number.isSafeInteger(number) || number <= 0)) invalid();
    return number;
  };
  const minimum = numeric("minimum"), maximum = numeric("maximum"), maximumLength = numeric("maximumLength");
  const options = value.options === undefined ? undefined : array(value.options, 32, id);
  if (options?.length === 0 || kind === "select" && !options ||
      minimum !== undefined && maximum !== undefined && minimum > maximum) invalid();
  return {fieldId: id(value.fieldId), kind, required: value.required,
    ...(minimum === undefined ? {} : {minimum}), ...(maximum === undefined ? {} : {maximum}),
    ...(maximumLength === undefined ? {} : {maximumLength}), ...(options === undefined ? {} : {options})};
}
function sameSource(left: HeadlessWorkflowSource, right: HeadlessWorkflowSource) {
  return left.kind === right.kind && left.sourceId === right.sourceId &&
    (left.kind === "approved-release" && right.kind === "approved-release" ? left.sourceDigest === right.sourceDigest :
      left.kind === "reviewed-execution-plan" && right.kind === "reviewed-execution-plan" && left.sourceRevision === right.sourceRevision);
}

/** Passive exact-target projection. The optional session grant is trusted composition, never reply data. */
export function readHeadlessWorkflowReadResult(raw: unknown, request: HeadlessReadRequest,
  options: {readonly allowApprovedSessionIds?: boolean} = {}): HeadlessReadResult {
  try {
    if (!isHeadlessWorkflowReadOperation(request.operation)) return unavailable;
    const result = readStrictPassiveRecord(copyBoundedPassiveData(raw), ["ok", "operation", "value"]);
    if (result.ok !== true || result.operation !== request.operation) return unavailable;
    if (request.operation === "workflows.list") {
      const rows = array(result.value, 64, profile);
      if (rows.some(row => row.source.kind !== request.input.sourceKind)) return unavailable;
      return {ok: true, operation: request.operation, value: rows};
    }
    if (request.operation === "workflows.prepare") {
      const value = readStrictPassiveRecord(result.value, ["profile", "snapshotRevision", "actions", "approvedSessionIds"]);
      const selected = profile(value.profile);
      if (selected.profileId !== request.input.profileId || !sameSource(selected.source, request.input.source)) return unavailable;
      const allowed: readonly string[] = profiles[selected.profileId as keyof typeof profiles].actions;
      const actions = array(value.actions, 32, item => {
        const action = readStrictPassiveRecord(item, ["actionId", "intent", "enabled", "requiresConfirmation", "fields"]);
        const actionId = id(action.actionId);
        if (!allowed.includes(actionId) || action.intent !== "read" || action.requiresConfirmation !== false || typeof action.enabled !== "boolean") invalid();
        return {actionId, intent: "read" as const, enabled: action.enabled, requiresConfirmation: false as const,
          fields: array(action.fields, 16, field)};
      });
      let approvedSessionIds: string[] | undefined;
      if (value.approvedSessionIds !== undefined) {
        if (options.allowApprovedSessionIds !== true || selected.profileId !== "builtin.workflow.conversation@1.0.0" ||
            selected.source.kind !== "reviewed-execution-plan") return unavailable;
        approvedSessionIds = array(value.approvedSessionIds, 100, id);
        if (new Set(approvedSessionIds).size !== approvedSessionIds.length) return unavailable;
      }
      return {ok: true, operation: request.operation, value: {profile: selected, snapshotRevision: id(value.snapshotRevision), actions,
        ...(approvedSessionIds === undefined ? {} : {approvedSessionIds})}};
    }
    if (request.operation === "conversation-tasks.read") {
      const value = readStrictPassiveRecord(result.value, ["sessionId", "turnId", "turnStatus", "run"]);
      const sessionId = id(value.sessionId), turnId = id(value.turnId);
      if (sessionId !== request.input.sessionId || turnId !== request.input.turnId || typeof value.turnStatus !== "string" ||
          normalizeConversationTurnStatus(value.turnStatus) !== value.turnStatus) return unavailable;
      let run: {runId: string; status: import("../execution-runs").ExecutionRunStatus} | null = null;
      if (value.run !== null) {
        const record = readStrictPassiveRecord(value.run, ["runId", "status"]);
        if (typeof record.status !== "string" || !isExecutionRunStatus(record.status)) return unavailable;
        run = {runId: id(record.runId), status: record.status};
      }
      return {ok: true, operation: request.operation, value: {sessionId, turnId,
        turnStatus: normalizeConversationTurnStatus(value.turnStatus), run}};
    }
    return unavailable;
  } catch {return unavailable;}
}
