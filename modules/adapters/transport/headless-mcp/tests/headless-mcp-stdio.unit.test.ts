import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, request } from "node:https";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import selfsigned from "selfsigned";
import { createInMemoryStructuredDocumentStore } from "../../../persistence/shared";
import { createDesktopHeadlessClientAuthority } from "../../../security/headless";
import { createDesktopPinnedLoopbackAgent, startDesktopHeadlessLoopback } from "../../headless-loopback";
import { HEADLESS_CONTRACT_VERSION as version, HEADLESS_READ_OPERATIONS, isHeadlessHostIncarnationId, parseHeadlessReadRequest, type HeadlessChangeCursor } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemBuilderSystemId } from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { boundHeadlessMcpStdio } from "../boundHeadlessMcpStdio.mjs";

const workspaceId = createWorkspaceId("mcp-fixture-workspace");
const systemId = normalizeSystemBuilderSystemId("mcp-fixture-system");
const organizationId = createOrganizationId("mcp-fixture-org");
const hostIncarnationId = "d5ed1db7-f069-4c48-bbc4-815697889c5d";
assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
const expectedTools = ["aisb_host_describe", "aisb_list_systems", "aisb_list_templates", "aisb_list_workflows", "aisb_list_workspaces",
  "aisb_prepare_workflow", "aisb_read_conversation_task", "aisb_read_system", "aisb_saved_system_changes", "aisb_saved_system_snapshot"];
const authoringTools = ["aisb_apply_edits", "aisb_clone_system", "aisb_create_system", "aisb_preview_edits", "aisb_rename_system"];
const presentationTools = ["aisb_list_windows", "aisb_present_in_window", "aisb_release_window", "aisb_renew_window",
  "aisb_request_window", "aisb_window_context", "aisb_window_status"];
const entrypoint = path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts");

