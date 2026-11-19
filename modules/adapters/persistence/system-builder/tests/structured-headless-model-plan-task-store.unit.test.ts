import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readModelDownloadSource} from "../../../../contracts/model";
import {readHeadlessModelDownloadPlanRequest, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../sqlite";
import {HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE} from "../createStructuredHeadlessOperationStore";
import {readStructuredOwnedContextPlanTask} from "../createStructuredHeadlessContextPlanTaskStore";
import {readStructuredOwnedDatasetPlanTask} from "../../ingestion/createStructuredHeadlessDatasetPlanTaskStore";
import {inspectStructuredModelPlanTask, reserveStructuredModelPlanTask, issueStructuredModelPlanTask,
  acceptStructuredModelPlanTask, recordStructuredModelTaskNotStarted, readStructuredOwnedModelPlanTask,
  readStructuredOwnedModelPlanTaskByPlan, readStructuredModelPlanAttemptByPlan, readStructuredOwnedModelPlanTaskSourceDigest,
  readStructuredModelPlanTaskLineage, type ModelPlanTaskEffect} from "../createStructuredHeadlessModelPlanTaskStore";

const namespaces = ["headless/models/download-plan-tasks", "headless/models/download-plan-task-index",
  "headless/models/download-plan-task-plan-index", "headless/models/download-plan-task-counts"];
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fixture(root = createInMemoryStructuredDocumentStore()) {
  const host = randomUUID() as HeadlessHostIncarnationId;
  const scope = {organizationId: createOrganizationId("organization.model-ledger"), workspaceId: createWorkspaceId("workspace.model-ledger"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40),
    format: "transformers-safetensors", license: {kind: "unknown"}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
      path, sizeBytes: 10, integrity: {algorithm: path.endsWith("safetensors") ? "sha256" : "git-blob-sha1",
        digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})), totalBytes: 30, excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40)});
  const sourceDigest = sha(source);
  const decoded = readHeadlessModelDownloadPlanRequest({version: "aisb-headless-v1", operation: "models.download", input: {
    hostIncarnationId: host, workspaceId: scope.workspaceId, idempotencyKey: randomUUID(), name: "Support model",
    sourceManifest: {source, manifestDigest: "sha256:" + sourceDigest}, allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 1800}}, host);
  assert.ok(decoded.ok);
  const target = {hostIncarnationId: host, scope, fingerprint: "c".repeat(64)};
  const effect: ModelPlanTaskEffect = {key: randomUUID(), target, approvalRevision: 2, step: 1, request: decoded.request};
  const partition = root.forOrganization(scope.organizationId);
  const transaction = <T,>(visit: (owner: StructuredDocumentStore) => Promise<T>, fence: () => void = () => {}) =>
    root.runInOwnedTransaction!(owner => visit(owner.forOrganization(scope.organizationId)), fence);
  const reserve = () => transaction(owner => reserveStructuredModelPlanTask(owner, effect, sourceDigest, 1));
  const attempt = () => readStructuredModelPlanAttemptByPlan(partition, scope, host, target.fingerprint, 1);
  const accepted = async () => {
    const reserved = await reserve(); assert.ok(reserved.kind === "new");
    assert.ok(await transaction(owner => issueStructuredModelPlanTask(owner, effect, reserved.taskId, sourceDigest, 2)));
    assert.ok(await transaction(owner => acceptStructuredModelPlanTask(owner, effect, reserved.taskId, 3)));
    return reserved.taskId;
  };
  return {root, scope, host, target, effect, sourceDigest, partition, transaction, reserve, attempt, accepted};
}

