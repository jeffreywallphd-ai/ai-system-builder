import type { AssetReference } from "../../../contracts/asset";
import type { AssetCustomizationTargetSourceKind, AssetOverrideScope } from "../../../contracts/asset-authoring";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetCustomizationTargetDescriptor {
  readonly targetWorkspaceId: WorkspaceId;
  readonly sourceKind: AssetCustomizationTargetSourceKind;
  readonly effectiveAssetReference: AssetReference;
  readonly status?: "active" | "disabled" | "archived" | "invalid";
  readonly sourceWorkspaceId?: WorkspaceId;
  readonly relationshipId?: string;
  readonly currentBaseRevision?: string;
  readonly currentBaseVersion?: string;
  readonly sourceUserLibraryAssetReference?: AssetReference;
  readonly supportsOverride?: boolean;
  readonly supportedScopes?: readonly AssetOverrideScope[];
}

export interface AssetCustomizationTargetReaderPort {
  readCustomizationTargetByReference(targetWorkspaceId: WorkspaceId, effectiveAssetReference: AssetReference): Promise<AssetCustomizationTargetDescriptor | undefined>;
}
