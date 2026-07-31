import type { AssetCompositionBlocker, AssetCompositionDiagnostic, AssetCompositionDiagnosticCode } from "../../../contracts/asset-composition";

const msg = "Sanitized composition planning diagnostic.";
export const planningDiagnostic = (code: AssetCompositionDiagnosticCode, severity: AssetCompositionDiagnostic["severity"] = "error"): AssetCompositionDiagnostic => ({ code, severity, message: msg });
export const planningBlocker = (code: AssetCompositionDiagnosticCode): AssetCompositionBlocker => ({ code, message: "Sanitized composition planning blocker." });
