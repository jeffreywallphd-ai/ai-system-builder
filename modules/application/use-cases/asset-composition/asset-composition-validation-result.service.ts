import type { AssetCompositionPlanStatus } from "../../../contracts/asset-composition";

export const computeValidatedPlanStatus = (args: { hasInvalid: boolean; hasBlocked: boolean; hasConflicted: boolean; hasStale: boolean; hasUnsupported: boolean; hasNodes: boolean; }): AssetCompositionPlanStatus => {
  if (args.hasInvalid) return "invalid";
  if (args.hasBlocked) return "blocked";
  if (args.hasConflicted) return "conflicted";
  if (args.hasStale) return "stale";
  if (args.hasUnsupported) return "unsupported";
  if (!args.hasNodes) return "draft";
  return "valid";
};