test("Model plan ledger reserves and issues once, accepts the original outcome and never grants another dispatch", async () => {
  const f = fixture(); assert.deepEqual(await inspectStructuredModelPlanTask(f.partition, f.effect), {kind: "absent"});
  assert.equal(await f.attempt(), undefined);
  const first = await f.reserve(); assert.equal(first.kind, "new"); if (first.kind !== "new") assert.fail();
  assert.notEqual(first.taskId, f.effect.key);
  assert.deepEqual(await f.attempt(), {kind: "unconfirmed"});
  assert.deepEqual(await f.reserve(), {kind: "unconfirmed"});
  assert.equal(await readStructuredOwnedModelPlanTask(f.partition, f.scope, f.host, first.taskId), undefined);
  assert.equal(await f.transaction(owner => acceptStructuredModelPlanTask(owner, f.effect, first.taskId, 2)), false);
  assert.equal(await f.transaction(owner => issueStructuredModelPlanTask(owner, f.effect, randomUUID(), f.sourceDigest, 2)), false);
  assert.ok(await f.transaction(owner => issueStructuredModelPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)));
  assert.equal(await f.transaction(owner => issueStructuredModelPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 3)), false);
  assert.deepEqual(await f.attempt(), {kind: "unconfirmed"});
  assert.ok(await f.transaction(owner => acceptStructuredModelPlanTask(owner, f.effect, first.taskId, 3)));
  const expected = {kind: "accepted", reference: {workspaceId: f.scope.workspaceId, taskId: first.taskId}};
  assert.deepEqual(await f.attempt(), expected); assert.deepEqual(await f.reserve(), expected);
  assert.ok(await f.transaction(owner => acceptStructuredModelPlanTask(owner, f.effect, first.taskId, 4)));
  assert.deepEqual(await readStructuredOwnedModelPlanTaskByPlan(f.partition, f.scope, f.host, f.target.fingerprint, 1), expected.reference);
  assert.deepEqual(await readStructuredOwnedModelPlanTask(f.partition, f.scope, f.host, first.taskId), expected.reference);
  assert.equal(await readStructuredOwnedModelPlanTaskSourceDigest(f.partition, f.scope, f.host, first.taskId), f.sourceDigest);
  const rows = await f.partition.listDocuments<{owner: {sourceDigest: string}; phase: string}>(namespaces[0]);
  assert.equal(rows.length, 1); assert.equal(rows[0].revision, 3); assert.equal(rows[0].value.owner.sourceDigest, f.sourceDigest);
});

test("interrupted reservation or issue never becomes accepted discovery, a fresh UUID or a new approval attempt", async () => {
  for (const phase of ["reserved", "issued"] as const) {
    const f = fixture(), first = await f.reserve(); assert.ok(first.kind === "new");
    if (phase === "issued") assert.ok(await f.transaction(owner => issueStructuredModelPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)));
    assert.deepEqual(await f.reserve(), {kind: "unconfirmed"}); assert.deepEqual(await f.attempt(), {kind: "unconfirmed"});
    assert.equal(await readStructuredOwnedModelPlanTaskByPlan(f.partition, f.scope, f.host, f.target.fingerprint, 1), undefined);
    await assert.rejects(inspectStructuredModelPlanTask(f.partition, {...f.effect, approvalRevision: 3}), /owned Model task record is unavailable/);
    assert.equal((await f.partition.listDocuments(namespaces[0])).length, 1);
  }
});

test("only an exact trusted non-start outcome closes a reserved/issued attempt without granting a retry", async () => {
  for (const phase of ["reserved", "issued"] as const) {
    const f = fixture(), first = await f.reserve(); assert.ok(first.kind === "new");
    if (phase === "issued") assert.ok(await f.transaction(owner => issueStructuredModelPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)));
    assert.equal(await f.transaction(owner => recordStructuredModelTaskNotStarted(owner, f.effect, randomUUID(), f.sourceDigest, 3)), false);
    assert.equal(await f.transaction(owner => recordStructuredModelTaskNotStarted(owner, f.effect, first.taskId, "e".repeat(64), 3)), false);
    assert.ok(await f.transaction(owner => recordStructuredModelTaskNotStarted(owner, f.effect, first.taskId, f.sourceDigest, 3)));
    assert.deepEqual(await f.attempt(), {kind: "not-started"}); assert.deepEqual(await f.reserve(), {kind: "not-started"});
    assert.deepEqual(await inspectStructuredModelPlanTask(f.partition, {...f.effect, approvalRevision: 3}), {kind: "not-started"});
    assert.equal(await f.transaction(owner => issueStructuredModelPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 4)), false);
    assert.equal(await f.transaction(owner => acceptStructuredModelPlanTask(owner, f.effect, first.taskId, 4)), false);
    assert.equal(await readStructuredOwnedModelPlanTask(f.partition, f.scope, f.host, first.taskId), undefined);
    const row = (await f.partition.listDocuments<{version: number; notStartedFrom: string}>(namespaces[0]))[0];
    assert.equal(row.value.version, 2); assert.equal(row.value.notStartedFrom, phase); assert.equal(row.revision, phase === "reserved" ? 2 : 3);
  }
  const f = fixture(), taskId = await f.accepted();
  assert.equal(await f.transaction(owner => recordStructuredModelTaskNotStarted(owner, f.effect, taskId, f.sourceDigest, 4)), false);
});

