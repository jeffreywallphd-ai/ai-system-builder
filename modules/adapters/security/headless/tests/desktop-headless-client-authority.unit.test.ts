import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../../persistence/shared";
import type { StructuredDocumentStore } from "../../../persistence/shared";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../persistence/sqlite";
import { createDesktopHeadlessClientAuthority } from "../index";

const workspaceId = createWorkspaceId("paired-fixture-workspace");
const identity = { organizationId: createOrganizationId("paired-fixture-org"), principalId: "paired-fixture-principal" };
const otherIdentity = { ...identity, principalId: "other-fixture-principal" };
const storeNamespace = "headless-client-authority";
const denied = { status: "denied" };

function fixture() {
  const documents = createInMemoryStructuredDocumentStore().forOrganization(identity.organizationId);
  let currentTime = Date.parse("2026-11-13T00:00:00.000Z");
  let allow = true;
  const dependencies = {
    documents, identity, now: () => currentTime,
    canReadWorkspace: async (target: string) => allow && target === workspaceId,
  };
  return {
    authority: createDesktopHeadlessClientAuthority(dependencies), documents, dependencies,
    advance(ms: number) { currentTime += ms; },
    denyWorkspace() { allow = false; },
  };
}

test("requires current workspace authority, bounds guesses, and consumes the exact code once", async () => {
  const { authority } = fixture();
  assert.deepEqual(await authority.beginPairing(createWorkspaceId("ungranted-fixture")), denied);
  const first = await authority.beginPairing(workspaceId);
  assert.equal(first.status, "ready");
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await authority.completePairing("bad-fixture-code"), denied);
  }
  assert.deepEqual(await authority.completePairing(first.pairingCode), denied);
  const next = await authority.beginPairing(workspaceId);
  assert.equal(next.status, "ready");
  const both = await Promise.all([
    authority.completePairing(next.pairingCode),
    authority.completePairing(next.pairingCode),
  ]);
  assert.deepEqual(both.map(({ status }) => status), ["paired", "denied"]);
  assert.deepEqual(await authority.completePairing(next.pairingCode), denied);
});

test("expires codes and credentials and refuses access lost before pairing is completed", async () => {
  const { authority, advance, denyWorkspace } = fixture();
  const first = await authority.beginPairing(workspaceId);
  assert.equal(first.status, "ready");
  advance(120_000);
  assert.deepEqual(await authority.completePairing(first.pairingCode), denied);
  const second = await authority.beginPairing(workspaceId);
  assert.equal(second.status, "ready");
  const registered = await authority.completePairing(second.pairingCode);
  assert.equal(registered.status, "paired");
  assert.ok(await authority.verifyCredential(registered.credential));
  advance(7 * 24 * 60 * 60 * 1000);
  assert.equal(await authority.verifyCredential(registered.credential), undefined);
  assert.deepEqual(await authority.listClients(), { status: "ready", clients: [] });
  const third = await authority.beginPairing(workspaceId);
  assert.equal(third.status, "ready");
  denyWorkspace();
  assert.deepEqual(await authority.completePairing(third.pairingCode), denied);
});

