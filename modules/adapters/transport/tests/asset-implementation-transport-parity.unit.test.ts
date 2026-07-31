import { describe, expect, it, testDouble } from "../../../testing/node-test";
import {
  createDesktopAssetImplementationReleasesListRequest,
  createDesktopAssetImplementationResolveRequest,
  DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL,
} from "../../../contracts/ipc";
import { registerAssetImplementationApiRoutes } from "../api-express/asset-implementation";
import { registerAssetImplementationIpc } from "../ipc-electron/asset-implementation";

const resolutionRequest = {
  workspaceId: "workspace-a",
  definitionRef: {
    kind: "asset-definition-version" as const,
    id: "builtin.feature" as never,
    version: "1.0.0",
  },
  requiredFacets: ["ui" as const],
  deploymentProfile: "local-desktop" as const,
  availableCapabilities: [],
  permittedTrustLevels: ["system-trusted" as const],
  hostApiVersion: "1.0.0",
};

const resolution = {
  status: "unimplemented" as const,
  definitionRef: resolutionRequest.definitionRef,
  selectedFacets: [],
  diagnostics: [
    {
      code: "implementation.release.missing",
      severity: "error" as const,
      message: "No implementation release is available.",
    },
  ],
};

describe("asset implementation transports", () => {
  it("returns equivalent safe read models through API and IPC", async () => {
    const listReleases = { execute: testDouble.fn(async () => []) };
    const resolve = { execute: testDouble.fn(async () => resolution) };

    const apiHandlers = new Map<string, Function>();
    registerAssetImplementationApiRoutes({
      app: {
        get: (path, handler) => apiHandlers.set(`GET ${path}`, handler),
        post: (path, handler) => apiHandlers.set(`POST ${path}`, handler),
      },
      listReleases,
      resolve,
    });
    const ipcHandlers = new Map<string, Function>();
    registerAssetImplementationIpc({
      ipcMain: {
        handle: (channel, handler) => {
          ipcHandlers.set(channel, handler);
        },
      },
      listReleases,
      resolve,
    });

    const apiResponse = responseHarness();
    await apiHandlers.get("POST /api/asset-implementations/resolve")?.(
      { body: resolutionRequest, headers: { "x-request-id": "request-a" } },
      apiResponse,
    );
    const ipcResponse = await ipcHandlers.get(
      DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL.value,
    )?.(
      undefined,
      createDesktopAssetImplementationResolveRequest(resolutionRequest),
    );

    expect(apiResponse.statusCode).toBe(200);
    expect(apiResponse.body.value).toEqual(resolution);
    expect(ipcResponse.value).toEqual(resolution);
    expect(JSON.stringify(apiResponse.body)).not.toContain("storageKey");
    expect(JSON.stringify(ipcResponse)).not.toContain("sourceBytes");

    const listResponse = await ipcHandlers.get(
      DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_REQUEST_CHANNEL.value,
    )?.(
      undefined,
      createDesktopAssetImplementationReleasesListRequest("workspace-a"),
    );
    expect(listResponse.value).toEqual([]);
  });

  it("rejects malformed requests before a use case is invoked", async () => {
    const resolve = { execute: testDouble.fn(async () => resolution) };
    const handlers = new Map<string, Function>();
    registerAssetImplementationIpc({
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
      },
      listReleases: { execute: testDouble.fn(async () => []) },
      resolve,
    });
    const response = await handlers.get(
      DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL.value,
    )?.(undefined, { payload: {} });
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("validation");
    expect(resolve.execute).not.toHaveBeenCalled();
  });
});

function responseHarness() {
  return {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
    },
  };
}
