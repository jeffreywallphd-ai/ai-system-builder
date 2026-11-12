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
  it("uses only the managed membership role and denies unavailable authority before accessing records", async () => {
    const runtime = services();
    const routes = new Map<string, any>();
    const stored = { actorId: "person-a", roles: ["operator"], authenticated: true };
    const readManagedPrincipal = testDouble.fn(async (_actorId: string) => stored as typeof stored | undefined);
    registerSystemDataApiRoutes({
      app: { get: (path, handler) => routes.set(path, handler), post: (path, handler) => routes.set(path, handler) },
      runtime, readManagedPrincipal,
    });
    const query = { workspaceId: "workspace-a", releaseId: "release-a", entityType: "service-request" };
    const request: any = { query, body: { ...query, recordId: "record-a", values: { title: "Synthetic" } } };
    setExpressAuthContext(request, {
      authenticated: true, authMethod: "oidc-bearer",
      principal: { principalId: "person-a", kind: "user", roles: ["unused-token-role"], scopes: [] },
    });
    const response: any = { status: testDouble.fn(() => response), json: testDouble.fn() };
    const list = routes.get("/api/systems/data/records");
    await list(request, response);
    await routes.get("/api/systems/data/records/create")(request, response);
    expect(readManagedPrincipal.mock.calls).toEqual([["person-a"], ["person-a"]]);
    expect(runtime.list.mock.calls[0][0]).toMatchObject({ ...query, principal: stored });
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ ...query, principal: stored });
    expect(response.status.mock.calls).toEqual([[200], [200]]);

    readManagedPrincipal.mockImplementationOnce(async () => undefined);
    readManagedPrincipal.mockImplementationOnce(async () => ({ ...stored, actorId: "person-b" }));
    readManagedPrincipal.mockImplementationOnce(async () => { throw new Error("internal storage detail"); });
    for (const denied of [request, request, request, { query }]) {
      await list(denied, response);
      expect(response.status.mock.calls.at(-1)).toEqual([403]);
      expect(JSON.stringify(response.json.mock.calls.at(-1))).toContain("You do not have permission to access these records.");
      expect(JSON.stringify(response.json.mock.calls.at(-1))).not.toContain("internal storage detail");
    }
    expect(readManagedPrincipal.mock.calls.length).toBe(5);
    expect(runtime.list.mock.calls.length).toBe(1);
  });

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
