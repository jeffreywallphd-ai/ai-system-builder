import {
  INGESTION_TASK_MAXIMUM_CHUNK_BYTES,
  INGESTION_TASK_MAXIMUM_FILE_BYTES,
  normalizeIngestionTaskFileId,
  normalizeIngestionTaskRecord,
  type IngestionTaskFileId,
  type IngestionTaskFileRecord,
  type IngestionTaskRecord,
} from "../ingestion";
import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import {
  HEADLESS_CONTRACT_VERSION,
  type HeadlessHostIncarnationId,
} from "./headless-read-request";
import { readHeadlessIngestionStatusRequest, type HeadlessIngestionStatusRequest } from "./headless-data-task-status";

type TaskTarget = HeadlessIngestionStatusRequest["input"];

export const HEADLESS_LOCAL_FILE_PREVIEW_PATH = "/aisb-headless/v1/data/local-file-preview";

export interface HeadlessLocalFileImportRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.prepare-local-file";
  readonly input: TaskTarget & {
    readonly fileId: IngestionTaskFileId;
    readonly taskRevision: number;
  };
}

export interface HeadlessLocalFileImportPreview {
  readonly workspaceId: TaskTarget["workspaceId"];
  readonly taskId: TaskTarget["taskId"];
  readonly fileId: IngestionTaskFileId;
  readonly taskRevision: number;
  readonly mediaType: string;
  readonly fileBytes: number;
  readonly checkpointExpiresAt: number;
  readonly effect: "save-local-source";
  readonly externalProviderCalls: 0;
}

const invalid = { ok: false, code: "headless.invalid-request" } as const;
const denied = { ok: false, code: "headless.forbidden" } as const;
const stale = { ok: false, code: "headless.stale" } as const;
const notReady = { ok: false, code: "headless.source-not-ready" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const previewErrors = ["headless.invalid-request", "headless.host-changed", "headless.forbidden",
  "headless.stale", "headless.source-not-ready", "headless.unavailable"] as const;
type PreviewError = typeof previewErrors[number];

export type HeadlessLocalFileImportResult =
  | { readonly ok: true; readonly value: HeadlessLocalFileImportPreview }
  | { readonly ok: false; readonly code: PreviewError };

/** Rebuild a bounded, exact response before allowing it to cross a host or connector. */
export function readHeadlessLocalFileImportResult(
  value: unknown,
  expected: HeadlessLocalFileImportRequest["input"],
): HeadlessLocalFileImportResult {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["ok", "code", "value"]);
    if (raw.ok === false && !("value" in raw) && previewErrors.includes(raw.code as PreviewError))
      return { ok: false, code: raw.code as PreviewError };
    if (raw.ok !== true || "code" in raw) return unavailable;
    const { workspaceId, taskId, fileId, taskRevision, mediaType, fileBytes, checkpointExpiresAt, effect, externalProviderCalls } =
      readStrictPassiveRecord(raw.value, ["workspaceId", "taskId", "fileId", "taskRevision", "mediaType", "fileBytes",
        "checkpointExpiresAt", "effect", "externalProviderCalls"]);
    if (workspaceId !== expected.workspaceId || taskId !== expected.taskId || fileId !== expected.fileId ||
        taskRevision !== expected.taskRevision || typeof mediaType !== "string" || mediaType.length > 128 ||
        !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mediaType) || hasKnownPassiveCredential(mediaType) ||
        typeof fileBytes !== "number" || !Number.isSafeInteger(fileBytes) || fileBytes < 0 ||
        fileBytes > INGESTION_TASK_MAXIMUM_FILE_BYTES || typeof checkpointExpiresAt !== "number" ||
        !Number.isSafeInteger(checkpointExpiresAt) || checkpointExpiresAt < 1 ||
        effect !== "save-local-source" || externalProviderCalls !== 0) return unavailable;
    return { ok: true, value: { workspaceId: expected.workspaceId, taskId: expected.taskId, fileId: expected.fileId,
      taskRevision: expected.taskRevision, mediaType, fileBytes, checkpointExpiresAt, effect, externalProviderCalls } };
  } catch { return unavailable; }
}

