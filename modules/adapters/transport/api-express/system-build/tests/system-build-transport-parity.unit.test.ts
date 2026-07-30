import type { Request } from "express";
import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";
import { DESKTOP_SYSTEM_BUILD_CHANNELS } from "../../../../../contracts/ipc";
import { registerSystemBuildIpc } from "../../../ipc-electron/system-build/registerSystemBuildIpc";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { registerSystemBuildApiRoutes } from "../registerSystemBuildApiRoutes";

function authenticatedRequest<T extends object>(request: T): T {
  setExpressAuthContext(request as Request, {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: {
      principalId: "person-1",
      kind: "user",
      roles: ["organization-member"],
      scopes: ["system:write"],
    },
  });
  return request;
}

function services() {
  return {
    prepare: {
      execute: testDouble.fn(async (value: unknown) => ({ ok: true, value })),
    },
    guidedRequest: {
      execute: testDouble.fn(async (value: unknown) => ({ ok: true, value })),
    },
    cancel: {
      execute: testDouble.fn(async (value: unknown) => ({ ok: true, value })),
    },
    read: {
      execute: testDouble.fn(async (value: unknown) => ({ ok: true, value })),
    },
    list: { execute: testDouble.fn(async () => []) },
    approve: {
      execute: testDouble.fn(async (value: unknown) => ({ ok: true, value })),
    },
    readRelease: {
      execute: testDouble.fn(async (value: unknown) => ({ ok: true, value })),
    },
    listReleases: { execute: testDouble.fn(async () => []) },
    publicationWorkspace: { execute: testDouble.fn(async () => ({ systems: [] })) },
    compareReleases: {
      execute: testDouble.fn(async (value: unknown) => ({ ok: true, value })),
    },
  } as any;
}

const requestPayload = {
  workspaceId: "workspace-a",
  buildId: "build-1",
  systemId: "system-1",
  systemRevisionId: "revision-1",
};

describe("system build transport parity", () => {
  it("registers the complete API and IPC operation family", () => {
    const routes = {
      get: new Map<string, any>(),
      post: new Map<string, any>(),
    };
    registerSystemBuildApiRoutes({
      app: {
        get: (path, handler) => routes.get.set(path, handler),
        post: (path, handler) => routes.post.set(path, handler),
      },
      ...services(),
    });
    expect([...routes.get.keys(), ...routes.post.keys()].sort()).toEqual(
      [
        "/api/systems/build",
        "/api/systems/builds",
        "/api/systems/builds/preparation",
        "/api/systems/builds/cancel",
        "/api/systems/builds/request",
        "/api/systems/release",
        "/api/systems/releases",
        "/api/systems/releases/approve",
        "/api/systems/releases/compare",
        "/api/systems/publication",
      ].sort(),
    );

    const handlers = new Map<string, any>();
    registerSystemBuildIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      ...services(),
    });
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(DESKTOP_SYSTEM_BUILD_CHANNELS)
        .map((entry) => entry.request.value)
        .sort(),
    );
  });

  it("derives actors and accepts only the guided request shape", async () => {
    const routes = {
      get: new Map<string, any>(),
      post: new Map<string, any>(),
    };
    const api = services();
    registerSystemBuildApiRoutes({
      app: {
        get: (path, handler) => routes.get.set(path, handler),
        post: (path, handler) => routes.post.set(path, handler),
      },
      ...api,
    });
    const response: any = {
      status: testDouble.fn(() => response),
      json: testDouble.fn(),
    };
    await routes.post.get("/api/systems/builds/request")(
      authenticatedRequest({ body: requestPayload }),
      response,
    );
    expect(api.guidedRequest.execute.mock.calls[0][0]).toMatchObject({
      actorId: "person-1",
    });

    const handlers = new Map<string, any>();
    const ipc = services();
    registerSystemBuildIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      ...ipc,
    });
    await handlers.get(DESKTOP_SYSTEM_BUILD_CHANNELS.request.request.value)(
      {},
      { payload: requestPayload },
    );
    expect(ipc.guidedRequest.execute.mock.calls[0][0]).toMatchObject({
      actorId: "local-user",
    });
  });

  it("rejects renderer-supplied policy and infrastructure fields", async () => {
    const routes = { get: new Map<string, any>(), post: new Map<string, any>() };
    const api = services();
    registerSystemBuildApiRoutes({
      app: {
        get: (path, handler) => routes.get.set(path, handler),
        post: (path, handler) => routes.post.set(path, handler),
      },
      ...api,
    });
    const response: any = {
      status: testDouble.fn(() => response),
      json: testDouble.fn(),
    };
    await routes.post.get("/api/systems/builds/request")(
      authenticatedRequest({
        body: { ...requestPayload, availableCapabilities: ["model.invoke"] },
      }),
      response,
    );
    expect(api.guidedRequest.execute).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);

    const handlers = new Map<string, any>();
    const ipc = services();
    registerSystemBuildIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      ...ipc,
    });
    const result = await handlers.get(
      DESKTOP_SYSTEM_BUILD_CHANNELS.request.request.value,
    )({}, { payload: { ...requestPayload, toolchainProfile: "untrusted" } });
    expect(ipc.guidedRequest.execute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});
