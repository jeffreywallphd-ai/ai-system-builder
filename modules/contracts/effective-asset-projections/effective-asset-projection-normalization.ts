import { normalizeAssetId, normalizeAssetReferenceKind, type AssetReference } from "../asset";
import { normalizeAssetDraftId, normalizeAssetOverrideId, normalizeAssetRevisionId, normalizeAuthoredAssetId } from "../asset-authoring";
import { createUserLibraryAssetId, createUserLibraryRelationshipId } from "../user-library";
import { createWorkspaceId } from "../workspace";
import { normalizeEffectiveAssetProjectionBlocker, normalizeEffectiveAssetProjectionDiagnostic } from "./effective-asset-projection-diagnostics";
import { normalizeEffectiveAssetProjectionId } from "./effective-asset-projection-identity";
import { normalizeEffectiveAssetProjectionRefreshReason, type CreateEffectiveAssetProjectionCommand, type InvalidateEffectiveAssetProjectionCommand, type ListEffectiveAssetProjectionsCommand, type ReadEffectiveAssetProjectionCommand, type RefreshEffectiveAssetProjectionCommand, type ValidateEffectiveAssetProjectionReadinessCommand } from "./effective-asset-projection-commands";
import type { EffectiveAssetProjectionRecord, EffectiveAssetProjectionSnapshotRecord } from "./effective-asset-projection-record";
import { normalizeEffectiveAssetProjectionPolicy } from "./effective-asset-projection-policy";
import { normalizeSafeEffectiveAssetLabel, normalizeSafeEffectiveAssetProjectedFieldPatch } from "./effective-asset-projected-fields";
import { normalizeEffectiveAssetProjectionSourceKind, type EffectiveAssetProjectionSource, type EffectiveAssetProjectionTarget } from "./effective-asset-projection-source";
import { normalizeEffectiveAssetProjectionStatus } from "./effective-asset-projection-status";

export type TryNormalizeResult<T> = { ok: true; value: T } | { ok: false; diagnostics: Array<{ code: "normalization-failed"; message: string }> };
const fail = <T>(): TryNormalizeResult<T> => ({ ok: false, diagnostics: [{ code: "normalization-failed", message: "Normalization failed." }] });

import { normalizeAssetVersion } from '../asset';
import { passiveRecord as record, passiveOptional as optional, passiveArray as list,
  passiveTypedString as typed, passiveEnum, passiveTimestamp as timestamp, passiveBoolean, passiveString } from '../shared';
