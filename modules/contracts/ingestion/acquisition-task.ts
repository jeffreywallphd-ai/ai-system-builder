import { createOrganizationId, type OrganizationId } from "../organization";
import { createWorkspaceId, type WorkspaceId } from "../workspace";

export const INGESTION_TASK_SCHEMA_VERSION = "1.0" as const;
export const INGESTION_TASK_MAXIMUM_FILES = 128;
export const INGESTION_TASK_MAXIMUM_FILE_BYTES = 4 * 1024 * 1024 * 1024;
export const INGESTION_TASK_MAXIMUM_TOTAL_BYTES = 16 * 1024 * 1024 * 1024;
export const INGESTION_TASK_MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
export const INGESTION_TASK_RECOMMENDED_CHUNK_BYTES = 1024 * 1024;
export const INGESTION_TASK_MAXIMUM_CHUNKS = 65_536;
export const INGESTION_TASK_LIST_LIMIT = 100;
export const INGESTION_TASK_CHECKPOINT_RETENTION_MS = 24 * 60 * 60 * 1000;

export type IngestionTaskId = string & { readonly __ingestionTaskId: unique symbol };
export type IngestionTaskFileId = string & { readonly __ingestionTaskFileId: unique symbol };
export type IngestionSha256Digest = `sha256:${string}`;

export type IngestionTaskKind = "file-batch" | "hugging-face" | "website";
export type IngestionTaskStatus = "queued" | "transferring" | "finalizing" | "succeeded" | "failed" | "cancelled";
export type IngestionTaskFileStatus = "pending" | "transferring" | "finalized" | "failed" | "cancelled";

export interface IngestionTaskLastChunk {
  readonly index: number;
  readonly sizeBytes: number;
  readonly digest: IngestionSha256Digest;
}

export interface IngestionTaskOutputArtifact {
  readonly key: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest?: IngestionSha256Digest;
  readonly providerRevision?: string;
  readonly sourceId?: string;
  readonly sourceSnapshotId?: string;
  readonly derivedArtifactKeys?: readonly string[];
}

export interface IngestionTaskProviderSource {
  readonly provider: "huggingface";
  readonly repository: string;
  readonly path: string;
  readonly revision: string;
}

export interface IngestionTaskWebsiteSource {
  readonly requestedUrl: string;
}

