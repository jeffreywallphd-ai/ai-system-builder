import type { EffectiveAssetProjectionBlocker, EffectiveAssetProjectionDiagnostic, EffectiveAssetProjectionDiagnosticCode } from "../../../contracts/effective-asset-projections";
import { normalizeEffectiveAssetProjectionBlocker, normalizeEffectiveAssetProjectionDiagnostic } from "../../../contracts/effective-asset-projections";

export class EffectiveAssetProjectionDiagnosticsService {
  createDiagnostic(code: EffectiveAssetProjectionDiagnosticCode, metadata?: EffectiveAssetProjectionDiagnostic["metadata"]): EffectiveAssetProjectionDiagnostic {
    try {
      return normalizeEffectiveAssetProjectionDiagnostic({ code, message: "", metadata });
    } catch {
      return normalizeEffectiveAssetProjectionDiagnostic({ code, message: "" });
    }
  }
  createBlocker(code: EffectiveAssetProjectionDiagnosticCode, metadata?: EffectiveAssetProjectionBlocker["metadata"]): EffectiveAssetProjectionBlocker {
    try {
      return normalizeEffectiveAssetProjectionBlocker({ code, message: "", metadata });
    } catch {
      return normalizeEffectiveAssetProjectionBlocker({ code, message: "" });
    }
  }
}

export const defaultEffectiveAssetProjectionDiagnosticsService = new EffectiveAssetProjectionDiagnosticsService();
