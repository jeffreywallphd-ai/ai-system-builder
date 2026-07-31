import type { EffectiveAssetProjectionDiagnosticCode, EffectiveAssetProjectionStatus } from "../../../contracts/effective-asset-projections";

type ConflictInput = {
  sourceMissing?: boolean;
  targetMissing?: boolean;
  targetUnavailable?: boolean;
  revisionMismatch?: boolean;
  overrideConflict?: boolean;
  disabled?: boolean;
  draftOnly?: boolean;
  unsafeField?: boolean;
  unsupported?: boolean;
};

export class EffectiveAssetProjectionConflictBlockingService {
  classify(input: ConflictInput): { status: EffectiveAssetProjectionStatus; code?: EffectiveAssetProjectionDiagnosticCode } {
    if (input.targetUnavailable) return { status: "blocked", code: "effective-projection-materialization-unavailable" };
    if (input.sourceMissing || input.targetMissing) return { status: "source-missing", code: "effective-projection-source-missing" };
    if (input.revisionMismatch || input.overrideConflict) return { status: "conflicted", code: "effective-projection-conflict-detected" };
    if (input.disabled) return { status: "disabled", code: "effective-projection-disabled-override" };
    if (input.draftOnly) return { status: "draft-only", code: "effective-projection-draft-not-execution-ready" };
    if (input.unsupported) return { status: "unsupported", code: "effective-projection-source-unsupported" };
    if (input.unsafeField) return { status: "blocked", code: "effective-projection-unsafe-field" };
    return { status: "ready" };
  }
}

export const defaultEffectiveAssetProjectionConflictBlockingService = new EffectiveAssetProjectionConflictBlockingService();
