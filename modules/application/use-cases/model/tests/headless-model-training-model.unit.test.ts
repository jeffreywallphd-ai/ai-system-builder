import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm, access} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model/createLocalModelRegistryAdapter";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessReadRequest,
  readHeadlessModelTrainingInputsResult} from "../../../../contracts/headless";
import type {ModelInventoryRecord} from "../../../../contracts/model";
import {organizationId, workspaceId, principalId, createdAt, version as datasetVersion} from "../../dataset-version/tests/headless-dataset-metadata.fixture";
import {ReadHeadlessModelMetadataUseCase} from "../headless-model-metadata.use-case";
import {ReadHeadlessModelTrainingModelUseCase} from "../headless-model-training-model.use-case";

async function fixture(t: TestContext, storage: "Core" | "SQLite" = "Core") {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(path.join(boundary, "training-model-")));
  const original = await lstat(directory, {bigint: true});
  const database = storage === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  t.after(async () => {await database?.close(); const now = await lstat(directory, {bigint: true});
    assert.equal(path.dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert.ok(now.isDirectory() && !now.isSymbolicLink()); assert.equal(now.dev, original.dev); assert.equal(now.ino, original.ino);
    await rm(directory, {recursive: true});});
  const documents = (database?.documents ?? createInMemoryStructuredDocumentStore()).forOrganization(organizationId);
  const registry = createLocalModelRegistryAdapter({documents, rootDirectory: directory, filePath: path.join(directory, "unused.json"),
    discovery: {enabled: false}, now: () => createdAt});
  const localPath = path.join(directory, "not-created", "model");
  await registry.registerDownloadedModel({workspaceId, modelRecordId: "model.synthetic", displayName: "Private model display label",
    provider: "huggingface", source: "local", modelId: "fixture/model", localPath, artifactForm: "full-model",
    inferenceMode: "causal", serializationFormat: "safetensors", metadata: {privatePrompt: "synthetic-private-do-not-disclose"}});
  const state = {current: true, allowed: true, policies: 0, metadataReads: 0, privateReads: 0,
    policy: undefined as (() => Promise<unknown>) | undefined,
    privateTransform: undefined as ((value: ModelInventoryRecord, count: number) => unknown) | undefined,
    metadataTransform: undefined as ((value: unknown, count: number) => unknown) | undefined,
    beforePrivate: undefined as (() => Promise<void>) | undefined,
    beforeMetadata: undefined as (() => Promise<void>) | undefined};
  const modelMetadata = new ReadHeadlessModelMetadataUseCase({organizationId, models: {
    readRecordedModel: registry.readRecordedModel!.bind(registry), async listModels() {assert.fail("No discovery/listing.");}}});
  const metadataOwner = {async execute(...args: Parameters<ReadHeadlessModelMetadataUseCase["execute"]>) {
    assert.equal(this, metadataOwner); state.metadataReads++; await state.beforeMetadata?.();
    const value = await modelMetadata.execute(...args);
    return (state.metadataTransform ? state.metadataTransform(value, state.metadataReads) : value) as typeof value;
  }};
  const models = {async readRecordedModel(...args: Parameters<NonNullable<typeof registry.readRecordedModel>>) {
    assert.equal(this, models); assert.deepEqual(args, [workspaceId, "model.synthetic"]);
    state.privateReads++; await state.beforePrivate?.(); const value = await registry.readRecordedModel!(...args);
    return (value && state.privateTransform ? state.privateTransform(value, state.privateReads) : value) as typeof value;
  }};
  const context = {organizationId, workspaceId, principalId};
  const hostIncarnationId = randomUUID(); assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const authority = {hostIncarnationId, context, clientId: randomUUID(),
    isCurrent() {assert.equal(this, authority); return state.current;},
    async stillAllowed() {assert.equal(this, authority); state.policies++; return state.policy ? await state.policy() === true : state.allowed;}};
  const dataset = datasetVersion(1);
  const request = {version: HEADLESS_CONTRACT_VERSION, operation: "models.train", input: {hostIncarnationId, workspaceId,
    model: {modelRecordId: "model.synthetic", updatedAt: createdAt},
    dataset: {datasetId: dataset.datasetId, versionId: dataset.versionId, versionDigest: dataset.versionDigest},
    idempotencyKey: randomUUID(), name: "synthetic-training", training: {
      trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 1, batchSize: 1, maxSequenceLength: 64}}}};
  const dependencies = {organizationId, metadata: metadataOwner, models};
  return {state, authority, context, request, dependencies, registry, localPath,
    owner: new ReadHeadlessModelTrainingModelUseCase(dependencies)};
}
const failure = (code: string) => ({ok: false, code});

