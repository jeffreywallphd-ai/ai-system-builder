import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";
import { DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS } from "../../../../../contracts/ipc";
import { createOrganizationId } from "../../../../../contracts/organization";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { setExpressOrganizationContext } from "../../security/expressOrganizationContext";
import { registerSystemDeploymentIpc } from "../../../ipc-electron/system-deployment/registerSystemDeploymentIpc";
import { registerSystemDeploymentApiRoutes } from "../registerSystemDeploymentApiRoutes";

const policy = {
  allowedCapabilities: [],
  allowedSecretReferences: [],
  egress: { mode: "deny-all" as const, allowedOrigins: [] },
  quotas: {
    maximumRunSeconds: 60,
    maximumMemoryMiB: 128,
    maximumOutputBytes: 1024,
    maximumConcurrentRuns: 1,
  },
};

function services() {
  const value = (input: unknown) => ({ ok: true as const, value: input });
  return {
    lifecycleRead: {
      execute: testDouble.fn(async (input: unknown) => value(input)),
    },
    lifecycleInvoke: {
      execute: testDouble.fn(async (input: unknown) => value(input)),
    },
    install: { execute: testDouble.fn(async (input: unknown) => value(input)) },
    activate: {
      execute: testDouble.fn(async (input: unknown) => value(input)),
    },
    health: { execute: testDouble.fn(async (input: unknown) => value(input)) },
    rollback: {
      execute: testDouble.fn(async (input: unknown) => value(input)),
    },
    revoke: { execute: testDouble.fn(async (input: unknown) => value(input)) },
    read: { execute: testDouble.fn(async (input: unknown) => value(input)) },
    list: { execute: testDouble.fn(async (input: unknown) => [input]) },
    startRun: {
      execute: testDouble.fn(async (input: unknown) => value(input)),
    },
    cancelRun: {
      execute: testDouble.fn(async (input: unknown) => value(input)),
    },
    listRuns: { execute: testDouble.fn(async (input: unknown) => [input]) },
    listAudit: { execute: testDouble.fn(async (input: unknown) => [input]) },
  };
}

const host = {
  deploymentProfiles: ["campus-server" as const],
  hostApiVersion: "1.0.0",
  runtimeAbiVersion: "runtime/1",
  capabilities: ["artifact:read"],
  sandboxQualified: false,
};

describe("system deployment transport parity", () => {
  it("registers the complete deployment lifecycle through API and IPC", () => {
    const gets = new Map<string, any>();
    const posts = new Map<string, any>();
    registerSystemDeploymentApiRoutes({
      app: {
        get: (path: string, handler: any) => gets.set(path, handler),
        post: (path: string, handler: any) => posts.set(path, handler),
      },
      host,
      ...services(),
    } as any);
    expect([...gets.keys()].sort()).toEqual(
      [
        "/api/systems/deployment",
        "/api/systems/deployments",
        "/api/systems/deployments/runs",
        "/api/systems/deployments/audit",
        "/api/systems/published-lifecycle",
      ].sort(),
    );
    expect([...posts.keys()].sort()).toEqual(
      [
        "/api/systems/deployments/install",
        "/api/systems/deployments/activate",
        "/api/systems/deployments/health",
        "/api/systems/deployments/rollback",
        "/api/systems/deployments/revoke",
        "/api/systems/deployments/runs/start",
        "/api/systems/deployments/runs/cancel",
        "/api/systems/published-lifecycle/invoke",
      ].sort(),
    );

    const handlers = new Map<string, any>();
    registerSystemDeploymentIpc({
      ipcMain: {
        handle: (channel: string, handler: any) =>
          handlers.set(channel, handler),
      },
      authority: {
        organizationId: createOrganizationId("org-desktop"),
        actorId: "desktop-principal",
      },
      host: { ...host, deploymentProfiles: ["local-desktop"] },
      ...services(),
    } as any);
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS)
        .map((entry) => entry.request.value)
        .sort(),
    );
  });

  it("uses authenticated host authority and drops caller organization, actor, capability, and sandbox fields", async () => {
    const apiServices = services();
    const posts = new Map<string, any>();
    registerSystemDeploymentApiRoutes({
      app: {
        get: () => undefined,
        post: (path: string, handler: any) => posts.set(path, handler),
      },
      host,
      ...apiServices,
    } as any);
    const request: any = {
      body: {
        workspaceId: "workspace-a",
        deploymentId: "deployment-a",
        releaseId: "release-a",
        deploymentProfile: "campus-server",
        policy,
        organizationId: "attacker-org",
        actorId: "attacker",
        hostCapabilities: ["host:filesystem"],
        sandboxQualified: true,
      },
    };
    setExpressAuthContext(request, {
      authenticated: true,
      authMethod: "oidc-bearer",
      principal: {
        principalId: "person-a",
        kind: "user",
        roles: [],
        scopes: ["asset:write"],
      },
    });
    setExpressOrganizationContext(request, {
      organizationId: createOrganizationId("org-a"),
      principalId: "person-a",
    });
    const response: any = {
      status: testDouble.fn(() => response),
      json: testDouble.fn(),
    };
    await posts.get("/api/systems/deployments/install")(request, response);
    expect(apiServices.install.execute.mock.calls[0][0]).toMatchObject({
      organizationId: "org-a",
      actorId: "person-a",
      hostCapabilities: ["artifact:read"],
      sandboxQualified: false,
      hostApiVersion: "1.0.0",
      runtimeAbiVersion: "runtime/1",
    });

    const desktopServices = services();
    const handlers = new Map<string, any>();
    registerSystemDeploymentIpc({
      ipcMain: {
        handle: (channel: string, handler: any) =>
          handlers.set(channel, handler),
      },
      authority: {
        organizationId: createOrganizationId("org-desktop"),
        actorId: "desktop-principal",
      },
      host: { ...host, deploymentProfiles: ["local-desktop"] },
      ...desktopServices,
    } as any);
    await handlers.get(
      DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS.install.request.value,
    )(
      {},
      {
        payload: {
          ...request.body,
          deploymentProfile: "local-desktop",
        },
      },
    );
    expect(desktopServices.install.execute.mock.calls[0][0]).toMatchObject({
      organizationId: "org-desktop",
      actorId: "desktop-principal",
      hostCapabilities: ["artifact:read"],
      sandboxQualified: false,
    });

    const lifecycleRequest: any = {
      body: {
        workspaceId: "workspace-a",
        releaseId: "release-a",
        action: "start",
        expectedRevision: "deployment:2:session:none",
        deploymentId: "attacker-deployment",
        runId: "attacker-run",
        policy,
        requestedCapabilities: ["host:filesystem"],
        requestedSecretReferences: ["secret.private"],
        requestedEgressOrigins: ["https://attacker.invalid"],
      },
    };
    setExpressAuthContext(lifecycleRequest, {
      authenticated: true,
      authMethod: "oidc-bearer",
      principal: {
        principalId: "person-a",
        kind: "user",
        roles: [],
        scopes: ["asset:write"],
      },
    });
    setExpressOrganizationContext(lifecycleRequest, {
      organizationId: createOrganizationId("org-a"),
      principalId: "person-a",
    });
    await posts.get("/api/systems/published-lifecycle/invoke")(
      lifecycleRequest,
      response,
    );
    expect(apiServices.lifecycleInvoke.execute.mock.calls[0][0]).toEqual({
      organizationId: "org-a",
      workspaceId: "workspace-a",
      actorId: "person-a",
      releaseId: "release-a",
      action: "start",
      expectedRevision: "deployment:2:session:none",
    });
  });
});
