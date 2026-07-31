import {
  INGESTION_TASK_MAXIMUM_CHUNK_BYTES,
  INGESTION_TASK_MAXIMUM_FILES,
  INGESTION_TASK_MAXIMUM_FILE_BYTES,
  normalizeIngestionSha256Digest,
  normalizeIngestionTaskId,
  normalizeIngestionTaskRecord,
  type IngestionTaskRecord,
} from "./acquisition-task";
import { normalizeIngestionSourceId } from "./source-snapshot";
import { normalizeIngestionSourceRefreshRecord, type IngestionSourceRefreshRecord } from "./source-snapshot";
import { normalizeGovernedWebsiteScopeRequest, type GovernedWebsiteScopeRequest } from "./governed-website-capture";

export const INGESTION_TASK_TRANSPORT_ACTIONS = [
  "create-files",
  "create-hugging-face",
  "create-website",
  "append-chunk",
  "finalize-file",
  "read",
  "list",
  "cancel",
  "resume",
  "run-hugging-face",
  "run-website",
  "refresh-website",
  "cleanup-expired",
] as const;

export type IngestionTaskTransportCommand =
  | { readonly action: "create-files"; readonly files: readonly { readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number }[] }
  | { readonly action: "create-hugging-face"; readonly files: readonly { readonly repository: string; readonly path: string; readonly revision: string; readonly mediaType?: string }[] }
  | { readonly action: "create-website"; readonly scope: GovernedWebsiteScopeRequest }
  | { readonly action: "append-chunk"; readonly taskId: string; readonly fileId: string; readonly chunkIndex: number; readonly expectedOffset: number; readonly bytes: Uint8Array; readonly sha256: string }
  | { readonly action: "finalize-file"; readonly taskId: string; readonly fileId: string; readonly sha256?: string }
  | { readonly action: "read" | "cancel" | "resume" | "run-hugging-face" | "run-website"; readonly taskId: string }
  | { readonly action: "refresh-website"; readonly sourceId: string }
  | { readonly action: "list" | "cleanup-expired" };

export type IngestionTaskTransportValue =
  | { readonly kind: "task"; readonly task: IngestionTaskRecord }
  | { readonly kind: "tasks"; readonly tasks: readonly IngestionTaskRecord[] }
  | { readonly kind: "cleanup"; readonly cleanedTaskIds: readonly string[] }
  | { readonly kind: "refresh"; readonly refresh: IngestionSourceRefreshRecord };

export function normalizeIngestionTaskTransportCommand(value: IngestionTaskTransportCommand): IngestionTaskTransportCommand {
  if (!value || typeof value !== "object" || !(INGESTION_TASK_TRANSPORT_ACTIONS as readonly string[]).includes(value.action)) throw new Error("Unsupported ingestion task action.");
  switch (value.action) {
    case "create-files":
      return { action: value.action, files: boundedFiles(value.files).map((file) => ({ fileName: baseName(file.fileName), mediaType: mediaType(file.mediaType), sizeBytes: integer(file.sizeBytes, 0, INGESTION_TASK_MAXIMUM_FILE_BYTES, "File size") })) };
    case "create-hugging-face":
      return { action: value.action, files: boundedFiles(value.files).map((file) => ({ repository: providerRepository(file.repository), path: storagePath(file.path), revision: providerRevision(file.revision), ...(file.mediaType ? { mediaType: mediaType(file.mediaType) } : {}) })) };
    case "create-website":
      return { action: value.action, scope: normalizeGovernedWebsiteScopeRequest(value.scope) };
    case "append-chunk":
      return { action: value.action, taskId: opaque(value.taskId, "Task id"), fileId: opaque(value.fileId, "File id"), chunkIndex: integer(value.chunkIndex, 0, 65_535, "Chunk index"), expectedOffset: integer(value.expectedOffset, 0, Number.MAX_SAFE_INTEGER, "Chunk offset"), bytes: chunkBytes(value.bytes), sha256: normalizeIngestionSha256Digest(value.sha256) };
    case "finalize-file":
      return { action: value.action, taskId: opaque(value.taskId, "Task id"), fileId: opaque(value.fileId, "File id"), ...(value.sha256 ? { sha256: normalizeIngestionSha256Digest(value.sha256) } : {}) };
    case "read":
    case "cancel":
    case "resume":
    case "run-hugging-face":
    case "run-website":
      return { action: value.action, taskId: opaque(value.taskId, "Task id") };
    case "refresh-website":
      return { action: value.action, sourceId: normalizeIngestionSourceId(value.sourceId) };
    case "list":
    case "cleanup-expired":
      return { action: value.action };
  }
}

