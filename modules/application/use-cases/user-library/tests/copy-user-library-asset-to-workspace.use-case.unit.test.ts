import test from "node:test";
import assert from "node:assert/strict";
import type { CopyUserLibraryAssetToWorkspaceCommand, UserLibraryAssetRecord } from "../../../../contracts/user-library";
import { CopyUserLibraryAssetToWorkspaceUseCase } from "..";
import type { UserLibraryAssetRepositoryPort, WorkspaceUserLibraryDetachedCopyRecord, WorkspaceUserLibraryDetachedCopyRepositoryPort } from "../../../../ports/user-library";

class FakeAssetRepo implements UserLibraryAssetRepositoryPort {
  public record?: UserLibraryAssetRecord;
  public reads = 0;
  async saveUserLibraryAssetRecord(record: UserLibraryAssetRecord): Promise<UserLibraryAssetRecord> { return record; }
  async updateUserLibraryAssetRecord(record: UserLibraryAssetRecord): Promise<UserLibraryAssetRecord> { return record; }
  async readUserLibraryAssetRecord(): Promise<UserLibraryAssetRecord | undefined> { this.reads += 1; return this.record; }
  async readUserLibraryAssetRecordById(): Promise<UserLibraryAssetRecord | undefined> { return this.record; }
  async listUserLibraryAssetRecords() { return { assets: [] }; }
  async findUserLibraryAssetRecordBySource(): Promise<UserLibraryAssetRecord | undefined> { return undefined; }
}
class FakeCopyRepo implements WorkspaceUserLibraryDetachedCopyRepositoryPort {
  public existing?: WorkspaceUserLibraryDetachedCopyRecord;
  public saved: WorkspaceUserLibraryDetachedCopyRecord[] = [];
  async saveWorkspaceUserLibraryDetachedCopyRecord(record: WorkspaceUserLibraryDetachedCopyRecord) { this.saved.push(record); return record; }
  async findWorkspaceUserLibraryDetachedCopyRecord() { return this.existing; }
  async listWorkspaceUserLibraryDetachedCopyRecords() { return { records: this.existing ? [this.existing] : [] }; }
}
const baseCommand: CopyUserLibraryAssetToWorkspaceCommand = {
  targetWorkspaceId: "workspace.target",
  userLibraryAssetReference: { assetId: "library.asset", version: "1.0.0" },
  selectedVersion: "1.0.0",
  metadata: { safe: true },
};
function activeRecord(): UserLibraryAssetRecord { return { userLibraryAssetId: "library.asset", version: "1.0.0", displayName: "Name", status: "active", sourceAssetReference: { kind: "asset-instance", id: "workspace.source.instance" }, sourceWorkspaceId: "workspace.source", sourceAssetVersion: "2.0.0", assetReference: { kind: "asset-instance", id: "workspace.source.instance", version: "2.0.0" }, provenance: { kind: "promoted-from-workspace-asset", operationAt: "2026-05-18T00:00:00.000Z" }, createdAt: "2026-05-18T00:00:00.000Z", updatedAt: "2026-05-18T00:00:00.000Z" }; }

test("copies active user-library asset as detached workspace-owned copy", async () => {
  const assets = new FakeAssetRepo(); assets.record = activeRecord();
  const copies = new FakeCopyRepo();
  const result = await new CopyUserLibraryAssetToWorkspaceUseCase({ userLibraryAssetRepository: assets, detachedCopyRepository: copies, generateDetachedCopyId: () => "copy.1", generateCopiedAssetId: () => "workspace.target.copy.1", now: () => "2026-05-18T12:00:00.000Z" }).execute(baseCommand);
  assert.equal(result.ok, true);
  assert.equal(result.status, "copied");
  assert.equal(result.payload.relationshipStatus, "detached-workspace-owned-copy");
  assert.equal(copies.saved.length, 1);
  assert.equal(copies.saved[0].provenance.kind, "copied-from-user-library-asset");
  assert.equal(copies.saved[0].provenance.sourceKind, "user-library-copied");
  assert.equal(assets.reads, 1);
});

test("returns validation/not-found/unavailable/version failures and idempotency/conflict behavior", async () => {
  const assets = new FakeAssetRepo(); const copies = new FakeCopyRepo();
  const useCase = new CopyUserLibraryAssetToWorkspaceUseCase({ userLibraryAssetRepository: assets, detachedCopyRepository: copies, generateDetachedCopyId: () => "copy.1", generateCopiedAssetId: () => "workspace.target.copy.1", now: () => "2026-05-18T12:00:00.000Z" });
  assert.equal((await useCase.execute({ ...baseCommand, targetWorkspaceId: "" as never })).ok, false);
  assets.record = undefined; assert.equal((await useCase.execute(baseCommand)).failure.code, "not-found");
  assets.record = { ...activeRecord(), status: "archived" }; assert.equal((await useCase.execute(baseCommand)).failure.code, "unavailable");
  assets.record = activeRecord(); assert.equal((await useCase.execute({ ...baseCommand, selectedVersion: "2.0.0" })).failure.code, "validation");
  assert.equal((await useCase.execute({ ...baseCommand, metadata: { prompt: "x" } })).failure.code, "validation");
  copies.existing = { copyId: "copy.1", targetWorkspaceId: "workspace.target", copiedAssetReference: { kind: "asset-instance", id: "workspace.target.copy.1", version: "1.0.0" }, sourceUserLibraryAssetReference: { assetId: "library.asset", version: "1.0.0" }, selectedVersion: "1.0.0", relationshipStatus: "detached-workspace-owned-copy", status: "active", provenance: { kind: "copied-from-user-library-asset", operationAt: "2026-05-18T12:00:00.000Z" }, createdAt: "2026-05-18T12:00:00.000Z", updatedAt: "2026-05-18T12:00:00.000Z" };
  const existing = await useCase.execute(baseCommand); assert.equal(existing.ok, true); assert.equal(existing.status, "existing");
  copies.existing = { ...copies.existing, sourceUserLibraryAssetReference: { assetId: "other.asset", version: "1.0.0" } };
  assert.equal((await useCase.execute(baseCommand)).failure.code, "conflict");
});
