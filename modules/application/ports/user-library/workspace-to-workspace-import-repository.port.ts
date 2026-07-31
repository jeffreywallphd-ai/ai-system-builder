import type { AssetMetadata, AssetReference } from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";
import type {
  UserLibraryAssetVersion,
  UserLibraryProvenanceSummary,
  UserLibraryRelationshipId,
} from "../../../contracts/user-library";

export type WorkspaceToWorkspaceImportStatus = "active" | "archived" | "deleting";

export interface WorkspaceToWorkspaceImportRecord {
  readonly importId: UserLibraryRelationshipId;
  readonly sourceWorkspaceId: WorkspaceId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly sourceAssetReference: AssetReference;
  readonly sourceAssetVersion?: UserLibraryAssetVersion;
  readonly importedAssetReference: AssetReference;
  readonly relationshipStatus: "detached-workspace-owned-copy";
  readonly status: WorkspaceToWorkspaceImportStatus;
  readonly provenance: UserLibraryProvenanceSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: AssetMetadata;
}

export interface WorkspaceToWorkspaceImportFindQuery {
  readonly sourceWorkspaceId: WorkspaceId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly sourceAssetReference: AssetReference;
  readonly sourceAssetVersion?: UserLibraryAssetVersion;
}

export interface WorkspaceToWorkspaceImportListQuery {
  readonly targetWorkspaceId: WorkspaceId;
  readonly limit?: number;
}

export interface WorkspaceToWorkspaceImportRepositoryPort {
  saveWorkspaceToWorkspaceImportRecord(
    record: WorkspaceToWorkspaceImportRecord,
  ): Promise<WorkspaceToWorkspaceImportRecord>;
  findWorkspaceToWorkspaceImportRecord(
    query: WorkspaceToWorkspaceImportFindQuery,
  ): Promise<WorkspaceToWorkspaceImportRecord | undefined>;
  listWorkspaceToWorkspaceImportRecords(
    query: WorkspaceToWorkspaceImportListQuery,
  ): Promise<{ readonly records: readonly WorkspaceToWorkspaceImportRecord[] }>;
}
