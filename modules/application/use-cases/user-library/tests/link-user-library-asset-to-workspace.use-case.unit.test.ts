import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  createUserLibraryAssetId,
  createUserLibraryLinkId,
  type UserLibraryAssetRecord,
  type WorkspaceUserLibraryLinkRecord,
} from "../../../../contracts/user-library";
import type {
  UserLibraryAssetRepositoryPort,
  WorkspaceUserLibraryLinkRepositoryPort,
} from "../../../../ports/user-library";
import { LinkUserLibraryAssetToWorkspaceUseCase } from "../link-user-library-asset-to-workspace.use-case";

const workspaceId = createWorkspaceId("workspace.target");
const ref = { assetId: createUserLibraryAssetId("library.asset.alpha"), version: "1.0.0" as never, label: "Alpha" };

function asset(status: UserLibraryAssetRecord["status"] = "active"): UserLibraryAssetRecord {
  return {
    userLibraryAssetId: ref.assetId,
    version: "1.0.0" as never,
    displayName: "Alpha",
    status,
    sourceAssetReference: { kind: "asset-instance", id: "asset.alpha", version: "1.0.0" },
    sourceWorkspaceId: workspaceId,
    sourceAssetVersion: "1.0.0",
    assetReference: { kind: "asset-instance", id: "asset.alpha", version: "1.0.0" },
    provenance: { kind: "promoted-from-workspace-asset", sourceKind: "workspace-local", sourceWorkspaceId: workspaceId, sourceAssetReference: { kind: "asset-instance", id: "asset.alpha", version: "1.0.0" }, operationAt: "2026-05-18T01:00:00.000Z" },
    createdAt: "2026-05-18T01:00:00.000Z",
    updatedAt: "2026-05-18T01:00:00.000Z",
  };
}

function makeLink(overrides: Partial<WorkspaceUserLibraryLinkRecord> = {}): WorkspaceUserLibraryLinkRecord {
  return {
    linkId: createUserLibraryLinkId("link.alpha"),
    targetWorkspaceId: workspaceId,
    userLibraryAssetReference: ref,
    versionSelection: { kind: "pinned-version", version: "1.0.0" },
    propagationPolicy: "pinned-version",
    displayLabel: "Alpha link",
    status: "active",
    createdAt: "2026-05-18T01:00:00.000Z",
    updatedAt: "2026-05-18T01:00:00.000Z",
    provenance: { kind: "linked-from-user-library-asset", sourceKind: "user-library-linked", targetWorkspaceId: workspaceId, sourceUserLibraryAssetReference: ref, operationAt: "2026-05-18T01:00:00.000Z" },
    ...overrides,
  };
}

