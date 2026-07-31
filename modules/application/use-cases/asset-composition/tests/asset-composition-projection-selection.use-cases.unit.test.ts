import assert from "node:assert/strict";
import { describe, it } from "../../../../testing/node-test";
import type { AssetCompositionPlan } from "../../../../contracts/asset-composition";
import type { EffectiveAssetProjectionRecord } from "../../../../contracts/effective-asset-projections";
import type { AssetCompositionPlanRepositoryPort } from "../../../ports/asset-composition";
import type { EffectiveAssetProjectionRepositoryPort } from "../../../ports/effective-asset-projections";
import { AddProjectionToCompositionPlanUseCase, RemoveProjectionFromCompositionPlanUseCase } from "..";

const ws = "workspace.alpha" as never;
const now = "2026-05-20T00:00:00.000Z";
const plan = (): AssetCompositionPlan => ({ planId: "plan.alpha" as never, targetWorkspaceId: ws, name: "P", status: "draft", selectedProjections: [], nodes: [], relationships: [], compatibilityDiagnostics: [], blockers: [], planningSummary: { totalNodes: 0, compatibleNodeCount: 0, blockedNodeCount: 0, conflictedNodeCount: 0, missingDependencyCount: 0, staleProjectionCount: 0, unsupportedCount: 0, totalRelationships: 0, compatibleRelationshipCount: 0, blockedRelationshipCount: 0, planningReadiness: "draft-not-yet-validated" }, provenance: [], createdAt: now, updatedAt: now });
const projection = (status: EffectiveAssetProjectionRecord["status"] = "ready"): EffectiveAssetProjectionRecord => ({ projectionId: "projection.a" as never, targetWorkspaceId: ws, source: { sourceKind: "workspace-authored", targetWorkspaceId: ws, authoredAssetId: "authored.a" as never }, target: { targetWorkspaceId: ws, effectiveAssetReference: { kind: "asset-instance" as never, id: "e" as never }, intendedPolicy: "safe-fields-only" }, effectiveAssetReference: { kind: "asset-instance" as never, id: "e" as never }, sourceKind: "workspace-authored", status, policy: "safe-fields-only", projectedFields: {}, diagnostics: [], blockers: [], provenance: { targetWorkspaceId: ws, sourceKind: "workspace-authored", operationAt: now }, createdAt: now, updatedAt: now });

const repos = () => {
  const plans: AssetCompositionPlan[] = [plan()];
  const projections: EffectiveAssetProjectionRecord[] = [projection()];
  const planRepo: AssetCompositionPlanRepositoryPort = {
    saveAssetCompositionPlanRecord: async (r) => r, updateAssetCompositionPlanRecord: async (r) => (plans[0] = r, r), readAssetCompositionPlanRecord: async (w, p) => plans.find((x) => x.targetWorkspaceId === w && x.planId === p), listAssetCompositionPlanRecords: async () => ({ records: plans }), listValidDraftBlockedConflictedStaleOrArchivedAssetCompositionPlanRecords: async () => plans, listAssetCompositionPlanRecordsBySelectedProjectionId: async () => [], listAssetCompositionPlanRecordsByEffectiveAssetReference: async () => [], archiveAssetCompositionPlanRecord: async () => undefined,
  };
  const projRepo: EffectiveAssetProjectionRepositoryPort = {
    saveEffectiveAssetProjectionRecord: async (r) => r, updateEffectiveAssetProjectionRecord: async (r) => r, readEffectiveAssetProjectionRecord: async (w, p) => projections.find((x) => x.targetWorkspaceId === w && x.projectionId === p), readEffectiveAssetProjectionRecordByEffectiveAssetReference: async () => undefined, listEffectiveAssetProjectionRecords: async () => ({ records: projections }), listBlockedConflictedOrStaleEffectiveAssetProjectionRecords: async () => [],
  };
  return { plans, projections, planRepo, projRepo };
};

describe("composition plan projection add/remove", () => {
  it("adds ready projection as node and removes it", async () => {
    const r = repos();
    const add = new AddProjectionToCompositionPlanUseCase({ repository: r.planRepo, projectionRepository: r.projRepo, generateNodeId: () => "node.a", now: () => now });
    const added = await add.execute({ targetWorkspaceId: ws, planId: "plan.alpha" as never, projectionId: "projection.a" as never });
    assert.equal(added.status, "success");
    if (added.status === "success") {
      assert.equal(added.value.nodes.length, 1);
      assert.equal(added.value.nodes[0]?.role, "supporting-asset");
      assert.equal(added.value.relationships.length, 0);
      assert.equal(added.value.provenance.at(-1)?.kind, "projection-selected");
    }
    const remove = new RemoveProjectionFromCompositionPlanUseCase({ repository: r.planRepo, now: () => "2026-05-20T00:01:00.000Z" });
    const removed = await remove.execute({ targetWorkspaceId: ws, planId: "plan.alpha" as never, projectionId: "projection.a" as never });
    assert.equal(removed.status, "success");
  });

  it("rejects blocked statuses and archived/duplicate safely", async () => {
    for (const status of ["draft-only", "blocked", "conflicted", "disabled", "source-missing", "stale", "unsupported", "invalid"] as const) {
      const r = repos(); r.projections[0] = projection(status);
      const add = new AddProjectionToCompositionPlanUseCase({ repository: r.planRepo, projectionRepository: r.projRepo, generateNodeId: () => "node.a", now: () => now });
      const out = await add.execute({ targetWorkspaceId: ws, planId: "plan.alpha" as never, projectionId: "projection.a" as never });
      assert.equal(out.status, "failure");
    }
  });
});
