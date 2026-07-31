import type { AssetCompositionPlan } from "../../../contracts/asset-composition";
import { normalizeExecutionStepId, type ExecutionBlocker, type ExecutionDiagnostic, type ExecutionPlanId, type ExecutionStep, type ExecutionStepId } from "../../../contracts/execution-plans";

export class ExecutionPlanStepPlanningService {
  public plan(args: { planId: ExecutionPlanId; compositionPlan: AssetCompositionPlan; nextExecutionStepId: () => ExecutionStepId | string; sourceCompositionPlanId: string; }) {
    const blockers: ExecutionBlocker[] = [];
    const diagnostics: ExecutionDiagnostic[] = [];
    const steps: ExecutionStep[] = args.compositionPlan.nodes.map((node) => {
      const role = `${node.role}`.toLowerCase();
      const capabilities = [...node.requiredCapabilities, ...node.providedCapabilities].map((c) => `${c.kind}:${c.key}`.toLowerCase()).join(" ");
      let kind: ExecutionStep["kind"] = "manual-review";
      if (capabilities.includes("image") || role.includes("image")) kind = "generate-image";
      else if (capabilities.includes("text") || role.includes("text")) kind = "generate-text";
      else if (capabilities.includes("embed") || role.includes("embed")) kind = "embed-content";
      else if (role.includes("output") || role.includes("storage")) kind = "store-artifact";
      else if (role.includes("input") || role.includes("artifact")) kind = "read-artifact";
      else if (role.includes("transform") || role.includes("data")) kind = "transform-data";
      else if (role.includes("api") || role.includes("service")) kind = "call-api";
      else if (role.includes("validation")) kind = "validate-output";
      if (kind === "manual-review") {
        blockers.push({ code: "execution-plan-unsupported-node", message: "Unsupported composition node requires manual review.", targetReferenceId: node.nodeId, targetReferenceKind: "composition-node" });
        diagnostics.push({ code: "execution-plan-step-manual-review", message: "Step mapped to manual review.", severity: "warning", targetReferenceId: node.nodeId, targetReferenceKind: "composition-node" });
      }
      return { id: normalizeExecutionStepId(String(args.nextExecutionStepId())), planId: args.planId, sourceCompositionPlanId: args.sourceCompositionPlanId, sourceNodeId: node.nodeId, kind, status: kind === "manual-review" ? "needs-review" : "planned", label: node.label ?? `Planned ${kind}`, summary: node.summary ?? "Planning-only execution step.", requiredAdapterReferenceIds: [], inputIds: [], outputIds: [], dependencyIds: [], safetyGateIds: [], blockers: [], diagnostics: [] };
    });
    return { steps, blockers, diagnostics };
  }
}
