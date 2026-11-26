import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, realpath, lstat, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import type {TrainingStorageBudgetRequest} from "../../../../application/ports/model";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../sqlite";
import {createLocalModelRegistryAdapter, createStructuredTrainingStorageBudget, type StructuredTrainingStorageBudgetPolicy} from "../index";

const POOLS = "model/training/storage-budget/pools-v1", RESERVATIONS = "model/training/storage-budget/reservations-v1";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digest = "sha256:" + "a".repeat(64);
const policy: StructuredTrainingStorageBudgetPolicy = {poolId: "synthetic-training-pool", profileFingerprint: digest,
  maximumBytes: 1000, maximumOrganizationBytes: 800, maximumPrincipalBytes: 600,
  maximumReservations: 5, maximumOrganizationReservations: 4, maximumPrincipalReservations: 3};
const poolKey = hash([policy.poolId]), current = {isCurrent: () => true};
function request(sequence = 1, amount = 100): TrainingStorageBudgetRequest {
  return {scope: {organizationId: createOrganizationId("fixture-organization"), workspaceId: createWorkspaceId("fixture-workspace"),
    principalId: "fixture-actor", clientId: "11111111-1111-4111-8111-111111111111",
    hostIncarnationId: "22222222-2222-4222-8222-222222222222", requestId: sequence.toString().padStart(8, "0") + "-3333-4333-8333-333333333333"},
    definitionDigest: digest, storageScopeDigest: "sha256:" + "b".repeat(64), profileFingerprint: digest,
    limits: {model: 10, inputs: 10, "worker-output": 10, "parent-output": 10, overhead: 10}, maximumReservedBytes: amount};
}
async function provisionFixture(documents: StructuredDocumentStore) {
  // Explicit synthetic fixture provisioning, never production/Native proof.
  await documents.writeDocument(POOLS, poolKey, {schema: "training-storage-budget-pool-v1",
    policyDigest: "sha256:" + hash(policy), reservedBytes: 0, reservationCount: 0, organizations: []}, {expectedRevision: 0});
}
const make = (documents: StructuredDocumentStore, overrides: Partial<Parameters<typeof createStructuredTrainingStorageBudget>[0]> = {}) =>
  createStructuredTrainingStorageBudget({documents, policy, authorize: async () => true, ...overrides});
async function pool(documents: StructuredDocumentStore) {
  return (await documents.readDocument<{reservedBytes: number; reservationCount: number; organizations: unknown[]}>(POOLS, poolKey))!;
}

test("the public Model persistence barrel preserves its existing registry adapter", () => {
  assert.equal(typeof createLocalModelRegistryAdapter, "function");
  assert.equal(typeof createStructuredTrainingStorageBudget, "function");
});

test("missing pool and scoped/context transaction wrappers cannot initialize or fall back", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  assert.deepEqual(await make(documents).reserve(request(), current), {kind: "denied"});
  assert.equal(await documents.readDocument(POOLS, poolKey), undefined);
  assert.throws(() => make(documents.forOrganization(request().scope.organizationId)));
  const {runInOwnedTransaction: _, ...withoutOwner} = documents;
  assert.throws(() => make(withoutOwner));
  assert.deepEqual(Object.keys(make(documents)), ["reserve"]);
});

test("one acknowledged all-role debit retains exact private bindings and refuses adoption", async () => {
  const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
  const port = make(documents), input = request();
  assert.deepEqual(await port.reserve(input, current), {kind: "reserved"});
  assert.equal((await pool(documents)).value.reservedBytes, 100);
  assert.deepEqual(await make(documents).reserve(input, current), {kind: "unconfirmed"});
  assert.deepEqual(await port.reserve({...input, storageScopeDigest: "sha256:" + "c".repeat(64)}, current), {kind: "unconfirmed"});
  const rows = await documents.forOrganization(input.scope.organizationId).listDocuments<Record<string, unknown>>(RESERVATIONS);
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].value.limits, input.limits);
  assert.equal(rows[0].value.maximumReservedBytes, 100);
  const serialized = JSON.stringify([await pool(documents), rows]);
  assert.equal(serialized.includes(input.scope.principalId), false);
  assert.equal(serialized.includes("localPath") || serialized.includes("content"), false);
});

