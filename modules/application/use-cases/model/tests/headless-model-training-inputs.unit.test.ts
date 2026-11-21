import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model/createLocalModelRegistryAdapter";
import {createStructuredDatasetVersionRepository} from "../../../../adapters/persistence/dataset-version";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {normalizeDatasetVersionId, normalizeDatasetVersionDigest} from "../../../../contracts/dataset";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId} from "../../../../contracts/headless";
import {ReadDatasetVersionUseCase} from "../../dataset-version/dataset-version-read.use-cases";
import {ReadHeadlessDatasetMetadataUseCase} from "../../dataset-version/headless-dataset-metadata.use-case";
import {version as datasetVersion, organizationId, workspaceId, principalId, createdAt} from "../../dataset-version/tests/headless-dataset-metadata.fixture";
import {ReadHeadlessModelMetadataUseCase} from "../headless-model-metadata.use-case";
import {PreviewHeadlessModelTrainingInputsUseCase} from "../headless-model-training-inputs.use-case";

async function fixture(t: TestContext, storage: "Core" | "SQLite") {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(path.join(boundary, "training-input-review-")));
  const identity = await lstat(directory, {bigint: true});
  const database = storage === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  t.after(async () => {await database?.close(); const current = await lstat(directory, {bigint: true});
    assert.equal(path.dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    await rm(directory, {recursive: true});});
  const root = database?.documents ?? createInMemoryStructuredDocumentStore(), documents = root.forOrganization(organizationId);
  const state = {current: true, allowed: true, models: 0, datasets: 0, modelTime: createdAt,
    onModel: undefined as ((count: number) => Promise<void>) | undefined, onDataset: undefined as (() => Promise<void>) | undefined};
  const registry = createLocalModelRegistryAdapter({documents, rootDirectory: directory, filePath: path.join(directory, "unused-registry.json"),
    discovery: {enabled: false}, now: () => state.modelTime});
  await registry.registerDownloadedModel({workspaceId, modelRecordId: "model.synthetic", displayName: "Synthetic private display name",
    source: "local", provider: "huggingface", modelId: "fixture/model", localPath: "C:/synthetic-private/model", artifactForm: "full-model",
    serializationFormat: "safetensors", metadata: {syntheticPrivatePrompt: "Never include source text in a preview."}});
  const repository = createStructuredDatasetVersionRepository(documents), saved = await repository.createVersion(datasetVersion(1));
  const models = new ReadHeadlessModelMetadataUseCase({organizationId, models: {
    async readRecordedModel(...args) {state.models++; const result = await registry.readRecordedModel!(...args); await state.onModel?.(state.models); return result;},
    async listModels() {assert.fail("No history scan or file discovery.");}}});
  const versions = new ReadDatasetVersionUseCase({repository: {...repository,
    async readVersion(...args) {state.datasets++; const result = await repository.readVersion(...args); await state.onDataset?.(); return result;},
    async listVersions() {assert.fail("No dataset history scan.");}},
    workspaceRepository: {async readWorkspace(id) {return id === workspaceId ? {workspaceId, organizationId,
      displayName: "Synthetic", status: "active", createdAt, updatedAt: createdAt} : undefined;}},
    workspaceAuthorization: {async authorizeWorkspaceOperation() {if (!state.allowed) throw new Error("Synthetic denied role.");}}});
  const datasets = new ReadHeadlessDatasetMetadataUseCase({versions, comparisons: {async execute() {assert.fail("No comparison query.");}}});
  const owner = new PreviewHeadlessModelTrainingInputsUseCase({organizationId, models, datasets});
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const request = {version, operation: "models.preview-training-inputs", input: {hostIncarnationId: host, workspaceId,
    model: {modelRecordId: "model.synthetic", updatedAt: createdAt}, dataset: {datasetId: saved.datasetId, versionId: saved.versionId, versionDigest: saved.versionDigest}}};
  const context = {organizationId, workspaceId, principalId};
  const authority = {hostIncarnationId: host, clientId: randomUUID(), context, isCurrent: () => state.current, stillAllowed: async () => state.allowed};
  return {state, registry, repository, request, authority, owner, models, datasets, documents};
}

