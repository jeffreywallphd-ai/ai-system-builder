import type {
  IngestionSourceId,
  IngestionSourceRefreshRecord,
  IngestionSourceSnapshot,
  IngestionSourceSnapshotId,
  IngestionTaskId,
  IngestionTaskFileId,
  IngestionTaskRecord,
} from "../../../contracts/ingestion";
import type { ArtifactStorageBinding } from "../../../contracts/storage";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { ArtifactCatalogRecord } from "../artifact-catalog";

export interface VerifiedIngestionProviderArtifact {
  readonly catalog: ArtifactCatalogRecord & { readonly workspaceId: WorkspaceId };
  readonly binding: ArtifactStorageBinding & { readonly workspaceId: WorkspaceId };
}

export interface IngestionAcquisitionRepositoryPort {
  createTask(task: IngestionTaskRecord): Promise<IngestionTaskRecord>;
  readTask(workspaceId: WorkspaceId, taskId: IngestionTaskId): Promise<IngestionTaskRecord | undefined>;
  listTasks(workspaceId: WorkspaceId, limit?: number): Promise<readonly IngestionTaskRecord[]>;
  listExpiredCheckpointTasks(workspaceId: WorkspaceId, expiresAtOrBefore: string, limit?: number): Promise<readonly IngestionTaskRecord[]>;
  saveTask(task: IngestionTaskRecord, expectedRevision: number): Promise<IngestionTaskRecord>;
  markCancelledCheckpointCleanupPending(input: {
    readonly workspaceId: WorkspaceId;
    readonly taskId: IngestionTaskId;
    readonly fileId: IngestionTaskFileId;
    readonly checkpointId: string;
    readonly expectedRevision: number;
    readonly updatedAt: string;
  }): Promise<void>;
  saveTaskWithSourceSnapshot(
    task: IngestionTaskRecord,
    expectedRevision: number,
    snapshot: IngestionSourceSnapshot,
  ): Promise<{ readonly task: IngestionTaskRecord; readonly snapshot: IngestionSourceSnapshot }>;
  /** Commit the selected repository backing, catalog, lineage and task through the same storage owner. */
  saveTaskWithProviderArtifact?(
    task: IngestionTaskRecord,
    expectedRevision: number,
    snapshot: IngestionSourceSnapshot,
    artifact: VerifiedIngestionProviderArtifact,
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
