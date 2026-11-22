import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readHeadlessModelTrainingPlanRequest, readHeadlessModelTrainingInputsValue, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../sqlite";
import {readModelTrainingReviewBindings} from "../headlessModelTrainingReviewBindings";
import {PrepareHeadlessModelTrainingPlanUseCase} from "../../../../application/use-cases/model/headless-model-training-plan.use-case";
import {readStructuredOwnedModelPlanTask as readDownloadedModelTask} from "../createStructuredHeadlessModelPlanTaskStore";
import {HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE} from "../createStructuredHeadlessOperationStore";
import {readStructuredOwnedContextPlanTask} from "../createStructuredHeadlessContextPlanTaskStore";
import {readStructuredOwnedDatasetPlanTask} from "../../ingestion/createStructuredHeadlessDatasetPlanTaskStore";
import {inspectStructuredTrainingPlanTask, reserveStructuredTrainingPlanTask, issueStructuredTrainingPlanTask,
  acceptStructuredTrainingPlanTask, recordStructuredTrainingTaskNotStarted, readStructuredOwnedTrainingPlanTask,
  readStructuredOwnedTrainingPlanTaskByPlan, readStructuredTrainingPlanAttemptByPlan, readStructuredOwnedTrainingPlanTaskProposalDigest,
  readStructuredTrainingPlanTaskLineage, type TrainingPlanTaskEffect} from "../createStructuredHeadlessTrainingPlanTaskStore";

