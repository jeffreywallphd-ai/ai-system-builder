import { normalizeRuntimeRequirement, type RuntimeCapabilityKind, type RuntimeReadinessDiagnostic, type RuntimeRequirement } from "../../../contracts/runtime-readiness";
import type { AssetCompositionCapability, AssetCompositionPlan } from "../../../contracts/asset-composition";

const mapCompositionCapabilityToRuntimeKind = (capability: AssetCompositionCapability): RuntimeCapabilityKind | undefined => {
  switch (capability.kind) {
    case "runtime-capability":
      return "local-runtime";
    case "storage-capability":
      return "storage-provider";
    case "model":
      return "model";
    case "configuration":
      return "credential-reference";
    case "data-input":
    case "data-output":
      return "artifact-storage";
    default:
      return undefined;
  }
};

export class RuntimeRequirementExtractionService {
  public extractRequirements(input: { plan: AssetCompositionPlan; nextRequirementId: () => RuntimeRequirement["requirementId"]; now: string }): { requirements: RuntimeRequirement[]; diagnostics: RuntimeReadinessDiagnostic[] } {
    const requirements: RuntimeRequirement[] = [];
    const diagnostics: RuntimeReadinessDiagnostic[] = [];
    for (const node of input.plan.nodes) for (const capability of node.requiredCapabilities ?? []) {
      const runtimeKind = mapCompositionCapabilityToRuntimeKind(capability);
      if (!runtimeKind) {
        diagnostics.push({ code: "runtime-readiness-requirement-unsupported", severity: "warning", message: "Sanitized unsupported composition capability diagnostic." });
        continue;
      }
      requirements.push(normalizeRuntimeRequirement({ requirementId: input.nextRequirementId(), targetWorkspaceId: input.plan.targetWorkspaceId, compositionPlanId: input.plan.planId, sourceNodeId: node.nodeId, capabilityKind: runtimeKind, capabilityKey: capability.key, isRequired: capability.direction !== "provided", label: `${runtimeKind}:${capability.key}`.slice(0, 80), diagnostics: [], blockers: [] }));
    }
    if (requirements.length === 0) diagnostics.push({ code: "runtime-readiness-requirement-missing", severity: "warning", message: "Sanitized runtime requirement extraction diagnostic." });
    return { requirements, diagnostics };
  }
}
