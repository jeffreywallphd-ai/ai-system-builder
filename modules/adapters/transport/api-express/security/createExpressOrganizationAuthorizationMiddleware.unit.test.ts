import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { createSecurityError } from "../../../../contracts/security";
import { createExpressOrganizationAuthorizationMiddleware } from "./createExpressOrganizationAuthorizationMiddleware";
import { setExpressAuthContext } from "./expressAuthContext";
import { setExpressOrganizationContext } from "./expressOrganizationContext";

test("managed organization middleware passes immutable auth and request context to policy", async () => {
  const requests: unknown[] = [];
  const middleware = createExpressOrganizationAuthorizationMiddleware({
    authorizer: { execute: async (request: unknown) => { requests.push(request); } } as never,
  });
  const request: any = { method: "GET", path: "/api/workspaces" };
  const organizationId = createOrganizationId("org-a");
  setExpressAuthContext(request, {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: { principalId: "principal-a", kind: "user", roles: [], scopes: ["workspace:read"] },
  });
  setExpressOrganizationContext(request, {
    organizationId,
    principalId: "principal-a",
    requestId: "request-a",
    correlationId: "correlation-a",
  });
  let continued = false;
  await middleware(request, response() as never, () => { continued = true; });
  assert.equal(continued, true);
  assert.deepEqual(requests, [{
    authContext: {
      authenticated: true,
      authMethod: "oidc-bearer",
      principal: { principalId: "principal-a", kind: "user", roles: [], scopes: ["workspace:read"] },
    },
    organizationId,
    requestId: "request-a",
    correlationId: "correlation-a",
    operation: "GET /api/workspaces",
    requiredScopes: ["workspace:read"],
    requiredOrganizationRoles: undefined,
  }]);
});

test("managed organization middleware forwards privileged route roles and scopes", async () => {
  const requests: any[] = [];
  const middleware = createExpressOrganizationAuthorizationMiddleware({
    authorizer: { execute: async (request: unknown) => { requests.push(request); } } as never,
  });
  const request: any = { method: "POST", path: "/api/security/token/revoke" };
  setExpressAuthContext(request, {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: { principalId: "principal-a", kind: "user", roles: [], scopes: [] },
  });
  setExpressOrganizationContext(request, {
    organizationId: createOrganizationId("org-a"),
    principalId: "principal-a",
  });
  await middleware(request, response() as never, () => {});
  assert.deepEqual(requests[0].requiredScopes, ["security:admin"]);
});

test("managed organization middleware protects settings, credentials, and restart with dedicated capabilities", async () => {
  const requests: any[] = [];
  const middleware = createExpressOrganizationAuthorizationMiddleware({
    authorizer: { execute: async (request: unknown) => { requests.push(request); } } as never,
  });
  for (const [method, path] of [
    ["POST", "/api/application-settings/update"],
    ["POST", "/api/config/huggingface-token"],
    ["POST", "/api/server/restart"],
  ]) {
    const request: any = { method, path };
    setExpressAuthContext(request, {
      authenticated: true,
      authMethod: "oidc-bearer",
      principal: { principalId: "principal-a", kind: "user", roles: [], scopes: [] },
    });
    setExpressOrganizationContext(request, {
      organizationId: createOrganizationId("org-a"),
      principalId: "principal-a",
    });
    await middleware(request, response() as never, () => {});
  }
  assert.deepEqual(requests.map((request) => request.requiredScopes), [
    ["settings:write"],
    ["provider-credential:write"],
    ["runtime:admin"],
  ]);
  assert.ok(requests.every((request) =>
    request.requiredOrganizationRoles.includes("operator") &&
    !request.requiredOrganizationRoles.includes("member")));
});

test("managed organization middleware denies missing context and sanitizes policy denials", async () => {
  const missingResponse = response();
  const missing = createExpressOrganizationAuthorizationMiddleware({
    authorizer: { execute: async () => undefined } as never,
  });
  await missing({ method: "GET", path: "/api/workspaces" } as never, missingResponse as never, () => {});
  assert.equal(missingResponse.statusCode, 403);

  const request: any = { method: "GET", path: "/api/workspaces" };
  setExpressAuthContext(request, {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: { principalId: "principal-a", kind: "user", roles: [], scopes: [] },
  });
  setExpressOrganizationContext(request, {
    organizationId: createOrganizationId("org-a"),
    principalId: "principal-a",
  });
  const denied = createExpressOrganizationAuthorizationMiddleware({
    authorizer: { execute: async () => { throw createSecurityError("security.forbidden", "private reason"); } } as never,
  });
  const deniedResponse = response();
  await denied(request, deniedResponse as never, () => {});
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal((deniedResponse.body as any).error.message, "Forbidden.");
  assert.doesNotMatch(JSON.stringify(deniedResponse.body), /private reason/);
});

function response() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}
