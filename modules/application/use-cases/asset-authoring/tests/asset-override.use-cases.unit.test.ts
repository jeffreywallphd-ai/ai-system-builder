import test from "node:test";
import assert from "node:assert/strict";
import type { AssetOverrideRecord } from "../../../../contracts/asset-authoring";
import { DisableAssetOverrideUseCase, CreateAssetOverrideUseCase, UpdateAssetOverrideUseCase } from "..";

const ws = "workspace.alpha" as any;
const target = (sourceKind: any = "workspace-local-asset") => ({ targetWorkspaceId: ws, sourceKind, effectiveAssetReference: { kind: "asset-instance", id: "asset.1", version: "1.0.0" } });

const repo = () => {
  const state: { saved: AssetOverrideRecord[]; updated: AssetOverrideRecord[]; active?: AssetOverrideRecord; read?: AssetOverrideRecord } = { saved: [], updated: [] };
  return {
    state,
    port: {
      async saveAssetOverrideRecord(r: AssetOverrideRecord){ state.saved.push(r); return r; },
      async updateAssetOverrideRecord(r: AssetOverrideRecord){ state.updated.push(r); state.read = r; return r; },
      async readAssetOverrideRecord(_workspaceId: string, overrideId: string){ return state.read?.overrideId === overrideId ? state.read : undefined; },
      async listAssetOverrideRecords(){ return { records: [] }; },
      async findActiveOverrideForTarget(){ return state.active; },
      async listConflictedOverridesByWorkspace(){ return []; },
    }
  };
};

test("create override supports target kinds and persists with provenance", async () => {
  const kinds = ["workspace-local-asset","user-library-linked-asset","user-library-copied-asset","workspace-imported-asset","system-owned-asset","authored-asset"] as const;
  for (const kind of kinds) {
    const r = repo();
    const uc = new CreateAssetOverrideUseCase({ assetOverrideRepository: r.port as any, targetReader: { async readCustomizationTargetByReference(){ return { ...target(kind), status: "active", sourceWorkspaceId: kind === "workspace-imported-asset" ? ("workspace.src" as any) : undefined }; } }, generateAssetOverrideId: () => "override.1", now: () => "2026-05-19T00:00:00.000Z" });
    const result = await uc.execute({ targetWorkspaceId: ws, target: target(kind), overrideValues: { summary: "custom" } } as any);
    assert.equal(result.kind, "success");
    assert.equal(r.state.saved.length, 1);
    assert.equal(r.state.saved[0].provenance.targetWorkspaceId, ws);
  }
});

test("create override validates workspace/target/unsafe/duplicate/id generation", async () => {
  const r = repo();
  r.state.active = { overrideId: "override.1", targetWorkspaceId: ws, customizationTarget: target(), baseAssetReference: target().effectiveAssetReference, overrideScope: "workspace-local", overrideValues: { summary: "x" }, status: "active", provenance: { kind: "derived-from-workspace-local-asset", operationAt: "2026-05-19T00:00:00.000Z" }, createdAt: "2026-05-19T00:00:00.000Z", updatedAt: "2026-05-19T00:00:00.000Z" } as any;
  const uc = new CreateAssetOverrideUseCase({ assetOverrideRepository: r.port as any, targetReader: { async readCustomizationTargetByReference(){ return { ...target(), status: "active" }; } }, generateAssetOverrideId: () => " ", now: () => "2026-05-19T00:00:00.000Z" });
  assert.equal((await uc.execute({ targetWorkspaceId: "workspace.other" as any, target: target(), overrideValues: { summary: "x" } as any })).kind, "failure");
  assert.equal((await uc.execute({ targetWorkspaceId: ws, target: { ...target(), sourceKind: "customized-asset" }, overrideValues: { summary: "x" } as any }) as any).failure.code, "unsupported");
  assert.equal((await uc.execute({ targetWorkspaceId: ws, target: target(), overrideValues: { summary: "x" } as any }) as any).failure.code, "conflict");
  const unsafe = await uc.execute({ targetWorkspaceId: ws, target: target(), overrideValues: { "safe-metadata": { nested: { path: "/tmp" } } as any } } as any);
  assert.equal((unsafe as any).failure.code, "validation");
});
test("create override returns unavailable when target reader unavailable", async () => {
  const r = repo();
  const uc = new CreateAssetOverrideUseCase({ assetOverrideRepository: r.port as any, targetReader: { async readCustomizationTargetByReference(){ throw new Error("offline"); } }, generateAssetOverrideId: () => "override.2", now: () => "2026-05-19T00:00:00.000Z" });
  const result = await uc.execute({ targetWorkspaceId: ws, target: target(), overrideValues: { summary: "custom" } } as any);
  assert.equal(result.kind, "failure");
  assert.equal((result as any).failure.code, "unavailable");
});

test("update override preserves protected fields and updates timestamp", async () => {
  const r = repo();
  r.state.read = { overrideId: "override.1", targetWorkspaceId: ws, customizationTarget: target(), baseAssetReference: target().effectiveAssetReference, overrideScope: "workspace-local", overrideValues: { summary: "before" }, status: "active", provenance: { kind: "derived-from-workspace-local-asset", operationAt: "2026-05-19T00:00:00.000Z" }, createdAt: "2026-05-19T00:00:00.000Z", updatedAt: "2026-05-19T00:00:00.000Z" } as any;
  const uc = new UpdateAssetOverrideUseCase({ assetOverrideRepository: r.port as any, now: () => "2026-05-19T01:00:00.000Z" });
  const ok = await uc.execute({ targetWorkspaceId: ws, overrideId: "override.1", overrideValues: { summary: "after" } } as any);
  assert.equal(ok.kind, "success");
  assert.equal(r.state.updated[0].customizationTarget.targetWorkspaceId, ws);
  assert.equal(r.state.updated[0].updatedAt, "2026-05-19T01:00:00.000Z");
  assert.equal(((await uc.execute({ targetWorkspaceId: ws, overrideId: "missing", overrideValues: { summary: "x" } } as any)) as any).failure.code, "not-found");
});

test("disable override sets disabled and preserves immutability boundaries", async () => {
  const r = repo();
  r.state.read = { overrideId: "override.1", targetWorkspaceId: ws, customizationTarget: target("system-owned-asset"), baseAssetReference: target().effectiveAssetReference, overrideScope: "system-derived", overrideValues: { summary: "before" }, status: "active", provenance: { kind: "system-derived-override", targetWorkspaceId: ws, operationAt: "2026-05-19T00:00:00.000Z" }, createdAt: "2026-05-19T00:00:00.000Z", updatedAt: "2026-05-19T00:00:00.000Z" } as any;
  const uc = new DisableAssetOverrideUseCase({ assetOverrideRepository: r.port as any, now: () => "2026-05-19T02:00:00.000Z" });
  const ok = await uc.execute({ targetWorkspaceId: ws, overrideId: "override.1" } as any);
  assert.equal(ok.kind, "success");
  assert.equal(r.state.updated[0].status, "disabled");
  assert.equal(r.state.updated[0].updatedAt, "2026-05-19T02:00:00.000Z");
});
