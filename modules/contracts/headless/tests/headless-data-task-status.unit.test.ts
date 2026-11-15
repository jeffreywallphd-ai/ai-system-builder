import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceId } from "../../workspace";
import {
  normalizeIngestionSha256Digest,
  normalizeIngestionTaskFileId,
  normalizeIngestionTaskId,
  normalizeIngestionTaskRecord,
  type IngestionTaskFileRecord,
} from "../../ingestion";
import { HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId } from "../headless-read-request";
import { projectHeadlessIngestionStatus, readHeadlessIngestionStatusRequest } from "../headless-data-task-status";

const hostIncarnationId = "54133645-536c-43d2-8309-30701194add7" as HeadlessHostIncarnationId;
const otherHost = "818a563f-1a38-4718-b25d-7ca7243bfb6f" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workspace.data-fixture");
const taskId = normalizeIngestionTaskId("intake.fixture");
const input = { hostIncarnationId, workspaceId, taskId };
const request = { version: HEADLESS_CONTRACT_VERSION, operation: "data.ingestion-status", input };

test("a scoped ingestion status request accepts only the exact current host, workspace, and task identifiers", () => {
  assert.deepEqual(readHeadlessIngestionStatusRequest(request, hostIncarnationId), { ok: true, request });
  assert.deepEqual(readHeadlessIngestionStatusRequest(request, otherHost), { ok: false, code: "headless.host-changed" });
  for (const extra of [{ path: "synthetic/example" }, { provider: "huggingface" }, { principalId: "author" },
    { taskId: "intake.fixture " }, { taskId: "https://example.invalid/data" }, { workspaceId: null }]) {
    assert.deepEqual(readHeadlessIngestionStatusRequest({ ...request, input: { ...input, ...extra } }, hostIncarnationId),
      { ok: false, code: "headless.invalid-request" });
  }
});

const digest = normalizeIngestionSha256Digest("sha256:" + "a".repeat(64));
const createdAt = "2025-01-01T00:00:00Z";
const updatedAt = "2025-01-01T00:00:02Z";

function selectedFile(label: string): IngestionTaskFileRecord {
  return {
    fileId: normalizeIngestionTaskFileId("file." + label),
    checkpointId: "checkpoint." + label,
    fileName: label + ".txt",
    mediaType: "text/plain",
    totalBytes: 50,
    status: "pending",
    acceptedBytes: 0,
    nextChunkIndex: 0,
  };
}

function completeFile(file: IngestionTaskFileRecord): IngestionTaskFileRecord {
  return {
    ...file,
    status: "finalized",
    acceptedBytes: file.totalBytes,
    nextChunkIndex: 1,
    lastChunk: { index: 0, sizeBytes: file.totalBytes, digest },
    output: { key: "artifact." + file.fileId, mediaType: file.mediaType, sizeBytes: file.totalBytes, digest },
  };
}

const firstFile = completeFile(selectedFile("synthetic-private-first"));
const secondFile = selectedFile("synthetic-private-second");
const partial = normalizeIngestionTaskRecord({
  schemaVersion: "1.0",
  workspaceId,
  taskId,
  kind: "file-batch",
  status: "transferring",
  files: [firstFile, secondFile],
  revision: 3,
  cleanupPending: false,
  createdAt,
  updatedAt,
  progress: { completedItems: 1, totalItems: 2, acceptedBytes: 50, totalBytes: 100, percent: 50,
    message: "Synthetic diagnostic text stays in Data" },
});

test("the egress projection reports scoped partial or terminal state with no file metadata", () => {
  for (const state of ["transferring", "failed", "cancelled"] as const) {
    const completedAt = state === "transferring" ? undefined : updatedAt;
    assert.deepEqual(projectHeadlessIngestionStatus({ ...partial, status: state, completedAt }, input), {
      ok: true,
      value: {
        taskId, state, sourceKind: "file-batch", revision: 3,
        progress: { completedItems: 1, totalItems: 2, acceptedBytes: 50, totalBytes: 100 },
      },
    });
  }
  const succeeded = normalizeIngestionTaskRecord({ ...partial, status: "succeeded", completedAt: updatedAt,
    files: [firstFile, completeFile(secondFile)] });
  assert.deepEqual(projectHeadlessIngestionStatus(succeeded, input), {
    ok: true,
    value: {
      taskId, state: "succeeded", sourceKind: "file-batch", revision: 3,
      progress: { completedItems: 2, totalItems: 2, acceptedBytes: 100, totalBytes: 100 },
    },
  });
});

test("provider task completion can have zero local bytes without returning provider coordinates", () => {
  const revision = "e".repeat(40);
  const providerFile: IngestionTaskFileRecord = {
    ...selectedFile("synthetic-provider-file"),
    totalBytes: 0,
    status: "finalized",
    providerSource: { provider: "huggingface", repository: "synthetic/private", path: "rows.txt", revision },
    output: { key: "artifact.synthetic-provider-file", mediaType: "text/plain", sizeBytes: 0, providerRevision: revision },
  };
  const succeeded = normalizeIngestionTaskRecord({ ...partial, kind: "hugging-face", status: "succeeded",
    completedAt: updatedAt, files: [providerFile] });
  assert.deepEqual(projectHeadlessIngestionStatus(succeeded, input), {
    ok: true,
    value: {
      taskId, state: "succeeded", sourceKind: "hugging-face", revision: 3,
      progress: { completedItems: 1, totalItems: 1, acceptedBytes: 0, totalBytes: 0 },
    },
  });
});

test("foreign task, missing progress, inconsistent progress, and an incomplete success cannot be returned", () => {
  for (const item of [
    { ...partial, workspaceId: createWorkspaceId("workspace.other") },
    { ...partial, taskId: normalizeIngestionTaskId("intake.other") },
    { ...partial, files: [] },
    { ...partial, progress: undefined as unknown as typeof partial.progress },
    { ...partial, progress: { ...partial.progress, totalBytes: 10 } },
    { ...partial, progress: { ...partial.progress, completedItems: 3 } },
    { ...partial, status: "succeeded" as const, completedAt: updatedAt },
  ]) assert.deepEqual(projectHeadlessIngestionStatus(item, input), { ok: false, code: "headless.unavailable" });
});
