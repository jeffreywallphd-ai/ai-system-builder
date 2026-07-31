import type { EffectiveAssetProjectionDiagnosticCode, EffectiveAssetProjectionPolicy, EffectiveAssetProjectionSourceKind } from "../../../contracts/effective-asset-projections";
import { defaultEffectiveAssetProjectionDiagnosticsService } from "./effective-asset-projection-diagnostics.service";

export type ProjectionValidationContext = {
  targetWorkspaceId?: string;
  sourceWorkspaceId?: string;
  sourceKind: EffectiveAssetProjectionSourceKind;
  targetSourceKind?: string;
  policy: EffectiveAssetProjectionPolicy;
  sourceStatus?: "published"|"draft"|"invalid"|"conflicted"|"disabled"|"archived";
  overrideConflictOpen?: boolean;
  targetReaderAvailable?: boolean;
  projectedFieldsBlocked?: boolean;
  metadataSafe?: boolean;
  sourceMutationImplied?: "system"|"linked"|"import";
  targetReferenceCompatible?: boolean;
  sourceRelationshipCompatible?: boolean;
  baseVersionCompatible?: boolean;
};

export type ProjectionValidationResult = { ok: true } | { ok: false; code: EffectiveAssetProjectionDiagnosticCode };

const SUPPORTED_POLICIES = new Set<EffectiveAssetProjectionPolicy>(["safe-fields-only", "draft-preview-only", "blocked"]);

export class EffectiveAssetProjectionValidationService {
  validate(context: ProjectionValidationContext): ProjectionValidationResult {
    if (!context.targetWorkspaceId) return { ok: false, code: "effective-projection-workspace-required" };
    if (!context.sourceWorkspaceId) return { ok: false, code: "effective-projection-source-required" };
    if (context.sourceWorkspaceId !== context.targetWorkspaceId) return { ok: false, code: "effective-projection-conflict-detected" };
    if (!SUPPORTED_POLICIES.has(context.policy)) return { ok: false, code: "effective-projection-policy-unsupported" };
    if (context.targetReaderAvailable === false) return { ok: false, code: "effective-projection-materialization-unavailable" };
    if (context.targetReferenceCompatible === false) return { ok: false, code: "effective-projection-conflict-detected" };
    if (context.sourceRelationshipCompatible === false) return { ok: false, code: "effective-projection-conflict-detected" };
    if (context.baseVersionCompatible === false) return { ok: false, code: "effective-projection-conflict-detected" };
    if (context.sourceStatus === "invalid") return { ok: false, code: "effective-projection-source-unsupported" };
    if (context.sourceStatus === "conflicted" || context.overrideConflictOpen) return { ok: false, code: "effective-projection-conflict-detected" };
    if (context.sourceStatus === "disabled" || context.sourceStatus === "archived") return { ok: false, code: "effective-projection-disabled-override" };
    if (context.sourceStatus === "draft" && context.policy !== "draft-preview-only") return { ok: false, code: "effective-projection-draft-not-execution-ready" };
    if (context.projectedFieldsBlocked || context.metadataSafe === false) return { ok: false, code: "effective-projection-unsafe-field" };
    if (context.sourceMutationImplied === "system") return { ok: false, code: "effective-projection-system-source-immutable" };
    if (context.sourceMutationImplied === "linked") return { ok: false, code: "effective-projection-linked-source-not-mutated" };
    if (context.sourceMutationImplied === "import") return { ok: false, code: "effective-projection-import-source-detached" };
    return { ok: true };
  }

  asDiagnostics(code: EffectiveAssetProjectionDiagnosticCode) {
    return {
      diagnostics: [defaultEffectiveAssetProjectionDiagnosticsService.createDiagnostic(code)],
      blockers: [defaultEffectiveAssetProjectionDiagnosticsService.createBlocker(code)],
    };
  }
}

export const defaultEffectiveAssetProjectionValidationService = new EffectiveAssetProjectionValidationService();
