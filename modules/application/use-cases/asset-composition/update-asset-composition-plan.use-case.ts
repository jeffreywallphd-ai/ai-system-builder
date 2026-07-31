import { normalizeAssetCompositionPlan, normalizeUpdateAssetCompositionPlanCommand, type UpdateAssetCompositionPlanCommand, type UpdateAssetCompositionPlanResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";

export class UpdateAssetCompositionPlanUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort; now?: () => string }) {}
  async execute(command: UpdateAssetCompositionPlanCommand): Promise<UpdateAssetCompositionPlanResult> {
    let c;
    try { c = normalizeUpdateAssetCompositionPlanCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-command-invalid"); }
    try {
      const current = await this.d.repository.readAssetCompositionPlanRecord(c.targetWorkspaceId, c.planId);
      if (!current) return assetCompositionPlanFailure("not-found", "asset-composition-plan-not-found");
      if (current.status === "archived") return assetCompositionPlanFailure("conflict", "asset-composition-plan-archived");
      if (c.status && c.status !== "draft") return assetCompositionPlanFailure("unsupported", "asset-composition-command-invalid");
      const updated = normalizeAssetCompositionPlan({
        ...current,
        ...(c.name ? { name: c.name } : {}),
        ...(c.description !== undefined ? { description: c.description } : {}),
        ...(c.status ? { status: c.status } : {}),
        updatedAt: (this.d.now ?? (() => new Date().toISOString()))(),
      });
      return { status: "success", value: await this.d.repository.updateAssetCompositionPlanRecord(updated) };
    } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-repository-unavailable"); }
  }
}
