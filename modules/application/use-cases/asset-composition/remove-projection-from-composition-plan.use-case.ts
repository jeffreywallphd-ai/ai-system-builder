import { normalizeAssetCompositionPlan, normalizeRemoveProjectionFromCompositionPlanCommand, type RemoveProjectionFromCompositionPlanCommand, type RemoveProjectionFromCompositionPlanResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import { createPlanProvenanceEvent } from "./asset-composition-plan-provenance.service";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";
import { recomputeAssetCompositionPlanningSummary } from "./asset-composition-plan-summary.service";

export class RemoveProjectionFromCompositionPlanUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort; now?: () => string }) {}
  async execute(command: RemoveProjectionFromCompositionPlanCommand): Promise<RemoveProjectionFromCompositionPlanResult> {
    let c; try { c = normalizeRemoveProjectionFromCompositionPlanCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-command-invalid"); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      const plan = await this.d.repository.readAssetCompositionPlanRecord(c.targetWorkspaceId, c.planId);
      if (!plan) return assetCompositionPlanFailure("not-found", "asset-composition-plan-not-found");
      if (plan.status === "archived") return assetCompositionPlanFailure("conflict", "asset-composition-plan-archived");
      const removedNodes = plan.nodes.filter((n) => n.selectedProjection.projectionId === c.projectionId).map((n) => n.nodeId);
      if (!plan.selectedProjections.some((p) => p.projectionId === c.projectionId)) return assetCompositionPlanFailure("not-found", "asset-composition-projection-missing");
      if (plan.relationships.some((r) => removedNodes.includes(r.sourceNodeId) || removedNodes.includes(r.targetNodeId))) return assetCompositionPlanFailure("blocked", "asset-composition-node-unusable");
      const draft = { ...plan, selectedProjections: plan.selectedProjections.filter((p) => p.projectionId !== c.projectionId), nodes: plan.nodes.filter((n) => !removedNodes.includes(n.nodeId)) };
      const next = normalizeAssetCompositionPlan({ ...draft, planningSummary: recomputeAssetCompositionPlanningSummary(draft), provenance: [...plan.provenance, { ...createPlanProvenanceEvent("projection-removed", c.targetWorkspaceId, c.planId, now), projectionId: c.projectionId }], updatedAt: now });
      return { status: "success", value: await this.d.repository.updateAssetCompositionPlanRecord(next) };
    } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-repository-unavailable"); }
  }
}
