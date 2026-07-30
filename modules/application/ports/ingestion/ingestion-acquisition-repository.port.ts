import type {
  IngestionSourceId,
  IngestionSourceRefreshRecord,
  IngestionSourceSnapshot,
  IngestionSourceSnapshotId,
  IngestionTaskId,
  IngestionTaskRecord,
} from "../../../contracts/ingestion";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface IngestionAcquisitionRepositoryPort {
  createTask(task: IngestionTaskRecord): Promise<IngestionTaskRecord>;
  readTask(workspaceId: WorkspaceId, taskId: IngestionTaskId): Promise<IngestionTaskRecord | undefined>;
  listTasks(workspaceId: WorkspaceId, limit?: number): Promise<readonly IngestionTaskRecord[]>;
  listExpiredCheckpointTasks(workspaceId: WorkspaceId, expiresAtOrBefore: string, limit?: number): Promise<readonly IngestionTaskRecord[]>;
  saveTask(task: IngestionTaskRecord, expectedRevision: number): Promise<IngestionTaskRecord>;
  saveTaskWithSourceSnapshot(
    task: IngestionTaskRecord,
    expectedRevision: number,
    snapshot: IngestionSourceSnapshot,
  ): Promise<{ readonly task: IngestionTaskRecord; readonly snapshot: IngestionSourceSnapshot }>;
  createSourceSnapshot(snapshot: IngestionSourceSnapshot): Promise<IngestionSourceSnapshot>;
  readSourceSnapshot(workspaceId: WorkspaceId, snapshotId: IngestionSourceSnapshotId): Promise<IngestionSourceSnapshot | undefined>;
  listSourceSnapshots(workspaceId: WorkspaceId, sourceId: IngestionSourceId, limit?: number): Promise<readonly IngestionSourceSnapshot[]>;
  recordSourceRefresh(record: IngestionSourceRefreshRecord): Promise<IngestionSourceRefreshRecord>;
  recordSourceRefreshWithSnapshot(
    snapshot: IngestionSourceSnapshot,
    record: IngestionSourceRefreshRecord,
  ): Promise<{ readonly snapshot: IngestionSourceSnapshot; readonly refresh: IngestionSourceRefreshRecord }>;
  listSourceRefreshes(workspaceId: WorkspaceId, sourceId: IngestionSourceId, limit?: number): Promise<readonly IngestionSourceRefreshRecord[]>;
}
