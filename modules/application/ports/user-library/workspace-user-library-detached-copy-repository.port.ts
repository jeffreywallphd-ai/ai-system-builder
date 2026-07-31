import type { AssetMetadata, AssetReference } from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";
import type {
  UserLibraryAssetReference,
  UserLibraryAssetVersion,
  UserLibraryProvenanceSummary,
  UserLibraryRelationshipId,
} from "../../../contracts/user-library";

export type WorkspaceUserLibraryDetachedCopyStatus = "active" | "archived" | "deleting";

export interface WorkspaceUserLibraryDetachedCopyRecord {
  readonly copyId: UserLibraryRelationshipId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly copiedAssetReference: AssetReference;
  readonly sourceUserLibraryAssetReference: UserLibraryAssetReference;
  readonly selectedVersion: UserLibraryAssetVersion;
  readonly relationshipStatus: "detached-workspace-owned-copy";
  readonly status: WorkspaceUserLibraryDetachedCopyStatus;
  readonly provenance: UserLibraryProvenanceSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: AssetMetadata;
}

export interface WorkspaceUserLibraryDetachedCopyFindQuery {
  readonly targetWorkspaceId: WorkspaceId;
  readonly sourceUserLibraryAssetReference: UserLibraryAssetReference;
  readonly selectedVersion: UserLibraryAssetVersion;
}

export interface WorkspaceUserLibraryDetachedCopyListQuery {
  readonly targetWorkspaceId: WorkspaceId;
  readonly limit?: number;
}

export interface WorkspaceUserLibraryDetachedCopyRepositoryPort {
  saveWorkspaceUserLibraryDetachedCopyRecord(
    record: WorkspaceUserLibraryDetachedCopyRecord,
  ): Promise<WorkspaceUserLibraryDetachedCopyRecord>;
  findWorkspaceUserLibraryDetachedCopyRecord(
    query: WorkspaceUserLibraryDetachedCopyFindQuery,
  ): Promise<WorkspaceUserLibraryDetachedCopyRecord | undefined>;
  listWorkspaceUserLibraryDetachedCopyRecords(
    query: WorkspaceUserLibraryDetachedCopyListQuery,
  ): Promise<{ readonly records: readonly WorkspaceUserLibraryDetachedCopyRecord[] }>;
}
