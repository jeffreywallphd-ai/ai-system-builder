import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model/createLocalModelRegistryAdapter";
import {createStructuredDatasetVersionRepository} from "../../../../adapters/persistence/dataset-version";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId} from "../../../../contracts/headless";
import {ReadDatasetVersionUseCase} from "../../dataset-version/dataset-version-read.use-cases";
import {ReadHeadlessDatasetMetadataUseCase} from "../../dataset-version/headless-dataset-metadata.use-case";
import {version as datasetVersion, organizationId, workspaceId, principalId, createdAt} from "../../dataset-version/tests/headless-dataset-metadata.fixture";
import {ReadHeadlessModelMetadataUseCase} from "../headless-model-metadata.use-case";
import {PreviewHeadlessModelTrainingInputsUseCase} from "../headless-model-training-inputs.use-case";
import {PrepareHeadlessModelTrainingPlanUseCase} from "../headless-model-training-plan.use-case";

async function fixture(t: TestContext, storage: "Core" | "SQLite" = "Core") {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(path.join(boundary, "training-plan-review-")));
  const identity = await lstat(directory, {bigint: true});
  const database = storage === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  t.after(async () => {await database?.close(); const current = await lstat(directory, {bigint: true});
    assert.equal(path.dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    await rm(directory, {recursive: true});});
  const documents = (database?.documents ?? createInMemoryStructuredDocumentStore()).forOrganization(organizationId);
  const state = {current: true, allowed: true, models: 0, datasets: 0, onModel: undefined as (() => Promise<void>) | undefined};
  const registry = createLocalModelRegistryAdapter({documents, rootDirectory: directory, filePath: path.join(directory, "unused.json"),
    discovery: {enabled: false}, now: () => createdAt});
  await registry.registerDownloadedModel({workspaceId, modelRecordId: "model.synthetic", displayName: "Synthetic private model",
    source: "local", provider: "huggingface", modelId: "fixture/model", localPath: "C:/synthetic-private/model", artifactForm: "full-model",
    serializationFormat: "safetensors", metadata: {syntheticPrivatePrompt: "Never include this private content."}});
  const repository = createStructuredDatasetVersionRepository(documents), saved = await repository.createVersion(datasetVersion(1));
  const models = new ReadHeadlessModelMetadataUseCase({organizationId, models: {async readRecordedModel(...args) {
    state.models++; const result = await registry.readRecordedModel!(...args); await state.onModel?.(); return result;},
    async listModels() {assert.fail("No model discovery.");}}});
  const versions = new ReadDatasetVersionUseCase({repository: {...repository, async readVersion(...args) {state.datasets++; return repository.readVersion(...args);},
    async listVersions() {assert.fail("No dataset history scan.");}}, workspaceRepository: {async readWorkspace(id) {return id === workspaceId ? {
      workspaceId, organizationId, displayName: "Synthetic", status: "active", createdAt, updatedAt: createdAt} : undefined;}},
    workspaceAuthorization: {async authorizeWorkspaceOperation() {if (!state.allowed) throw new Error("Synthetic permission withdrawn.");}}});
  const inputs = new PreviewHeadlessModelTrainingInputsUseCase({organizationId, models,
    datasets: new ReadHeadlessDatasetMetadataUseCase({versions, comparisons: {async execute() {assert.fail("No dataset comparison.");}}})});
  const owner = new PrepareHeadlessModelTrainingPlanUseCase({organizationId, inputs});
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const request = {version, operation: "models.train", input: {hostIncarnationId: host, workspaceId, idempotencyKey: randomUUID(), name: "Small adapter",
    model: {modelRecordId: "model.synthetic", updatedAt: createdAt}, dataset: {datasetId: saved.datasetId, versionId: saved.versionId, versionDigest: saved.versionDigest},
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {numEpochs: 1, maxSteps: 2, batchSize: 1, maxSequenceLength: 128, seed: 0},
      advancedParameters: {gradientCheckpointing: false}, validation: {enabled: true}}}};
  const authority = {hostIncarnationId: host, clientId: randomUUID(), context: {organizationId, workspaceId, principalId},
    isCurrent: () => state.current, stillAllowed: async () => state.allowed};
  return {state, registry, documents, inputs, owner, request, authority};
}

