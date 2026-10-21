import type { EffectiveAssetProjectionDiagnosticId, EffectiveAssetProjectionBlockerId } from "./effective-asset-projection-identity";
import type { SafeEffectiveAssetMetadata } from "./effective-asset-projected-fields";
import { normalizeSafeEffectiveAssetMetadataRecord } from "./effective-asset-projected-fields";

export const EFFECTIVE_ASSET_PROJECTION_DIAGNOSTIC_CODES = [
  "effective-projection-workspace-required", "effective-projection-source-required", "effective-projection-source-missing", "effective-projection-source-unsupported",
  "effective-projection-conflict-detected", "effective-projection-disabled-override", "effective-projection-draft-not-execution-ready",
  "effective-projection-unsafe-field", "effective-projection-field-unsupported", "effective-projection-policy-unsupported",
  "effective-projection-system-source-immutable", "effective-projection-linked-source-not-mutated", "effective-projection-import-source-detached",
  "effective-projection-materialization-unavailable",
] as const;

export type EffectiveAssetProjectionDiagnosticCode = (typeof EFFECTIVE_ASSET_PROJECTION_DIAGNOSTIC_CODES)[number];

export type EffectiveAssetProjectionDiagnostic = { diagnosticId?: EffectiveAssetProjectionDiagnosticId; code: EffectiveAssetProjectionDiagnosticCode; message: string; metadata?: Record<string, SafeEffectiveAssetMetadata> };
export type EffectiveAssetProjectionBlocker = { blockerId?: EffectiveAssetProjectionBlockerId; code: EffectiveAssetProjectionDiagnosticCode; message: string; metadata?: Record<string, SafeEffectiveAssetMetadata> };


import { passiveRecord as record, passiveOptional as optional, passiveTypedString as typed,
  passiveEnum } from '../shared';
import { normalizeEffectiveAssetProjectionDiagnosticId, normalizeEffectiveAssetProjectionBlockerId } from './effective-asset-projection-identity';

const code = passiveEnum(EFFECTIVE_ASSET_PROJECTION_DIAGNOSTIC_CODES);
const metadata = normalizeSafeEffectiveAssetMetadataRecord;
export const normalizeEffectiveAssetProjectionDiagnostic = record<EffectiveAssetProjectionDiagnostic>({
  diagnosticId: optional(typed(normalizeEffectiveAssetProjectionDiagnosticId)), code,
  message: value => {if(typeof value!=="string") throw new Error("Projection diagnostic message is invalid."); return "Sanitized projection diagnostic.";}, metadata: optional(metadata),
});
export const normalizeEffectiveAssetProjectionBlocker = record<EffectiveAssetProjectionBlocker>({
  blockerId: optional(typed(normalizeEffectiveAssetProjectionBlockerId)), code,
  message: value => {if(typeof value!=="string") throw new Error("Projection diagnostic message is invalid."); return "Sanitized projection blocker.";}, metadata: optional(metadata),
});
