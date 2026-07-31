import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { normalizeAssetId, type AssetReference } from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  createUserLibraryAssetId,
  createUserLibraryAssetVersion,
  createUserLibraryLinkId,
  type UserLibraryAssetRecord,
  type WorkspaceUserLibraryLinkRecord,
} from "../../../../contracts/user-library";
import {
  LocalUserLibraryRecordStore,
  LocalUserLibraryRecordStoreError,
  USER_LIBRARY_LOCAL_SCHEMA_VERSION,
  USER_LIBRARY_LOCAL_STORE_KIND,
  createLocalUserLibraryAssetRepositoryAdapter,
  createLocalWorkspaceUserLibraryLinkRepositoryAdapter,
} from "..";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "user-library-store-"));
}

function fixedNow(): string {
  return "2026-05-18T00:00:00.000Z";
}

const workspaceA = createWorkspaceId("workspace.a");
const workspaceB = createWorkspaceId("workspace.b");

function assetRef(id: string, version = "1.0.0"): AssetReference {
  return { kind: "asset-definition-version", id: normalizeAssetId(id), version, label: id };
}

function userLibraryAssetRecord(overrides: Partial<UserLibraryAssetRecord> = {}): UserLibraryAssetRecord {
  const sourceAssetReference = assetRef("workspace.asset.alpha", "1.0.0");
  return {
    userLibraryAssetId: createUserLibraryAssetId("library.asset.alpha"),
    version: createUserLibraryAssetVersion("1.0.0"),
    displayName: "Alpha Asset",
    summary: "Reusable alpha asset",
    status: "active",
    sourceAssetReference,
    sourceWorkspaceId: workspaceA,
    sourceAssetVersion: "1.0.0",
    assetReference: { kind: "asset-definition-version", id: normalizeAssetId("library.asset.alpha"), version: "1.0.0", label: "Alpha Asset" },
    provenance: {
      kind: "promoted-from-workspace-asset",
      sourceKind: "workspace-local",
      sourceWorkspaceId: workspaceA,
      sourceAssetReference,
      sourceAssetVersion: "1.0.0",
      operationAt: "2026-05-18T00:00:00.000Z",
      metadata: { relationship: "promotion" },
    },
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    metadata: { safe: "metadata" },
    ...overrides,
  };
}

function linkRecord(overrides: Partial<WorkspaceUserLibraryLinkRecord> = {}): WorkspaceUserLibraryLinkRecord {
  return {
    linkId: createUserLibraryLinkId("link.alpha"),
    targetWorkspaceId: workspaceA,
    userLibraryAssetReference: {
      assetId: createUserLibraryAssetId("library.asset.alpha"),
      version: createUserLibraryAssetVersion("1.0.0"),
      label: "Alpha Asset",
    },
    versionSelection: { kind: "pinned-version", version: "1.0.0" },
    propagationPolicy: "pinned-version",
    displayLabel: "Alpha Link",
    status: "active",
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
    provenance: {
      kind: "linked-from-user-library-asset",
      sourceKind: "user-library-linked",
      targetWorkspaceId: workspaceA,
      sourceUserLibraryAssetReference: {
        assetId: createUserLibraryAssetId("library.asset.alpha"),
        version: createUserLibraryAssetVersion("1.0.0"),
      },
      operationAt: "2026-05-18T00:00:00.000Z",
      metadata: { relationship: "link" },
    },
    metadata: { safe: "link-metadata" },
    ...overrides,
  };
}