test("managed stdio binds one verified TLS origin and exact organization and workspace", { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "managed-mcp-"));
  const certificate = await selfsigned.generate([{name: "commonName", value: "127.0.0.1"}], {
    keySize: 2048, extensions: [{name: "subjectAltName", altNames: [{type: 7, ip: "127.0.0.1"}]}],
  });
  const ca = path.join(directory, "synthetic-ca.pem");
  await writeFile(ca, certificate.cert, {flag: "wx"});
  const requests: {url?: string; workspace?: string; organization?: string; authHeader: boolean}[] = [];
  let redirect = false;
  let displacedDiscovery = false;
  let echoCredential = false;
  let echoPrivateWindowSession = false;
  let wrongCommandReceipt = false;
  let repeatedCommand = false;
  let commandApplied = false;
  let delayedSemanticEffects = 0;
  const listener = createServer({key: certificate.private, cert: certificate.cert}, (request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {body += chunk.toString();});
    request.on("end", () => {
      const input = JSON.parse(body);
      requests.push({url: request.url, workspace: input.input.workspaceId, organization: String(request.headers["x-organization-id"]),
        authHeader: request.headers.authorization === "Bearer synthetic-managed-bearer"});
      if (redirect) {
        response.writeHead(307, {Location: "/forbidden-destination", "Content-Length": 0}).end();
        return;
      }
      if (input.operation === "systems.apply-edits") {
        delayedSemanticEffects++;
        const payload = JSON.stringify({ok:true, value:{kind:"committed", reference:{systemId, recordRevision:2,
          revisionId:"revision-2"}}});
        const timer = setTimeout(() => {
          response.writeHead(200, {"Content-Type":"application/json; charset=utf-8", "Content-Length":Buffer.byteLength(payload)}).end(payload);
        }, 5_200);
        response.once("close", () => clearTimeout(timer));
        return;
      }
      if (input.operation === "window.request") {
        const session = request.headers["x-aisb-headless-session"];
        const descriptor = {ok:true, value:{kind:"request", request:{
          target:{...input.input.target, requestId:"0df554b7-1843-4e33-933d-8071e2a4e49f", attemptId:"4924715a-f22f-4c50-9b35-883af79407bb"},
          taskId: input.input.taskId, agentSessionId: echoPrivateWindowSession ? session : "693fe179-d578-47ce-9df3-75378ad1d90d",
          status:"pending", expiresAt:50_000,
        }}};
        const payload = JSON.stringify(descriptor);
        response.writeHead(200, {"Content-Type":"application/json; charset=utf-8", "Content-Length":Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "window.present") {
        const payload = JSON.stringify({ok: true, value: {kind: "command", duplicate: repeatedCommand,
          receipt: {sequence: 1, commandId: wrongCommandReceipt ? randomUUID() : input.input.commandId,
            status: commandApplied ? "applied" : "accepted"}}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      const value = input.operation === "host.describe"
        ? {ok: true, operation: "host.describe", value: {version, hostIncarnationId,
          workspaces: displacedDiscovery ? [workspaceId, "foreign-workspace"] : [],
          operations: displacedDiscovery ? ["host.describe", "workspaces.list"] : ["host.describe", "templates.list", "systems.read"]}}
        : input.operation === "templates.list"
          ? {ok: true, operation: "templates.list", value: [{templateId: "reference.secured-data-review@1.0.0",
            displayName: echoCredential ? "Synthetic synthetic-managed-bearer" : "Synthetic"}]}
        : {ok: true, value: {kind: "committed", reference: {systemId, recordRevision: 1, revisionId: "revision-1"}}};
      const payload = JSON.stringify(value);
      response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
    });
  });
  const clients: Client[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const env = {AISB_HEADLESS_MODE: "managed", AISB_HEADLESS_MANAGED_ORIGIN: `https://127.0.0.1:${address.port}`,
      AISB_HEADLESS_MANAGED_CREDENTIAL: "synthetic-managed-bearer", AISB_HEADLESS_MANAGED_ORGANIZATION_ID: organizationId,
      AISB_HEADLESS_MANAGED_WORKSPACE_ID: workspaceId, AISB_HEADLESS_ENABLE_AUTHORING: "1",
      AISB_HEADLESS_ENABLE_PRESENTATION: "1", AISB_HEADLESS_ENABLE_CONVERSATION: "1", TSX_DISABLE_CACHE: "1"};
    async function connect(overrides: Record<string, string> = {}) {
      const client = new Client({name: "managed-fixture", version: "1.0.0"});
      clients.push(client);
      await client.connect(new StdioClientTransport({command: process.execPath, args: ["--import", "tsx", entrypoint],
        env: {...env, ...overrides}, stderr: "ignore", maxBufferSize: 256 * 1024}));
      return client;
    }
    const client = await connect({NODE_EXTRA_CA_CERTS: ca});
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(),
      ["aisb_host_describe", "aisb_list_templates", "aisb_read_system", ...authoringTools].sort());
    assert.equal(requests.length, 0);
    const discover = async (connection: Client) => resultText(await connection.callTool({name: "aisb_host_describe", arguments: {}}));
    assert.equal((await discover(client)).ok, true);
    const args = {hostIncarnationId, workspaceId, templateId: "reference.secured-data-review@1.0.0",
      idempotencyKey: "a6f56324-2051-462c-b45b-d9b49bf6dd4a", name: "Synthetic"};
    const author = async (input: Record<string, unknown>) => resultText(await client.callTool({name: "aisb_create_system", arguments: input}));
    assert.deepEqual(await author({...args, workspaceId: "foreign-workspace"}), {ok: false, code: "headless.forbidden"});
    assert.equal((await author(args)).ok, true);
    assert.deepEqual(requests, [
      {url: "/api/headless/agent/read", workspace: undefined, organization: organizationId, authHeader: true},
      {url: "/api/headless/agent/author", workspace: workspaceId, organization: organizationId, authHeader: true},
    ]);
    const untrusted = await connect({NODE_TLS_REJECT_UNAUTHORIZED: "0"});
    assert.deepEqual(await discover(untrusted), {ok: false, code: "headless.unavailable"});
    const invalidOrigin = await connect({NODE_EXTRA_CA_CERTS: ca, AISB_HEADLESS_MANAGED_ORIGIN: `${env.AISB_HEADLESS_MANAGED_ORIGIN}/private`});
    assert.deepEqual(await discover(invalidOrigin), {ok: false, code: "headless.unavailable"});
    assert.equal(requests.length, 2);
    displacedDiscovery = true;
    assert.deepEqual(await discover(client), {ok: false, code: "headless.unavailable"});
    displacedDiscovery = false;
    echoCredential = true;
    const echo = resultText(await client.callTool({name: "aisb_list_templates", arguments: {hostIncarnationId, workspaceId}}));
    assert.deepEqual(echo, {ok: false, code: "headless.unavailable"});
    redirect = true;
    assert.deepEqual(await discover(client), {ok: false, code: "headless.unavailable"});
    assert.equal(requests.length, 5);
    assert.ok(requests.slice(2).every(row => row.url === "/api/headless/agent/read"));
    redirect = false;
    const consentClient = await connect({NODE_EXTRA_CA_CERTS: ca, AISB_HEADLESS_ENABLE_MANAGED_CONSENT: "1"});
    const windowArgs = {target:{hostIncarnationId, workspaceId, windowId:"ec6853b7-7693-4173-ab60-255d29af31ab",
      uiIncarnationId:"20484653-3425-4848-b2c9-52dd6b837069"}, taskId:"4514b5f9-ab96-4eb6-81ea-5f50afcfc575", requestKey:"84df8879-dc37-42b0-a3c5-ca5e17339d47"};
    const ask = async () => resultText(await consentClient.callTool({name:"aisb_request_window", arguments:windowArgs}));
    assert.equal((await ask()).ok, true);
    echoPrivateWindowSession = true;
    assert.deepEqual(await ask(), {ok:false, code:"headless.unavailable"});
    const presentationClient = await connect({NODE_EXTRA_CA_CERTS: ca, AISB_HEADLESS_ENABLE_MANAGED_CONSENT: "1",
      AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION: "1"});
    const delivery = {target: {...windowArgs.target, requestId: randomUUID(), attemptId: randomUUID(), leaseId: randomUUID(),
      generation: 1}, commandId: randomUUID(), intent: {action: "open-system", systemId, revisionId: "revision-1"}};
    const present = async (input = delivery) => resultText(await presentationClient.callTool({
      name: "aisb_present_in_window", arguments: input,
    }));
    const callsBeforeDenied = requests.length;
    assert.deepEqual(await present({...delivery, target: {...delivery.target, workspaceId: createWorkspaceId("different-workspace")}}),
      {ok:false, code:"headless.forbidden"});
    assert.equal(requests.length, callsBeforeDenied);
    assert.deepEqual(await present(), {ok:true, value:{kind:"command", receipt:{
      sequence:1, commandId:delivery.commandId, status:"accepted",
    }, duplicate:false}});
    wrongCommandReceipt = true;
    assert.deepEqual(await present(), {ok:false, code:"headless.unavailable"});
    wrongCommandReceipt = false;
    commandApplied = true;
    assert.deepEqual(await present({...delivery, commandId: randomUUID()}), {ok:false, code:"headless.unavailable"});
    repeatedCommand = true;
    assert.deepEqual(await present(), {ok:true, value:{kind:"command", receipt:{
      sequence:1, commandId:delivery.commandId, status:"applied",
    }, duplicate:true}});
    assert.ok(requests.slice(callsBeforeDenied).every(row => row.url === "/api/headless/agent/window"));
    const edit = {hostIncarnationId, workspaceId, systemId, baseRecordRevision:1, baseRevisionId:"revision-1",
      edits:[{kind:"configure", instanceId:"fixture-instance", values:{title:"Synthetic title"}}],
      idempotencyKey:randomUUID(), previewDigest:"f".repeat(64)};
    assert.deepEqual(resultText(await client.callTool({name:"aisb_apply_edits", arguments:edit}, undefined, {timeout:14_000})),
      {ok:true,value:{kind:"committed",reference:{systemId,recordRevision:2,revisionId:"revision-2"}}});
    assert.equal(delayedSemanticEffects,1);
    assert.equal(requests.at(-1)?.url,"/api/headless/agent/author");
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await rm(directory, {recursive: true, force: true});
  }
});

test("the portable reference matches the exact credential-free SDK discovery catalog", { timeout: 45_000 }, async () => {
  const { collectHeadlessMcpToolReference } = await import("../generateHeadlessMcpToolReference.mjs");
  const reference = await collectHeadlessMcpToolReference();
  const saved = await readFile("skills/control-ai-system-builder/references/mcp-tools.json", "utf8");
  assert.equal(JSON.stringify(reference, null, 2) + "\n", saved.replaceAll("\r\n", "\n"));
  const conversation = "aisb_send_approved_turn";
  assert.deepEqual(reference.modes, [
    { mode: "read", tools: expectedTools },
    { mode: "authoring", tools: [...expectedTools, ...authoringTools].sort() },
    { mode: "conversation", tools: [...expectedTools, conversation].sort() },
    { mode: "authoring-and-conversation", tools: [...expectedTools, ...authoringTools, conversation].sort() },
    { mode: "presentation", tools: [...expectedTools, ...presentationTools].sort() },
    { mode: "all", tools: [...expectedTools, ...authoringTools, conversation, ...presentationTools].sort() },
  ]);
  const schemas = new Map(reference.tools.map(({ name, inputSchema }) => [name, inputSchema]));
  const assertExactObject = (name: string, required: string[], optional: string[] = []) => {
    const schema = schemas.get(name);
    assert.ok(schema, name);
    assert.equal(schema.additionalProperties, false, name);
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort(), name);
    assert.deepEqual([...(schema.required ?? [])].sort(), [...required].sort(), name);
    return schema;
  };
  const host = ["hostIncarnationId"];
  const workspace = [...host, "workspaceId"];
  const savedSystem = [...workspace, "systemId"];
  const base = [...savedSystem, "baseRecordRevision", "baseRevisionId"];
  const namedEdit = [...base, "idempotencyKey", "name"];
  assertExactObject("aisb_host_describe", []);
  assertExactObject("aisb_list_workspaces", host);
  for (const name of ["aisb_list_systems", "aisb_list_templates", "aisb_saved_system_snapshot"]) assertExactObject(name, workspace);
  assertExactObject("aisb_read_system", savedSystem);
  assertExactObject("aisb_saved_system_changes", [...workspace, "cursor"]);
  assertExactObject("aisb_list_workflows", [...workspace, "sourceKind"]);
  assertExactObject("aisb_prepare_workflow", [...workspace, "profileId", "source"]);
  assertExactObject("aisb_read_conversation_task", [...workspace, "sessionId", "turnId"]);
  assertExactObject("aisb_create_system", [...workspace, "templateId", "name", "idempotencyKey"]);
  assertExactObject("aisb_rename_system", namedEdit, ["description"]);
  assertExactObject("aisb_clone_system", namedEdit);
  assertExactObject("aisb_preview_edits", [...base, "edits"]);
  assertExactObject("aisb_apply_edits", [...base, "edits", "previewDigest", "idempotencyKey"]);
  const turn = assertExactObject(conversation, [...workspace, "planId", "planRevision", "sessionId", "snapshotRevision", "key", "text"]);
  assert.deepEqual(turn.properties?.text, { type: "string", minLength: 1, maxLength: 2_000 });
  assertExactObject("aisb_list_windows", workspace);
  assertExactObject("aisb_request_window", ["target", "taskId", "requestKey"]);
  assertExactObject("aisb_present_in_window", ["target", "commandId", "intent"]);
  for (const name of ["aisb_window_context", "aisb_window_status", "aisb_release_window", "aisb_renew_window"]) {
    assertExactObject(name, ["target"]);
  }
});

