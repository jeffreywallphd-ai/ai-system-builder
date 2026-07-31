import type { AssetCompositionCompatibilityStatus, AssetCompositionNode, AssetCompositionRelationship } from "../../../contracts/asset-composition";

export const computeRelationshipStatus = (r: AssetCompositionRelationship, src: AssetCompositionNode | undefined, dst: AssetCompositionNode | undefined): AssetCompositionCompatibilityStatus => {
  if (!src || !dst) return "missing-dependency";
  if (r.sourceNodeId === r.targetNodeId) return "invalid";
  if ([src.status, dst.status].some((s) => ["blocked", "invalid", "missing-projection", "disabled"].includes(s))) return "blocked";
  if ([src.status, dst.status].includes("stale-projection")) return "stale";
  if ([src.status, dst.status].includes("unsupported")) return "unsupported";
  return "compatible";
};