describe("local user-library record store", () => {
  it("creates a namespaced store and schema-versioned manifest", async () => {
    const rootDir = await tempRoot();
    await new LocalUserLibraryRecordStore({ rootDir, now: fixedNow }).initialize();

    const storeDir = join(rootDir, "user-library");
    assert.equal(existsSync(join(storeDir, "user-library-manifest.json")), true);
    assert.equal(existsSync(join(storeDir, "user-library-assets.json")), true);
    assert.equal(existsSync(join(storeDir, "workspace-user-library-links.json")), true);
    const manifest = JSON.parse(await readFile(join(storeDir, "user-library-manifest.json"), "utf8")) as unknown;
    assert.deepEqual(manifest, {
      schemaVersion: USER_LIBRARY_LOCAL_SCHEMA_VERSION,
      storeKind: USER_LIBRARY_LOCAL_STORE_KIND,
      updatedAt: fixedNow(),
    });
  });

  it("fails safely when the manifest kind or schema version is unsupported", async () => {
    const rootDir = await tempRoot();
    await new LocalUserLibraryRecordStore({ rootDir, now: fixedNow }).initialize();
    await writeFile(join(rootDir, "user-library", "user-library-manifest.json"), JSON.stringify({
      schemaVersion: 999,
      storeKind: USER_LIBRARY_LOCAL_STORE_KIND,
      updatedAt: fixedNow(),
    }), "utf8");

    await assert.rejects(
      () => new LocalUserLibraryRecordStore({ rootDir, now: fixedNow }).initialize(),
      LocalUserLibraryRecordStoreError,
    );
  });
});

describe("local user-library asset repository adapter", () => {
  it("saves, reads, lists, filters, and finds user-library asset records deterministically", async () => {
    const rootDir = await tempRoot();
    const repository = createLocalUserLibraryAssetRepositoryAdapter({ rootDir, now: fixedNow });
    const alpha = userLibraryAssetRecord();
    const beta = userLibraryAssetRecord({
      userLibraryAssetId: createUserLibraryAssetId("library.asset.beta"),
      displayName: "Beta Asset",
      sourceAssetReference: assetRef("workspace.asset.beta", "1.0.0"),
      sourceWorkspaceId: workspaceB,
      sourceAssetVersion: "1.0.0",
      updatedAt: "2026-05-18T01:00:00.000Z",
    });

    await repository.saveUserLibraryAssetRecord(alpha);
    await repository.saveUserLibraryAssetRecord(beta);

    assert.deepEqual(await repository.readUserLibraryAssetRecord({ assetId: alpha.userLibraryAssetId, version: alpha.version }), alpha);
    assert.deepEqual((await repository.listUserLibraryAssetRecords()).assets.map((record) => record.userLibraryAssetId), [
      "library.asset.beta",
      "library.asset.alpha",
    ]);
    assert.deepEqual((await repository.listUserLibraryAssetRecords({ sourceWorkspaceId: workspaceA })).assets.map((record) => record.userLibraryAssetId), [
      "library.asset.alpha",
    ]);
    assert.deepEqual((await repository.listUserLibraryAssetRecords({ sourceAssetReference: beta.sourceAssetReference })).assets.map((record) => record.userLibraryAssetId), [
      "library.asset.beta",
    ]);
    assert.deepEqual(await repository.findUserLibraryAssetRecordBySource({
      sourceWorkspaceId: workspaceA,
      sourceAssetReference: alpha.sourceAssetReference,
      sourceAssetVersion: alpha.sourceAssetVersion,
    }), alpha);
  });

  it("rejects unsafe metadata rather than persisting paths, payloads, prompts, or secrets", async () => {
    const rootDir = await tempRoot();
    const repository = createLocalUserLibraryAssetRepositoryAdapter({ rootDir, now: fixedNow });
    await assert.rejects(
      () => repository.saveUserLibraryAssetRecord(userLibraryAssetRecord({ metadata: { rawPath: "/Users/example/private.txt" } })),
      LocalUserLibraryRecordStoreError,
    );
  });
});

