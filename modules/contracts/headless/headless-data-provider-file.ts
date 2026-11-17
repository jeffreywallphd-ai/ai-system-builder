import {
  INGESTION_TASK_CHECKPOINT_RETENTION_MS,
  normalizeIngestionTaskRecord,
  type IngestionTaskRecord,
} from "../ingestion";
import { copyBoundedPassiveData, readStrictPassiveRecord } from "../shared";
import {
  readHeadlessLocalFileImportRequest,
  type HeadlessLocalFileImportRequest,
  type HeadlessLocalFileImportResult,
} from "./headless-data-local-file";
import { HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId } from "./headless-read-request";

export const HEADLESS_PROVIDER_FILE_PREVIEW_PATH = "/aisb-headless/v1/data/provider-file-preview";
export const MANAGED_HEADLESS_PROVIDER_FILE_PREVIEW_PATH = "/api/headless/agent/data/provider-file-preview";

type FileTarget = HeadlessLocalFileImportRequest["input"];

export interface HeadlessProviderFileImportRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.prepare-provider-file";
  readonly input: FileTarget;
}

export type HeadlessProviderFileImportPreview = Omit<FileTarget, "hostIncarnationId"> & {
  readonly provider: "huggingface";
  readonly providerRevision: string;
  readonly mediaType: "application/vnd.apache.parquet";
  readonly selectionExpiresAt: number;
  readonly approvalRequired: true;
  readonly externalProviderCalls: 0;
};

type PreviewError = Extract<HeadlessLocalFileImportResult, { readonly ok: false }>;
export type HeadlessProviderFileImportResult =
  | { readonly ok: true; readonly value: HeadlessProviderFileImportPreview }
  | PreviewError;

const invalid = { ok: false, code: "headless.invalid-request" } as const;
const denied = { ok: false, code: "headless.forbidden" } as const;
const stale = { ok: false, code: "headless.stale" } as const;
const notReady = { ok: false, code: "headless.source-not-ready" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const previewErrors = ["headless.invalid-request", "headless.host-changed", "headless.forbidden",
  "headless.stale", "headless.source-not-ready", "headless.unavailable"] as const;
const fullRevision = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const parquet = "application/vnd.apache.parquet";

export function readHeadlessProviderFileImportRequest(value: unknown, currentHost: HeadlessHostIncarnationId):
  { readonly ok: true; readonly request: HeadlessProviderFileImportRequest } |
  typeof invalid | { readonly ok: false; readonly code: "headless.host-changed" } {
  try {
    const { version, operation, input } = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (version !== HEADLESS_CONTRACT_VERSION || operation !== "data.prepare-provider-file") return invalid;
    const target = readHeadlessLocalFileImportRequest({ version, operation: "data.prepare-local-file", input }, currentHost);
    return target.ok ? { ok: true, request: { version, operation, input: target.request.input } } : target;
  } catch { return invalid; }
}

/** Rebuild the finite tool reply. Private repository names, paths and file contents never cross it. */
export function readHeadlessProviderFileImportResult(value: unknown, expected: FileTarget): HeadlessProviderFileImportResult {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["ok", "code", "value"]);
    if (raw.ok === false && !("value" in raw) && previewErrors.includes(raw.code as PreviewError["code"]))
      return { ok: false, code: raw.code as PreviewError["code"] };
    if (raw.ok !== true || "code" in raw) return unavailable;
    const { workspaceId, taskId, fileId, taskRevision, provider, providerRevision, mediaType, selectionExpiresAt,
      approvalRequired, externalProviderCalls } = readStrictPassiveRecord(raw.value, [
        "workspaceId", "taskId", "fileId", "taskRevision", "provider", "providerRevision", "mediaType",
        "selectionExpiresAt", "approvalRequired", "externalProviderCalls",
      ]);
    if (workspaceId !== expected.workspaceId || taskId !== expected.taskId || fileId !== expected.fileId ||
        taskRevision !== expected.taskRevision || provider !== "huggingface" ||
        typeof providerRevision !== "string" || !fullRevision.test(providerRevision) || mediaType !== parquet ||
        typeof selectionExpiresAt !== "number" || !Number.isSafeInteger(selectionExpiresAt) || selectionExpiresAt < 1 ||
        approvalRequired !== true || externalProviderCalls !== 0) return unavailable;
    return { ok: true, value: { workspaceId: expected.workspaceId, taskId: expected.taskId, fileId: expected.fileId,
      taskRevision: expected.taskRevision, provider, providerRevision, mediaType, selectionExpiresAt,
      approvalRequired, externalProviderCalls } };
  } catch { return unavailable; }
}

/** Inspect an app-staged repository choice. Provider verification and import are different operations. */
export function projectHeadlessProviderFileImport(
  source: IngestionTaskRecord,
  input: Omit<FileTarget, "hostIncarnationId">,
  now: number,
): HeadlessProviderFileImportResult {
  try {
    if (source.taskId !== input.taskId || source.workspaceId !== input.workspaceId) return denied;
    const task = normalizeIngestionTaskRecord(source);
    if (task.revision !== input.taskRevision) return stale;
    const file = task.files[0];
    if (task.files.length !== 1 || file?.fileId !== input.fileId) return denied;
    const locator = file.providerSource;
    const createdAt = Date.parse(task.createdAt);
    const selectionExpiresAt = createdAt + INGESTION_TASK_CHECKPOINT_RETENTION_MS;
    if (task.kind !== "hugging-face" || task.status !== "queued" || file.status !== "pending" ||
        file.acceptedBytes !== 0 || file.totalBytes !== 0 || file.nextChunkIndex !== 0 ||
        locator?.provider !== "huggingface" || !fullRevision.test(locator.revision) ||
        !locator.path.toLowerCase().endsWith(".parquet") || file.mediaType !== parquet ||
        !Number.isSafeInteger(now) || !Number.isSafeInteger(selectionExpiresAt) ||
        createdAt < 1 || now < createdAt || now >= selectionExpiresAt) return notReady;
    return { ok: true, value: { workspaceId: task.workspaceId, taskId: task.taskId, fileId: file.fileId,
      taskRevision: task.revision, provider: locator.provider, providerRevision: locator.revision, mediaType: parquet,
      selectionExpiresAt, approvalRequired: true, externalProviderCalls: 0 } };
  } catch { return notReady; }
}
