import type { AssetCompositionPlan } from "../../../contracts/asset-composition";

export const computePlanningReadiness = (plan: AssetCompositionPlan): string => {
  if (plan.status === "draft") return "draft-not-yet-validated";
  if (!plan.nodes.length) return "planning-empty";
  return `planning-${plan.status}`;
};
