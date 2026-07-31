import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { AssetAuthoringDiagnostic } from "./asset-authoring-diagnostics";
import type { AssetDraftId, AssetOverrideId, AssetRevisionId, AuthoredAssetId } from "./asset-authoring-identity";
import type { AssetAuthoringConflictStatus, AssetCustomizationTargetSourceKind } from "./asset-authoring-models";
import type { AssetOverrideStatus } from "./asset-authoring-status";

export const ASSET_AUTHORING_EFFECTIVE_SOURCE_KINDS = [
  "workspace-authored",
  "workspace-authored-draft",
  "workspace-authored-revision",
  "workspace-customized",
  "linked-with-workspace-override",
  "copied-with-workspace-override",
  "imported-with-workspace-override",
  "system-derived-override",
  "customization-conflicted",
  "customization-disabled",
] as const;

export type AssetAuthoringEffectiveSourceKind = (typeof ASSET_AUTHORING_EFFECTIVE_SOURCE_KINDS)[number];

export interface AssetAuthoringEffectiveSourceSummary {
  readonly targetWorkspaceId: WorkspaceId;
  readonly effectiveSourceKind: AssetAuthoringEffectiveSourceKind;
  readonly authoredAssetId?: AuthoredAssetId;
  readonly draftId?: AssetDraftId;
  readonly revisionId?: AssetRevisionId;
  readonly revisionLabel?: string;
  readonly overrideId?: AssetOverrideId;
  readonly assetReference: AssetReference;
  readonly effectiveAssetReference?: AssetReference;
  readonly baseAssetReference?: AssetReference;
  readonly baseRevision?: string;
  readonly currentRevision?: string;
  readonly customizationTargetKind?: AssetCustomizationTargetSourceKind;
  readonly overrideStatus?: AssetOverrideStatus;
  readonly conflictStatus?: AssetAuthoringConflictStatus;
  readonly provenanceKind?: string;
  readonly diagnostics?: readonly AssetAuthoringDiagnostic[];
}
