import type { AssetAuthoringDiagnostic } from "./asset-authoring-diagnostics";
import type { AssetOverrideRecord, AuthoredAssetDraftRecord, AuthoredAssetRecord, AuthoredAssetRevisionRecord } from "./asset-authoring-models";

export type AssetAuthoringFailureCode = "validation"|"not-found"|"conflict"|"unavailable"|"unsupported"|"internal";
export interface AssetAuthoringFailure { readonly code: AssetAuthoringFailureCode; readonly message: string; readonly diagnostics?: readonly AssetAuthoringDiagnostic[]; }
export type AssetAuthoringResultSuccess<T> = { readonly kind: "success"; readonly value: T };
export type AssetAuthoringResultFailure = { readonly kind: "failure"; readonly failure: AssetAuthoringFailure };
export type AssetAuthoringResult<T> = AssetAuthoringResultSuccess<T> | AssetAuthoringResultFailure;
export type CreateWorkspaceAuthoredAssetResult = AssetAuthoringResult<AuthoredAssetRecord>;
export type CreateAssetDraftResult = AssetAuthoringResult<AuthoredAssetDraftRecord>;
export type UpdateAssetDraftResult = AssetAuthoringResult<AuthoredAssetDraftRecord>;
export type PublishAssetDraftResult = AssetAuthoringResult<AuthoredAssetRevisionRecord>;
export type CreateAssetOverrideResult = AssetAuthoringResult<AssetOverrideRecord>;
export type UpdateAssetOverrideResult = AssetAuthoringResult<AssetOverrideRecord>;
export type DisableAssetOverrideResult = AssetAuthoringResult<AssetOverrideRecord>;
export type ResolveAssetCustomizationConflictResult = AssetAuthoringResult<AssetOverrideRecord | AuthoredAssetRevisionRecord>;
