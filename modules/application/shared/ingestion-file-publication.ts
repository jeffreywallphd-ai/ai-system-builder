import type { IngestionFilePublication } from "../ports/ingestion/ingestion-file-publication.port";
import {
  INGESTION_TASK_MAXIMUM_FILE_BYTES, INGESTION_TASK_MAXIMUM_CHUNKS,
  normalizeIngestionTaskId, normalizeIngestionTaskFileId, normalizeIngestionSha256Digest,
  type IngestionTaskRecord,
} from "../../contracts/ingestion";
import { createOrganizationId } from "../../contracts/organization";
import { createWorkspaceId } from "../../contracts/workspace";
import {
  passiveRecord, passiveTypedString, passiveOptional, passiveEnum,
  copyBoundedPassiveData,
} from "../../contracts/shared";

const states = ["reserved", "writing", "bytes-acknowledged", "origin-issued", "origin-complete", "committed"] as const;
export function publicationUnavailable(): never { throw new Error("File publication is unavailable. Retained data requires recovery."); }
const text = (value: unknown): string => typeof value === "string" && value.length > 0 && value.length <= 512 ? value : publicationUnavailable();
const timestamp = (value: unknown): string => {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result) || !Number.isFinite(Date.parse(result))) publicationUnavailable();
  return result;
};
const count = (maximum: number, minimum = 0) => (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : publicationUnavailable();
const identity = (value: unknown): string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value) ? value : publicationUnavailable();
const fileName = (value: unknown): string => {
  const result = text(value);
  if (result.length > 255 || /[\\/\u0000-\u001f]/.test(result) || result === "." || result === "..") publicationUnavailable();
  return result;
};
const mediaType = (value: unknown): string => {
  const result = text(value);
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(result) ? result : publicationUnavailable();
};
const parse = passiveRecord<IngestionFilePublication>({
  schemaVersion: value => value === "1.0" ? value : publicationUnavailable(),
  publicationId: identity,
  workspaceId: passiveTypedString(createWorkspaceId),
  organizationId: passiveOptional(passiveTypedString(createOrganizationId)),
  taskId: passiveTypedString(normalizeIngestionTaskId),
  fileId: passiveTypedString(normalizeIngestionTaskFileId),
  taskCreatedAt: timestamp, checkpointExpiresAt: passiveOptional(timestamp),
  checkpointId: passiveTypedString(normalizeIngestionTaskId), fileName, mediaType,
  totalBytes: count(INGESTION_TASK_MAXIMUM_FILE_BYTES), acceptedBytes: count(INGESTION_TASK_MAXIMUM_FILE_BYTES),
  nextChunkIndex: count(INGESTION_TASK_MAXIMUM_CHUNKS),
  expectedSha256: passiveOptional(passiveTypedString(normalizeIngestionSha256Digest)),
  key: text, capturedAt: timestamp, revision: count(6, 1), state: passiveEnum(states),
  digest: passiveOptional(passiveTypedString(normalizeIngestionSha256Digest)),
});

export function normalizeIngestionFilePublication(value: unknown): IngestionFilePublication {
  try {
    const result = parse(value);
    if (result.key !== `workspaces/${result.workspaceId}/artifacts/files/ingestion/${result.publicationId}`
      || result.acceptedBytes !== result.totalBytes || result.revision !== states.indexOf(result.state) + 1
      || (result.revision >= 3) !== Boolean(result.digest)
      || (result.digest && result.expectedSha256 && result.digest !== result.expectedSha256)) publicationUnavailable();
    return result;
  } catch { return publicationUnavailable(); }
}

/** Bind a private intent to the real persisted immutable definition, not a descriptor. */
export function assertPublicationTask(publication: IngestionFilePublication, task: IngestionTaskRecord): void {
  const file = task.files.find(candidate => candidate.fileId === publication.fileId);
  if (!file || task.kind !== "file-batch" || task.taskId !== publication.taskId
    || task.workspaceId !== publication.workspaceId || task.organizationId !== publication.organizationId
    || task.createdAt !== publication.taskCreatedAt || task.checkpointExpiresAt !== publication.checkpointExpiresAt
    || file.checkpointId !== publication.checkpointId || file.fileName !== publication.fileName || file.mediaType !== publication.mediaType
    || file.totalBytes !== publication.totalBytes || file.acceptedBytes !== publication.acceptedBytes || file.nextChunkIndex !== publication.nextChunkIndex) publicationUnavailable();
}

export function assertPublicationOutput(publication: IngestionFilePublication, task: IngestionTaskRecord): void {
  assertPublicationTask(publication, task);
  const file = task.files.find(candidate => candidate.fileId === publication.fileId)!;
  const output = file.output;
  if (file.status !== "finalized" || !output || output.key !== publication.key || output.mediaType !== publication.mediaType
    || output.sizeBytes !== publication.totalBytes || output.digest !== publication.digest || output.providerRevision
    || output.sourceId !== `source.${task.taskId}.${file.fileId}` || output.sourceSnapshotId !== `snapshot.${task.taskId}.${file.fileId}`
    || output.derivedArtifactKeys?.length) publicationUnavailable();
}

export function samePublicationData(left: unknown, right: unknown): boolean {
  const stable = (value: unknown): string => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  };
  return stable(copyBoundedPassiveData(left)) === stable(copyBoundedPassiveData(right));
}
