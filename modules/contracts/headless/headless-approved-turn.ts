import { normalizeConversationSessionId, normalizeConversationTurnId } from "../conversations";
import { normalizeExecutionRunId } from "../execution-runs";
import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, isHeadlessWorkflowId, type HeadlessHostIncarnationId } from "./headless-read-request";

export const HEADLESS_APPROVED_TURN_OPERATION = "conversation.send-approved-turn";
export const HEADLESS_APPROVED_TURN_PATH = "/aisb-headless/v1/conversation";

export type HeadlessApprovedTurnInput = {
  readonly workspaceId: WorkspaceId;
  readonly planId: string;
  readonly planRevision: string;
  readonly sessionId: string;
  readonly snapshotRevision: string;
  readonly key: string;
  readonly text: string;
};

export type HeadlessApprovedTurnRequest = {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: typeof HEADLESS_APPROVED_TURN_OPERATION;
  readonly input: HeadlessApprovedTurnInput & { readonly hostIncarnationId: HeadlessHostIncarnationId };
};

const failureCodes = [
  "headless.invalid-request", "headless.unsupported-version", "headless.host-changed", "headless.forbidden",
  "headless.not-found", "headless.unavailable", "headless.operation-unconfirmed", "headless.idempotency-conflict",
  "headless.idempotency-expired", "headless.operation-capacity",
] as const;
const failures = new Set<string>(failureCodes);
type Failure = { readonly ok: false; readonly code: (typeof failureCodes)[number] };
export type HeadlessApprovedTurnResult = Failure | {
  readonly ok: true;
  readonly value: { readonly turnId: string; readonly runId: string };
};
const invalid = { ok: false, code: "headless.invalid-request" } as const;
const unconfirmed = { ok: false, code: "headless.operation-unconfirmed" } as const;

const targetKeys = ["workspaceId", "planId", "planRevision", "sessionId", "snapshotRevision", "key", "text"] as const;

function safeId(value: unknown): value is string {
  return isHeadlessWorkflowId(value) && !hasKnownPassiveCredential(value);
}

function readTarget(value: Record<string, unknown>): HeadlessApprovedTurnInput | undefined {
  const { workspaceId, planId, planRevision, sessionId, snapshotRevision, key, text } = value;
  if (!isWorkspaceId(workspaceId) || !safeId(planId) || !safeId(planRevision) || !safeId(sessionId) ||
      normalizeConversationSessionId(sessionId) !== sessionId || !safeId(snapshotRevision) ||
      !isHeadlessHostIncarnationId(key) || typeof text !== "string" || text.length > 2_000 ||
      !text.trim() || hasKnownPassiveCredential(text)) return undefined;
  return { workspaceId, planId, planRevision, sessionId, snapshotRevision, key, text };
}

export function parseHeadlessApprovedTurnRequest(value: unknown, expectedHost?: HeadlessHostIncarnationId):
  Failure | { readonly ok: true; readonly request: HeadlessApprovedTurnRequest } {
  try {
    const { version, operation, input } = readStrictPassiveRecord(value, ["version", "operation", "input"]);
    if (version !== HEADLESS_CONTRACT_VERSION) {
      return typeof version === "string" ? { ok: false, code: "headless.unsupported-version" } : invalid;
    }
    if (operation !== HEADLESS_APPROVED_TURN_OPERATION) return invalid;
    const raw = readStrictPassiveRecord(input, ["hostIncarnationId", ...targetKeys]);
    const { hostIncarnationId } = raw;
    const target = readTarget(raw);
    if (!isHeadlessHostIncarnationId(hostIncarnationId) || !target) return invalid;
    if (expectedHost !== undefined && hostIncarnationId !== expectedHost) return { ok: false, code: "headless.host-changed" };
    return { ok: true, request: { version, operation, input: { hostIncarnationId, ...target } } };
  } catch { return invalid; }
}

/** Only a closed error or the saved turn/run identifiers can cross this boundary. */
export function readHeadlessApprovedTurnResult(raw: unknown): HeadlessApprovedTurnResult {
  try {
    const envelope = readStrictPassiveRecord(raw, ["ok", "code", "value"]);
    const { ok, code, value } = envelope;
    if (ok === false && !("value" in envelope) && typeof code === "string" && failures.has(code)) {
      return { ok: false, code: code as Failure["code"] };
    }
    if (ok !== true || "code" in envelope) return unconfirmed;
    const { turnId, runId } = readStrictPassiveRecord(value, ["turnId", "runId"]);
    if (!safeId(turnId) || normalizeConversationTurnId(turnId) !== turnId ||
        !safeId(runId) || normalizeExecutionRunId(runId) !== runId) return unconfirmed;
    return { ok: true, value: { turnId, runId } };
  } catch { return unconfirmed; }
}
