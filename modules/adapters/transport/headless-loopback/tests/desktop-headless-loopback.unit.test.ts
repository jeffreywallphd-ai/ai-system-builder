import assert from "node:assert/strict";
import { request } from "node:https";
import { connect } from "node:net";
import { test } from "node:test";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createInMemoryStructuredDocumentStore } from "../../../persistence/shared";
import { createDesktopHeadlessClientAuthority } from "../../../security/headless";
import { createDesktopPinnedLoopbackAgent, startDesktopHeadlessLoopback } from "../index";

const workspaceId = createWorkspaceId("loopback-fixture-workspace");
const organizationId = createOrganizationId("loopback-fixture-org");
const identity = { organizationId, principalId: "loopback-fixture-user" };
const incarnation = "f06f4016-f0ee-43fa-808f-09f815df8d6b";
assert.ok(isHeadlessHostIncarnationId(incarnation));
const describe = JSON.stringify({ version: HEADLESS_CONTRACT_VERSION, operation: "host.describe", input: {} });
const readPath = "/aisb-headless/v1/read";
const pairPath = "/aisb-headless/v1/pair";
const authorPath = "/aisb-headless/v1/author";

function post(connector: { endpoint: string; fingerprint: string }, path: string, body: string, headers: Record<string, string> = {}) {
  return new Promise<{
    status: number;
    cacheControl?: string;
    json: { ok: boolean; code?: string; value?: { credential?: string; registeredClientId?: string } };
  }>((resolve, reject) => {
    const req = request(new URL(path, connector.endpoint), {
      method: "POST",
      headers: { "Content-Length": String(Buffer.byteLength(body)), "Content-Type": "application/json", ...headers },
      agent: createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint),
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (part: string) => { text += part; });
      res.on("error", reject);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, cacheControl: res.headers["cache-control"], json: JSON.parse(text) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(8_000, () => req.destroy(new Error("Fixture response timed out.")));
    req.on("error", reject);
    req.end(body);
  });
}

function registrations() {
  return createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity,
    canReadWorkspace: async (id) => id === workspaceId,
  });
}

test("the optional pinned authoring route accepts only a current scoped writer and emits a finite result", async () => {
  const registry = registrations();
  const code = await registry.beginPairing(workspaceId);
  assert.equal(code.status, "ready");
  const pairing = await registry.completePairing(code.pairingCode);
  assert.equal(pairing.status, "paired");
  let enabled = false;
  let fenced = false;
  let dispatches = 0;
  let revokeInHandler = false;
  let unexpectedOutput = false;
  let loseFence = false;
  let omitFenceAfterDispatch = false;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      completePairing: registry.completePairing,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        if (!grant) return undefined;
        return {
          ...grant, authoring: enabled ? ["systems.create"] as const : [],
          ...(loseFence ? {} : { isCurrent: () => !fenced }),
        };
      },
    },
    async read() { return { ok: false, code: "headless.unavailable" }; },
    authoring: {
      hostIncarnationId: incarnation,
      async execute(request, _grant, currentGrant) {
        dispatches++;
        assert.ok(await currentGrant());
        assert.equal(request.operation, "systems.create");
        if (revokeInHandler) fenced = true;
        if (omitFenceAfterDispatch) loseFence = true;
        return { ok: true, value: { kind: "committed", reference: {
          systemId: "fixture-system", revisionId: "fixture-system.r1", recordRevision: 1,
          ...(unexpectedOutput ? { internalField: "fixture diagnostic" } : {}),
        } } };
      },
    },
  });
  const body = {
    version: HEADLESS_CONTRACT_VERSION, operation: "systems.create",
    input: {
      hostIncarnationId: incarnation, workspaceId, name: "Fixture", templateId: "reference.secured-data-review@1.0.0",
      idempotencyKey: "a6f56324-2051-462c-b45b-d9b49bf6dd4a",
    },
  };
  const headers = { Authorization: "Bearer " + pairing.credential };
  try {
    assert.equal((await post(connector, authorPath, JSON.stringify(body), headers)).status, 403);
    enabled = true;
    assert.equal((await post(connector, authorPath, JSON.stringify({ ...body, operation: "systems.archive" }), headers)).status, 400);
    assert.equal((await post(connector, authorPath, JSON.stringify({ ...body, input: { ...body.input,
      workspaceId: "other-fixture-workspace" } }), headers)).status, 403);
    assert.equal(dispatches, 0);
    assert.deepEqual((await post(connector, authorPath, JSON.stringify(body), headers)).json, {
      ok: true, value: { kind: "committed", reference: { systemId: "fixture-system", revisionId: "fixture-system.r1", recordRevision: 1 } },
    });
    unexpectedOutput = true;
    assert.deepEqual((await post(connector, authorPath, JSON.stringify(body), headers)).json, { ok: false, code: "headless.unavailable" });
    unexpectedOutput = false;
    omitFenceAfterDispatch = true;
    assert.deepEqual((await post(connector, authorPath, JSON.stringify(body), headers)).json, { ok: false, code: "headless.forbidden" });
    omitFenceAfterDispatch = false;
    loseFence = false;
    revokeInHandler = true;
    assert.deepEqual((await post(connector, authorPath, JSON.stringify(body), headers)).json, { ok: false, code: "headless.forbidden" });
    assert.equal(dispatches, 4);
  } finally { registry.close(); await connector.close(); }
});

