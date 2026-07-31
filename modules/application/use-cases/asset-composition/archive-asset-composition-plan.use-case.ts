import { normalizeArchiveAssetCompositionPlanCommand, normalizeAssetCompositionPlan, type ArchiveAssetCompositionPlanCommand, type ArchiveAssetCompositionPlanResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import { createPlanProvenanceEvent } from "./asset-composition-plan-provenance.service";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";

export class ArchiveAssetCompositionPlanUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort; now?: () => string }) {}
  async execute(command: ArchiveAssetCompositionPlanCommand): Promise<ArchiveAssetCompositionPlanResult> {
    let c;
    try { c = normalizeArchiveAssetCompositionPlanCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-workspace-required"); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      const current = await this.d.repository.readAssetCompositionPlanRecord(c.targetWorkspaceId, c.planId);
      if (!current) return assetCompositionPlanFailure("not-found", "asset-composition-plan-not-found");
      if (current.status === "archived") return { status: "success", value: current };
      const archived = normalizeAssetCompositionPlan({ ...current, status: "archived", archivedAt: now, updatedAt: now, provenance: [...current.provenance, createPlanProvenanceEvent("plan-archived", c.targetWorkspaceId, c.planId, now)] });
      return { status: "success", value: await this.d.repository.updateAssetCompositionPlanRecord(archived) };
    } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-workspace-invalid"); }
  }
}
