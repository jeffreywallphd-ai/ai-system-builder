import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import type { AssetRegistryDefinitionReadPort } from "../../../../application/ports/asset";
import {
  DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL,
  createDesktopAssetDefinitionReadRequest,
  createDesktopAssetDefinitionVersionReadRequest,
  createDesktopAssetResourceBackedViewReadRequest,
  createDesktopAssetResourceBackedViewsListRequest,
  createDesktopAssetDefinitionsListRequest,
} from "../../../../contracts/ipc";
import {
  createDesktopAssetDefinitionReadIpcHandler,
  createDesktopAssetDefinitionVersionReadIpcHandler,
  createDesktopAssetResourceBackedViewReadIpcHandler,
  createDesktopAssetResourceBackedViewsListIpcHandler,
  createDesktopAssetDefinitionsListIpcHandler,
  registerAssetRegistryIpc,
} from "../asset-registry/registerAssetRegistryIpc";

function definitionDetail(extra: Record<string, unknown> = {}) {
  return {
    definition: {
      definitionId: "builtin.workflow",
      assetType: "workflow",
      assetFamily: "behavioral",
      version: "1.0.0",
      displayName: "Workflow",
      description: "Workflow definition",
      lifecycleStatus: "published",
      provenance: { sourceKind: "system-generated", createdAt: "2026-05-08T00:00:00.000Z" },
      ...extra,
    },
    builtIn: true,
  };
}

