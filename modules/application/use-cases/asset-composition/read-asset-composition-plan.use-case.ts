import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";
import { normalizeReadAssetCompositionPlanCommand, type ReadAssetCompositionPlanCommand, type ReadAssetCompositionPlanResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";

export class ReadAssetCompositionPlanUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort; workspaceAccess: WorkspaceAssetAccessPort }) {}
  async execute(command: ReadAssetCompositionPlanCommand): Promise<ReadAssetCompositionPlanResult> {
    let c;
    try { c = normalizeReadAssetCompositionPlanCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-workspace-required"); }
    try { await this.d.workspaceAccess.authorize(c.targetWorkspaceId, "asset-composition:read-asset-composition-plan", "asset:read"); } catch { return assetCompositionPlanFailure("blocked", "asset-composition-workspace-invalid"); }
    try {
      const plan = await this.d.repository.readAssetCompositionPlanRecord(c.targetWorkspaceId, c.planId);
      if (!plan) return assetCompositionPlanFailure("not-found", "asset-composition-plan-not-found");
      return { status: "success", value: plan };
    } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-workspace-invalid"); }
  }
}
