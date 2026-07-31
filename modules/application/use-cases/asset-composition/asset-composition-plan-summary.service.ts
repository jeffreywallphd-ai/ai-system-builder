import type { AssetCompositionPlan } from "../../../contracts/asset-composition";

export const recomputeAssetCompositionPlanningSummary = (plan: AssetCompositionPlan): AssetCompositionPlan["planningSummary"] => {
  const compatibleNodeCount = plan.nodes.filter((x) => x.status === "ready-for-planning").length;
  const blockedNodeCount = plan.nodes.filter((x) => ["blocked", "missing-projection", "invalid", "disabled"].includes(x.status)).length;
  const conflictedNodeCount = plan.nodes.filter((x) => x.status === "conflicted").length;
  const staleProjectionCount = plan.nodes.filter((x) => x.status === "stale-projection").length;
  const unsupportedCount = plan.nodes.filter((x) => x.status === "unsupported").length;
  const compatibleRelationshipCount = plan.relationships.filter((x) => x.compatibilityStatus === "compatible").length;
  const blockedRelationshipCount = plan.relationships.filter((x) => ["blocked", "missing-dependency"].includes(x.compatibilityStatus)).length;
  const missingDependencyCount = plan.relationships.filter((x) => x.compatibilityStatus === "missing-dependency").length;
  return { ...plan.planningSummary, totalNodes: plan.nodes.length, compatibleNodeCount, blockedNodeCount, conflictedNodeCount, missingDependencyCount, staleProjectionCount, unsupportedCount, totalRelationships: plan.relationships.length, compatibleRelationshipCount, blockedRelationshipCount };
};
