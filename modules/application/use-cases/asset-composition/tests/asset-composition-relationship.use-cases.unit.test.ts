import assert from "node:assert/strict";
import { describe, it } from "../../../../testing/node-test";
import type { AssetCompositionPlan } from "../../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../../ports/asset-composition";
import { ConnectCompositionNodesUseCase, DisconnectCompositionNodesUseCase, guardSimpleCompositionRelationship, recomputeAssetCompositionPlanningSummary } from "..";

const ws = "workspace.alpha" as never; const now = "2026-05-20T00:00:00.000Z";
const mkPlan = (): AssetCompositionPlan => ({ planId: "plan.alpha" as never, targetWorkspaceId: ws, name: "P", status: "draft", selectedProjections: [{ targetWorkspaceId: ws, projectionId: "p1" as never }, { targetWorkspaceId: ws, projectionId: "p2" as never }], nodes: [{ nodeId: "n1" as never, targetWorkspaceId: ws, selectedProjection: { targetWorkspaceId: ws, projectionId: "p1" as never }, role: "supporting-asset", status: "ready-for-planning", requiredCapabilities: [], providedCapabilities: [], diagnostics: [], blockers: [], createdAt: now, updatedAt: now }, { nodeId: "n2" as never, targetWorkspaceId: ws, selectedProjection: { targetWorkspaceId: ws, projectionId: "p2" as never }, role: "supporting-asset", status: "ready-for-planning", requiredCapabilities: [], providedCapabilities: [], diagnostics: [], blockers: [], createdAt: now, updatedAt: now }], relationships: [], compatibilityDiagnostics: [], blockers: [], planningSummary: { totalNodes: 2, compatibleNodeCount: 0, blockedNodeCount: 0, conflictedNodeCount: 0, missingDependencyCount: 0, staleProjectionCount: 0, unsupportedCount: 0, totalRelationships: 0, compatibleRelationshipCount: 0, blockedRelationshipCount: 0, planningReadiness: "draft-not-yet-validated" }, provenance: [], createdAt: now, updatedAt: now });

const repo = (plan: AssetCompositionPlan): AssetCompositionPlanRepositoryPort => ({ saveAssetCompositionPlanRecord: async (r) => r, updateAssetCompositionPlanRecord: async (r) => r, readAssetCompositionPlanRecord: async (w,p) => (w===plan.targetWorkspaceId&&p===plan.planId?plan:undefined), listAssetCompositionPlanRecords: async()=>({records:[plan]}), listValidDraftBlockedConflictedStaleOrArchivedAssetCompositionPlanRecords: async()=>[plan], listAssetCompositionPlanRecordsBySelectedProjectionId: async()=>[], listAssetCompositionPlanRecordsByEffectiveAssetReference: async()=>[], archiveAssetCompositionPlanRecord: async()=>undefined });

describe("composition relationship connect/disconnect", () => {
  it("connects and disconnects nodes with conservative status", async () => {
    const plan = mkPlan();
    const r = repo(plan);
    const connect = new ConnectCompositionNodesUseCase({ repository: r, generateRelationshipId: () => "rel.1", now: () => now });
    const added = await connect.execute({ targetWorkspaceId: ws, planId: plan.planId, sourceNodeId: "n1" as never, targetNodeId: "n2" as never, relationshipKind: "depends-on" });
    assert.equal(added.status, "success");
    if (added.status === "success") { assert.equal(added.value.relationships.length, 1); assert.equal(added.value.relationships[0]?.compatibilityStatus, "unknown"); assert.equal(added.value.planningSummary.totalRelationships, 1); }

    const disconnect = new DisconnectCompositionNodesUseCase({ repository: repo(added.status === "success" ? added.value : plan), now: () => "2026-05-20T00:01:00.000Z" });
    const removed = await disconnect.execute({ targetWorkspaceId: ws, planId: plan.planId, relationshipId: "rel.1" as never });
    assert.equal(removed.status, "success");
  });

  it("fails on missing/invalid states safely", async () => {
    const plan = mkPlan();
    const connect = new ConnectCompositionNodesUseCase({ repository: repo({ ...plan, status: "archived", archivedAt: now }), generateRelationshipId: () => "rel.1", now: () => now });
    const out = await connect.execute({ targetWorkspaceId: ws, planId: plan.planId, sourceNodeId: "n1" as never, targetNodeId: "n1" as never, relationshipKind: "depends-on" });
    assert.equal(out.status, "failure");
  });

  it("guard and summary behave narrowly", () => {
    const plan = mkPlan();
    const ok = guardSimpleCompositionRelationship({ plan, sourceNode: plan.nodes[0]!, targetNode: plan.nodes[1]!, relationshipKind: "depends-on" });
    assert.equal(ok.ok, true);
    const bad = guardSimpleCompositionRelationship({ plan, sourceNode: { ...plan.nodes[0]!, status: "invalid" }, targetNode: plan.nodes[1]!, relationshipKind: "depends-on" });
    assert.equal(bad.ok, false);
    const summary = recomputeAssetCompositionPlanningSummary({ ...plan, relationships: [{ relationshipId: "r" as never, targetWorkspaceId: ws, sourceNodeId: "n1" as never, targetNodeId: "n2" as never, kind: "depends-on", compatibilityStatus: "blocked", diagnostics: [], blockers: [], createdAt: now, updatedAt: now }] });
    assert.equal(summary.totalNodes, 2); assert.equal(summary.totalRelationships, 1); assert.equal(summary.blockedRelationshipCount, 1);
  });
});
