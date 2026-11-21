import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createStructuredDatasetVersionRepository} from "../../../../adapters/persistence/dataset-version";
import {createFilesystemArtifactObjectStorageAdapter} from "../../../../adapters/storage/filesystem/artifact-store";
import {createSha256DatasetVersionHasher} from "../../../../adapters/storage/dataset-version";
import {createStoreArtifactRequest, type RetrieveArtifactRequest, type RetrieveArtifactResult} from "../../../../contracts/storage";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessReadRequest} from "../../../../contracts/headless";
import type {DatasetVersionRecord} from "../../../../contracts/dataset";
import type {ApplicationRequestContext} from "../../../ports";
import {DatasetVersionFinalizationService} from "../../../services/dataset-version/dataset-version-finalization.service";
import {ReadDatasetVersionUseCase} from "../../dataset-version/dataset-version-read.use-cases";
import {ReadHeadlessModelTrainingDatasetUseCase} from "../headless-model-training-dataset.use-case";

const createdAt = "2026-11-21T00:00:00.000Z";
const hash = (content: Uint8Array) => "sha256:" + createHash("sha256").update(content).digest("hex");
const encode = (text: string) => new TextEncoder().encode(text);
type Retrieved = RetrieveArtifactResult<Uint8Array>;
async function fixture(t: TestContext, engine: "Core" | "SQLite" = "Core", split = true, alias?: "dataset" | "test" | "report" | "quarantine" | "source" | "test-content" | "validation-test-content" | "aggregate-content" | "source-content") {
  const parent = await realpath(tmpdir()), directory = await realpath(await mkdtemp(path.join(parent, "headless-training-data-")));
  const identity = await lstat(directory, {bigint: true});
  const database = engine === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  t.after(async () => {
    await database?.close(); const now = await lstat(directory, {bigint: true});
    assert.equal(path.dirname(directory), parent); assert.equal(await realpath(directory), directory);
    assert.ok(now.isDirectory() && !now.isSymbolicLink()); assert.equal(now.dev, identity.dev); assert.equal(now.ino, identity.ino);
    await rm(directory, {recursive: true});
  });
  const organizationId = createOrganizationId("training-data-org"), workspaceId = createWorkspaceId("training-data-workspace");
  const context = {organizationId, workspaceId, principalId: "training-data-principal"};
  const documents = (database?.documents ?? createInMemoryStructuredDocumentStore()).forOrganization(organizationId);
  const repository = createStructuredDatasetVersionRepository(documents);
  const storage = createFilesystemArtifactObjectStorageAdapter({rootDirectory: path.join(directory, "artifacts")});
  const contents = new Map<string, Uint8Array>();
  const artifacts: {role: "dataset" | "train" | "validation" | "test" | "report" | "quarantine"; artifactKey: string; mediaType: string; sizeBytes: number; rowCount: number}[] = [];
  for (const role of split ? ["dataset", "train", "validation", "test"] as const : ["dataset"] as const) {
    const label = (role === "test" && alias === "test-content") || (role === "dataset" && alias === "aggregate-content") ? "train" : role === "test" && alias === "validation-test-content" ? "validation" : role;
    const key = "saved/" + role + ".jsonl", content = encode(JSON.stringify({instruction: "Synthetic " + label, output: "Synthetic answer"}) + "\n");
    const stored = await storage.storeArtifact(createStoreArtifactRequest(content, {descriptor: {key, mediaType: "application/jsonl"}, overwrite: false}), context);
    assert.ok(stored.ok); contents.set(key, content);
    artifacts.push({role, artifactKey: key, mediaType: "application/jsonl", sizeBytes: content.byteLength, rowCount: 1});
  }
  const train = artifacts.find(row => row.role === "train");
  if (alias && train && !["source", "test-content", "validation-test-content", "aggregate-content", "source-content"].includes(alias)) {
    const index = artifacts.findIndex(row => row.role === alias);
    const aliased = {...train, role: alias as "dataset" | "test" | "report" | "quarantine"};
    if (index >= 0) artifacts[index] = aliased;
    else artifacts.push(aliased);
  }
  const hasher = createSha256DatasetVersionHasher();
  const saved = (await new DatasetVersionFinalizationService({repository, artifacts: storage, hasher}).finalize({
    organizationId, workspaceId, createdBy: context.principalId, datasetName: "Synthetic training dataset", createdAt,
    recipeSnapshot: {recipe: {task: {taskType: "llm-instruction"}}, format: "jsonl", synthetic: true},
    recipeImplementation: {id: "prepare", version: "1"},
    sources: [{sourceArtifactId: "synthetic-source", artifactKey: alias === "source" ? train!.artifactKey : "sources/never-read.csv",
      digest: alias === "source" || alias === "source-content" ? hasher.digest(contents.get(train!.artifactKey)!) : hasher.digest("synthetic source"),
      mediaType: alias === "source" ? "application/jsonl" : "text/csv"}],
    artifacts, ...(split ? {split: {strategy: "random", seed: 42}} : {}),
    quality: {policyId: "synthetic", policyVersion: "1", policyFingerprint: hasher.digest("policy"), reportFingerprint: hasher.digest("report")},
    documentation: {name: "Synthetic dataset", summary: "Synthetic only", intendedUses: ["Feature test"], limitations: ["No model executed"], license: "Non-open test data"},
    totalRows: 1,
  }, context)).version;
  const state = {current: true, allowed: true, workspaceAllowed: true, reads: 0, policies: 0,
    beforeVersion: undefined as (() => Promise<void>) | undefined,
    transformVersion: undefined as ((record: DatasetVersionRecord, count: number) => unknown) | undefined,
    transformReply: undefined as ((reply: Retrieved, request: RetrieveArtifactRequest) => unknown) | undefined,
    beforeRetrieve: undefined as (() => Promise<void>) | undefined,
    policy: undefined as (() => Promise<unknown>) | undefined,
    retrieved: [] as RetrieveArtifactRequest[], observedContexts: [] as ApplicationRequestContext[]};
  const versions = new ReadDatasetVersionUseCase({repository,
    workspaceRepository: {async readWorkspace(id) {return id === workspaceId ? {workspaceId, organizationId, displayName: "Synthetic", status: "active", createdAt, updatedAt: createdAt} : undefined;}},
    workspaceAuthorization: {async authorizeWorkspaceOperation() {if (!state.workspaceAllowed) throw new Error("Synthetic private policy detail");}},
  });
  const versionOwner = {async execute(...args: Parameters<ReadDatasetVersionUseCase["execute"]>) {
    assert.equal(this, versionOwner); state.reads++; await state.beforeVersion?.();
    const value = await versions.execute(...args);
    return (value && state.transformVersion ? state.transformVersion(value, state.reads) : value) as DatasetVersionRecord | undefined;
  }};
  const artifactsOwner = {retrieveArtifact: (async function(this: unknown, request: RetrieveArtifactRequest, actor?: ApplicationRequestContext) {
    assert.equal(this, artifactsOwner); assert.deepEqual(actor, context);
    state.retrieved.push(request); state.observedContexts.push(actor!); await state.beforeRetrieve?.();
    const reply = await storage.retrieveArtifact<Uint8Array>(request, actor);
    return state.transformReply ? state.transformReply(reply, request) : reply;
  }) as typeof storage.retrieveArtifact};
  const hostIncarnationId = randomUUID(); assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const authority = {hostIncarnationId, context, clientId: randomUUID(),
    isCurrent() {assert.equal(this, authority); return state.current;},
    async stillAllowed() {assert.equal(this, authority); state.policies++; return state.policy ? await state.policy() === true : state.allowed;},
  };
  const request = {version: HEADLESS_CONTRACT_VERSION, operation: "models.train" as const, input: {
    hostIncarnationId, workspaceId, idempotencyKey: randomUUID(), name: "Synthetic adapter", model: {modelRecordId: "model.synthetic", updatedAt: createdAt},
    dataset: {datasetId: saved.datasetId, versionId: saved.versionId, versionDigest: saved.versionDigest},
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 1, batchSize: 1, seed: 0}},
  }};
  const owner = new ReadHeadlessModelTrainingDatasetUseCase({organizationId, versions: versionOwner, artifacts: artifactsOwner});
  return {owner, request, authority, saved, state, versionOwner, artifactsOwner, contents};
}
for (const engine of ["Core", "SQLite"] as const) test("exact saved training/validation bytes and recipe, with real " + engine + " and scoped filesystem storage", async t => {
  const f = await fixture(t, engine), result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok);
  assert.equal(f.state.reads, 2); assert.equal(f.state.retrieved.length, 3);
  assert.deepEqual(result.prepared.contents.map(row => row.role), ["train", "validation"]);
  for (const row of result.prepared.contents) {
    assert.deepEqual(row.content, f.contents.get(row.artifact.artifactKey)); assert.equal(hash(row.content), row.artifact.digest);
    assert.notEqual(row.content, f.contents.get(row.artifact.artifactKey));
    assert.ok(Object.isFrozen(row) && Object.isFrozen(row.artifact));
  }
  assert.equal(hash(result.prepared.recipe.content), f.saved.lineage.recipe.digest);
  for (const request of f.state.retrieved) {
    assert.ok(!/dataset\.jsonl|test\.jsonl|sources\/|documentation\//.test(request.key));
    const artifact = f.saved.artifacts.find(row => row.artifactKey === request.key)!;
    assert.equal(request.maximumBytes, artifact.sizeBytes);
  }
  assert.deepEqual(result.prepared.verification, {datasetBytes: "copied-and-verified", recipeBytes: "copied-and-verified", modelBytes: "not-checked",
    trainingCompatibility: "not-checked", runtimeReadiness: "not-checked", resourceAdmission: "not-checked", licenseRights: "not-checked", quality: "not-checked"});
  assert.equal(result.prepared.trainingApproval, "required"); assert.equal(result.prepared.resultSaveApproval, "required");
  assert.equal(result.prepared.version.documentation.license, "Non-open test data");
  assert.ok(Object.isFrozen(result.prepared) && Object.isFrozen(result.prepared.contents) && Object.isFrozen(result.prepared.version));
  assert.equal(parseHeadlessReadRequest(f.request, f.authority.hostIncarnationId).ok, false);
});
test("only a saved unsplit dataset can substitute for an absent training split", async t => {
  const f = await fixture(t, "Core", false), result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok);
  assert.equal(result.prepared.contents.length, 1); assert.equal(result.prepared.contents[0]!.role, "train");
  assert.equal(f.state.retrieved[0]?.key, "saved/dataset.jsonl");
});
for (const name of ["missing-train", "only-test", "duplicate-key", "too-many", "unsupported-format", "empty", "oversize", "aggregate", "recipe-missing",
  "recipe-conflict", "recipe-oversize", "recipe-duplicate", "recipe-overlap"] as const) test("refuse invalid saved artifact selection before any byte read: " + name, async t => {
  const f = await fixture(t);
  f.state.transformVersion = value => {
    const v = structuredClone(value), train = v.artifacts.find(row => row.role === "train")!;
    const recipe = v.artifacts.find(row => row.role === "recipe")!;
    switch (name) {
      case "missing-train": return {...v, artifacts: v.artifacts.filter(row => row.role !== "train")};
      case "only-test": return {...v, lineage: {...v.lineage, split: undefined}, artifacts: v.artifacts.filter(row => ["dataset", "test", "recipe"].includes(row.role))};
      case "duplicate-key": return {...v, artifacts: v.artifacts.map(row => row.role === "validation" ? {...row, artifactKey: train.artifactKey} : row)};
      case "too-many": return {...v, artifacts: [...v.artifacts, ...Array.from({length: 16}, (_, i) => ({...train, artifactKey: "saved/train-" + i + ".jsonl"}))]};
      case "unsupported-format": return {...v, artifacts: v.artifacts.map(row => row.role === "train" ? {...row, mediaType: "application/pickle"} : row)};
      case "empty": return {...v, artifacts: v.artifacts.map(row => row.role === "train" ? {...row, sizeBytes: 0} : row)};
      case "oversize": return {...v, artifacts: v.artifacts.map(row => row.role === "train" ? {...row, sizeBytes: 64 * 1024 * 1024 + 1} : row)};
      case "aggregate": return {...v, artifacts: [...v.artifacts, ...Array.from({length: 5}, (_, i) => ({...train, artifactKey: "saved/large-" + i + ".jsonl", sizeBytes: 64 * 1024 * 1024}))]};
      case "recipe-missing": return {...v, artifacts: v.artifacts.filter(row => row.role !== "recipe")};
      case "recipe-conflict": return {...v, lineage: {...v.lineage, recipe: {...v.lineage.recipe, digest: "sha256:" + "f".repeat(64)}}};
      case "recipe-oversize": return {...v, artifacts: v.artifacts.map(row => row.role === "recipe" ? {...row, sizeBytes: 512 * 1024 + 1} : row)};
      case "recipe-duplicate": return {...v, artifacts: [...v.artifacts, {...recipe, artifactKey: "recipes/other.json"}]};
      case "recipe-overlap": return {...v, artifacts: v.artifacts.map(row => row.role === "train" ? {...row, artifactKey: recipe.artifactKey} : row)};
    }
  };
  assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"});
  assert.equal(f.state.retrieved.length, 0);
});
for (const name of ["digest", "size", "descriptor-key", "descriptor-size", "descriptor-media", "shared-bytes", "active-content", "proxy-descriptor", "provider-error"] as const)
test("deny corrupt or active storage without partial data: " + name, async t => {
  const f = await fixture(t); let hooks = 0;
  f.state.transformReply = reply => {
    assert.ok(reply.ok);
    switch (name) {
      case "digest": return {...reply, value: {...reply.value, content: new Uint8Array(reply.value.content.byteLength).fill(65)}};
      case "size": return {...reply, value: {...reply.value, content: new Uint8Array([1])}};
      case "descriptor-key": return {...reply, value: {...reply.value, descriptor: {...reply.value.descriptor, key: "foreign/secret.jsonl"}}};
      case "descriptor-size": return {...reply, value: {...reply.value, descriptor: {...reply.value.descriptor, sizeBytes: 1}}};
      case "descriptor-media": return {...reply, value: {...reply.value, descriptor: {...reply.value.descriptor, mediaType: "application/pickle"}}};
      case "shared-bytes": return {...reply, value: {...reply.value, content: new Uint8Array(new SharedArrayBuffer(reply.value.content.byteLength))}};
      case "active-content": return {...reply, value: {descriptor: reply.value.descriptor, get content() {hooks++; throw new Error("Synthetic private row");}}};
      case "proxy-descriptor": return {...reply, value: {...reply.value, descriptor: new Proxy(reply.value.descriptor, {getPrototypeOf() {hooks++; throw new Error("Synthetic private descriptor");}})}};
      case "provider-error": throw new Error("Synthetic private storage error");
    }
  };
  assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"});
  assert.equal(hooks, 0); assert.equal(f.state.retrieved.length, 1);
});
test("recipe corruption denies the whole private preparation", async t => {
  const f = await fixture(t); f.state.transformReply = (reply, request) => {
    assert.ok(reply.ok); return request.key === f.saved.lineage.recipe.artifactKey ? {...reply, value: {...reply.value, content: new Uint8Array(reply.value.content.byteLength).fill(65)}} : reply;
  };
  assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"}); assert.equal(f.state.retrieved.length, 3);
});
for (const name of ["workspace-policy", "principal", "organization", "host", "client", "callback", "async-current", "policy-nonboolean"] as const)
test("original actor/client/host and literal policy are required: " + name, async t => {
  const f = await fixture(t);
  switch (name) {
    case "workspace-policy": f.state.workspaceAllowed = false; break;
    case "principal": f.authority.context.principalId = ""; break;
    case "organization": f.authority.context.organizationId = createOrganizationId("foreign"); break;
    case "host": f.authority.hostIncarnationId = randomUUID() as typeof f.authority.hostIncarnationId; break;
    case "client": f.authority.clientId = "" as never; break;
    case "callback": f.authority.isCurrent = new Proxy(f.authority.isCurrent, {apply() {throw new Error("Must not execute.");}}); break;
    case "async-current": f.authority.isCurrent = (() => Promise.reject(new Error("Must be synchronous."))) as never; break;
    case "policy-nonboolean": f.state.policy = async () => 1; break;
  }
  const result = await f.owner.execute(f.request, f.authority); assert.equal(result.ok, false);
  assert.equal(f.state.retrieved.length, 0);
});
test("a stale version digest cannot read bytes", async t => {
  const f = await fixture(t); f.request.input.dataset.versionDigest = ("sha256:" + "b".repeat(64)) as never;
  assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.stale"}); assert.equal(f.state.retrieved.length, 0);
});
for (const field of ["organizationId", "workspaceId", "datasetId", "versionId", "versionDigest", "documentation"] as const)
test("foreign or changed version refuses preparation: " + field, async t => {
  const f = await fixture(t); f.state.transformVersion = (value, count) => {
    if (count === 1 && ["versionDigest", "documentation"].includes(field)) return value;
    return {...value, [field]: field === "documentation" ? {...value.documentation, summary: "Changed"} : field === "versionDigest" ? "sha256:" + "f".repeat(64) : "foreign"};
  };
  const result = await f.owner.execute(f.request, f.authority); assert.equal(result.ok, false);
  if (field === "versionDigest" || field === "documentation") {assert.deepEqual(result, {ok: false, code: "headless.stale"}); assert.equal(f.state.reads, 2);}
  else assert.equal(f.state.retrieved.length, 0);
});
test("request and original reader methods are captured before the first policy wait", async t => {
  const f = await fixture(t);
  let count = 0;
  f.state.policy = async () => {
    if (++count === 1) {
      f.request.input.dataset.versionId = "changed" as never; f.request.input.name = "Changed";
      f.versionOwner.execute = async () => {throw new Error("Replacement must not run");};
      f.artifactsOwner.retrieveArtifact = async () => {throw new Error("Replacement must not run");};
    }
    return true;
  };
  const result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok);
  assert.equal(result.prepared.request.input.dataset.versionId, f.saved.versionId); assert.equal(result.prepared.request.input.name, "Synthetic adapter");
});
for (const handoff of ["initial-policy", "version-read", "artifact-read", "artifact-policy", "final-version", "final-policy"] as const)
test("retirement at original read/return handoff denies: " + handoff, async t => {
  const f = await fixture(t);
  if (handoff === "initial-policy") f.state.policy = async () => {queueMicrotask(() => queueMicrotask(() => {f.state.current = false;})); return true;};
  if (handoff === "version-read") f.state.beforeVersion = async () => {f.state.current = false;};
  if (handoff === "artifact-read") f.state.beforeRetrieve = async () => {f.state.current = false;};
  if (handoff === "artifact-policy") f.state.policy = async () => {if (f.state.retrieved.length) f.state.current = false; return true;};
  if (handoff === "final-version") f.state.transformVersion = (value, count) => {if (count === 2) f.state.current = false; return value;};
  if (handoff === "final-policy") f.state.policy = async () => {if (f.state.reads === 2) queueMicrotask(() => queueMicrotask(() => {f.state.current = false;})); return true;};
  assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
  if (handoff === "initial-policy") assert.equal(f.state.reads, 0);
  if (handoff === "version-read") assert.equal(f.state.retrieved.length, 0);
});
test("late storage mutation cannot change copied bytes during final policy waits", async t => {
  const f = await fixture(t); const originals: Uint8Array[] = [];
  f.state.transformReply = reply => {assert.ok(reply.ok); originals.push(reply.value.content); return reply;};
  f.state.policy = async () => {for (const original of originals) original.fill(0); return true;};
  const result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok);
  for (const content of result.prepared.contents) assert.equal(hash(content.content), content.artifact.digest);
  assert.equal(hash(result.prepared.recipe.content), result.prepared.recipe.artifact.digest);
});
test("typed-array subclass and species hooks are never executed", async t => {
  const f = await fixture(t); let hooks = 0;
  class ActiveBytes extends Uint8Array {static get [Symbol.species]() {hooks++; throw new Error("Must not execute.");}}
  f.state.transformReply = reply => {assert.ok(reply.ok); return {...reply, value: {...reply.value, content: new ActiveBytes(reply.value.content)}};};
  const result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok); assert.equal(hooks, 0);
});

