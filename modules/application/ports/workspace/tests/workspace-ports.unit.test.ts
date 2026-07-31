import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type {
  WorkspaceRepository,
  WorkspaceSelectionRepository,
  WorkspaceSystemPackActivationRepository,
} from "..";
import { createWorkspaceId, type ActiveWorkspaceSelection, type WorkspaceRecord } from "../../../../contracts/workspace";

const REPO_ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

describe("workspace application ports", () => {
  it("exposes persistence-only workspace repository method shapes", () => {
    type WorkspaceRepositoryKeys = keyof WorkspaceRepository;
    const expected = [
      "listWorkspaces",
      "readWorkspace",
      "saveWorkspace",
      "updateWorkspace",
      "archiveWorkspace",
    ] satisfies readonly WorkspaceRepositoryKeys[];

    assert.deepEqual(expected, [
      "listWorkspaces",
      "readWorkspace",
      "saveWorkspace",
      "updateWorkspace",
      "archiveWorkspace",
    ]);

    const workspace: WorkspaceRecord = {
      workspaceId: createWorkspaceId("workspace.port"),
      displayName: "Port Workspace",
      status: "active",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    };
    assert.equal(workspace.workspaceId, "workspace.port");

    const source = read("modules/application/ports/workspace/workspace-repository.port.ts");
    assert.match(source, /saveWorkspace is the create-or-replace\/upsert seam/);
    assert.match(source, /updateWorkspace is[\s\S]*existing-record-only/);
  });

  it("exposes active selection as a persisted preference-only port", () => {
    type WorkspaceSelectionRepositoryKeys = keyof WorkspaceSelectionRepository;
    const expected = [
      "readActiveWorkspaceSelection",
      "saveActiveWorkspaceSelection",
      "clearActiveWorkspaceSelection",
    ] satisfies readonly WorkspaceSelectionRepositoryKeys[];

    const emptySelection: ActiveWorkspaceSelection = {};
    assert.deepEqual(expected, [
      "readActiveWorkspaceSelection",
      "saveActiveWorkspaceSelection",
      "clearActiveWorkspaceSelection",
    ]);
    assert.deepEqual(emptySelection, {});
  });

  it("exposes system pack activation records as reference-only repository methods", () => {
    type WorkspaceSystemPackActivationRepositoryKeys = keyof WorkspaceSystemPackActivationRepository;
    const expected = [
      "listWorkspaceSystemPackActivations",
      "readWorkspaceSystemPackActivation",
      "saveWorkspaceSystemPackActivation",
      "updateWorkspaceSystemPackActivation",
    ] satisfies readonly WorkspaceSystemPackActivationRepositoryKeys[];

    assert.deepEqual(expected, [
      "listWorkspaceSystemPackActivations",
      "readWorkspaceSystemPackActivation",
      "saveWorkspaceSystemPackActivation",
      "updateWorkspaceSystemPackActivation",
    ]);

    const source = read("modules/application/ports/workspace/workspace-system-pack-activation-repository.port.ts");
    assert.match(source, /saveWorkspaceSystemPackActivation is the create-or-replace\/upsert seam/);
    assert.match(source, /updateWorkspaceSystemPackActivation is existing-activation-only/);
  });

  it("keeps workspace ports free of adapters, hosts, UI, API, IPC, preload, and runtime providers", () => {
    const source = [
      read("modules/application/ports/workspace/workspace-repository.port.ts"),
      read("modules/application/ports/workspace/workspace-selection-repository.port.ts"),
      read("modules/application/ports/workspace/workspace-system-pack-activation-repository.port.ts"),
      read("modules/application/ports/workspace/index.ts"),
    ].join("\n");

    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters|hosts|apps|ui|api|ipc|preload|renderer|runtime\/.*adapter|provider-client|InstallSystemAssetPackService)[^"']*["']/i);
    assert.doesNotMatch(source, /localWorkspacePersistencePaths|resolveWorkspace.*File|node:path/);
  });
});
