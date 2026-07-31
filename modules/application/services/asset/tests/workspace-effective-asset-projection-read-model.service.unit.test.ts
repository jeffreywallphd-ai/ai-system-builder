import test from "node:test";
import assert from "node:assert/strict";

import type { EffectiveAssetProjectionRecord } from "../../../../contracts/effective-asset-projections";
import { WorkspaceEffectiveAssetProjectionReadModelService } from "../workspace-effective-asset-projection-read-model.service";

const workspaceA = "workspace.a" as any;
const workspaceB = "workspace.b" as any;

class FakeProjectionRepo {
  public records: EffectiveAssetProjectionRecord[] = [];
  async saveEffectiveAssetProjectionRecord() { throw new Error("not used"); }
  async updateEffectiveAssetProjectionRecord() { throw new Error("not used"); }
  async listBlockedConflictedOrStaleEffectiveAssetProjectionRecords() { return []; }
  async listEffectiveAssetProjectionRecords(query: any) {
    const rows = this.records.filter((r) => r.targetWorkspaceId === query.targetWorkspaceId);
    return { records: rows };
  }
  async readEffectiveAssetProjectionRecord(targetWorkspaceId: any, projectionId: any) {
    return this.records.find((r) => r.targetWorkspaceId === targetWorkspaceId && r.projectionId === projectionId);
  }
  async readEffectiveAssetProjectionRecordByEffectiveAssetReference(targetWorkspaceId: any, effectiveAssetReference: any) {
    return this.records.find((r) => r.targetWorkspaceId === targetWorkspaceId && r.effectiveAssetReference.kind === effectiveAssetReference.kind && r.effectiveAssetReference.id === effectiveAssetReference.id && (r.effectiveAssetReference.version ?? "") === (effectiveAssetReference.version ?? ""));
  }
}

test("lists workspace-only projection summaries with readiness/state mapping", async () => {
  const repo = new FakeProjectionRepo();
  repo.records = [
    record("p.ready", workspaceA, "ready"),
    record("p.draft", workspaceA, "draft-only"),
    record("p.blocked", workspaceA, "blocked", { blockers: [{ code: "effective-projection-source-missing", message: "blocked" } as any] }),
    record("p.conflicted", workspaceA, "conflicted", { diagnostics: [{ code: "effective-projection-conflict-detected", message: "conflict" } as any] }),
    record("p.disabled", workspaceA, "disabled"),
    record("p.source-missing", workspaceA, "source-missing", { diagnostics: [{ code: "effective-projection-source-missing", message: "missing" } as any] }),
    record("p.stale", workspaceA, "stale", { invalidatedAt: "2026-01-05T00:00:00.000Z" }),
    record("p.unsupported", workspaceA, "unsupported"),
    record("p.foreign", workspaceB, "ready"),
  ];
  const service = new WorkspaceEffectiveAssetProjectionReadModelService({ projectionRepository: repo as any });
  const result = await service.listByWorkspace({ targetWorkspaceId: workspaceA } as any);
  assert.equal(result.summaries.length, 8);
  assert.equal(result.summaries.find((s) => s.projectionId === "p.ready")?.isProjectionConsumable, true);
  assert.equal(result.summaries.find((s) => s.projectionId === "p.draft")?.isDraftPreviewOnly, true);
  assert.equal(result.summaries.find((s) => s.projectionId === "p.blocked")?.isProjectionConsumable, false);
  assert.equal(result.summaries.find((s) => s.projectionId === "p.conflicted")?.hasConflicts, true);
  assert.equal(result.summaries.find((s) => s.projectionId === "p.disabled")?.isDisabled, true);
  assert.equal(result.summaries.find((s) => s.projectionId === "p.source-missing")?.diagnostics[0]?.code, "effective-projection-source-missing");
  assert.equal(result.summaries.find((s) => s.projectionId === "p.stale")?.requiresRefresh, true);
  assert.equal(result.summaries.find((s) => s.projectionId === "p.unsupported")?.readinessLabel, "blocked-for-planning");
  assert.equal(result.summaries.find((s) => s.projectionId === "p.blocked")?.projectedFieldsApplied, false);
  assert.deepEqual(result.summaries.find((s) => s.projectionId === "p.blocked")?.projectedFields ?? {}, {});
});