for (const storage of ["Core", "SQLite"] as const) test(`${storage} returns only the private recorded selection without inspecting model files`, async t => {
  const f = await fixture(t, storage), result = await f.owner.execute(f.request, f.authority);
  assert.ok(result.ok);
  assert.equal(result.prepared.localModelReference, f.localPath);
  assert.equal(result.prepared.model.modelRecordId, "model.synthetic");
  assert.equal(result.prepared.request.input.idempotencyKey, f.request.input.idempotencyKey);
  assert.match(result.prepared.selectionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(f.state.privateReads, 2); assert.equal(f.state.metadataReads, 2);
  assert.ok(Object.values(result.prepared.verification).every(value => value === "not-checked"));
  assert.equal(result.prepared.trainingApprovalRequired, true); assert.equal(result.prepared.resultSaveApprovalRequired, true);
  for (const value of [result.prepared, result.prepared.request, result.prepared.model, result.prepared.model.taskTags, result.prepared.verification])
    assert.ok(Object.isFrozen(value));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-do-not-disclose|Private model display label|"metadata"/);
  await assert.rejects(access(f.localPath)); // Even a nonexistent recorded directory grants no file/load assertion.
  assert.equal(parseHeadlessReadRequest(f.request, f.authority.hostIncarnationId).ok, false);
  assert.equal(readHeadlessModelTrainingInputsResult(result, f.request.input).ok, false);
  const again = await f.owner.execute(f.request, f.authority); assert.ok(again.ok);
  assert.equal(again.prepared.selectionDigest, result.prepared.selectionDigest);
});

test("caller paths and malformed/foreign selectors deny before any lookup", async t => {
  const f = await fixture(t);
  for (const patch of [{localPath: f.localPath}, {runtimeId: "injected"}, {model: {...f.request.input.model, localPath: f.localPath}},
    {model: {modelRecordId: "../foreign", updatedAt: createdAt}}])
    assert.deepEqual(await f.owner.execute({...f.request, input: {...f.request.input, ...patch}}, f.authority), failure("headless.invalid-request"));
  assert.deepEqual(await f.owner.execute({...f.request, input: {...f.request.input, hostIncarnationId: randomUUID()}}, f.authority), failure("headless.host-changed"));
  assert.equal(f.state.metadataReads, 0); assert.equal(f.state.privateReads, 0);
});

test("wrong actor, workspace, client and original callback identity deny", async t => {
  for (const target of ["organization", "principal", "workspace", "client", "host", "context", "callback"] as const) {
    const f = await fixture(t);
    if (target === "organization") Object.assign(f.context, {organizationId: "foreign-org"});
    if (target === "principal") f.context.principalId = "";
    if (target === "workspace") Object.assign(f.context, {workspaceId: "foreign-workspace"});
    if (target === "client") Object.assign(f.authority, {clientId: "invalid"});
    if (target === "host") Object.assign(f.authority, {hostIncarnationId: "invalid"});
    if (target === "context") f.state.policy = async () => {f.authority.context = {...f.context}; return true;};
    if (target === "callback") f.state.policy = async () => {f.authority.isCurrent = () => true; return true;};
    const result = await f.owner.execute(f.request, f.authority); assert.equal(result.ok, false, target);
    assert.equal(f.state.privateReads, 0, target);
  }
});

test("every original policy handoff can withdraw read permission without a partial result", async t => {
  const baseline = await fixture(t); assert.ok((await baseline.owner.execute(baseline.request, baseline.authority)).ok);
  for (let limit = 0; limit < baseline.state.policies; limit++) {
    const f = await fixture(t); f.state.policy = async () => f.state.policies <= limit;
    const result = await f.owner.execute(f.request, f.authority);
    assert.deepEqual(result, failure("headless.forbidden"), `handoff ${limit}`);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private|localModelReference|prepared/);
  }
});

