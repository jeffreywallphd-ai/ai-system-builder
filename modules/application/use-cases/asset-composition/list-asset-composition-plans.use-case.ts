import { normalizeListAssetCompositionPlansCommand, type ListAssetCompositionPlansCommand, type ListAssetCompositionPlansResult } from "../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import { assetCompositionPlanFailure } from "./asset-composition-plan-result-helpers";

const MAX_LIMIT = 100;

export class ListAssetCompositionPlansUseCase {
  constructor(private readonly d: { repository: AssetCompositionPlanRepositoryPort }) {}
  async execute(command: ListAssetCompositionPlansCommand): Promise<ListAssetCompositionPlansResult> {
    let c;
    try { c = normalizeListAssetCompositionPlansCommand(command); } catch { return assetCompositionPlanFailure("validation", "asset-composition-workspace-required"); }
    const limit = typeof c.limit === "number" ? Math.max(1, Math.min(MAX_LIMIT, c.limit)) : undefined;
    try {
      const listed = await this.d.repository.listAssetCompositionPlanRecords({
        targetWorkspaceId: c.targetWorkspaceId,
        ...(c.status ? { status: c.status } : {}),
        ...(c.selectedProjectionId ? { selectedProjectionId: c.selectedProjectionId } : {}),
        ...(c.effectiveAssetReference ? { effectiveAssetReference: c.effectiveAssetReference } : {}),
        ...(c.nodeRole ? { nodeRole: c.nodeRole } : {}),
        ...(c.relationshipKind ? { relationshipKind: c.relationshipKind } : {}),
        ...(c.compatibilityStatus ? { compatibilityStatus: c.compatibilityStatus } : {}),
        ...(c.blockedOnly !== undefined ? { blockedOnly: c.blockedOnly } : {}),
        ...(c.conflictedOnly !== undefined ? { conflictedOnly: c.conflictedOnly } : {}),
        ...(c.staleOnly !== undefined ? { staleOnly: c.staleOnly } : {}),
        ...(c.archived !== undefined ? { archived: c.archived } : {}),
        ...(c.text ? { text: c.text } : {}),
        ...(limit ? { limit } : {}),
        ...(c.cursor ? { cursor: c.cursor } : {}),
      });
      return { status: "success", value: { records: [...listed.records], ...(listed.nextCursor ? { nextCursor: listed.nextCursor } : {}) } };
    } catch { return assetCompositionPlanFailure("unavailable", "asset-composition-repository-unavailable"); }
  }
}