test("a scoped client ID and revocation survive reopening the real local SQLite store", async () => {
  const parent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(path.join(parent, "desktop-headless-registry-")));
  const policy = resolveLocalSqliteDatabasePolicy({ dataRootDirectory: root });
  let database: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  try {
    database = await openLocalSqliteDatabase({ policy });
    const documents = database.documents.forOrganization(identity.organizationId);
    const authority = createDesktopHeadlessClientAuthority({
      documents, identity, canReadWorkspace: async () => true,
    });
    const pending = await authority.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    const paired = await authority.completePairing(pending.pairingCode);
    assert.equal(paired.status, "paired");
    const persisted = await documents.listDocuments(storeNamespace);
    assert.equal(persisted.length, 1);
    const serialized = JSON.stringify(persisted);
    assert.ok(!serialized.includes(paired.credential) && !serialized.includes(pending.pairingCode));
    assert.deepEqual(await authority.listClients(), { status: "ready", clients: [
      { registeredClientId: paired.registeredClientId, workspaceId, expiresAt: paired.expiresAt },
    ] });
    authority.close();
    assert.equal(await authority.verifyCredential(paired.credential), undefined);
    await database.close();
    database = undefined;
    database = await openLocalSqliteDatabase({ policy });
    const current = database.documents.forOrganization(identity.organizationId);
    const restart = createDesktopHeadlessClientAuthority({ documents: current, identity, canReadWorkspace: async () => true });
    const verified = await restart.verifyCredential(paired.credential);
    assert.ok(verified);
    assert.equal(verified.registeredClientId, paired.registeredClientId);
    assert.deepEqual(verified.workspaceIds, [workspaceId]);
    assert.ok(verified.operations.every((operation) => !operation.startsWith("ui.")));
    const wrongPrincipal = createDesktopHeadlessClientAuthority({
      documents: current, identity: otherIdentity, canReadWorkspace: async () => true,
    });
    assert.equal(await wrongPrincipal.verifyCredential(paired.credential), undefined);
    assert.equal(await wrongPrincipal.revokeClient(paired.registeredClientId), false);
    assert.equal(await restart.revokeClient(paired.registeredClientId), true);
    assert.equal(await restart.verifyCredential(paired.credential), undefined);
    restart.close();
    wrongPrincipal.close();
    await database.close();
    database = undefined;
    database = await openLocalSqliteDatabase({ policy });
    const final = createDesktopHeadlessClientAuthority({
      documents: database.documents.forOrganization(identity.organizationId), identity, canReadWorkspace: async () => true,
    });
    assert.equal(await final.verifyCredential(paired.credential), undefined);
    final.close();
  } finally {
    await database?.close();
    const target = await realpath(root);
    assert.equal(target, root);
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith("desktop-headless-registry-"));
    await rm(target, { recursive: true, force: true });
  }
});

test("does not substitute fresh storage if persisted registration state is invalid", async () => {
  const { authority, documents } = fixture();
  await documents.writeDocument(storeNamespace, "clients-v1", [{ malformed: true }]);
  const pending = await authority.beginPairing(workspaceId);
  assert.equal(pending.status, "ready");
  assert.deepEqual(await authority.completePairing(pending.pairingCode), { status: "unavailable" });
  assert.deepEqual(await authority.listClients(), { status: "unavailable" });
  const saved = await documents.readDocument(storeNamespace, "clients-v1");
  assert.deepEqual(saved?.value, [{ malformed: true }]);
});

test("does not disclose a credential when the code or workspace access expires during commit", async () => {
  for (const cause of ["deadline", "policy"] as const) {
    const current = fixture();
    const documents: StructuredDocumentStore = {
      ...current.documents,
      async runInTransaction(work) {
        const result = await current.documents.runInTransaction(work);
        if (cause === "deadline") current.advance(120_000);
        else current.denyWorkspace();
        return result;
      },
    };
    const authority = createDesktopHeadlessClientAuthority({ ...current.dependencies, documents });
    const pending = await authority.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    assert.deepEqual(await authority.completePairing(pending.pairingCode), denied);
    assert.deepEqual(await authority.completePairing(pending.pairingCode), denied);
    const listed = await authority.listClients();
    assert.equal(listed.status, "ready");
    assert.equal(listed.clients.length, 1);
    assert.deepEqual(Object.keys(listed.clients[0]!).sort(), ["expiresAt", "registeredClientId", "workspaceId"]);
  }
});

test("does not report a paired credential when the exact client was revoked before response", async () => {
  const current = fixture();
  let checks = 0;
  let entered!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  const authority = createDesktopHeadlessClientAuthority({
    ...current.dependencies,
    async canReadWorkspace(id) {
      if (++checks === 3) {
        entered();
        await released;
      }
      return current.dependencies.canReadWorkspace(id);
    },
  });
  const code = await authority.beginPairing(workspaceId);
  assert.equal(code.status, "ready");
  const completing = authority.completePairing(code.pairingCode);
  await waiting;
  try {
    const listed = await authority.listClients();
    assert.equal(listed.status, "ready");
    assert.equal(listed.clients.length, 1);
    assert.equal(await authority.revokeClient(listed.clients[0]!.registeredClientId), true);
  } finally {
    resume();
  }
  assert.deepEqual(await completing, denied);
  assert.deepEqual(await authority.listClients(), { status: "ready", clients: [] });
});
