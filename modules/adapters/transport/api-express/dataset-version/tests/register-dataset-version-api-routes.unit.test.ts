import type { Request } from "express";
import { describe, expect, it, testDouble } from "../../../../../testing/node-test";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { registerDatasetVersionApiRoutes } from "../registerDatasetVersionApiRoutes";

function authenticated<T extends object>(request: T): T {
  setExpressAuthContext(request as Request, { authenticated: true, authMethod: "oidc-bearer", principal: { principalId: "person-1", kind: "user", roles: ["organization-member"], scopes: ["artifact:write"] } });
  return request;
}
function responseRecorder() {
  const record: { status?: number; body?: any } = {};
  const response = { status(value: number) { record.status = value; return response; }, json(value: unknown) { record.body = value; } };
  return { record, response };
}
function app() { const get = new Map<string, any>(); const post = new Map<string, any>(); return { get, post, port: { get: (path: string, handler: any) => get.set(path, handler), post: (path: string, handler: any) => post.set(path, handler) } }; }

describe("dataset version API routes", () => {
  it("registers authenticated history, comparison, reproduction, and publication routes", async () => {
    const routes = app();
    const list = testDouble.fn(async () => []);
    registerDatasetVersionApiRoutes({ app: routes.port, listDatasetVersionsUseCase: { execute: list }, compareDatasetVersionsUseCase: { execute: testDouble.fn() }, readDatasetVersionReproductionUseCase: { execute: testDouble.fn() }, publishDatasetVersionUseCase: { execute: testDouble.fn() } } as any);
    expect([...routes.get.keys()].sort()).toEqual(["/api/dataset-versions", "/api/dataset-versions/:versionId/reproduction", "/api/dataset-versions/compare"].sort());
    expect([...routes.post.keys()]).toEqual(["/api/dataset-versions/:versionId/publish"]);
    const unauthenticated = responseRecorder();
    await routes.get.get("/api/dataset-versions")({ query: { workspaceId: "workspace-a" } }, unauthenticated.response);
    expect(unauthenticated.record.status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it("binds publication to the workspace and preserves separate public confirmation", async () => {
    const routes = app();
    const publish = testDouble.fn(async (command: any, context: any) => command.confirmation.publicAccessConfirmed
      ? { ok: true, value: { publication: { repositoryId: command.repositoryId, visibility: command.visibility } }, ...context }
      : { ok: false, error: { code: "validation", message: "Public access requires a separate explicit confirmation." } });
    registerDatasetVersionApiRoutes({ app: routes.port, listDatasetVersionsUseCase: { execute: testDouble.fn() }, compareDatasetVersionsUseCase: { execute: testDouble.fn() }, readDatasetVersionReproductionUseCase: { execute: testDouble.fn() }, publishDatasetVersionUseCase: { execute: publish } } as any);
    const denied = responseRecorder();
    await routes.post.get("/api/dataset-versions/:versionId/publish")(authenticated({ params: { versionId: "version-1" }, body: { workspaceId: "workspace-a", repositoryId: "owner/data", visibility: "public" } }), denied.response);
    expect(denied.record.status).toBe(400);
    const allowed = responseRecorder();
    await routes.post.get("/api/dataset-versions/:versionId/publish")(authenticated({ params: { versionId: "version-1" }, body: { workspaceId: "workspace-a", repositoryId: "owner/data", visibility: "public", publicAccessConfirmed: true } }), allowed.response);
    expect(allowed.record.status).toBe(200);
    const [command, context] = publish.mock.calls[publish.mock.calls.length - 1]!;
    expect(command).toMatchObject({ versionId: "version-1", visibility: "public", confirmation: { approved: true, visibility: "public", publicAccessConfirmed: true } });
    expect(context).toMatchObject({ workspaceId: "workspace-a", principalId: "person-1" });
  });
});