for (const storage of ["Core", "SQLite"] as const) {
  test(`${storage}: actual metadata owners review one exact model/dataset with three bounded reads and no private data or readiness claim`, async t => {
    const f = await fixture(t, storage), result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok, JSON.stringify(result));
    assert.equal(f.state.models, 2); assert.equal(f.state.datasets, 1);
    assert.equal(result.value.model.modelRecordId, "model.synthetic"); assert.equal(result.value.dataset.version.versionId, "version.001");
    assert.deepEqual(result.value.dataset.version.splits, [{role: "train", rowCount: 6}, {role: "validation", rowCount: 2}, {role: "test", rowCount: 2}]);
    assert.equal(result.value.trainingApproval, "required");
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private|private\/synthetic|localPath|artifactKey|syntheticPrivatePrompt|source text|createdBy|documentation/);
    assert.deepEqual(result.value.verification, {inputBytes: "not-checked", runtimeReadiness: "not-checked", trainingCompatibility: "not-checked",
      resourceAdmission: "not-checked", licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"});
    assert.ok(Object.isFrozen(result.value)); assert.ok(Object.isFrozen(result.value.dataset.version.splits)); assert.ok(Object.isFrozen(result.value.model.taskTags));
    assert.equal((await f.documents.listNamespaces()).some(key => /runtime|training-task|headless/.test(key)), false);
  });
  test(`${storage}: changed model or dataset revisions are stale and missing rows never broaden to discovery`, async t => {
    for (const variant of ["model-stamp", "dataset-digest", "model-missing", "dataset-missing"] as const) {
      const f = await fixture(t, storage), request = structuredClone(f.request);
      if (variant === "model-stamp") request.input.model.updatedAt = "2026-11-18T00:00:00.000Z";
      if (variant === "dataset-digest") request.input.dataset.versionDigest = normalizeDatasetVersionDigest("sha256:" + "f".repeat(64));
      if (variant === "model-missing") request.input.model.modelRecordId = "model.missing";
      if (variant === "dataset-missing") request.input.dataset.versionId = normalizeDatasetVersionId("version.missing");
      assert.deepEqual(await f.owner.execute(request, f.authority), {ok: false,
        code: variant.endsWith("missing") ? "headless.not-found" : "headless.stale"});
      assert.ok(f.state.models <= 1 && f.state.datasets <= 1);
    }
  });
  test(`${storage}: final recorded-model comparison rejects changes during the dataset lookup`, async t => {
    const f = await fixture(t, storage);
    f.state.onDataset = async () => {f.state.modelTime = "2026-11-18T00:00:00.000Z";
      await f.registry.updateModelRecord({workspaceId, modelRecordId: "model.synthetic", patch: {displayName: "Changed while reading"}});};
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.stale"});
    assert.equal(f.state.models, 2); assert.equal(f.state.datasets, 1);
  });
  test(`${storage}: policy withdrawal at every actual read suppresses partial metadata and subsequent reads`, async t => {
    for (const stage of ["before", "first-model", "dataset", "final-model"] as const) {
      const f = await fixture(t, storage);
      if (stage === "before") f.state.allowed = false;
      if (stage === "first-model") f.state.onModel = async count => {if (count === 1) f.state.allowed = false;};
      if (stage === "dataset") f.state.onDataset = async () => {f.state.allowed = false;};
      if (stage === "final-model") f.state.onModel = async count => {if (count === 2) f.state.allowed = false;};
      assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
      assert.ok(f.state.models <= 2 && f.state.datasets <= 1);
      if (stage === "first-model" || stage === "before") assert.equal(f.state.datasets, 0);
    }
  });
  test(`${storage}: original request snapshots survive caller edits while changed original authority is denied`, async t => {
    const f = await fixture(t, storage);
    f.state.onModel = async count => {if (count === 1) {f.request.input.model.updatedAt = "2026-11-18T00:00:00.000Z";
      f.request.input.dataset.versionId = normalizeDatasetVersionId("version.changed");}};
    const result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok); assert.equal(result.value.dataset.version.versionId, "version.001");
    for (const field of ["actor", "context", "client", "host", "callback", "policy"] as const) {
      const g = await fixture(t, storage); g.state.onModel = async count => {
        if (count !== 1) return;
        if (field === "actor") g.authority.context.principalId = "principal.changed";
        if (field === "context") g.authority.context = {...g.authority.context};
        if (field === "client") g.authority.clientId = randomUUID();
        if (field === "host") {const other = randomUUID(); assert.ok(isHeadlessHostIncarnationId(other)); g.authority.hostIncarnationId = other;}
        if (field === "callback") g.authority.isCurrent = () => true;
        if (field === "policy") g.authority.stillAllowed = async () => true;
      };
      assert.deepEqual(await g.owner.execute(g.request, g.authority), {ok: false, code: "headless.forbidden"}); assert.equal(g.state.datasets, 0);
    }
  });
  test(`${storage}: unauthorized workspace, asynchronous fences and policy errors deny before metadata admission`, async t => {
    const f = await fixture(t, storage);
    assert.deepEqual(await f.owner.execute(f.request, {...f.authority, context: {...f.authority.context, workspaceId: createWorkspaceId("foreign.workspace")}}), {ok: false, code: "headless.forbidden"});
    assert.deepEqual(await f.owner.execute(f.request, {...f.authority, isCurrent: (() => Promise.reject(new Error("Synthetic asynchronous fence"))) as never}), {ok: false, code: "headless.forbidden"});
    assert.deepEqual(await f.owner.execute(f.request, {...f.authority, stillAllowed: async () => {throw new Error("Synthetic private permission detail");}}), {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.models, 0); assert.equal(f.state.datasets, 0);
  });
}