function pair(connector: { endpoint: string; fingerprint: string }, pairingCode: string) {
  return new Promise<string>((resolve, reject) => {
    const body = JSON.stringify({ pairingCode });
    const req = request(new URL("/aisb-headless/v1/pair", connector.endpoint), {
      method: "POST", agent: createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint),
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8").on("data", (chunk: string) => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(text) as { value?: { credential?: string } };
          if (res.statusCode !== 200 || !parsed.value?.credential) throw new Error("Fixture pairing failed.");
          resolve(parsed.value.credential);
        } catch { reject(new Error("Fixture pairing failed.")); }
      });
    });
    req.setTimeout(5_000, () => req.destroy(new Error("Fixture pairing timed out.")));
    req.on("error", reject).end(body);
  });
}

function resultText(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const block = result.content?.[0];
  assert.equal(block?.type, "text");
  if (block?.type !== "text") throw new Error("Expected a text result.");
  return JSON.parse(block.text);
}

test("the opt-in stdio tool requires a separately granted, exact approved turn", { timeout: 25_000 }, async () => {
  const registry = createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity: { organizationId, principalId: "mcp-fixture-user" },
    canReadWorkspace: async (id) => id === workspaceId,
  });
  const host = hostIncarnationId;
  assert.ok(isHeadlessHostIncarnationId(host));
  const active = new Set<string>();
  let calls = 0;
  let withhold = false;
  let invalidResult = false;
  let previousFingerprint: string | undefined;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      completePairing: registry.completePairing,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        if (!grant || !active.has(grant.registeredClientId)) return grant;
        return { ...grant, conversation: true, isCurrent: () => active.has(grant.registeredClientId) && grant.isCurrent() };
      },
    },
    async read() { return { ok: false, code: "headless.unavailable" }; },
    conversation: {
      hostIncarnationId: host,
      async execute(input, authority) {
        calls++;
        assert.equal(input.text, "Synthetic turn");
        assert.ok(!("hostIncarnationId" in input));
        assert.ok(await authority.currentGrant());
        const fingerprint = authority.fingerprint("synthetic fingerprint input");
        assert.match(fingerprint, /^[a-f0-9]{64}$/);
        if (previousFingerprint !== undefined) assert.equal(fingerprint, previousFingerprint);
        previousFingerprint = fingerprint;
        if (withhold) active.delete(authority.grant.registeredClientId);
        return { ok: true, value: { turnId: "fixture-turn", runId: "fixture-run",
          ...(invalidResult ? { diagnostic: "synthetic internal text" } : {}) } };
      },
    },
  });
  const client = new Client({ name: "ai-system-builder-conversation-fixture", version: "1.0.0" });
  try {
    const pending = await registry.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    const credential = await pair(connector, pending.pairingCode);
    const grant = await registry.verifyCredential(credential);
    assert.ok(grant);
    const transport = new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", entrypoint],
      env: { AISB_HEADLESS_ENDPOINT: connector.endpoint, AISB_HEADLESS_FINGERPRINT: connector.fingerprint,
        AISB_HEADLESS_CREDENTIAL: credential, AISB_HEADLESS_ENABLE_CONVERSATION: "1", TSX_DISABLE_CACHE: "1" },
      stderr: "ignore", maxBufferSize: 256 * 1024,
    });
    await client.connect(transport);
    const name = "aisb_send_approved_turn";
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [...expectedTools, name].sort());
    const args = { hostIncarnationId, workspaceId, planId: "fixture-plan", planRevision: "revision-1",
      snapshotRevision: "snapshot-1", sessionId: "fixture-session", key: "a6f56324-2051-462c-b45b-d9b49bf6dd4a", text: "Synthetic turn" };
    const invoke = async (input: Record<string, unknown> = args) => resultText(await client.callTool({ name, arguments: input }));
    const unconfirmed = { ok: false, code: "headless.operation-unconfirmed" };
    assert.deepEqual(await invoke(), unconfirmed);
    active.add(grant.registeredClientId);
    assert.deepEqual(await invoke({ ...args, hostIncarnationId: args.key }), { ok: false, code: "headless.host-changed" });
    assert.deepEqual(await invoke({ ...args, workspaceId: createWorkspaceId("other-workspace") }), unconfirmed);
    const extra = await client.callTool({ name, arguments: { ...args, approvalId: "untrusted" } });
    assert.equal(Boolean(extra.isError), true);
    assert.equal(calls, 0);
    assert.deepEqual(await invoke(), { ok: true, value: { turnId: "fixture-turn", runId: "fixture-run" } });
    invalidResult = true;
    assert.deepEqual(await invoke(), unconfirmed);
    invalidResult = false;
    withhold = true;
    assert.deepEqual(await invoke(), unconfirmed);
    assert.deepEqual(await invoke(), unconfirmed);
    assert.equal(calls, 3);
  } finally {
    await client.close();
    registry.close();
    await connector.close();
  }
});

