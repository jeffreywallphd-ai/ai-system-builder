import { normalizeAssetReferenceKind } from "../asset";
import { createWorkspaceId } from "../workspace";
import type { CreateAssetDraftCommand, CreateAssetOverrideCommand, CreateWorkspaceAuthoredAssetCommand, DisableAssetOverrideCommand, PublishAssetDraftCommand, ResolveAssetCustomizationConflictCommand, UpdateAssetDraftCommand, UpdateAssetOverrideCommand } from "./asset-authoring-commands";
import { normalizeSafeAssetEditableFieldPatch } from "./asset-authoring-editable-fields";
import { normalizeAssetDraftId, normalizeAssetOverrideId, normalizeAssetRevisionId, normalizeAuthoredAssetId } from "./asset-authoring-identity";
import { normalizeAssetAuthoringProvenance } from "./asset-authoring-provenance";
import type { AssetCustomizationTarget, AssetOverrideRecord, AuthoredAssetDraftRecord, AuthoredAssetRecord, AuthoredAssetRevisionRecord } from "./asset-authoring-models";
import { normalizeAssetAuthoringStatus, normalizeAssetOverrideStatus } from "./asset-authoring-status";

export type AssetAuthoringNormalizationResult<T> = { readonly ok:true; readonly value:T } | { readonly ok:false; readonly code:string };
export const normalizeAssetAuthoringSuccess = <T>(value:T):AssetAuthoringNormalizationResult<T>=>({ok:true,value});
export const normalizeAssetAuthoringFailure = <T>(code:string):AssetAuthoringNormalizationResult<T>=>({ok:false,code});
const tryN=<T>(f:()=>T,code:string):AssetAuthoringNormalizationResult<T>=>{try{return normalizeAssetAuthoringSuccess(f());}catch{return normalizeAssetAuthoringFailure(code);}};

const t=(v:unknown,l:string)=>{if(typeof v!=="string"||v.trim().length===0||v!==v.trim()){throw new Error(`${l} is invalid.`);} return v;};
function normalizeAssetReference(value: any) {
  if (!value || typeof value !== "object") throw new Error("Asset reference is invalid.");
  const kind = normalizeAssetReferenceKind(String(value.kind ?? ""));
  const id = t(String(value.id ?? ""), "Asset reference id");
  const version = value.version === undefined ? undefined : t(String(value.version), "Asset reference version");
  return { ...value, kind, id, ...(version ? { version } : {}) };
}