describe("local workspace user-library link repository adapter", () => {
  it("saves, reads, lists by explicit workspace, and persists propagation policy as data", async () => {
    const rootDir = await tempRoot();
    const repository = createLocalWorkspaceUserLibraryLinkRepositoryAdapter({ rootDir, now: fixedNow });
    const workspaceALink = linkRecord();
    const workspaceBLink = linkRecord({
      linkId: createUserLibraryLinkId("link.beta"),
      targetWorkspaceId: workspaceB,
      propagationPolicy: "explicit-update",
      versionSelection: { kind: "explicit-update", version: "1.0.0" },
      status: "disabled",
      updatedAt: "2026-05-18T01:00:00.000Z",
      provenance: { ...linkRecord().provenance, targetWorkspaceId: workspaceB },
    });

    await repository.saveWorkspaceUserLibraryLinkRecord(workspaceALink);
    await repository.saveWorkspaceUserLibraryLinkRecord(workspaceBLink);

    assert.deepEqual(await repository.readWorkspaceUserLibraryLinkRecord(workspaceA, workspaceALink.linkId), workspaceALink);
    assert.equal(await repository.readWorkspaceUserLibraryLinkRecord(workspaceA, workspaceBLink.linkId), undefined);
    assert.deepEqual((await repository.listWorkspaceUserLibraryLinkRecords({ targetWorkspaceId: workspaceA })).links.map((record) => record.linkId), [
      "link.alpha",
    ]);
    assert.deepEqual((await repository.listWorkspaceUserLibraryLinkRecords({ targetWorkspaceId: workspaceB, status: "disabled" })).links.map((record) => record.propagationPolicy), [
      "explicit-update",
    ]);
    assert.deepEqual(await repository.findWorkspaceUserLibraryLinkRecord({
      targetWorkspaceId: workspaceA,
      userLibraryAssetReference: workspaceALink.userLibraryAssetReference,
      propagationPolicy: "pinned-version",
    }), workspaceALink);
    assert.deepEqual((await repository.listWorkspaceUserLibraryLinkRecordsByAsset({
      targetWorkspaceId: workspaceA,
      userLibraryAssetReference: workspaceALink.userLibraryAssetReference,
    })).links.map((record) => record.linkId), ["link.alpha"]);
    await assert.rejects(() => repository.listWorkspaceUserLibraryLinkRecordsByAsset({
      userLibraryAssetReference: workspaceALink.userLibraryAssetReference,
    } as never));
  });

  it("keeps workspace links scoped while user-library asset records remain globally listable", async () => {
    const rootDir = await tempRoot();
    const assetRepository = createLocalUserLibraryAssetRepositoryAdapter({ rootDir, now: fixedNow });
    const linkRepository = createLocalWorkspaceUserLibraryLinkRepositoryAdapter({ rootDir, now: fixedNow });
    await assetRepository.saveUserLibraryAssetRecord(userLibraryAssetRecord());
    await linkRepository.saveWorkspaceUserLibraryLinkRecord(linkRecord());
    await linkRepository.saveWorkspaceUserLibraryLinkRecord(linkRecord({
      linkId: createUserLibraryLinkId("link.beta"),
      targetWorkspaceId: workspaceB,
      provenance: {
        ...linkRecord().provenance,
        kind: "copied-from-user-library-asset",
        sourceKind: "user-library-copied",
        targetWorkspaceId: workspaceB,
        metadata: { relationship: "copy", note: "sanitized detached provenance" },
      },
      metadata: { relationship: "detached-copy" },
    }));

    assert.deepEqual((await assetRepository.listUserLibraryAssetRecords()).assets.map((record) => record.userLibraryAssetId), ["library.asset.alpha"]);
    assert.deepEqual((await linkRepository.listWorkspaceUserLibraryLinkRecords({ targetWorkspaceId: workspaceA })).links.map((record) => record.targetWorkspaceId), [workspaceA]);
    assert.deepEqual((await linkRepository.listWorkspaceUserLibraryLinkRecords({ targetWorkspaceId: workspaceB })).links.map((record) => record.targetWorkspaceId), [workspaceB]);
  });

  it("rejects unsafe copied/imported/link provenance metadata", async () => {
    const rootDir = await tempRoot();
    const repository = createLocalWorkspaceUserLibraryLinkRepositoryAdapter({ rootDir, now: fixedNow });
    await assert.rejects(
      () => repository.saveWorkspaceUserLibraryLinkRecord(linkRecord({ provenance: { ...linkRecord().provenance, metadata: { promptText: "do hidden work" } } })),
      LocalUserLibraryRecordStoreError,
    );
  });
});