test("official stdio opt-in lists only finite authoring tools and forwards without retries", { timeout: 20_000 }, async () => {
  const registrations = createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity: { organizationId, principalId: "mcp-fixture-user" },
    canReadWorkspace: async (id) => id === workspaceId,
    canAuthorWorkspace: async (id) => id === workspaceId,
  });
  let calls = 0;
  let unknown = false;
  let revokeAfterDispatch = false;
  if (!isHeadlessHostIncarnationId(hostIncarnationId)) throw new Error("Invalid test host");
  const connector = await startDesktopHeadlessLoopback({
    registrations,
    async read() { return { ok: false, code: "headless.unavailable" }; },
    authoring: {
      hostIncarnationId,
      async execute(input, grant) {
        calls++;
        assert.equal(input.operation, "systems.create");
        if (revokeAfterDispatch) assert.equal(await registrations.revokeClient(grant.registeredClientId), true);
        return unknown ? { ok: false, code: "headless.operation-unconfirmed" }
          : { ok: true, value: { kind: "committed", reference: { systemId, revisionId: "mcp-fixture-system.r1", recordRevision: 1 } } };
      },
    },
  });
  const client = new Client({ name: "ai-system-builder-authoring-fixture", version: "1.0.0" });
  try {
    const pending = await registrations.beginPairing(workspaceId, () => true, "author");
    assert.equal(pending.status, "ready");
    const credential = await pair(connector, pending.pairingCode);
    const transport = new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", entrypoint],
      env: { AISB_HEADLESS_ENDPOINT: connector.endpoint, AISB_HEADLESS_FINGERPRINT: connector.fingerprint,
        AISB_HEADLESS_CREDENTIAL: credential, AISB_HEADLESS_ENABLE_AUTHORING: "1", TSX_DISABLE_CACHE: "1" },
      stderr: "ignore", maxBufferSize: 256 * 1024,
    });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name).sort(), [...expectedTools, ...authoringTools].sort());
    assert.equal(calls, 0);
    const args = { hostIncarnationId, workspaceId, templateId: "reference.secured-data-review@1.0.0",
      name: "Synthetic system", idempotencyKey: "a6f56324-2051-462c-b45b-d9b49bf6dd4a" };
    const invalid = await client.callTool({ name: "aisb_create_system", arguments: { ...args, credential: "unexpected" } });
    assert.equal(Boolean(invalid.isError), true);
    assert.equal(calls, 0);
    const saved = await client.callTool({ name: "aisb_create_system", arguments: args });
    assert.deepEqual(resultText(saved), { ok: true, value: { kind: "committed", reference: { systemId, revisionId: "mcp-fixture-system.r1", recordRevision: 1 } } });
    unknown = true;
    const uncertain = await client.callTool({ name: "aisb_create_system", arguments: args });
    assert.deepEqual(resultText(uncertain), { ok: false, code: "headless.operation-unconfirmed" });
    assert.equal(calls, 2);
    unknown = false;
    revokeAfterDispatch = true;
    const revoked = await client.callTool({ name: "aisb_create_system", arguments: args });
    assert.deepEqual(resultText(revoked), { ok: false, code: "headless.operation-unconfirmed" });
    assert.equal(calls, 3);
  } finally { try { await client.close(); } finally { registrations.close(); await connector.close(); } }
});

