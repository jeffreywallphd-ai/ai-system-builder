import { readFileSync } from "node:fs";
import { describe, expect, it } from "../../testing/node-test";
import * as api from "../api";
import * as ipc from "../ipc";

const unsafe = [/prompt/i,/workflow/i,/token/i,/bytes?/i,/base64/i,/signed-url/i,/filesystem/i,/command\s*line/i,/environment/i,/rawPath/i,/storageRoot/i];

describe("asset-authoring API/IPC parity", () => {
  it("keeps operation coverage semantically equivalent", () => {
    expect(new Set([
      api.API_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION, api.API_ASSET_AUTHORING_CREATE_DRAFT_OPERATION, api.API_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION, api.API_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION,
      api.API_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION, api.API_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION, api.API_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION, api.API_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION,
      api.API_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, api.API_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, api.API_ASSET_AUTHORING_READ_DRAFT_OPERATION, api.API_ASSET_AUTHORING_LIST_REVISIONS_OPERATION,
      api.API_ASSET_AUTHORING_READ_REVISION_OPERATION, api.API_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, api.API_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, api.API_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION,
    ])).toEqual(new Set([
      ipc.DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION,
      ipc.DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION,
      ipc.DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_READ_DRAFT_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_OPERATION,
      ipc.DESKTOP_ASSET_AUTHORING_READ_REVISION_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_OPERATION, ipc.DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION,
    ]));
  });

  it("requires explicit workspace context fields in workspace-scoped payloads", () => {
    const src = readFileSync("modules/contracts/api/asset-authoring-api-contract.ts", "utf8");
    expect(src).toContain("readonly workspaceId: WorkspaceId");
    expect(src).toContain("readonly targetWorkspaceId: WorkspaceId");
  });

  it("avoids unsafe request/response field vocabulary", () => {
    const files = ["modules/contracts/api/asset-authoring-api-contract.ts", "modules/contracts/ipc/desktop-asset-authoring-contract.ts"];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const pattern of unsafe) {
        expect(pattern.test(src)).toBe(false);
      }
    }
  });
});
