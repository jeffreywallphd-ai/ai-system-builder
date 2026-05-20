import { normalizeAssetId, normalizeAssetReferenceKind, type AssetReference } from "../asset";
import { normalizeAssetDraftId, normalizeAssetOverrideId, normalizeAssetRevisionId, normalizeAuthoredAssetId } from "../asset-authoring";
import { createUserLibraryAssetId, createUserLibraryRelationshipId } from "../user-library";
import { createWorkspaceId } from "../workspace";
import { normalizeEffectiveAssetProjectionBlocker, normalizeEffectiveAssetProjectionDiagnostic } from "./effective-asset-projection-diagnostics";
import { normalizeEffectiveAssetProjectionId } from "./effective-asset-projection-identity";
import type { CreateEffectiveAssetProjectionCommand, InvalidateEffectiveAssetProjectionCommand, ListEffectiveAssetProjectionsCommand, ReadEffectiveAssetProjectionCommand, RefreshEffectiveAssetProjectionCommand, ValidateEffectiveAssetProjectionReadinessCommand } from "./effective-asset-projection-commands";
import type { EffectiveAssetProjectionRecord, EffectiveAssetProjectionSnapshotRecord } from "./effective-asset-projection-record";
import { normalizeEffectiveAssetProjectionPolicy } from "./effective-asset-projection-policy";
import { normalizeSafeEffectiveAssetLabel, normalizeSafeEffectiveAssetProjectedFieldPatch } from "./effective-asset-projected-fields";
import { normalizeEffectiveAssetProjectionSourceKind, type EffectiveAssetProjectionSource, type EffectiveAssetProjectionTarget } from "./effective-asset-projection-source";
import { normalizeEffectiveAssetProjectionStatus } from "./effective-asset-projection-status";

export type TryNormalizeResult<T> = { ok: true; value: T } | { ok: false; diagnostics: Array<{ code: "normalization-failed"; message: string }> };
const fail = <T>(): TryNormalizeResult<T> => ({ ok: false, diagnostics: [{ code: "normalization-failed", message: "Normalization failed." }] });

function normalizeAssetReference(value: AssetReference): AssetReference {
  return { ...value, kind: normalizeAssetReferenceKind(value.kind), id: normalizeAssetId(value.id), ...(value.version ? { version: value.version.trim() } : {}) };
}

export const normalizeEffectiveAssetProjectionSource = (value: EffectiveAssetProjectionSource): EffectiveAssetProjectionSource => ({
  sourceKind: normalizeEffectiveAssetProjectionSourceKind(value.sourceKind),
  targetWorkspaceId: createWorkspaceId(value.targetWorkspaceId),
  ...(value.sourceAssetReference ? { sourceAssetReference: normalizeAssetReference(value.sourceAssetReference) } : {}),
  ...(value.effectiveAssetReference ? { effectiveAssetReference: normalizeAssetReference(value.effectiveAssetReference) } : {}),
  ...(value.sourceWorkspaceId ? { sourceWorkspaceId: createWorkspaceId(value.sourceWorkspaceId) } : {}),
  ...(value.userLibraryAssetId ? { userLibraryAssetId: createUserLibraryAssetId(value.userLibraryAssetId) } : {}),
  ...(value.authoredAssetId ? { authoredAssetId: normalizeAuthoredAssetId(value.authoredAssetId) } : {}),
  ...(value.draftId ? { draftId: normalizeAssetDraftId(value.draftId) } : {}),
  ...(value.revisionId ? { revisionId: normalizeAssetRevisionId(value.revisionId) } : {}),
  ...(value.overrideId ? { overrideId: normalizeAssetOverrideId(value.overrideId) } : {}),
  ...(value.sourceRelationshipId ? { sourceRelationshipId: createUserLibraryRelationshipId(value.sourceRelationshipId) } : {}),
  ...(value.sourceLabel ? { sourceLabel: normalizeSafeEffectiveAssetLabel(value.sourceLabel, "sourceLabel") } : {}),
});

export const normalizeEffectiveAssetProjectionTarget = (value: EffectiveAssetProjectionTarget): EffectiveAssetProjectionTarget => ({
  targetWorkspaceId: createWorkspaceId(value.targetWorkspaceId),
  effectiveAssetReference: normalizeAssetReference(value.effectiveAssetReference),
  intendedPolicy: normalizeEffectiveAssetProjectionPolicy(value.intendedPolicy),
  ...(value.projectionId ? { projectionId: normalizeEffectiveAssetProjectionId(value.projectionId) } : {}),
  ...(value.targetLabel ? { targetLabel: normalizeSafeEffectiveAssetLabel(value.targetLabel, "targetLabel") } : {}),
});