test("official stdio client finds finite read tools and uses the already running connector in both protocol eras", { timeout: 20_000 }, async () => {
  const registrations = createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity: { organizationId, principalId: "mcp-fixture-user" },
    canReadWorkspace: async (id) => id === workspaceId,
  });
  let reads = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations,
    async read(input, currentGrant) {
      const grant = await currentGrant();
      if (!grant) return { ok: false, code: "headless.forbidden" };
      reads++;
      const parsed = parseHeadlessReadRequest(input, hostIncarnationId);
      if (!parsed.ok) return parsed;
      if (parsed.request.operation === "host.describe") return {
        ok: true, operation: "host.describe",
        value: { version, hostIncarnationId, workspaces: grant.workspaceIds, operations: grant.operations },
      };
      if (parsed.request.operation === "systems.read") {
        if (!grant.workspaceIds.includes(parsed.request.input.workspaceId)) return { ok: false, code: "headless.forbidden" };
        return { ok: true, operation: "systems.read", value: { systemId, name: "Fixture system", revision: 4, status: "draft" } };
      }
      if (parsed.request.operation === "systems.snapshot") {
        return { ok: true, operation: "systems.snapshot", value: { systems: [],
          cursor: { hostIncarnationId, sequence: 3, scopeTag: "a".repeat(64) } } };
      }
      if (parsed.request.operation === "systems.changes") {
        const { cursor } = parsed.request.input;
        return { ok: true, operation: "systems.changes", value: {
          kind: "changes", events: [{ systemId, recordRevision: 4, revisionId: null, sequence: 4 }],
          cursor: { ...cursor, sequence: 4, scopeTag: "b".repeat(64) }, more: false,
        } };
      }
      if (parsed.request.operation === "conversation-tasks.read") {
        const { sessionId, turnId } = parsed.request.input;
        return { ok: true, operation: "conversation-tasks.read", value: {
          sessionId, turnId, turnStatus: "generating", run: { runId: "run.fixture", status: "running" },
        } };
      }
      return { ok: false, code: "headless.unsupported-operation" };
    },
  });
  try {
    const pending = await registrations.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    const credential = await pair(connector, pending.pairingCode);
    for (const mode of ["legacy", "auto"] as const) {
      const client = new Client({ name: "ai-system-builder-stdio-fixture", version: "1.0.0" }, { versionNegotiation: { mode } });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", entrypoint],
        env: { AISB_HEADLESS_ENDPOINT: connector.endpoint, AISB_HEADLESS_FINGERPRINT: connector.fingerprint, AISB_HEADLESS_CREDENTIAL: credential, TSX_DISABLE_CACHE: "1" },
        stderr: "ignore",
        maxBufferSize: 256 * 1024,
      });
      try {
        const prior = reads;
        await client.connect(transport);
        const listed = await client.listTools();
        assert.deepEqual(listed.tools.map(({ name }) => name).sort(), expectedTools);
        assert.equal(reads, prior);
        const negotiated = client.getNegotiatedProtocolVersion();
        assert.equal(negotiated, mode === "auto" ? "2026-07-28" : "2025-11-25");
        const described = await client.callTool({ name: "aisb_host_describe", arguments: {} });
        assert.equal(Boolean(described.isError), false);
        assert.deepEqual(resultText(described), {
          ok: true, operation: "host.describe", value: { version, hostIncarnationId, workspaces: [workspaceId],
            operations: HEADLESS_READ_OPERATIONS },
        });
        const read = await client.callTool({ name: "aisb_read_system", arguments: { hostIncarnationId, workspaceId, systemId } });
        assert.deepEqual(resultText(read), { ok: true, operation: "systems.read", value: { systemId, name: "Fixture system", revision: 4, status: "draft" } });
        const cursor: HeadlessChangeCursor = { hostIncarnationId, sequence: 3, scopeTag: "a".repeat(64) };
        const snapshot = await client.callTool({ name: "aisb_saved_system_snapshot", arguments: { hostIncarnationId, workspaceId } });
        assert.deepEqual(resultText(snapshot), { ok: true, operation: "systems.snapshot", value: { systems: [], cursor } });
        const changes = await client.callTool({ name: "aisb_saved_system_changes", arguments: { hostIncarnationId, workspaceId, cursor } });
        assert.deepEqual(resultText(changes), { ok: true, operation: "systems.changes", value: {
          kind: "changes", events: [{ systemId, recordRevision: 4, revisionId: null, sequence: 4 }],
          cursor: { ...cursor, sequence: 4, scopeTag: "b".repeat(64) }, more: false,
        } });
        const task = await client.callTool({ name: "aisb_read_conversation_task", arguments: {
          hostIncarnationId, workspaceId, sessionId: "session.fixture", turnId: "turn.fixture",
        } });
        assert.deepEqual(resultText(task), { ok: true, operation: "conversation-tasks.read", value: {
          sessionId: "session.fixture", turnId: "turn.fixture", turnStatus: "generating", run: { runId: "run.fixture", status: "running" },
        } });
        const invalid = await client.callTool({ name: "aisb_read_system", arguments: {
          hostIncarnationId, workspaceId, systemId, endpoint: "http://other.invalid",
        } });
        assert.equal(invalid.isError, true);
        assert.equal(reads, prior + 5);
      } finally {
        await client.close();
      }
    }
  } finally {
    registrations.close();
    await connector.close();
  }
});

