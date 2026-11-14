import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";

import { HEADLESS_CONTRACT_VERSION, UI_CONTROL_VERSION, type HeadlessHostIncarnationId } from "../../../../../contracts/headless";
import { MANAGED_HEADLESS_AGENT_SESSION_HEADER } from "../../../../../contracts/headless/managed-headless-window";
import { createOrganizationId } from "../../../../../contracts/organization";
import { type AuthContext, createSecurityApplicationError } from "../../../../../contracts/security";
import { createWorkspaceId } from "../../../../../contracts/workspace";
import { MANAGED_HEADLESS_AGENT_PATHS, resolveApiRoutePolicy } from "../../security/apiRouteSecurityPolicy";
import { createExpressSecurityMiddleware } from "../../security/createExpressSecurityMiddleware";
import { registerManagedHeadlessAgentRoutes, type ManagedAgentRouteHandlers } from "../registerManagedHeadlessAgentRoutes";

test("managed agent routes stay exact in the central deny-by-default API", () => {
  for (const path of Object.values(MANAGED_HEADLESS_AGENT_PATHS)) {
    assert.deepEqual(resolveApiRoutePolicy("POST", path), {public: false, scopes: ["workspace:read", "asset:read"]});
    for (const method of ["GET", "HEAD", "DELETE", "PATCH"])
      assert.equal(resolveApiRoutePolicy(method, path).deny, true);
    for (const variant of [path + "/", path.toUpperCase(), path.replace("agent", "%61gent"), path + "/other"])
      assert.equal(resolveApiRoutePolicy("POST", variant).deny, true);
  }
});

test("managed stdio exposes presentation only when both managed options are enabled", async () => {
  for (const [consent, presentation] of [[false, false], [false, true], [true, false], [true, true]]) {
    const client = new Client({name: "consent-catalog-fixture", version: "1.0.0"});
    try {
      await client.connect(new StdioClientTransport({command: process.execPath, args: ["--import", "tsx",
        path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts")], stderr: "ignore", env: {
        AISB_HEADLESS_MODE: "managed", AISB_HEADLESS_ENABLE_MANAGED_CONSENT: consent ? "1" : "0",
        AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION: presentation ? "1" : "0",
        AISB_HEADLESS_MANAGED_ORIGIN: "https://127.0.0.1:1", AISB_HEADLESS_MANAGED_CREDENTIAL: "unused-fixture-value",
        AISB_HEADLESS_MANAGED_ORGANIZATION_ID: "fixture-organization", AISB_HEADLESS_MANAGED_WORKSPACE_ID: "fixture-workspace",
      }}));
      const names = (await client.listTools()).tools.map(tool => tool.name).sort();
      const expected = ["aisb_host_describe", "aisb_list_templates", "aisb_read_system",
        ...(consent ? ["aisb_list_windows", "aisb_release_window", "aisb_request_window", "aisb_window_status"] : []),
        ...(consent && presentation ? ["aisb_present_in_window", "aisb_renew_window", "aisb_window_context"] : [])].sort();
      assert.deepEqual(names, expected);
      if (consent) {
        const denied = await client.callTool({name: "aisb_list_windows", arguments: {hostIncarnationId: randomUUID(), workspaceId: "other-workspace"}});
        assert.equal(denied.isError, true);
        assert.deepEqual(denied.content, [{type: "text", text: '{"ok":false,"code":"headless.forbidden"}'}]);
      }
    } finally { await client.close(); }
  }
});

