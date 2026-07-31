import { describe, expect, it, testDouble } from "../../../../../testing/node-test";
import { DESKTOP_SYSTEM_DATA_CHANNELS } from "../../../../../contracts/ipc";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { registerSystemDataIpc } from "../../../ipc-electron/system-data/registerSystemDataIpc";
import { registerSystemDataApiRoutes } from "../registerSystemDataApiRoutes";

function services() {
  const success = (value: unknown) => ({ ok: true as const, value });
  return {
    describe: testDouble.fn(async (value: unknown) => success(value)),
    create: testDouble.fn(async (value: unknown) => success(value)),
    read: testDouble.fn(async (value: unknown) => success(value)),
    update: testDouble.fn(async (value: unknown) => success(value)),
    list: testDouble.fn(async (value: unknown) => success(value)),
    listAudit: testDouble.fn(async (value: unknown) => success(value)),
  };
}

describe("system data transport parity", () => {
  it("registers the same complete operation family through API and IPC", () => {
    const routes = { get: new Map<string, any>(), post: new Map<string, any>() };
    registerSystemDataApiRoutes({
      app: { get: (path, handler) => routes.get.set(path, handler), post: (path, handler) => routes.post.set(path, handler) },
      runtime: services(),
    });
    expect([...routes.get.keys(), ...routes.post.keys()].sort()).toEqual([
      "/api/systems/data/audit",
      "/api/systems/data/form",
      "/api/systems/data/record",
      "/api/systems/data/records",
      "/api/systems/data/records/create",
      "/api/systems/data/records/update",
    ].sort());
    const handlers = new Map<string, any>();
    registerSystemDataIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      runtime: services(),
    });
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(DESKTOP_SYSTEM_DATA_CHANNELS).map((entry) => entry.request.value).sort(),
    );
  });

  it("derives API and local principals at trusted boundaries and drops unexpected fields", async () => {
    const routes = { get: new Map<string, any>(), post: new Map<string, any>() };
    const runtime = services();
    registerSystemDataApiRoutes({
      app: { get: (path, handler) => routes.get.set(path, handler), post: (path, handler) => routes.post.set(path, handler) },
      runtime,
    });
    const request: any = {
      body: {
        workspaceId: "workspace-a",
        releaseId: "release-a",
        entityType: "service-request",
        recordId: "record-a",
        values: { title: "Safe" },
        principal: { actorId: "untrusted", roles: ["owner"], authenticated: true },
        unexpected: "drop-me",
      },
    };
    setExpressAuthContext(request, {
      authenticated: true,
      authMethod: "oidc-bearer",
      principal: { principalId: "person-a", kind: "user", roles: ["editor"], scopes: ["asset:write"] },
    });
    const response: any = { status: testDouble.fn(() => response), json: testDouble.fn() };
    await routes.post.get("/api/systems/data/records/create")(request, response);
    expect(runtime.create.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      releaseId: "release-a",
      entityType: "service-request",
      recordId: "record-a",
      values: { title: "Safe" },
      principal: { actorId: "person-a", roles: ["editor"], authenticated: true },
    });
    expect((runtime.create.mock.calls[0][0] as any).unexpected).toBeUndefined();

    const handlers = new Map<string, any>();
    const desktopRuntime = services();
    registerSystemDataIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      runtime: desktopRuntime,
    });
    await handlers.get(DESKTOP_SYSTEM_DATA_CHANNELS.create.request.value)({}, {
      payload: {
        workspaceId: "workspace-a",
        releaseId: "release-a",
        entityType: "service-request",
        recordId: "record-a",
        values: { title: "Safe" },
        principal: { actorId: "untrusted", roles: [], authenticated: false },
      },
    });
    expect(desktopRuntime.create.mock.calls[0][0]).toMatchObject({
      principal: { actorId: "local-user", roles: ["owner", "editor", "viewer", "developer"], authenticated: true },
    });
  });
});