function readPort(overrides: Record<string, any> = {}): AssetRegistryDefinitionReadPort {
  return {
    listDefinitionCards: testDouble.fn(async () => ({ items: [{ definitionId: "builtin.workflow", displayName: "Workflow" }] as any[] })),
    readDefinitionDetail: testDouble.fn(async () => definitionDetail() as any),
    listResourceBackedViewCards: testDouble.fn(async () => ({ items: [] })),
    readResourceBackedViewDetail: testDouble.fn(async () => undefined),
    ...overrides,
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

describe("registerAssetRegistryIpc", () => {
  it("lists definition cards with validated query mapping and request metadata", async () => {
    const listDefinitionCards = testDouble.fn(async () => ({ items: [] }));
    const handler = createDesktopAssetDefinitionsListIpcHandler({ assetRegistryRead: readPort({ listDefinitionCards }) });
    const request = createDesktopAssetDefinitionsListRequest(
      {
        searchText: "flow",
        assetTypes: ["workflow", "tool"],
        assetFamilies: ["behavioral"],
        lifecycleStatuses: ["published"],
        builtIn: "built-in",
        limit: 10,
        cursor: "abc-123",
        includeMetadata: true,
        workspaceId: "workspace.asset-library-ipc",
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
      { requestId: "r1", correlationId: "c1" },
    );

    const response = await handler({}, request);

    expect(listDefinitionCards).toHaveBeenCalledWith({
      searchText: "flow",
      assetTypes: ["workflow", "tool"],
      assetFamilies: ["behavioral"],
      lifecycleStatuses: ["published"],
      includeBuiltIns: undefined,
      includeCustom: false,
      includeMetadata: true,
      limit: 10,
      cursor: "abc-123",
      workspaceId: "workspace.asset-library-ipc",
    });
    expect(response).toMatchObject({ ok: true, operation: "asset.definitions-list", requestId: "r1", correlationId: "c1" });
  });

  it("reads definition details and maps expand/includeValidation options", async () => {
    const readDefinitionDetail = testDouble.fn(async () => definitionDetail());
    const handler = createDesktopAssetDefinitionReadIpcHandler({ assetRegistryRead: readPort({ readDefinitionDetail }) });
    const request = createDesktopAssetDefinitionReadRequest(
      {
        definitionId: "builtin.workflow",
        version: "1.0.0",
        expand: ["aiContext", "metadata", "ports"],
        includeValidation: true,
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
      { requestId: "r2", correlationId: "c2" },
    );

    const response = await handler({}, request);

    expect(readDefinitionDetail).toHaveBeenCalledWith(
      { kind: "asset-definition", id: "builtin.workflow", version: "1.0.0" },
      { includeValidation: true, includeAiContext: true, includeConfigurationSchema: false, includePorts: true, includeRequirements: false, includeMetadata: true },
    );
    expect(response).toMatchObject({ ok: true, operation: "asset.definition-read", value: { builtIn: true }, requestId: "r2", correlationId: "c2" });
  });

  it("reads definition versions through the explicit version operation", async () => {
    const readDefinitionDetail = testDouble.fn(async () => definitionDetail());
    const handler = createDesktopAssetDefinitionVersionReadIpcHandler({ assetRegistryRead: readPort({ readDefinitionDetail }) });
    const request = createDesktopAssetDefinitionVersionReadRequest({
      definitionId: "builtin.workflow",
      version: "2.0.0",
      boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
    });

    const response = await handler({}, request);

    expect(readDefinitionDetail).toHaveBeenCalledWith({ kind: "asset-definition", id: "builtin.workflow", version: "2.0.0" }, expect.any(Object));
    expect(response).toMatchObject({ ok: true, operation: "asset.definition-version-read" });
  });

  it("does not request validation on default detail reads", async () => {
    const readDefinitionDetail = testDouble.fn(async () => definitionDetail());
    const handler = createDesktopAssetDefinitionReadIpcHandler({ assetRegistryRead: readPort({ readDefinitionDetail }) });
    const request = createDesktopAssetDefinitionReadRequest({
      definitionId: "builtin.workflow",
      expand: ["aiContext", "metadata"],
      boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
    });

    await handler({}, request);

    expect(readDefinitionDetail).toHaveBeenCalledWith(
      { kind: "asset-definition", id: "builtin.workflow" },
      { includeValidation: undefined, includeAiContext: true, includeConfigurationSchema: false, includePorts: false, includeRequirements: false, includeMetadata: true },
    );
  });

  it("lists resource-backed view cards through the read facade only", async () => {
    const listResourceBackedViewCards = testDouble.fn(async () => ({
      items: [{ viewId: "asset-view.generated-output.internal.1", viewKind: "generated-output", displayName: "Generated output" }],
    }));
    const handler = createDesktopAssetResourceBackedViewsListIpcHandler({ assetRegistryRead: readPort({ listResourceBackedViewCards }) });
    const request = createDesktopAssetResourceBackedViewsListRequest(
      {
        searchText: "generated",
        viewKinds: ["generated-output"],
        limit: 10,
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
      { requestId: "rv1", correlationId: "cv1" },
    );

    const response = await handler({}, request);

    expect(listResourceBackedViewCards).toHaveBeenCalledWith({
      searchText: "generated",
      assetTypes: undefined,
      assetFamilies: undefined,
      lifecycleStatuses: undefined,
      viewKinds: ["generated-output"],
      includeMetadata: undefined,
      limit: 10,
      cursor: undefined,
    });
    expect(response).toMatchObject({ ok: true, operation: "asset.resource-backed-views-list", requestId: "rv1", correlationId: "cv1" });
  });

  it("reads resource-backed view detail and sanitizes unsafe metadata", async () => {
    const readResourceBackedViewDetail = testDouble.fn(async () => ({
      view: {
        viewId: "asset-view.external-repository-object.internal.1",
        viewKind: "external-repository-object",
        displayName: "External object",
        metadata: { imported: false, registered: false, token: "Bearer abc" },
      },
    }));
    const handler = createDesktopAssetResourceBackedViewReadIpcHandler({ assetRegistryRead: readPort({ readResourceBackedViewDetail }) });
    const request = createDesktopAssetResourceBackedViewReadRequest({
      viewId: "asset-view.external-repository-object.internal.1",
      expand: ["metadata", "resourceBackings"],
      boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
    });

    const response = await handler({}, request);

    expect(readResourceBackedViewDetail).toHaveBeenCalledWith(
      "asset-view.external-repository-object.internal.1",
      { includeValidation: false, includeMetadata: true, includeResourceBackings: true },
    );
    expect(response).toMatchObject({ ok: true, operation: "asset.resource-backed-view-read" });
    expectNoUnsafePayloadValues(response);
  });

  it("maps missing definitions to not-found failures", async () => {
    const handler = createDesktopAssetDefinitionReadIpcHandler({
      assetRegistryRead: readPort({ readDefinitionDetail: testDouble.fn(async () => undefined) }),
    });
    const request = createDesktopAssetDefinitionReadRequest({
      definitionId: "missing",
      boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
    });

    const response = await handler({}, request);

    expect(response).toMatchObject({ ok: false, error: { code: "not-found", message: "Asset definition was not found." } });
  });

  it("rejects invalid list input with validation failures before calling the facade", async () => {
    const invalidPayloads = [
      { assetTypes: ["bad"] },
      { assetFamilies: ["bad"] },
      { lifecycleStatuses: ["bad"] },
      { builtIn: "yes" },
      { builtIn: true },
      { includeMetadata: "true" },
      { limit: 0 },
      { cursor: "/tmp/path" },
    ];

    for (const payload of invalidPayloads) {
      const assetRegistryRead = readPort({ listDefinitionCards: testDouble.fn() });
      const handler = createDesktopAssetDefinitionsListIpcHandler({ assetRegistryRead });
      const request = {
        ...createDesktopAssetDefinitionsListRequest({ boundary: { host: "desktop", source: "desktop.renderer.asset-registry" } }),
        payload: { ...payload, boundary: { host: "desktop", source: "desktop.renderer.asset-registry" } },
      } as any;

      const response = await handler({}, request);

      expect(assetRegistryRead.listDefinitionCards).not.toHaveBeenCalled();
      expect(response).toMatchObject({ ok: false, error: { code: "validation" } });
    }
  });

  it("rejects invalid expansion values", async () => {
    const assetRegistryRead = readPort({ readDefinitionDetail: testDouble.fn() });
    const handler = createDesktopAssetDefinitionReadIpcHandler({ assetRegistryRead });
    const request = {
      ...createDesktopAssetDefinitionReadRequest({ definitionId: "builtin.workflow", boundary: { host: "desktop", source: "desktop.renderer.asset-registry" } }),
      payload: {
        definitionId: "builtin.workflow",
        expand: ["aiContext", "secrets"],
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
    } as any;

    const response = await handler({}, request);

    expect(assetRegistryRead.readDefinitionDetail).not.toHaveBeenCalled();
    expect(response).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("returns sanitized internal failures for unexpected facade errors", async () => {
    const handler = createDesktopAssetDefinitionsListIpcHandler({
      assetRegistryRead: readPort({
        listDefinitionCards: testDouble.fn(async () => {
          throw new Error("raw exception C:\\Users\\name\\AppData\\Local Bearer token secret apiKey password stack command base64 blob provider payload");
        }),
      }),
    });
    const request = createDesktopAssetDefinitionsListRequest(
      { boundary: { host: "desktop", source: "desktop.renderer.asset-registry" } },
      { requestId: "r-fail", correlationId: "c-fail" },
    );

    const response = await handler({}, request);

    expect(response).toMatchObject({
      ok: false,
      requestId: "r-fail",
      correlationId: "c-fail",
      error: { code: "internal", message: "Unable to read asset definitions." },
    });
    expectNoUnsafePayloadValues(response);
  });

  it("sanitizes unsafe facade result metadata at the public IPC boundary", async () => {
    const handler = createDesktopAssetDefinitionReadIpcHandler({
      assetRegistryRead: readPort({
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
      }),
    });
    const response = await handler({}, createDesktopAssetDefinitionReadRequest({
      definitionId: "builtin.workflow",
      expand: ["metadata"],
      boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
    }));
    const payload = JSON.stringify(response);

    expect(payload).toContain("safe");
    expectNoUnsafePayloadValues(response);
  });

  it("does not validate every list item or call runtime/resource/provider scanning seams", async () => {
    const noScan = testDouble.fn();
    const listDefinitionCards = testDouble.fn(async () => ({ items: [definitionDetail().definition] }));
    const handler = createDesktopAssetDefinitionsListIpcHandler({
      assetRegistryRead: { ...readPort({ listDefinitionCards }), noScan } as any,
    });

    await handler({}, createDesktopAssetDefinitionsListRequest({
      boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
    }));

    expect(listDefinitionCards).toHaveBeenCalledTimes(1);
    expect(noScan).not.toHaveBeenCalled();
  });

  it("registers only read-only asset IPC channels", () => {
    const channels: string[] = [];
    registerAssetRegistryIpc({
      ipcMain: { handle: testDouble.fn((channel: string) => channels.push(channel)) },
      assetRegistryRead: readPort(),
    });

    expect(channels).toEqual([
      DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL.value,
    ]);
    expect(/create|update|delete|register|seed|import|finalize|scan|execute/i.test(channels.join(" "))).toBe(false);
  });
});
