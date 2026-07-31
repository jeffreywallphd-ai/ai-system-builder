import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expectTypeOf, it } from "../../../testing/node-test";

import type { AssetReference } from "../../asset";
import { normalizeAssetId, normalizeAssetReferenceKind } from "../../asset";
import { createWorkspaceId } from "../../workspace";
import {
  USER_LIBRARY_EFFECTIVE_SOURCE_KINDS,
  USER_LIBRARY_PROPAGATION_POLICIES,
  createUserLibraryAssetId,
  createUserLibraryAssetVersion,
  createUserLibraryLinkId,
  isUserLibraryAssetId,
  isUserLibraryEffectiveSourceKind,
  normalizeUserLibraryPropagationPolicy,
  type CopyUserLibraryAssetToWorkspaceCommand,
  type ImportWorkspaceAssetToWorkspaceCommand,
  type LinkUserLibraryAssetToWorkspaceCommand,
  type PromoteWorkspaceAssetToUserLibraryCommand,
  type UserLibraryAssetRecord,
  type UserLibraryAssetReference,
  type WorkspaceUserLibraryLinkRecord,
} from "..";
import * as userLibraryContracts from "..";

const timestamp = "2026-05-18T00:00:00.000Z";
const sourceWorkspaceId = createWorkspaceId("workspace.source");
const targetWorkspaceId = createWorkspaceId("workspace.target");
const sourceAssetReference: AssetReference = {
  kind: normalizeAssetReferenceKind("asset-definition"),
  id: normalizeAssetId("asset.alpha"),
  version: "1.0.0",
  label: "Asset Alpha",
};
const userLibraryAssetReference: UserLibraryAssetReference = {
  assetId: createUserLibraryAssetId("library.asset.alpha"),
  version: createUserLibraryAssetVersion("1.0.0"),
  label: "Library Asset Alpha",
};

