import type { WorkspaceId } from "../../../contracts/workspace";
import type {
  UserLibraryAssetReference,
  UserLibraryLinkId,
  UserLibraryPropagationPolicy,
  WorkspaceUserLibraryLinkRecord,
  WorkspaceUserLibraryLinkStatus,
} from "../../../contracts/user-library";

export interface WorkspaceUserLibraryLinkListQuery {
  readonly targetWorkspaceId: WorkspaceId;
  readonly status?: WorkspaceUserLibraryLinkStatus;
  readonly propagationPolicy?: UserLibraryPropagationPolicy;
  readonly userLibraryAssetReference?: UserLibraryAssetReference;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface WorkspaceUserLibraryLinkAssetListQuery {
  readonly targetWorkspaceId: WorkspaceId;
  readonly userLibraryAssetReference: UserLibraryAssetReference;
  readonly status?: WorkspaceUserLibraryLinkStatus;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface WorkspaceUserLibraryLinkFindExistingQuery {
  readonly targetWorkspaceId: WorkspaceId;
  readonly userLibraryAssetReference: UserLibraryAssetReference;
  readonly propagationPolicy?: UserLibraryPropagationPolicy;
}

export interface WorkspaceUserLibraryLinkListResult {
  readonly links: readonly WorkspaceUserLibraryLinkRecord[];
  readonly nextCursor?: string;
}

export interface WorkspaceUserLibraryLinkRepositoryPort {
  saveWorkspaceUserLibraryLinkRecord(record: WorkspaceUserLibraryLinkRecord): Promise<WorkspaceUserLibraryLinkRecord>;
  updateWorkspaceUserLibraryLinkRecord(record: WorkspaceUserLibraryLinkRecord): Promise<WorkspaceUserLibraryLinkRecord>;
  readWorkspaceUserLibraryLinkRecord(
    targetWorkspaceId: WorkspaceId,
    linkId: UserLibraryLinkId,
  ): Promise<WorkspaceUserLibraryLinkRecord | undefined>;
  listWorkspaceUserLibraryLinkRecords(
    query: WorkspaceUserLibraryLinkListQuery,
  ): Promise<WorkspaceUserLibraryLinkListResult>;
  listWorkspaceUserLibraryLinkRecordsByAsset(
    query: WorkspaceUserLibraryLinkAssetListQuery,
  ): Promise<WorkspaceUserLibraryLinkListResult>;
  findWorkspaceUserLibraryLinkRecord(
    query: WorkspaceUserLibraryLinkFindExistingQuery,
  ): Promise<WorkspaceUserLibraryLinkRecord | undefined>;
  archiveWorkspaceUserLibraryLinkRecord?(
    targetWorkspaceId: WorkspaceId,
    linkId: UserLibraryLinkId,
    archivedAt: string,
  ): Promise<WorkspaceUserLibraryLinkRecord | undefined>;
}
