import { normalizeAssetCompositionPlan, normalizeCreateAssetCompositionPlanCommand, normalizeAssetCompositionPlanId, type CreateAssetCompositionPlanCommand, type CreateAssetCompositionPlanResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import { createPlanProvenanceEvent } from "./asset-composition-plan-provenance.service";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";

export class CreateAssetCompositionPlanUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort; generatePlanId: () => string; now?: () => string }) {}
  async execute(command: CreateAssetCompositionPlanCommand): Promise<CreateAssetCompositionPlanResult> {
    let c;
    try { c = normalizeCreateAssetCompositionPlanCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-workspace-required"); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    let planId;
    try { planId = normalizeAssetCompositionPlanId(this.d.generatePlanId()); } catch { return assetCompositionPlanFailure("internal", "asset-composition-workspace-invalid"); }
    let plan;
    try {
      plan = normalizeAssetCompositionPlan({
        planId,
        targetWorkspaceId: c.targetWorkspaceId,
        name: c.name,
        ...(c.description ? { description: c.description } : {}),
        status: "draft",
        selectedProjections: [],
        nodes: [],
        relationships: [],
        compatibilityDiagnostics: [],
        blockers: [],
        planningSummary: {
          totalNodes: 0, compatibleNodeCount: 0, blockedNodeCount: 0, conflictedNodeCount: 0, missingDependencyCount: 0, staleProjectionCount: 0, unsupportedCount: 0,
          totalRelationships: 0, compatibleRelationshipCount: 0, blockedRelationshipCount: 0, planningReadiness: "draft-not-yet-validated",
        },
        provenance: [createPlanProvenanceEvent("plan-created", c.targetWorkspaceId, planId, now)],
        createdAt: now,
        updatedAt: now,
      });
    } catch { return assetCompositionPlanFailure("validation", "asset-composition-plan-name-required"); }
    try { return { status: "success", value: await this.d.repository.saveAssetCompositionPlanRecord(plan) }; } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-workspace-invalid"); }
  }
}
