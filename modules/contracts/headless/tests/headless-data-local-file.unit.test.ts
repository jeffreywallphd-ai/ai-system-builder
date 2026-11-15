import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeIngestionSha256Digest, normalizeIngestionTaskFileId, normalizeIngestionTaskId,
  normalizeIngestionTaskRecord, type IngestionTaskFileRecord,
} from "../../ingestion";
import { createWorkspaceId } from "../../workspace";
import {
  projectHeadlessLocalFileImport, readHeadlessLocalFileImportRequest,
  type HeadlessLocalFileImportRequest,
} from "../headless-data-local-file";
import { HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId } from "../headless-read-request";

const hostIncarnationId = "54133645-536c-43d2-8309-30701194add7" as HeadlessHostIncarnationId;
const otherHost = "44d2cf26-9b80-4a62-a5ff-6004ae720a9a" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workspace.local-fixture");
const taskId = normalizeIngestionTaskId("task.local-fixture");
const fileId = normalizeIngestionTaskFileId("file.local-fixture");
const input = { hostIncarnationId, workspaceId, taskId, fileId, taskRevision: 3 };
const request: HeadlessLocalFileImportRequest = {
  version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-local-file", input,
};

test("local file admission accepts only exact current scope and staged reference fields", () => {
  assert.deepEqual(readHeadlessLocalFileImportRequest(request, hostIncarnationId), { ok: true, request });
  assert.deepEqual(readHeadlessLocalFileImportRequest(request, otherHost), { ok: false, code: "headless.host-changed" });
  for (const extra of [
    { path: "fixture/notes.txt" }, { bytes: [1, 2] }, { provider: "huggingface" },
    { fileId: "folder/file" }, { fileId: "file.fixture " }, { taskRevision: -1 }, { taskRevision: 1.2 },
  ]) assert.deepEqual(readHeadlessLocalFileImportRequest({ ...request, input: { ...input, ...extra } }, hostIncarnationId),
    { ok: false, code: "headless.invalid-request" });
});

const digest = normalizeIngestionSha256Digest("sha256:" + "a".repeat(64));
const file: IngestionTaskFileRecord = {
  fileId, checkpointId: "checkpoint.local-fixture", fileName: "synthetic-private-notes.csv", mediaType: "text/csv",
  totalBytes: 64, status: "transferring", acceptedBytes: 64, nextChunkIndex: 1,
  lastChunk: { index: 0, sizeBytes: 64, digest },
};
const createdAt = "2025-01-01T00:00:00Z";
const updatedAt = "2025-01-01T00:00:02Z";
const expiry = "2025-01-01T00:10:00Z";
const now = Date.parse(updatedAt);
const task = normalizeIngestionTaskRecord({
  schemaVersion: "1.0", workspaceId, taskId, kind: "file-batch", status: "transferring", files: [file], revision: 3,
  checkpointExpiresAt: expiry, cleanupPending: true, createdAt, updatedAt,
  progress: { totalBytes: 64, acceptedBytes: 64, completedItems: 0, totalItems: 1, percent: 100 },
});

test("a complete staged file projects only the exact approval metadata and effect", () => {
  assert.deepEqual(projectHeadlessLocalFileImport(task, input, now), { ok: true, value: {
    workspaceId, taskId, fileId, taskRevision: 3, mediaType: "text/csv", fileBytes: 64,
    checkpointExpiresAt: Date.parse(expiry), effect: "save-local-source", externalProviderCalls: 0,
  } });
  const emptyFile: IngestionTaskFileRecord = { ...file, status: "pending", totalBytes: 0, acceptedBytes: 0,
    nextChunkIndex: 0, lastChunk: undefined };
  const empty = projectHeadlessLocalFileImport({ ...task, status: "queued", files: [emptyFile] }, input, now);
  assert.ok(empty.ok);
  assert.equal(empty.value.fileBytes, 0);
});

test("reject unrelated, lost, stale, incomplete, expired, and non-local selections without publication", () => {
  const denied = { ok: false, code: "headless.forbidden" };
  const notReady = { ok: false, code: "headless.source-not-ready" };
  assert.deepEqual(projectHeadlessLocalFileImport({ ...task, workspaceId: createWorkspaceId("workspace.other") }, input, now), denied);
  assert.deepEqual(projectHeadlessLocalFileImport(task, { ...input, fileId: normalizeIngestionTaskFileId("file.other") }, now), denied);
  assert.deepEqual(projectHeadlessLocalFileImport(task, { ...input, taskRevision: 2 }, now), { ok: false, code: "headless.stale" });
  const provider: IngestionTaskFileRecord = { ...file, providerSource: { provider: "huggingface",
    repository: "synthetic/data", path: "selection.csv", revision: "e".repeat(40) } };
  for (const candidate of [
    { ...task, files: [{ ...file, acceptedBytes: 32, lastChunk: { index: 0, sizeBytes: 32, digest } }] },
    { ...task, status: "queued" as const },
    { ...task, status: "finalizing" as const },
    { ...task, files: [{ ...file, lastChunk: { index: 0, sizeBytes: 63, digest } }] },
    { ...task, files: [{ ...file, lastChunk: { index: 0, sizeBytes: 65, digest } }] },
    { ...task, files: [{ ...file, totalBytes: 0, acceptedBytes: 0 }] },
    { ...task, status: "cancelled" as const, completedAt: updatedAt },
    { ...task, checkpointExpiresAt: undefined },
    { ...task, kind: "hugging-face" as const, files: [provider] },
    { ...task, files: [] },
  ]) assert.deepEqual(projectHeadlessLocalFileImport(candidate, input, now), notReady);
  assert.deepEqual(projectHeadlessLocalFileImport(task, input, Date.parse(expiry)), notReady);
});