test("the read response is withheld when the final grant fence closes after verification", async () => {
  const registry = registrations();
  const code = await registry.beginPairing(workspaceId);
  assert.equal(code.status, "ready");
  const pairing = await registry.completePairing(code.pairingCode);
  assert.equal(pairing.status, "paired");
  let verifies = 0;
  let checks = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      completePairing: registry.completePairing,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        const ordinal = ++verifies;
        return grant && { ...grant, isCurrent: () => ordinal === 1 || ++checks === 1 };
      },
    },
    async read() { return { ok: false, code: "headless.unavailable" }; },
  });
  try {
    const headers = { Authorization: "Bearer " + pairing.credential };
    assert.equal((await post(connector, authorPath, describe, headers)).status, 404);
    assert.deepEqual((await post(connector, readPath, describe, headers)).json, { ok: false, code: "headless.forbidden" });
    assert.equal(verifies, 2);
    assert.equal(checks, 2);
  } finally { registry.close(); await connector.close(); }
});

test("binds to literal loopback, pairs once and checks the bearer before read dispatch", async () => {
  const registry = registrations();
  let reads = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read(_body, currentGrant) {
      const grant = await currentGrant();
      assert.ok(grant);
      reads++;
      return { ok: true, operation: "host.describe", value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId: incarnation,
        workspaces: grant.workspaceIds, operations: grant.operations,
      } };
    },
  });
  try {
    const { endpoint } = connector;
    assert.equal(new URL(endpoint).hostname, "127.0.0.1");
    const missing = await post(connector, readPath, describe);
    assert.equal(missing.status, 403);
    assert.equal(missing.json.code, "headless.forbidden");
    assert.equal(reads, 0);
    const pending = await registry.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    const pairingBody = JSON.stringify({ pairingCode: pending.pairingCode });
    const paired = await post(connector, pairPath, pairingBody);
    assert.equal(paired.status, 200);
    assert.equal(paired.cacheControl, "no-store");
    const credential = paired.json.value?.credential;
    const clientId = paired.json.value?.registeredClientId;
    assert.ok(credential && clientId);
    assert.equal((await post(connector, pairPath, pairingBody)).status, 403);
    const auth = { Authorization: `Bearer ${credential}` };
    const actual = await post(connector, readPath, describe, auth);
    assert.equal(actual.status, 200);
    assert.equal(actual.cacheControl, "no-store");
    assert.equal(reads, 1);
    assert.equal(await registry.revokeClient(clientId), true);
    assert.equal((await post(connector, readPath, describe, auth)).status, 403);
    assert.equal(reads, 1);
  } finally {
    await connector.close();
  }
  await assert.rejects(post(connector, readPath, describe));
});

test("rejects foreign host and origin, unknown paths and malformed or oversized JSON before dispatch", async () => {
  const registry = registrations();
  let reads = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read() { reads++; return { ok: false, code: "headless.unavailable" }; },
  });
  try {
    const pending = await registry.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    const paired = await registry.completePairing(pending.pairingCode);
    assert.equal(paired.status, "paired");
    const auth = { Authorization: `Bearer ${paired.credential}` };
    const { endpoint } = connector;
    const rejectedHeaders: ReadonlyArray<Record<string, string>> = [
      { Host: "other.invalid" },
      { Origin: endpoint },
      { Origin: "null" },
      { "X-Forwarded-Host": new URL(endpoint).host },
    ];
    for (const headers of rejectedHeaders) {
      const result = await post(connector, readPath, describe, { ...auth, ...headers });
      assert.equal(result.status, 403);
      assert.equal(result.json.code, "headless.forbidden");
    }
    assert.equal((await post(connector, readPath + "?extra=1", describe, auth)).status, 404);
    assert.equal((await post(connector, "/aisb-headless/v1/READ", describe, auth)).status, 404);
    for (const body of ["not json", " " + describe, '{"operation":"first","operation":"second"}', "\uFEFF" + describe]) {
      assert.equal((await post(connector, readPath, body, auth)).status, 400);
    }
    assert.equal((await post(connector, readPath, "x".repeat(8193), auth)).status, 413);
    assert.equal((await post(connector, readPath, describe, { ...auth, "Content-Encoding": "gzip" })).status, 400);
    assert.equal(reads, 0);
  } finally {
    await connector.close();
  }
});

