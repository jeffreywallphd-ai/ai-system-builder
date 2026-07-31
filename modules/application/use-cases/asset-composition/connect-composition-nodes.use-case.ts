import { normalizeAssetCompositionPlan, normalizeAssetCompositionRelationshipId, normalizeConnectCompositionNodesCommand, type ConnectCompositionNodesCommand, type ConnectCompositionNodesResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import { createAssetCompositionRelationship } from "./asset-composition-relationship-factory.service";
import { createPlanProvenanceEvent } from "./asset-composition-plan-provenance.service";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";
import { recomputeAssetCompositionPlanningSummary } from "./asset-composition-plan-summary.service";
import { guardSimpleCompositionRelationship } from "./asset-composition-simple-relationship-guard.service";

export class ConnectCompositionNodesUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort; generateRelationshipId: () => string; now?: () => string }) {}
  async execute(command: ConnectCompositionNodesCommand): Promise<ConnectCompositionNodesResult> {
    let c; try { c = normalizeConnectCompositionNodesCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-relationship-unsupported"); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      const plan = await this.d.repository.readAssetCompositionPlanRecord(c.targetWorkspaceId, c.planId);
      if (!plan) return assetCompositionPlanFailure("not-found", "asset-composition-plan-not-found");
      const sourceNode = plan.nodes.find((x) => x.nodeId === c.sourceNodeId); if (!sourceNode) return assetCompositionPlanFailure("not-found", "asset-composition-relationship-node-missing");
      const targetNode = plan.nodes.find((x) => x.nodeId === c.targetNodeId); if (!targetNode) return assetCompositionPlanFailure("not-found", "asset-composition-relationship-node-missing");
      const guarded = guardSimpleCompositionRelationship({ plan, sourceNode, targetNode, relationshipKind: c.relationshipKind });
      if (!guarded.ok) return assetCompositionPlanFailure(guarded.code === "asset-composition-relationship-duplicate" ? "conflict" : "blocked", guarded.code);
      const relationshipId = c.relationshipId ?? normalizeAssetCompositionRelationshipId(this.d.generateRelationshipId());
      const relationship = createAssetCompositionRelationship({ relationshipId, targetWorkspaceId: c.targetWorkspaceId, sourceNodeId: c.sourceNodeId, targetNodeId: c.targetNodeId, kind: c.relationshipKind, compatibilityStatus: "unknown", now });
      const next = normalizeAssetCompositionPlan({ ...plan, relationships: [...plan.relationships, relationship], planningSummary: recomputeAssetCompositionPlanningSummary({ ...plan, relationships: [...plan.relationships, relationship] }), provenance: [...plan.provenance, { ...createPlanProvenanceEvent("relationship-added", c.targetWorkspaceId, c.planId, now), relationshipId }], updatedAt: now });
      return { status: "success", value: await this.d.repository.updateAssetCompositionPlanRecord(next) };
    } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-repository-unavailable"); }
  }
}
