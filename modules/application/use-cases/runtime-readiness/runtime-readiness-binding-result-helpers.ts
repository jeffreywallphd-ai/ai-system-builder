import type { RuntimeReadinessDiagnosticCode, RuntimeReadinessResultFailure } from "../../../contracts/runtime-readiness";

export const runtimeReadinessFailure = (
  kind: RuntimeReadinessResultFailure["failure"]["kind"],
  code: RuntimeReadinessDiagnosticCode,
): RuntimeReadinessResultFailure => ({
  status: "failure",
  failure: {
    kind,
    code,
    diagnostics: [{ code, severity: "error", message: "Sanitized runtime-readiness diagnostic." }],
  },
});
