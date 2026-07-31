import { describe, expect, it, testDouble } from "../../../../../testing/node-test";
import {
  DESKTOP_USER_LIBRARY_ASSET_LIST_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_COPY_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_IMPORT_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL,
  createDesktopUserLibraryLinkRequest,
  createDesktopWorkspaceEffectiveAssetSourceListRequest,
} from "../../../../../contracts/ipc";
import { registerUserLibraryIpc } from "../registerUserLibraryIpc";

function createIpcMain() {
  const handlers = new Map<string, any>();
  return {
    handlers,
    ipcMain: {
      handle: testDouble.fn((channel: string, handler: any) => handlers.set(channel, handler)),
    },
  };
}

describe("registerUserLibraryIpc", () => {
  it("registers the Phase 7 user-library operation family on dedicated channels", () => {
    const { ipcMain } = createIpcMain();
    registerUserLibraryIpc({ ipcMain: ipcMain as any });

    expect(ipcMain.handle.mock.calls.map((call) => call[0])).toEqual([
      DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_COPY_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_IMPORT_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_ASSET_LIST_REQUEST_CHANNEL.value,
      "ipc.user-library.read-asset.request",
      "ipc.user-library.list-workspace-links.request",
      "ipc.user-library.read-workspace-link.request",
      DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL.value,
    ]);
  });

  it("calls link use case with explicit target workspace id and returns a typed envelope", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const execute = testDouble.fn(async () => ({ ok: true, status: "created" }));
    registerUserLibraryIpc({ ipcMain: ipcMain as any, linkUseCase: { execute } as any });

    const response = await handlers.get(DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL.value)(undefined, createDesktopUserLibraryLinkRequest({
      targetWorkspaceId: "workspace.target" as never,
      userLibraryAssetReference: { assetId: "library.asset" as never, version: "1.0.0" as never },
      versionSelection: { kind: "pinned-version", version: "1.0.0" },
      propagationPolicy: "pinned-version",
    }));

    expect(execute.mock.calls[0][0].targetWorkspaceId).toBe("workspace.target");
    expect(response.ok).toBe(true);
    expect(response.channel).toBe("ipc.user-library.link-asset-to-workspace.response");
  });

  it("fails safely when explicit workspace fields are missing", async () => {
    const { handlers, ipcMain } = createIpcMain();
    registerUserLibraryIpc({ ipcMain: ipcMain as any, promoteUseCase: { execute: testDouble.fn() } as any });

    const response = await handlers.get(DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL.value)(undefined, { payload: {}, requestId: "req" });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("validation");
    expect(JSON.stringify(response)).not.toContain("/tmp/");
    expect(JSON.stringify(response)).not.toContain("stack");
  });

  it("returns sanitized effective source summaries through the asset read facade", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const listDefinitionCards = testDouble.fn(async () => ({
      items: [{ effectiveSourceSummary: { effectiveSourceKind: "workspace-local", targetWorkspaceId: "workspace.a", assetReference: { kind: "asset-definition", id: "asset.alpha" }, storagePath: "/tmp/secret" } }],
    }));
    registerUserLibraryIpc({ ipcMain: ipcMain as any, assetRegistryRead: { listDefinitionCards } as any });

    const response = await handlers.get(DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL.value)(undefined, createDesktopWorkspaceEffectiveAssetSourceListRequest({ workspaceId: "workspace.a" as never }));

    expect(listDefinitionCards.mock.calls[0][0].workspaceId).toBe("workspace.a");
    expect(response.value.items[0].effectiveSourceKind).toBe("workspace-local");
    expect(JSON.stringify(response)).not.toContain("/tmp/secret");
  });
});
