import type { AssetMetadata, AssetReference } from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";

export type WorkspaceAssetForUserLibraryOwnershipScope = "workspace" | "system" | "user-library" | "unknown";

export type WorkspaceAssetForUserLibraryStatus = "active" | "archived" | "deleting" | "invalid" | "unknown";

export interface WorkspaceAssetForUserLibraryDescriptor {
  readonly sourceWorkspaceId: WorkspaceId;
  readonly assetReference: AssetReference;
  readonly assetVersion?: string;
  readonly displayName?: string;
  readonly summary?: string;
  readonly ownershipScope: WorkspaceAssetForUserLibraryOwnershipScope;
  readonly status?: WorkspaceAssetForUserLibraryStatus;
  readonly sourceKind?: "workspace-local" | "system-activated" | "user-library-linked" | "user-library-copied" | "workspace-imported" | "unsupported";
  readonly metadata?: AssetMetadata;
}

export interface WorkspaceAssetForUserLibraryReadPort {
  readWorkspaceAssetForUserLibrary(
    sourceWorkspaceId: WorkspaceId,
    sourceAssetReference: AssetReference,
  ): Promise<WorkspaceAssetForUserLibraryDescriptor | undefined>;
}
