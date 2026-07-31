import { describe, expect, it } from "../../../../testing/node-test";
import { createOrganizationId } from "../../../../contracts/organization";
import type { IngestionSourceRefreshRecord, IngestionSourceSnapshot, IngestionTaskRecord } from "../../../../contracts/ingestion";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import {
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
  it("commits a finalized task and matching source snapshot in one optimistic transaction", async () => {
    const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
    await repository.createTask(task());
    const committedTask: IngestionTaskRecord = {
      ...task(),
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
          key: snapshot().rawArtifactKey,
          mediaType: "application/jsonl",
          sizeBytes: 10,
          digest: snapshot().contentDigest,
          sourceId: snapshot().sourceId,
          sourceSnapshotId: snapshot().snapshotId,
        },
      }],
    };
    await expect(repository.saveTaskWithSourceSnapshot(committedTask, 1, snapshot())).resolves.toMatchObject({
      task: { revision: 2, files: [{ status: "finalized" }] },
      snapshot: { snapshotId: "snapshot-1" },
    });
    expect(await repository.readSourceSnapshot(createWorkspaceId("workspace-a"), snapshot().snapshotId)).toEqual(snapshot());
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
    expect((await repository.listSourceSnapshots(createWorkspaceId("workspace-a"), snapshot().sourceId)).length).toBe(2);
    expect(await repository.listSourceRefreshes(createWorkspaceId("workspace-a"), snapshot().sourceId)).toEqual([changed]);
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