test("readByProjectionId is workspace-scoped and not global", async () => {
  const repo = new FakeProjectionRepo();
  repo.records = [record("p.same", workspaceA, "ready"), record("p.same", workspaceB, "ready")];
  const service = new WorkspaceEffectiveAssetProjectionReadModelService({ projectionRepository: repo as any });
  const a = await service.readByProjectionId(workspaceA, "p.same");
  const b = await service.readByProjectionId(workspaceB, "p.same");
  const miss = await service.readByProjectionId(workspaceA, "p.none");
  assert.equal(a?.targetWorkspaceId, workspaceA);
  assert.equal(b?.targetWorkspaceId, workspaceB);
  assert.equal(miss, undefined);
});

test("readByEffectiveAssetReference matches kind+id+version and enforces workspace isolation", async () => {
  const repo = new FakeProjectionRepo();
  repo.records = [
    record("p.v1", workspaceA, "ready", { effectiveAssetReference: { kind: "asset-instance", id: "asset.1", version: "1.0.0" } as any }),
    record("p.v2", workspaceA, "ready", { effectiveAssetReference: { kind: "asset-instance", id: "asset.1", version: "2.0.0" } as any }),
    record("p.kind", workspaceA, "ready", { effectiveAssetReference: { kind: "asset-definition", id: "asset.1", version: "2.0.0" } as any }),
    record("p.foreign", workspaceB, "ready", { effectiveAssetReference: { kind: "asset-instance", id: "asset.1", version: "1.0.0" } as any }),
  ];
  const service = new WorkspaceEffectiveAssetProjectionReadModelService({ projectionRepository: repo as any });
  const v2 = await service.readByEffectiveAssetReference(workspaceA, { kind: "asset-instance", id: "asset.1", version: "2.0.0" } as any);
  const kind = await service.readByEffectiveAssetReference(workspaceA, { kind: "asset-definition", id: "asset.1", version: "2.0.0" } as any);
  const miss = await service.readByEffectiveAssetReference(workspaceA, { kind: "asset-instance", id: "asset.1", version: "3.0.0" } as any);
  const noLeak = await service.readByEffectiveAssetReference(workspaceA, { kind: "asset-instance", id: "asset.1", version: "1.0.0" } as any);
  assert.equal(v2?.projectionId, "p.v2");
  assert.equal(kind?.projectionId, "p.kind");
  assert.equal(miss, undefined);
  assert.equal(noLeak?.targetWorkspaceId, workspaceA);
});

test("sanitizes diagnostics/blockers/provenance metadata from summary surface", async () => {
  const repo = new FakeProjectionRepo();
  repo.records = [record("p.safe", workspaceA, "ready", {
    diagnostics: [{ code: "effective-projection-source-missing", message: "x", metadata: { unsafe: "secret" } } as any],
    blockers: [{ code: "effective-projection-source-missing", message: "y", metadata: { unsafe: "secret" } } as any],
    provenance: { kind: "projected-from-authored-asset-revision", targetWorkspaceId: workspaceA, operationAt: "2026-01-01T00:00:00.000Z", metadata: { unsafePath: "/tmp/raw" } } as any,
  })];
  const service = new WorkspaceEffectiveAssetProjectionReadModelService({ projectionRepository: repo as any });
  const result = await service.listByWorkspace({ targetWorkspaceId: workspaceA } as any);
  const summary = result.summaries[0]!;
  assert.equal("metadata" in (summary.diagnostics[0] as any), false);
  assert.equal("metadata" in (summary.blockers[0] as any), false);
  assert.equal("metadata" in (summary.provenance as any), false);
});

function record(id: string, workspaceId: any, status: any, overrides: Partial<EffectiveAssetProjectionRecord> = {}): EffectiveAssetProjectionRecord {
  return {
    projectionId: id as any,
    targetWorkspaceId: workspaceId,
    source: { sourceKind: "workspace-authored", targetWorkspaceId: workspaceId, authoredAssetId: "authored.1" } as any,
    target: { targetWorkspaceId: workspaceId, effectiveAssetReference: { kind: "asset-instance", id: `asset.${id}`, version: "1.0.0" }, intendedPolicy: "safe-fields-only" } as any,
    sourceKind: "workspace-authored",
    policy: "safe-fields-only",
    effectiveAssetReference: { kind: "asset-instance", id: `asset.${id}`, version: "1.0.0" } as any,
    projectedFields: { "display-name": "name", summary: "summary" },
    diagnostics: [],
    blockers: [],
    provenance: { kind: "projected-from-authored-asset-revision", targetWorkspaceId: workspaceId, sourceWorkspaceId: workspaceId, operationAt: "2026-01-01T00:00:00.000Z", metadata: { unsafePath: "removed" } } as any,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}