test("passive Node ingress refuses proxies/accessors before hooks and captures reader methods before the first policy wait", async t => {
  const f = await fixture(t, "Core"); let hooks = 0;
  const request = {...f.request}; Object.defineProperty(request, "input", {enumerable: true, get() {hooks++; return f.request.input;}});
  assert.deepEqual(await f.owner.execute(request, f.authority), {ok: false, code: "headless.invalid-request"}); assert.equal(hooks, 0);
  const proxy = new Proxy(f.request.input.model, {getPrototypeOf() {hooks++; throw new Error("Must not execute proxy");}});
  assert.deepEqual(await f.owner.execute({...f.request, input: {...f.request.input, model: proxy}}, f.authority), {ok: false, code: "headless.invalid-request"}); assert.equal(hooks, 0);
  let release!: () => void, enter!: () => void, calls = 0, replacements = 0;
  const held = new Promise<void>(resolve => {release = resolve;}), entered = new Promise<void>(resolve => {enter = resolve;});
  const authority = {...f.authority, stillAllowed: async () => {if (++calls === 1) {enter(); await held;} return true;}};
  const pending = f.owner.execute(f.request, authority); await entered;
  f.models.execute = async () => {replacements++; return {ok: false, code: "headless.unavailable"};};
  f.datasets.execute = async () => {replacements++; return {ok: false, code: "headless.unavailable"};};
  release(); assert.ok((await pending).ok); assert.equal(replacements, 0); assert.equal(f.state.models, 2); assert.equal(f.state.datasets, 1);
});

test("fixed error results suppress private metadata-owner failures", async t => {
  const f = await fixture(t, "Core"); f.state.onModel = async () => {throw new Error("Synthetic private C:/private/model prompt details");};
  const result = await f.owner.execute(f.request, f.authority); assert.deepEqual(result, {ok: false, code: "headless.unavailable"});
  assert.doesNotMatch(JSON.stringify(result), /private|prompt|details/);
});