const namespaces = ["headless/models/training-plan-tasks", "headless/models/training-plan-task-index",
  "headless/models/training-plan-task-plan-index", "headless/models/training-plan-task-counts"];
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
async function fixture(root = createInMemoryStructuredDocumentStore()) {
  const host = randomUUID() as HeadlessHostIncarnationId;
  const scope = {organizationId: createOrganizationId("organization.training-ledger"), workspaceId: createWorkspaceId("workspace.training-ledger"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const at = "2026-11-21T00:00:00.000Z";
  const selected = {model: {modelRecordId: "model.synthetic", updatedAt: at},
    dataset: {datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64)}};
  const decoded = readHeadlessModelTrainingPlanRequest({version: "aisb-headless-v1", operation: "models.train", input: {
    hostIncarnationId: host, workspaceId: scope.workspaceId, idempotencyKey: randomUUID(), name: "Private training trial", ...selected,
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 2, seed: 0}, validation: {enabled: false}}}}, host);
  assert.ok(decoded.ok);
  const inputs = readHeadlessModelTrainingInputsValue({workspaceId: scope.workspaceId,
    model: {...selected.model, source: "local", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface",
      modelId: "fixture/base", taskTags: ["chat"], serializationFormat: "safetensors"},
    dataset: {datasetId: selected.dataset.datasetId, version: {versionId: selected.dataset.versionId, versionDigest: selected.dataset.versionDigest,
      createdAt: at, totalRows: 10, sourceCount: 1, artifactCount: 4, parentVersionId: null, splitSeed: 0, recipeDigest: "sha256:" + "b".repeat(64),
      quality: {policyFingerprint: "sha256:" + "c".repeat(64), reportFingerprint: "sha256:" + "d".repeat(64)},
      splits: [{role: "train", rowCount: 6}, {role: "validation", rowCount: 2}, {role: "test", rowCount: 2}]}},
    verification: {inputBytes: "not-checked", runtimeReadiness: "not-checked", trainingCompatibility: "not-checked", resourceAdmission: "not-checked",
      licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"}, trainingApproval: "required"}, decoded.request.input); assert.ok(inputs);
  const prepared = await new PrepareHeadlessModelTrainingPlanUseCase({organizationId: scope.organizationId,
    inputs: {async execute() {return {ok: true, operation: "models.preview-training-inputs", value: inputs};}}}).execute(decoded.request,
    {hostIncarnationId: host, context: {organizationId: scope.organizationId, principalId: scope.principalId, workspaceId: scope.workspaceId}, clientId: scope.registeredClientId, isCurrent: () => true, stillAllowed: async () => true});
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const binding = {step: 1, inputs: prepared.prepared.inputs, proposalDigest: prepared.prepared.proposalDigest};
  const proposalDigest = binding.proposalDigest;
  const target = {hostIncarnationId: host, scope, fingerprint: "c".repeat(64)};
  const effect: TrainingPlanTaskEffect = {key: randomUUID(), target, approvalRevision: 2, step: 1, request: prepared.prepared.request, binding};
  const partition = root.forOrganization(scope.organizationId);
  const transaction = <T,>(visit: (owner: StructuredDocumentStore) => Promise<T>, fence: () => void = () => {}) =>
    root.runInOwnedTransaction!(owner => visit(owner.forOrganization(scope.organizationId)), fence);
  const reserve = () => transaction(owner => reserveStructuredTrainingPlanTask(owner, effect, proposalDigest, 1));
  const attempt = () => readStructuredTrainingPlanAttemptByPlan(partition, scope, host, target.fingerprint, 1);
  const accepted = async () => {
    const reserved = await reserve(); assert.ok(reserved.kind === "new");
    assert.ok(await transaction(owner => issueStructuredTrainingPlanTask(owner, effect, reserved.taskId, proposalDigest, 2)));
    assert.ok(await transaction(owner => acceptStructuredTrainingPlanTask(owner, effect, reserved.taskId, 3)));
    return reserved.taskId;
  };
  return {root, scope, host, target, effect, binding, proposalDigest, partition, transaction, reserve, attempt, accepted};
}

test("Training plan ledger reserves and issues once, accepts the original outcome and never grants another dispatch", async () => {
  const f = await fixture(); assert.deepEqual(await inspectStructuredTrainingPlanTask(f.partition, f.effect), {kind: "absent"});
  assert.equal(await f.attempt(), undefined);
  const first = await f.reserve(); assert.equal(first.kind, "new"); if (first.kind !== "new") assert.fail();
  assert.notEqual(first.taskId, f.effect.key);
  assert.deepEqual(await f.attempt(), {kind: "unconfirmed"});
  assert.deepEqual(await f.reserve(), {kind: "unconfirmed"});
  assert.equal(await readStructuredOwnedTrainingPlanTask(f.partition, f.scope, f.host, first.taskId), undefined);
  assert.equal(await f.transaction(owner => acceptStructuredTrainingPlanTask(owner, f.effect, first.taskId, 2)), false);
  assert.equal(await f.transaction(owner => issueStructuredTrainingPlanTask(owner, f.effect, randomUUID(), f.proposalDigest, 2)), false);
  assert.ok(await f.transaction(owner => issueStructuredTrainingPlanTask(owner, f.effect, first.taskId, f.proposalDigest, 2)));
  assert.equal(await f.transaction(owner => issueStructuredTrainingPlanTask(owner, f.effect, first.taskId, f.proposalDigest, 3)), false);
  assert.deepEqual(await f.attempt(), {kind: "unconfirmed"});
  assert.ok(await f.transaction(owner => acceptStructuredTrainingPlanTask(owner, f.effect, first.taskId, 3)));
  const expected = {kind: "accepted", reference: {workspaceId: f.scope.workspaceId, taskId: first.taskId}};
  assert.deepEqual(await f.attempt(), expected); assert.deepEqual(await f.reserve(), expected);
  assert.ok(await f.transaction(owner => acceptStructuredTrainingPlanTask(owner, f.effect, first.taskId, 4)));
  assert.deepEqual(await readStructuredOwnedTrainingPlanTaskByPlan(f.partition, f.scope, f.host, f.target.fingerprint, 1), expected.reference);
  assert.deepEqual(await readStructuredOwnedTrainingPlanTask(f.partition, f.scope, f.host, first.taskId), expected.reference);
  assert.equal(await readStructuredOwnedTrainingPlanTaskProposalDigest(f.partition, f.scope, f.host, first.taskId), f.proposalDigest);
  const rows = await f.partition.listDocuments<{owner: {proposalDigest: string}; phase: string}>(namespaces[0]);
  assert.equal(rows.length, 1); assert.equal(rows[0].revision, 3); assert.equal(rows[0].value.owner.proposalDigest, f.proposalDigest);
});

test("interrupted reservation or issue never becomes accepted discovery, a fresh UUID or a new approval attempt", async () => {
  for (const phase of ["reserved", "issued"] as const) {
    const f = await fixture(), first = await f.reserve(); assert.ok(first.kind === "new");
    if (phase === "issued") assert.ok(await f.transaction(owner => issueStructuredTrainingPlanTask(owner, f.effect, first.taskId, f.proposalDigest, 2)));
    assert.deepEqual(await f.reserve(), {kind: "unconfirmed"}); assert.deepEqual(await f.attempt(), {kind: "unconfirmed"});
    assert.equal(await readStructuredOwnedTrainingPlanTaskByPlan(f.partition, f.scope, f.host, f.target.fingerprint, 1), undefined);
    await assert.rejects(inspectStructuredTrainingPlanTask(f.partition, {...f.effect, approvalRevision: 3}), /owned training task record is unavailable/);
    assert.equal((await f.partition.listDocuments(namespaces[0])).length, 1);
  }
});

test("only an exact trusted non-start outcome closes a reserved/issued attempt without granting a retry", async () => {
  for (const phase of ["reserved", "issued"] as const) {
    const f = await fixture(), first = await f.reserve(); assert.ok(first.kind === "new");
    if (phase === "issued") assert.ok(await f.transaction(owner => issueStructuredTrainingPlanTask(owner, f.effect, first.taskId, f.proposalDigest, 2)));
    assert.equal(await f.transaction(owner => recordStructuredTrainingTaskNotStarted(owner, f.effect, randomUUID(), f.proposalDigest, 3)), false);
    assert.equal(await f.transaction(owner => recordStructuredTrainingTaskNotStarted(owner, f.effect, first.taskId, "e".repeat(64), 3)), false);
    assert.ok(await f.transaction(owner => recordStructuredTrainingTaskNotStarted(owner, f.effect, first.taskId, f.proposalDigest, 3)));
    assert.deepEqual(await f.attempt(), {kind: "not-started"}); assert.deepEqual(await f.reserve(), {kind: "not-started"});
    assert.deepEqual(await inspectStructuredTrainingPlanTask(f.partition, {...f.effect, approvalRevision: 3}), {kind: "not-started"});
    assert.equal(await f.transaction(owner => issueStructuredTrainingPlanTask(owner, f.effect, first.taskId, f.proposalDigest, 4)), false);
    assert.equal(await f.transaction(owner => acceptStructuredTrainingPlanTask(owner, f.effect, first.taskId, 4)), false);
    assert.equal(await readStructuredOwnedTrainingPlanTask(f.partition, f.scope, f.host, first.taskId), undefined);
    const row = (await f.partition.listDocuments<{version: number; notStartedFrom: string}>(namespaces[0]))[0];
    assert.equal(row.value.version, 2); assert.equal(row.value.notStartedFrom, phase); assert.equal(row.revision, phase === "reserved" ? 2 : 3);
  }
  const f = await fixture(), taskId = await f.accepted();
  assert.equal(await f.transaction(owner => recordStructuredTrainingTaskNotStarted(owner, f.effect, taskId, f.proposalDigest, 4)), false);
});

test("root-owned rollback removes every reservation/index/count and wrong partitions cannot mutate", async () => {
  const f = await fixture();
  await assert.rejects(f.transaction(owner => reserveStructuredTrainingPlanTask(owner, f.effect, f.proposalDigest, 1), () => {throw new Error("Synthetic commit refusal.");}));
  assert.deepEqual(await f.partition.listNamespaces(), []);
  await assert.rejects(reserveStructuredTrainingPlanTask(f.partition, f.effect, f.proposalDigest, 1), /owned training/);
  await assert.rejects(reserveStructuredTrainingPlanTask(f.root, f.effect, f.proposalDigest, 1), /owned training/);
  await assert.rejects(f.root.runInOwnedTransaction!(owner => reserveStructuredTrainingPlanTask(owner.forOrganization(createOrganizationId("foreign.organization")),
    f.effect, f.proposalDigest, 1), () => {}), /owned training/);
});

test("competing owned reservations retain one UUID and a lost commit response cannot be adopted as new", async () => {
  const f = await fixture(); const results = await Promise.all([f.reserve(), f.reserve()]);
  assert.equal(results.filter(value => value.kind === "new").length, 1); assert.equal(results.filter(value => value.kind === "unconfirmed").length, 1);
  const second = await fixture();
  await assert.rejects((async () => {await second.reserve(); throw new Error("Synthetic lost reply.");})());
  assert.deepEqual(await second.reserve(), {kind: "unconfirmed"});
  assert.equal((await second.partition.listDocuments(namespaces[0])).length, 1);
});

test("accepted historic receipts retain newer approval revisions without granting another effect or another domain task", async () => {
  const f = await fixture(), taskId = await f.accepted();
  assert.deepEqual(await inspectStructuredTrainingPlanTask(f.partition, {...f.effect, approvalRevision: 3}),
    {kind: "accepted", reference: {workspaceId: f.scope.workspaceId, taskId}});
  assert.equal(await readDownloadedModelTask(f.partition, f.scope, f.host, taskId), undefined);
  assert.equal(await readStructuredOwnedContextPlanTask(f.partition, f.scope, f.host, taskId), undefined);
  assert.equal(await readStructuredOwnedDatasetPlanTask(f.partition, f.scope, f.host, taskId), undefined);
  const lineage = await readStructuredTrainingPlanTaskLineage(f.partition, f.scope, f.host, taskId);
  assert.deepEqual(lineage?.target, f.target); assert.equal(lineage?.proposalDigest, f.proposalDigest);
  assert.equal(lineage?.step, 1); assert.match(lineage!.inputDigest, /^[a-f0-9]{64}$/);
  for (const patch of [{step: 2}, {target: {...f.target, fingerprint: "d".repeat(64)}}])
    await assert.rejects(inspectStructuredTrainingPlanTask(f.partition, {...f.effect, ...patch}), /owned training/);
  const changedKey = {...f.effect, key: randomUUID()};
  assert.deepEqual(await inspectStructuredTrainingPlanTask(f.partition, changedKey), {kind: "absent"});
  await assert.rejects(f.transaction(owner => reserveStructuredTrainingPlanTask(owner, changedKey, f.proposalDigest, 4)),
    "The existing exact plan index prevents another effect key from reserving a second attempt.");
  assert.equal((await f.partition.listDocuments(namespaces[0])).length, 1);
});

test("point reads require exact original actor/client/workspace/organization and host with no accepted ID exposure to other scopes", async () => {
  const f = await fixture(), taskId = await f.accepted();
  for (const patch of [{principalId: "foreign.actor"}, {registeredClientId: randomUUID()},
    {workspaceId: createWorkspaceId("foreign.workspace")}, {organizationId: createOrganizationId("foreign.organization")}]) {
    const scope = {...f.scope, ...patch};
    assert.equal(await readStructuredOwnedTrainingPlanTask(f.partition, scope, f.host, taskId), undefined);
    assert.equal(await readStructuredOwnedTrainingPlanTaskByPlan(f.partition, scope, f.host, f.target.fingerprint, 1), undefined);
    assert.equal(await readStructuredTrainingPlanAttemptByPlan(f.partition, scope, f.host, f.target.fingerprint, 1), undefined);
    assert.equal(await readStructuredTrainingPlanTaskLineage(f.partition, scope, f.host, taskId), undefined);
  }
  assert.equal(await readStructuredOwnedTrainingPlanTask(f.partition, f.scope, randomUUID(), taskId), undefined);
  assert.equal(await readStructuredOwnedTrainingPlanTask(f.partition, f.scope, f.host, randomUUID()), undefined);
  assert.equal(await readStructuredOwnedTrainingPlanTaskByPlan(f.partition, f.scope, f.host, "d".repeat(64), 1), undefined);
});

test("saved-input/request substitution and self-asserted metadata hashes cannot reserve or reuse an exact task", async () => {
  const f = await fixture();
  await assert.rejects(f.transaction(owner => reserveStructuredTrainingPlanTask(owner, f.effect, "d".repeat(64), 1)), /owned training/);
  const falseDigest = clone(f.effect); Object.assign(falseDigest.binding, {proposalDigest: "sha256:" + "d".repeat(64)});
  await assert.rejects(f.transaction(owner => reserveStructuredTrainingPlanTask(owner, falseDigest, "d".repeat(64), 1)), /owned training/);
  assert.deepEqual(await f.partition.listNamespaces(), []);
  await f.reserve();
  for (const field of ["name", "idempotencyKey", "training"] as const) {
    const effect = clone(f.effect);
    Object.assign(effect.request.input, {[field]: field === "name" ? "Another name" : field === "idempotencyKey" ? randomUUID() : {...effect.request.input.training, commonParameters: {maxSteps: 3}}});
    await assert.rejects(inspectStructuredTrainingPlanTask(f.partition, effect), /owned training/);
  }
});

test("active effect/saved-input/scope values fail before hooks or persistent effects", async () => {
  const f = await fixture(); let hooks = 0;
  const active = Object.defineProperty(clone(f.effect), "request", {enumerable: true, get() {hooks++; return f.effect.request;}});
  const proxy = new Proxy(f.effect, {ownKeys() {hooks++; return [];}, get() {hooks++; return undefined;}});
  const cyclic = Object.assign(clone(f.effect), {extra: {} as Record<string, unknown>}); cyclic.extra.self = cyclic;
  const extra = Object.assign(clone(f.effect), {approvalGranted: true});
  for (const value of [active, proxy, cyclic, extra]) await assert.rejects(f.transaction(owner => reserveStructuredTrainingPlanTask(owner, value, f.proposalDigest, 1)));
  assert.equal(hooks, 0); assert.deepEqual(await f.partition.listNamespaces(), []);
});

test("effect and lookup scope are copied before held store reads", async () => {
  const f = await fixture(), submitted = clone(f.effect);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(done => {enter = done;}), held = new Promise<void>(done => {release = done;});
  const pending = f.transaction(owner => reserveStructuredTrainingPlanTask({...owner, async readDocument<T>(namespace: string, key: string) {
    if (namespace === namespaces[0]) {enter(); await held;}
    return owner.readDocument<T>(namespace, key);
  }}, submitted, f.proposalDigest, 1));
  await entered;
  Object.assign(submitted, {key: randomUUID(), step: 2}); Object.assign(submitted.target.scope, {workspaceId: createWorkspaceId("foreign.workspace")});
  Object.assign(submitted.request.input, {name: "Changed after capture"}); release();
  const first = await pending; assert.ok(first.kind === "new");
  assert.deepEqual(await inspectStructuredTrainingPlanTask(f.partition, f.effect), {kind: "unconfirmed"});
  assert.ok(await f.transaction(owner => issueStructuredTrainingPlanTask(owner, f.effect, first.taskId, f.proposalDigest, 2)));
  assert.ok(await f.transaction(owner => acceptStructuredTrainingPlanTask(owner, f.effect, first.taskId, 3)));
  let ready!: () => void, finish!: () => void;
  const reading = new Promise<void>(done => {ready = done;}), wait = new Promise<void>(done => {finish = done;});
  const scope = {...f.scope};
  const read = readStructuredOwnedTrainingPlanTask({...f.partition, async readDocument<T>(namespace: string, key: string) {
    if (namespace === namespaces[1]) {ready(); await wait;}
    return f.partition.readDocument<T>(namespace, key);
  }}, scope, f.host, first.taskId);
  await reading; Object.assign(scope, {principalId: "foreign.actor", registeredClientId: randomUUID(), workspaceId: createWorkspaceId("foreign.workspace")});
  finish(); assert.deepEqual(await read, {workspaceId: f.scope.workspaceId, taskId: first.taskId});
});

test("both point indexes and saved-input-bound record identity must agree; corruption cannot expose a task", async () => {
  const f = await fixture(), taskId = await f.accepted();
  for (const selected of namespaces.slice(0, 3)) for (const kind of ["missing", "digest", "revision"] as const) {
    const altered: StructuredDocumentStore = {...f.partition, async readDocument<T>(namespace: string, key: string) {
      const row = await f.partition.readDocument<T>(namespace, key);
      if (!row || namespace !== selected) return row;
      if (kind === "missing") return undefined;
      if (kind === "revision") return {...row, revision: row.revision + 1};
      const value = clone(row.value) as Record<string, unknown>;
      if (selected === namespaces[0]) value.proposalDigest = "e".repeat(64);
      else value.identityDigest = "e".repeat(64);
      return {...row, value: value as T};
    }};
    let value: unknown;
    try {value = await readStructuredOwnedTrainingPlanTask(altered, f.scope, f.host, taskId);} catch (error) {assert.match((error as Error).message, /owned training/);}
    assert.equal(value, undefined, selected + kind);
  }
});

test("JSON object key order does not change an accepted canonical owner or index digest", async () => {
  const f = await fixture(), taskId = await f.accepted();
  const reordered: StructuredDocumentStore = {...f.partition, async readDocument<T>(namespace: string, key: string) {
    const row = await f.partition.readDocument<T>(namespace, key);
    if (!row || namespace !== namespaces[0]) return row;
    const value = clone(row.value) as {owner: Record<string, unknown>};
    value.owner = Object.fromEntries(Object.entries(value.owner).reverse());
    return {...row, value: value as T};
  }};
  assert.deepEqual(await readStructuredOwnedTrainingPlanTask(reordered, f.scope, f.host, taskId), {workspaceId: f.scope.workspaceId, taskId});
  assert.deepEqual(await readStructuredTrainingPlanAttemptByPlan(reordered, f.scope, f.host, f.target.fingerprint, 1),
    {kind: "accepted", reference: {workspaceId: f.scope.workspaceId, taskId}});
});

test("existing per-client receipt ceiling and invalid count/time records refuse without writes", async () => {
  for (const variant of ["capacity", "negative", "revision"] as const) {
    const f = await fixture();
    const result = f.transaction(owner => reserveStructuredTrainingPlanTask({...owner, async readDocument<T>(namespace: string, key: string) {
      if (namespace === namespaces[3]) return {namespace, key, revision: variant === "capacity" ? HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE : 1,
        value: {used: variant === "capacity" ? HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE : variant === "negative" ? -1 : 2} as T,
        updatedAt: "2026-11-19T00:00:00.000Z"};
      return owner.readDocument<T>(namespace, key);
    }}, f.effect, f.proposalDigest, 1));
    if (variant === "capacity") assert.deepEqual(await result, {kind: "capacity"}); else await assert.rejects(result, /owned training/);
    assert.deepEqual(await f.partition.listNamespaces(), []);
  }
  const f = await fixture(); await assert.rejects(f.transaction(owner => reserveStructuredTrainingPlanTask(owner, f.effect, f.proposalDigest, 0)), /owned training/);
  assert.deepEqual(await f.partition.listNamespaces(), []);
});

test("accepted exact Training task receipts survive real SQLite reopen without granting another start", async () => {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(path.join(boundary, "headless-training-ledger-")));
  const identity = await lstat(directory, {bigint: true});
  const policy = resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory});
  let db: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  try {
    db = await openLocalSqliteDatabase({policy}); const f = await fixture(db.documents);
    await assert.rejects(f.transaction(owner => reserveStructuredTrainingPlanTask(owner, f.effect, f.proposalDigest, 1),
      () => {throw new Error("Synthetic SQLite commit refusal.");}));
    assert.deepEqual(await f.partition.listNamespaces(), []);
    const taskId = await f.accepted();
    await db.close(); db = undefined; db = await openLocalSqliteDatabase({policy});
    const partition = db.documents.forOrganization(f.scope.organizationId);
    const expected = {kind: "accepted", reference: {workspaceId: f.scope.workspaceId, taskId}};
    assert.deepEqual(await inspectStructuredTrainingPlanTask(partition, f.effect), expected);
    assert.deepEqual(await readStructuredTrainingPlanAttemptByPlan(partition, f.scope, f.host, f.target.fingerprint, 1), expected);
    assert.deepEqual(await db.documents.runInOwnedTransaction!(owner => reserveStructuredTrainingPlanTask(owner.forOrganization(f.scope.organizationId),
      f.effect, f.proposalDigest, 4), () => {}), expected);
  } finally {
    await db?.close(); const current = await lstat(directory, {bigint: true});
    assert.equal(path.dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    await rm(directory, {recursive: true});
  }
});


