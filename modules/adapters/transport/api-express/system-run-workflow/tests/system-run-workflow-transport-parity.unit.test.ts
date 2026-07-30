import { describe, expect, it, testDouble } from "../../../../../testing/node-test";
import { DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS } from "../../../../../contracts/ipc";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { setExpressOrganizationContext } from "../../security/expressOrganizationContext";
import { registerSystemRunWorkflowIpc } from "../../../ipc-electron/system-run-workflow";
import { registerSystemRunWorkflowApiRoutes } from "../registerSystemRunWorkflowApiRoutes";

const services = () => {
  const success = (value: unknown) => ({ ok: true as const, value });
  return {
    listProfiles: { execute: testDouble.fn(async (_query, context) => success(context)) },
    prepare: { execute: testDouble.fn(async (_query, context) => success(context)) },
    invoke: { execute: testDouble.fn(async (_command, context) => success(context)) },
  } as any;
};

describe("system run workflow transport parity", () => {
  it("registers the complete generic operation family over API and IPC", () => {
    const routes = { get: new Map<string, any>(), post: new Map<string, any>() };
    registerSystemRunWorkflowApiRoutes({
      app: {
        get: (path, handler) => routes.get.set(path, handler),
        post: (path, handler) => routes.post.set(path, handler),
      },
      workflows: services(),
    });
    expect([...routes.get.keys(), ...routes.post.keys()].sort()).toEqual([
      "/api/systems/run-workflows",
      "/api/systems/run-workflows/invoke",
      "/api/systems/run-workflows/prepare",
    ]);
    const handlers = new Map<string, any>();
    registerSystemRunWorkflowIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      workflows: services(),
    });
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS)
        .map((entry) => entry.request.value)
        .sort(),
    );
  });

  it("derives principals at trusted boundaries and ignores renderer authority", async () => {
    const routes = { get: new Map<string, any>(), post: new Map<string, any>() };
    const workflows = services();
    registerSystemRunWorkflowApiRoutes({
      app: {
        get: (path, handler) => routes.get.set(path, handler),
        post: (path, handler) => routes.post.set(path, handler),
      },
      workflows,
    });
    const request: any = {
      query: { workspaceId: "workspace-1" },
      principal: { actorId: "untrusted", roles: ["owner"] },
    };
    setExpressAuthContext(request, {
      authenticated: true,
      authMethod: "oidc-bearer",
      principal: {
        principalId: "person-1",
        kind: "user",
        roles: ["viewer"],
        scopes: ["workspace:read"],
      },
    });
    setExpressOrganizationContext(request, {
      organizationId: "org-1" as any,
      membershipId: "member-1",
    } as any);
    const response: any = {
      status: testDouble.fn(() => response),
      json: testDouble.fn(),
    };
    await routes.get.get("/api/systems/run-workflows")(request, response);
    expect(workflows.listProfiles.execute.mock.calls[0][1]).toEqual({
      actorId: "person-1",
      roles: ["viewer"],
      authenticated: true,
      organizationId: "org-1",
    });
  });
});
