import assert from "node:assert/strict";
import { describe, it } from "../../../../testing/node-test";
import type { AssetCompositionPlan } from "../../../../contracts/asset-composition";
import type { AssetCompositionPlanRepositoryPort } from "../../../ports/asset-composition";
import { ArchiveAssetCompositionPlanUseCase, CreateAssetCompositionPlanUseCase, ListAssetCompositionPlansUseCase, ReadAssetCompositionPlanUseCase, UpdateAssetCompositionPlanUseCase } from "..";

const ws = "workspace.alpha" as never;
const now = "2026-05-20T00:00:00.000Z";
const basePlan = (): AssetCompositionPlan => ({ planId: "plan.alpha" as never, targetWorkspaceId: ws, name: "Plan A", status: "draft", selectedProjections: [], nodes: [], relationships: [], compatibilityDiagnostics: [], blockers: [], planningSummary: { totalNodes: 0, compatibleNodeCount: 0, blockedNodeCount: 0, conflictedNodeCount: 0, missingDependencyCount: 0, staleProjectionCount: 0, unsupportedCount: 0, totalRelationships: 0, compatibleRelationshipCount: 0, blockedRelationshipCount: 0, planningReadiness: "draft-not-yet-validated" }, provenance: [], createdAt: now, updatedAt: now });

const repo = (): AssetCompositionPlanRepositoryPort & { records: AssetCompositionPlan[] } => ({
  records: [],
  async saveAssetCompositionPlanRecord(record) { this.records.push(record); return record; },
  async updateAssetCompositionPlanRecord(record) { this.records = this.records.map((r) => (r.planId === record.planId ? record : r)); return record; },
  async readAssetCompositionPlanRecord(targetWorkspaceId, planId) { return this.records.find((r) => r.targetWorkspaceId === targetWorkspaceId && r.planId === planId); },
  async listAssetCompositionPlanRecords(query) { return { records: this.records.filter((r) => r.targetWorkspaceId === query.targetWorkspaceId), nextCursor: undefined }; },
  async listValidDraftBlockedConflictedStaleOrArchivedAssetCompositionPlanRecords(targetWorkspaceId) { return this.records.filter((r) => r.targetWorkspaceId === targetWorkspaceId); },
  async listAssetCompositionPlanRecordsBySelectedProjectionId() { return []; },
  async listAssetCompositionPlanRecordsByEffectiveAssetReference() { return []; },
  async archiveAssetCompositionPlanRecord() { return undefined; },
});

describe("asset composition plan use cases", () => {
  it("creates draft plan with defaults/provenance", async () => {
    const r = repo();
    const uc = new CreateAssetCompositionPlanUseCase({ repository: r, generatePlanId: () => "plan.generated", now: () => now });
    const out = await uc.execute({ targetWorkspaceId: ws, name: "Plan A" });
    assert.equal(out.status, "success");
    if (out.status === "success") {
      assert.equal(out.value.planId, "plan.generated");
      assert.equal(out.value.status, "draft");
      assert.equal(out.value.nodes.length, 0);
      assert.equal(out.value.provenance[0]?.kind, "plan-created");
    }
  });
  it("update respects safety and blocks valid/archive", async () => {
    const r = repo(); r.records.push(basePlan());
    const uc = new UpdateAssetCompositionPlanUseCase({ repository: r, now: () => "2026-05-20T00:01:00.000Z" });
    const ok = await uc.execute({ targetWorkspaceId: ws, planId: "plan.alpha" as never, name: "Plan B" });
    assert.equal(ok.status, "success");
    const no = await uc.execute({ targetWorkspaceId: ws, planId: "plan.alpha" as never, status: "valid" });
    assert.equal(no.status, "failure");
  });
  it("read/list are workspace scoped and not-found safe", async () => {
    const r = repo(); r.records.push(basePlan(), { ...basePlan(), planId: "plan.beta" as never, targetWorkspaceId: "workspace.beta" as never });
    const read = new ReadAssetCompositionPlanUseCase({ repository: r });
    const found = await read.execute({ targetWorkspaceId: ws, planId: "plan.alpha" as never });
    assert.equal(found.status, "success");
    const hidden = await read.execute({ targetWorkspaceId: ws, planId: "plan.beta" as never });
    assert.equal(hidden.status, "failure");
    const list = new ListAssetCompositionPlansUseCase({ repository: r });
    const listed = await list.execute({ targetWorkspaceId: ws, limit: 500 });
    assert.equal(listed.status, "success");
    if (listed.status === "success") assert.equal(listed.value.records.length, 1);
  });
  it("archives idempotently", async () => {
    const r = repo(); r.records.push(basePlan());
    const uc = new ArchiveAssetCompositionPlanUseCase({ repository: r, now: () => "2026-05-20T00:02:00.000Z" });
    const out = await uc.execute({ targetWorkspaceId: ws, planId: "plan.alpha" as never });
    assert.equal(out.status, "success");
    if (out.status === "success") assert.equal(out.value.status, "archived");
    const idem = await uc.execute({ targetWorkspaceId: ws, planId: "plan.alpha" as never });
    assert.equal(idem.status, "success");
  });
});
