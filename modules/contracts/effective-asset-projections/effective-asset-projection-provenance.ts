import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { AuthoredAssetId, AssetDraftId, AssetOverrideId, AssetRevisionId } from "../asset-authoring";
import type { UserLibraryAssetId, UserLibraryRelationshipId } from "../user-library";
import type { SafeEffectiveAssetMetadata } from "./effective-asset-projected-fields";
export type EffectiveAssetProjectionProvenanceKind = "projected-from-system-foundation"|"projected-from-workspace-local-asset"|"projected-from-user-library-link"|"projected-from-detached-user-library-copy"|"projected-from-workspace-import"|"projected-from-authored-asset-revision"|"projected-from-authored-draft-preview"|"projected-from-active-override"|"blocked-by-conflict"|"blocked-by-unsupported-field"|"blocked-by-missing-source";
export type EffectiveAssetProjectionProvenance = { kind: EffectiveAssetProjectionProvenanceKind; targetWorkspaceId: WorkspaceId; sourceWorkspaceId?: WorkspaceId; sourceAssetReference?: AssetReference; effectiveAssetReference?: AssetReference; userLibraryAssetId?: UserLibraryAssetId; authoredAssetId?: AuthoredAssetId; draftId?: AssetDraftId; revisionId?: AssetRevisionId; overrideId?: AssetOverrideId; sourceRelationshipId?: UserLibraryRelationshipId; operationAt: string; metadata?: SafeEffectiveAssetMetadata; };