test("changed valid saved-input digests, actual step and request identity cannot adopt original training work", async () => {
  const f = await fixture(), taskId = await f.accepted();
  let ownershipReads = 0;
  const reader: StructuredDocumentStore = {...f.partition, async readDocument<T>(namespace: string, key: string) {
    if (namespace === namespaces[0]) ownershipReads++;
    return f.partition.readDocument<T>(namespace, key);
  }};
  const changed = clone(f.effect);
  Object.assign(changed.request.input.training.commonParameters, {maxSteps: 3});
  Object.assign(changed.binding, {proposalDigest: "sha256:" + sha({request: changed.request, inputs: changed.binding.inputs})});
  assert.ok(readModelTrainingReviewBindings([changed.binding], [changed.request]), "Changed request must be valid before ownership refusal.");
  await assert.rejects(inspectStructuredTrainingPlanTask(reader, changed), /owned training/);
  assert.ok(ownershipReads > 0, "A valid changed request must reach the original ownership record.");
  ownershipReads = 0;
  const changedMetadata = clone(f.effect);
  Object.assign(changedMetadata.binding.inputs.model, {parameterCount: 64});
  Object.assign(changedMetadata.binding, {proposalDigest: "sha256:" + sha({request: changedMetadata.request, inputs: changedMetadata.binding.inputs})});
  assert.ok(readModelTrainingReviewBindings([changedMetadata.binding], [changedMetadata.request]), "Changed metadata must be valid before ownership refusal.");
  await assert.rejects(inspectStructuredTrainingPlanTask(reader, changedMetadata), /owned training/);
  assert.ok(ownershipReads > 0, "Valid changed metadata must reach the original ownership record.");
  ownershipReads = 0;
  const unknown = clone(f.effect);
  Object.assign(unknown.binding.inputs.model, {displayName: "Unapproved private field"});
  Object.assign(unknown.binding, {proposalDigest: "sha256:" + sha({request: unknown.request, inputs: unknown.binding.inputs})});
  assert.equal(readModelTrainingReviewBindings([unknown.binding], [unknown.request]), undefined);
  await assert.rejects(inspectStructuredTrainingPlanTask(reader, unknown), /owned training/);
  assert.equal(ownershipReads, 0, "An unknown field must fail before reading ownership.");
  await assert.rejects(f.transaction(owner => reserveStructuredTrainingPlanTask(owner, {...f.effect, step: 3}, f.proposalDigest, 4)), /owned training/);
  assert.deepEqual(await readStructuredOwnedTrainingPlanTask(f.partition, f.scope, f.host, taskId), {workspaceId: f.scope.workspaceId, taskId});
});

