import test from "node:test";
import assert from "node:assert/strict";

import type { AssetCompositionPlan } from "../../../../contracts/asset-composition";
import { WorkspaceAssetCompositionReadModelService } from "../workspace-asset-composition-read-model.service";

class FakeRepo {
  public records: AssetCompositionPlan[] = [];
  async saveAssetCompositionPlanRecord() { throw new Error("unused"); }
  async updateAssetCompositionPlanRecord() { throw new Error("unused"); }
  async archiveAssetCompositionPlanRecord() { throw new Error("unused"); }
  async listValidDraftBlockedConflictedStaleOrArchivedAssetCompositionPlanRecords() { return []; }
  async readAssetCompositionPlanRecord(workspaceId: any, planId: any) { return this.records.find((r) => r.targetWorkspaceId === workspaceId && r.planId === planId); }
  async listAssetCompositionPlanRecords(query: any) { return { records: this.records.filter((r) => r.targetWorkspaceId === query.targetWorkspaceId) }; }
  async listAssetCompositionPlanRecordsBySelectedProjectionId(workspaceId: any, projectionId: any) { return this.records.filter((r) => r.targetWorkspaceId === workspaceId && r.selectedProjections.some((p) => p.projectionId === projectionId)); }
  async listAssetCompositionPlanRecordsByEffectiveAssetReference(workspaceId: any, effective: any) { return this.records.filter((r) => r.targetWorkspaceId === workspaceId && r.selectedProjections.some((p) => p.effectiveAssetReference?.kind === effective.kind && p.effectiveAssetReference?.id === effective.id && (p.effectiveAssetReference?.version ?? "") === (effective.version ?? ""))); }
}

const wa = "workspace.a" as any; const wb = "workspace.b" as any;

test("workspace-scoped summaries and attention classification", async () => {
  const repo = new FakeRepo();
  repo.records = [plan("p.valid", wa, "valid"), plan("p.blocked", wa, "blocked"), plan("p.foreign", wb, "blocked")];
  const svc = new WorkspaceAssetCompositionReadModelService({ compositionPlanRepository: repo as any });
  const list = await svc.listCompositionPlanSummaries({ targetWorkspaceId: wa });
  assert.equal(list.summaries.length, 2);
  assert.equal(list.summaries.find((s) => s.planId === "p.valid")?.needsAttention, false);
  assert.equal(list.summaries.find((s) => s.planId === "p.blocked")?.needsAttention, true);
});

test("reads detail safely and workspace isolated", async () => {
  const repo = new FakeRepo(); repo.records = [plan("p.same", wa, "draft"), plan("p.same", wb, "draft")];
  const svc = new WorkspaceAssetCompositionReadModelService({ compositionPlanRepository: repo as any });
  const a = await svc.readCompositionPlanDetail({ targetWorkspaceId: wa, planId: "p.same" });
  const miss = await svc.readCompositionPlanDetail({ targetWorkspaceId: wa, planId: "none" });
  assert.equal(a?.summary.targetWorkspaceId, wa);
  assert.equal(a?.nodes[0]?.requiredCapabilityCount, 1);
  assert.equal("safeDetails" in ((a?.diagnostics[0] ?? {}) as any), false);
  assert.equal((a as any)?.workflowJson, undefined);
  assert.equal(miss, undefined);
});

test("plans for projection/effective ref and needing-attention are workspace scoped", async () => {
  const repo = new FakeRepo();
  repo.records = [plan("p1", wa, "valid"), plan("p2", wa, "conflicted"), plan("p1", wb, "blocked")];
  const svc = new WorkspaceAssetCompositionReadModelService({ compositionPlanRepository: repo as any });
  const byProjection = await svc.listPlansForProjection({ targetWorkspaceId: wa, projectionId: "proj.1" });
  const byRef = await svc.listPlansForEffectiveAssetReference({ targetWorkspaceId: wa, effectiveAssetReference: { kind: "asset-instance", id: "asset.1", version: "1.0.0" } as any });
  const attention = await svc.listPlansNeedingAttention({ targetWorkspaceId: wa });
  assert.equal(byProjection.length, 2);
  assert.equal(byRef.length, 2);
  assert.equal(attention.length, 1);
  assert.equal(attention[0]?.planId, "p2");
});

function plan(id: string, workspaceId: any, status: any): AssetCompositionPlan {
  return {
    planId: id as any, targetWorkspaceId: workspaceId, name: id, status,
    selectedProjections: [{ targetWorkspaceId: workspaceId, projectionId: "proj.1" as any, effectiveAssetReference: { kind: "asset-instance", id: "asset.1", version: "1.0.0" } as any, displayLabel: "<b>Proj</b>" }],
    nodes: [{ nodeId: "n1" as any, targetWorkspaceId: workspaceId, selectedProjection: { targetWorkspaceId: workspaceId, projectionId: "proj.1" as any }, role: "primary-input" as any, status: "ready-for-planning", requiredCapabilities: [{ capabilityId: "c1", capabilityKind: "data" } as any], providedCapabilities: [], diagnostics: [{ code: "asset-composition-missing-dependency", severity: "warning", message: "<x>msg</x>", safeDetails: { command: "rm -rf" } } as any], blockers: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
    relationships: [{ relationshipId: "r1" as any, targetWorkspaceId: workspaceId, sourceNodeId: "n1" as any, targetNodeId: "n1" as any, kind: "depends-on", compatibilityStatus: "compatible", diagnostics: [], blockers: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
    compatibilityDiagnostics: [{ code: "asset-composition-missing-dependency", severity: "warning", message: "diag", safeDetails: { token: "x" } } as any], blockers: status === "blocked" ? [{ code: "asset-composition-missing-dependency", message: "blocked" } as any] : [],
    planningSummary: { totalNodes: 1, compatibleNodeCount: 1, blockedNodeCount: 0, conflictedNodeCount: 0, missingDependencyCount: 0, staleProjectionCount: 0, unsupportedCount: 0, totalRelationships: 1, compatibleRelationshipCount: 1, blockedRelationshipCount: 0, planningReadiness: "Ready for planning" },
    provenance: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  } as any;
}


test("sanitizes unsafe display fields", async () => {
  const repo = new FakeRepo(); repo.records = [plan("p.safe", wa, "blocked")];
  const svc = new WorkspaceAssetCompositionReadModelService({ compositionPlanRepository: repo as any });
  const detail = await svc.readCompositionPlanDetail({ targetWorkspaceId: wa, planId: "p.safe" });
  assert.equal(detail?.summary.name.includes("<"), false);
  assert.equal(detail?.selectedProjections[0]?.displayLabel?.includes("<"), false);
  assert.equal(detail?.diagnostics[0]?.message.includes("<"), false);
});
