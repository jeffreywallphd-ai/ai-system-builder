import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
  SystemBuilderRevisionId,
  SystemBuilderSystemId,
} from "../../../contracts/system-builder";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface SystemBuilderRepositoryPort {
  createRecordAndRevision(record: SystemBuilderRecord, revision: SystemBuilderRevision): Promise<{ readonly record: SystemBuilderRecord; readonly revision: SystemBuilderRevision }>;
  createRecord(record: SystemBuilderRecord): Promise<SystemBuilderRecord>;
  readRecord(workspaceId: WorkspaceId, systemId: SystemBuilderSystemId): Promise<SystemBuilderRecord | undefined>;
  listRecords(workspaceId: WorkspaceId, includeArchived?: boolean): Promise<readonly SystemBuilderRecord[]>;
  updateRecord(record: SystemBuilderRecord, expectedRevision: number): Promise<SystemBuilderRecord>;
  saveRevision(revision: SystemBuilderRevision): Promise<SystemBuilderRevision>;
  saveRevisionAndRecord(revision: SystemBuilderRevision, record: SystemBuilderRecord, expectedRecordRevision: number): Promise<{ readonly revision: SystemBuilderRevision; readonly record: SystemBuilderRecord }>;
  readRevision(workspaceId: WorkspaceId, systemId: SystemBuilderSystemId, revisionId: SystemBuilderRevisionId): Promise<SystemBuilderRevision | undefined>;
  listRevisions(workspaceId: WorkspaceId, systemId: SystemBuilderSystemId): Promise<readonly SystemBuilderRevision[]>;
}