export function readHeadlessLocalFileImportRequest(value: unknown, currentHost: HeadlessHostIncarnationId):
  { readonly ok: true; readonly request: HeadlessLocalFileImportRequest } |
  typeof invalid | { readonly ok: false; readonly code: "headless.host-changed" } {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "data.prepare-local-file") return invalid;
    const { fileId, taskRevision, ...target } = readStrictPassiveRecord(
      outer.input, ["hostIncarnationId", "workspaceId", "taskId", "fileId", "taskRevision"],
    );
    if (!exactFileId(fileId) || typeof taskRevision !== "number" || !Number.isSafeInteger(taskRevision) || taskRevision < 1)
      return invalid;
    const parsed = readHeadlessIngestionStatusRequest(
      { version: outer.version, operation: "data.ingestion-status", input: target }, currentHost,
    );
    if (!parsed.ok) return parsed;
    return { ok: true, request: {
      version: HEADLESS_CONTRACT_VERSION,
      operation: "data.prepare-local-file",
      input: { ...parsed.request.input, fileId, taskRevision },
    } };
  } catch {
    return invalid;
  }
}

/** Inspect the verified app-owned task. The preview grants no file or write access. */
export function projectHeadlessLocalFileImport(
  source: IngestionTaskRecord,
  input: Pick<HeadlessLocalFileImportPreview, "workspaceId" | "taskId" | "fileId" | "taskRevision">,
  now: number,
): { readonly ok: true; readonly value: HeadlessLocalFileImportPreview } | typeof denied | typeof stale | typeof notReady {
  try {
    if (source.taskId !== input.taskId || source.workspaceId !== input.workspaceId) return denied;
    const task = normalizeIngestionTaskRecord(source);
    if (task.revision !== input.taskRevision) return stale;
    const file = task.files.find(candidate => candidate.fileId === input.fileId);
    if (!file) return denied;

    const deadline = task.checkpointExpiresAt ? Date.parse(task.checkpointExpiresAt) : NaN;
    if (task.kind !== "file-batch" ||
        (task.status !== "queued" && task.status !== "transferring") ||
        !Number.isSafeInteger(now) || now < 1 || !Number.isSafeInteger(deadline) || now >= deadline ||
        !hasCompleteTransfer(file) ||
        (file.status === "transferring" && task.status !== "transferring")) return notReady;

    return { ok: true, value: {
      workspaceId: task.workspaceId,
      taskId: task.taskId,
      fileId: file.fileId,
      taskRevision: task.revision,
      mediaType: file.mediaType,
      fileBytes: file.totalBytes,
      checkpointExpiresAt: deadline,
      effect: "save-local-source",
      externalProviderCalls: 0,
    } };
  } catch {
    return notReady;
  }
}

function exactFileId(value: unknown): value is IngestionTaskFileId {
  if (typeof value !== "string" || hasKnownPassiveCredential(value)) return false;
  try { return normalizeIngestionTaskFileId(value) === value; }
  catch { return false; }
}

function hasCompleteTransfer(file: IngestionTaskFileRecord): boolean {
  if (file.acceptedBytes !== file.totalBytes) return false;
  if (file.totalBytes === 0)
    return (file.status === "pending" || file.status === "transferring") && file.nextChunkIndex === 0;
  if (file.status !== "transferring" || file.nextChunkIndex < 1 || !file.lastChunk) return false;
  const remainingBytes = file.totalBytes - file.lastChunk.sizeBytes;
  const earlierChunks = file.nextChunkIndex - 1;
  return remainingBytes >= earlierChunks && remainingBytes <= earlierChunks * INGESTION_TASK_MAXIMUM_CHUNK_BYTES;
}
