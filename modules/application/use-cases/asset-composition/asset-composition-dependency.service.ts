import type { AssetCompositionPlan, AssetCompositionDiagnostic } from "../../../contracts/asset-composition";
import { planningDiagnostic } from "./asset-composition-diagnostics.service";

export const findMissingCapabilityDiagnostics = (plan: AssetCompositionPlan): AssetCompositionDiagnostic[] => {
  const provided = new Set(plan.nodes.flatMap((n) => n.providedCapabilities.map((c) => `${c.key}:${c.kind}`)));
  const out: AssetCompositionDiagnostic[] = [];
  for (const node of plan.nodes) {
    for (const req of node.requiredCapabilities) {
      if (!provided.has(`${req.key}:${req.kind}`)) out.push(planningDiagnostic("asset-composition-missing-dependency"));
    }
  }
  return out;
};