for (const storage of ["Core", "SQLite"] as const) {
  test(`${storage}: real saved inputs bind a frozen deterministic training proposal without effects or readiness claims`, async t => {
    const f = await fixture(t, storage), result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok, JSON.stringify(result));
    assert.equal(f.state.models, 2); assert.equal(f.state.datasets, 1); assert.deepEqual(result.prepared.request, f.request);
    const {request, inputs} = result.prepared;
    assert.equal(result.prepared.proposalDigest, "sha256:" + createHash("sha256").update(JSON.stringify({request, inputs})).digest("hex"));
    assert.equal(result.prepared.installationPermission, "not-granted"); assert.equal(result.prepared.publicationPermission, "not-granted");
    assert.equal(result.prepared.trainingApprovalRequired, true); assert.equal(result.prepared.resultSaveApprovalRequired, true);
    assert.equal(inputs.verification.trainingCompatibility, "not-checked"); assert.equal(inputs.verification.qualityReport, "recorded-not-rechecked");
    assert.ok(Object.isFrozen(request.input.training.commonParameters)); assert.ok(Object.isFrozen(inputs.dataset.version));
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private|private content|localPath|artifactKey|syntheticPrivatePrompt|createdBy|documentation|isCurrent|principalId/);
    const again = await f.owner.execute(f.request, f.authority); assert.ok(again.ok); assert.equal(again.prepared.proposalDigest, result.prepared.proposalDigest);
    assert.equal((await f.documents.listNamespaces()).some(name => /runtime|training-task|headless/.test(name)), false);
  });
  test(`${storage}: exact saved revision and immutable version digest are still checked by the original metadata owner`, async t => {
    const f = await fixture(t, storage);
    const badModel = structuredClone(f.request); badModel.input.model.updatedAt = "2026-11-18T00:00:00.000Z";
    assert.deepEqual(await f.owner.execute(badModel, f.authority), {ok: false, code: "headless.stale"});
    const missing = structuredClone(f.request); missing.input.model.modelRecordId = "model.missing";
    assert.deepEqual(await f.owner.execute(missing, f.authority), {ok: false, code: "headless.not-found"});
    const badDataset = structuredClone(f.request); badDataset.input.dataset.versionDigest = ("sha256:" + "f".repeat(64)) as typeof badDataset.input.dataset.versionDigest;
    assert.deepEqual(await f.owner.execute(badDataset, f.authority), {ok: false, code: "headless.stale"});
  });
}

test("the complete training request and original input reader are captured before the first await", async t => {
  const f = await fixture(t); let calls = 0, replacements = 0;
  f.state.onModel = async () => {if (++calls !== 1) return;
    f.request.input.training.commonParameters.maxSteps = 999; f.request.input.training.advancedParameters.gradientCheckpointing = true;
    f.request.input.name = "Changed while reading"; f.request.input.model.modelRecordId = "model.changed";
    f.inputs.execute = async () => {replacements++; return {ok: false, code: "headless.unavailable"};};};
  const result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok);
  assert.equal(result.prepared.request.input.training.commonParameters.maxSteps, 2);
  assert.equal(result.prepared.request.input.training.advancedParameters?.gradientCheckpointing, false);
  assert.equal(result.prepared.request.input.model.modelRecordId, "model.synthetic"); assert.equal(result.prepared.request.input.name, "Small adapter");
  assert.equal(replacements, 0);
});

