import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AssetCompositionPlan } from "../../../../contracts/asset-composition";
import type { EffectiveAssetProjectionRecord } from "../../../../contracts/effective-asset-projections";
import { ValidateAssetCompositionPlanUseCase } from "../validate-asset-composition-plan.use-case";

const ws = "workspace.alpha" as never; const now = "2026-01-01T00:00:00.000Z";
const plan = (): AssetCompositionPlan => ({ planId: "plan.a" as never, targetWorkspaceId: ws, name: "P", status: "draft", selectedProjections: [{ targetWorkspaceId: ws, projectionId: "p1" as never }], nodes: [{ nodeId: "n1" as never, targetWorkspaceId: ws, selectedProjection: { targetWorkspaceId: ws, projectionId: "p1" as never }, effectiveAssetReference: { kind: "artifact" as never, id: "ea1" as never }, role: "supporting-asset", status: "planned", requiredCapabilities: [], providedCapabilities: [], diagnostics: [], blockers: [], createdAt: now, updatedAt: now }], relationships: [], compatibilityDiagnostics: [], blockers: [], planningSummary: { totalNodes: 1, compatibleNodeCount: 0, blockedNodeCount: 0, conflictedNodeCount: 0, missingDependencyCount: 0, staleProjectionCount: 0, unsupportedCount: 0, totalRelationships: 0, compatibleRelationshipCount: 0, blockedRelationshipCount: 0, planningReadiness: "draft-not-yet-validated" }, provenance: [], createdAt: now, updatedAt: now });
const proj = (status: EffectiveAssetProjectionRecord["status"] = "ready"): EffectiveAssetProjectionRecord => ({ projectionId: "p1" as never, targetWorkspaceId: ws, source: { sourceWorkspaceId: ws, assetId: "a" as never }, target: { targetWorkspaceId: ws, effectiveAssetId: "ea1" as never, displayLabel: "A" }, effectiveAssetReference: { kind: "artifact" as never, id: "ea1" as never }, sourceKind: "workspace-authored" as never, status, policy: { allowPreviewDraftSelection: false }, projectedFields: {}, diagnostics: [], blockers: [], provenance: { recomputeVersion: 1 }, createdAt: now, updatedAt: now });

describe("ValidateAssetCompositionPlanUseCase", () => {
  it("validates ready draft plan and appends provenance", async () => {
    let saved: AssetCompositionPlan | undefined;
    const useCase = new ValidateAssetCompositionPlanUseCase({ repository: { readAssetCompositionPlanRecord: async () => plan(), updateAssetCompositionPlanRecord: async (p) => (saved = p, p), listAssetCompositionPlanRecords: async () => { throw new Error(); }, saveAssetCompositionPlanRecord: async () => { throw new Error(); } }, projectionRepository: { readEffectiveAssetProjectionRecord: async () => proj(), readEffectiveAssetProjectionRecordByEffectiveAssetReference: async () => undefined, listEffectiveAssetProjectionRecords: async () => { throw new Error(); }, listBlockedConflictedOrStaleEffectiveAssetProjectionRecords: async () => [], saveEffectiveAssetProjectionRecord: async () => { throw new Error(); }, updateEffectiveAssetProjectionRecord: async () => { throw new Error(); } }, now: () => now });
    const r = await useCase.execute({ targetWorkspaceId: ws, planId: "plan.a" as never });
    assert.equal(r.status, "success");
    if (r.status === "success") { assert.equal(r.value.status, "valid"); assert.equal(r.value.planningSummary.compatibleNodeCount, 1); assert.equal(r.value.provenance.at(-1)?.kind, "plan-validated"); }
    assert.equal(saved?.updatedAt, now);
  });

  it("returns not-found for missing plan", async () => {
    const useCase = new ValidateAssetCompositionPlanUseCase({ repository: { readAssetCompositionPlanRecord: async () => undefined, updateAssetCompositionPlanRecord: async (p) => p, listAssetCompositionPlanRecords: async () => { throw new Error(); }, saveAssetCompositionPlanRecord: async () => { throw new Error(); } }, projectionRepository: { readEffectiveAssetProjectionRecord: async () => proj(), readEffectiveAssetProjectionRecordByEffectiveAssetReference: async () => undefined, listEffectiveAssetProjectionRecords: async () => { throw new Error(); }, listBlockedConflictedOrStaleEffectiveAssetProjectionRecords: async () => [], saveEffectiveAssetProjectionRecord: async () => { throw new Error(); }, updateEffectiveAssetProjectionRecord: async () => { throw new Error(); } } });
    const r = await useCase.execute({ targetWorkspaceId: ws, planId: "plan.a" as never });
    assert.equal(r.status, "failure");
  });
});


it("marks effective asset mismatch as blocking invalid", async () => {
  const useCase = new ValidateAssetCompositionPlanUseCase({ repository: { readAssetCompositionPlanRecord: async () => plan(), updateAssetCompositionPlanRecord: async (p) => p, listAssetCompositionPlanRecords: async () => { throw new Error(); }, saveAssetCompositionPlanRecord: async () => { throw new Error(); } }, projectionRepository: { readEffectiveAssetProjectionRecord: async () => ({ ...proj(), effectiveAssetReference: { kind: "artifact" as never, id: "ea2" as never } }), readEffectiveAssetProjectionRecordByEffectiveAssetReference: async () => undefined, listEffectiveAssetProjectionRecords: async () => { throw new Error(); }, listBlockedConflictedOrStaleEffectiveAssetProjectionRecords: async () => [], saveEffectiveAssetProjectionRecord: async () => { throw new Error(); }, updateEffectiveAssetProjectionRecord: async () => { throw new Error(); } } });
  const r = await useCase.execute({ targetWorkspaceId: ws, planId: "plan.a" as never });
  assert.equal(r.status, "success");
  if (r.status === "success") {
    assert.equal(r.value.status, "invalid");
    assert.equal(r.value.nodes[0]?.status, "invalid");
    assert.ok(r.value.blockers.some((b) => b.code === "asset-composition-node-reference-mismatch"));
  }
});
