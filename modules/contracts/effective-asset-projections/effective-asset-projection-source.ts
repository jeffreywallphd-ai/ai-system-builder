import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { AuthoredAssetId, AssetDraftId, AssetOverrideId, AssetRevisionId } from "../asset-authoring";
import type { UserLibraryAssetId, UserLibraryRelationshipId } from "../user-library";
import type { EffectiveAssetProjectionId } from "./effective-asset-projection-identity";
import type { EffectiveAssetProjectionPolicy } from "./effective-asset-projection-policy";

export const EFFECTIVE_ASSET_PROJECTION_SOURCE_KINDS = ["system-foundation","workspace-local","user-library-linked","user-library-copied","workspace-imported","workspace-authored","workspace-authored-draft","workspace-authored-revision","workspace-customized","linked-with-workspace-override","copied-with-workspace-override","imported-with-workspace-override","system-derived-override"] as const;
export type EffectiveAssetProjectionSourceKind = (typeof EFFECTIVE_ASSET_PROJECTION_SOURCE_KINDS)[number];
export const isEffectiveAssetProjectionSourceKind=(v:unknown):v is EffectiveAssetProjectionSourceKind=>typeof v==="string"&&EFFECTIVE_ASSET_PROJECTION_SOURCE_KINDS.includes(v.trim().toLowerCase() as EffectiveAssetProjectionSourceKind);
export function normalizeEffectiveAssetProjectionSourceKind(v:string):EffectiveAssetProjectionSourceKind{const n=v.trim().toLowerCase() as EffectiveAssetProjectionSourceKind; if(!EFFECTIVE_ASSET_PROJECTION_SOURCE_KINDS.includes(n)) throw new Error("Effective asset projection source kind is invalid."); return n;}

export type EffectiveAssetProjectionSource = { sourceKind: EffectiveAssetProjectionSourceKind; targetWorkspaceId: WorkspaceId; sourceAssetReference?: AssetReference; effectiveAssetReference?: AssetReference; sourceWorkspaceId?: WorkspaceId; userLibraryAssetId?: UserLibraryAssetId; authoredAssetId?: AuthoredAssetId; draftId?: AssetDraftId; revisionId?: AssetRevisionId; overrideId?: AssetOverrideId; sourceRelationshipId?: UserLibraryRelationshipId; sourceLabel?: string; };
export type EffectiveAssetProjectionTarget = { targetWorkspaceId: WorkspaceId; effectiveAssetReference: AssetReference; projectionId?: EffectiveAssetProjectionId; intendedPolicy: EffectiveAssetProjectionPolicy; targetLabel?: string; };
