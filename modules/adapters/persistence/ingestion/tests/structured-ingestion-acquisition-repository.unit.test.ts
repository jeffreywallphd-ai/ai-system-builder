import { describe, expect, it } from "../../../../testing/node-test";
import { createOrganizationId } from "../../../../contracts/organization";
import type { IngestionSourceRefreshRecord, IngestionSourceSnapshot, IngestionTaskRecord } from "../../../../contracts/ingestion";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createStructuredIngestionFilePublicationRepository } from "../createStructuredIngestionFilePublicationRepository";
import type { IngestionFilePublication } from "../../../../application/ports/ingestion";
import {
  INGESTION_SOURCE_SNAPSHOT_NAMESPACE,
  INGESTION_TASK_NAMESPACE,
  createStructuredIngestionAcquisitionRepository,
} from "../createStructuredIngestionAcquisitionRepository";

const now = "2026-07-30T04:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function task(workspace = "workspace-a", organizationId?: string): IngestionTaskRecord {
  return {
    schemaVersion: "1.0",
    taskId: "task-1" as never,
    ...(organizationId ? { organizationId: createOrganizationId(organizationId) } : {}),
    workspaceId: createWorkspaceId(workspace),
    kind: "file-batch",
    status: "transferring",
    files: [{ fileId: "file-1" as never, checkpointId: "checkpoint-1", fileName: "train.jsonl", mediaType: "application/jsonl", totalBytes: 10, status: "transferring", acceptedBytes: 4, nextChunkIndex: 1, lastChunk: { index: 0, sizeBytes: 4, digest: digest("a") } }],
    progress: { acceptedBytes: 4, totalBytes: 10, completedItems: 0, totalItems: 1, percent: 40 },
    revision: 1,
    cleanupPending: true,
    createdAt: now,
    updatedAt: now,
  };
}

function snapshot(organizationId?: string): IngestionSourceSnapshot {
  return {
    schemaVersion: "1.0",
    snapshotId: "snapshot-1" as never,
    sourceId: "source-1" as never,
    ...(organizationId ? { organizationId: createOrganizationId(organizationId) } : {}),
    workspaceId: createWorkspaceId("workspace-a"),
    locator: { kind: "file", displayName: "Train", originalName: "train.jsonl" },
    contentDigest: digest("b"),
    sizeBytes: 10,
    mediaType: "application/jsonl",
    rawArtifactKey: "workspaces/workspace-a/artifacts/train.jsonl",
    capturedAt: now,
  };
}

function refresh(organizationId?: string): IngestionSourceRefreshRecord {
  return {
    schemaVersion: "1.0",
    refreshId: "refresh-1" as never,
    sourceId: "source-1" as never,
    ...(organizationId ? { organizationId: createOrganizationId(organizationId) } : {}),
    workspaceId: createWorkspaceId("workspace-a"),
    outcome: "unchanged",
    previousSnapshotId: "snapshot-1" as never,
    currentSnapshotId: "snapshot-1" as never,
    checkedAt: now,
    summary: "No changes found.",
  };
}