export function normalizeAssetCustomizationTarget(v:AssetCustomizationTarget):AssetCustomizationTarget{return {...v,targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),effectiveAssetReference:normalizeAssetReference(v.effectiveAssetReference),...(v.baseRevision?{baseRevision:t(v.baseRevision,"Base revision")}:{})};}
export function normalizeAuthoredAssetRecord(v:AuthoredAssetRecord):AuthoredAssetRecord{return {...v,authoredAssetId:normalizeAuthoredAssetId(v.authoredAssetId),workspaceId:createWorkspaceId(v.workspaceId),assetReference:normalizeAssetReference(v.assetReference),currentRevisionId:normalizeAssetRevisionId(v.currentRevisionId),status:normalizeAssetAuthoringStatus(v.status),editableValues:normalizeSafeAssetEditableFieldPatch(v.editableValues),provenance:normalizeAssetAuthoringProvenance(v.provenance),createdAt:t(v.createdAt,"Created at"),updatedAt:t(v.updatedAt,"Updated at")};}
export function normalizeAuthoredAssetDraftRecord(v:AuthoredAssetDraftRecord):AuthoredAssetDraftRecord{return {...v,draftId:normalizeAssetDraftId(v.draftId),targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),...(v.baseAssetReference?{baseAssetReference:normalizeAssetReference(v.baseAssetReference)}:{}),draftEditableValues:normalizeSafeAssetEditableFieldPatch(v.draftEditableValues),status:normalizeAssetAuthoringStatus(v.status),provenance:normalizeAssetAuthoringProvenance(v.provenance),createdAt:t(v.createdAt,"Created at"),updatedAt:t(v.updatedAt,"Updated at")};}
export function normalizeAuthoredAssetRevisionRecord(v:AuthoredAssetRevisionRecord):AuthoredAssetRevisionRecord{return {...v,revisionId:normalizeAssetRevisionId(v.revisionId),workspaceId:createWorkspaceId(v.workspaceId),authoredAssetId:normalizeAuthoredAssetId(v.authoredAssetId),revision:t(v.revision,"Revision"),status:normalizeAssetAuthoringStatus(v.status),editableValues:normalizeSafeAssetEditableFieldPatch(v.editableValues),provenance:normalizeAssetAuthoringProvenance(v.provenance),createdAt:t(v.createdAt,"Created at"),updatedAt:t(v.updatedAt,"Updated at")};}
export function normalizeAssetOverrideRecord(v:AssetOverrideRecord):AssetOverrideRecord{ if(v.customizationTarget.sourceKind==="system-owned-asset"&&v.overrideScope!=="system-derived") throw new Error("System-owned sources require system-derived scope."); return {...v,overrideId:normalizeAssetOverrideId(v.overrideId),targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),customizationTarget:normalizeAssetCustomizationTarget(v.customizationTarget),baseAssetReference:normalizeAssetReference(v.baseAssetReference),status:normalizeAssetOverrideStatus(v.status),overrideValues:normalizeSafeAssetEditableFieldPatch(v.overrideValues),provenance:normalizeAssetAuthoringProvenance(v.provenance),createdAt:t(v.createdAt,"Created at"),updatedAt:t(v.updatedAt,"Updated at")};}
export const normalizeCreateWorkspaceAuthoredAssetCommand=(v:CreateWorkspaceAuthoredAssetCommand)=>({...v,workspaceId:createWorkspaceId(v.workspaceId),initialEditableValues:normalizeSafeAssetEditableFieldPatch(v.initialEditableValues),...(v.baseTarget?{baseTarget:normalizeAssetCustomizationTarget(v.baseTarget)}:{})});
export const normalizeCreateAssetDraftCommand=(v:CreateAssetDraftCommand)=>({...v,targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),...(v.baseTarget?{baseTarget:normalizeAssetCustomizationTarget(v.baseTarget)}:{}),draftEditableValues:normalizeSafeAssetEditableFieldPatch(v.draftEditableValues)});
export const normalizeUpdateAssetDraftCommand=(v:UpdateAssetDraftCommand)=>({...v,targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),draftId:normalizeAssetDraftId(v.draftId),draftEditablePatch:normalizeSafeAssetEditableFieldPatch(v.draftEditablePatch)});
export const normalizePublishAssetDraftCommand=(v:PublishAssetDraftCommand)=>({...v,targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),draftId:normalizeAssetDraftId(v.draftId),...(v.expectedBaseRevision?{expectedBaseRevision:t(v.expectedBaseRevision,"Expected base revision")}:{})});
export const normalizeCreateAssetOverrideCommand=(v:CreateAssetOverrideCommand)=>({...v,targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),target:normalizeAssetCustomizationTarget(v.target),overrideValues:normalizeSafeAssetEditableFieldPatch(v.overrideValues)});
export const normalizeUpdateAssetOverrideCommand=(v:UpdateAssetOverrideCommand)=>({...v,targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),overrideId:normalizeAssetOverrideId(v.overrideId),overrideValues:normalizeSafeAssetEditableFieldPatch(v.overrideValues)});
export const normalizeDisableAssetOverrideCommand=(v:DisableAssetOverrideCommand)=>({...v,targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),overrideId:normalizeAssetOverrideId(v.overrideId)});
export const normalizeResolveAssetCustomizationConflictCommand=(v:ResolveAssetCustomizationConflictCommand)=>({...v,targetWorkspaceId:createWorkspaceId(v.targetWorkspaceId),...(v.authoredAssetId?{authoredAssetId:normalizeAuthoredAssetId(v.authoredAssetId)}:{}),...(v.revisionId?{revisionId:normalizeAssetRevisionId(v.revisionId)}:{}),...(v.overrideId?{overrideId:normalizeAssetOverrideId(v.overrideId)}:{})});

export const tryNormalizeAuthoredAssetRecord=(v:AuthoredAssetRecord)=>tryN(()=>normalizeAuthoredAssetRecord(v),"asset-authoring.authored-asset.invalid");
export const tryNormalizeAssetDraftRecord=(v:AuthoredAssetDraftRecord)=>tryN(()=>normalizeAuthoredAssetDraftRecord(v),"asset-authoring.draft.invalid");
export const tryNormalizeAssetRevisionRecord=(v:AuthoredAssetRevisionRecord)=>tryN(()=>normalizeAuthoredAssetRevisionRecord(v),"asset-authoring.revision.invalid");
export const tryNormalizeAssetOverrideRecord=(v:AssetOverrideRecord)=>tryN(()=>normalizeAssetOverrideRecord(v),"asset-authoring.override.invalid");
export const tryNormalizeCreateWorkspaceAuthoredAssetCommand=(v:CreateWorkspaceAuthoredAssetCommand)=>tryN(()=>normalizeCreateWorkspaceAuthoredAssetCommand(v),"asset-authoring.command.create-authored-asset.invalid");
