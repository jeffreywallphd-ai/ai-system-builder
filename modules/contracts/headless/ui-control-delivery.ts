import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import { isSystemBuilderSystemId, normalizeSystemBuilderRevisionId } from "../system-builder";
import { normalizeExecutionRunId } from "../execution-runs";
import { isUiControlId, readUiControlLeaseTarget, type UiControlLeaseTarget } from "./ui-control-authority";

export const UI_PRESENTATION_LIMITS = Object.freeze({
  queued: 32, gap: 16, receipts: 256, commandBytes: 8 * 1024, contextBytes: 4 * 1024,
  commandMs: 5_000,
});

type SystemPresentation =
  | { readonly action: "open-system" | "show-validation"; readonly systemId: string; readonly revisionId: string }
  | { readonly action: "select-component"; readonly systemId: string; readonly revisionId: string; readonly instanceId: string };

export type UiPresentationIntent = SystemPresentation
  | { readonly action: "show-run"; readonly runId: string }
  | { readonly action: "show-artifact"; readonly artifactId: string };

export type UiPresentationSubmission = {
  readonly target: UiControlLeaseTarget;
  readonly commandId: string;
  readonly intent: UiPresentationIntent;
};

export type UiPresentationDelivery = UiPresentationSubmission & {
  readonly sequence: number;
  readonly remainingMs: number;
};

export type UiPresentationOutcome = "applied" | "rejected" | "discarded";
export type UiPresentationReceipt = {
  readonly commandId: string;
  readonly sequence: number;
  readonly status: "accepted" | "delivered" | "unconfirmed" | UiPresentationOutcome;
};

export type UiPresentationPullResult =
  | { readonly status: "command"; readonly command: UiPresentationDelivery; readonly detail: UiPresentationDetail }
  | { readonly status: "terminal"; readonly receipt: UiPresentationReceipt }
  | { readonly status: "empty" | "unavailable" };

/** Interactive-only display data. Never part of the connector's context. */
export type UiPresentationDetail = { readonly title: string; readonly summary?: string };

export function readUiPresentationDetail(raw: unknown): UiPresentationDetail | undefined {
  try {
    const { title, summary } = readStrictPassiveRecord(raw, ["title", "summary"]);
    const valid = (value: unknown, max: number): value is string =>
      typeof value === "string" && value.trim().length > 0 && value.length <= max &&
      !/[\x00-\x1f\x7f]/.test(value) && !hasKnownPassiveCredential(value);
    if (!valid(title, 200) || (summary !== undefined && !valid(summary, 320))) return;
    return { title, ...(summary ? { summary } : {}) };
  } catch { return undefined; }
}

function isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= UI_PRESENTATION_LIMITS.receipts;
}

export function readUiPresentationReceipt(raw: unknown): UiPresentationReceipt | undefined {
  try {
    const { sequence, commandId, status } = readStrictPassiveRecord(raw, ["sequence", "commandId", "status"]);
    if (!isSequence(sequence) || !isUiControlId(commandId)) return;
    if (status === "accepted" || status === "delivered" || status === "unconfirmed" ||
        status === "applied" || status === "rejected" || status === "discarded") return { sequence, commandId, status };
  } catch { return undefined; }
}

export function readUiPresentationPull(raw: unknown) {
  try {
    const { target: rawTarget, sequence } = readStrictPassiveRecord(raw, ["target", "sequence"]);
    const target = readUiControlLeaseTarget(rawTarget);
    if (target && isSequence(sequence)) return { target, sequence };
  } catch { return undefined; }
}

export function readUiPresentationPullResult(raw: unknown): UiPresentationPullResult {
  try {
    const row = readStrictPassiveRecord(raw, ["status", "command", "receipt", "detail"]);
    if ((row.status === "empty" || row.status === "unavailable") && Object.keys(row).length === 1) return { status: row.status };
    if (row.status === "command") {
      const command = readUiPresentationDelivery(row.command);
      const detail = readUiPresentationDetail(row.detail);
      if (Object.keys(row).length === 3 && command && detail) return { status: "command", command, detail };
    }
    if (row.status === "terminal") {
      const receipt = readUiPresentationReceipt(row.receipt);
      if (Object.keys(row).length === 2 && receipt && receipt.status !== "accepted" && receipt.status !== "delivered")
        return { status: "terminal", receipt };
    }
  } catch { /* Failed observation cannot imply a command or a receipt. */ }
  return { status: "unavailable" };
}

export function readUiPresentationAcknowledgment(raw: unknown) {
  try {
    const { target: rawTarget, receipt: rawReceipt } = readStrictPassiveRecord(raw, ["target", "receipt"]);
    const target = readUiControlLeaseTarget(rawTarget);
    const receipt = readUiPresentationReceipt(rawReceipt);
    if (target && receipt && (receipt.status === "applied" || receipt.status === "rejected" || receipt.status === "discarded")) {
      return { target, receipt: { ...receipt, status: receipt.status } };
    }
  } catch { return undefined; }
}

