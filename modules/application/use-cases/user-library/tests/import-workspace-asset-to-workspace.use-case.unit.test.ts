import test from "node:test";
import assert from "node:assert/strict";
import type { ImportWorkspaceAssetToWorkspaceCommand } from "../../../../contracts/user-library";
import type { WorkspaceAssetForUserLibraryDescriptor, WorkspaceAssetForUserLibraryReadPort, WorkspaceToWorkspaceImportRecord, WorkspaceToWorkspaceImportRepositoryPort } from "../../../../ports/user-library";
import { ImportWorkspaceAssetToWorkspaceUseCase } from "..";

class FakeReader implements WorkspaceAssetForUserLibraryReadPort { public descriptor?: WorkspaceAssetForUserLibraryDescriptor; public calls: unknown[] = []; async readWorkspaceAssetForUserLibrary(sourceWorkspaceId: string, sourceAssetReference: { kind: string; id: string }) { this.calls.push({ sourceWorkspaceId, sourceAssetReference }); return this.descriptor; } }
class FakeRepo implements WorkspaceToWorkspaceImportRepositoryPort { public existing?: WorkspaceToWorkspaceImportRecord; public saved: WorkspaceToWorkspaceImportRecord[] = []; async findWorkspaceToWorkspaceImportRecord() { return this.existing; } async saveWorkspaceToWorkspaceImportRecord(record: WorkspaceToWorkspaceImportRecord) { this.saved.push(record); return record; } async listWorkspaceToWorkspaceImportRecords() { return { records: this.existing ? [this.existing] : [] }; } }

const command: ImportWorkspaceAssetToWorkspaceCommand = { sourceWorkspaceId: "workspace.source", targetWorkspaceId: "workspace.target", sourceAssetReference: { kind: "asset-instance", id: "workspace.source.asset", version: "2.1.0" }, sourceAssetVersion: "2.1.0", metadata: { safe: true } };
const active = (): WorkspaceAssetForUserLibraryDescriptor => ({ sourceWorkspaceId: "workspace.source", assetReference: { kind: "asset-instance", id: "workspace.source.asset", version: "2.1.0" }, assetVersion: "2.1.0", ownershipScope: "workspace", status: "active", sourceKind: "workspace-local", metadata: { safe: true } });

test("imports workspace asset into target workspace as detached copy with provenance", async () => {
  const reader = new FakeReader(); reader.descriptor = active();
  const repo = new FakeRepo();
  const useCase = new ImportWorkspaceAssetToWorkspaceUseCase({ sourceAssetReader: reader, importRepository: repo, generateImportId: () => "import.1", generateImportedAssetId: () => "workspace.target.copy.1", now: () => "2026-05-18T12:00:00.000Z" });
  const result = await useCase.execute(command);
  assert.equal(result.ok, true); assert.equal(result.status, "imported"); assert.equal(repo.saved.length, 1);
  assert.equal(repo.saved[0].provenance.kind, "imported-from-workspace-asset");
  assert.equal(repo.saved[0].provenance.sourceWorkspaceId, command.sourceWorkspaceId);
  assert.equal(repo.saved[0].provenance.targetWorkspaceId, command.targetWorkspaceId);
  assert.equal(reader.calls.length, 1);
});

test("enforces validation/not-found/mismatch/rejected/inactive/unsafe/idempotent/conflict/id generation", async () => {
  const reader = new FakeReader(); const repo = new FakeRepo();
  const useCase = new ImportWorkspaceAssetToWorkspaceUseCase({ sourceAssetReader: reader, importRepository: repo, generateImportId: () => "import.1", generateImportedAssetId: () => "workspace.target.copy.1", now: () => "2026-05-18T12:00:00.000Z" });
  assert.equal((await useCase.execute({ ...command, sourceWorkspaceId: "" as never })).failure.code, "validation");
  assert.equal((await useCase.execute({ ...command, sourceWorkspaceId: command.targetWorkspaceId })).failure.code, "validation");
  reader.descriptor = undefined; assert.equal((await useCase.execute(command)).failure.code, "not-found");
  reader.descriptor = { ...active(), sourceWorkspaceId: "workspace.other" }; assert.equal((await useCase.execute(command)).failure.code, "conflict");
  reader.descriptor = { ...active(), ownershipScope: "system", sourceKind: "system-activated" }; assert.equal((await useCase.execute(command)).failure.code, "validation");
  reader.descriptor = { ...active(), status: "archived" }; assert.equal((await useCase.execute(command)).failure.code, "unavailable");
  reader.descriptor = { ...active(), metadata: { prompt: "unsafe" } }; assert.equal((await useCase.execute(command)).failure.code, "validation");
  reader.descriptor = active();
  repo.existing = { importId: "import.1", sourceWorkspaceId: command.sourceWorkspaceId, targetWorkspaceId: command.targetWorkspaceId, sourceAssetReference: command.sourceAssetReference, sourceAssetVersion: "2.1.0", importedAssetReference: { kind: "asset-instance", id: "workspace.target.copy.1", version: "2.1.0" }, relationshipStatus: "detached-workspace-owned-copy", status: "active", provenance: { kind: "imported-from-workspace-asset", operationAt: "2026-05-18T12:00:00.000Z" }, createdAt: "2026-05-18T12:00:00.000Z", updatedAt: "2026-05-18T12:00:00.000Z" };
  const existing = await useCase.execute(command); assert.equal(existing.ok, true); assert.equal(existing.status, "existing");
  repo.existing = { ...repo.existing, sourceAssetVersion: "9.9.9" }; assert.equal((await useCase.execute(command)).failure.code, "conflict");
  repo.existing = undefined;
  const badIdUseCase = new ImportWorkspaceAssetToWorkspaceUseCase({ sourceAssetReader: reader, importRepository: repo, generateImportId: () => "", generateImportedAssetId: () => "workspace.target.copy.1" });
  assert.equal((await badIdUseCase.execute(command)).failure.code, "validation");
});
