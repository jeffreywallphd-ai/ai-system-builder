import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { AssetAuthoringDiagnostic } from "./asset-authoring-diagnostics";
import type {
  AssetDraftId,
  AssetOverrideId,
  AssetRevisionId,
  AuthoredAssetId,
} from "./asset-authoring-identity";
import type { SafeAssetEditableFieldPatch } from "./asset-authoring-editable-fields";
import type {
  AssetAuthoringStatus,
  AssetOverrideStatus,
} from "./asset-authoring-status";

export const ASSET_CUSTOMIZATION_TARGET_SOURCE_KINDS = [
  "workspace-local-asset",
  "user-library-linked-asset",
  "user-library-copied-asset",
  "workspace-imported-asset",
  "system-owned-asset",
  "authored-asset",
  "customized-asset",
] as const;
export type AssetCustomizationTargetSourceKind =
  (typeof ASSET_CUSTOMIZATION_TARGET_SOURCE_KINDS)[number];
export type AssetOverrideScope =
  | "workspace-local"
  | "linked-user-library-asset"
  | "detached-copy"
  | "workspace-import"
  | "system-derived"
  | "authored-asset";
export type AssetAuthoringConflictKind =
  | "base-version-changed"
  | "override-target-missing"
  | "editable-field-unsupported"
  | "linked-source-updated"
  | "detached-copy-source-unavailable"
  | "system-source-immutable";
export type AssetAuthoringConflictStatus = "open" | "resolved" | "dismissed";
export type AssetAuthoringConflictResolutionAction =
  | "keep-local-customization"
  | "rebase-on-new-base"
  | "create-detached-copy"
  | "disable-override"
  | "cancel-edit";
export interface AssetAuthoringProvenance {
  readonly kind:
    | "authored-from-scratch"
    | "derived-from-workspace-local-asset"
    | "customized-linked-user-library-asset"
    | "customized-detached-user-library-copy"
    | "customized-workspace-import"
    | "system-derived-override"
    | "edited-authored-asset"
    | "revised-authored-asset";
  readonly targetWorkspaceId?: WorkspaceId;
  readonly sourceWorkspaceId?: WorkspaceId;
  readonly operationAt: string;
}
export interface AssetCustomizationTarget {
  readonly targetWorkspaceId: WorkspaceId;
  readonly sourceKind: AssetCustomizationTargetSourceKind;
  readonly effectiveAssetReference: AssetReference;
  readonly baseRevision?: string;
}
export interface AuthoredAssetRecord {
  readonly authoredAssetId: AuthoredAssetId;
  readonly workspaceId: WorkspaceId;
  readonly assetReference: AssetReference;
  readonly currentRevisionId: AssetRevisionId;
  readonly status: AssetAuthoringStatus;
  readonly editableValues: SafeAssetEditableFieldPatch;
  readonly provenance: AssetAuthoringProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly diagnostics?: readonly AssetAuthoringDiagnostic[];
}
export interface AuthoredAssetDraftRecord {
  readonly draftId: AssetDraftId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly baseAssetReference?: AssetReference;
  readonly draftEditableValues: SafeAssetEditableFieldPatch;
  readonly status: AssetAuthoringStatus;
  readonly diagnostics?: readonly AssetAuthoringDiagnostic[];
  readonly provenance: AssetAuthoringProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface AuthoredAssetRevisionRecord {
  readonly revisionId: AssetRevisionId;
  readonly workspaceId: WorkspaceId;
  readonly authoredAssetId: AuthoredAssetId;
  readonly revision: string;
  readonly status: AssetAuthoringStatus;
  readonly editableValues: SafeAssetEditableFieldPatch;
  readonly provenance: AssetAuthoringProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt?: string;
}
export interface AssetOverrideRecord {
  readonly overrideId: AssetOverrideId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly customizationTarget: AssetCustomizationTarget;
  readonly baseAssetReference: AssetReference;
  readonly baseRevision?: string;
  readonly overrideScope: AssetOverrideScope;
  readonly overrideValues: SafeAssetEditableFieldPatch;
  readonly status: AssetOverrideStatus;
  readonly conflictStatus?: AssetAuthoringConflictStatus;
  readonly provenance: AssetAuthoringProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly diagnostics?: readonly AssetAuthoringDiagnostic[];
}
