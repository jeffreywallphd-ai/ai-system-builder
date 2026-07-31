import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { registerAssetRegistryApiRoutes, type ExpressAssetRegistryRoutePort } from "../asset-registry/registerAssetRegistryApiRoutes";

function response() {
  const json = testDouble.fn();
  const status = testDouble.fn();
  const res: any = { status: status.mockImplementation(() => res), json };
  return { res, json, status };
}

function appAndHandlers() {
  const handlers = new Map<string, any>();
  const app = { get: testDouble.fn((path, handler) => handlers.set(path, handler)) } as any as ExpressAssetRegistryRoutePort & { get: ReturnType<typeof testDouble.fn> };
  return { app, handlers };
}

function definitionDetail(extra: Record<string, unknown> = {}) {
  return {
    definition: {
      definitionId: "builtin.workflow",
      assetType: "workflow",
      assetFamily: "behavioral",
      version: "1.0.0",
      displayName: "Workflow",
      lifecycleStatus: "published",
      ...extra,
    },
    builtIn: true,
  };
}

const UNSAFE_PAYLOAD_PATTERNS = [
  /\/tmp/i,
  /\/home\//i,
  /C:\\/i,
  /storageRootDirectory/i,
  /runtimeRootDirectory/i,
  /Bearer/i,
  /token/i,
  /secret/i,
  /apiKey/i,
  /password/i,
  /stack/i,
  /stack trace/i,
  /command/i,
  /process\.env/i,
  /base64/i,
  /bytes/i,
  /blobs/i,
  /blob/i,
  /provider payload/i,
  /raw exception/i,
] as const;

function expectNoUnsafePayloadValues(payload: unknown) {
  const serialized = JSON.stringify(payload);
  for (const pattern of UNSAFE_PAYLOAD_PATTERNS) {
    expect(pattern.test(serialized)).toBe(false);
  }
}