test("stops admission and drains in-flight work before reporting closed", { timeout: 10_000 }, async () => {
  const registry = registrations();
  const pending = await registry.beginPairing(workspaceId);
  assert.equal(pending.status, "ready");
  const paired = await registry.completePairing(pending.pairingCode);
  assert.equal(paired.status, "paired");
  let entered!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read(_body, currentGrant) {
      assert.ok(await currentGrant());
      entered();
      await released;
      assert.equal(await currentGrant(), undefined);
      return { ok: false, code: "headless.forbidden" };
    },
  });
  const result = post(connector, readPath, describe, { Authorization: `Bearer ${paired.credential}` })
    .then(() => "response", () => "closed");
  try {
    await waiting;
    let settled = false;
    const closing = connector.close().then(() => { settled = true; });
    assert.equal(await result, "closed");
    assert.equal(settled, false);
    resume();
    await closing;
    assert.equal(settled, true);
  } finally {
    resume();
    await connector.close();
  }
});

test("does not return a read admitted before an exact client revocation", { timeout: 10_000 }, async () => {
  const registry = registrations();
  const pending = await registry.beginPairing(workspaceId);
  assert.equal(pending.status, "ready");
  const paired = await registry.completePairing(pending.pairingCode);
  assert.equal(paired.status, "paired");
  let entered!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read(_body, currentGrant) {
      const captured = await currentGrant();
      assert.ok(captured);
      entered();
      await released;
      return { ok: true, operation: "host.describe", value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId: incarnation,
        workspaces: captured.workspaceIds, operations: captured.operations,
      } };
    },
  });
  const result = post(connector, readPath, describe, { Authorization: `Bearer ${paired.credential}` });
  try {
    await waiting;
    assert.equal(await registry.revokeClient(paired.registeredClientId), true);
    resume();
    const reply = await result;
    assert.equal(reply.status, 403);
    assert.deepEqual(reply.json, { ok: false, code: "headless.forbidden" });
  } finally {
    resume();
    await connector.close();
    await result.catch(() => {});
  }
});

test("never passes a mid-request scope expansion to the read provider", async () => {
  const registry = registrations();
  const pending = await registry.beginPairing(workspaceId);
  assert.equal(pending.status, "ready");
  const paired = await registry.completePairing(pending.pairingCode);
  assert.equal(paired.status, "paired");
  let checks = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      ...registry,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        if (++checks === 2 || !grant) return grant;
        return { ...grant, operations: ["host.describe"] as const };
      },
    },
    async read(_body, currentGrant) {
      const admitted = await currentGrant();
      return admitted ? { ok: true, operation: "host.describe", value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId: incarnation,
        workspaces: admitted.workspaceIds, operations: admitted.operations,
      } } : { ok: false, code: "headless.forbidden" };
    },
  });
  try {
    const result = await post(connector, readPath, describe, { Authorization: `Bearer ${paired.credential}` });
    assert.equal(checks, 3);
    assert.equal(result.status, 403);
    assert.deepEqual(result.json, { ok: false, code: "headless.forbidden" });
  } finally {
    await connector.close();
  }
});

test("closing the connector terminates owned TCP sockets still waiting for TLS", { timeout: 3_000 }, async () => {
  const connector = await startDesktopHeadlessLoopback({
    registrations: registrations(),
    async read() { throw new Error("Unexpected read before TLS."); },
  });
  const socket = connect({ host: "127.0.0.1", port: Number(new URL(connector.endpoint).port) });
  const connected = new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const closed = new Promise<void>((resolve) => { socket.once("close", () => resolve()); });
  try {
    await connected;
    await connector.close();
    await closed;
    assert.ok(socket.destroyed);
  } finally {
    socket.destroy();
    await connector.close();
  }
});