export function normalizeIngestionTaskTransportValue(value: IngestionTaskTransportValue): IngestionTaskTransportValue {
  if (value.kind === "task") return { kind: "task", task: normalizeIngestionTaskRecord(value.task) };
  if (value.kind === "tasks") {
    if (!Array.isArray(value.tasks) || value.tasks.length > 100) throw new Error("Ingestion task result list exceeds its limit.");
    return { kind: "tasks", tasks: value.tasks.map(normalizeIngestionTaskRecord) };
  }
  if (value.kind === "cleanup") {
    if (!Array.isArray(value.cleanedTaskIds) || value.cleanedTaskIds.length > 100) throw new Error("Ingestion cleanup result exceeds its limit.");
    return { kind: "cleanup", cleanedTaskIds: value.cleanedTaskIds.map((taskId) => normalizeIngestionTaskId(taskId)) };
  }
  if (value.kind === "refresh") return { kind: "refresh", refresh: normalizeIngestionSourceRefreshRecord(value.refresh) };
  throw new Error("Unsupported ingestion task result.");
}

function boundedFiles<T>(files: readonly T[]): readonly T[] { if (!Array.isArray(files) || files.length < 1 || files.length > INGESTION_TASK_MAXIMUM_FILES) throw new Error(`Select between 1 and ${INGESTION_TASK_MAXIMUM_FILES} files.`); return files; }
function chunkBytes(value: Uint8Array): Uint8Array {
  const bytes = value instanceof Uint8Array ? value : Array.isArray(value) ? new Uint8Array(value) : undefined;
  if (!bytes || bytes.byteLength < 1 || bytes.byteLength > INGESTION_TASK_MAXIMUM_CHUNK_BYTES) throw new Error(`Chunk bytes must contain 1 through ${INGESTION_TASK_MAXIMUM_CHUNK_BYTES} bytes.`);
  return bytes;
}
function opaque(value: string, label: string): string { const normalized = String(value).trim(); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) throw new Error(`${label} is invalid.`); return normalized; }
function baseName(value: string): string { const normalized = text(value, "File name", 255); if (/[\\/\u0000-\u001f]/.test(normalized) || normalized === "." || normalized === "..") throw new Error("File name must not contain a path."); return normalized; }
function mediaType(value: string): string { const normalized = text(value, "Media type", 128).toLowerCase(); if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(normalized)) throw new Error("Media type is invalid."); return normalized; }
function providerRepository(value: string): string { const normalized = text(value, "Provider repository", 200); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(normalized)) throw new Error("Provider repository must use owner/name format."); return normalized; }
function providerRevision(value: string): string { const normalized = text(value, "Provider revision", 64).toLowerCase(); if (!/^[a-f0-9]{7,64}$/.test(normalized)) throw new Error("Provider revision must be an immutable commit SHA."); return normalized; }
function storagePath(value: string): string { const normalized = text(value, "Provider path", 512).replaceAll("\\", "/"); if (normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Provider path must be contained."); return normalized; }
function text(value: string, label: string, maximum: number): string { const normalized = String(value).trim(); if (!normalized || normalized.length > maximum) throw new Error(`${label} is required and bounded.`); return normalized; }
function integer(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is outside its permitted range.`); return value; }
