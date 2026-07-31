import { normalizeAssetCompositionPlan, normalizeDisconnectCompositionNodesCommand, type DisconnectCompositionNodesCommand, type DisconnectCompositionNodesResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import { createPlanProvenanceEvent } from "./asset-composition-plan-provenance.service";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";
import { recomputeAssetCompositionPlanningSummary } from "./asset-composition-plan-summary.service";

export class DisconnectCompositionNodesUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort; now?: () => string }) {}
  async execute(command: DisconnectCompositionNodesCommand): Promise<DisconnectCompositionNodesResult> {
    let c; try { c = normalizeDisconnectCompositionNodesCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-workspace-required" ); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      const plan = await this.d.repository.readAssetCompositionPlanRecord(c.targetWorkspaceId, c.planId);
      if (!plan) return assetCompositionPlanFailure("not-found", "asset-composition-plan-not-found");
      if (plan.status === "archived") return assetCompositionPlanFailure("blocked", "asset-composition-plan-archived");
      const relationship = plan.relationships.find((x) => x.relationshipId === c.relationshipId);
      if (!relationship) return assetCompositionPlanFailure("not-found", "asset-composition-relationship-node-missing");
      if (relationship.targetWorkspaceId !== c.targetWorkspaceId) return assetCompositionPlanFailure("blocked", "asset-composition-repository-unavailable");
      const relationships = plan.relationships.filter((x) => x.relationshipId !== c.relationshipId);
      const next = normalizeAssetCompositionPlan({ ...plan, relationships, planningSummary: recomputeAssetCompositionPlanningSummary({ ...plan, relationships }), provenance: [...plan.provenance, { ...createPlanProvenanceEvent("relationship-added", c.targetWorkspaceId, c.planId, now), kind: "relationship-removed", relationshipId: c.relationshipId }], updatedAt: now });
      return { status: "success", value: await this.d.repository.updateAssetCompositionPlanRecord(next) };
    } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-repository-unavailable"); }
  }
}
