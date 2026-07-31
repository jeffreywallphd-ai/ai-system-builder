import type { EffectiveAssetProjectionDiagnosticCode, EffectiveAssetProjectionFailureKind, EffectiveAssetProjectionResultFailure } from "../../../contracts/effective-asset-projections";

export const projectionFailure = (kind: EffectiveAssetProjectionFailureKind, code: EffectiveAssetProjectionDiagnosticCode): EffectiveAssetProjectionResultFailure => ({
  status: "failure",
  failure: {
    kind,
    code,
    diagnostics: [{ code, message: "Sanitized projection diagnostic." }],
  },
});
