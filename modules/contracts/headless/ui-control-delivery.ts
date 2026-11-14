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
    if (!submission || typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence <= 0 ||
        sequence > UI_PRESENTATION_LIMITS.receipts || typeof remainingMs !== "number" ||
        !Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > UI_PRESENTATION_LIMITS.commandMs) return;
    return { ...submission, sequence, remainingMs };
  } catch { return undefined; }
}