test("competing requests share atomic global, organization, principal and count ceilings", async () => {
  for (const dimension of ["global", "organization", "principal", "count"] as const) {
    const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
    const port = make(documents);
    const inputs = Array.from({length: 7}, (_, index) => {
      const input = request(index + 1, dimension === "count" ? 100 : 300);
      return {...input, scope: {...input.scope,
        ...(dimension === "global" ? {organizationId: createOrganizationId("fixture-org-" + index)} : {}),
        ...(dimension === "organization" || dimension === "count" ? {principalId: "fixture-actor-" + index} : {})}};
    });
    const results = await Promise.all(inputs.map(input => port.reserve(input, current)));
    const passed = results.filter(result => result.kind === "reserved").length;
    assert.equal(passed, dimension === "global" ? 3 : dimension === "count" ? 4 : 2);
    assert.equal(results.every(result => result.kind === "reserved" || result.kind === "capacity"), true);
    assert.equal((await pool(documents)).value.reservationCount, passed);
    assert.equal((await pool(documents)).value.reservedBytes, passed * (dimension === "count" ? 100 : 300));
  }
});

test("fresh organization policy precedes records and exact partition owns the reservation", async () => {
  const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
  const input = request(); let calls = 0;
  const port = make(documents, {authorize: async (transaction, scope) => {
    calls++; assert.equal(transaction.runInOwnedTransaction, undefined);
    assert.deepEqual(scope, input.scope); return false;
  }});
  assert.deepEqual(await port.reserve(input, current), {kind: "denied"}); assert.equal(calls, 1);
  assert.equal((await pool(documents)).value.reservedBytes, 0);
  assert.deepEqual(await make(documents).reserve(input, current), {kind: "reserved"});
  assert.equal((await documents.listDocuments(RESERVATIONS)).length, 0);
  assert.equal((await documents.forOrganization(createOrganizationId("foreign-org")).listDocuments(RESERVATIONS)).length, 0);
  assert.equal((await documents.forOrganization(input.scope.organizationId).listDocuments(RESERVATIONS)).length, 1);
});

test("malformed roles, totals, owner/profile and passive accessors deny before authorization", async () => {
  const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
  let authorized = 0, getters = 0;
  const port = make(documents, {authorize: async () => {authorized++; return true;}});
  const input = request();
  const variants: unknown[] = [{...input, maximumReservedBytes: 49}, {...input, maximumReservedBytes: true},
    {...input, limits: {...input.limits, inputs: -1}}, {...input, limits: {...input.limits, "parent-output": 9}},
    {...input, limits: {...input.limits, overhead: Number.MAX_SAFE_INTEGER}}, {...input, limits: {...input.limits, extra: 1}},
    {...input, profileFingerprint: "sha256:" + "f".repeat(64)}, {...input, scope: {...input.scope, requestId: "foreign"}}];
  const getter = {...input}; Object.defineProperty(getter, "limits", {enumerable: true, get() {getters++; return input.limits;}});
  variants.push(getter, new Proxy(input, {getPrototypeOf() {getters++; return Object.prototype;}}));
  for (const supplied of variants) assert.deepEqual(await port.reserve(supplied as TrainingStorageBudgetRequest, current), {kind: "denied"});
  assert.equal(authorized, 0); assert.equal(getters, 0); assert.equal((await pool(documents)).value.reservedBytes, 0);
});

test("pool corruption, wrong policy, missing history and mismatched subordinate totals never seed or credit", async () => {
  const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
  assert.deepEqual(await make(documents).reserve(request(), current), {kind: "reserved"});
  const original = await pool(documents);
  for (const mutate of [(value: any) => value.policyDigest = "sha256:" + "f".repeat(64),
    (value: any) => value.reservedBytes++, (value: any) => value.organizations[0].reservationCount++,
    (value: any) => value.organizations[0].principals.push({...value.organizations[0].principals[0]}),
    (value: any) => value.organizations = [], (value: any) => value.reservationCount = true]) {
    const changed = structuredClone(original.value); mutate(changed);
    await documents.writeDocument(POOLS, poolKey, changed);
    assert.deepEqual(await make(documents).reserve(request(2), current), {kind: "unconfirmed"});
    assert.deepEqual((await pool(documents)).value, changed);
  }
  await documents.writeDocument(POOLS, poolKey, original.value);
  assert.deepEqual(await make(documents, {policy: {...policy, maximumBytes: 2000}}).reserve(request(2), current), {kind: "unconfirmed"});
  await documents.deleteDocument(POOLS, poolKey);
  assert.deepEqual(await make(documents).reserve(request(2), current), {kind: "denied"});
  assert.equal(await documents.readDocument(POOLS, poolKey), undefined);
});

test("withdrawal at the exact precommit fence rolls back both debit and private reservation", async () => {
  const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
  let active = true;
  const wrapped: StructuredDocumentStore = {...documents, runInOwnedTransaction: (work, beforeCommit) =>
    documents.runInOwnedTransaction!(work, () => {active = false; beforeCommit();})};
  assert.deepEqual(await make(wrapped).reserve(request(), {isCurrent: () => active}), {kind: "unconfirmed"});
  assert.equal((await pool(documents)).value.reservedBytes, 0);
  assert.equal((await documents.forOrganization(request().scope.organizationId).listDocuments(RESERVATIONS)).length, 0);
});