describe("registerAssetRegistryApiRoutes", () => {
  it("registers only GET routes for the read-only asset registry surface", () => {
    const { app } = appAndHandlers();
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards: testDouble.fn(), readDefinitionDetail: testDouble.fn() } });
    expect(app.get.mock.calls.map((call: any) => call[0])).toEqual([
      "/api/assets/definitions",
      "/api/assets/resource-backed-views",
      "/api/assets/resource-backed-views/:viewId",
      "/api/assets/definitions/:definitionId",
      "/api/assets/definitions/:definitionId/versions/:version",
    ]);
  });

  it("lists definition cards with validated query mapping and request metadata", async () => {
    const { app, handlers } = appAndHandlers();
    const listDefinitionCards = testDouble.fn(async () => ({ items: [{ definitionId: "builtin.workflow", displayName: "Workflow" }] }));
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards, readDefinitionDetail: testDouble.fn() } as any });

    const { res, status, json } = response();
    await handlers.get("/api/assets/definitions")({
      headers: { "x-request-id": "r1", "x-correlation-id": "c1" },
      query: { workspaceId: "workspace.alpha", q: "flow", assetType: "workflow,tool", assetFamily: "behavioral", lifecycleStatus: "published", builtIn: "built-in", limit: "10", cursor: "abc-123", includeMetadata: "true" },
    }, res);

    expect(listDefinitionCards).toHaveBeenCalledWith({
      searchText: "flow",
      assetTypes: ["workflow", "tool"],
      assetFamilies: ["behavioral"],
      lifecycleStatuses: ["published"],
      includeBuiltIns: undefined,
      includeCustom: false,
      includeMetadata: true,
      workspaceId: "workspace.alpha",
      limit: 10,
      cursor: "abc-123",
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: true, operation: "asset.definitions-list", requestId: "r1", correlationId: "c1" });
  });

  it("reads definition details and maps expand/includeValidation options", async () => {
    const { app, handlers } = appAndHandlers();
    const readDefinitionDetail = testDouble.fn(async () => definitionDetail());
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards: testDouble.fn(), readDefinitionDetail } as any });

    const { res, status, json } = response();
    await handlers.get("/api/assets/definitions/:definitionId")({ params: { definitionId: "builtin.workflow" }, query: { workspaceId: "workspace.alpha", version: "1.0.0", expand: "aiContext,metadata,ports", includeValidation: "true" }, headers: {} }, res);

    expect(readDefinitionDetail).toHaveBeenCalledWith(
      { kind: "asset-definition", id: "builtin.workflow", version: "1.0.0" },
      { includeValidation: true, includeAiContext: true, includeConfigurationSchema: false, includePorts: true, includeRequirements: false, includeMetadata: true, workspaceId: "workspace.alpha" },
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: true, operation: "asset.definition-read", value: { builtIn: true } });
  });

  it("reads a definition version through the explicit version route", async () => {
    const { app, handlers } = appAndHandlers();
    const readDefinitionDetail = testDouble.fn(async () => definitionDetail());
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards: testDouble.fn(), readDefinitionDetail } as any });
    const { res, status, json } = response();

    await handlers.get("/api/assets/definitions/:definitionId/versions/:version")({ params: { definitionId: "builtin.workflow", version: "2.0.0" }, query: { workspaceId: "workspace.alpha" }, headers: {} }, res);

    expect(readDefinitionDetail.mock.calls[0]?.[0]).toEqual({ kind: "asset-definition", id: "builtin.workflow", version: "2.0.0" });
    expect(readDefinitionDetail.mock.calls[0]?.[1]).toMatchObject({ workspaceId: "workspace.alpha" });
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: true, operation: "asset.definition-version-read" });
  });

  it("lists resource-backed view cards from the injected read facade", async () => {
    const { app, handlers } = appAndHandlers();
    const listResourceBackedViewCards = testDouble.fn(async () => ({
      items: [{
        viewId: "asset-view.generated-output.internal.1",
        viewKind: "generated-output",
        displayName: "Generated output",
        metadata: { finalized: false, registered: false, localPath: "/tmp/private" },
      }],
      diagnostics: [{ severity: "info", code: "generated-output-not-registered", message: "Generated output is not finalized or registered." }],
    }));
    registerAssetRegistryApiRoutes({
      app,
      assetRegistryRead: { listDefinitionCards: testDouble.fn(), readDefinitionDetail: testDouble.fn(), listResourceBackedViewCards } as any,
    });
    const { res, status, json } = response();

    await handlers.get("/api/assets/resource-backed-views")({
      headers: { "x-request-id": "r-view", "x-correlation-id": "c-view" },
      query: { workspaceId: "workspace.alpha", q: "generated", viewKind: "generated-output", limit: "10", includeMetadata: "true" },
    }, res);

    expect(listResourceBackedViewCards).toHaveBeenCalledWith({
      searchText: "generated",
      assetTypes: undefined,
      assetFamilies: undefined,
      lifecycleStatuses: undefined,
      viewKinds: ["generated-output"],
      includeMetadata: true,
      workspaceId: "workspace.alpha",
      limit: 10,
      cursor: undefined,
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      ok: true,
      operation: "asset.resource-backed-views-list",
      requestId: "r-view",
      correlationId: "c-view",
    });
    expectNoUnsafePayloadValues(json.mock.calls[0]?.[0]);
  });

  it("reads resource-backed view detail and maps missing views to not found", async () => {
    const { app, handlers } = appAndHandlers();
    const readResults = [
      {
        view: {
          viewId: "asset-view.external-repository-object.internal.1",
          viewKind: "external-repository-object",
          displayName: "External object",
          metadata: { imported: false, registered: false, token: "Bearer abc" },
        },
      },
      undefined,
    ];
    const readResourceBackedViewDetail = testDouble.fn(async () => readResults.shift());
    registerAssetRegistryApiRoutes({
      app,
      assetRegistryRead: {
        listDefinitionCards: testDouble.fn(),
        readDefinitionDetail: testDouble.fn(),
        listResourceBackedViewCards: testDouble.fn(),
        readResourceBackedViewDetail,
      } as any,
    });

    const first = response();
    await handlers.get("/api/assets/resource-backed-views/:viewId")({
      params: { viewId: "asset-view.external-repository-object.internal.1" },
      query: { workspaceId: "workspace.alpha", expand: "metadata,resourceBackings" },
      headers: {},
    }, first.res);
    expect(readResourceBackedViewDetail).toHaveBeenCalledWith(
      "asset-view.external-repository-object.internal.1",
      { includeValidation: false, includeMetadata: true, includeResourceBackings: true, workspaceId: "workspace.alpha" },
    );
    expect(first.status).toHaveBeenCalledWith(200);
    expectNoUnsafePayloadValues(first.json.mock.calls[0]?.[0]);

    const second = response();
    await handlers.get("/api/assets/resource-backed-views/:viewId")({
      params: { viewId: "missing-view" },
      query: { workspaceId: "workspace.alpha" },
      headers: {},
    }, second.res);
    expect(second.status).toHaveBeenCalledWith(404);
    expect(second.json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("does not request validation on default detail reads", async () => {
    const { app, handlers } = appAndHandlers();
    const readDefinitionDetail = testDouble.fn(async () => definitionDetail());
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards: testDouble.fn(), readDefinitionDetail } as any });
    const { res } = response();

    await handlers.get("/api/assets/definitions/:definitionId")({
      params: { definitionId: "builtin.workflow" },
      query: { workspaceId: "workspace.alpha", expand: "aiContext,metadata" },
      headers: {},
    }, res);

    expect(readDefinitionDetail).toHaveBeenCalledWith(
      { kind: "asset-definition", id: "builtin.workflow" },
      { includeValidation: undefined, includeAiContext: true, includeConfigurationSchema: false, includePorts: false, includeRequirements: false, includeMetadata: true, workspaceId: "workspace.alpha" },
    );
  });

  it("returns 404 when a definition is missing", async () => {
    const { app, handlers } = appAndHandlers();
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards: testDouble.fn(), readDefinitionDetail: testDouble.fn(async () => undefined) } as any });
    const { res, status, json } = response();

    await handlers.get("/api/assets/definitions/:definitionId")({ params: { definitionId: "missing" }, query: { workspaceId: "workspace.alpha" }, headers: {} }, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "not-found" } });
  });


  it("requires workspace context on all Asset Registry read routes before calling the facade", async () => {
    const { app, handlers } = appAndHandlers();
    const listDefinitionCards = testDouble.fn();
    const readDefinitionDetail = testDouble.fn();
    const listResourceBackedViewCards = testDouble.fn();
    const readResourceBackedViewDetail = testDouble.fn();
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards, readDefinitionDetail, listResourceBackedViewCards, readResourceBackedViewDetail } as any });

    const cases = [
      ["/api/assets/definitions", { query: {}, headers: {} }],
      ["/api/assets/definitions/:definitionId", { params: { definitionId: "builtin.workflow" }, query: {}, headers: {} }],
      ["/api/assets/definitions/:definitionId/versions/:version", { params: { definitionId: "builtin.workflow", version: "1.0.0" }, query: {}, headers: {} }],
      ["/api/assets/resource-backed-views", { query: {}, headers: {} }],
      ["/api/assets/resource-backed-views/:viewId", { params: { viewId: "asset-view.generated-output.internal.1" }, query: {}, headers: {} }],
    ] as const;

    for (const [route, request] of cases) {
      const { res, status, json } = response();
      await handlers.get(route)(request, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "validation", message: "Workspace id is required for Asset Library reads." } });
    }

    expect(listDefinitionCards).not.toHaveBeenCalled();
    expect(readDefinitionDetail).not.toHaveBeenCalled();
    expect(listResourceBackedViewCards).not.toHaveBeenCalled();
    expect(readResourceBackedViewDetail).not.toHaveBeenCalled();
  });

  it("rejects invalid public query parameters with validation failures", async () => {
    const invalidCases = [
      { assetType: "bad" },
      { assetFamily: "bad" },
      { lifecycleStatus: "bad" },
      { builtIn: "yes" },
      { includeMetadata: "yes" },
      { limit: "0" },
      { cursor: "/tmp/path" },
    ];

    for (const query of invalidCases) {
      const { app, handlers } = appAndHandlers();
      const listDefinitionCards = testDouble.fn();
      registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards, readDefinitionDetail: testDouble.fn() } as any });
      const { res, status, json } = response();
      await handlers.get("/api/assets/definitions")({ query, headers: {} }, res);
      expect(listDefinitionCards).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(400);
      expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "validation" } });
    }
  });

  it("rejects invalid expansion values", async () => {
    const { app, handlers } = appAndHandlers();
    const readDefinitionDetail = testDouble.fn();
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards: testDouble.fn(), readDefinitionDetail } as any });
    const { res, status, json } = response();

    await handlers.get("/api/assets/definitions/:definitionId")({ params: { definitionId: "builtin.workflow" }, query: { expand: "aiContext,secrets" }, headers: {} }, res);

    expect(readDefinitionDetail).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("keeps unexpected facade failures sanitized", async () => {
    const { app, handlers } = appAndHandlers();
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards: testDouble.fn(async () => { throw new Error("raw exception /tmp/root Bearer token secret apiKey password stack command base64 blob provider payload"); }), readDefinitionDetail: testDouble.fn() } as any });
    const { res, status, json } = response();

    await handlers.get("/api/assets/definitions")({ query: { workspaceId: "workspace.alpha" }, headers: { "x-request-id": "r-fail" } }, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls[0]?.[0])).toContain("Unable to read asset definitions.");
    expectNoUnsafePayloadValues(json.mock.calls[0]?.[0]);
  });

  it("does not validate every list item or call resource/runtime/provider scans", async () => {
    const { app, handlers } = appAndHandlers();
    const noScan = testDouble.fn();
    const listDefinitionCards = testDouble.fn(async () => ({ items: [definitionDetail().definition] }));
    registerAssetRegistryApiRoutes({ app, assetRegistryRead: { listDefinitionCards, readDefinitionDetail: testDouble.fn(), noScan } as any });
    const { res } = response();

    await handlers.get("/api/assets/definitions")({ query: { workspaceId: "workspace.alpha" }, headers: {} }, res);

    expect(listDefinitionCards).toHaveBeenCalledTimes(1);
    expect(noScan).not.toHaveBeenCalled();
  });

  it("sanitizes unsafe facade result metadata at the public API boundary", async () => {
    const { app, handlers } = appAndHandlers();
    registerAssetRegistryApiRoutes({
      app,
      assetRegistryRead: {
        listDefinitionCards: testDouble.fn(),
        readDefinitionDetail: testDouble.fn(async () => definitionDetail({
          metadata: {
            safe: "yes",
            storageRootDirectory: "safe-looking-storage-root",
            runtimeRootDirectory: "safe-looking-runtime-root",
            providerNote: "raw provider payload",
            exceptionNote: "raw exception message",
            token: "Bearer abc",
            secret: "secret=value",
            apiKey: "apiKey=value",
            password: "password=value",
            barePassword: "password",
            bareSecret: "secret",
            bareToken: "token",
            authValue: "auth",
            stack: "Error stack",
            stackTrace: "stack trace",
            command: "rm -rf /",
            envValue: "process.env",
            base64: "data:image/png;base64,AAAA",
            bytes: "bytes",
            blobs: "blobs",
            blob: "raw provider payload",
          },
        })),
      } as any,
    });
    const { res, json } = response();

    await handlers.get("/api/assets/definitions/:definitionId")({ params: { definitionId: "builtin.workflow" }, query: { workspaceId: "workspace.alpha", expand: "metadata" }, headers: {} }, res);

    expect(JSON.stringify(json.mock.calls[0]?.[0])).toContain("safe");
    expectNoUnsafePayloadValues(json.mock.calls[0]?.[0]);
  });
});
