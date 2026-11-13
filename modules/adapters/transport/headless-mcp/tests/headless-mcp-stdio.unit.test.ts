import assert from "node:assert/strict";
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
import { HEADLESS_CONTRACT_VERSION as version, HEADLESS_READ_OPERATIONS, isHeadlessHostIncarnationId, parseHeadlessReadRequest } from "../../../../contracts/headless";
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
const entrypoint = path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts");

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
        const cursor = { hostIncarnationId, sequence: 3, scopeTag: "a".repeat(64) };
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