function assertJsonSerializable(value: unknown): void {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertDoesNotIncludeAny(value: unknown, forbidden: readonly string[]): void {
  const output = serialized(value);

  for (const token of forbidden) {
    assert.equal(output.includes(token.toLowerCase()), false, token);
  }
}

function collectContractFilePaths(directoryPath: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = resolve(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectContractFilePaths(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

describe("user-library contracts", () => {
  it("normalizes safe user-library ids and rejects unsafe values without echoing raw input", () => {
    for (const valid of [
      "library.asset.alpha",
      "library-asset_01",
      "LibraryAsset01",
    ]) {
      assert.equal(isUserLibraryAssetId(valid), true, valid);
      assert.equal(createUserLibraryAssetId(` ${valid} `), valid);
    }

    for (const invalid of [
      "",
      " ",
      "/tmp/library-asset",
      "../library-asset",
      "library/asset",
      "library\\asset",
      "https://example.test/library",
      "ghp_1234567890abcdefSECRET",
      "library;rm-rf",
    ]) {
      assert.equal(isUserLibraryAssetId(invalid), false, invalid);
      assert.throws(() => createUserLibraryAssetId(invalid), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /User-library asset id must be/);
        if (invalid.trim().length > 0) {
          assert.equal(error.message.includes(invalid), false);
        }
        assert.equal(error.stack, undefined);
        return true;
      });
    }
  });

  it("accepts only explicit conservative propagation policies", () => {
    assert.deepEqual(USER_LIBRARY_PROPAGATION_POLICIES, [
      "pinned-version",
      "explicit-update",
    ]);
    assert.equal(normalizeUserLibraryPropagationPolicy(" pinned-version "), "pinned-version");
    assert.equal(normalizeUserLibraryPropagationPolicy("EXPLICIT-UPDATE"), "explicit-update");

    for (const unsafe of ["auto", "latest", "follow-latest", "", "../latest"]) {
      assert.throws(() => normalizeUserLibraryPropagationPolicy(unsafe), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /User-library propagation policy must be/);
        if (unsafe.length > 0) {
          assert.equal(error.message.includes(unsafe), false);
        }
        assert.equal(error.stack, undefined);
        return true;
      });
    }
  });

  it("requires explicit workspace ids for promotion, link, copy, and workspace import command shapes", () => {
    const promotion: PromoteWorkspaceAssetToUserLibraryCommand = {
      sourceWorkspaceId,
      sourceAssetReference,
      displayName: "Promoted Alpha",
      originWorkspaceBehavior: "no-immediate-workspace-change",
      metadata: { contractOnly: true },
    };
    const link: LinkUserLibraryAssetToWorkspaceCommand = {
      targetWorkspaceId,
      userLibraryAssetReference,
      versionSelection: { kind: "pinned-version", version: "1.0.0" },
      propagationPolicy: "pinned-version",
    };
    const copy: CopyUserLibraryAssetToWorkspaceCommand = {
      targetWorkspaceId,
      userLibraryAssetReference,
      selectedVersion: "1.0.0",
      displayName: "Copied Alpha",
    };
    const workspaceImport: ImportWorkspaceAssetToWorkspaceCommand = {
      sourceWorkspaceId,
      targetWorkspaceId,
      sourceAssetReference,
      sourceAssetVersion: "1.0.0",
    };

    assert.equal(promotion.sourceWorkspaceId, sourceWorkspaceId);
    assert.equal(link.targetWorkspaceId, targetWorkspaceId);
    assert.equal(copy.targetWorkspaceId, targetWorkspaceId);
    assert.equal(workspaceImport.sourceWorkspaceId, sourceWorkspaceId);
    assert.equal(workspaceImport.targetWorkspaceId, targetWorkspaceId);
    assertJsonSerializable({ promotion, link, copy, workspaceImport });
  });

  it("uses AssetReference for user-library records instead of a parallel asset model", () => {
    expectTypeOf<UserLibraryAssetRecord["sourceAssetReference"]>().toEqualTypeOf<AssetReference>();
    expectTypeOf<UserLibraryAssetRecord["assetReference"]>().toEqualTypeOf<AssetReference>();

    const record: UserLibraryAssetRecord = {
      userLibraryAssetId: userLibraryAssetReference.assetId,
      version: createUserLibraryAssetVersion("1.0.0"),
      displayName: "Library Asset Alpha",
      summary: "A promoted contract fixture.",
      status: "active",
      sourceAssetReference,
      sourceWorkspaceId,
      sourceAssetVersion: "1.0.0",
      assetReference: sourceAssetReference,
      provenance: {
        kind: "promoted-from-workspace-asset",
        sourceKind: "workspace-local",
        sourceWorkspaceId,
        sourceAssetReference,
        sourceAssetVersion: "1.0.0",
        operationAt: timestamp,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: { contractOnly: true },
    };

    assertJsonSerializable(record);
    assertDoesNotIncludeAny(record, [
      "base64",
      "blob",
      "/tmp/",
      "storageRoot",
      "providerPayload",
      "promptText",
      "workflowJson",
      "token",
      "stackTrace",
      "commandLine",
      "environment",
    ]);
  });

  it("describes workspace user-library link records without implying hidden latest following", () => {
    const linkRecord: WorkspaceUserLibraryLinkRecord = {
      linkId: createUserLibraryLinkId("link.alpha"),
      targetWorkspaceId,
      userLibraryAssetReference,
      versionSelection: { kind: "pinned-version", version: "1.0.0" },
      propagationPolicy: "pinned-version",
      displayLabel: "Pinned Alpha",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance: {
        kind: "linked-from-user-library-asset",
        sourceKind: "user-library-linked",
        targetWorkspaceId,
        sourceUserLibraryAssetReference: userLibraryAssetReference,
        operationAt: timestamp,
      },
      metadata: { contractOnly: true },
    };

    assertJsonSerializable(linkRecord);
    assert.equal(serialized(linkRecord).includes("follow-latest"), false);
  });

  it("exports the user-library family barrel from the root contracts surface", () => {
    assert.equal(typeof userLibraryContracts.createUserLibraryAssetId, "function");
    assert.equal(typeof userLibraryContracts.normalizeUserLibraryPropagationPolicy, "function");
    assert.equal(userLibraryContracts.USER_LIBRARY_EFFECTIVE_SOURCE_KINDS, USER_LIBRARY_EFFECTIVE_SOURCE_KINDS);
  });

  it("defines effective source kind guards for planned read-side summaries", () => {
    for (const kind of USER_LIBRARY_EFFECTIVE_SOURCE_KINDS) {
      assert.equal(isUserLibraryEffectiveSourceKind(kind), true, kind);
    }

    assert.equal(isUserLibraryEffectiveSourceKind("workspace-live-link"), false);
  });

  it("does not introduce non-contract modules or forbidden layer imports", () => {
    const familyRoot = resolve("modules/contracts/user-library");
    assert.equal(existsSync(familyRoot), true);

    const contractFiles = collectContractFilePaths(familyRoot);
    assert.ok(contractFiles.length > 0);

    const forbiddenLayerImportPattern = /from\s+["'][^"']*(?:application|adapters|hosts|ui|apps\/desktop|apps\/thin-client|apps\/server)[^"']*["']/;
    const forbiddenRuntimeImportPattern = /from\s+["'](?:node:)?(?:fs|path|electron|express)["']/;


    for (const filePath of contractFiles) {
      if (filePath.endsWith(".unit.test.ts")) {
        continue;
      }

      const content = readFileSync(filePath, "utf8");
      assert.equal(forbiddenLayerImportPattern.test(content), false, filePath);
      assert.equal(forbiddenRuntimeImportPattern.test(content), false, filePath);
    }
  });
});