import { normalizeSafeEffectiveAssetMetadata, normalizeSafeEffectiveAssetMetadataRecord } from './effective-asset-projected-fields';
import { normalizeEffectiveAssetProjectionRevisionId, normalizeEffectiveAssetProjectionSnapshotId } from './effective-asset-projection-identity';
import type { EffectiveAssetProjectionProvenance } from './effective-asset-projection-provenance';
const safeString = (value: unknown) => normalizeSafeEffectiveAssetLabel(passiveString(value), 'sourceLabel');
const safeTyped = <T>(parse:(value:string)=>T) => (value:unknown):T => {
  try { return typed(parse)(value); } catch { throw new Error('Effective projection field is invalid.'); }
};
const workspaceId = safeTyped(createWorkspaceId);
const projectionId = safeTyped(normalizeEffectiveAssetProjectionId);
const reference = record<AssetReference>({kind:safeTyped(normalizeAssetReferenceKind),id:safeTyped(normalizeAssetId),
  version:optional(value=>normalizeAssetVersion(safeString(value))),label:optional(safeString),
  metadata:optional(normalizeSafeEffectiveAssetMetadataRecord),
});
const sourceFields = {
  sourceKind:safeTyped(normalizeEffectiveAssetProjectionSourceKind),targetWorkspaceId:workspaceId,
  sourceAssetReference:optional(reference),effectiveAssetReference:optional(reference),sourceWorkspaceId:optional(workspaceId),
  userLibraryAssetId:optional(safeTyped(createUserLibraryAssetId)),authoredAssetId:optional(safeTyped(normalizeAuthoredAssetId)),
  draftId:optional(safeTyped(normalizeAssetDraftId)),revisionId:optional(safeTyped(normalizeAssetRevisionId)),
  overrideId:optional(safeTyped(normalizeAssetOverrideId)),sourceRelationshipId:optional(safeTyped(createUserLibraryRelationshipId)),
};
export const normalizeEffectiveAssetProjectionSource = record<EffectiveAssetProjectionSource>({...sourceFields,sourceLabel:optional(safeString)});
export const normalizeEffectiveAssetProjectionTarget = record<EffectiveAssetProjectionTarget>({
  targetWorkspaceId:workspaceId,effectiveAssetReference:reference,intendedPolicy:safeTyped(normalizeEffectiveAssetProjectionPolicy),
  projectionId:optional(projectionId),targetLabel:optional(safeString),
});
const provenance = record<EffectiveAssetProjectionProvenance>({
  kind:passiveEnum(['projected-from-system-foundation','projected-from-workspace-local-asset','projected-from-user-library-link',
    'projected-from-detached-user-library-copy','projected-from-workspace-import','projected-from-authored-asset-revision',
    'projected-from-authored-draft-preview','projected-from-active-override','blocked-by-conflict','blocked-by-unsupported-field','blocked-by-missing-source']),
  targetWorkspaceId:workspaceId,sourceWorkspaceId:sourceFields.sourceWorkspaceId,sourceAssetReference:sourceFields.sourceAssetReference,
  effectiveAssetReference:sourceFields.effectiveAssetReference,userLibraryAssetId:sourceFields.userLibraryAssetId,
  authoredAssetId:sourceFields.authoredAssetId,draftId:sourceFields.draftId,revisionId:sourceFields.revisionId,
  overrideId:sourceFields.overrideId,sourceRelationshipId:sourceFields.sourceRelationshipId,
  operationAt:timestamp,metadata:optional(normalizeSafeEffectiveAssetMetadata),
});
const graphSummary = record<NonNullable<EffectiveAssetProjectionRecord['sourceGraphSummary']>>({
  sourceCount:value=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Projection source count is invalid.');return value;},
  hasOverrides:passiveBoolean,hasMissingSource:passiveBoolean,hasConflict:passiveBoolean,
});
const projectionFields = {
  projectionId,targetWorkspaceId:workspaceId,source:normalizeEffectiveAssetProjectionSource,target:normalizeEffectiveAssetProjectionTarget,
  sourceAssetReference:optional(reference),effectiveAssetReference:reference,sourceKind:safeTyped(normalizeEffectiveAssetProjectionSourceKind),
  status:safeTyped(normalizeEffectiveAssetProjectionStatus),policy:safeTyped(normalizeEffectiveAssetProjectionPolicy),
  projectedFields:normalizeSafeEffectiveAssetProjectedFieldPatch,diagnostics:list(normalizeEffectiveAssetProjectionDiagnostic),
  blockers:list(normalizeEffectiveAssetProjectionBlocker),provenance,sourceGraphSummary:optional(graphSummary),
  projectionRevisionId:optional(safeTyped(normalizeEffectiveAssetProjectionRevisionId)),
  projectionSnapshotId:optional(safeTyped(normalizeEffectiveAssetProjectionSnapshotId)),
  createdAt:timestamp,updatedAt:timestamp,materializedAt:optional(timestamp),invalidatedAt:optional(timestamp),invalidationReason:optional(safeString),
};
function assertTargetScope(value: {targetWorkspaceId:string;source:EffectiveAssetProjectionSource;target:EffectiveAssetProjectionTarget}): void {
  if (value.source.targetWorkspaceId !== value.targetWorkspaceId || value.target.targetWorkspaceId !== value.targetWorkspaceId)
    throw new Error('Effective projection target workspace is inconsistent.');
}
function assertRecordIdentity(value: EffectiveAssetProjectionRecord): void {
  assertTargetScope(value);
  const expected = value.effectiveAssetReference;
  const actual = value.target.effectiveAssetReference;
  if (value.provenance.targetWorkspaceId !== value.targetWorkspaceId ||
      expected.kind !== actual.kind || expected.id !== actual.id || expected.version !== actual.version ||
      (value.target.projectionId !== undefined && value.target.projectionId !== value.projectionId))
    throw new Error('Effective projection identity is inconsistent.');
}
const normalizeRecordFields = record<EffectiveAssetProjectionRecord>(projectionFields);
export function normalizeEffectiveAssetProjectionRecord(value: unknown): EffectiveAssetProjectionRecord {
  const result = normalizeRecordFields(value); assertRecordIdentity(result); return result;
}
const normalizeSnapshotFields = record<EffectiveAssetProjectionSnapshotRecord>({
  ...projectionFields,projectionSnapshotId:safeTyped(normalizeEffectiveAssetProjectionSnapshotId),
});
export function normalizeEffectiveAssetProjectionSnapshotRecord(value: unknown): EffectiveAssetProjectionSnapshotRecord {
  const result = normalizeSnapshotFields(value); assertRecordIdentity(result); return result;
}
const normalizeCreateFields = record<CreateEffectiveAssetProjectionCommand>({
  targetWorkspaceId:workspaceId,source:normalizeEffectiveAssetProjectionSource,target:normalizeEffectiveAssetProjectionTarget,
  policy:safeTyped(normalizeEffectiveAssetProjectionPolicy),projectedFieldPatch:optional(normalizeSafeEffectiveAssetProjectedFieldPatch),
});
export function normalizeCreateEffectiveAssetProjectionCommand(value: unknown): CreateEffectiveAssetProjectionCommand {
  const result = normalizeCreateFields(value); assertTargetScope(result); return result;
}
export const normalizeRefreshEffectiveAssetProjectionCommand = record<RefreshEffectiveAssetProjectionCommand>({
  targetWorkspaceId:workspaceId,projectionId,reason:safeTyped(normalizeEffectiveAssetProjectionRefreshReason),
});
export const normalizeInvalidateEffectiveAssetProjectionCommand = normalizeRefreshEffectiveAssetProjectionCommand;
export const normalizeReadEffectiveAssetProjectionCommand = record<ReadEffectiveAssetProjectionCommand>({targetWorkspaceId:workspaceId,projectionId});
export const normalizeListEffectiveAssetProjectionsCommand = record<ListEffectiveAssetProjectionsCommand>({
  targetWorkspaceId:workspaceId,status:optional(safeTyped(normalizeEffectiveAssetProjectionStatus)),
  sourceKind:optional(safeTyped(normalizeEffectiveAssetProjectionSourceKind)),
  limit:optional(value=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>250)throw new Error('Projection limit is invalid.');return value;}),
  cursor:optional(safeString),
});
export const normalizeValidateEffectiveAssetProjectionReadinessCommand = record<ValidateEffectiveAssetProjectionReadinessCommand>({
  targetWorkspaceId:workspaceId,projectionId,requiredPolicy:optional(safeTyped(normalizeEffectiveAssetProjectionPolicy)),
});