test("lost commit response retains the real debit and cannot authorize another attempt", async () => {
  const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
  const wrapped: StructuredDocumentStore = {...documents, async runInOwnedTransaction(work, beforeCommit) {
    await documents.runInOwnedTransaction!(work, beforeCommit); throw new Error("synthetic lost acknowledgement");
  }};
  assert.deepEqual(await make(wrapped).reserve(request(), current), {kind: "unconfirmed"});
  assert.equal((await pool(documents)).value.reservedBytes, 100);
  assert.deepEqual(await make(documents).reserve(request(), current), {kind: "unconfirmed"});
  assert.equal((await pool(documents)).value.reservedBytes, 100);
});

test("a counter-only reset cannot create fresh capacity over retained reservations", async () => {
  const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
  assert.deepEqual(await make(documents).reserve(request(), current), {kind: "reserved"});
  const previous = await pool(documents);
  await documents.writeDocument(POOLS, poolKey, {...previous.value, reservedBytes: 0, reservationCount: 0, organizations: []});
  assert.deepEqual(await make(documents).reserve(request(2), current), {kind: "unconfirmed"});
  assert.equal((await pool(documents)).revision, 3);
  assert.equal((await documents.forOrganization(request().scope.organizationId).listDocuments(RESERVATIONS)).length, 1);
});

test("an unavailable transaction/rollback owner returns no grant and exposes no credit path", async () => {
  const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
  assert.deepEqual(await make(documents).reserve(request(), current), {kind: "reserved"});
  const wrapped: StructuredDocumentStore = {...documents, async runInOwnedTransaction() {
    throw new Error("synthetic unavailable rollback owner");
  }};
  const port = make(wrapped);
  assert.deepEqual(await port.reserve(request(2), current), {kind: "unconfirmed"});
  assert.deepEqual(await port.reserve(request(3), current), {kind: "unconfirmed"});
  assert.equal((await pool(documents)).value.reservedBytes, 100);
  assert.deepEqual(Object.keys(port), ["reserve"]);
});

test("caller changes during authorization cannot rewrite captured actor or copy amounts", async () => {
  const documents = createInMemoryStructuredDocumentStore(); await provisionFixture(documents);
  const input = request(), original = structuredClone(input);
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => {entered = resolve;});
  const held = new Promise<void>(resolve => {release = resolve;});
  const port = make(documents, {authorize: async (_transaction, scope) => {
    assert.deepEqual(scope, original.scope); entered(); await held; return true;
  }});
  const pending = port.reserve(input, current); await waiting;
  Object.assign(input.scope, {principalId: "changed-fixture-actor"});
  Object.assign(input.limits, {model: 999}); Object.assign(input, {maximumReservedBytes: 999});
  release(); assert.deepEqual(await pending, {kind: "reserved"});
  assert.equal((await pool(documents)).value.reservedBytes, original.maximumReservedBytes);
  const rows = await documents.forOrganization(original.scope.organizationId).listDocuments<Record<string, unknown>>(RESERVATIONS);
  assert.deepEqual(rows[0].value.limits, original.limits);
  assert.deepEqual(await make(documents).reserve(original, current), {kind: "unconfirmed"});
});

test("actual SQLite close/reopen retains reservations and counters without adoption or expiry", async () => {
  const base = await realpath(tmpdir()), directory = await mkdtemp(path.join(base, "training-budget-"));
  const sqlitePolicy = resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory});
  let database = await openLocalSqliteDatabase({policy: sqlitePolicy});
  try {
    await provisionFixture(database.documents);
    assert.deepEqual(await make(database.documents).reserve(request(1, 550), current), {kind: "reserved"});
    await database.close(); database = await openLocalSqliteDatabase({policy: sqlitePolicy});
    assert.deepEqual(await make(database.documents).reserve(request(1, 550), current), {kind: "unconfirmed"});
    assert.deepEqual(await make(database.documents).reserve(request(2, 100), current), {kind: "capacity"});
    const different = request(3, 100);
    assert.deepEqual(await make(database.documents).reserve({...different, scope: {...different.scope, principalId: "fixture-second-actor"}}, current), {kind: "reserved"});
    assert.equal((await pool(database.documents)).value.reservedBytes, 650);
  } finally {
    await database.close();
    const target = await realpath(directory), relative = path.relative(base, target), info = await lstat(directory);
    assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false);
    assert.equal(path.dirname(target), base); assert.equal(path.basename(target).startsWith("training-budget-"), true);
    assert.equal(info.isDirectory() && !info.isSymbolicLink(), true);
    await rm(target, {recursive: true});
  }
});