test("lost currentness during either private point read denies", async t => {
  for (const count of [1, 2]) {
    const f = await fixture(t);
    f.state.privateTransform = (record, at) => {if (at === count) f.state.current = false; return record;};
    assert.deepEqual(await f.owner.execute(f.request, f.authority), failure("headless.forbidden"));
  }
});

test("stale model timestamp denies before private reference reads", async t => {
  const f = await fixture(t); f.request.input.model.updatedAt = "2025-01-01T00:00:00.000Z";
  assert.deepEqual(await f.owner.execute(f.request, f.authority), failure("headless.stale"));
  assert.equal(f.state.privateReads, 0);
});

test("private path changes without an updated timestamp remain stale", async t => {
  const f = await fixture(t);
  f.state.privateTransform = (record, count) => count === 2 ? {...record, localPath: path.join(f.localPath, "replacement")} : record;
  assert.deepEqual(await f.owner.execute(f.request, f.authority), failure("headless.stale"));
});

test("missing persisted records and a mismatched private summary never grant a reference", async t => {
  const absent = await fixture(t); absent.request.input.model.modelRecordId = "model.absent";
  assert.deepEqual(await absent.owner.execute(absent.request, absent.authority), failure("headless.not-found"));
  assert.equal(absent.state.privateReads, 0);
  for (const count of [1, 2]) {
    const f = await fixture(t); f.state.privateTransform = (record, at) => at === count ? undefined : record;
    assert.deepEqual(await f.owner.execute(f.request, f.authority), failure(count === 1 ? "headless.not-found" : "headless.stale"));
  }
  const changed = await fixture(t); changed.state.privateTransform = record => ({...record, modelId: "foreign/model"});
  assert.deepEqual(await changed.owner.execute(changed.request, changed.authority), failure("headless.stale"));
});

test("changed public metadata cannot retarget an already read private record", async t => {
  const f = await fixture(t);
  f.state.metadataTransform = (raw, count) => {
    const value = raw as {ok: true; value: {model: {modelId: string}}};
    return count === 2 ? {...value, value: {...value.value, model: {...value.value.model, modelId: "foreign/model"}}} : raw;
  };
  assert.deepEqual(await f.owner.execute(f.request, f.authority), failure("headless.stale"));
});

test("reader methods and receivers are captured before permission waits", async t => {
  const f = await fixture(t); let substitutions = 0;
  f.state.policy = async () => {
    Object.assign(f.dependencies.models, {readRecordedModel: async () => {substitutions++; throw new Error("substituted");}});
    Object.assign(f.dependencies.metadata, {execute: async () => {substitutions++; throw new Error("substituted");}});
    return true;
  };
  assert.ok((await f.owner.execute(f.request, f.authority)).ok);
  assert.equal(f.state.privateReads, 2); assert.equal(f.state.metadataReads, 2); assert.equal(substitutions, 0);
});

test("unselected private getters never run; a selected path accessor refuses without evaluation", async t => {
  for (const selected of [false, true]) {
    const f = await fixture(t); let getters = 0;
    f.state.privateTransform = record => {
      Object.defineProperty(record, selected ? "localPath" : "metadata", {enumerable: true, get() {getters++; throw new Error("synthetic-private");}});
      return record;
    };
    const result = await f.owner.execute(f.request, f.authority);
    assert.equal(result.ok, !selected); assert.equal(getters, 0);
    if (!result.ok) assert.doesNotMatch(JSON.stringify(result), /synthetic-private/);
  }
});

test("active metadata replies cannot evaluate ok or Proxy hooks", async t => {
  for (const variant of ["accessor", "proxy"] as const) {
    const f = await fixture(t); let hooks = 0;
    // Promise resolution necessarily queries `then` before an async port's
    // value reaches the reader. No metadata access or reflection may follow.
    f.state.metadataTransform = () => variant === "proxy" ? new Proxy({}, {get(_target, key) {if (key === "then") return; hooks++; throw new Error("private");}, ownKeys() {hooks++; throw new Error("private");}})
      : Object.defineProperty({}, "ok", {enumerable: true, get() {hooks++; throw new Error("private");}});
    assert.deepEqual(await f.owner.execute(f.request, f.authority), failure("headless.unavailable")); assert.equal(hooks, 0);
  }
});

