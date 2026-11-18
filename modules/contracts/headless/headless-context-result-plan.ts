import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {CONTEXT_GENERATION_LIMITS, normalizeContextSaveName} from "../context-management";
import {HEADLESS_CONTEXT_MAX_SOURCES} from "./headless-context-preview";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export interface HeadlessContextResultSavePlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "context.save-result";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly idempotencyKey: string; readonly taskId: string; readonly reportFingerprint: string; readonly name: string};
}
export interface HeadlessSavedContextReference {
  readonly workspaceId: WorkspaceId;
  readonly contextId: string;
  readonly taskId: string;
  readonly kind: "rag-database" | "markdown-context-pack";
  readonly artifactDigest: string;
}
export interface HeadlessContextSavedRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "context.saved";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId; readonly contextId: string};
}
export interface HeadlessContextSavedValue {
  readonly reference: HeadlessSavedContextReference;
  readonly name: string;
  readonly sizeBytes: number;
  readonly sourceCount: number;
  readonly chunkCount: number;
  readonly byteAvailability: "not-checked";
}
const isDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const isName = (value: unknown): value is string => typeof value === "string" && value === value.trim() && value.length > 0 &&
  value.length <= 160 && !hasKnownPassiveCredential(value) && normalizeContextSaveName(value) === value;
const bounded = (value: unknown, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max;

export function readHeadlessContextResultSavePlanRequest(value: unknown, host: HeadlessHostIncarnationId):
  {readonly ok: true; readonly request: HeadlessContextResultSavePlanRequest} |
  {readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed"} {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "context.save-result") return invalid;
    const {hostIncarnationId, workspaceId, idempotencyKey, taskId, reportFingerprint, name} = readStrictPassiveRecord(outer.input,
      ["hostIncarnationId", "workspaceId", "idempotencyKey", "taskId", "reportFingerprint", "name"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) ||
        !isHeadlessHostIncarnationId(idempotencyKey) || !isHeadlessHostIncarnationId(taskId) || !isName(name) ||
        typeof reportFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(reportFingerprint)) return invalid;
    if (hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"};
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "context.save-result",
      input: {hostIncarnationId, workspaceId, idempotencyKey, taskId, reportFingerprint, name}}};
  } catch {return invalid;}
}
export function readHeadlessSavedContextReference(value: unknown, workspaceId: WorkspaceId, expectedTaskId?: string): HeadlessSavedContextReference | undefined {
  try {
    const row = readStrictPassiveRecord(copyBoundedPassiveData(value), ["workspaceId", "contextId", "taskId", "kind", "artifactDigest"]);
    if (row.workspaceId !== workspaceId || !isHeadlessHostIncarnationId(row.contextId) || !isHeadlessHostIncarnationId(row.taskId) ||
        (expectedTaskId !== undefined && row.taskId !== expectedTaskId) ||
        (row.kind !== "rag-database" && row.kind !== "markdown-context-pack") || !isDigest(row.artifactDigest)) return;
    return {workspaceId, contextId: row.contextId, taskId: row.taskId, kind: row.kind, artifactDigest: row.artifactDigest};
  } catch {return;}
}
export function readHeadlessContextSavedRequest(value: unknown, host: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "context.saved") return invalid;
    const {hostIncarnationId, workspaceId, contextId} = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "contextId"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) || !isHeadlessHostIncarnationId(contextId)) return invalid;
    if (hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "context.saved",
      input: {hostIncarnationId, workspaceId, contextId}} satisfies HeadlessContextSavedRequest} as const;
  } catch {return invalid;}
}
export function readHeadlessContextSavedValue(value: unknown, workspaceId: WorkspaceId, contextId: string): HeadlessContextSavedValue | undefined {
  try {
    const row = readStrictPassiveRecord(copyBoundedPassiveData(value), ["reference", "name", "sizeBytes", "sourceCount", "chunkCount", "byteAvailability"]);
    const reference = readHeadlessSavedContextReference(row.reference, workspaceId);
    if (!reference || reference.contextId !== contextId || !isName(row.name) ||
        !bounded(row.sizeBytes, CONTEXT_GENERATION_LIMITS.maximumArtifactBytes) || !bounded(row.sourceCount, HEADLESS_CONTEXT_MAX_SOURCES) ||
        !bounded(row.chunkCount, 1000) || row.byteAvailability !== "not-checked") return;
    return {reference, name: row.name, sizeBytes: row.sizeBytes, sourceCount: row.sourceCount, chunkCount: row.chunkCount, byteAvailability: "not-checked"};
  } catch {return;}
}
