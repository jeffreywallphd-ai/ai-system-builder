import type { WorkspaceId } from "../workspace";
import type { AssetDraftId, AssetOverrideId, AssetRevisionId, AuthoredAssetId } from "./asset-authoring-identity";
import type { SafeAssetEditableFieldPatch } from "./asset-authoring-editable-fields";
import type { AssetCustomizationTarget, AssetAuthoringConflictResolutionAction } from "./asset-authoring-models";

export interface CreateWorkspaceAuthoredAssetCommand { readonly workspaceId: WorkspaceId; readonly initialEditableValues: SafeAssetEditableFieldPatch; readonly baseTarget?: AssetCustomizationTarget; }
export interface CreateAssetDraftCommand { readonly targetWorkspaceId: WorkspaceId; readonly baseTarget?: AssetCustomizationTarget; readonly draftEditableValues: SafeAssetEditableFieldPatch; }
export interface UpdateAssetDraftCommand { readonly targetWorkspaceId: WorkspaceId; readonly draftId: AssetDraftId; readonly draftEditablePatch: SafeAssetEditableFieldPatch; }
export interface PublishAssetDraftCommand { readonly targetWorkspaceId: WorkspaceId; readonly draftId: AssetDraftId; readonly expectedBaseRevision?: string; }
export interface CreateAssetOverrideCommand { readonly targetWorkspaceId: WorkspaceId; readonly target: AssetCustomizationTarget; readonly overrideValues: SafeAssetEditableFieldPatch; readonly baseRevision?: string; }
export interface UpdateAssetOverrideCommand { readonly targetWorkspaceId: WorkspaceId; readonly overrideId: AssetOverrideId; readonly overrideValues: SafeAssetEditableFieldPatch; readonly expectedBaseRevision?: string; }
export interface DisableAssetOverrideCommand { readonly targetWorkspaceId: WorkspaceId; readonly overrideId: AssetOverrideId; }
export interface ResolveAssetCustomizationConflictCommand { readonly targetWorkspaceId: WorkspaceId; readonly authoredAssetId?: AuthoredAssetId; readonly revisionId?: AssetRevisionId; readonly overrideId?: AssetOverrideId; readonly resolutionAction: AssetAuthoringConflictResolutionAction; }
