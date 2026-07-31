import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type {
  UserLibraryAssetRepositoryPort,
  WorkspaceAssetForUserLibraryReadPort,
  WorkspaceUserLibraryDetachedCopyRepositoryPort,
  WorkspaceUserLibraryLinkRepositoryPort,
  WorkspaceToWorkspaceImportRepositoryPort,
} from "..";
import { createUserLibraryAssetId, createUserLibraryLinkId } from "../../../../contracts/user-library";
import { createWorkspaceId } from "../../../../contracts/workspace";

const REPO_ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

describe("user-library application ports", () => {
  it("exports record-oriented user-library repository seams through the family barrel", () => {
    type AssetRepositoryKeys = keyof UserLibraryAssetRepositoryPort;
    const assetKeys = [
      "saveUserLibraryAssetRecord",
      "updateUserLibraryAssetRecord",
      "readUserLibraryAssetRecord",
      "readUserLibraryAssetRecordById",
      "listUserLibraryAssetRecords",
      "findUserLibraryAssetRecordBySource",
      "archiveUserLibraryAssetRecord",
    ] satisfies readonly AssetRepositoryKeys[];

    type SourceReadKeys = keyof WorkspaceAssetForUserLibraryReadPort;
    const sourceReadKeys = ["readWorkspaceAssetForUserLibrary"] satisfies readonly SourceReadKeys[];

    type DetachedCopyRepositoryKeys = keyof WorkspaceUserLibraryDetachedCopyRepositoryPort;
    const detachedCopyKeys = [
      "saveWorkspaceUserLibraryDetachedCopyRecord",
      "findWorkspaceUserLibraryDetachedCopyRecord",
    ] satisfies readonly DetachedCopyRepositoryKeys[];

    type LinkRepositoryKeys = keyof WorkspaceUserLibraryLinkRepositoryPort;

    type WorkspaceImportRepositoryKeys = keyof WorkspaceToWorkspaceImportRepositoryPort;
    const workspaceImportKeys = [
      "saveWorkspaceToWorkspaceImportRecord",
      "findWorkspaceToWorkspaceImportRecord",
    ] satisfies readonly WorkspaceImportRepositoryKeys[];

    const linkKeys = [
      "saveWorkspaceUserLibraryLinkRecord",
      "updateWorkspaceUserLibraryLinkRecord",
      "readWorkspaceUserLibraryLinkRecord",
      "listWorkspaceUserLibraryLinkRecords",
      "listWorkspaceUserLibraryLinkRecordsByAsset",
      "findWorkspaceUserLibraryLinkRecord",
      "archiveWorkspaceUserLibraryLinkRecord",
    ] satisfies readonly LinkRepositoryKeys[];

    assert.deepEqual(assetKeys, [
      "saveUserLibraryAssetRecord",
      "updateUserLibraryAssetRecord",
      "readUserLibraryAssetRecord",
      "readUserLibraryAssetRecordById",
      "listUserLibraryAssetRecords",
      "findUserLibraryAssetRecordBySource",
      "archiveUserLibraryAssetRecord",
    ]);
    assert.deepEqual(sourceReadKeys, ["readWorkspaceAssetForUserLibrary"]);
    assert.deepEqual(detachedCopyKeys, [
      "saveWorkspaceUserLibraryDetachedCopyRecord",
      "findWorkspaceUserLibraryDetachedCopyRecord",
    ]);
    assert.deepEqual(workspaceImportKeys, [
      "saveWorkspaceToWorkspaceImportRecord",
      "findWorkspaceToWorkspaceImportRecord",
    ]);

    assert.deepEqual(linkKeys, [
      "saveWorkspaceUserLibraryLinkRecord",
      "updateWorkspaceUserLibraryLinkRecord",
      "readWorkspaceUserLibraryLinkRecord",
      "listWorkspaceUserLibraryLinkRecords",
      "listWorkspaceUserLibraryLinkRecordsByAsset",
      "findWorkspaceUserLibraryLinkRecord",
      "archiveWorkspaceUserLibraryLinkRecord",
    ]);

    assert.equal(createUserLibraryAssetId("library.asset"), "library.asset");
    assert.equal(createUserLibraryLinkId("library.link"), "library.link");
    assert.equal(createWorkspaceId("workspace.port"), "workspace.port");
  });

  it("keeps user-library ports free of adapters, hosts, UI, API, IPC, preload, server, and persistence implementation imports", () => {
    const source = [
      read("modules/application/ports/user-library/user-library-asset-repository.port.ts"),
      read("modules/application/ports/user-library/workspace-user-library-link-repository.port.ts"),
      read("modules/application/ports/user-library/workspace-user-library-detached-copy-repository.port.ts"),
      read("modules/application/ports/user-library/workspace-asset-for-user-library-read.port.ts"),
      read("modules/application/ports/user-library/workspace-to-workspace-import-repository.port.ts"),
      read("modules/application/ports/user-library/index.ts"),
    ].join("\n");

    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters|hosts|apps|ui|api|ipc|preload|renderer|server|persistence|localUserLibrary|local-user-library)[^"']*["']/i);
    assert.match(source, /contracts\/user-library/);
    assert.match(source, /contracts\/workspace/);
  });
});