test("active authority, context and request values deny without property hooks", async t => {
  for (const variant of ["authority-proxy", "authority-getter", "context-getter", "request-proxy", "request-getter"] as const) {
    const f = await fixture(t); let hooks = 0;
    let authority = f.authority, request = f.request;
    const getter = {enumerable: true, get() {hooks++; throw new Error("synthetic-private");}};
    if (variant === "authority-proxy") authority = new Proxy(authority, {get() {hooks++; throw new Error("private");}});
    if (variant === "authority-getter") Object.defineProperty(authority, "clientId", getter);
    if (variant === "context-getter") Object.defineProperty(authority.context, "principalId", getter);
    if (variant === "request-proxy") request = new Proxy(request, {ownKeys() {hooks++; throw new Error("private");}});
    if (variant === "request-getter") Object.defineProperty(request.input.model, "modelRecordId", getter);
    assert.equal((await f.owner.execute(request, authority)).ok, false);
    assert.equal(hooks, 0); assert.equal(f.state.privateReads, 0); assert.equal(f.state.metadataReads, 0);
  }
});

test("caller changes during a metadata await cannot change the captured selection", async t => {
  const f = await fixture(t); const originalKey = f.request.input.idempotencyKey;
  f.state.beforeMetadata = async () => {
    f.request.input.name = "changed caller name"; f.request.input.model.modelRecordId = "model.other";
    f.request.input.idempotencyKey = randomUUID();
  };
  const result = await f.owner.execute(f.request, f.authority);
  assert.ok(result.ok); assert.equal(result.prepared.request.input.model.modelRecordId, "model.synthetic");
  assert.equal(result.prepared.request.input.name, "synthetic-training"); assert.equal(result.prepared.request.input.idempotencyKey, originalKey);
});

test("relative, network, oversized and control-character recorded paths refuse", async t => {
  for (const localPath of ["relative/model", "//server/model", "\\\\server\\model", path.sep + "a".repeat(4097), path.sep + "private\nmodel", ""]) {
    const f = await fixture(t); f.state.privateTransform = record => ({...record, localPath});
    assert.deepEqual(await f.owner.execute(f.request, f.authority), failure("headless.unavailable"));
  }
});

test("wrong-workspace, missing and unsupported private selections never grant a reference", async t => {
  for (const patch of [{workspaceId: "foreign-workspace"}, {modelRecordId: "foreign-model"}, {artifactForm: "adapter"},
    {serializationFormat: "adapter-safetensors"}, {inferenceMode: "embedding"}, {localPath: undefined}]) {
    const f = await fixture(t); f.state.privateTransform = record => ({...record, ...patch});
    assert.equal((await f.owner.execute(f.request, f.authority)).ok, false);
  }
  const f = await fixture(t); Object.assign(f.dependencies.models, {readRecordedModel: undefined});
  assert.deepEqual(await f.owner.execute(f.request, f.authority), failure("headless.unavailable"));
  f.state.allowed = false;
  assert.deepEqual(await f.owner.execute(f.request, f.authority), failure("headless.forbidden"));
});

test("async current fences and failed readers return finite errors without private diagnostics", async t => {
  const f = await fixture(t); Object.assign(f.authority, {isCurrent: () => Promise.reject(new Error("synthetic-private"))});
  assert.deepEqual(await f.owner.execute(f.request, f.authority), failure("headless.forbidden"));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.state.metadataReads, 0);
  const failed = await fixture(t); failed.state.beforePrivate = async () => {throw new Error("synthetic-private /private/model");};
  const result = await failed.owner.execute(failed.request, failed.authority);
  assert.deepEqual(result, failure("headless.unavailable")); assert.doesNotMatch(JSON.stringify(result), /synthetic-private|\/private\/model/);
});