test("the first policy wait cannot replace original selectors or actor authority", async t => {
  for (const mutation of ["selection", "identity"] as const) {
    const f = await fixture(t, "Core"); let release!: () => void, enter!: () => void, calls = 0;
    const held = new Promise<void>(resolve => {release = resolve;}), entered = new Promise<void>(resolve => {enter = resolve;});
    const authority = {...f.authority, stillAllowed: async () => {if (++calls === 1) {enter(); await held;} return true;}};
    const pending = f.owner.execute(f.request, authority); await entered;
    if (mutation === "selection") {f.request.input.model.modelRecordId = "model.changed"; f.request.input.dataset.versionId = normalizeDatasetVersionId("version.changed");}
    else authority.context.principalId = "principal.changed";
    release(); const result = await pending;
    if (mutation === "selection") {assert.ok(result.ok); assert.equal(result.value.model.modelRecordId, "model.synthetic"); assert.equal(result.value.dataset.version.versionId, "version.001");}
    else {assert.deepEqual(result, {ok: false, code: "headless.forbidden"}); assert.equal(f.state.models, 0); assert.equal(f.state.datasets, 0);}
  }
});

test("unexpected or active metadata reply fields never escape through a partial training preview", async t => {
  for (const variant of ["private-field", "getter", "proxy", "wrong-operation", "wrong-workspace"] as const) {
    const f = await fixture(t, "Core"); let hooks = 0;
    const read = f.models.execute.bind(f.models);
    f.models.execute = async (...args) => {
      const value = await read(...args); assert.ok(value.ok && value.operation === "models.record");
      if (variant === "private-field") return {...value, privateDetails: "Synthetic private prompt"};
      if (variant === "wrong-operation") return {...value, operation: "models.inventory"} as never;
      if (variant === "wrong-workspace") return {...value, value: {...value.value, workspaceId: createWorkspaceId("foreign.workspace")}};
      if (variant === "getter") {
        Object.defineProperty(value.value, "localPath", {enumerable: true, get() {hooks++; return "private";}}); return value;
      }
      return new Proxy(value, {getPrototypeOf() {hooks++; throw new Error("Must not invoke a proxy.");}});
    };
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"});
    assert.equal(hooks, 0); assert.equal(f.state.datasets, 0);
  }
});

test("original lifetime retirement at each policy Promise handoff prevents the next metadata reader entry", async t => {
  for (const retireAt of [1, 2, 3]) await t.test(`reader position ${retireAt}`, async t => {
    const f = await fixture(t, "Core"), baseline = await f.owner.execute(f.request, f.authority); assert.ok(baseline.ok);
    const entries: string[] = []; let policies = 0;
    f.models.execute = async () => {
      entries.push("model"); assert.equal(f.state.current, true, "A retired original session must not enter a reader.");
      return {ok: true, operation: "models.record", value: {workspaceId, model: baseline.value.model,
        runtimeReadiness: "not-checked", supplyVerification: "not-checked"}};
    };
    f.datasets.execute = async () => {
      entries.push("dataset"); assert.equal(f.state.current, true, "A retired original session must not enter a reader.");
      return {ok: true, operation: "data.dataset-versions", value: {workspaceId, datasetId: baseline.value.dataset.datasetId,
        versions: [baseline.value.dataset.version]}};
    };
    const authority = {...f.authority, stillAllowed: async () => {
      // Retire after allowed() checks its own continuation, before execute() resumes.
      // The policy stays literal true; this tests original lifetime, not policy denial.
      if (++policies === retireAt) queueMicrotask(() => queueMicrotask(() => {f.state.current = false;}));
      return true;
    }};
    assert.deepEqual(await f.owner.execute(f.request, authority), {ok: false, code: "headless.forbidden"});
    assert.deepEqual(entries, retireAt === 1 ? [] : retireAt === 2 ? ["model"] : ["model", "dataset"]);
  });
});
