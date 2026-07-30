import type { Request } from "express";
import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";
import { DESKTOP_ASSET_PACKAGE_CHANNELS } from "../../../../../contracts/ipc";
import { registerAssetPackageIpc } from "../../../ipc-electron/asset-package/registerAssetPackageIpc";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { registerAssetPackageApiRoutes } from "../registerAssetPackageApiRoutes";

function authenticatedRequest<T extends object>(request: T): T {
  setExpressAuthContext(request as Request, {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: {
      principalId: "person-1",
      kind: "user",
      roles: ["organization-member"],
      scopes: ["asset:write"],
    },
  });
  return request;
}

function services() {
  return {
    inspect: {
      execute: testDouble.fn(async (command: unknown) => ({
        ok: true,
        value: { inspectionId: "inspection-1", command },
      })),
    },
    admit: {
      execute: testDouble.fn(async () => ({
        ok: false,
        error: {
          code: "capability-consent-mismatch",
          message: "Explicit capability consent is required.",
        },
      })),
    },
    list: { execute: testDouble.fn(async () => []) },
    activate: {
      execute: testDouble.fn(async () => ({
        ok: true,
        value: { status: "active" },
      })),
    },
    disable: {
      execute: testDouble.fn(async () => ({
        ok: true,
        value: { status: "disabled" },
      })),
    },
    rollback: {
      execute: testDouble.fn(async () => ({
        ok: true,
        value: { status: "active" },
      })),
    },
  } as any;
}

describe("asset package transport parity", () => {
  it("registers the same lifecycle over API and IPC and preserves safe envelopes", async () => {
    const apiHandlers = {
      get: new Map<string, any>(),
      post: new Map<string, any>(),
    };
    const apiServices = services();
    registerAssetPackageApiRoutes({
      app: {
        get: (path, handler) => apiHandlers.get.set(path, handler),
        post: (path, handler) => apiHandlers.post.set(path, handler),
      },
      ...apiServices,
    });
    expect(
      [...apiHandlers.get.keys(), ...apiHandlers.post.keys()].sort(),
    ).toEqual(
      [
        "/api/asset-packages",
        "/api/asset-packages/activate",
        "/api/asset-packages/admit",
        "/api/asset-packages/disable",
        "/api/asset-packages/inspect",
        "/api/asset-packages/rollback",
      ].sort(),
    );

    const json = testDouble.fn();
    const response: any = { status: testDouble.fn(() => response), json };
    await apiHandlers.post.get("/api/asset-packages/inspect")(
      authenticatedRequest({
        body: {
          workspaceId: "workspace-a",
          contentBase64: Buffer.from("{}").toString("base64"),
        },
      }),
      response,
    );
    expect(apiServices.inspect.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      actorId: "person-1",
    });
    expect(json.mock.calls[0][0]).toMatchObject({ ok: true });

    const ipcHandlers = new Map<string, any>();
    const ipcServices = services();
    registerAssetPackageIpc({
      ipcMain: {
        handle: (channel, handler) => ipcHandlers.set(channel, handler),
      },
      ...ipcServices,
    });
    expect([...ipcHandlers.keys()].sort()).toEqual(
      Object.values(DESKTOP_ASSET_PACKAGE_CHANNELS)
        .map((entry) => entry.request.value)
        .sort(),
    );
    const result = await ipcHandlers.get(
      DESKTOP_ASSET_PACKAGE_CHANNELS.inspect.request.value,
    )(
      {},
      {
        payload: {
          workspaceId: "workspace-a",
          bytes: Uint8Array.from([123, 125]),
        },
      },
    );
    expect(ipcServices.inspect.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      actorId: "local-user",
    });
    expect(result).toMatchObject({ ok: true });
  });
});