for (const alias of ["dataset", "test", "report", "quarantine", "source", "test-content", "validation-test-content"] as const)
test("recorded role/content aliases deny before any bytes from an actual finalized saved version: " + alias, async t => {
  const f = await fixture(t, "Core", true, alias);
  const train = f.saved.artifacts.find(row => row.role === "train")!;
  if (alias === "test-content" || alias === "validation-test-content") {
    const selected = f.saved.artifacts.find(row => row.role === (alias === "test-content" ? "train" : "validation"))!;
    const heldout = f.saved.artifacts.find(row => row.role === "test")!;
    assert.notEqual(selected.artifactKey, heldout.artifactKey); assert.equal(selected.digest, heldout.digest);
  } else if (alias === "source") assert.equal(train.artifactKey, f.saved.lineage.sources[0]!.artifactKey);
  else assert.equal(train.artifactKey, f.saved.artifacts.find(row => row.role === alias)!.artifactKey);
  assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"});
  assert.equal(f.state.reads, 1); assert.equal(f.state.retrieved.length, 0);
});

for (const alias of ["aggregate-content", "source-content"] as const)
test("distinct saved source/aggregate keys can legitimately retain selected training content: " + alias, async t => {
  const f = await fixture(t, "Core", true, alias), train = f.saved.artifacts.find(row => row.role === "train")!;
  const original = alias === "aggregate-content" ? f.saved.artifacts.find(row => row.role === "dataset")! : f.saved.lineage.sources[0]!;
  assert.notEqual(original.artifactKey, train.artifactKey); assert.equal(original.digest, train.digest);
  const result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok);
  assert.equal(f.state.retrieved.length, 3); assert.ok(f.state.retrieved.every(request => request.key !== original.artifactKey));
});
