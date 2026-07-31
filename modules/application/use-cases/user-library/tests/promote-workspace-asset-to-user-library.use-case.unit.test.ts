import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeAssetId, type AssetReference } from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createUserLibraryAssetId, type UserLibraryAssetRecord } from "../../../../contracts/user-library";
import type { UserLibraryAssetRepositoryPort, WorkspaceAssetForUserLibraryDescriptor } from "../../../../ports/user-library";
import { PromoteWorkspaceAssetToUserLibraryUseCase } from "../promote-workspace-asset-to-user-library.use-case";

const workspaceId = createWorkspaceId("workspace.alpha");
const assetRef: AssetReference = { kind: "asset-instance", id: normalizeAssetId("asset.alpha"), version: "1.0.0" };

function source(overrides: Partial<WorkspaceAssetForUserLibraryDescriptor> = {}): WorkspaceAssetForUserLibraryDescriptor {
  return { sourceWorkspaceId: workspaceId, assetReference: assetRef, assetVersion: "1.0.0", displayName: "Alpha", ownershipScope: "workspace", status: "active", sourceKind: "workspace-local", metadata: { safe: "yes" }, ...overrides };
}

function createRepo(existing?: UserLibraryAssetRecord): UserLibraryAssetRepositoryPort {
  return {
    async saveUserLibraryAssetRecord(record) { return record; }, async updateUserLibraryAssetRecord(r){return r;}, async readUserLibraryAssetRecord(){return undefined;},
    async readUserLibraryAssetRecordById(){return undefined;}, async listUserLibraryAssetRecords(){return { assets: [] };},
    async findUserLibraryAssetRecordBySource(){ return existing; },
  };
}

describe("PromoteWorkspaceAssetToUserLibraryUseCase", () => {
  it("promotes a valid workspace-local asset", async () => {
    let readCalled = false;
    const useCase = new PromoteWorkspaceAssetToUserLibraryUseCase({
      sourceAssetReader: { async readWorkspaceAssetForUserLibrary(){ readCalled = true; return source(); } },
      repository: createRepo(),
      now: () => "2026-05-18T01:00:00.000Z",
      generateUserLibraryAssetId: () => "library.promoted.alpha",
    });
    const result = await useCase.execute({ sourceWorkspaceId: workspaceId, sourceAssetReference: assetRef, originWorkspaceBehavior: "keep-independent-workspace-copy" });
    assert.equal(result.ok, true);
    assert.equal(result.status, "created");
    assert.equal(readCalled, true);
    assert.equal(result.payload.userLibraryAssetReference.assetId, "library.promoted.alpha");
  });

  it("rejects missing source workspace id", async () => {
    const useCase = new PromoteWorkspaceAssetToUserLibraryUseCase({ sourceAssetReader: { async readWorkspaceAssetForUserLibrary(){ return source(); } }, repository: createRepo(), generateUserLibraryAssetId: () => "library.id" });
    const result = await useCase.execute({ sourceWorkspaceId: "" as never, sourceAssetReference: assetRef, originWorkspaceBehavior: "keep-independent-workspace-copy" });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, "validation");
  });

  it("returns not-found when source is unavailable", async () => {
    const useCase = new PromoteWorkspaceAssetToUserLibraryUseCase({ sourceAssetReader: { async readWorkspaceAssetForUserLibrary(){ return undefined; } }, repository: createRepo(), generateUserLibraryAssetId: () => "library.id" });
    const result = await useCase.execute({ sourceWorkspaceId: workspaceId, sourceAssetReference: assetRef, originWorkspaceBehavior: "keep-independent-workspace-copy" });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, "not-found");
  });

  it("rejects workspace mismatch and system-owned/deleting assets and link-replace behavior", async () => {
    const base = { repository: createRepo(), generateUserLibraryAssetId: () => "library.id" };
    const mismatch = await new PromoteWorkspaceAssetToUserLibraryUseCase({ ...base, sourceAssetReader: { async readWorkspaceAssetForUserLibrary(){ return source({ sourceWorkspaceId: createWorkspaceId("workspace.other") }); } } }).execute({ sourceWorkspaceId: workspaceId, sourceAssetReference: assetRef, originWorkspaceBehavior: "keep-independent-workspace-copy" });
    assert.equal(mismatch.ok, false);
    const system = await new PromoteWorkspaceAssetToUserLibraryUseCase({ ...base, sourceAssetReader: { async readWorkspaceAssetForUserLibrary(){ return source({ ownershipScope: "system", sourceKind: "system-activated" }); } } }).execute({ sourceWorkspaceId: workspaceId, sourceAssetReference: assetRef, originWorkspaceBehavior: "keep-independent-workspace-copy" });
    assert.equal(system.ok, false);
    const deleting = await new PromoteWorkspaceAssetToUserLibraryUseCase({ ...base, sourceAssetReader: { async readWorkspaceAssetForUserLibrary(){ return source({ status: "deleting" }); } } }).execute({ sourceWorkspaceId: workspaceId, sourceAssetReference: assetRef, originWorkspaceBehavior: "keep-independent-workspace-copy" });
    assert.equal(deleting.ok, false);
    const replace = await new PromoteWorkspaceAssetToUserLibraryUseCase({ ...base, sourceAssetReader: { async readWorkspaceAssetForUserLibrary(){ return source(); } } }).execute({ sourceWorkspaceId: workspaceId, sourceAssetReference: assetRef, originWorkspaceBehavior: "replace-with-user-library-link" });
    assert.equal(replace.ok, false);
  });

  it("returns existing idempotent or conflict for duplicate source identity", async () => {
    const existing: UserLibraryAssetRecord = { userLibraryAssetId: createUserLibraryAssetId("library.asset.alpha"), version: "1.0.0" as never, displayName: "Alpha", status: "active", sourceAssetReference: assetRef, sourceWorkspaceId: workspaceId, sourceAssetVersion: "1.0.0", assetReference: assetRef, provenance: { kind: "promoted-from-workspace-asset", sourceKind: "workspace-local", sourceWorkspaceId: workspaceId, sourceAssetReference: assetRef, sourceAssetVersion: "1.0.0", operationAt: "2026-05-18T01:00:00.000Z" }, createdAt: "2026-05-18T01:00:00.000Z", updatedAt: "2026-05-18T01:00:00.000Z" };
    const useCase = new PromoteWorkspaceAssetToUserLibraryUseCase({ sourceAssetReader: { async readWorkspaceAssetForUserLibrary(){ return source(); } }, repository: createRepo(existing), generateUserLibraryAssetId: () => "library.id" });
    const idempotent = await useCase.execute({ sourceWorkspaceId: workspaceId, sourceAssetReference: assetRef, originWorkspaceBehavior: "no-immediate-workspace-change" });
    assert.equal(idempotent.ok, true);
    assert.equal(idempotent.status, "existing");
    const conflict = await useCase.execute({ sourceWorkspaceId: workspaceId, sourceAssetReference: assetRef, originWorkspaceBehavior: "keep-independent-workspace-copy", requestedUserLibraryAssetId: createUserLibraryAssetId("library.other") });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.failure.code, "conflict");
  });
});
