import type { AssetCompositionDiagnosticCode, AssetCompositionFailureKind, AssetCompositionResultFailure } from "../../../contracts/asset-composition";

export const assetCompositionPlanFailure = (
  kind: AssetCompositionFailureKind,
  code: AssetCompositionDiagnosticCode,
): AssetCompositionResultFailure => ({
  status: "failure",
  failure: {
    kind,
    code,
    diagnostics: [{ code, severity: "error", message: "Sanitized composition-plan diagnostic." }],
  },
});
