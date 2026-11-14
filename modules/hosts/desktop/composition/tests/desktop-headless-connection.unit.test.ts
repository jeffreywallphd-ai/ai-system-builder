import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:https";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import type { StructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { HEADLESS_CONTRACT_VERSION, UI_CONTROL_VERSION, isHeadlessHostIncarnationId, readHeadlessWindowResult } from "../../../../contracts/headless";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createDesktopPinnedLoopbackAgent } from "../../../../adapters/transport/headless-loopback";
import { composeDesktopHeadlessConnection } from "../composeDesktopHeadlessConnection";
import { composeDesktopUiControl } from "../composeDesktopUiControl";

const workspaceId = createWorkspaceId("local-connection-workspace");
const organizationId = createOrganizationId("local-connection-org");
const at = "2026-11-13T00:00:00.000Z";
const hostIncarnationId = "632cfa6b-c323-419a-b2bd-5880b1f34858";
assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));

function call(connector: { endpoint: string; fingerprint: string }, path: "pair" | "read" | "window", input: object, credential?: string) {
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

test("pinned paired agents can request and present only with an exact interactive lease", async () => {
  const platform = createInMemoryStructuredDocumentStore();
  const documents = platform.forOrganization(organizationId);
  const identity = { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture", createdAt: at, updatedAt: at };
  const repositories = createStructuredOrganizationRepositories(platform);
  const workspace = { organizationId, workspaceId, displayName: "Fixture", status: "active" as const, createdAt: at, updatedAt: at };
  await repositories.organizations.saveOrganization({ ...workspace });
  await repositories.memberships.saveMembership({ organizationId, principalId: identity.principalId,
    role: "owner", status: "active", createdAt: at, updatedAt: at });
  const workspaces = createLocalWorkspaceRepository({ documents, rootDirectory: "." });
  await workspaces.saveWorkspace(workspace);
  let now = 100;
  let available = true;
  let beforePublish: (() => Promise<void>) | undefined;
  const control = composeDesktopUiControl({ identity, hostIncarnationId, rootDirectory: ".", documents: platform, isOpen: () => true, now: () => now,
    async canPresent(scope, intent) {
      return available && scope === workspaceId && intent.action === "open-system" && intent.systemId === "system-a" && intent.revisionId === "revision-a"
        ? { title: "Fixture resource" } : undefined;
    },
  });
  const connector = composeDesktopHeadlessConnection({ documents, identity, workspaces, presentation: {
    ...control, async authorizePublication(...args) {
      await beforePublish?.();
      return control.authorizePublication(...args);
    },
  },
    authorization: { async authorizeWorkspaceOperation() {} },
    async read() { return { ok: false, code: "headless.forbidden" }; },
  });
  try {
    const window = { hostIncarnationId, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID() };
    const owner = { ...identity, isCurrent: () => true };
    assert.equal(control.authority.registerWindow(window, owner), true);
    const first = await connector.beginPairing(workspaceId, () => true, "presentation");
    assert.equal(first.status, "ready");
    const firstPaired = await call(first, "pair", { pairingCode: first.pairingCode });
    const credential = firstPaired.result.value?.credential;
    assert.ok(credential);
    const second = await connector.beginPairing(workspaceId, () => true);
    assert.equal(second.status, "ready");
    const other = (await call(second, "pair", { pairingCode: second.pairingCode })).result.value?.credential;
    assert.ok(other);
    const third = await connector.beginPairing(workspaceId, () => true, "presentation");
    assert.equal(third.status, "ready");
    const { credential: peer, registeredClientId: peerId } = (await call(third, "pair", { pairingCode: third.pairingCode })).result.value ?? {};
    assert.ok(peer && peerId);
    const dispatch = async (operation: string, input: object, selected = credential) => {
      const reply = await call(first, "window", { version: UI_CONTROL_VERSION, operation, input }, selected);
      return { status: reply.status, body: readHeadlessWindowResult(reply.result) };
    };
    assert.deepEqual((await dispatch("window.list", { hostIncarnationId, workspaceId })).body,
      { ok: true, value: { kind: "windows", windows: [window] } });
    assert.equal((await dispatch("window.list", { hostIncarnationId, workspaceId }, other)).status, 403);
    assert.equal((await dispatch("window.list", { hostIncarnationId, workspaceId: "other-workspace" })).status, 403);
    const prompt = { target: window, taskId: randomUUID(), requestKey: randomUUID() };
    assert.equal((await dispatch("window.request", { ...prompt, agentSessionId: randomUUID() })).status, 400);
    const request = (await dispatch("window.request", prompt)).body;
    assert.ok(request.ok && request.value.kind === "request" && request.value.request.status === "pending");
    const attempt = request.value.request.target;
    assert.equal(request.value.request.agentSessionId, firstPaired.result.value?.registeredClientId);
    assert.equal((await dispatch("window.accept", { target: attempt })).status, 400);
    assert.equal((await dispatch("window.status", { target: attempt }, peer)).status, 403);
    const accepted = await control.authority.accept(attempt, owner);
    assert.ok(accepted.status === "ok");
    const target = accepted.value.target;
    const commandId = randomUUID();
    const intent = { action: "open-system", systemId: "system-a", revisionId: "revision-a" };
    assert.equal((await dispatch("window.present", { target, commandId, intent })).status, 403);
    assert.equal((await control.authority.ready(target, owner)).status, "ok");
    const live = (await dispatch("window.status", { target: attempt })).body;
    assert.ok(live.ok && live.value.kind === "request" && live.value.lease?.leaseId === target.leaseId);
    assert.equal((await dispatch("window.present", { target, commandId, intent }, peer)).status, 403);
    assert.equal((await dispatch("window.present", { target, commandId, intent: { ...intent, systemId: "wrong" } })).status, 403);
    assert.equal((await dispatch("window.present", { target, commandId, intent })).status, 200);
    const queue = control.readDelivery(target);
    assert.equal(queue?.next(target, 1).status, "delivered");
    assert.equal(queue?.acknowledge(target, 1, commandId, "applied")?.status, "applied");
    assert.equal((await dispatch("window.present", { target, commandId, intent: { ...intent, revisionId: "revision-b" } })).status, 409);
    const context = { view: "other", ready: true, dirtyNavigationBlocked: false } as const;
    async function waitForChallenge() {
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5));
        const value = control.contextChallenge(target);
        if (value) return value;
      }
      assert.fail("Expected a current context challenge.");
    }
    const readingContext = dispatch("window.context", { target });
    const challenge = await waitForChallenge();
    assert.equal(control.publishContext(target, owner, context, randomUUID()), false);
    assert.equal(control.publishContext(target, owner, context, challenge), true);
    assert.equal(control.publishContext(target, owner, context, challenge), false);
    assert.deepEqual((await readingContext).body, { ok: true, value: { kind: "context", context } });
    const held = dispatch("window.context", { target });
    const heldChallenge = await waitForChallenge();
    beforePublish = async () => { now += 750; };
    assert.equal(control.publishContext(target, owner, context, heldChallenge), true);
    assert.equal((await held).status, 403);
    beforePublish = undefined;
    assert.equal((await dispatch("window.context", { target })).status, 503);
    assert.deepEqual((await dispatch("window.present", { target, commandId, intent })).body,
      { ok: true, value: { kind: "command", duplicate: true, receipt: { sequence: 1, commandId, status: "applied" } } });
    beforePublish = async () => { available = false; };
    assert.equal((await dispatch("window.present", { target, commandId, intent })).status, 403);
    beforePublish = undefined;
    available = true;
    assert.equal(await connector.revoke(peerId), true);
    assert.ok((await dispatch("window.status", { target: attempt })).body.ok);
    assert.equal(control.authority.revoke(target, owner).status, "ok");
    assert.equal((await dispatch("window.context", { target })).status, 403);
    assert.deepEqual(await dispatch("window.renew", { target }), { status: 200, body: { ok: true, value: { kind: "ended" } } });
    assert.equal(queue?.next(target, 1).status, "denied");
    const pendingPairing = await connector.beginPairing(workspaceId, () => true, "presentation");
    assert.equal(pendingPairing.status, "ready");
    connector.stopPresentationAdmission();
    control.close();
    const availability = await connector.status();
    assert.equal(availability.status === "ready" && availability.presentationAvailable, undefined);
    assert.equal((await connector.beginPairing(workspaceId, () => true, "presentation")).status, "denied");
    assert.equal((await call(pendingPairing, "pair", { pairingCode: pendingPairing.pairingCode })).status, 403);
    assert.equal((await dispatch("window.list", { hostIncarnationId, workspaceId })).status, 403);
    assert.equal((await connector.beginPairing(workspaceId, () => true, "read")).status, "ready");
  } finally { await connector.close(); }
});

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
