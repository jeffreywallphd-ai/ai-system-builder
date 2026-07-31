import type { SafeAssetEditableFieldPatch } from "../../../contracts/asset-authoring";
import { normalizeSafeEffectiveAssetProjectedFieldPatch } from "../../../contracts/effective-asset-projections";
import type { EffectiveAssetProjectionBlocker, EffectiveAssetProjectionDiagnostic, SafeEffectiveAssetProjectedFieldPatch } from "../../../contracts/effective-asset-projections";

export type FieldMapResult = { projectedFields: SafeEffectiveAssetProjectedFieldPatch; diagnostics: EffectiveAssetProjectionDiagnostic[]; blockers: EffectiveAssetProjectionBlocker[]; blocked: boolean };

const BLOCKED: EffectiveAssetProjectionDiagnostic = { code: "effective-projection-unsafe-field", message: "Sanitized projection diagnostic." };

export function mapEditableToProjectedFields(editableValues: SafeAssetEditableFieldPatch): FieldMapResult {
  const diagnostics: EffectiveAssetProjectionDiagnostic[] = [];
  const blockers: EffectiveAssetProjectionBlocker[] = [];
  const projected: SafeEffectiveAssetProjectedFieldPatch = {};

  for (const [k, v] of Object.entries(editableValues)) {
    if (k === "display-name" || k === "summary" || k === "description" || k === "tags" || k === "classification" || k === "safe-metadata") {
      (projected as any)[k] = v;
    }
  }

  try {
    const normalized = normalizeSafeEffectiveAssetProjectedFieldPatch(projected);
    return { projectedFields: normalized, diagnostics, blockers, blocked: false };
  } catch {
    diagnostics.push(BLOCKED);
    blockers.push({ code: "effective-projection-unsafe-field", message: "Sanitized projection blocker." });
    return { projectedFields: {}, diagnostics, blockers, blocked: true };
  }
}