test("isolated binding decoding retains the exact non-first plan step and never treats metadata as task authority", async () => {
  const f = await fixture();
  const effect = {...f.effect, step: 3, binding: {...f.binding, step: 3}};
  const first = await f.transaction(owner => reserveStructuredTrainingPlanTask(owner, effect, f.proposalDigest, 1));
  assert.ok(first.kind === "new");
  assert.equal(await readStructuredOwnedTrainingPlanTask(f.partition, f.scope, f.host, first.taskId), undefined);
  assert.equal(await readStructuredTrainingPlanAttemptByPlan(f.partition, f.scope, f.host, f.target.fingerprint, 1), undefined);
  assert.deepEqual(await readStructuredTrainingPlanAttemptByPlan(f.partition, f.scope, f.host, f.target.fingerprint, 3), {kind: "unconfirmed"});
});

test("training ownership point reads never enumerate history or persist private request/input contents", async () => {
  const f = await fixture(), taskId = await f.accepted();
  const pointOnly: StructuredDocumentStore = {...f.partition, async listDocuments() {assert.fail("No task history enumeration.");},
    async listNamespaces() {assert.fail("No namespace discovery.");}};
  assert.deepEqual(await readStructuredOwnedTrainingPlanTask(pointOnly, f.scope, f.host, taskId), {workspaceId: f.scope.workspaceId, taskId});
  assert.deepEqual(await readStructuredOwnedTrainingPlanTaskByPlan(pointOnly, f.scope, f.host, f.target.fingerprint, 1), {workspaceId: f.scope.workspaceId, taskId});
  const stored = JSON.stringify(await Promise.all(namespaces.map(namespace => f.partition.listDocuments(namespace))));
  assert.doesNotMatch(stored, /fixture\/base|Private training trial|commonParameters|verification|modelRecordId|datasetId|validation|qualityReport/);
});
