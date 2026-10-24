import assert from "node:assert/strict";
import { test } from "node:test";
import type { IngestionFilePublication } from "../../../../application/ports/ingestion";
import { normalizeIngestionFilePublication } from "../../../../application/shared/ingestion-file-publication";
import { normalizeIngestionTaskRecord, type IngestionSourceSnapshot } from "../../../../contracts/ingestion";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createStructuredIngestionAcquisitionRepository, INGESTION_FILE_PUBLICATION_NAMESPACE, INGESTION_TASK_NAMESPACE } from "../createStructuredIngestionAcquisitionRepository";
import { createStructuredIngestionFilePublicationRepository } from "../createStructuredIngestionFilePublicationRepository";

const now = "2026-10-22T10:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}` as const;
async function fixture() {
  const documents = createInMemoryStructuredDocumentStore();
  const repository = createStructuredIngestionAcquisitionRepository(documents);
  const publications = createStructuredIngestionFilePublicationRepository(documents);
  const task = normalizeIngestionTaskRecord({ schemaVersion: "1.0", taskId: "task-a", workspaceId: "workspace-a", kind: "file-batch",
    status: "finalizing", files: [{ fileId: "file-a", checkpointId: "checkpoint-a", fileName: "train.csv", mediaType: "text/csv", totalBytes: 3,
      acceptedBytes: 3, nextChunkIndex: 1, lastChunk: { index: 0, sizeBytes: 3, digest }, status: "transferring" }], revision: 1,
    progress: { acceptedBytes: 3, totalBytes: 3, completedItems: 0, totalItems: 1, percent: 100 }, cleanupPending: true, createdAt: now, updatedAt: now });
  await repository.createTask(task);
  const publication = normalizeIngestionFilePublication({ schemaVersion: "1.0", publicationId: "b".repeat(32), workspaceId: task.workspaceId,
    taskId: task.taskId, fileId: task.files[0]!.fileId, checkpointId: "checkpoint-a", taskCreatedAt: now, fileName: "train.csv", mediaType: "text/csv",
    totalBytes: 3, acceptedBytes: 3, nextChunkIndex: 1, expectedSha256: digest,
    key: `workspaces/workspace-a/artifacts/files/ingestion/${"b".repeat(32)}`, capturedAt: now, revision: 1, state: "reserved" });
  const key = "workspace-a/task-a/file-a";
  return { documents, repository, publications, task, publication, key };
}
async function originReady(value: Awaited<ReturnType<typeof fixture>>) {
  let publication = await value.publications.createPublication(value.publication);
  for (const state of ["writing", "bytes-acknowledged", "origin-issued", "origin-complete"] as const) {
    publication = await value.publications.savePublication({ ...publication, state, revision: publication.revision + 1,
      ...(state !== "writing" ? { digest } : {}) }, publication.revision);
  }
  const snapshot: IngestionSourceSnapshot = { schemaVersion: "1.0", snapshotId: "snapshot.task-a.file-a" as never, sourceId: "source.task-a.file-a" as never,
    workspaceId: value.task.workspaceId, locator: { kind: "file", displayName: "train.csv", originalName: "train.csv" },
    contentDigest: digest, sizeBytes: 3, mediaType: "text/csv", rawArtifactKey: publication.key, capturedAt: now };
  const completed = normalizeIngestionTaskRecord({ ...value.task, revision: 2, files: [{ ...value.task.files[0], status: "finalized",
    output: { key: publication.key, mediaType: "text/csv", sizeBytes: 3, digest, sourceId: snapshot.sourceId, sourceSnapshotId: snapshot.snapshotId } }] });
  return { publication, snapshot, completed };
}

test("private reservation and writing CAS each admit only one concurrent winner", async () => {
  const value = await fixture();
  const created = await Promise.allSettled([value.publications.createPublication(value.publication), value.publications.createPublication(value.publication)]);
  assert.equal(created.filter(r => r.status === "fulfilled").length, 1);
  const writing = { ...value.publication, revision: 2, state: "writing" as const };
  const saved = await Promise.allSettled([value.publications.savePublication(writing, 1), value.publications.savePublication(writing, 1)]);
  assert.equal(saved.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.publication.fileId))?.state, "writing");
});

test("origin issuance CAS admits one winner and cannot skip its durable phase", async () => {
  const value = await fixture(); await value.publications.createPublication(value.publication);
  const writing = await value.publications.savePublication({ ...value.publication, state: "writing", revision: 2 }, 1);
  const acknowledged = await value.publications.savePublication({ ...writing, state: "bytes-acknowledged", revision: 3, digest }, 2);
  await assert.rejects(value.publications.savePublication({ ...acknowledged, state: "origin-complete", revision: 5 }, 3));
  const issued = { ...acknowledged, state: "origin-issued" as const, revision: 4 };
  const results = await Promise.allSettled([value.publications.savePublication(issued, 3), value.publications.savePublication(issued, 3)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.publication.fileId))?.state, "origin-issued");
});

test("private records reject unknown fields, executable properties and invalid state/key/counters", async () => {
  const value = await fixture();
  for (const patch of [{ unexpected: true }, { key: "workspaces/workspace-b/artifacts/files/ingestion/" + "b".repeat(32) },
    { acceptedBytes: 2 }, { nextChunkIndex: Number.MAX_SAFE_INTEGER }, { state: "writing" }, { digest }, { publicationId: "../escape" }]) {
    assert.throws(() => normalizeIngestionFilePublication({ ...value.publication, ...patch }));
  }
  let calls = 0;
  const executable = { ...value.publication };
  Object.defineProperty(executable, "key", { enumerable: true, get() { calls++; return value.publication.key; } });
  assert.throws(() => normalizeIngestionFilePublication(executable));
  assert.equal(calls, 0);
  assert.equal((await value.documents.listDocuments(INGESTION_FILE_PUBLICATION_NAMESPACE)).length, 0);
});

