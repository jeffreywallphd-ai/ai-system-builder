import type { EffectiveAssetProjectionDiagnostic, EffectiveAssetProjectionDiagnosticCode } from "./effective-asset-projection-diagnostics";
import type { EffectiveAssetProjectionRecord } from "./effective-asset-projection-record";

export type EffectiveAssetProjectionFailureKind = "validation"|"not-found"|"conflict"|"blocked"|"unavailable"|"unsupported"|"internal";
export type EffectiveAssetProjectionFailure = { kind: EffectiveAssetProjectionFailureKind; code: EffectiveAssetProjectionDiagnosticCode; diagnostics: EffectiveAssetProjectionDiagnostic[]; };
export type EffectiveAssetProjectionResultSuccess<T> = { status: "success"; value: T };
export type EffectiveAssetProjectionResultFailure = { status: "failure"; failure: EffectiveAssetProjectionFailure };
export type CreateEffectiveAssetProjectionResult = EffectiveAssetProjectionResultSuccess<EffectiveAssetProjectionRecord> | EffectiveAssetProjectionResultFailure;
export type RefreshEffectiveAssetProjectionResult = EffectiveAssetProjectionResultSuccess<EffectiveAssetProjectionRecord> | EffectiveAssetProjectionResultFailure;
export type InvalidateEffectiveAssetProjectionResult = EffectiveAssetProjectionResultSuccess<EffectiveAssetProjectionRecord> | EffectiveAssetProjectionResultFailure;
export type ReadEffectiveAssetProjectionResult = EffectiveAssetProjectionResultSuccess<EffectiveAssetProjectionRecord> | EffectiveAssetProjectionResultFailure;
export type ListEffectiveAssetProjectionsResult = EffectiveAssetProjectionResultSuccess<{ records: EffectiveAssetProjectionRecord[]; nextCursor?: string }> | EffectiveAssetProjectionResultFailure;
export type ValidateEffectiveAssetProjectionReadinessResult = EffectiveAssetProjectionResultSuccess<{ projection: EffectiveAssetProjectionRecord; executionReady: boolean }> | EffectiveAssetProjectionResultFailure;