export function readUiPresentationPublication(raw: unknown) {
  try {
    const { target: rawTarget, context: rawContext, challenge } = readStrictPassiveRecord(raw, ["target", "context", "challenge"]);
    const target = readUiControlLeaseTarget(rawTarget);
    const context = readUiPresentationContext(rawContext);
    if (target && context && isUiControlId(challenge)) return { target, context, challenge };
  } catch { return undefined; }
}

export type UiPresentationContext = {
  readonly view: "system" | "component" | "run" | "artifact" | "validation" | "other";
  readonly ready: boolean;
  readonly dirtyNavigationBlocked: boolean;
  readonly selection?: UiPresentationIntent;
};

const contextSelection = {
  "open-system": "system",
  "select-component": "component",
  "show-run": "run",
  "show-artifact": "artifact",
  "show-validation": "validation",
} as const;

export function readUiPresentationContext(raw: unknown): UiPresentationContext | undefined {
  try {
    const row = readStrictPassiveRecord(raw, ["view", "ready", "dirtyNavigationBlocked", "selection"]);
    const { view, ready, dirtyNavigationBlocked } = row;
    if (typeof ready !== "boolean" || typeof dirtyNavigationBlocked !== "boolean") return;
    if (view !== "system" && view !== "component" && view !== "run" && view !== "artifact" &&
        view !== "validation" && view !== "other") return;
    if (!("selection" in row)) return { view, ready, dirtyNavigationBlocked };
    const selection = readUiPresentationIntent(row.selection);
    if (!selection || !ready || contextSelection[selection.action] !== view) return;
    return { view, ready, dirtyNavigationBlocked, selection };
  } catch { return undefined; }
}

function isResourceId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && !value.includes("..") && !hasKnownPassiveCredential(value);
}

/** Artifact IDs are scoped catalog keys. They are never interpreted as file paths. */
function isArtifactCatalogId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && !value.includes("..") &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*(?:[/][A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(value) &&
    !hasKnownPassiveCredential(value);
}

export function sameUiControlLease(left: UiControlLeaseTarget, right: UiControlLeaseTarget): boolean {
  return left.hostIncarnationId === right.hostIncarnationId && left.windowId === right.windowId &&
    left.uiIncarnationId === right.uiIncarnationId && left.workspaceId === right.workspaceId &&
    left.requestId === right.requestId && left.attemptId === right.attemptId &&
    left.leaseId === right.leaseId && left.generation === right.generation;
}

export function readUiPresentationIntent(raw: unknown): UiPresentationIntent | undefined {
  try {
    const row = readStrictPassiveRecord(raw, ["action", "systemId", "revisionId", "instanceId", "runId", "artifactId"]);
    const { action, systemId, revisionId, instanceId, runId, artifactId } = row;
    const keys = Object.keys(row).length;
    switch (action) {
      case "open-system":
      case "show-validation":
        if (keys === 3 && isResourceId(systemId) && isSystemBuilderSystemId(systemId) &&
            isResourceId(revisionId) && normalizeSystemBuilderRevisionId(revisionId) === revisionId) {
          return { action, systemId, revisionId };
        }
        break;
      case "select-component":
        if (keys === 4 && isResourceId(systemId) && isSystemBuilderSystemId(systemId) &&
            isResourceId(revisionId) && normalizeSystemBuilderRevisionId(revisionId) === revisionId &&
            isResourceId(instanceId)) return { action, systemId, revisionId, instanceId };
        break;
      case "show-run":
        if (keys === 2 && isResourceId(runId) && normalizeExecutionRunId(runId) === runId) return { action, runId };
        break;
      case "show-artifact":
        if (keys === 2 && isArtifactCatalogId(artifactId)) return { action, artifactId };
        break;
    }
  } catch { return undefined; }
}

function readSubmission(row: Record<string, unknown>): UiPresentationSubmission | undefined {
  const target = readUiControlLeaseTarget(row.target);
  const intent = readUiPresentationIntent(row.intent);
  if (target && intent && isUiControlId(row.commandId)) return { target, commandId: row.commandId, intent };
}

export function readUiPresentationSubmission(value: unknown): UiPresentationSubmission | undefined {
  try { return readSubmission(readStrictPassiveRecord(value, ["target", "commandId", "intent"])); }
  catch { return undefined; }
}

export function readUiPresentationDelivery(value: unknown): UiPresentationDelivery | undefined {
  try {
    const row = readStrictPassiveRecord(value, ["target", "commandId", "intent", "sequence", "remainingMs"]);
    const submission = readSubmission(row);
    const { sequence, remainingMs } = row;
    if (!submission || !isSequence(sequence) || typeof remainingMs !== "number" ||
        !Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > UI_PRESENTATION_LIMITS.commandMs) return;
    return { ...submission, sequence, remainingMs };
  } catch { return undefined; }
}
