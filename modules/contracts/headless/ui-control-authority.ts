import { readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { isHeadlessHostIncarnationId, type HeadlessHostIncarnationId } from "./headless-read-request";

export const UI_CONTROL_VERSION = "aisb-window-control-v1";
export const UI_PRESENTATION_ACTIONS = Object.freeze([
  "open-system", "select-component", "show-run", "show-artifact", "show-validation",
] as const);
export type UiPresentationAction = (typeof UI_PRESENTATION_ACTIONS)[number];

export type UiControlWindowTarget = {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly windowId: string;
  readonly uiIncarnationId: string;
  readonly workspaceId: WorkspaceId;
};

export type UiControlAttempt = UiControlWindowTarget & {
  readonly requestId: string;
  readonly attemptId: string;
};

export type UiControlLeaseTarget = UiControlAttempt & {
  readonly leaseId: string;
  readonly generation: number;
};

export type UiControlRequest = {
  readonly version: typeof UI_CONTROL_VERSION;
  readonly target: UiControlWindowTarget;
  readonly taskId: string;
  readonly requestKey: string;
};

export type UiControlRequestStatus =
  "pending" | "awaiting-readiness" | "active" | "ended";

export type UiControlRequestView = {
  readonly target: UiControlAttempt;
  readonly agentSessionId: string;
  readonly taskId: string;
  readonly status: UiControlRequestStatus;
  readonly expiresAt: number;
};

export type UiControlLease = {
  readonly target: UiControlLeaseTarget;
  readonly actions: readonly UiPresentationAction[];
  readonly context: "resource-identifiers";
  readonly expiresAt: number;
};

const windowFields = ["hostIncarnationId", "windowId", "uiIncarnationId", "workspaceId"];
const attemptFields = [...windowFields, "requestId", "attemptId"];
const leaseFields = [...attemptFields, "leaseId", "generation"];

export function isUiControlId(value: unknown): value is string {
  return isHeadlessHostIncarnationId(value);
}

function readWindow(row: Record<string, unknown>): UiControlWindowTarget | undefined {
  const { hostIncarnationId, windowId, uiIncarnationId, workspaceId } = row;
  if (!isHeadlessHostIncarnationId(hostIncarnationId) || !isUiControlId(windowId) ||
      !isUiControlId(uiIncarnationId) || !isWorkspaceId(workspaceId)) return;
  return { hostIncarnationId, windowId, uiIncarnationId, workspaceId };
}

function readAttempt(row: Record<string, unknown>): UiControlAttempt | undefined {
  const target = readWindow(row);
  const { requestId, attemptId } = row;
  if (!target || !isUiControlId(requestId) || !isUiControlId(attemptId)) return;
  return { ...target, requestId, attemptId };
}

function readLease(row: Record<string, unknown>): UiControlLeaseTarget | undefined {
  const target = readAttempt(row);
  const { leaseId, generation } = row;
  if (!target || !isUiControlId(leaseId) || typeof generation !== "number" ||
      !Number.isSafeInteger(generation) || generation <= 0) return;
  return { ...target, leaseId, generation };
}

export function readUiControlWindow(value: unknown): UiControlWindowTarget | undefined {
  try { return readWindow(readStrictPassiveRecord(value, windowFields)); }
  catch { return undefined; }
}

export function readUiControlRequest(value: unknown): UiControlRequest | undefined {
  try {
    const { version, target: rawTarget, taskId, requestKey } = readStrictPassiveRecord(value, ["version", "target", "taskId", "requestKey"]);
    const target = readUiControlWindow(rawTarget);
    if (version !== UI_CONTROL_VERSION || !target || !isUiControlId(taskId) || !isUiControlId(requestKey)) return;
    return { version, target, taskId, requestKey };
  } catch { return undefined; }
}

export function readUiControlAttempt(value: unknown): UiControlAttempt | undefined {
  try { return readAttempt(readStrictPassiveRecord(value, attemptFields)); }
  catch { return undefined; }
}

export function readUiControlLeaseTarget(value: unknown): UiControlLeaseTarget | undefined {
  try { return readLease(readStrictPassiveRecord(value, leaseFields)); }
  catch { return undefined; }
}

/** A cancel issued before a lease reply has both attempt keys and neither lease field. */
export function readUiControlRevoke(value: unknown): UiControlAttempt | UiControlLeaseTarget | undefined {
  try {
    const row = readStrictPassiveRecord(value, leaseFields);
    return "leaseId" in row || "generation" in row ? readLease(row) : readAttempt(row);
  } catch { return undefined; }
}