test("invalid authority, active planner data and asynchronous currentness deny without metadata IO", async t => {
  for (const patch of [{context: {organizationId: createOrganizationId("org.other"), workspaceId, principalId}},
    {context: {organizationId, workspaceId: createWorkspaceId("workspace.other"), principalId}}, {clientId: "arbitrary"},
    {context: {organizationId, workspaceId, principalId: ""}}, {isCurrent: (() => Promise.reject(new Error("Synthetic async fence"))) as never}]) {
    const f = await fixture(t); assert.deepEqual(await f.owner.execute(f.request, {...f.authority, ...patch}), {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.models, 0); assert.equal(f.state.datasets, 0);
  }
  const f = await fixture(t); let hooks = 0;
  const proxy = new Proxy(f.request, {getPrototypeOf() {hooks++; throw new Error("Must not execute Proxy.");}});
  assert.deepEqual(await f.owner.execute(proxy, f.authority), {ok: false, code: "headless.invalid-request"});
  const request = {...f.request}; Object.defineProperty(request, "input", {enumerable: true, get() {hooks++; return f.request.input;}});
  assert.deepEqual(await f.owner.execute(request, f.authority), {ok: false, code: "headless.invalid-request"});
  assert.equal(hooks, 0); assert.equal(f.state.models, 0);
});

test("metadata-owner return and final permission handoffs retain original lifetime and policy", async t => {
  for (const mutation of ["owner-return", "permission-return", "permission-denied", "permission-throws", "actor-replaced", "callback-replaced"] as const) {
    const f = await fixture(t), read = f.inputs.execute.bind(f.inputs); let finished = false;
    f.inputs.execute = async (...args) => {const result = await read(...args); finished = true;
      if (mutation === "owner-return") queueMicrotask(() => {f.state.current = false;}); return result;};
    const authority = {...f.authority, stillAllowed: async () => {
      if (finished) {
        if (mutation === "permission-denied") return false;
        if (mutation === "permission-throws") throw new Error("Synthetic private policy error");
        queueMicrotask(() => {if (mutation === "permission-return") f.state.current = false;
          if (mutation === "actor-replaced") authority.context.principalId = "principal.changed";
          if (mutation === "callback-replaced") authority.isCurrent = () => true;});
      } return true;
    }};
    assert.deepEqual(await f.owner.execute(f.request, authority), {ok: false, code: "headless.forbidden"}, mutation);
  }
});

test("an unexpected or active input-owner reply and its private errors never become prepared authority", async t => {
  for (const variant of ["private-field", "wrong-model", "readiness-claim", "getter", "throws"] as const) {
    const f = await fixture(t), read = f.inputs.execute.bind(f.inputs); let hooks = 0;
    f.inputs.execute = async (...args) => {
      if (variant === "throws") throw new Error("Synthetic C:/private/model prompt");
      const result = await read(...args); assert.ok(result.ok);
      if (variant === "private-field") return {...result, privateDetails: "Synthetic private row"};
      if (variant === "wrong-model") return {...result, value: {...result.value, model: {...result.value.model, modelRecordId: "model.other"}}};
      if (variant === "readiness-claim") return {...result, value: {...result.value, verification: {...result.value.verification, runtimeReadiness: "ready"}}} as never;
      const value = {...result.value}; Object.defineProperty(value, "private", {enumerable: true, get() {hooks++; return "private";}});
      return {...result, value};
    };
    assert.deepEqual(await f.owner.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"}); assert.equal(hooks, 0);
  }
});

test("training proposal hash keeps all optional metadata and array order while ignoring object member order", async t => {
  const f = await fixture(t), actualRead = f.inputs.execute.bind(f.inputs);
  let reverse = false;
  f.inputs.execute = async (...args) => {
    const result = await actualRead(...args); assert.ok(result.ok);
    const model = {...result.value.model, inferenceMode: "causal" as const, sizeBytes: 4096, parameterCount: 64};
    return {...result, value: {...result.value, model: reverse ? Object.fromEntries(Object.entries(model).reverse()) as typeof model : model}};
  };
  const original = await f.owner.execute(f.request, f.authority); assert.ok(original.ok); reverse = true;
  const reordered = await f.owner.execute(f.request, f.authority); assert.ok(reordered.ok);
  assert.equal(JSON.stringify(reordered.prepared), JSON.stringify(original.prepared));
  const model = reordered.prepared.inputs.model;
  assert.equal(model.inferenceMode, "causal"); assert.equal(model.sizeBytes, 4096); assert.equal(model.parameterCount, 64);
  assert.equal(model.modelId, "fixture/model"); assert.equal(model.serializationFormat, "safetensors");
  assert.ok(Object.isFrozen(model)); assert.ok(Object.isFrozen(model.taskTags));
  const readWithFacts = f.inputs.execute.bind(f.inputs);
  f.inputs.execute = async (...args) => {const result = await readWithFacts(...args); assert.ok(result.ok);
    return {...result, value: {...result.value, model: {...result.value.model, sizeBytes: 4097}}};};
  const changed = await f.owner.execute(f.request, f.authority); assert.ok(changed.ok);
  assert.notEqual(changed.prepared.proposalDigest, original.prepared.proposalDigest, "Every optional fact remains digest-bound.");
});
