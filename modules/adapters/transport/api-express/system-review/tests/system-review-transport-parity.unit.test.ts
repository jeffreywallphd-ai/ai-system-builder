import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";
import { DESKTOP_SYSTEM_REVIEW_CHANNELS } from "../../../../../contracts/ipc";
import type { ReleaseBoundSystemReviewUseCases } from "../../../../../application/use-cases/system-review";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { registerSystemReviewIpc } from "../../../ipc-electron/system-review/registerSystemReviewIpc";
import { registerSystemReviewApiRoutes } from "../registerSystemReviewApiRoutes";

function services() {
  type Runtime = Pick<
    ReleaseBoundSystemReviewUseCases,
    "describe" | "browse" | "detail" | "preview" | "listAudit"
  >;
  const success = (value: unknown): any => ({ ok: true as const, value });
  return {
    describe: testDouble.fn<Runtime["describe"]>(async (value) =>
      success(value),
    ),
    browse: testDouble.fn<Runtime["browse"]>(async (value) => success(value)),
    detail: testDouble.fn<Runtime["detail"]>(async (value) => success(value)),
    preview: testDouble.fn<Runtime["preview"]>(async (_value) =>
      success({ status: "ready", bytes: Uint8Array.from([1, 2, 3]) }),
    ),
    listAudit: testDouble.fn<Runtime["listAudit"]>(async (value) =>
      success(value),
    ),
  };
}

describe("system review transport parity", () => {
  it("registers the complete review operation family through API and IPC", () => {
    const routes = new Map<string, any>();
    registerSystemReviewApiRoutes({
      app: { get: (path, handler) => routes.set(path, handler) },
      runtime: services(),
    });
    expect([...routes.keys()].sort()).toEqual(
      [
        "/api/systems/review",
        "/api/systems/review/artifacts",
        "/api/systems/review/artifact",
        "/api/systems/review/preview",
        "/api/systems/review/audit",
      ].sort(),
    );

    const handlers = new Map<string, any>();
    registerSystemReviewIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      runtime: services(),
    });
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(DESKTOP_SYSTEM_REVIEW_CHANNELS)
        .map((entry) => entry.request.value)
        .sort(),
    );
  });

  it("derives trusted principals, drops caller principal fields, and JSON-normalizes bounded preview bytes", async () => {
    const routes = new Map<string, any>();
    const runtime = services();
    registerSystemReviewApiRoutes({
      app: { get: (path, handler) => routes.set(path, handler) },
      runtime,
    });
    const request: any = {
      query: {
        workspaceId: "workspace-a",
        releaseId: "release-a",
        artifactRef: "artifact-abc",
        principal: { actorId: "untrusted", roles: ["owner"] },
      },
    };
    setExpressAuthContext(request, {
      authenticated: true,
      authMethod: "oidc-bearer",
      principal: {
        principalId: "person-a",
        kind: "user",
        roles: ["viewer"],
        scopes: ["artifact:read"],
      },
    });
    const response: any = {
      status: testDouble.fn(() => response),
      json: testDouble.fn(),
    };
    await routes.get("/api/systems/review/preview")(request, response);
    expect(runtime.preview.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      releaseId: "release-a",
      artifactRef: "artifact-abc",
      principal: {
        actorId: "person-a",
        roles: ["viewer"],
        authenticated: true,
      },
    });
    expect(response.json.mock.calls[0][0]).toMatchObject({
      ok: true,
      value: { bytes: [1, 2, 3] },
    });

    const handlers = new Map<string, any>();
    const desktopRuntime = services();
    registerSystemReviewIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      runtime: desktopRuntime,
    });
    await handlers.get(DESKTOP_SYSTEM_REVIEW_CHANNELS.detail.request.value)(
      {},
      {
        payload: {
          workspaceId: "workspace-a",
          releaseId: "release-a",
          artifactRef: "artifact-abc",
          principal: { actorId: "untrusted", roles: [] },
        },
      },
    );
    expect(desktopRuntime.detail.mock.calls[0][0]).toMatchObject({
      principal: {
        actorId: "local-user",
        roles: ["owner", "editor", "viewer", "developer"],
        authenticated: true,
      },
    });
  });
});