export const normalizeEffectiveAssetProjectionRecord = (value: EffectiveAssetProjectionRecord): EffectiveAssetProjectionRecord => ({ ...value, projectionId: normalizeEffectiveAssetProjectionId(value.projectionId), targetWorkspaceId: createWorkspaceId(value.targetWorkspaceId), source: normalizeEffectiveAssetProjectionSource(value.source), target: normalizeEffectiveAssetProjectionTarget(value.target), sourceKind: normalizeEffectiveAssetProjectionSourceKind(value.sourceKind), status: normalizeEffectiveAssetProjectionStatus(value.status), policy: normalizeEffectiveAssetProjectionPolicy(value.policy), effectiveAssetReference: normalizeAssetReference(value.effectiveAssetReference), ...(value.sourceAssetReference ? { sourceAssetReference: normalizeAssetReference(value.sourceAssetReference) } : {}), projectedFields: normalizeSafeEffectiveAssetProjectedFieldPatch(value.projectedFields), diagnostics: value.diagnostics.map(normalizeEffectiveAssetProjectionDiagnostic), blockers: value.blockers.map(normalizeEffectiveAssetProjectionBlocker) });
export const normalizeEffectiveAssetProjectionSnapshotRecord = (value: EffectiveAssetProjectionSnapshotRecord): EffectiveAssetProjectionSnapshotRecord => normalizeEffectiveAssetProjectionRecord(value) as EffectiveAssetProjectionSnapshotRecord;
export const normalizeCreateEffectiveAssetProjectionCommand = (value: CreateEffectiveAssetProjectionCommand): CreateEffectiveAssetProjectionCommand => ({ ...value, targetWorkspaceId: createWorkspaceId(value.targetWorkspaceId), source: normalizeEffectiveAssetProjectionSource(value.source), target: normalizeEffectiveAssetProjectionTarget(value.target), policy: normalizeEffectiveAssetProjectionPolicy(value.policy), ...(value.projectedFieldPatch ? { projectedFieldPatch: normalizeSafeEffectiveAssetProjectedFieldPatch(value.projectedFieldPatch) } : {}) });
export const normalizeRefreshEffectiveAssetProjectionCommand = (value: RefreshEffectiveAssetProjectionCommand): RefreshEffectiveAssetProjectionCommand => ({ ...value, targetWorkspaceId: createWorkspaceId(value.targetWorkspaceId), projectionId: normalizeEffectiveAssetProjectionId(value.projectionId) });
export const normalizeInvalidateEffectiveAssetProjectionCommand = (value: InvalidateEffectiveAssetProjectionCommand): InvalidateEffectiveAssetProjectionCommand => ({ ...value, targetWorkspaceId: createWorkspaceId(value.targetWorkspaceId), projectionId: normalizeEffectiveAssetProjectionId(value.projectionId) });
export const normalizeReadEffectiveAssetProjectionCommand = (value: ReadEffectiveAssetProjectionCommand): ReadEffectiveAssetProjectionCommand => ({ ...value, targetWorkspaceId: createWorkspaceId(value.targetWorkspaceId), projectionId: normalizeEffectiveAssetProjectionId(value.projectionId) });
export const normalizeListEffectiveAssetProjectionsCommand = (value: ListEffectiveAssetProjectionsCommand): ListEffectiveAssetProjectionsCommand => ({ ...value, targetWorkspaceId: createWorkspaceId(value.targetWorkspaceId) });
export const normalizeValidateEffectiveAssetProjectionReadinessCommand = (value: ValidateEffectiveAssetProjectionReadinessCommand): ValidateEffectiveAssetProjectionReadinessCommand => ({ ...value, targetWorkspaceId: createWorkspaceId(value.targetWorkspaceId), projectionId: normalizeEffectiveAssetProjectionId(value.projectionId), ...(value.requiredPolicy ? { requiredPolicy: normalizeEffectiveAssetProjectionPolicy(value.requiredPolicy) } : {}) });

export function tryNormalizeEffectiveAssetProjectionRecord(value: EffectiveAssetProjectionRecord): TryNormalizeResult<EffectiveAssetProjectionRecord> { try { return { ok: true, value: normalizeEffectiveAssetProjectionRecord(value) }; } catch { return fail(); } }
export function tryNormalizeEffectiveAssetProjectionSource(value: EffectiveAssetProjectionSource): TryNormalizeResult<EffectiveAssetProjectionSource> { try { return { ok: true, value: normalizeEffectiveAssetProjectionSource(value) }; } catch { return fail(); } }
export function tryNormalizeEffectiveAssetProjectionTarget(value: EffectiveAssetProjectionTarget): TryNormalizeResult<EffectiveAssetProjectionTarget> { try { return { ok: true, value: normalizeEffectiveAssetProjectionTarget(value) }; } catch { return fail(); } }
export function tryNormalizeCreateEffectiveAssetProjectionCommand(value: CreateEffectiveAssetProjectionCommand): TryNormalizeResult<CreateEffectiveAssetProjectionCommand> { try { return { ok: true, value: normalizeCreateEffectiveAssetProjectionCommand(value) }; } catch { return fail(); } }
export function tryNormalizeSafeEffectiveAssetProjectedFieldPatch(value: import("./effective-asset-projected-fields").SafeEffectiveAssetProjectedFieldPatch): TryNormalizeResult<import("./effective-asset-projected-fields").SafeEffectiveAssetProjectedFieldPatch> { try { return { ok: true, value: normalizeSafeEffectiveAssetProjectedFieldPatch(value) }; } catch { return fail(); } }
