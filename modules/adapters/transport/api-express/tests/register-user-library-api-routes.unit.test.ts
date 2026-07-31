import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { registerUserLibraryApiRoutes } from "../user-library/registerUserLibraryApiRoutes";

function createApp() {
  const getHandlers = new Map<string, any>();
  const postHandlers = new Map<string, any>();
  return {
    getHandlers,
    postHandlers,
    app: {
      get: testDouble.fn((path: string, handler: any) => getHandlers.set(path, handler)),
      post: testDouble.fn((path: string, handler: any) => postHandlers.set(path, handler)),
    },
  };
}

function createResponse() {
  return {
    code: 0,
    body: undefined as any,
    status(code: number) { this.code = code; return this; },
    json(value: unknown) { this.body = value; },
  };
}

describe("registerUserLibraryApiRoutes", () => {
  it("registers API route family with API/IPC parity operation coverage", () => {
    const { app } = createApp();
    registerUserLibraryApiRoutes({ app: app as any });

    expect(app.post.mock.calls.map((call) => call[0])).toEqual([
      "/api/user-library/assets/promote",
      "/api/user-library/workspace-links",
      "/api/workspaces/:workspaceId/user-library/copies",
      "/api/workspaces/:targetWorkspaceId/imports/workspace-asset",
    ]);
    expect(app.get.mock.calls.map((call) => call[0])).toEqual([
      "/api/user-library/assets",
      "/api/user-library/assets/:assetId",
      "/api/workspaces/:workspaceId/user-library/links",
      "/api/workspaces/:workspaceId/user-library/links/:linkId",
      "/api/workspaces/:workspaceId/effective-asset-sources",
    ]);
  });

  it("calls promote/link/copy/import use cases with explicit workspace ids", async () => {
    const { app, postHandlers } = createApp();
    const promote = testDouble.fn(async () => ({ ok: true }));
    const link = testDouble.fn(async () => ({ ok: true }));
    const copy = testDouble.fn(async () => ({ ok: true }));
    const importWorkspace = testDouble.fn(async () => ({ ok: true }));
    registerUserLibraryApiRoutes({ app: app as any, promoteUseCase: { execute: promote } as any, linkUseCase: { execute: link } as any, copyUseCase: { execute: copy } as any, importUseCase: { execute: importWorkspace } as any });

    await postHandlers.get("/api/user-library/assets/promote")({ body: { sourceWorkspaceId: "workspace.source", sourceAssetReference: { kind: "asset-definition", id: "asset.alpha" }, originWorkspaceBehavior: "keep-independent-workspace-copy" } }, createResponse());
    await postHandlers.get("/api/user-library/workspace-links")({ body: { targetWorkspaceId: "workspace.target" } }, createResponse());
    await postHandlers.get("/api/workspaces/:workspaceId/user-library/copies")({ params: { workspaceId: "workspace.target" }, body: {} }, createResponse());
    await postHandlers.get("/api/workspaces/:targetWorkspaceId/imports/workspace-asset")({ params: { targetWorkspaceId: "workspace.target" }, body: { sourceWorkspaceId: "workspace.source" } }, createResponse());

    expect(promote.mock.calls[0][0].sourceWorkspaceId).toBe("workspace.source");
    expect(link.mock.calls[0][0].targetWorkspaceId).toBe("workspace.target");
    expect(copy.mock.calls[0][0].targetWorkspaceId).toBe("workspace.target");
    expect(importWorkspace.mock.calls[0][0]).toMatchObject({ sourceWorkspaceId: "workspace.source", targetWorkspaceId: "workspace.target" });
  });

  it("fails safely when workspace context is missing and sanitizes thrown errors", async () => {
    const { app, postHandlers, getHandlers } = createApp();
    registerUserLibraryApiRoutes({
      app: app as any,
      linkUseCase: { execute: testDouble.fn(async () => { throw new Error("/tmp/secret stack token"); }) } as any,
      assetRegistryRead: { listDefinitionCards: testDouble.fn() } as any,
    });

    const missing = createResponse();
    await getHandlers.get("/api/workspaces/:workspaceId/effective-asset-sources")({ params: {} }, missing);
    expect(missing.code).toBe(400);
    expect(missing.body.error.code).toBe("validation");

    const thrown = createResponse();
    await postHandlers.get("/api/user-library/workspace-links")({ body: { targetWorkspaceId: "workspace.target" } }, thrown);
    expect(thrown.code).toBe(500);
    expect(JSON.stringify(thrown.body)).not.toContain("/tmp/secret");
    expect(JSON.stringify(thrown.body)).not.toContain("stack token");
  });

  it("lists and reads sanitized user-library assets and workspace-scoped links", async () => {
    const { app, getHandlers } = createApp();
    const assetRecord = { userLibraryAssetId: "library.asset", version: "1.0.0", displayName: "Library Asset", status: "active", storagePath: "/tmp/secret" };
    const linkRecord = { linkId: "link.a", targetWorkspaceId: "workspace.a", status: "active", token: "secret" };
    const listWorkspaceUserLibraryLinkRecords = testDouble.fn(async () => ({ links: [linkRecord] }));
    registerUserLibraryApiRoutes({
      app: app as any,
      userLibraryAssetRepository: { listUserLibraryAssetRecords: async () => ({ assets: [assetRecord] }), readUserLibraryAssetRecordById: async () => assetRecord } as any,
      workspaceUserLibraryLinkRepository: { listWorkspaceUserLibraryLinkRecords, readWorkspaceUserLibraryLinkRecord: async () => linkRecord } as any,
    });

    const assets = createResponse();
    await getHandlers.get("/api/user-library/assets")({ query: {} }, assets);
    expect(assets.body.value.assets[0].displayName).toBe("Library Asset");
    expect(JSON.stringify(assets.body)).not.toContain("/tmp/secret");

    const links = createResponse();
    await getHandlers.get("/api/workspaces/:workspaceId/user-library/links")({ params: { workspaceId: "workspace.a" }, query: {} }, links);
    expect(listWorkspaceUserLibraryLinkRecords.mock.calls[0][0].targetWorkspaceId).toBe("workspace.a");
    expect(JSON.stringify(links.body)).not.toContain("secret");
  });
});
