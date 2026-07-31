import type { EffectiveAssetProjectionDiagnosticId, EffectiveAssetProjectionBlockerId } from "./effective-asset-projection-identity";
import type { SafeEffectiveAssetMetadata } from "./effective-asset-projected-fields";
import { normalizeSafeEffectiveAssetProjectedFieldPatch } from "./effective-asset-projected-fields";

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

function normalizeCode(code: string): EffectiveAssetProjectionDiagnosticCode {
  const normalized = code.trim().toLowerCase() as EffectiveAssetProjectionDiagnosticCode;
  if (!EFFECTIVE_ASSET_PROJECTION_DIAGNOSTIC_CODES.includes(normalized)) throw new Error("Effective projection diagnostic code is invalid.");
  return normalized;
}

function sanitizeMetadata(metadata: Record<string, SafeEffectiveAssetMetadata> | undefined): Record<string, SafeEffectiveAssetMetadata> | undefined {
  if (!metadata) return undefined;
  return normalizeSafeEffectiveAssetProjectedFieldPatch({ "safe-metadata": metadata })["safe-metadata"] as Record<string, SafeEffectiveAssetMetadata>;
}

export const normalizeEffectiveAssetProjectionDiagnostic = (value: EffectiveAssetProjectionDiagnostic): EffectiveAssetProjectionDiagnostic => ({
  ...value,
  code: normalizeCode(value.code),
  message: "Sanitized projection diagnostic.",
  metadata: sanitizeMetadata(value.metadata),
});

export const normalizeEffectiveAssetProjectionBlocker = (value: EffectiveAssetProjectionBlocker): EffectiveAssetProjectionBlocker => ({
  ...value,
  code: normalizeCode(value.code),
  message: "Sanitized projection blocker.",
  metadata: sanitizeMetadata(value.metadata),
});