export interface IngestionTaskFileRecord {
  readonly fileId: IngestionTaskFileId;
  readonly checkpointId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly totalBytes: number;
  readonly status: IngestionTaskFileStatus;
  readonly acceptedBytes: number;
  readonly nextChunkIndex: number;
  readonly providerSource?: IngestionTaskProviderSource;
  readonly websiteSource?: IngestionTaskWebsiteSource;
  readonly lastChunk?: IngestionTaskLastChunk;
  readonly output?: IngestionTaskOutputArtifact;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export interface IngestionTaskProgress {
  readonly acceptedBytes: number;
  readonly totalBytes: number;
  readonly completedItems: number;
  readonly totalItems: number;
  readonly percent: number;
  readonly message?: string;
}

export interface IngestionTaskRecord {
  readonly schemaVersion: typeof INGESTION_TASK_SCHEMA_VERSION;
  readonly taskId: IngestionTaskId;
  readonly organizationId?: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly kind: IngestionTaskKind;
  readonly status: IngestionTaskStatus;
  readonly files: readonly IngestionTaskFileRecord[];
  readonly progress: IngestionTaskProgress;
  readonly revision: number;
  readonly cleanupPending: boolean;
  readonly checkpointExpiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MEDIA_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function normalizeIngestionTaskId(value: string): IngestionTaskId {
  return normalizeId(value, "Ingestion task id") as IngestionTaskId;
}

export function normalizeIngestionTaskFileId(value: string): IngestionTaskFileId {
  return normalizeId(value, "Ingestion task file id") as IngestionTaskFileId;
}

export function normalizeIngestionSha256Digest(value: string): IngestionSha256Digest {
  const normalized = value.trim().toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) throw new Error("Ingestion digest must be a canonical SHA-256 value.");
  return normalized as IngestionSha256Digest;
}

export function normalizeIngestionTaskRecord(value: IngestionTaskRecord): IngestionTaskRecord {
  if (value.schemaVersion !== INGESTION_TASK_SCHEMA_VERSION) throw new Error("Unsupported ingestion task schema version.");
  if (!(["file-batch", "hugging-face", "website"] as const).includes(value.kind)) throw new Error("Unsupported ingestion task kind.");
  if (!(["queued", "transferring", "finalizing", "succeeded", "failed", "cancelled"] as const).includes(value.status)) throw new Error("Unsupported ingestion task status.");
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > INGESTION_TASK_MAXIMUM_FILES) {
    throw new Error(`Ingestion task must include between 1 and ${INGESTION_TASK_MAXIMUM_FILES} files.`);
  }
  const files = value.files.map(normalizeFile);
  if (new Set(files.map((file) => file.fileId)).size !== files.length) throw new Error("Ingestion task file ids must be unique.");
  if (new Set(files.map((file) => file.checkpointId)).size !== files.length) throw new Error("Ingestion checkpoint ids must be unique.");
  const totalBytes = files.reduce((sum, file) => sum + file.totalBytes, 0);
  if (totalBytes > INGESTION_TASK_MAXIMUM_TOTAL_BYTES) throw new Error("Ingestion task exceeds the aggregate byte limit.");
  const acceptedBytes = files.reduce((sum, file) => sum + file.acceptedBytes, 0);
  const completedItems = files.filter((file) => file.status === "finalized").length;
  const totalChunks = files.reduce((sum, file) => sum + file.nextChunkIndex, 0);
  if (totalChunks > INGESTION_TASK_MAXIMUM_CHUNKS) throw new Error("Ingestion task exceeds the aggregate checkpoint limit.");
  const message = normalizeOptionalText(value.progress?.message, 240);
  const progress = {
    acceptedBytes,
    totalBytes,
    completedItems,
    totalItems: files.length,
    percent: totalBytes === 0
      ? Math.floor((completedItems / files.length) * 100)
      : Math.min(100, Math.floor((acceptedBytes / totalBytes) * 100)),
    ...(message ? { message } : {}),
  };
  if (value.status === "succeeded" && completedItems !== files.length) throw new Error("Succeeded ingestion tasks require every file to be finalized.");
  if (value.kind === "hugging-face" && files.some((file) => !file.providerSource)) throw new Error("Hugging Face ingestion files require exact provider coordinates.");
  if (value.kind !== "hugging-face" && files.some((file) => file.providerSource)) throw new Error("Provider coordinates are only valid for Hugging Face ingestion tasks.");
  if (value.kind === "website" && files.some((file) => !file.websiteSource)) throw new Error("Website ingestion files require an exact requested URL.");
  if (value.kind !== "website" && files.some((file) => file.websiteSource)) throw new Error("Website coordinates are only valid for website ingestion tasks.");
  if (value.status === "succeeded" && value.cleanupPending) throw new Error("Succeeded ingestion tasks cannot retain pending checkpoints.");
  if (["succeeded", "failed", "cancelled"].includes(value.status) && !value.completedAt) throw new Error("Terminal ingestion tasks require completedAt.");
  if (!["succeeded", "failed", "cancelled"].includes(value.status) && value.completedAt) throw new Error("Non-terminal ingestion tasks cannot define completedAt.");
  return {
    schemaVersion: INGESTION_TASK_SCHEMA_VERSION,
    taskId: normalizeIngestionTaskId(value.taskId),
    ...(value.organizationId ? { organizationId: createOrganizationId(value.organizationId) } : {}),
    workspaceId: createWorkspaceId(value.workspaceId),
    kind: value.kind,
    status: value.status,
    files,
    progress,
    revision: positiveInteger(value.revision, "Ingestion task revision"),
    cleanupPending: value.cleanupPending === true,
    ...(value.checkpointExpiresAt ? { checkpointExpiresAt: isoTimestamp(value.checkpointExpiresAt, "Ingestion checkpoint expiresAt") } : {}),
    createdAt: isoTimestamp(value.createdAt, "Ingestion task createdAt"),
    updatedAt: isoTimestamp(value.updatedAt, "Ingestion task updatedAt"),
    ...(value.completedAt ? { completedAt: isoTimestamp(value.completedAt, "Ingestion task completedAt") } : {}),
  };
}

