import type { AssetReference } from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";
import type {
  UserLibraryAssetId,
  UserLibraryAssetRecord,
  UserLibraryAssetRecordStatus,
  UserLibraryAssetReference,
  UserLibraryAssetVersion,
  UserLibrarySourceKind,
} from "../../../contracts/user-library";

export interface UserLibraryAssetSourceIdentityQuery {
  readonly sourceWorkspaceId?: WorkspaceId;
  readonly sourceAssetReference: AssetReference;
  readonly sourceAssetVersion?: string;
}

export interface UserLibraryAssetListQuery {
  readonly text?: string;
  readonly status?: UserLibraryAssetRecordStatus;
  readonly sourceWorkspaceId?: WorkspaceId;
  readonly sourceAssetReference?: AssetReference;
  readonly sourceKind?: UserLibrarySourceKind;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface UserLibraryAssetListResult {
  readonly assets: readonly UserLibraryAssetRecord[];
  readonly nextCursor?: string;
}

export interface UserLibraryAssetRepositoryPort {
  saveUserLibraryAssetRecord(record: UserLibraryAssetRecord): Promise<UserLibraryAssetRecord>;
  updateUserLibraryAssetRecord(record: UserLibraryAssetRecord): Promise<UserLibraryAssetRecord>;
  readUserLibraryAssetRecord(reference: UserLibraryAssetReference): Promise<UserLibraryAssetRecord | undefined>;
  readUserLibraryAssetRecordById(
    assetId: UserLibraryAssetId,
    version?: UserLibraryAssetVersion,
  ): Promise<UserLibraryAssetRecord | undefined>;
  listUserLibraryAssetRecords(query?: UserLibraryAssetListQuery): Promise<UserLibraryAssetListResult>;
  findUserLibraryAssetRecordBySource(
    query: UserLibraryAssetSourceIdentityQuery,
  ): Promise<UserLibraryAssetRecord | undefined>;
  archiveUserLibraryAssetRecord?(reference: UserLibraryAssetReference, archivedAt: string): Promise<UserLibraryAssetRecord | undefined>;
}
