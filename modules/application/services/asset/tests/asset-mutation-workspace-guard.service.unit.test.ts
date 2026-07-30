import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RegisterResourceBackedViewCommand } from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { AssetMutationWorkspaceGuardService } from "..";

const workspaceId = createWorkspaceId("workspace-a");
const command: RegisterResourceBackedViewCommand = {
  operation: "asset.register-resource-backed-view",
  workspaceId,
  viewId: "view-a",
  approval: {
    userConfirmed: true,
    confirmationKind: "register-resource-backed-view",
  },
  actor: { initiatedBy: "human" },
};

describe("AssetMutationWorkspaceGuardService", () => {
  it("authorizes persisted active workspace ownership before mutation work", async () => {
    const calls: unknown[] = [];
    const guard = new AssetMutationWorkspaceGuardService({
      workspaceRepository: {
        readWorkspace: async () => ({
          organizationId: "org-a" as never,
          workspaceId,
          displayName: "A",
          status: "active",
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: "2026-07-27T00:00:00.000Z",
        }),
      },
      workspaceAuthorization: {
        authorizeWorkspaceOperation: async (request) => { calls.push(request); },
      },
    });
    assert.equal(await guard.authorize(command), undefined);
    assert.deepEqual(calls, [{
      workspace: {
        organizationId: "org-a",
        workspaceId: "workspace-a",
        displayName: "A",
        status: "active",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
      operation: "asset.register-resource-backed-view",
      requiredScopes: ["asset:write"],
    }]);
  });

  it("returns a safe permission failure when managed ownership authorization rejects", async () => {
    const guard = new AssetMutationWorkspaceGuardService({
      workspaceRepository: {
        readWorkspace: async () => ({
          organizationId: "org-b" as never,
          workspaceId,
          displayName: "B",
          status: "active",
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: "2026-07-27T00:00:00.000Z",
        }),
      },
      workspaceAuthorization: {
        authorizeWorkspaceOperation: async () => { throw new Error("private cross-tenant detail"); },
      },
    });
    const result = await guard.authorize(command);
    assert.equal(result?.code, "permission");
    assert.equal(result?.diagnostics?.[0]?.code, "asset-mutation-workspace-forbidden");
    assert.equal(JSON.stringify(result).includes("private cross-tenant detail"), false);
  });
});