export function tryNormalizeEffectiveAssetProjectionRecord(value: EffectiveAssetProjectionRecord): TryNormalizeResult<EffectiveAssetProjectionRecord> { try { return { ok: true, value: normalizeEffectiveAssetProjectionRecord(value) }; } catch { return fail(); } }
export function tryNormalizeEffectiveAssetProjectionSource(value: EffectiveAssetProjectionSource): TryNormalizeResult<EffectiveAssetProjectionSource> { try { return { ok: true, value: normalizeEffectiveAssetProjectionSource(value) }; } catch { return fail(); } }
export function tryNormalizeEffectiveAssetProjectionTarget(value: EffectiveAssetProjectionTarget): TryNormalizeResult<EffectiveAssetProjectionTarget> { try { return { ok: true, value: normalizeEffectiveAssetProjectionTarget(value) }; } catch { return fail(); } }
export function tryNormalizeCreateEffectiveAssetProjectionCommand(value: CreateEffectiveAssetProjectionCommand): TryNormalizeResult<CreateEffectiveAssetProjectionCommand> { try { return { ok: true, value: normalizeCreateEffectiveAssetProjectionCommand(value) }; } catch { return fail(); } }
export function tryNormalizeSafeEffectiveAssetProjectedFieldPatch(value: import("./effective-asset-projected-fields").SafeEffectiveAssetProjectedFieldPatch): TryNormalizeResult<import("./effective-asset-projected-fields").SafeEffectiveAssetProjectedFieldPatch> { try { return { ok: true, value: normalizeSafeEffectiveAssetProjectedFieldPatch(value) }; } catch { return fail(); } }
