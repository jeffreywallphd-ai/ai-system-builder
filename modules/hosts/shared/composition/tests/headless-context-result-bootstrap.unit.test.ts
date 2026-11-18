// @vitest-environment node
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import express from "express";
import {test, vi} from "vitest";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {parseHeadlessBuildPlanProposal, type HeadlessHostIncarnationId} from "../../../../contracts/headless";

const fixture = vi.hoisted(() => ({enabled: undefined as boolean | undefined, proposals: 0, steps: 0,
  factory: undefined as (() => any) | undefined,
  host: "ae175d67-e28e-425c-9661-cc98924c39aa", contextId: "492b7803-29ce-4df7-97ee-f0d0ee8198e9"}));

// Only the business-host delegates are controlled. createServer and the route
// registrar below are real; these tests assert assembly, not live OIDC/PG/Core.
vi.mock("../../../server", () => ({composeServerHost: () => ({
  registerApi() {}, async waitForAssetFoundation() {}, async closeRuntimeDatabases() {}, async shutdownBackgroundTasks() {},
  getManagedSavedState: () => undefined, getManagedBrowserConsent: () => undefined,
  getManagedHeadlessAgent: () => ({hostIncarnationId: fixture.host, read: async () => ({ok: false, code: "headless.unavailable"}),
    author: async () => ({ok: false, code: "headless.forbidden"}),
    planReview: Object.assign(async (request: any) => {
      fixture.proposals++;
      return {ok: true, value: {fingerprint: request.target.fingerprint, revision: 1, stepCount: 1,
        status: "pending", approvedSteps: 0, expiresAt: Date.now() + 60_000}};
    }, {allowContextResultSave: fixture.enabled, async runStep(request: any) {
      fixture.steps++;
      return {result: {ok: true, value: {fingerprint: request.input.fingerprint, approvalRevision: request.input.approvalRevision,
        step: request.input.step, operation: "context.save-result", kind: "committed",
        expiresAt: Date.now() + 60_000, reference: {workspaceId: request.input.workspaceId, contextId: fixture.contextId,
          taskId: fixture.host, kind: "markdown-context-pack", artifactDigest: "sha256:" + "a".repeat(64)}}},
        publishIfCurrent: async (publish: () => boolean) => publish()};
    }}),
  }),
})}));

vi.mock("../../../../adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes")>();
  return {...actual, registerManagedHeadlessAgentRoutes(app: any, factory: () => any) {
    fixture.factory = factory; return actual.registerManagedHeadlessAgentRoutes(app, factory);
  }};
});

for (const enabled of [true, false, undefined]) test(`real Server bootstrap preserves Context-save capability ${enabled}`, async () => {
  fixture.enabled = enabled; fixture.factory = undefined; fixture.proposals = fixture.steps = 0;
  const directory = await realpath(await mkdtemp(join(await realpath(tmpdir()), "context-save-bootstrap-")));
  const {createServer} = await import("../../../../../apps/server/src/createServer");
  const {registerManagedHeadlessAgentRoutes} = await vi.importActual<typeof import("../../../../adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes")>(
    "../../../../adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes");
  const documents = createInMemoryStructuredDocumentStore();
  let created: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    created = await createServer({env: {DEPLOYMENT_SHAPE: "cloud", AI_SYSTEM_BUILDER_MANAGED_SAVED_STATE: "1",
      SERVER_STORAGE_ROOT: join(directory, "storage"), SERVER_RUNTIME_ROOT: join(directory, "runtime"),
      AI_SYSTEM_BUILDER_SECURITY_MODE: "oidc-bearer", AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-self-signed",
      AI_SYSTEM_BUILDER_OIDC_ISSUER: "https://issuer.example.invalid", AI_SYSTEM_BUILDER_OIDC_AUDIENCE: "synthetic",
      AI_SYSTEM_BUILDER_OIDC_JWKS_URI: "https://issuer.example.invalid/keys",
      AI_SYSTEM_BUILDER_MANAGED_HEADLESS_AGENT_CLIENT_ID: "synthetic-agent", AI_SYSTEM_BUILDER_MANAGED_HEADLESS_BROWSER_CLIENT_ID: "synthetic-browser",
      AI_SYSTEM_BUILDER_MANAGED_HEADLESS_PLAN_REVIEW_CLIENT_ID: "synthetic-planner"},
      postgresDatabase: {documents, async listActiveSystemSummaries() {return [];}, async checkHealth() {return {healthy: true};}, async close() {}} as never,
    });
    assert.ok(fixture.factory); const captured = fixture.factory(); assert.ok(captured);
    assert.equal(captured.allowContextResultSave, enabled);
    const organizationId = createOrganizationId("org.synthetic"), workspaceId = createWorkspaceId("workspace.synthetic");
    const agent = {organizationId, workspaceId, registeredClientId: randomUUID(), principalId: "principal.synthetic",
      purpose: "plan-review", isCurrent: () => true};
    const app = express();
    // Synthetic authenticated admission isolates assembly and result projection.
    // It is not a claim about issuer verification or production authentication.
    registerManagedHeadlessAgentRoutes(app, () => ({...captured, identify: () => agent, isCurrent: () => true}));
    const listener = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => listener.once("listening", resolve));
    try {
      const address = listener.address(); assert.ok(address && typeof address !== "string");
      const input = {hostIncarnationId: fixture.host as HeadlessHostIncarnationId, workspaceId, steps: [{operation: "context.save-result",
        taskId: fixture.host, reportFingerprint: "b".repeat(64), name: "Synthetic context", idempotencyKey: randomUUID()}]};
      const parsed = parseHeadlessBuildPlanProposal(input, input.hostIncarnationId, {allowLocalFileSave: false, allowContextResultSave: true}); assert.ok(parsed.ok);
      const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
      const post = (route: string, body: object) => fetch(`http://127.0.0.1:${address.port}/api/headless/agent/${route}`, {
        method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
      const proposal = await post("plan-review", {version: "aisb-headless-v1", operation: "plan.submit", input: {...input, fingerprint}});
      assert.equal(proposal.status, enabled ? 200 : 400, await proposal.text());
      assert.equal(fixture.proposals, enabled ? 1 : 0);
      if (enabled) {
        const saved = await post("plan-step", {version: "aisb-headless-v1", operation: "plan.run-step", input: {
          hostIncarnationId: fixture.host, workspaceId, fingerprint, approvalRevision: 2, step: 1}});
        assert.equal(saved.status, 200, await saved.clone().text());
        assert.equal((await saved.json()).value.reference.contextId, fixture.contextId); assert.equal(fixture.steps, 1);
      }
    } finally {listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve()));}
  } finally {
    await created?.shutdownBackgroundTasks(); await created?.closePersistence();
    assert.equal(await realpath(directory), directory); await rm(directory, {recursive: true, force: true});
  }
}, 30_000);
