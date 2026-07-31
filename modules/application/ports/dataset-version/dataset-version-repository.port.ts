import type {
  DatasetVersionId,
  DatasetVersionPublicationId,
  DatasetVersionPublicationRecord,
  DatasetVersionRecord,
} from "../../../contracts/dataset";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface DatasetVersionRepositoryPort {
  createVersion(version: DatasetVersionRecord): Promise<DatasetVersionRecord>;
  readVersion(
    workspaceId: WorkspaceId,
    versionId: DatasetVersionId,
  ): Promise<DatasetVersionRecord | undefined>;
  listVersions(
    workspaceId: WorkspaceId,
    datasetId?: string,
  ): Promise<readonly DatasetVersionRecord[]>;
  recordPublication(
    publication: DatasetVersionPublicationRecord,
  ): Promise<DatasetVersionPublicationRecord>;
  readPublication(
    workspaceId: WorkspaceId,
    publicationId: DatasetVersionPublicationId,
  ): Promise<DatasetVersionPublicationRecord | undefined>;
  listPublications(
    workspaceId: WorkspaceId,
    versionId?: DatasetVersionId,
  ): Promise<readonly DatasetVersionPublicationRecord[]>;
}