test("reservation binds the real task definition, document revision and organization before writes", async () => {
  for (const mode of ["workspace", "file", "checkpoint", "created", "task-revision", "organization"] as const) {
    const value = await fixture();
    let publication: IngestionFilePublication = value.publication;
    if (mode === "workspace") publication = { ...publication, workspaceId: createWorkspaceId("workspace-b"), key: publication.key.replace("workspace-a", "workspace-b") };
    if (mode === "file") publication = { ...publication, fileId: "file-b" as never };
    if (mode === "checkpoint") publication = { ...publication, checkpointId: "checkpoint-b" };
    if (mode === "created") publication = { ...publication, taskCreatedAt: "2026-10-21T10:00:00.000Z" };
    if (mode === "organization") publication = { ...publication, organizationId: createOrganizationId("organization-b") };
    if (mode === "task-revision") await value.documents.writeDocument(INGESTION_TASK_NAMESPACE, "workspace-a/task-a", value.task, { expectedRevision: 1 });
    await assert.rejects(value.publications.createPublication(publication));
    assert.equal((await value.documents.listDocuments(INGESTION_FILE_PUBLICATION_NAMESPACE)).length, 0);
  }
});

test("transitions cannot change immutable identity, skip a phase or directly mark committed", async () => {
  const value = await fixture(); await value.publications.createPublication(value.publication);
  for (const input of [{ ...value.publication, revision: 3, state: "bytes-acknowledged", digest },
    { ...value.publication, revision: 2, state: "writing", capturedAt: "2026-10-21T10:00:00.000Z" },
    { ...value.publication, revision: 6, state: "committed", digest }]) {
    await assert.rejects(value.publications.savePublication(input as IngestionFilePublication, 1));
  }
  assert.equal((await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.publication.fileId))?.revision, 1);
});

test("cancelled task can retain a returned byte acknowledgement but cannot publish an origin", async () => {
  const value = await fixture(); await value.publications.createPublication(value.publication);
  const writing = await value.publications.savePublication({ ...value.publication, state: "writing", revision: 2 }, 1);
  await value.repository.saveTask({ ...value.task, revision: 2, status: "cancelled", completedAt: now, files: [{ ...value.task.files[0]!, status: "cancelled" }] }, 1);
  const acknowledged = await value.publications.savePublication({ ...writing, state: "bytes-acknowledged", revision: 3, digest }, 2);
  await assert.rejects(value.publications.savePublication({ ...acknowledged, state: "origin-issued", revision: 4 }, 3));
  assert.equal((await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.publication.fileId))?.state, "bytes-acknowledged");
});

test("ordinary task save cannot bypass publication/source transaction and exact commit is atomic", async () => {
  const value = await fixture(); const ready = await originReady(value);
  await assert.rejects(value.repository.saveTask(ready.completed, 1));
  await value.repository.saveTaskWithSourceSnapshot(ready.completed, 1, ready.snapshot);
  assert.equal((await value.repository.readTask(value.task.workspaceId, value.task.taskId))?.revision, 2);
  assert.deepEqual(await value.repository.readSourceSnapshot(value.task.workspaceId, ready.snapshot.snapshotId), ready.snapshot);
  assert.equal((await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.publication.fileId))?.state, "committed");
  await assert.rejects(value.repository.saveTask({ ...ready.completed, revision: 3,
    files: [{ ...ready.completed.files[0]!, output: { ...ready.completed.files[0]!.output!, key: "workspaces/workspace-a/artifacts/other" } }] }, 2));
});

for (const mode of ["key", "digest", "time", "size", "scope", "missing-origin", "document-revision"] as const) {
  test(`rejects ${mode} mismatch without partially committing source, task or private completion`, async () => {
    const value = await fixture(); const ready = await originReady(value);
    let snapshot = ready.snapshot;
    if (mode === "key") snapshot = { ...snapshot, rawArtifactKey: "workspaces/workspace-a/artifacts/foreign" };
    if (mode === "digest") snapshot = { ...snapshot, contentDigest: `sha256:${"c".repeat(64)}` };
    if (mode === "time") snapshot = { ...snapshot, capturedAt: "2026-10-21T10:00:00.000Z" };
    if (mode === "size") snapshot = { ...snapshot, sizeBytes: 2 };
    if (mode === "scope") snapshot = { ...snapshot, workspaceId: createWorkspaceId("workspace-b") };
    if (mode === "missing-origin") await value.documents.deleteDocument(INGESTION_FILE_PUBLICATION_NAMESPACE, value.key, 5);
    if (mode === "document-revision") await value.documents.writeDocument(INGESTION_FILE_PUBLICATION_NAMESPACE, value.key, ready.publication, { expectedRevision: 5 });
    await assert.rejects(value.repository.saveTaskWithSourceSnapshot(ready.completed, 1, snapshot));
    assert.equal((await value.repository.readTask(value.task.workspaceId, value.task.taskId))?.revision, 1);
    assert.equal(await value.repository.readSourceSnapshot(value.task.workspaceId, ready.snapshot.snapshotId), undefined);
    const privateRow = await value.documents.readDocument<IngestionFilePublication>(INGESTION_FILE_PUBLICATION_NAMESPACE, value.key);
    assert.notEqual(privateRow?.value.state, "committed");
  });
}
