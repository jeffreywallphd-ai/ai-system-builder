import assert from "node:assert/strict";
import { request } from "node:https";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import type { StructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createDesktopPinnedLoopbackAgent } from "../../../../adapters/transport/headless-loopback";
import { composeDesktopHeadlessConnection } from "../composeDesktopHeadlessConnection";

const workspaceId = createWorkspaceId("local-connection-workspace");
const organizationId = createOrganizationId("local-connection-org");
const at = "2026-11-13T00:00:00.000Z";
const hostIncarnationId = "632cfa6b-c323-419a-b2bd-5880b1f34858";
assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));

function call(connector: { endpoint: string; fingerprint: string }, path: "pair" | "read", input: object, credential?: string) {
  const body = JSON.stringify(input);
  return new Promise<{ status: number; result: { value?: { credential?: string; registeredClientId?: string } } }>((resolve, reject) => {
    const req = request(new URL("/aisb-headless/v1/" + path, connector.endpoint), {
      method: "POST", agent: createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint),
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        ...(credential ? { Authorization: "Bearer " + credential } : {}) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8").on("data", (chunk: string) => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, result: JSON.parse(text) }); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(8_000, () => req.destroy(new Error("Fixture response timed out.")));
    req.on("error", reject).end(body);
  });
}

test("starts only on explicit approved workspace pairing or reconnect and closes owned listener", async () => {
  const documents = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  let allowed = true;
  let focused = true;
  let policyReads = 0;
  let loseFocusOn: number | undefined;
  const compose = () => composeDesktopHeadlessConnection({
    documents,
    identity: { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture owner", createdAt: at, updatedAt: at },
    workspaces: { async readWorkspace(id) {
      return id === workspaceId ? { organizationId, workspaceId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at } : undefined;
    } },
    authorization: { async authorizeWorkspaceOperation() {
      if (++policyReads === loseFocusOn) focused = false;
      if (!allowed) throw new Error("Denied");
    } },
    async read(_input, grant) {
      const value = await grant();
      if (!value) return { ok: false, code: "headless.forbidden" };
      return { ok: true, operation: "host.describe", value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId, workspaces: value.workspaceIds, operations: value.operations,
      } };
    },
  });
  const describe = { version: HEADLESS_CONTRACT_VERSION, operation: "host.describe", input: {} };
  const first = compose();
  let restart: ReturnType<typeof compose> | undefined;
  try {
    const before = await first.status();
    assert.ok(before.status === "ready" && !before.running && before.clients.length === 0);
    assert.equal(before.conversationAvailable, undefined);
    const approved = () => focused;
    assert.equal(await first.readWorkspaceLabel(workspaceId, "conversation"), undefined);
    assert.deepEqual(await first.beginPairing(workspaceId, approved, "conversation"), { status: "denied" });
    assert.equal(await first.startExistingClients(approved), "denied");
    assert.deepEqual(await first.beginPairing(createWorkspaceId("outside-fixture"), approved), { status: "denied" });
    loseFocusOn = policyReads + 1;
    assert.deepEqual(await first.beginPairing(workspaceId, approved), { status: "denied" });
    const afterLostFocus = await first.status();
    assert.ok(afterLostFocus.status === "ready" && !afterLostFocus.running);
    focused = true;
    const pairing = await first.beginPairing(workspaceId, approved);
    assert.equal(pairing.status, "ready");
    const reply = await call(pairing, "pair", { pairingCode: pairing.pairingCode });
    assert.equal(reply.status, 200);
    const { credential, registeredClientId } = reply.result.value ?? {};
    assert.ok(credential && registeredClientId);
    await first.close();
    await assert.rejects(call(pairing, "read", describe, credential));

    restart = compose();
    const dormant = await restart.status();
    assert.ok(dormant.status === "ready" && !dormant.running);
    assert.equal(dormant.clients[0]?.registeredClientId, registeredClientId);
    allowed = false;
    assert.equal(await restart.startExistingClients(approved), "denied");
    allowed = true;
    assert.equal(await restart.startExistingClients(approved), "started");
    const started = await restart.status();
    assert.ok(started.status === "ready" && started.running && started.endpoint && started.fingerprint);
    assert.equal((await call({endpoint: started.endpoint, fingerprint: started.fingerprint}, "read", describe, credential)).status, 200);
    assert.equal(await restart.revoke(registeredClientId), true);
    assert.equal((await call({endpoint: started.endpoint, fingerprint: started.fingerprint}, "read", describe, credential)).status, 403);
  } finally {
    await first.close();
    await restart?.close();
  }
});

test("drains a pending desktop management transaction before allowing persistence teardown", { timeout: 10_000 }, async () => {
  const store = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  let enter!: () => void;
  let resume!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  const documents: StructuredDocumentStore = {
    ...store,
    async runInTransaction(work) {
      enter();
      await resumed;
      return store.runInTransaction(work);
    },
  };
  const connection = composeDesktopHeadlessConnection({
    documents,
    identity: { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture owner", createdAt: at, updatedAt: at },
    workspaces: { async readWorkspace() { return undefined; } },
    authorization: { async authorizeWorkspaceOperation() { throw new Error("Not needed for revocation"); } },
    async read() { return { ok: false, code: "headless.forbidden" }; },
  });
  const revoking = connection.revoke("ba775977-1147-47b3-a589-580568e21d11");
  try {
    await entered;
    let closed = false;
    const closing = connection.close().then(() => { closed = true; });
    await Promise.resolve();
    assert.equal(closed, false);
    assert.equal(await connection.revoke("ba775977-1147-47b3-a589-580568e21d11"), false);
    assert.deepEqual(await connection.status(), { status: "unavailable" });
    assert.equal(closed, false);
    resume();
    assert.equal(await revoking, false);
    await closing;
    assert.equal(closed, true);
  } finally {
    resume();
    await connection.close();
  }
});

test("caps admitted management work without queuing extra persistence calls", { timeout: 10_000 }, async () => {
  const store = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  let reads = 0;
  let entered!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  const documents: StructuredDocumentStore = {
    ...store,
    async readDocument(namespace, key) {
      if (++reads === 4) entered();
      await released;
      return store.readDocument(namespace, key);
    },
  };
  const connection = composeDesktopHeadlessConnection({
    documents,
    identity: { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture owner", createdAt: at, updatedAt: at },
    workspaces: { async readWorkspace() { throw new Error("Not needed for status"); } },
    authorization: { async authorizeWorkspaceOperation() { throw new Error("Not needed for status"); } },
    async read() { return { ok: false, code: "headless.forbidden" }; },
  });
  const pending = Array.from({ length: 4 }, () => connection.status());
  try {
    await waiting;
    assert.deepEqual(await connection.status(), { status: "unavailable" });
    assert.equal(await connection.revoke("ba775977-1147-47b3-a589-580568e21d11"), false);
    assert.equal(reads, 4);
    resume();
    const admitted = await Promise.all(pending);
    assert.ok(admitted.every((result) => result.status === "ready"));
  } finally {
    resume();
    await connection.close();
  }
});