test("exact managed requests respect authentication, framing, authority lifetime and safe results", { timeout: 10_000 }, async () => {
  const org = createOrganizationId("managed-agent-fixture");
  const principalId = "synthetic-agent";
  const app = express();
  app.enable("case sensitive routing");
  app.use(createExpressSecurityMiddleware({ mode: "oidc-bearer", authRequired: true, httpsRequired: false,
    async verifyToken({token}): Promise<AuthContext> {
      if (token !== "fixture-agent" && token !== "fixture-browser")
        throw createSecurityApplicationError("security.invalid-token", "The token is invalid.");
      return {authenticated: true, authMethod: "oidc-bearer", oidcAccessTokenClientId: token,
        principal: {kind: "user", principalId, roles: [], scopes: []}};
    },
  }));
  let retired = false;
  const agent = {};
  let count = 0;
  let generalParser = 0;
  let enabled = true;
  let holdAuthoring = false;
  let wrongRecord = false;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const session = randomUUID();
  const tab = {hostIncarnationId, workspaceId: createWorkspaceId("fixture-workspace"), windowId: randomUUID(), uiIncarnationId: randomUUID()};
  let windowOutcome = tab;
  let windowCalls = 0;
  let windowAvailable = true;
  let deliveryEnabled = false;
  let wrongCommandReceipt = false;
  let wrongRenewedGeneration = false;
  const handlers: ManagedAgentRouteHandlers<typeof agent> = {
    hostIncarnationId,
    identify: ({auth, organization, organizationHeader}) =>
      auth?.oidcAccessTokenClientId === "fixture-agent" && organization?.organizationId === org &&
      organizationHeader === org ? agent : undefined,
    isCurrent: held => held === agent && !retired,
    window: {
      get deliveryEnabled() { return deliveryEnabled; },
      async execute(input, identity, suppliedSession, current) {
        windowCalls += 1;
        assert.equal(identity, agent);
        assert.equal(suppliedSession, session);
        assert.equal(current(), true);
        if (input.operation === "window.present") return {ok: true, value: {kind: "command", duplicate: false,
          receipt: {commandId: wrongCommandReceipt ? randomUUID() : input.input.commandId, sequence: 1, status: "accepted"}}};
        if (input.operation === "window.context") return {ok: true, value: {kind: "context",
          context: {view: "other", ready: true, dirtyNavigationBlocked: false}}};
        if (input.operation === "window.renew") {
          const {leaseId, generation, ...attempt} = input.input.target;
          return {ok: true, value: {kind:"request", request:{target:attempt, agentSessionId:randomUUID(),
            taskId:randomUUID(), status:"active", expiresAt:50_000},
            lease:{...attempt, leaseId, generation:wrongRenewedGeneration ? generation + 1 : generation}}};
        }
        return {ok: true, value: {kind: "windows", windows: [windowOutcome]}};
      },
      canPublish() { return windowAvailable; },
    },
    async read(input) {
      count += 1;
      if (input.operation === "systems.read") {
        if (!wrongRecord) return {ok: false, code: "synthetic-private-driver-detail".repeat(6_000) as "headless.unavailable"};
        return {ok: true, operation: "systems.read", value: {systemId: "fixture.neighbor" as typeof input.input.systemId,
          name: "Private neighboring system", revision: 1, status: "draft"}};
      }
      if (input.operation !== "host.describe") return {ok: false, code: "headless.not-found"};
      return {ok: true, operation: input.operation, value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId, workspaces: [], operations: [],
      }};
    },
    async author(_input, _agent, current) {
      count += 1;
      assert.equal(current(), true);
      if (holdAuthoring) {
        entered.resolve();
        await release.promise;
        assert.equal(current(), false);
      }
      return {ok: true, value: {kind: "committed",
        reference: {systemId: "fixture.system", recordRevision: 1, revisionId: "fixture.revision"}}};
    },
  };
  const retire = registerManagedHeadlessAgentRoutes(app, () => enabled ? handlers : undefined);
  app.use(express.json({verify() {generalParser += 1;}}));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const { port } = address;
    async function send(relative: string, body: object | string, token = "fixture-agent", contentType = "application/json", connection?: string) {
      const response = await fetch(`http://127.0.0.1:${port}${relative}`, { method: "POST",
        headers: {...(token ? {authorization: `Bearer ${token}`} : {}), "x-organization-id": org, "content-type": contentType,
          ...(connection ? {[MANAGED_HEADLESS_AGENT_SESSION_HEADER]: connection} : {})},
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      return {status: response.status, cache: response.headers.get("Cache-Control"), body: await response.json()};
    }
    const {read, author} = MANAGED_HEADLESS_AGENT_PATHS;
    const discovery = {version: HEADLESS_CONTRACT_VERSION, operation: "host.describe", input: {}};
    assert.equal((await send(read, discovery, "")).status, 401);
    assert.equal((await send(read, discovery, "fixture-browser")).status, 403);
    assert.equal((await send(read + "?credential=example", discovery)).status, 400);
    assert.equal((await send(read, discovery, "fixture-agent", "text/plain")).status, 415);
    assert.equal((await send(read, "x".repeat(8_193))).status, 413);
    assert.equal((await send(read, {...discovery, input: {role: "browser"}})).status, 400);
    assert.equal((await send(read, JSON.stringify(discovery, null, 2))).status, 400);
    assert.equal(count, 0);
    enabled = false;
    assert.equal((await send(read, discovery)).status, 404);
    enabled = true;
    const described = await send(read, discovery);
    assert.equal(described.status, 200);
    assert.equal(described.cache, "no-store");
    assert.deepEqual(described.body.value.operations, ["host.describe", "templates.list", "systems.read"]);
    const systemRead = {version: HEADLESS_CONTRACT_VERSION, operation: "systems.read",
      input: {hostIncarnationId, workspaceId: "fixture-workspace", systemId: "fixture.system"}};
    assert.deepEqual((await send(read, systemRead)).body, {ok: false, code: "headless.unavailable"});
    wrongRecord = true;
    assert.deepEqual((await send(read, systemRead)).body, {ok: false, code: "headless.unavailable"});
    assert.equal(generalParser, 0);
    const windowPath = MANAGED_HEADLESS_AGENT_PATHS.window;
    const listTabs = {version: UI_CONTROL_VERSION, operation: "window.list", input: {hostIncarnationId, workspaceId: tab.workspaceId}};
    const invalidContext = {version: UI_CONTROL_VERSION, operation: "window.context", input: {target: {...tab,
      requestId: randomUUID(), attemptId: randomUUID(), leaseId: randomUUID(), generation: 1}}};
    assert.equal((await send(windowPath, listTabs)).status, 400);
    assert.equal((await send(windowPath, listTabs, "fixture-browser", "application/json", session)).status, 403);
    assert.equal((await send(windowPath, invalidContext, "fixture-agent", "application/json", session)).status, 400);
    assert.equal(windowCalls, 0);
    assert.deepEqual((await send(windowPath, listTabs, "fixture-agent", "application/json", session)).body,
      {ok: true, value: {kind: "windows", windows: [tab]}});
    windowOutcome = {...tab, workspaceId: createWorkspaceId("different-workspace")};
    assert.deepEqual((await send(windowPath, listTabs, "fixture-agent", "application/json", session)).body,
      {ok: false, code: "headless.unavailable"});
    deliveryEnabled = true;
    const present = {version: UI_CONTROL_VERSION, operation: "window.present", input: {
      target: invalidContext.input.target, commandId: randomUUID(),
      intent: {action: "open-system", systemId: "fixture.system", revisionId: "revision-1"},
    }};
    assert.equal((await send(windowPath, present, "fixture-agent", "application/json", session)).body.value.receipt.commandId,
      present.input.commandId);
    assert.equal((await send(windowPath, invalidContext, "fixture-agent", "application/json", session)).body.value.context.ready, true);
    const renew = {...invalidContext, operation:"window.renew"};
    const renewed = await send(windowPath, renew, "fixture-agent", "application/json", session);
    assert.equal(renewed.status, 200);
    assert.deepEqual(renewed.body.value.lease, renew.input.target);
    wrongRenewedGeneration = true;
    assert.deepEqual((await send(windowPath, renew, "fixture-agent", "application/json", session)).body,
      {ok:false, code:"headless.unavailable"});
    wrongCommandReceipt = true;
    assert.deepEqual((await send(windowPath, present, "fixture-agent", "application/json", session)).body,
      {ok: false, code: "headless.unavailable"});
    windowAvailable = false;
    assert.deepEqual((await send(windowPath, invalidContext, "fixture-agent", "application/json", session)).body,
      {ok: false, code: "headless.forbidden"});
    assert.deepEqual((await send(windowPath, listTabs, "fixture-agent", "application/json", session)).body,
      {ok: false, code: "headless.forbidden"});
    const request = {version: HEADLESS_CONTRACT_VERSION, operation: "systems.create",
      input: {hostIncarnationId, workspaceId: "fixture-workspace", name: "Synthetic", idempotencyKey: randomUUID(),
        templateId: "reference.secured-data-review@1.0.0"}};
    assert.equal((await send(author, request)).status, 200);
    holdAuthoring = true;
    const pending = send(author, request);
    await entered.promise;
    retired = true;
    release.resolve();
    assert.deepEqual((await pending).body, {ok: false, code: "headless.forbidden"});
    assert.equal(count, 5);
  } finally {
    release.resolve();
    retire();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
