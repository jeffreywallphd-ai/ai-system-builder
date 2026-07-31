import type { AssetMetadata, AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { UserLibraryAssetId } from "./user-library-identity";
import type { UserLibraryActorRequestContext } from "./user-library-provenance";
import type { UserLibraryPropagationPolicy } from "./user-library-propagation-policy";
import type { UserLibraryAssetReference } from "./user-library-source";
import type { UserLibraryVersionSelection } from "./workspace-user-library-link";

export const USER_LIBRARY_PROMOTION_ORIGIN_WORKSPACE_BEHAVIORS = [
  "keep-independent-workspace-copy",
  "replace-with-user-library-link",
  "no-immediate-workspace-change",
] as const;

export type UserLibraryPromotionOriginWorkspaceBehavior =
  (typeof USER_LIBRARY_PROMOTION_ORIGIN_WORKSPACE_BEHAVIORS)[number];

export interface PromoteWorkspaceAssetToUserLibraryCommand {
  readonly sourceWorkspaceId: WorkspaceId;
  readonly sourceAssetReference: AssetReference;
  readonly sourceAssetVersion?: string;
  readonly displayName?: string;
  readonly summary?: string;
  readonly requestedUserLibraryAssetId?: UserLibraryAssetId;
  readonly originWorkspaceBehavior: UserLibraryPromotionOriginWorkspaceBehavior;
  readonly requestContext?: UserLibraryActorRequestContext;
  readonly metadata?: AssetMetadata;
}

export interface LinkUserLibraryAssetToWorkspaceCommand {
  readonly targetWorkspaceId: WorkspaceId;
  readonly userLibraryAssetReference: UserLibraryAssetReference;
  readonly versionSelection: UserLibraryVersionSelection;
  readonly propagationPolicy: UserLibraryPropagationPolicy;
  readonly displayLabel?: string;
  readonly requestContext?: UserLibraryActorRequestContext;
  readonly metadata?: AssetMetadata;
}

export interface CopyUserLibraryAssetToWorkspaceCommand {
  readonly targetWorkspaceId: WorkspaceId;
  readonly userLibraryAssetReference: UserLibraryAssetReference;
  readonly selectedVersion: string;
  readonly displayName?: string;
  readonly summary?: string;
  readonly requestContext?: UserLibraryActorRequestContext;
  readonly metadata?: AssetMetadata;
}

export interface ImportWorkspaceAssetToWorkspaceCommand {
  readonly sourceWorkspaceId: WorkspaceId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly sourceAssetReference: AssetReference;
  readonly sourceAssetVersion?: string;
  readonly displayName?: string;
  readonly summary?: string;
  readonly requestContext?: UserLibraryActorRequestContext;
  readonly metadata?: AssetMetadata;
}

export function isUserLibraryPromotionOriginWorkspaceBehavior(
  value: string,
): value is UserLibraryPromotionOriginWorkspaceBehavior {
  return USER_LIBRARY_PROMOTION_ORIGIN_WORKSPACE_BEHAVIORS.includes(
    value as UserLibraryPromotionOriginWorkspaceBehavior,
  );
}