test("root-owned rollback removes every reservation/index/count and wrong partitions cannot mutate", async () => {
  const f = fixture();
  await assert.rejects(f.transaction(owner => reserveStructuredModelPlanTask(owner, f.effect, f.sourceDigest, 1), () => {throw new Error("Synthetic commit refusal.");}));
  assert.deepEqual(await f.partition.listNamespaces(), []);
  await assert.rejects(reserveStructuredModelPlanTask(f.partition, f.effect, f.sourceDigest, 1), /owned Model/);
  await assert.rejects(reserveStructuredModelPlanTask(f.root, f.effect, f.sourceDigest, 1), /owned Model/);
  await assert.rejects(f.root.runInOwnedTransaction!(owner => reserveStructuredModelPlanTask(owner.forOrganization(createOrganizationId("foreign.organization")),
    f.effect, f.sourceDigest, 1), () => {}), /owned Model/);
});

test("competing owned reservations retain one UUID and a lost commit response cannot be adopted as new", async () => {
  const f = fixture(); const results = await Promise.all([f.reserve(), f.reserve()]);
  assert.equal(results.filter(value => value.kind === "new").length, 1); assert.equal(results.filter(value => value.kind === "unconfirmed").length, 1);
  const second = fixture();
  await assert.rejects((async () => {await second.reserve(); throw new Error("Synthetic lost reply.");})());
  assert.deepEqual(await second.reserve(), {kind: "unconfirmed"});
  assert.equal((await second.partition.listDocuments(namespaces[0])).length, 1);
});

test("accepted historic receipts retain newer approval revisions without granting another effect or another domain task", async () => {
  const f = fixture(), taskId = await f.accepted();
  assert.deepEqual(await inspectStructuredModelPlanTask(f.partition, {...f.effect, approvalRevision: 3}),
    {kind: "accepted", reference: {workspaceId: f.scope.workspaceId, taskId}});
  assert.equal(await readStructuredOwnedContextPlanTask(f.partition, f.scope, f.host, taskId), undefined);
  assert.equal(await readStructuredOwnedDatasetPlanTask(f.partition, f.scope, f.host, taskId), undefined);
  const lineage = await readStructuredModelPlanTaskLineage(f.partition, f.scope, f.host, taskId);
  assert.deepEqual(lineage?.target, f.target); assert.equal(lineage?.sourceDigest, f.sourceDigest);
  assert.equal(lineage?.step, 1); assert.match(lineage!.inputDigest, /^[a-f0-9]{64}$/);
  for (const patch of [{step: 2}, {target: {...f.target, fingerprint: "d".repeat(64)}}])
    await assert.rejects(inspectStructuredModelPlanTask(f.partition, {...f.effect, ...patch}), /owned Model/);
  const changedKey = {...f.effect, key: randomUUID()};
  assert.deepEqual(await inspectStructuredModelPlanTask(f.partition, changedKey), {kind: "absent"});
  await assert.rejects(f.transaction(owner => reserveStructuredModelPlanTask(owner, changedKey, f.sourceDigest, 4)),
    "The existing exact plan index prevents another effect key from reserving a second attempt.");
  assert.equal((await f.partition.listDocuments(namespaces[0])).length, 1);
});

test("point reads require exact original actor/client/workspace/organization and host with no accepted ID exposure to other scopes", async () => {
  const f = fixture(), taskId = await f.accepted();
  for (const patch of [{principalId: "foreign.actor"}, {registeredClientId: randomUUID()},
    {workspaceId: createWorkspaceId("foreign.workspace")}, {organizationId: createOrganizationId("foreign.organization")}]) {
    const scope = {...f.scope, ...patch};
    assert.equal(await readStructuredOwnedModelPlanTask(f.partition, scope, f.host, taskId), undefined);
    assert.equal(await readStructuredOwnedModelPlanTaskByPlan(f.partition, scope, f.host, f.target.fingerprint, 1), undefined);
    assert.equal(await readStructuredModelPlanAttemptByPlan(f.partition, scope, f.host, f.target.fingerprint, 1), undefined);
    assert.equal(await readStructuredModelPlanTaskLineage(f.partition, scope, f.host, taskId), undefined);
  }
  assert.equal(await readStructuredOwnedModelPlanTask(f.partition, f.scope, randomUUID(), taskId), undefined);
  assert.equal(await readStructuredOwnedModelPlanTask(f.partition, f.scope, f.host, randomUUID()), undefined);
  assert.equal(await readStructuredOwnedModelPlanTaskByPlan(f.partition, f.scope, f.host, "d".repeat(64), 1), undefined);
});