test("a replacement peer at the configured address receives no HTTP request or credential", { timeout: 10_000 }, async () => {
  const certificate = await selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], { keySize: 2048 });
  let applicationRequests = 0;
  let connected = 0;
  const replacement = createServer({ cert: certificate.cert, key: certificate.private, minVersion: "TLSv1.3" }, (_req, res) => {
    applicationRequests++;
    res.writeHead(500).end();
  });
  replacement.on("connection", () => { connected++; });
  await new Promise<void>((resolve, reject) => {
    replacement.once("error", reject);
    replacement.listen(0, "127.0.0.1", resolve);
  });
  const address = replacement.address();
  assert.ok(address && typeof address !== "string");
  const client = new Client({ name: "peer-verification-fixture", version: "1.0.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", entrypoint], stderr: "ignore",
      env: {
        AISB_HEADLESS_ENDPOINT: `https://127.0.0.1:${address.port}`,
        AISB_HEADLESS_FINGERPRINT: "0".repeat(64),
        AISB_HEADLESS_CREDENTIAL: "a".repeat(43),
        TSX_DISABLE_CACHE: "1",
      },
    }));
    const reply = await client.callTool({ name: "aisb_host_describe", arguments: {} });
    assert.deepEqual(resultText(reply), { ok: false, code: "headless.unavailable" });
    assert.equal(reply.isError, true);
    assert.equal(applicationRequests, 0);
    // Ensure the replacement was reachable; the denial was not a refused TCP connection.
    assert.ok(connected > 0);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => {
      replacement.close((error) => error ? reject(error) : resolve());
      replacement.closeAllConnections();
    });
  }
});

