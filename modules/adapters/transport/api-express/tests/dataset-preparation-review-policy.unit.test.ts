import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveApiRoutePolicy } from "../security/apiRouteSecurityPolicy";
import { createExpressSecurityMiddleware } from "../security/createExpressSecurityMiddleware";

test("prepared review admits only the existing artifact-read scope and exact GET route", async () => {
  const path = "/api/dataset-preparation/tasks/task.fixture/review-page";
  assert.deepEqual(resolveApiRoutePolicy("GET", path), { public: false, scopes: ["artifact:read"] });
  for (const [method, route] of [["POST", path], ["DELETE", path], ["GET", path + "/extra"], ["GET", "/api/ingestion/tasks/execute"]]) assert.equal(resolveApiRoutePolicy(method, route).deny, true);
  for (const [token, scopes, expected] of [[false, [], 401], [true, ["model:read"], 403], [true, ["artifact:read"], 200]] as const) {
    const middleware = createExpressSecurityMiddleware({ httpsRequired: false, authRequired: true, mode: "lan-https-token", verifyToken: async () => ({ principal: { principalId: "principal.fixture", scopes }, auth: { method: "bearer-token" } }) as never });
    const request = { method: "GET", path, protocol: "http", headers: token ? { authorization: "Bearer qualification-only" } : {} };
    let status = 200, called = false;
    const response = { status(code: number) { status = code; return this; }, json() { return this; } };
    await middleware(request as never, response as never, () => { called = true; });
    assert.equal(status, expected); assert.equal(called, expected === 200);
  }
});