test("source/request substitution and self-asserted metadata hashes cannot reserve or reuse an exact task", async () => {
  const f = fixture();
  await assert.rejects(f.transaction(owner => reserveStructuredModelPlanTask(owner, f.effect, "d".repeat(64), 1)), /owned Model/);
  const falseDigest = clone(f.effect); (falseDigest.request.input.sourceManifest as {manifestDigest: string}).manifestDigest = "sha256:" + "d".repeat(64);
  await assert.rejects(f.transaction(owner => reserveStructuredModelPlanTask(owner, falseDigest, "d".repeat(64), 1)), /owned Model/);
  assert.deepEqual(await f.partition.listNamespaces(), []);
  await f.reserve();
  for (const field of ["name", "idempotencyKey", "maximumDurationSeconds"] as const) {
    const effect = clone(f.effect);
    Object.assign(effect.request.input, {[field]: field === "name" ? "Another name" : field === "idempotencyKey" ? randomUUID() : 1799});
    await assert.rejects(inspectStructuredModelPlanTask(f.partition, effect), /owned Model/);
  }
});

test("active effect/source/scope values fail before hooks or persistent effects", async () => {
  const f = fixture(); let hooks = 0;
  const active = Object.defineProperty(clone(f.effect), "request", {enumerable: true, get() {hooks++; return f.effect.request;}});
  const proxy = new Proxy(f.effect, {ownKeys() {hooks++; return [];}, get() {hooks++; return undefined;}});
  const cyclic = Object.assign(clone(f.effect), {extra: {} as Record<string, unknown>}); cyclic.extra.self = cyclic;
  const extra = Object.assign(clone(f.effect), {approvalGranted: true});
  for (const value of [active, proxy, cyclic, extra]) await assert.rejects(f.transaction(owner => reserveStructuredModelPlanTask(owner, value, f.sourceDigest, 1)));
  assert.equal(hooks, 0); assert.deepEqual(await f.partition.listNamespaces(), []);
});

test("effect and lookup scope are copied before held store reads", async () => {
  const f = fixture(), submitted = clone(f.effect);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(done => {enter = done;}), held = new Promise<void>(done => {release = done;});
  const pending = f.transaction(owner => reserveStructuredModelPlanTask({...owner, async readDocument<T>(namespace: string, key: string) {
    if (namespace === namespaces[0]) {enter(); await held;}
    return owner.readDocument<T>(namespace, key);
  }}, submitted, f.sourceDigest, 1));
  await entered;
  Object.assign(submitted, {key: randomUUID(), step: 2}); Object.assign(submitted.target.scope, {workspaceId: createWorkspaceId("foreign.workspace")});
  Object.assign(submitted.request.input, {name: "Changed after capture"}); release();
  const first = await pending; assert.ok(first.kind === "new");
  assert.deepEqual(await inspectStructuredModelPlanTask(f.partition, f.effect), {kind: "unconfirmed"});
  assert.ok(await f.transaction(owner => issueStructuredModelPlanTask(owner, f.effect, first.taskId, f.sourceDigest, 2)));
  assert.ok(await f.transaction(owner => acceptStructuredModelPlanTask(owner, f.effect, first.taskId, 3)));
  let ready!: () => void, finish!: () => void;
  const reading = new Promise<void>(done => {ready = done;}), wait = new Promise<void>(done => {finish = done;});
  const scope = {...f.scope};
  const read = readStructuredOwnedModelPlanTask({...f.partition, async readDocument<T>(namespace: string, key: string) {
    if (namespace === namespaces[1]) {ready(); await wait;}
    return f.partition.readDocument<T>(namespace, key);
  }}, scope, f.host, first.taskId);
  await reading; Object.assign(scope, {principalId: "foreign.actor", registeredClientId: randomUUID(), workspaceId: createWorkspaceId("foreign.workspace")});
  finish(); assert.deepEqual(await read, {workspaceId: f.scope.workspaceId, taskId: first.taskId});
});