test("stdio closes before a non-reading client can queue unbounded output", async () => {
  const stdin = new PassThrough();
  let release: (() => void) | undefined;
  const stdout = new Writable({ highWaterMark: 16, write(_chunk, _encoding, done) { release = done; } });
  let limits = 0;
  const transport = boundHeadlessMcpStdio(stdin, stdout, () => {
    limits++;
    stdout.destroy(new Error("Fixture stopped."));
  });
  await transport.start();
  try {
    const pending = Array.from({ length: 5 }, (_, index) => transport.send({
      jsonrpc: "2.0", id: index, result: { value: "x".repeat(100) },
    }));
    await assert.rejects(pending[4]!);
    assert.equal(limits, 1);
    assert.ok(stdout.writableLength <= 4 * 200);
    release?.();
    await Promise.allSettled(pending);
  } finally {
    stdin.destroy();
    stdout.destroy();
    await transport.close();
  }
});

test("stdio admits only eight unanswered requests from one client", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let limits = 0;
  let accepted = 0;
  const transport = boundHeadlessMcpStdio(stdin, stdout, () => { limits++; });
  transport.onmessage = () => { accepted++; };
  try {
    await transport.start();
    stdin.write(Array.from({ length: 10 }, (_, id) => JSON.stringify({ jsonrpc: "2.0", id, method: "ping" })).join("\n") + "\n");
    assert.equal(accepted, 8);
    assert.equal(limits, 1);
  } finally {
    await transport.close();
    stdin.destroy();
    stdout.destroy();
  }
});

test("does not queue no-ID traffic while the SDK pump has not retired an admitted request", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const accepted: string[] = [];
  const transport = boundHeadlessMcpStdio(stdin, stdout, () => assert.fail("Finite traffic unexpectedly closed."));
  transport.onmessage = (message) => { accepted.push("method" in message ? message.method : "response"); };
  const write = (message: object) => stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  try {
    await transport.start();
    write({ id: 1, method: "ping" });
    for (let i = 0; i < 20; i++) {
      write({ method: "notifications/initialized" });
      write({ method: "notifications/cancelled", params: { requestId: 1 } });
      write({ method: "notifications/cancelled", params: { requestId: i + 10 } });
      write({ method: "unknown.notify" });
      write({ id: i + 10, result: {} });
    }
    assert.deepEqual(accepted, ["ping", "notifications/initialized", "notifications/cancelled"]);
  } finally {
    await transport.close();
    stdin.destroy();
    stdout.destroy();
  }
});
