import type { AssetCompositionPlanId } from "../../../contracts/asset-composition";
import type { RuntimeReadinessBindingId, RuntimeReadinessProvenanceEvent, RuntimeRequirementId } from "../../../contracts/runtime-readiness";
import type { WorkspaceId } from "../../../contracts/workspace";

export const createRuntimeReadinessProvenanceEvent = (
  kind: RuntimeReadinessProvenanceEvent["kind"],
  targetWorkspaceId: WorkspaceId,
  compositionPlanId: AssetCompositionPlanId,
  operationAt: string,
  readinessBindingId: RuntimeReadinessBindingId,
  requirementId?: RuntimeRequirementId,
): RuntimeReadinessProvenanceEvent => ({ kind, targetWorkspaceId, compositionPlanId, operationAt, readinessBindingId, ...(requirementId ? { requirementId } : {}) });