describe("LinkUserLibraryAssetToWorkspaceUseCase", () => {
  it("links active user-library asset and preserves sanitized provenance", async () => {
    let readCount = 0;
    let saved: WorkspaceUserLibraryLinkRecord | undefined;
    const userLibraryAssetRepository: UserLibraryAssetRepositoryPort = {
      async readUserLibraryAssetRecord(){ readCount += 1; return asset(); },
      async saveUserLibraryAssetRecord(r){ return r; }, async updateUserLibraryAssetRecord(r){ return r; }, async readUserLibraryAssetRecordById(){ return undefined; }, async listUserLibraryAssetRecords(){ return { assets: [] }; }, async findUserLibraryAssetRecordBySource(){ return undefined; },
    };
    const workspaceLinkRepository: WorkspaceUserLibraryLinkRepositoryPort = {
      async saveWorkspaceUserLibraryLinkRecord(r){ saved = r; return r; }, async updateWorkspaceUserLibraryLinkRecord(r){ return r; }, async readWorkspaceUserLibraryLinkRecord(){ return undefined; }, async listWorkspaceUserLibraryLinkRecords(){ return { links: [] }; }, async listWorkspaceUserLibraryLinkRecordsByAsset(){ return { links: [] }; }, async findWorkspaceUserLibraryLinkRecord(){ return undefined; },
    };
    const useCase = new LinkUserLibraryAssetToWorkspaceUseCase({ userLibraryAssetRepository, workspaceLinkRepository, now: () => "2026-05-18T03:00:00.000Z", generateUserLibraryLinkId: () => "link.generated.alpha" });
    const result = await useCase.execute({ targetWorkspaceId: workspaceId, userLibraryAssetReference: ref, versionSelection: { kind: "pinned-version", version: "1.0.0" }, propagationPolicy: "pinned-version", displayLabel: "Alpha link", metadata: { safe: true } });
    assert.equal(result.ok, true);
    assert.equal(result.status, "linked");
    assert.equal(readCount, 1);
    assert.equal(saved?.linkId, "link.generated.alpha");
    assert.equal(saved?.targetWorkspaceId, workspaceId);
  });

  it("returns validation/not-found/unavailable for invalid or missing asset states", async () => {
    const mk = (assetRecord?: UserLibraryAssetRecord) => new LinkUserLibraryAssetToWorkspaceUseCase({
      userLibraryAssetRepository: { async readUserLibraryAssetRecord(){ return assetRecord; }, async saveUserLibraryAssetRecord(r){ return r; }, async updateUserLibraryAssetRecord(r){ return r; }, async readUserLibraryAssetRecordById(){ return undefined; }, async listUserLibraryAssetRecords(){ return { assets: [] }; }, async findUserLibraryAssetRecordBySource(){ return undefined; } },
      workspaceLinkRepository: { async saveWorkspaceUserLibraryLinkRecord(r){ return r; }, async updateWorkspaceUserLibraryLinkRecord(r){ return r; }, async readWorkspaceUserLibraryLinkRecord(){ return undefined; }, async listWorkspaceUserLibraryLinkRecords(){ return { links: [] }; }, async listWorkspaceUserLibraryLinkRecordsByAsset(){ return { links: [] }; }, async findWorkspaceUserLibraryLinkRecord(){ return undefined; } },
      generateUserLibraryLinkId: () => "link.generated.alpha",
    });
    const invalidWorkspace = await mk(asset()).execute({ targetWorkspaceId: "" as never, userLibraryAssetReference: ref, versionSelection: { kind: "pinned-version", version: "1.0.0" }, propagationPolicy: "pinned-version" });
    assert.equal(invalidWorkspace.ok, false);
    const missing = await mk(undefined).execute({ targetWorkspaceId: workspaceId, userLibraryAssetReference: ref, versionSelection: { kind: "pinned-version", version: "1.0.0" }, propagationPolicy: "pinned-version" });
    assert.equal(missing.ok, false);
    assert.equal(missing.failure.code, "not-found");
    const archived = await mk(asset("archived")).execute({ targetWorkspaceId: workspaceId, userLibraryAssetReference: ref, versionSelection: { kind: "pinned-version", version: "1.0.0" }, propagationPolicy: "pinned-version" });
    assert.equal(archived.ok, false);
    assert.equal(archived.failure.code, "unavailable");
  });

  it("enforces policy/version consistency and pinned-safe version", async () => {
    const useCase = new LinkUserLibraryAssetToWorkspaceUseCase({
      userLibraryAssetRepository: { async readUserLibraryAssetRecord(){ return asset(); }, async saveUserLibraryAssetRecord(r){ return r; }, async updateUserLibraryAssetRecord(r){ return r; }, async readUserLibraryAssetRecordById(){ return undefined; }, async listUserLibraryAssetRecords(){ return { assets: [] }; }, async findUserLibraryAssetRecordBySource(){ return undefined; } },
      workspaceLinkRepository: { async saveWorkspaceUserLibraryLinkRecord(r){ return r; }, async updateWorkspaceUserLibraryLinkRecord(r){ return r; }, async readWorkspaceUserLibraryLinkRecord(){ return undefined; }, async listWorkspaceUserLibraryLinkRecords(){ return { links: [] }; }, async listWorkspaceUserLibraryLinkRecordsByAsset(){ return { links: [] }; }, async findWorkspaceUserLibraryLinkRecord(){ return undefined; } },
      generateUserLibraryLinkId: () => "link.generated.alpha",
    });
    const mismatch = await useCase.execute({ targetWorkspaceId: workspaceId, userLibraryAssetReference: ref, versionSelection: { kind: "pinned-version", version: "1.0.0" }, propagationPolicy: "explicit-update" });
    assert.equal(mismatch.ok, false);
    const wrongPinned = await useCase.execute({ targetWorkspaceId: workspaceId, userLibraryAssetReference: ref, versionSelection: { kind: "pinned-version", version: "2.0.0" }, propagationPolicy: "pinned-version" });
    assert.equal(wrongPinned.ok, false);
    assert.equal(wrongPinned.failure.code, "validation");
  });

  it("handles idempotent equivalent existing and conflicting existing/disabled links safely", async () => {
    const equivalent = makeLink();
    const useCaseExisting = new LinkUserLibraryAssetToWorkspaceUseCase({
      userLibraryAssetRepository: { async readUserLibraryAssetRecord(){ return asset(); }, async saveUserLibraryAssetRecord(r){ return r; }, async updateUserLibraryAssetRecord(r){ return r; }, async readUserLibraryAssetRecordById(){ return undefined; }, async listUserLibraryAssetRecords(){ return { assets: [] }; }, async findUserLibraryAssetRecordBySource(){ return undefined; } },
      workspaceLinkRepository: { async saveWorkspaceUserLibraryLinkRecord(r){ return r; }, async updateWorkspaceUserLibraryLinkRecord(r){ return r; }, async readWorkspaceUserLibraryLinkRecord(){ return undefined; }, async listWorkspaceUserLibraryLinkRecords(){ return { links: [] }; }, async listWorkspaceUserLibraryLinkRecordsByAsset(){ return { links: [] }; }, async findWorkspaceUserLibraryLinkRecord(){ return equivalent; } },
      generateUserLibraryLinkId: () => "link.generated.alpha",
    });
    const idempotent = await useCaseExisting.execute({ targetWorkspaceId: workspaceId, userLibraryAssetReference: ref, versionSelection: { kind: "pinned-version", version: "1.0.0" }, propagationPolicy: "pinned-version", displayLabel: "Alpha link" });
    assert.equal(idempotent.ok, true);
    assert.equal(idempotent.status, "existing");

    const conflict = await useCaseExisting.execute({ targetWorkspaceId: workspaceId, userLibraryAssetReference: ref, versionSelection: { kind: "explicit-update", version: "1.0.0" }, propagationPolicy: "explicit-update", displayLabel: "Different" });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.failure.code, "conflict");

    const useCaseDisabled = new LinkUserLibraryAssetToWorkspaceUseCase({
      userLibraryAssetRepository: { async readUserLibraryAssetRecord(){ return asset(); }, async saveUserLibraryAssetRecord(r){ return r; }, async updateUserLibraryAssetRecord(r){ return r; }, async readUserLibraryAssetRecordById(){ return undefined; }, async listUserLibraryAssetRecords(){ return { assets: [] }; }, async findUserLibraryAssetRecordBySource(){ return undefined; } },
      workspaceLinkRepository: { async saveWorkspaceUserLibraryLinkRecord(r){ return r; }, async updateWorkspaceUserLibraryLinkRecord(r){ return r; }, async readWorkspaceUserLibraryLinkRecord(){ return undefined; }, async listWorkspaceUserLibraryLinkRecords(){ return { links: [] }; }, async listWorkspaceUserLibraryLinkRecordsByAsset(){ return { links: [] }; }, async findWorkspaceUserLibraryLinkRecord(){ return makeLink({ status: "archived" }); } },
      generateUserLibraryLinkId: () => "link.generated.alpha",
    });
    const disabled = await useCaseDisabled.execute({ targetWorkspaceId: workspaceId, userLibraryAssetReference: ref, versionSelection: { kind: "pinned-version", version: "1.0.0" }, propagationPolicy: "pinned-version", displayLabel: "Alpha link" });
    assert.equal(disabled.ok, false);
    assert.equal(disabled.failure.code, "conflict");
  });
});