describe("structured ingestion acquisition repository", () => {
  it("reopens cleanup only for the exact cancelled checkpoint without changing transfer data", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    const started = await repository.createTask(task());
    const file = started.files[0]!;
    const request = {
      workspaceId: started.workspaceId, taskId: started.taskId, fileId: file.fileId, checkpointId: file.checkpointId,
      expectedRevision: 1, updatedAt: now,
    };
    await expect(repository.markCancelledCheckpointCleanupPending(request)).rejects.toThrow("unavailable");
    const cancelled = await repository.saveTask({
      ...started, status: "cancelled", completedAt: now, cleanupPending: false, revision: 2,
      files: [{ ...file, status: "cancelled" }],
    }, 1);
    await expect(repository.saveTask({ ...cancelled, cleanupPending: true, revision: 3 }, 2)).rejects.toThrow("immutable after cleanup");
    await expect(repository.markCancelledCheckpointCleanupPending({ ...request, expectedRevision: 2,
      checkpointId: "other-checkpoint" })).rejects.toThrow("unavailable");
    await expect(repository.markCancelledCheckpointCleanupPending({ ...request, expectedRevision: 2,
      workspaceId: createWorkspaceId("workspace-b") })).rejects.toThrow("unavailable");
    await expect(repository.markCancelledCheckpointCleanupPending(request)).rejects.toThrow("revision conflict");
    expect(await repository.readTask(started.workspaceId, started.taskId)).toEqual(cancelled);

    await repository.markCancelledCheckpointCleanupPending({ ...request, expectedRevision: 2 });
    const pending = { ...cancelled, cleanupPending: true, revision: 3 };
    expect(await repository.readTask(started.workspaceId, started.taskId)).toEqual(pending);
    await expect(repository.saveTask({ ...pending, cleanupPending: false, revision: 4,
      files: [{ ...file, status: "transferring" }] }, 3)).rejects.toThrow("immutable after cleanup");
    await repository.markCancelledCheckpointCleanupPending({ ...request, expectedRevision: 3 });
    await expect(repository.saveTask({ ...pending, cleanupPending: false, revision: 4 }, 3)).rejects.toThrow("revision conflict");
    expect(await repository.readTask(started.workspaceId, started.taskId)).toEqual({ ...pending, revision: 4 });
  });

  it("commits a finalized task and matching source snapshot in one optimistic transaction", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const repository = createStructuredIngestionAcquisitionRepository(documents);
    const ready: IngestionTaskRecord = { ...task(), status: "finalizing", files: [{ ...task().files[0]!, acceptedBytes: 10, nextChunkIndex: 2,
      lastChunk: { index: 1, sizeBytes: 6, digest: digest("c") } }] };
    await repository.createTask(ready);
    const exactSnapshot: IngestionSourceSnapshot = { ...snapshot(), sourceId: "source.task-1.file-1" as never, snapshotId: "snapshot.task-1.file-1" as never,
      rawArtifactKey: `workspaces/workspace-a/artifacts/files/ingestion/${"a".repeat(32)}`,
      locator: { kind: "file", displayName: "train.jsonl", originalName: "train.jsonl" } };
    const publications = createStructuredIngestionFilePublicationRepository(documents);
    let publication: IngestionFilePublication = { schemaVersion: "1.0", publicationId: "a".repeat(32), workspaceId: ready.workspaceId,
      taskId: ready.taskId, fileId: ready.files[0]!.fileId, taskCreatedAt: now, checkpointId: "checkpoint-1", fileName: "train.jsonl",
      mediaType: "application/jsonl", totalBytes: 10, acceptedBytes: 10, nextChunkIndex: 2, expectedSha256: digest("b"),
      key: exactSnapshot.rawArtifactKey, capturedAt: now, revision: 1, state: "reserved" };
    await publications.createPublication(publication);
    for (const state of ["writing", "bytes-acknowledged", "origin-issued", "origin-complete"] as const) {
      publication = await publications.savePublication({ ...publication, state, revision: publication.revision + 1,
        ...(state !== "writing" ? { digest: digest("b") } : {}) }, publication.revision);
    }
    const committedTask: IngestionTaskRecord = {
      ...ready,
      status: "finalizing",
      revision: 2,
      updatedAt: "2026-07-30T04:01:00.000Z",
      files: [{
        ...task().files[0]!,
        status: "finalized",
        acceptedBytes: 10,
        nextChunkIndex: 2,
        lastChunk: { index: 1, sizeBytes: 6, digest: digest("c") },
        output: {
          key: exactSnapshot.rawArtifactKey,
          mediaType: "application/jsonl",
          sizeBytes: 10,
          digest: snapshot().contentDigest,
          sourceId: exactSnapshot.sourceId,
          sourceSnapshotId: exactSnapshot.snapshotId,
        },
      }],
    };
    await expect(repository.saveTaskWithSourceSnapshot(committedTask, 1, exactSnapshot)).resolves.toMatchObject({
      task: { revision: 2, files: [{ status: "finalized" }] },
      snapshot: { snapshotId: exactSnapshot.snapshotId },
    });
    expect(await repository.readSourceSnapshot(createWorkspaceId("workspace-a"), exactSnapshot.snapshotId)).toEqual(exactSnapshot);
    expect(await publications.readPublication(ready.workspaceId, ready.taskId, ready.files[0]!.fileId)).toMatchObject({ state: "committed", revision: 6 });
  });

  it("does not create a source snapshot when a competing task update wins", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    await repository.createTask(task());
    await repository.saveTask({ ...task(), revision: 2, updatedAt: "2026-07-30T04:01:00.000Z" }, 1);
    const staleTask: IngestionTaskRecord = {
      ...task(), revision: 2, updatedAt: "2026-07-30T04:02:00.000Z",
      files: [{ ...task().files[0]!, status: "finalized", acceptedBytes: 10, nextChunkIndex: 2, lastChunk: { index: 1, sizeBytes: 6, digest: digest("c") }, output: { key: snapshot().rawArtifactKey, mediaType: "application/jsonl", sizeBytes: 10, digest: snapshot().contentDigest, sourceId: snapshot().sourceId, sourceSnapshotId: snapshot().snapshotId } }],
    };
    await expect(repository.saveTaskWithSourceSnapshot(staleTask, 1, snapshot())).rejects.toThrow("revision conflict");
    expect(await repository.readSourceSnapshot(createWorkspaceId("workspace-a"), snapshot().snapshotId)).toBeUndefined();
  });

  it("commits a changed refresh and its new immutable snapshot together", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    await repository.createSourceSnapshot(snapshot());
    const nextSnapshot: IngestionSourceSnapshot = { ...snapshot(), snapshotId: "snapshot-2" as never, contentDigest: digest("d"), previousSnapshotId: snapshot().snapshotId };
    const changed: IngestionSourceRefreshRecord = { ...refresh(), refreshId: "refresh-2" as never, outcome: "changed", currentSnapshotId: nextSnapshot.snapshotId };
    await expect(repository.recordSourceRefreshWithSnapshot(nextSnapshot, changed)).resolves.toMatchObject({ refresh: { outcome: "changed" }, snapshot: { snapshotId: "snapshot-2" } });
    await expect(repository.recordSourceRefreshWithSnapshot(nextSnapshot, changed)).resolves.toEqual({ refresh: changed, snapshot: nextSnapshot });
    expect((await repository.listSourceSnapshots(createWorkspaceId("workspace-a"), snapshot().sourceId)).length).toBe(2);
    expect(await repository.listSourceRefreshes(createWorkspaceId("workspace-a"), snapshot().sourceId)).toEqual([changed]);
  });

  it("selects the current source version when several captures share one instant", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    const initial = await repository.createSourceSnapshot(snapshot());
    const middle: IngestionSourceSnapshot = {
      ...initial, snapshotId: "snapshot-2" as never, previousSnapshotId: initial.snapshotId,
      capturedAt: "2026-07-30T04:00:00Z", contentDigest: digest("c"),
    };
    const latest: IngestionSourceSnapshot = {
      ...initial, snapshotId: "snapshot-3" as never, previousSnapshotId: middle.snapshotId, contentDigest: digest("d"),
    };
    for (const next of [middle, latest]) {
      await repository.recordSourceRefreshWithSnapshot(next, {
        ...refresh(), refreshId: `refresh-${next.snapshotId}` as never, outcome: "changed",
        previousSnapshotId: next.previousSnapshotId, currentSnapshotId: next.snapshotId,
      });
    }

    const { workspaceId, sourceId } = initial;
    expect(await repository.listSourceSnapshots(workspaceId, sourceId, 1)).toEqual([latest]);
    expect(await repository.readSourceSnapshot(workspaceId, initial.snapshotId)).toEqual(initial);
    expect(await repository.readSourceSnapshot(workspaceId, middle.snapshotId)).toEqual(middle);

    const later = await repository.createSourceSnapshot({
      ...initial, snapshotId: "snapshot-4" as never, capturedAt: "2026-07-30T04:00:00.001Z", contentDigest: digest("e"),
    });
    expect(await repository.listSourceSnapshots(workspaceId, sourceId, 1)).toEqual([later]);
  });

  it("does not save a changed refresh with a missing or different snapshot parent", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    const previous = await repository.createSourceSnapshot(snapshot());
    const other = await repository.createSourceSnapshot({ ...previous, snapshotId: "snapshot-other" as never, contentDigest: digest("c") });
    const next: IngestionSourceSnapshot = { ...previous, snapshotId: "snapshot-2" as never, contentDigest: digest("d") };
    const changed: IngestionSourceRefreshRecord = { ...refresh(), outcome: "changed", currentSnapshotId: next.snapshotId };

    await expect(repository.recordSourceRefreshWithSnapshot(next, changed)).rejects.toThrow("matching snapshot");
    await expect(repository.recordSourceRefreshWithSnapshot({ ...next, previousSnapshotId: other.snapshotId }, changed)).rejects.toThrow("matching snapshot");
    expect(await repository.readSourceSnapshot(previous.workspaceId, next.snapshotId)).toBeUndefined();
    expect(await repository.listSourceRefreshes(previous.workspaceId, previous.sourceId)).toEqual([]);
    expect(await repository.readSourceSnapshot(previous.workspaceId, other.snapshotId)).toEqual(other);
  });

  it("does not save an unpaired changed refresh", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    const previous = await repository.createSourceSnapshot(snapshot());
    const changed: IngestionSourceRefreshRecord = { ...refresh(), outcome: "changed", currentSnapshotId: "snapshot-2" as never };

    await expect(repository.recordSourceRefresh(changed)).rejects.toThrow("matching snapshot");
    expect(await repository.listSourceRefreshes(previous.workspaceId, previous.sourceId)).toEqual([]);
  });

  it("does not record a changed refresh when both identifiers normalize to the same old snapshot", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    const initial = snapshot();
    const previous = await repository.createSourceSnapshot({ ...initial, previousSnapshotId: initial.snapshotId });
    const changed: IngestionSourceRefreshRecord = {
      ...refresh(), outcome: "changed", currentSnapshotId: previous.snapshotId,
      previousSnapshotId: `${previous.snapshotId} ` as IngestionSourceSnapshot["snapshotId"],
    };

    await expect(repository.recordSourceRefreshWithSnapshot(previous, changed)).rejects.toThrow("matching snapshot");
    expect(await repository.listSourceRefreshes(previous.workspaceId, previous.sourceId)).toEqual([]);
    expect(await repository.readSourceSnapshot(previous.workspaceId, previous.snapshotId)).toEqual(previous);
  });

  it("does not use a previous snapshot with identity or scope inconsistent with its storage key", async () => {
    const previous = snapshot();
    const next: IngestionSourceSnapshot = { ...previous, snapshotId: "snapshot-2" as never, contentDigest: digest("d"), previousSnapshotId: previous.snapshotId };
    const changed: IngestionSourceRefreshRecord = { ...refresh(), outcome: "changed", currentSnapshotId: next.snapshotId };
    const mismatches = [
      { snapshotId: "snapshot-other" as IngestionSourceSnapshot["snapshotId"] },
      { sourceId: "source-other" as IngestionSourceSnapshot["sourceId"] },
      { workspaceId: createWorkspaceId("workspace-b") },
      { organizationId: createOrganizationId("organization-b") },
    ];
    for (const mismatch of mismatches) {
      const documents = createInMemoryStructuredDocumentStore();
      await documents.writeDocument(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, `${previous.workspaceId}/${previous.snapshotId}`, { ...previous, ...mismatch }, { expectedRevision: 0 });
      const repository = createStructuredIngestionAcquisitionRepository(documents);

      await expect(repository.recordSourceRefreshWithSnapshot(next, changed)).rejects.toThrow("previous source snapshot");
      expect(await repository.readSourceSnapshot(previous.workspaceId, next.snapshotId)).toBeUndefined();
      expect(await repository.listSourceRefreshes(previous.workspaceId, previous.sourceId)).toEqual([]);
    }
  });

  it("creates tasks idempotently and applies exact monotonic optimistic revisions", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    await expect(repository.createTask(task())).resolves.toEqual(task());
    await expect(repository.createTask(task())).resolves.toEqual(task());
    await expect(repository.createTask({ ...task(), kind: "website", files: [{ ...task().files[0]!, websiteSource: { requestedUrl: "https://example.com/" } }] })).rejects.toThrow("revision conflict");
    const next = { ...task(), revision: 2, updatedAt: "2026-07-30T04:01:00.000Z", files: [{ ...task().files[0]!, acceptedBytes: 8, nextChunkIndex: 2, lastChunk: { index: 1, sizeBytes: 4, digest: digest("c") } }] } as IngestionTaskRecord;
    await expect(repository.saveTask(next, 1)).resolves.toMatchObject({ revision: 2, progress: { acceptedBytes: 8, percent: 80 } });
    await expect(repository.saveTask({ ...next, revision: 3 }, 1)).rejects.toThrow("revision");
    await expect(repository.saveTask({ ...next, revision: 3, files: [{ ...next.files[0]!, acceptedBytes: 2 }] }, 2)).rejects.toThrow("monotonic");
  });

  it("allows only one concurrent update from the same revision", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    await repository.createTask(task());
    const next = (acceptedBytes: number) => ({ ...task(), revision: 2, updatedAt: "2026-07-30T04:01:00.000Z", files: [{ ...task().files[0]!, acceptedBytes, nextChunkIndex: 2, lastChunk: { index: 1, sizeBytes: acceptedBytes - 4, digest: digest(acceptedBytes === 8 ? "d" : "e") } }] } as IngestionTaskRecord);
    const results = await Promise.allSettled([repository.saveTask(next(8), 1), repository.saveTask(next(9), 1)]);
    expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
    expect(results.filter((result) => result.status === "rejected").length).toBe(1);
  });

  it("isolates workspace and organization task and source records", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const organizationA = createOrganizationId("organization-a");
    const repository = createStructuredIngestionAcquisitionRepository(documents.forOrganization(organizationA));
    await repository.createTask(task("workspace-a", "organization-a"));
    await repository.createSourceSnapshot(snapshot("organization-a"));
    await repository.recordSourceRefresh(refresh("organization-a"));
    expect(await repository.readTask(createWorkspaceId("workspace-b"), "task-1" as never)).toBeUndefined();
    expect(await repository.listSourceSnapshots(createWorkspaceId("workspace-b"), "source-1" as never)).toEqual([]);
    expect(await repository.listSourceRefreshes(createWorkspaceId("workspace-a"), "source-1" as never)).toEqual([refresh("organization-a")]);
    await expect(repository.createTask(task("workspace-a", "organization-b"))).rejects.toThrow("organization scope");
    expect(await createStructuredIngestionAcquisitionRepository(documents.forOrganization(createOrganizationId("organization-b"))).listTasks(createWorkspaceId("workspace-a"))).toEqual([]);
  });

  it("keeps snapshots and refresh outcomes append-only and fails closed for malformed persisted tasks", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const repository = createStructuredIngestionAcquisitionRepository(documents);
    await expect(repository.createSourceSnapshot(snapshot())).resolves.toEqual(snapshot());
    await expect(repository.createSourceSnapshot(snapshot())).resolves.toEqual(snapshot());
    await expect(repository.createSourceSnapshot({ ...snapshot(), contentDigest: digest("f") })).rejects.toThrow("revision conflict");
    await expect(repository.recordSourceRefresh(refresh())).resolves.toEqual(refresh());
    await expect(repository.recordSourceRefresh({ ...refresh(), outcome: "removed", currentSnapshotId: undefined })).rejects.toThrow("revision conflict");
    await documents.writeDocument(INGESTION_TASK_NAMESPACE, "workspace-a/bad-task", { ...task(), taskId: "bad-task", files: [{ ...task().files[0]!, fileName: "../secret" }] }, { expectedRevision: 0 });
    await expect(repository.readTask(createWorkspaceId("workspace-a"), "bad-task" as never)).rejects.toThrow("must not contain a path");
  });
});