test("both point indexes and source-bound record identity must agree; corruption cannot expose a task", async () => {
  const f = fixture(), taskId = await f.accepted();
  for (const selected of namespaces.slice(0, 3)) for (const kind of ["missing", "digest", "revision"] as const) {
    const altered: StructuredDocumentStore = {...f.partition, async readDocument<T>(namespace: string, key: string) {
      const row = await f.partition.readDocument<T>(namespace, key);
      if (!row || namespace !== selected) return row;
      if (kind === "missing") return undefined;
      if (kind === "revision") return {...row, revision: row.revision + 1};
      const value = clone(row.value) as Record<string, unknown>;
      if (selected === namespaces[0]) value.sourceDigest = "e".repeat(64);
      else value.identityDigest = "e".repeat(64);
      return {...row, value: value as T};
    }};
    let value: unknown;
    try {value = await readStructuredOwnedModelPlanTask(altered, f.scope, f.host, taskId);} catch (error) {assert.match((error as Error).message, /owned Model/);}
    assert.equal(value, undefined, selected + kind);
  }
});

test("JSON object key order does not change an accepted canonical owner or index digest", async () => {
  const f = fixture(), taskId = await f.accepted();
  const reordered: StructuredDocumentStore = {...f.partition, async readDocument<T>(namespace: string, key: string) {
    const row = await f.partition.readDocument<T>(namespace, key);
    if (!row || namespace !== namespaces[0]) return row;
    const value = clone(row.value) as {owner: Record<string, unknown>};
    value.owner = Object.fromEntries(Object.entries(value.owner).reverse());
    return {...row, value: value as T};
  }};
  assert.deepEqual(await readStructuredOwnedModelPlanTask(reordered, f.scope, f.host, taskId), {workspaceId: f.scope.workspaceId, taskId});
  assert.deepEqual(await readStructuredModelPlanAttemptByPlan(reordered, f.scope, f.host, f.target.fingerprint, 1),
    {kind: "accepted", reference: {workspaceId: f.scope.workspaceId, taskId}});
});

test("existing per-client receipt ceiling and invalid count/time records refuse without writes", async () => {
  for (const variant of ["capacity", "negative", "revision"] as const) {
    const f = fixture();
    const result = f.transaction(owner => reserveStructuredModelPlanTask({...owner, async readDocument<T>(namespace: string, key: string) {
      if (namespace === namespaces[3]) return {namespace, key, revision: variant === "capacity" ? HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE : 1,
        value: {used: variant === "capacity" ? HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE : variant === "negative" ? -1 : 2} as T,
        updatedAt: "2026-11-19T00:00:00.000Z"};
      return owner.readDocument<T>(namespace, key);
    }}, f.effect, f.sourceDigest, 1));
    if (variant === "capacity") assert.deepEqual(await result, {kind: "capacity"}); else await assert.rejects(result, /owned Model/);
    assert.deepEqual(await f.partition.listNamespaces(), []);
  }
  const f = fixture(); await assert.rejects(f.transaction(owner => reserveStructuredModelPlanTask(owner, f.effect, f.sourceDigest, 0)), /owned Model/);
  assert.deepEqual(await f.partition.listNamespaces(), []);
});

test("accepted exact Model task receipts survive real SQLite reopen without granting another start", async () => {
  const directory = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), "headless-model-ledger-")));
  const policy = resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory});
  let db: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  try {
    db = await openLocalSqliteDatabase({policy}); const f = fixture(db.documents), taskId = await f.accepted();
    await db.close(); db = undefined; db = await openLocalSqliteDatabase({policy});
    const partition = db.documents.forOrganization(f.scope.organizationId);
    const expected = {kind: "accepted", reference: {workspaceId: f.scope.workspaceId, taskId}};
    assert.deepEqual(await inspectStructuredModelPlanTask(partition, f.effect), expected);
    assert.deepEqual(await readStructuredModelPlanAttemptByPlan(partition, f.scope, f.host, f.target.fingerprint, 1), expected);
    assert.deepEqual(await db.documents.runInOwnedTransaction!(owner => reserveStructuredModelPlanTask(owner.forOrganization(f.scope.organizationId),
      f.effect, f.sourceDigest, 4), () => {}), expected);
  } finally {await db?.close(); await rm(directory, {recursive: true, force: true});}
});
