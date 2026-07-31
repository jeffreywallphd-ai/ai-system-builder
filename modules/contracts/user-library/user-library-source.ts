import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { UserLibraryAssetId, UserLibraryAssetVersion } from "./user-library-identity";

export const USER_LIBRARY_OWNERSHIP_SCOPES = [
  "system",
  "workspace",
  "user-library",
] as const;

export type UserLibraryOwnershipScope = (typeof USER_LIBRARY_OWNERSHIP_SCOPES)[number];

export const USER_LIBRARY_SOURCE_KINDS = [
  "system-activated",
  "workspace-local",
  "user-library-linked",
  "user-library-copied",
  "workspace-imported",
] as const;

export type UserLibrarySourceKind = (typeof USER_LIBRARY_SOURCE_KINDS)[number];

export interface UserLibraryAssetReference {
  readonly assetId: UserLibraryAssetId;
  readonly version?: UserLibraryAssetVersion;
  readonly label?: string;
}

export interface WorkspaceAssetSourceReference {
  readonly workspaceId: WorkspaceId;
  readonly assetReference: AssetReference;
  readonly assetVersion?: string;
}

export function isUserLibraryOwnershipScope(value: string): value is UserLibraryOwnershipScope {
  return USER_LIBRARY_OWNERSHIP_SCOPES.includes(value as UserLibraryOwnershipScope);
}

export function isUserLibrarySourceKind(value: string): value is UserLibrarySourceKind {
  return USER_LIBRARY_SOURCE_KINDS.includes(value as UserLibrarySourceKind);
}
