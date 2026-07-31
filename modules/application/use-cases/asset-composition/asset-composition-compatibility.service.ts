import type { AssetCompositionPlan } from "../../../contracts/asset-composition";
import type { EffectiveAssetProjectionId, EffectiveAssetProjectionRecord } from "../../../contracts/effective-asset-projections";
import { planningBlocker, planningDiagnostic } from "./asset-composition-diagnostics.service";
import { mapProjectionStatusToNodeStatus } from "./asset-composition-node-status.service";
import { computeRelationshipStatus } from "./asset-composition-relationship-status.service";

export const evaluateCompatibility = (plan: AssetCompositionPlan, projectionMap: Map<EffectiveAssetProjectionId, EffectiveAssetProjectionRecord>) => {
  const diagnostics = [...plan.compatibilityDiagnostics]; const blockers = [...plan.blockers];
  const selected = new Set(plan.selectedProjections.map((p) => p.projectionId));
  const nodes = plan.nodes.map((n) => {
    const pr = projectionMap.get(n.selectedProjection.projectionId);
    if (!selected.has(n.selectedProjection.projectionId) || !pr) {
      diagnostics.push(planningDiagnostic("asset-composition-node-selected-projection-missing")); blockers.push(planningBlocker("asset-composition-node-selected-projection-missing"));
      return { ...n, status: "missing-projection" as const };
    }
    if (pr.targetWorkspaceId !== plan.targetWorkspaceId || n.targetWorkspaceId !== plan.targetWorkspaceId) {
      diagnostics.push(planningDiagnostic("asset-composition-workspace-invalid")); blockers.push(planningBlocker("asset-composition-workspace-invalid"));
      return { ...n, status: "invalid" as const };
    }
    const mismatch = referencesMismatch(n.effectiveAssetReference, pr.effectiveAssetReference);
    if (mismatch) {
      diagnostics.push(planningDiagnostic("asset-composition-node-reference-mismatch"));
      blockers.push(planningBlocker("asset-composition-node-reference-mismatch"));
    }
    return { ...n, status: mismatch ? "invalid" : mapProjectionStatusToNodeStatus(pr.status) };
  });
  const nodeMap = new Map(nodes.map((n) => [n.nodeId, n]));
  const seen = new Set<string>();
  const relationships = plan.relationships.map((r) => {
    const key = `${r.sourceNodeId}:${r.targetNodeId}:${r.kind}`;
    const duplicate = seen.has(key); seen.add(key);
    const compatibilityStatus = duplicate ? "conflicted" : computeRelationshipStatus(r, nodeMap.get(r.sourceNodeId), nodeMap.get(r.targetNodeId));
    return { ...r, compatibilityStatus };
  });
  return { nodes, relationships, diagnostics, blockers };
};

const referencesMismatch = (nodeRef: AssetCompositionPlan["nodes"][number]["effectiveAssetReference"], projectionRef: EffectiveAssetProjectionRecord["effectiveAssetReference"]) => {
  if (!nodeRef) return false;
  if (nodeRef.kind !== projectionRef.kind || nodeRef.id !== projectionRef.id) return true;
  if (typeof nodeRef.version === "string" && nodeRef.version.length > 0) {
    return nodeRef.version !== projectionRef.version;
  }
  return false;
};
