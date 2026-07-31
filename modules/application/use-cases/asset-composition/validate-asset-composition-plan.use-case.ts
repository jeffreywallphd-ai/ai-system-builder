import { normalizeAssetCompositionPlan, normalizeValidateAssetCompositionPlanCommand, type ValidateAssetCompositionPlanCommand, type ValidateAssetCompositionPlanResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import type { EffectiveAssetProjectionRepositoryPort } from "../../ports/effective-asset-projections";
import { createPlanProvenanceEvent } from "./asset-composition-plan-provenance.service";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";
import { recomputeAssetCompositionPlanningSummary } from "./asset-composition-plan-summary.service";
import { evaluateCompatibility } from "./asset-composition-compatibility.service";
import { computePlanningReadiness } from "./asset-composition-readiness.service";
import { findMissingCapabilityDiagnostics } from "./asset-composition-dependency.service";
import { computeValidatedPlanStatus } from "./asset-composition-validation-result.service";
import type { EffectiveAssetProjectionId, EffectiveAssetProjectionRecord } from "../../../contracts/effective-asset-projections";

export class ValidateAssetCompositionPlanUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort; projectionRepository: EffectiveAssetProjectionRepositoryPort; now?: () => string }) {}
  async execute(command: ValidateAssetCompositionPlanCommand): Promise<ValidateAssetCompositionPlanResult> {
    let c; try { c = normalizeValidateAssetCompositionPlanCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-command-invalid"); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      const plan = await this.d.repository.readAssetCompositionPlanRecord(c.targetWorkspaceId, c.planId);
      if (!plan) return assetCompositionPlanFailure("not-found", "asset-composition-plan-not-found");
      if (plan.status === "archived") return assetCompositionPlanFailure("conflict", "asset-composition-plan-archived");
      const projectionMap = new Map<EffectiveAssetProjectionId, EffectiveAssetProjectionRecord>();
      for (const p of plan.selectedProjections) {
        const rec = await this.d.projectionRepository.readEffectiveAssetProjectionRecord(c.targetWorkspaceId, p.projectionId);
        if (rec) projectionMap.set(p.projectionId, rec);
      }
      const compat = evaluateCompatibility(plan, projectionMap);
      const dependencyDiagnostics = findMissingCapabilityDiagnostics({ ...plan, nodes: compat.nodes });
      const blockers = [...compat.blockers, ...dependencyDiagnostics.map((d) => ({ code: d.code, message: "Sanitized composition planning blocker." }))];
      const diagnostics = [...compat.diagnostics, ...dependencyDiagnostics, { code: "asset-composition-runtime-readiness-deferred", severity: "info", message: "Sanitized composition planning diagnostic." } as const];
      const nextStatus = computeValidatedPlanStatus({
        hasInvalid: compat.nodes.some((n) => n.status === "invalid") || compat.relationships.some((r) => r.compatibilityStatus === "invalid"),
        hasBlocked: compat.nodes.some((n) => ["blocked", "missing-projection", "disabled"].includes(n.status)) || compat.relationships.some((r) => ["blocked", "missing-dependency"].includes(r.compatibilityStatus)) || blockers.length > 0,
        hasConflicted: compat.nodes.some((n) => n.status === "conflicted") || compat.relationships.some((r) => r.compatibilityStatus === "conflicted"),
        hasStale: compat.nodes.some((n) => n.status === "stale-projection") || compat.relationships.some((r) => r.compatibilityStatus === "stale"),
        hasUnsupported: compat.nodes.some((n) => n.status === "unsupported") || compat.relationships.some((r) => r.compatibilityStatus === "unsupported"),
        hasNodes: compat.nodes.length > 0,
      });
      const draft = { ...plan, nodes: compat.nodes, relationships: compat.relationships, blockers, compatibilityDiagnostics: diagnostics, status: nextStatus, updatedAt: now, provenance: [...plan.provenance, createPlanProvenanceEvent("plan-validated", c.targetWorkspaceId, c.planId, now)] };
      const withSummary = { ...draft, planningSummary: { ...recomputeAssetCompositionPlanningSummary(draft), planningReadiness: computePlanningReadiness({ ...draft, status: nextStatus } as never) } };
      const normalized = normalizeAssetCompositionPlan(withSummary);
      return { status: "success", value: await this.d.repository.updateAssetCompositionPlanRecord(normalized) };
    } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-repository-unavailable"); }
  }
}
