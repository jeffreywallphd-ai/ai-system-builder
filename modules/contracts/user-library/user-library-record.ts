import type { AssetMetadata, AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { UserLibraryAssetId, UserLibraryAssetVersion } from "./user-library-identity";
import type { UserLibraryProvenanceSummary } from "./user-library-provenance";

export const USER_LIBRARY_ASSET_RECORD_STATUSES = [
  "active",
  "archived",
  "deleting",
] as const;

export type UserLibraryAssetRecordStatus =
  (typeof USER_LIBRARY_ASSET_RECORD_STATUSES)[number];

export interface UserLibraryAssetRecord {
  readonly userLibraryAssetId: UserLibraryAssetId;
  readonly version: UserLibraryAssetVersion;
  readonly displayName: string;
  readonly summary?: string;
  readonly description?: string;
  readonly status: UserLibraryAssetRecordStatus;
  readonly sourceAssetReference: AssetReference;
  readonly sourceWorkspaceId?: WorkspaceId;
  readonly sourceAssetVersion?: string;
  readonly assetReference: AssetReference;
  readonly provenance: UserLibraryProvenanceSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: AssetMetadata;
}

export function isUserLibraryAssetRecordStatus(
  value: string,
): value is UserLibraryAssetRecordStatus {
  return USER_LIBRARY_ASSET_RECORD_STATUSES.includes(
    value as UserLibraryAssetRecordStatus,
  );
}
