import { normalizeReadAssetCompositionPlanCommand, type ReadAssetCompositionPlanCommand, type ReadAssetCompositionPlanResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";

export class ReadAssetCompositionPlanUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort }) {}
  async execute(command: ReadAssetCompositionPlanCommand): Promise<ReadAssetCompositionPlanResult> {
    let c;
    try { c = normalizeReadAssetCompositionPlanCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-workspace-required"); }
    try {
      const plan = await this.d.repository.readAssetCompositionPlanRecord(c.targetWorkspaceId, c.planId);
      if (!plan) return assetCompositionPlanFailure("not-found", "asset-composition-plan-not-found");
      return { status: "success", value: plan };
    } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-workspace-invalid"); }
  }
}
