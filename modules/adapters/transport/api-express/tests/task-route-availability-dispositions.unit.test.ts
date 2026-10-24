import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveApiRoutePolicy } from "../security/apiRouteSecurityPolicy";

test("unsupported task API families remain explicitly denied, including substituted resources and methods", () => {
  for (const path of ["/api/runtime/readiness", "/api/runtime/capabilities/image-generation", "/api/conversations/workspaces/workspace-a/sessions", "/api/conversations/workspaces/workspace-b/sessions/session-a/turns", "/api/execution-plans/workspaces/workspace-a/plans", "/api/execution-plans/workspaces/workspace-b/plans/plan-a/validate"]) {
    for (const method of ["GET", "POST", "DELETE"]) assert.deepEqual(resolveApiRoutePolicy(method, path), { public: false, deny: true, securityCode: "security.route-policy-missing" });
  }
  for (const method of ["GET", "DELETE", "PUT", "PATCH"]) {
    assert.equal(resolveApiRoutePolicy(method, "/api/ingestion/tasks/execute").deny, true);
  }
});
