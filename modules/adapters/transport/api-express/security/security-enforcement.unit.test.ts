import assert from "node:assert/strict";
import { describe, expect, it } from "../../../../testing/node-test";
import {
  API_ROUTE_POLICIES,
  resolveApiRoutePolicy,
} from "./apiRouteSecurityPolicy";
import { createExpressSecurityMiddleware } from "./createExpressSecurityMiddleware";
import { createSecurityApplicationError } from "../../../../contracts/security";
import { createInMemoryDevSecurityEnforcementStore } from "./devSecurityEnforcement";
import { getExpressOrganizationContext } from "./expressOrganizationContext";

describe("api route security policy coverage", () => {
  it("has explicit policy entries for registered API routes", () => {
    assert.ok(API_ROUTE_POLICIES.size > 20);
    const publicRoutes = [...API_ROUTE_POLICIES.entries()]
      .filter(([, p]) => p.public)
      .map(([route]) => route)
      .sort();
    expect(publicRoutes).toContain("GET /api/security/status");
    expect(
      API_ROUTE_POLICIES.get("POST /api/security/token/revoke")?.public,
    ).toBe(false);
    expect(API_ROUTE_POLICIES.get("GET /api/workspaces")).toMatchObject({
      public: false,
      scopes: ["workspace:read"],
    });
    expect(API_ROUTE_POLICIES.get("POST /api/workspaces")).toMatchObject({
      public: false,
      scopes: ["workspace:write"],
    });
    expect(
      API_ROUTE_POLICIES.get("GET /api/workspaces/active-selection"),
    ).toMatchObject({ public: false, scopes: ["workspace:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/workspaces/active-selection"),
    ).toMatchObject({ public: false, scopes: ["workspace:write"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/workspaces/active-selection/clear"),
    ).toMatchObject({ public: false, scopes: ["workspace:write"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/model/download/start"),
    ).toMatchObject({ public: false, scopes: ["model:write"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/model/download/read"),
    ).toMatchObject({ public: false, scopes: ["model:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/model/download/list"),
    ).toMatchObject({ public: false, scopes: ["model:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/model/download/cancel"),
    ).toMatchObject({ public: false, scopes: ["model:write"] });
    expect(API_ROUTE_POLICIES.get("GET /api/assets/definitions")).toMatchObject(
      { public: false, scopes: ["asset:read"] },
    );
    expect(
      API_ROUTE_POLICIES.get("GET /api/assets/resource-backed-views"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/assets/register-resource-backed-view"),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get("GET /api/asset-implementations/releases"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/asset-implementations/resolve"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/asset-packages/inspect"),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(API_ROUTE_POLICIES.get("GET /api/systems")).toMatchObject({
      public: false,
      scopes: ["asset:read"],
    });
    expect(
      API_ROUTE_POLICIES.get("POST /api/systems/revisions/save"),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get("GET /api/systems/builds/preparation"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/systems/builds/request"),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get("GET /api/systems/publication"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("GET /api/systems/published-lifecycle"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/systems/published-lifecycle/invoke"),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/systems/releases/approve"),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/systems/foundation-upgrade/preview"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/systems/foundation-upgrade"),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get("GET /api/systems/composer/assets"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("GET /api/systems/composer/asset"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(API_ROUTE_POLICIES.get("GET /api/systems/data/form")).toMatchObject({
      public: false,
      scopes: ["asset:read"],
    });
    expect(
      API_ROUTE_POLICIES.get("GET /api/systems/review/artifacts"),
    ).toMatchObject({ public: false, scopes: ["artifact:read"] });
    expect(
      API_ROUTE_POLICIES.get("GET /api/systems/review/artifact"),
    ).toMatchObject({ public: false, scopes: ["artifact:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/systems/data/records/update"),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get("GET /api/systems/run-workflows"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/systems/run-workflows/prepare"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/systems/run-workflows/invoke"),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get(
        "GET /api/asset-authoring/workspaces/:workspaceId/drafts",
      ),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      API_ROUTE_POLICIES.get(
        "POST /api/asset-authoring/workspaces/:workspaceId/drafts",
      ),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get(
        "POST /api/asset-authoring/workspaces/:workspaceId/drafts/:draftId/publish",
      ),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/dataset-preparation/start"),
    ).toMatchObject({ public: false, scopes: ["artifact:write"] });
    expect(
      API_ROUTE_POLICIES.get("GET /api/dataset-preparation/tasks/:requestId"),
    ).toMatchObject({ public: false, scopes: ["artifact:read"] });
    expect(
      API_ROUTE_POLICIES.get(
        "POST /api/dataset-preparation/tasks/:requestId/approve",
      ),
    ).toMatchObject({ public: false, scopes: ["artifact:write"] });
    expect(
      API_ROUTE_POLICIES.get(
        "POST /api/dataset-preparation/tasks/:requestId/cancel",
      ),
    ).toMatchObject({ public: false, scopes: ["artifact:write"] });
    expect(API_ROUTE_POLICIES.get("GET /api/dataset-reviews")).toMatchObject({
      public: false,
      scopes: ["artifact:read"],
    });
    expect(
      API_ROUTE_POLICIES.get("GET /api/dataset-reviews/page"),
    ).toMatchObject({ public: false, scopes: ["artifact:read"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/dataset-reviews/rejections"),
    ).toMatchObject({ public: false, scopes: ["artifact:write"] });
    expect(
      API_ROUTE_POLICIES.get("POST /api/dataset-reviews/edits"),
    ).toMatchObject({ public: false, scopes: ["artifact:write"] });
  });

  it("denies unknown api routes", () => {
    expect(resolveApiRoutePolicy("GET", "/api/unknown")).toMatchObject({
      deny: true,
      securityCode: "security.route-policy-missing",
    });
  });

  it("fails closed for case, encoded, and namespace-root API variants", () => {
    for (const requestPath of [
      "/API/model/download",
      "/Api/artifact/upload",
      "/%61pi/image-generation/start",
      "/%41PI/artifact-repo/store",
      "/api",
      "/API",
      "/api\\model\\download",
    ]) {
      expect(resolveApiRoutePolicy("POST", requestPath)).toMatchObject({
        public: false,
        deny: true,
        securityCode: "security.route-policy-missing",
      });
    }
  });

  it("does not classify non-API paths with a similar prefix as API routes", () => {
    expect(resolveApiRoutePolicy("GET", "/apiary/status")).toEqual({
      public: true,
    });
    expect(resolveApiRoutePolicy("GET", "/application/status")).toEqual({
      public: true,
    });
  });

  it("resolves concrete Asset Library read paths through registered route templates", () => {
    expect(
      resolveApiRoutePolicy("GET", "/api/assets/definitions/builtin.document"),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      resolveApiRoutePolicy(
        "GET",
        "/api/assets/definitions/builtin.document/versions/1.0.0",
      ),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      resolveApiRoutePolicy(
        "GET",
        "/api/assets/resource-backed-views/asset-view.generated-output.internal.1",
      ),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
  });

  it("resolves concrete asset authoring paths through registered route templates", () => {
    expect(
      resolveApiRoutePolicy(
        "GET",
        "/api/asset-authoring/workspaces/workspace-a/drafts",
      ),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
    expect(
      resolveApiRoutePolicy(
        "PATCH",
        "/api/asset-authoring/workspaces/workspace-a/drafts/draft-1",
      ),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      resolveApiRoutePolicy(
        "POST",
        "/api/asset-authoring/workspaces/workspace-a/drafts/draft-1/publish",
      ),
    ).toMatchObject({ public: false, scopes: ["asset:write"] });
    expect(
      resolveApiRoutePolicy(
        "GET",
        "/api/asset-authoring/workspaces/workspace-a/overrides/override-1",
      ),
    ).toMatchObject({ public: false, scopes: ["asset:read"] });
  });

  it("resolves concrete dataset preparation task paths through registered route templates", () => {
    expect(
      resolveApiRoutePolicy("GET", "/api/dataset-preparation/tasks/task-1"),
    ).toMatchObject({
      public: false,
      scopes: ["artifact:read"],
    });
    expect(
      resolveApiRoutePolicy(
        "POST",
        "/api/dataset-preparation/tasks/task-1/cancel",
      ),
    ).toMatchObject({
      public: false,
      scopes: ["artifact:write"],
    });
    expect(
      resolveApiRoutePolicy(
        "POST",
        "/api/dataset-preparation/tasks/task-1/approve",
      ),
    ).toMatchObject({
      public: false,
      scopes: ["artifact:write"],
    });
  });
});

describe("security middleware", () => {
  it("denies case-variant API routes even when disabled-development authentication is off", async () => {
    const middleware = createExpressSecurityMiddleware({
      httpsRequired: false,
      authRequired: false,
      mode: "disabled-dev",
      verifyToken: async () =>
        ({
          principal: { id: "p", scopes: ["model:write"] },
          auth: { method: "bearer-token" },
        }) as any,
    });
    const req: any = {
      method: "POST",
      path: "/API/model/download",
      protocol: "http",
      headers: {},
    };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.operation).toBe("security.route-policy-missing");
  });

  it("disabled-dev allows missing token", async () => {
    const middleware = createExpressSecurityMiddleware({
      httpsRequired: false,
      authRequired: false,
      mode: "disabled-dev",
      verifyToken: async () =>
        ({
          principal: { id: "p", scopes: ["model:read"] },
          auth: { method: "bearer-token" },
        }) as any,
    });
    const req: any = {
      method: "POST",
      path: "/api/model/browse",
      protocol: "http",
      headers: {},
    };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("disabled-dev allows workspace creation route to reach the workspace API", async () => {
    const middleware = createExpressSecurityMiddleware({
      httpsRequired: false,
      authRequired: false,
      mode: "disabled-dev",
      verifyToken: async () =>
        ({
          principal: { id: "p", scopes: ["workspace:write"] },
          auth: { method: "bearer-token" },
        }) as any,
    });
    const req: any = {
      method: "POST",
      path: "/api/workspaces",
      protocol: "http",
      headers: {},
    };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("disabled-dev allows Asset Library read routes to reach the asset registry API", async () => {
    const middleware = createExpressSecurityMiddleware({
      httpsRequired: false,
      authRequired: false,
      mode: "disabled-dev",
      verifyToken: async () =>
        ({
          principal: { id: "p", scopes: ["asset:read"] },
          auth: { method: "bearer-token" },
        }) as any,
    });
    const req: any = {
      method: "GET",
      path: "/api/assets/definitions/builtin.document",
      protocol: "http",
      headers: {},
    };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("enforces token when dev mode is lan-token-enforced", async () => {
    const store = createInMemoryDevSecurityEnforcementStore("disabled-dev");
    store.setMode("lan-token-enforced");
    const middleware = createExpressSecurityMiddleware({
      httpsRequired: false,
      authRequired: false,
      mode: "disabled-dev",
      devSecurityEnforcement: store,
      verifyToken: async () =>
        ({
          principal: { id: "p", scopes: ["model:read"] },
          auth: { method: "bearer-token" },
        }) as any,
    });
    const req: any = {
      method: "POST",
      path: "/api/model/browse",
      protocol: "http",
      headers: {},
    };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    await middleware(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it("maps auth failures", async () => {
    const middleware = createExpressSecurityMiddleware({
      httpsRequired: true,
      authRequired: true,
      mode: "lan-https-token",
      verifyToken: async () => {
        throw createSecurityApplicationError("security.invalid-token", "x");
      },
    });
    const req: any = {
      method: "POST",
      path: "/api/model/browse",
      protocol: "https",
      headers: { authorization: "Bearer bad" },
    };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    await middleware(req, res, () => {});
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("requires valid organization context for pooled OIDC requests", async () => {
    const middleware = createExpressSecurityMiddleware({
      httpsRequired: true,
      authRequired: true,
      mode: "oidc-bearer",
      verifyToken: async () => ({
        authenticated: true,
        authMethod: "oidc-bearer",
        principal: {
          principalId: "principal-1",
          kind: "user",
          roles: [],
          scopes: [],
        },
      }),
    });
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    const missing: any = {
      method: "GET",
      path: "/api/workspaces",
      protocol: "https",
      headers: { authorization: "Bearer signed" },
    };
    await middleware(missing, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error.operation).toBe("security.organization-required");

    const request: any = {
      method: "GET",
      path: "/api/workspaces",
      protocol: "https",
      headers: { authorization: "Bearer signed", "x-organization-id": "org-a" },
    };
    let nextCalled = false;
    await middleware(request, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(getExpressOrganizationContext(request)).toMatchObject({
      organizationId: "org-a",
      principalId: "principal-1",
    });
  });

  it("defaults premium requests to its one organization and rejects another", async () => {
    const middleware = createExpressSecurityMiddleware({
      httpsRequired: true,
      authRequired: true,
      mode: "oidc-bearer",
      tenantPlacement: {
        mode: "dedicated",
        organizationId: "org-premium" as any,
      },
      verifyToken: async () => ({
        authenticated: true,
        authMethod: "oidc-bearer",
        principal: {
          principalId: "principal-1",
          kind: "user",
          roles: [],
          scopes: [],
        },
      }),
    });
    const response = () => ({
      statusCode: 200,
      body: undefined as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    });
    const defaulted: any = {
      method: "GET",
      path: "/api/workspaces",
      protocol: "https",
      headers: { authorization: "Bearer signed" },
    };
    let nextCalled = false;
    await middleware(defaulted, response(), () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(getExpressOrganizationContext(defaulted)?.organizationId).toBe(
      "org-premium",
    );

    const rejectedResponse = response();
    const other: any = {
      method: "GET",
      path: "/api/workspaces",
      protocol: "https",
      headers: {
        authorization: "Bearer signed",
        "x-organization-id": "org-other",
      },
    };
    await middleware(other, rejectedResponse, () => {});
    expect(rejectedResponse.statusCode).toBe(403);
  });
});
