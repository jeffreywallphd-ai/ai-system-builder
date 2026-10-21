import assert from "node:assert/strict";
import { test } from "node:test";
import { registerAssetCompositionApiRoutes } from "../asset-composition/registerAssetCompositionApiRoutes";
import { registerEffectiveAssetProjectionApiRoutes } from "../effective-asset-projections/registerEffectiveAssetProjectionApiRoutes";
import { resolveApiRoutePolicy } from "../security/apiRouteSecurityPolicy";

function fixture() {
  const routes: { method: string; path: string; handler: any }[] = [];
  const app = Object.fromEntries(["get", "post", "patch", "delete"].map(method => [method,
    (path: string, handler: any) => routes.push({ method, path, handler })])) as any;
  const response = () => {
    const res = { code: 0, payload: undefined as any, status(code: number) { this.code = code; return this; }, json(value: any) { this.payload = value; } };
    return res;
  };
  return { app, routes, response };
}

test("composition body-owned selection and relationship IDs reach the command; route conflicts do not", async () => {
  const f = fixture(); const commands: any[] = [];
  const useCase = { execute: async (command: any) => { commands.push(command); return { status: "success", value: command }; } } as any;
  registerAssetCompositionApiRoutes({ app: f.app, addProjection: useCase, connectNodes: useCase });
  for (const [suffix, body] of [["projections", { projectionId: "projection.a" }], ["relationships", { sourceNodeId: "node.a", targetNodeId: "node.b", relationshipKind: "depends-on" }]] as const) {
    const route = f.routes.find(r => r.path.endsWith("/" + suffix))!;
    const good = f.response();
    await route.handler({ params: { workspaceId: "workspace.a", planId: "plan.a" }, body }, good);
    assert.equal(good.code, 200); assert.equal(commands.at(-1).planId, "plan.a");
    const count = commands.length;
    const conflict = f.response();
    await route.handler({ params: { workspaceId: "workspace.a", planId: "plan.a" }, body: { ...body, planId: "plan.other" } }, conflict);
    assert.equal(conflict.code, 400); assert.equal(commands.length, count);
    assert.deepEqual(resolveApiRoutePolicy("POST", route.path), {public: false, scopes: ["asset:write"]});
    assert.equal(resolveApiRoutePolicy("POST", route.path + "/unknown").deny, true);
  }
});

test("specific projection reads precede the dynamic ID route and contain rejected reads", async () => {
  const f = fixture();
  registerEffectiveAssetProjectionApiRoutes({ app: f.app, readModel: {
    readByEffectiveAssetReference: async () => ({ projectionId: "projection.exact" }),
    readByProjectionId: async () => { throw new Error("private adapter detail"); },
    listByWorkspace: async () => { throw new Error("private adapter detail"); },
  } as any, projectionRepository: { listBlockedConflictedOrStaleEffectiveAssetProjectionRecords: async () => [] } as any });
  const gets = f.routes.filter(r => r.method === "get");
  const dynamic = gets.findIndex(r => r.path.endsWith("/:projectionId"));
  assert.ok(gets.findIndex(r => r.path.endsWith("/by-effective-reference")) < dynamic);
  assert.ok(gets.findIndex(r => r.path.endsWith("/blocked")) < dynamic);
  const exact = f.response();
  await gets.find(r => r.path.endsWith("/by-effective-reference"))!.handler({ params: { workspaceId: "workspace.a" }, query: { kind: "asset-instance", id: "instance.a" } }, exact);
  assert.equal(exact.code, 200); assert.equal(exact.payload.value.projectionId, "projection.exact");
  for (const route of [gets[dynamic]!, gets.find(r => r.path.endsWith("/projections"))!]) {
    const res = f.response();
    await route.handler({ params: { workspaceId: "workspace.a", projectionId: "projection.a" } }, res);
    assert.equal(res.code, 503); assert.ok(!JSON.stringify(res.payload).includes("private adapter detail"));
  }
});
