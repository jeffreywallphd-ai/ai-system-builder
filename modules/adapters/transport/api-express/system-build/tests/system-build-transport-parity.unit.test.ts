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
    request: {
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
  deploymentProfile: "local-desktop",
  availableCapabilities: ["model.invoke"],
  permittedTrustLevels: ["system-trusted"],
  hostApiVersion: "1.0.0",
  runtimeAbiVersion: "1.0.0",
  toolchainProfile: "builder/1.0.0",
  actorId: "untrusted-client-value",
  unexpected: "must-not-cross-boundary",
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
        "/api/systems/builds/cancel",
        "/api/systems/builds/request",
        "/api/systems/release",
        "/api/systems/releases",
        "/api/systems/releases/approve",
        "/api/systems/releases/compare",
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

  it("derives actors at each trust boundary and drops unexpected build fields", async () => {
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
    expect(api.request.execute.mock.calls[0][0]).toMatchObject({
      actorId: "person-1",
      runtimeAbiVersion: "1.0.0",
    });
    expect(api.request.execute.mock.calls[0][0].unexpected).toBeUndefined();

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
    expect(ipc.request.execute.mock.calls[0][0]).toMatchObject({
      actorId: "local-user",
      runtimeAbiVersion: "1.0.0",
    });
    expect(ipc.request.execute.mock.calls[0][0].unexpected).toBeUndefined();
  });
});