function normalizeFile(value: IngestionTaskFileRecord): IngestionTaskFileRecord {
  if (!(["pending", "transferring", "finalized", "failed", "cancelled"] as const).includes(value.status)) throw new Error("Unsupported ingestion task file status.");
  const totalBytes = boundedInteger(value.totalBytes, 0, INGESTION_TASK_MAXIMUM_FILE_BYTES, "Ingestion file totalBytes");
  const acceptedBytes = boundedInteger(value.acceptedBytes, 0, totalBytes, "Ingestion file acceptedBytes");
  const nextChunkIndex = boundedInteger(value.nextChunkIndex, 0, INGESTION_TASK_MAXIMUM_CHUNKS, "Ingestion file nextChunkIndex");
  const lastChunk = value.lastChunk ? {
    index: boundedInteger(value.lastChunk.index, 0, INGESTION_TASK_MAXIMUM_CHUNKS - 1, "Last chunk index"),
    sizeBytes: boundedInteger(value.lastChunk.sizeBytes, 1, INGESTION_TASK_MAXIMUM_CHUNK_BYTES, "Last chunk sizeBytes"),
    digest: normalizeIngestionSha256Digest(value.lastChunk.digest),
  } : undefined;
  if ((nextChunkIndex === 0) !== (lastChunk === undefined)) throw new Error("Ingestion last chunk must match the next chunk index.");
  if (lastChunk && lastChunk.index !== nextChunkIndex - 1) throw new Error("Ingestion last chunk index must immediately precede nextChunkIndex.");
  if (value.status === "pending" && (acceptedBytes !== 0 || nextChunkIndex !== 0)) throw new Error("Pending ingestion files cannot have accepted chunks.");
  const output = value.output ? {
    key: normalizeStorageKey(value.output.key),
    mediaType: normalizeMediaType(value.output.mediaType),
    sizeBytes: boundedInteger(value.output.sizeBytes, 0, INGESTION_TASK_MAXIMUM_FILE_BYTES, "Output sizeBytes"),
    ...(value.output.digest ? { digest: normalizeIngestionSha256Digest(value.output.digest) } : {}),
    ...(value.output.providerRevision ? { providerRevision: requiredText(value.output.providerRevision, "Output provider revision", 160) } : {}),
    ...(value.output.sourceId ? { sourceId: normalizeId(value.output.sourceId, "Output source id") } : {}),
    ...(value.output.sourceSnapshotId ? { sourceSnapshotId: normalizeId(value.output.sourceSnapshotId, "Output source snapshot id") } : {}),
    ...(value.output.derivedArtifactKeys?.length ? { derivedArtifactKeys: uniqueStorageKeys(value.output.derivedArtifactKeys) } : {}),
  } : undefined;
  if (output && !output.digest && !output.providerRevision) throw new Error("Finalized ingestion outputs require a content digest or exact provider revision.");
  if (value.status === "finalized" && (!output || (value.websiteSource ? (acceptedBytes !== 0 || totalBytes !== 0) : (acceptedBytes !== totalBytes || output.sizeBytes !== totalBytes)))) throw new Error("Finalized ingestion files require a complete bounded output.");
  if (value.status !== "finalized" && output) throw new Error("Only finalized ingestion files may reference an output.");
  const providerSource = value.providerSource ? normalizeProviderSource(value.providerSource) : undefined;
  const websiteSource = value.websiteSource ? { requestedUrl: normalizeWebsiteUrl(value.websiteSource.requestedUrl) } : undefined;
  const error = value.error ? {
    code: normalizeId(value.error.code, "Ingestion error code"),
    message: requiredText(value.error.message, "Ingestion error message", 512),
    retryable: value.error.retryable === true,
  } : undefined;
  if ((value.status === "failed") !== Boolean(error)) throw new Error("Failed ingestion files require exactly one bounded error.");
  return {
    fileId: normalizeIngestionTaskFileId(value.fileId),
    checkpointId: normalizeId(value.checkpointId, "Ingestion checkpoint id"),
    fileName: baseName(value.fileName),
    mediaType: normalizeMediaType(value.mediaType),
    totalBytes,
    status: value.status,
    acceptedBytes,
    nextChunkIndex,
    ...(providerSource ? { providerSource } : {}),
    ...(websiteSource ? { websiteSource } : {}),
    ...(lastChunk ? { lastChunk } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {}),
  };
}

function normalizeProviderSource(value: IngestionTaskProviderSource): IngestionTaskProviderSource {
  const repository = requiredText(value.repository, "Provider repository", 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository)) throw new Error("Provider repository must use owner/name format.");
  const path = normalizeStorageKey(value.path);
  const revision = requiredText(value.revision, "Provider revision", 64).toLowerCase();
  if (!/^[a-f0-9]{7,64}$/.test(revision)) throw new Error("Provider ingestion requires an immutable commit revision.");
  if (value.provider !== "huggingface") throw new Error("Unsupported ingestion provider.");
  return { provider: "huggingface", repository, path, revision };
}

function normalizeWebsiteUrl(value: string): string {
  const parsed = new URL(requiredText(value, "Website source URL", 2048));
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) throw new Error("Website source URL must use HTTP or HTTPS without credentials.");
  parsed.hash = "";
  return parsed.toString();
}

function uniqueStorageKeys(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length > 8) throw new Error("Derived output artifact keys must be bounded.");
  const normalized = values.map(normalizeStorageKey);
  if (new Set(normalized).size !== normalized.length) throw new Error("Derived output artifact keys must be unique.");
  return normalized;
}

function normalizeId(value: string, label: string): string {
  const normalized = String(value).trim();
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label} must be a bounded opaque identifier.`);
  return normalized;
}

function baseName(value: string): string {
  const normalized = requiredText(value, "Ingestion file name", 255);
  if (/[\\/\u0000-\u001f]/.test(normalized) || normalized === "." || normalized === "..") throw new Error("Ingestion file name must not contain a path.");
  return normalized;
}

function normalizeMediaType(value: string): string {
  const normalized = requiredText(value, "Ingestion media type", 128).toLowerCase();
  if (!MEDIA_TYPE_PATTERN.test(normalized)) throw new Error("Ingestion media type is invalid.");
  return normalized;
}

function normalizeStorageKey(value: string): string {
  const normalized = requiredText(value, "Ingestion artifact key", 512).replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Ingestion artifact key must be a contained storage key.");
  return normalized;
}

function positiveInteger(value: number, label: string): number { return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, label); }
function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  return value;
}
function requiredText(value: string, label: string, maximum: number): string {
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${label} must contain 1 through ${maximum} characters.`);
  return normalized;
}
function normalizeOptionalText(value: string | undefined, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximum) throw new Error(`Ingestion progress message must not exceed ${maximum} characters.`);
  return normalized;
}
function isoTimestamp(value: string, label: string): string {
  const normalized = requiredText(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized) || Number.isNaN(Date.parse(normalized))) throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  return normalized;
}
