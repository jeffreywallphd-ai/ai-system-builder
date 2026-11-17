import {
  normalizeIngestionTaskId,
  normalizeIngestionTaskRecord,
  type IngestionTaskId,
  type IngestionTaskKind,
  type IngestionTaskRecord,
  type IngestionTaskStatus,
} from "../ingestion";
import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import {
  HEADLESS_CONTRACT_VERSION,
  isHeadlessHostIncarnationId,
  type HeadlessHostIncarnationId,
} from "./headless-read-request";

export interface HeadlessIngestionStatusRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.ingestion-status";
  readonly input: {
    readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly workspaceId: WorkspaceId;
    readonly taskId: IngestionTaskId;
  };
}

export interface HeadlessIngestionStatus {
  readonly taskId: IngestionTaskId;
  readonly state: IngestionTaskStatus;
  readonly sourceKind: IngestionTaskKind;
  readonly revision: number;
  readonly progress: {
    readonly completedItems: number;
    readonly totalItems: number;
    readonly acceptedBytes: number;
    readonly totalBytes: number;
  };
}

const invalid = { ok: false, code: "headless.invalid-request" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;

export function readHeadlessIngestionStatusRequest(
  value: unknown,
  currentHost: HeadlessHostIncarnationId,
): { readonly ok: true; readonly request: HeadlessIngestionStatusRequest } |
   typeof invalid | { readonly ok: false; readonly code: "headless.host-changed" } {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "data.ingestion-status") return invalid;
    const { hostIncarnationId, workspaceId, taskId } = readStrictPassiveRecord(
      outer.input, ["hostIncarnationId", "workspaceId", "taskId"],
    );
    if (!isHeadlessHostIncarnationId(currentHost) || !isHeadlessHostIncarnationId(hostIncarnationId) ||
        !isWorkspaceId(workspaceId) || !isExactTaskId(taskId)) return invalid;
    if (hostIncarnationId !== currentHost) return { ok: false, code: "headless.host-changed" };
    return { ok: true, request: {
      version: HEADLESS_CONTRACT_VERSION,
      operation: "data.ingestion-status",
      input: { hostIncarnationId, workspaceId, taskId },
    } };
  } catch {
    return invalid;
  }
}

/** Project after the owning host checks current access to this exact task. */
export function projectHeadlessIngestionStatus(
  task: IngestionTaskRecord,
  expected: HeadlessIngestionStatusRequest["input"],
): { readonly ok: true; readonly value: HeadlessIngestionStatus } | typeof unavailable {
  try {
    if (!isExactTaskId(task.taskId) || task.taskId !== expected.taskId || task.workspaceId !== expected.workspaceId)
      return unavailable;
    const { taskId, status, kind, revision, progress } = normalizeIngestionTaskRecord(task);
    const { completedItems, totalItems, acceptedBytes, totalBytes } = progress;
    const reported = task.progress;
    if (!reported || completedItems !== reported.completedItems || totalItems !== reported.totalItems ||
        acceptedBytes !== reported.acceptedBytes || totalBytes !== reported.totalBytes) return unavailable;
    return { ok: true, value: {
      taskId,
      state: status,
      sourceKind: kind,
      revision,
      progress: { completedItems, totalItems, acceptedBytes, totalBytes },
    } };
  } catch {
    return unavailable;
  }
}

function isExactTaskId(value: unknown): value is IngestionTaskId {
  if (typeof value !== "string" || hasKnownPassiveCredential(value)) return false;
  try { return normalizeIngestionTaskId(value) === value; }
  catch { return false; }
}
