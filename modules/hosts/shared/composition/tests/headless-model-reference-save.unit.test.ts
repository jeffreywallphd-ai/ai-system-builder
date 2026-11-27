import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {acceptStructuredModelPlanTask, issueStructuredModelPlanTask, reserveStructuredModelPlanTask,
  type ModelPlanTaskEffect} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore";
import {captureModelReferenceSaveEffect, commitStructuredModelReferenceSave, inspectStructuredModelReferenceSave,
  captureModelTrainingSaveEffect, commitStructuredModelTrainingSave, inspectStructuredModelTrainingSave,
  type ModelReferenceSaveEffect, type ModelTrainingSaveEffect} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore";
import {reserveStructuredTrainingPlanTask, issueStructuredTrainingPlanTask, acceptStructuredTrainingPlanTask,
  type TrainingPlanTaskEffect} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model/createLocalModelRegistryAdapter";
import {ModelDownloadTasksUseCase} from "../../../../application/use-cases/model/model-download-tasks.use-case";
import {OwnedTaskReconcilerService} from "../../../../application/services/runtime/owned-task-reconciler.service";
import type {ApprovedModelSourceRegistrationPreparation, ApprovedLocalTrainingSavePreparation} from "../../../../application/ports/model";
import {canonicalHeadlessModelTrainingInputs} from "../../../../application/use-cases/model/headless-model-training-plan.use-case";
import {isHeadlessHostIncarnationId, readHeadlessModelDownloadPlanRequest, readHeadlessModelTrainingPlanRequest,
  readHeadlessModelTrainingInputsValue, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {readModelDownloadSource, readModelTrainingExecutionHistory, type ModelInventoryRecord} from "../../../../contracts/model";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {TaskType, type RuntimeTaskRecord} from "../../../../contracts/runtime";
import {composeHeadlessModelReferenceSave} from "../headlessModelReferenceSave";

const SAVES = "headless/models/reference-saves", SOURCES = "headless/models/reference-save-sources";
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function fixture(t: TestContext, storage: "Core" | "SQLite") {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(path.join(boundary, "model-ref-save-")));
  const original = await lstat(directory, {bigint: true});
  const database = storage === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  const platform = database?.documents ?? createInMemoryStructuredDocumentStore();
  t.after(async () => {
    await database?.close(); const current = await lstat(directory, {bigint: true});
    assert.equal(path.dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
    await rm(directory, {recursive: true});
  });
  const scope = {organizationId: createOrganizationId("org.model-save"), workspaceId: createWorkspaceId("workspace.model-save"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const host = randomUUID() as HeadlessHostIncarnationId, source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/model",
    revision: "a".repeat(40), format: "transformers-safetensors", license: {kind: "provider-declared", identifier: "apache-2.0"},
    files: ["config.json", "model.safetensors", "tokenizer.json"].map(name => ({path: name, sizeBytes: 2,
      integrity: {algorithm: name.endsWith("safetensors") ? "sha256" : "git-blob-sha1", digest: "b".repeat(name.endsWith("safetensors") ? 64 : 40)}})),
    totalBytes: 6, excludedFileCount: 0, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40)});
  const sourceDigest = sha(source), manifestDigest = "sha256:" + sourceDigest;
  const decoded = readHeadlessModelDownloadPlanRequest({version: "aisb-headless-v1", operation: "models.download", input: {
    hostIncarnationId: host, workspaceId: scope.workspaceId, idempotencyKey: randomUUID(), name: "Original download",
    sourceManifest: {source, manifestDigest}, allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 10}}, host);
  assert.ok(decoded.ok);
  const download: ModelPlanTaskEffect = {key: randomUUID(), target: {hostIncarnationId: host, scope, fingerprint: "a".repeat(64)},
    approvalRevision: 1, step: 1, request: decoded.request};
  const partition = platform.forOrganization(scope.organizationId);
  const txn = <T,>(work: (owner: StructuredDocumentStore) => Promise<T>) =>
    platform.runInOwnedTransaction!(owner => work(owner.forOrganization(scope.organizationId)), () => {});
  const reserved = await txn(owner => reserveStructuredModelPlanTask(owner, download, sourceDigest, 1)); assert.equal(reserved.kind, "new");
  if (reserved.kind !== "new") assert.fail();
  const taskId = reserved.taskId;
  assert.ok(await txn(owner => issueStructuredModelPlanTask(owner, download, taskId, sourceDigest, 2)));
  assert.ok(await txn(owner => acceptStructuredModelPlanTask(owner, download, taskId, 3)));
  const effect: ModelReferenceSaveEffect = {key: randomUUID(), target: {hostIncarnationId: host, scope, fingerprint: "c".repeat(64)},
    approvalRevision: 1, step: 1, taskId, manifestDigest, name: "My small model"};
  const state = {current: true, sourceCurrent: true, allowed: true, ownerAvailable: true, lookups: 0, preparations: 0, starts: 0, reads: 0,
    ordinary: 0, dropReply: false, failIndex: false, beforeCommit: undefined as (() => void) | undefined,
    onAuthorize: undefined as ((owner: StructuredDocumentStore) => Promise<void>) | undefined,
    onPrepare: undefined as (() => void) | undefined, changePreparation: undefined as ((value: ApprovedModelSourceRegistrationPreparation) => ApprovedModelSourceRegistrationPreparation) | undefined};
  const reconciler = new OwnedTaskReconcilerService(); t.after(() => reconciler.stopObservation());
  const record: RuntimeTaskRecord = {requestId: taskId, workspaceId: scope.workspaceId, taskType: TaskType.MODEL_DOWNLOAD,
    status: "running", concurrencyClass: "io", updatedAt: "2026-11-21T00:00:00Z"};
  const localPath = path.join(directory, "reference-only-cache-does-not-exist");
  const model = new ModelDownloadTasksUseCase({taskReconciler: reconciler,
    runtimeTaskRegistry: {async startTask() {state.ordinary++; assert.fail();}, async getTaskStatus() {state.ordinary++; assert.fail();},
      async listTasks() {state.ordinary++; assert.fail();}, async cancelTask() {state.ordinary++; assert.fail();}},
    modelRegistry: {async registerDownloadedModel() {state.ordinary++; assert.fail("No ordinary registration.");}} as never,
    modelDownloadCompletion: {async readCompletedModelDownload() {state.ordinary++; assert.fail();}},
    approvedModelSourceDownload: {async startApprovedModelSource(request) {
      state.starts++; return {kind: "accepted", value: {requestId: taskId, status: "running"}, task: Object.freeze({
        requestId: taskId, workspaceId: scope.workspaceId, modelId: source.modelId, revision: source.revision, manifestDigest,
        read: async () => {state.reads++; return {...record};}, cancel: async () => {state.ordinary++; assert.fail();},
        readCompleted: async () => ({provider: "transformers" as const, modelId: source.modelId, revision: source.revision,
          verifiedManifestDigest: request.sourceManifest.manifestDigest, downloaded: true, fromCache: false, localPath})})};
    }}});
  const authority = {organizationId: scope.organizationId, principalId: scope.principalId, modelWriteAuthorized: true};
  assert.equal((await model.startApprovedSource({workspaceId: scope.workspaceId, provider: "huggingface", modelId: source.modelId,
    revision: source.revision, displayName: "Original download"}, {source: {requestId: taskId, workspaceId: scope.workspaceId,
      sourceManifest: {source, manifestDigest}, maximumDurationSeconds: 10, allowedOrigins: ["https://huggingface.co"]},
    control: {isCurrent: () => state.sourceCurrent, stillAllowed: async () => true}, acknowledgeIssued: async () => true}, authority)).kind, "accepted");
  record.status = "succeeded"; await model.read({workspaceId: scope.workspaceId, requestId: taskId}, authority); await reconciler.reconcileNow();
  assert.equal(reconciler.status.pending, 0);
  const readCount = state.reads;
  function wrapped(owner: StructuredDocumentStore): StructuredDocumentStore {
    return {...owner, forOrganization: id => wrapped(owner.forOrganization(id)), async writeDocument(namespace, key, value, options) {
      if (state.failIndex && namespace === SOURCES) throw new Error("synthetic private index failure C:/private/cache");
      return owner.writeDocument(namespace, key, value, options);
    }};
  }
  const root: StructuredDocumentStore = {...platform, async runInOwnedTransaction(work, beforeCommit) {
    let created = false;
    const result = await platform.runInOwnedTransaction!(async owner => {
      const result = await work(wrapped(owner)); created = !!result && typeof result === "object" && "created" in result && result.created === true;
      return result;
    }, () => {if (created) state.beforeCommit?.(); beforeCommit();});
    if (created && state.dropReply) {state.dropReply = false; throw new Error("synthetic lost private reply C:/private/cache");}
    return result;
  }};
  const compose = (candidate = effect, documents = root, authorizer?: Parameters<typeof composeHeadlessModelReferenceSave>[0]["authorizeExactSave"]) =>
    composeHeadlessModelReferenceSave({documents, rootDirectory: directory, effect: candidate, isCurrent: () => state.current, now: () => 10,
      authorizeExactSave: authorizer ?? (async (owner, actual) => {
        assert.equal(owner.organizationId, undefined); assert.equal(owner.runInOwnedTransaction, undefined);
        assert.deepEqual(actual, captureModelReferenceSaveEffect(candidate)); assert.ok(Object.isFrozen(actual.target.scope));
        await state.onAuthorize?.(owner); return state.allowed;
      }), peekOwner: () => {
        state.lookups++; if (!state.ownerAvailable) return;
        return {async peekApprovedSourceRegistration(...args) {
          state.preparations++; const prepared = await model.peekApprovedSourceRegistration(...args); state.onPrepare?.();
          return prepared && state.changePreparation ? state.changePreparation(prepared) : prepared;
        }};
      }});
  const registry = createLocalModelRegistryAdapter({documents: partition, rootDirectory: directory,
    filePath: path.join(directory, "never-read-registry.json"), discovery: {enabled: false}});
  const rows = async () => (await partition.readDocument<{models: ModelInventoryRecord[]}>("model-registry", "models.json"))?.value.models ?? [];
  const noEffects = () => {assert.equal(state.starts, 1); assert.equal(state.reads, readCount); assert.equal(state.ordinary, 0);};
  const empty = async () => {assert.deepEqual(await rows(), []); assert.deepEqual(await partition.listDocuments(SAVES), []);
    assert.deepEqual(await partition.listDocuments(SOURCES), []); noEffects();};
  return {platform, root, partition, directory, scope, host, source, sourceDigest, effect, model, authority, taskId, state,
    compose, txn, rows, registry, empty, noEffects};
}

for (const storage of ["Core", "SQLite"] as const) {
  test(`${storage}: transaction adapter registers only metadata using actual cached Model owner inputs`, async t => {
    const f = await fixture(t, storage);
    const prepared = await f.model.peekApprovedSourceRegistration({workspaceId: f.scope.workspaceId, requestId: f.taskId}, f.effect.manifestDigest, f.authority);
    assert.ok(prepared);
    const saved = await f.txn(owner => commitStructuredModelReferenceSave(owner, f.directory, f.effect, prepared, f.sourceDigest, 10));
    assert.equal(saved.created, true); assert.equal((await f.rows()).length, 1); f.noEffects();
  });
  test(`${storage}: exact save commits a reference and receipt once, with no file ownership/readiness or repeated runtime work`, async t => {
    const f = await fixture(t, storage), first = await f.compose().save(); assert.equal(first?.kind, "committed"); assert.equal(first?.created, true);
    assert.doesNotMatch(JSON.stringify(first), /localPath|reference-only-cache|principal|registeredClient|sourceManifest|license/);
    const rows = await f.rows(); assert.equal(rows.length, 1); assert.equal(rows[0].displayName, f.effect.name);
    assert.equal((rows[0].metadata?.headlessReference as Record<string, unknown>)?.storageAuthority, "reference-only");
    assert.equal((rows[0].metadata?.headlessReference as Record<string, unknown>)?.runtimeReadiness, "not-checked");
    assert.equal((await f.partition.listDocuments(SAVES)).length, 1); assert.equal((await f.partition.listDocuments(SOURCES)).length, 1);
    f.state.ownerAvailable = false; f.state.sourceCurrent = false;
    const again = await f.compose({...f.effect, approvalRevision: 2}).save(); assert.equal(again?.created, false); assert.deepEqual(again?.reference, first?.reference);
    assert.equal(f.state.preparations, 1); assert.equal(f.state.lookups, 1); assert.deepEqual(await f.rows(), rows); f.noEffects();
  });
  test(`${storage}: old download approval, false current policy and retired original source cannot save`, async t => {
    for (const denial of ["old-download", "policy", "source", "host", "unloaded"] as const) {
      const f = await fixture(t, storage); if (denial === "policy") f.state.allowed = false;
      if (denial === "source") f.state.sourceCurrent = false; if (denial === "host") f.state.current = false;
      if (denial === "unloaded") f.state.ownerAvailable = false;
      const save = denial === "old-download" ? f.compose(f.effect, f.root, async (_owner, exact) => exact.target.fingerprint === "a".repeat(64)) : f.compose();
      assert.equal(await save.save(), undefined); await f.empty();
    }
  });
  test(`${storage}: foreign organization/workspace/client/actor/host/task/manifest and unknown accepted source deny`, async t => {
    for (const change of ["organization", "workspace", "client", "actor", "host", "task", "manifest"] as const) {
      const f = await fixture(t, storage), effect = structuredClone(f.effect);
      const foreignHost = randomUUID(); assert.ok(isHeadlessHostIncarnationId(foreignHost));
      const candidate: ModelReferenceSaveEffect = {...effect,
        taskId: change === "task" ? randomUUID() : effect.taskId,
        manifestDigest: change === "manifest" ? "sha256:" + "e".repeat(64) : effect.manifestDigest,
        target: {...effect.target, hostIncarnationId: change === "host" ? foreignHost : effect.target.hostIncarnationId,
          scope: {...effect.target.scope, organizationId: change === "organization" ? createOrganizationId("org.foreign") : f.scope.organizationId,
            workspaceId: change === "workspace" ? createWorkspaceId("workspace.foreign") : f.scope.workspaceId,
            registeredClientId: change === "client" ? randomUUID() : f.scope.registeredClientId,
            principalId: change === "actor" ? "principal.foreign" : f.scope.principalId}}};
      assert.equal(await f.compose(candidate).save(), undefined); await f.empty(); assert.equal(f.state.preparations, 0);
    }
  });
  test(`${storage}: registry, receipt and source index roll back together at failure or strict source/host commit fence`, async t => {
    for (const failure of ["index", "source-fence", "host-fence", "policy-after-write"] as const) {
      const f = await fixture(t, storage); if (failure === "index") f.state.failIndex = true;
      if (failure === "source-fence") f.state.beforeCommit = () => {f.state.sourceCurrent = false;};
      if (failure === "host-fence") f.state.beforeCommit = () => {f.state.current = false;};
      if (failure === "policy-after-write") f.state.onAuthorize = async owner => {
        if ((await owner.forOrganization(f.scope.organizationId).listDocuments(SAVES)).length) f.state.allowed = false;
      };
      assert.equal(await f.compose().save(), undefined); await f.empty();
    }
  });
  test(`${storage}: one exact read-only reconciliation resolves a lost commit reply without repeating preparation or save`, async t => {
    const f = await fixture(t, storage); f.state.dropReply = true; const result = await f.compose().save();
    assert.equal(result?.kind, "committed"); assert.equal(result?.created, false); assert.equal(f.state.preparations, 1);
    assert.equal((await f.rows()).length, 1); assert.equal((await f.partition.listDocuments(SAVES)).length, 1); f.noEffects();
  });
  test(`${storage}: concurrent retries converge; a different approval key/name cannot duplicate or replace the original`, async t => {
    const f = await fixture(t, storage), results = await Promise.all([f.compose().save(), f.compose().save(), f.compose().save()]);
    assert.ok(results.every(row => row?.kind === "committed")); assert.equal(results.filter(row => row?.created).length, 1);
    const before = await f.rows(); assert.equal(before.length, 1);
    assert.equal(await f.compose({...f.effect, key: randomUUID()}).save(), undefined);
    assert.equal(await f.compose({...f.effect, name: "A changed name"}).save(), undefined);
    assert.deepEqual(await f.rows(), before); f.noEffects();
  });
  test(`${storage}: deleted, edited or ambiguous library rows never replay or become fresh save authority`, async t => {
    for (const change of ["deleted", "edited", "duplicate", "receipt", "source-index", "missing-receipt", "missing-source-index"] as const) {
      const f = await fixture(t, storage); assert.ok(await f.compose().save());
      const rows = await f.rows();
      if (change === "deleted") await f.registry.deleteModelRecord({workspaceId: f.scope.workspaceId, modelRecordId: rows[0].modelRecordId});
      if (change === "edited") await f.registry.updateModelRecord({workspaceId: f.scope.workspaceId, modelRecordId: rows[0].modelRecordId, patch: {displayName: "User edit"}});
      if (change === "duplicate") await f.partition.writeDocument("model-registry", "models.json", {models: [...rows, ...rows]});
      if (change === "receipt" || change === "source-index") {
        const namespace = change === "receipt" ? SAVES : SOURCES, row = (await f.partition.listDocuments(namespace))[0];
        await f.partition.writeDocument(namespace, row.key, row.value); // Revision-only tampering still denies.
      }
      if (change === "missing-receipt" || change === "missing-source-index") {
        const namespace = change === "missing-receipt" ? SAVES : SOURCES, row = (await f.partition.listDocuments(namespace))[0];
        assert.ok(await f.partition.deleteDocument(namespace, row.key, row.revision));
      }
      const before = await f.rows(); f.state.ownerAvailable = false;
      assert.equal(await f.compose().save(), undefined); assert.deepEqual(await f.rows(), before); assert.equal(f.state.preparations, 1); f.noEffects();
    }
  });
  test(`${storage}: copied exact effect survives caller mutation and original source retirement denies preparation`, async t => {
    const f = await fixture(t, storage), raw = structuredClone(f.effect);
    const saved = f.compose(raw, f.root, async (_owner, exact) => {assert.deepEqual(exact, f.effect); return true;});
    (raw as {name: string}).name = "Caller replaced name";
    const result = await saved.save(); assert.equal(result?.created, true); assert.equal((await f.rows())[0].displayName, f.effect.name);
    f.noEffects();
    const g = await fixture(t, storage); g.state.onPrepare = () => {g.state.sourceCurrent = false;};
    assert.equal(await g.compose().save(), undefined); await g.empty();
  });
  test(`${storage}: malformed/private registration data cannot create a library record`, async t => {
    for (const change of ["path", "manifest", "size", "review-task", "storage", "async-source"] as const) {
      const f = await fixture(t, storage); f.state.changePreparation = prepared => {
        if (change === "path") return {...prepared, localPath: "https://example.invalid/model"};
        if (change === "manifest") return {...prepared, sourceManifest: {...prepared.sourceManifest, manifestDigest: "sha256:" + "e".repeat(64)}};
        if (change === "size") return {...prepared, review: {...prepared.review, totalBytes: 7}};
        if (change === "review-task") return {...prepared, review: {...prepared.review, requestId: randomUUID()}};
        if (change === "storage") return {...prepared, storageAuthority: "owned" as never};
        return {...prepared, isOriginalSourceCurrent: (() => Promise.reject(new Error("synthetic source fence rejection"))) as never};
      };
      assert.equal(await f.compose().save(), undefined); await f.empty();
    }
  });
  test(`${storage}: an ordinary record at the deterministic ID is preserved, and strict false or non-boolean save authority denies`, async t => {
    const f = await fixture(t, storage), modelRecordId = `model_headless_${sha([
      f.scope.organizationId, f.scope.workspaceId, f.effect.key]).slice(0, 32)}`;
    await f.registry.registerDownloadedModel({workspaceId: f.scope.workspaceId, modelRecordId, displayName: "Existing ordinary model",
      provider: "huggingface", source: "huggingface", artifactForm: "full-model", modelId: "fixture/ordinary"});
    const before = await f.rows(); assert.equal(await f.compose().save(), undefined); assert.deepEqual(await f.rows(), before);
    assert.equal((await f.partition.listDocuments(SAVES)).length, 0); f.noEffects();
    const g = await fixture(t, storage);
    assert.equal(await g.compose(g.effect, g.root, (async () => "true") as never).save(), undefined); await g.empty();
    assert.equal(g.state.preparations, 0);
  });
}

test("private effect rejects accessors/proxies without executing them and saving refuses non-owning roots", async t => {
  const f = await fixture(t, "Core"); let invoked = 0;
  const getter = {...f.effect}; Object.defineProperty(getter, "target", {enumerable: true, get() {invoked++; return f.effect.target;}});
  assert.throws(() => captureModelReferenceSaveEffect(getter));
  const proxy = new Proxy(f.effect.target.scope, {getPrototypeOf() {invoked++; throw new Error("must not execute");}});
  assert.throws(() => captureModelReferenceSaveEffect({...f.effect, target: {...f.effect.target, scope: proxy}})); assert.equal(invoked, 0);
  assert.throws(() => f.compose(f.effect, f.partition));
  const preparation = await f.model.peekApprovedSourceRegistration({workspaceId: f.scope.workspaceId, requestId: f.taskId}, f.effect.manifestDigest, f.authority);
  assert.ok(preparation);
  await assert.rejects(commitStructuredModelReferenceSave(f.partition, f.directory, f.effect, preparation, f.sourceDigest, 10)); await f.empty();
  assert.deepEqual(await inspectStructuredModelReferenceSave(f.partition, f.effect), {kind: "absent"});
});

test("save retains its original synchronous host callback; replacement and async truthiness cannot reopen it", async t => {
  const f = await fixture(t, "Core");
  const input = {documents: f.root, rootDirectory: f.directory, effect: f.effect,
    isCurrent: () => f.state.current, authorizeExactSave: async () => true,
    peekOwner: () => ({peekApprovedSourceRegistration: f.model.peekApprovedSourceRegistration.bind(f.model)})};
  const save = composeHeadlessModelReferenceSave(input); input.isCurrent = () => true; f.state.current = false;
  assert.equal(await save.save(), undefined); await f.empty();
  f.state.current = true;
  const invalid = composeHeadlessModelReferenceSave({...input,
    isCurrent: (() => Promise.reject(new Error("synthetic async current refusal"))) as never});
  assert.equal(await invalid.save(), undefined); await f.empty();
});

const TRAINED_SAVES = "headless/models/training-saves", TRAINED_SOURCES = "headless/models/training-save-sources";
/** Metadata-only fixture. No worker, model bytes, filesystem copy or quality
 * measurement is performed or qualified by this synthetic preparation. */
async function trainingFixture(t: TestContext, storage: "Core" | "SQLite", options: {adapter?: boolean; localBase?: boolean; accepted?: boolean; checkpoints?: boolean; name?: string} = {}) {
  const f = await fixture(t, storage);
  const base = JSON.parse(JSON.stringify((await f.registry.registerDownloadedModel({workspaceId: f.scope.workspaceId, modelRecordId: "model.training-base", displayName: "Training base",
    source: "huggingface", provider: "huggingface", ...(options.localBase ? {} : {modelId: "fixture/base"}), artifactForm: "full-model",
    localPath: path.join(f.directory, "metadata-only-base"), inferenceMode: "causal", serializationFormat: "safetensors", taskTags: ["chat"]})).model)) as ModelInventoryRecord;
  const at = base.updatedAt ?? base.createdAt, versionDigest = "sha256:" + "c".repeat(64), recipeDigest = "sha256:" + "d".repeat(64);
  const parsed = readHeadlessModelTrainingPlanRequest({version: "aisb-headless-v1", operation: "models.train", input: {
    hostIncarnationId: f.host, workspaceId: f.scope.workspaceId, idempotencyKey: randomUUID(), name: options.name ?? "Synthetic training result",
    model: {modelRecordId: base.modelRecordId, updatedAt: at}, dataset: {datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest},
    training: {trainingTask: "llm-instruction", method: options.adapter ? "lora" : "full-finetune", commonParameters: {maxSteps: 1, batchSize: 1}}}}, f.host);
  assert.ok(parsed.ok); const request = parsed.request;
  const inputsValue = readHeadlessModelTrainingInputsValue({workspaceId: f.scope.workspaceId,
    model: {modelRecordId: base.modelRecordId, updatedAt: at, source: base.source, lifecycleStatus: base.lifecycleStatus,
      artifactForm: base.artifactForm, provider: base.provider, ...(base.modelId ? {modelId: base.modelId} : {}), inferenceMode: "causal", serializationFormat: "safetensors", taskTags: ["chat"]},
    dataset: {datasetId: "dataset.synthetic", version: {versionId: "version.synthetic", versionDigest, createdAt: at, totalRows: 1, sourceCount: 1, artifactCount: 2,
      parentVersionId: null, splitSeed: null, recipeDigest, quality: {policyFingerprint: versionDigest, reportFingerprint: versionDigest},
      splits: [{role: "train", rowCount: 1}, {role: "validation", rowCount: null}, {role: "test", rowCount: null}]}},
    verification: {inputBytes: "not-checked", runtimeReadiness: "not-checked", trainingCompatibility: "not-checked", resourceAdmission: "not-checked",
      licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"}, trainingApproval: "required"}, request.input);
  assert.ok(inputsValue); const inputs = canonicalHeadlessModelTrainingInputs(inputsValue), proposalDigest = "sha256:" + sha({request, inputs});
  const training: TrainingPlanTaskEffect = {key: randomUUID(), target: {hostIncarnationId: f.host, scope: f.scope, fingerprint: "e".repeat(64)},
    approvalRevision: 1, step: 1, request, binding: {step: 1, inputs, proposalDigest}};
  const reserved = await f.txn(owner => reserveStructuredTrainingPlanTask(owner, training, proposalDigest, 1)); assert.equal(reserved.kind, "new");
  if (reserved.kind !== "new") assert.fail(); const taskId = reserved.taskId;
  assert.ok(await f.txn(owner => issueStructuredTrainingPlanTask(owner, training, taskId, proposalDigest, 2)));
  if (options.accepted !== false) assert.ok(await f.txn(owner => acceptStructuredTrainingPlanTask(owner, training, taskId, 3)));
  const publicationId = "a".repeat(32), names = options.adapter ? ["adapter_config.json", "adapter_model.safetensors", "tokenizer.json"] : ["config.json", "model.safetensors", "tokenizer.json"];
  const files = [...(options.checkpoints ? names : []), ...names].map((name, index) => ({fileIndex: index, groupIndex: options.checkpoints && index >= 3 ? 1 : 0,
    name, role: options.checkpoints && index < 3 ? "checkpoint" as const : "candidate" as const,
    mediaType: name.endsWith(".json") ? "application/json" as const : "application/octet-stream" as const, expectedSizeBytes: 2,
    expectedSha256: "sha256:" + "f".repeat(64), key: `workspaces/${f.scope.workspaceId}/artifacts/training-results/${publicationId}/${index}`}));
  const snapshot = {schema: "training-result-finalized-files-v1" as const, publicationId, totalBytes: files.length * 2, files};
  const manifestDigest = "sha256:" + sha(snapshot);
  const history: Extract<ApprovedLocalTrainingSavePreparation["candidate"]["history"], {kind: "ready"}> = {
    kind: "ready", requestId: taskId, workspaceId: f.scope.workspaceId,
    provenance: {modelRecordId: base.modelRecordId, modelUpdatedAt: at, datasetId: request.input.dataset.datasetId, versionId: request.input.dataset.versionId,
      versionDigest: request.input.dataset.versionDigest, recipeDigest, proposalDigest, trainingTask: "llm-instruction", method: request.input.training.method,
      trainingInputCount: 1, validationInputCount: 0, inputBytes: 2, recipeBytes: 2},
    candidate: {requestedName: request.input.name, artifactForm: options.adapter ? "adapter" : "full-model", serializationFormat: options.adapter ? "adapter-safetensors" : "safetensors", recordedSizeBytes: null},
    comparison: {state: "not-recorded"}, verification: {inputs: "recorded-not-rechecked", retainedFiles: "not-checked", runtimeReadiness: "not-checked", hardware: "not-recorded", outputQuality: "not-evaluated"},
    registration: "requires-separate-approval"};
  const candidateDigest = "sha256:" + sha({requestId: taskId, workspaceId: f.scope.workspaceId,
    owner: {organizationId: f.scope.organizationId, principalId: f.scope.principalId, clientId: f.scope.registeredClientId, hostIncarnationId: f.host}, history, manifestDigest});
  const effect: ModelTrainingSaveEffect = {key: randomUUID(), target: {hostIncarnationId: f.host, scope: f.scope, fingerprint: "f".repeat(64)}, approvalRevision: 1, step: 1,
    taskId, candidateDigest, name: "Saved trained model"};
  const preparation: ApprovedLocalTrainingSavePreparation = {schema: "approved-training-save-preparation-v1", taskId, workspaceId: f.scope.workspaceId, saveId: effect.key, name: effect.name,
    candidate: {kind: "ready", requestId: taskId, workspaceId: f.scope.workspaceId, candidateDigest, history,
      retainedFiles: {...snapshot, verification: "sha256-current-local-v1", manifestDigest}},
    storage: {storageProfile: "bounded-local-v1", localPath: path.join(f.directory, "metadata-only-reviewed-copy"), candidateDigest, fileCount: 3, totalBytes: 6}};
  const commit = (e = effect, p = preparation, root = f.root) => root.runInOwnedTransaction!(owner =>
    commitStructuredModelTrainingSave(owner.forOrganization(f.scope.organizationId), f.directory, e, p, 10), () => {});
  const inspect = (e = effect) => inspectStructuredModelTrainingSave(f.partition, e);
  const unchanged = async () => {assert.deepEqual(await f.rows(), [base]); assert.deepEqual(await f.partition.listDocuments(TRAINED_SAVES), []);
    assert.deepEqual(await f.partition.listDocuments(TRAINED_SOURCES), []); f.noEffects();};
  return {...f, base, training, effect, preparation, commit, inspect, unchanged};
}

function resealTrainingCandidate(f: Awaited<ReturnType<typeof trainingFixture>>, p: ApprovedLocalTrainingSavePreparation) {
  const {schema, publicationId, totalBytes, files} = p.candidate.retainedFiles;
  const manifestDigest = "sha256:" + sha({schema, publicationId, totalBytes, files});
  const candidateDigest = "sha256:" + sha({requestId: f.effect.taskId, workspaceId: f.scope.workspaceId,
    owner: {organizationId: f.scope.organizationId, principalId: f.scope.principalId, clientId: f.scope.registeredClientId, hostIncarnationId: f.host},
    history: p.candidate.history, ...(p.candidate.execution ? {execution: p.candidate.execution} : {}), manifestDigest});
  Object.assign(p.candidate.retainedFiles, {manifestDigest}); Object.assign(p.candidate, {candidateDigest}); Object.assign(p.storage, {candidateDigest});
  return {...f.effect, candidateDigest};
}

for (const engine of ["Core", "SQLite"] as const) {
  for (const name of ["Prompt safety model", "Token classifier", "Workflow assistant"]) test(`${engine}: trained Model Save preserves ordinary label ${name}`, async t => {
    const f = await trainingFixture(t, engine, {name}), saved = await f.commit();
    assert.equal(saved.created, true);
    const row = (await f.rows()).find(r => r.modelRecordId === saved.reference.modelRecordId)!;
    const lineage = row.metadata!.headlessTraining as {history: {candidate: {requestedName: string}}};
    assert.equal(lineage.history.candidate.requestedName, name);
    assert.equal((await f.inspect()).kind, "committed"); f.noEffects();
  });
  for (const adapter of [false, true]) test(`${engine}: trained ${adapter ? "adapter" : "full Model"} commits exact lineage once and replays without effects`, async t => {
    const f = await trainingFixture(t, engine, {adapter, checkpoints: true}), saved = await f.commit(); assert.equal(saved.created, true);
    const rows = await f.rows(); assert.equal(rows.length, 2); const row = rows.find(r => r.modelRecordId === saved.reference.modelRecordId)!;
    assert.equal(row.localPath, f.preparation.storage.localPath); assert.equal(row.source, "generated"); assert.equal(row.baseModelId, f.base.modelId);
    assert.equal(row.adapterOfModelId, adapter ? f.base.modelId : undefined); assert.equal(row.sizeBytes, 6);
    assert.deepEqual(row.taskTags, ["text-generation"]); assert.equal(row.generatedFromRunId, f.effect.taskId);
    const lineage = row.metadata!.headlessTraining as {history: unknown; runtimeReadiness: string; outputQuality: string};
    assert.deepEqual(lineage.history, f.preparation.candidate.history); assert.equal(lineage.runtimeReadiness, "not-checked"); assert.equal(lineage.outputQuality, "not-evaluated");
    assert.doesNotMatch(JSON.stringify(saved.reference), /localPath|metadata-only|principal|registeredClient|history|files/);
    const again = await f.commit({...f.effect, approvalRevision: 2}); assert.equal(again.created, false); assert.deepEqual(again.reference, saved.reference);
    assert.deepEqual(await f.rows(), rows); assert.equal((await f.partition.listDocuments(TRAINED_SAVES)).length, 1); assert.equal((await f.partition.listDocuments(TRAINED_SOURCES)).length, 1); f.noEffects();
  });
  test(`${engine}: local-only base reference stays usable and concurrent trained saves produce one winner`, async t => {
    const f = await trainingFixture(t, engine, {adapter: true, localBase: true});
    const saved = await Promise.all([f.commit(), f.commit()]); assert.equal(saved.filter(r => r.created).length, 1);
    const row = (await f.rows()).find(r => r.modelRecordId === saved[0].reference.modelRecordId)!;
    assert.equal(row.baseModelId, f.base.localPath); assert.equal(row.adapterOfModelId, f.base.localPath); f.noEffects();
  });
  test(`${engine}: lost training Save reply is reconciled read-only with no duplicate registry mutation`, async t => {
    const f = await trainingFixture(t, engine); let dropped = false;
    const root: StructuredDocumentStore = {...f.root, async runInOwnedTransaction(work, beforeCommit) {
      const result = await f.root.runInOwnedTransaction!(work, beforeCommit); dropped = true; throw Error("Synthetic lost reply.");
    }};
    await assert.rejects(f.commit(f.effect, f.preparation, root)); assert.equal(dropped, true);
    const rows = await f.rows(), recovered = await f.inspect(); assert.equal(recovered.kind, "committed");
    assert.deepEqual(await f.rows(), rows); assert.equal(rows.length, 2); assert.equal((await f.commit()).created, false); f.noEffects();
  });
  test(`${engine}: training Save rollback preserves base and leaves no partial Model, receipt or index`, async t => {
    const f = await trainingFixture(t, engine);
    const wrap = (owner: StructuredDocumentStore): StructuredDocumentStore => ({...owner, forOrganization: id => wrap(owner.forOrganization(id)),
      async writeDocument(namespace, key, value, options) {if (namespace === TRAINED_SOURCES) throw Error("Synthetic index refusal."); return owner.writeDocument(namespace, key, value, options);}});
    const root: StructuredDocumentStore = {...f.root, runInOwnedTransaction: (work, fence) => f.root.runInOwnedTransaction!(owner => work(wrap(owner)), fence)};
    await assert.rejects(f.commit(f.effect, f.preparation, root)); await f.unchanged();
  });
  test(`${engine}: reordered private JSON and bounded execution history keep exact content identity`, async t => {
    const f = await trainingFixture(t, engine), p = structuredClone(f.preparation);
    const execution = readModelTrainingExecutionHistory({schema: "model-training-execution-v1", runId: "pipeline-original",
      startedAt: "2026-11-27T00:00:00.000Z", completedAt: "2026-11-27T00:00:01.000Z", durationMs: 900,
      hardware: {devices: ["cpu"], precisions: ["float32"], logicalCpuCount: 4, pythonVersion: "3.12.8", pytorchVersion: "2.7.0", transformersVersion: "4.52.0"}, interpretation: "reported-runtime-facts"});
    assert.ok(execution); Object.assign(p.candidate, {execution}); // The original app hashes this canonical report.
    const e = resealTrainingCandidate(f, p);
    const reverse = (v: unknown): unknown => Array.isArray(v) ? v.map(reverse) : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).reverse().map(([k, c]) => [k, reverse(c)])) : v;
    const saved = await f.commit(e, reverse(p) as typeof p), row = (await f.rows()).find(r => r.modelRecordId === saved.reference.modelRecordId)!;
    assert.equal((row.metadata!.headlessTraining as {execution: {runId: string}}).execution.runId, "pipeline-original"); f.noEffects();
  });
  for (const change of ["unsafe-weight", "mixed-weight", "file-index", "group", "role", "foreign-key", "boolean-size", "extra-field", "format"] as const)
    test(`${engine}: self-consistent digests cannot admit invalid ${change} metadata`, async t => {
      const f = await trainingFixture(t, engine), p = structuredClone(f.preparation), files = p.candidate.retainedFiles.files;
      if (change === "unsafe-weight") Object.assign(files[1]!, {name: "model.bin", mediaType: "application/octet-stream"});
      if (change === "mixed-weight") Object.assign(files[1]!, {name: "adapter_model.safetensors"});
      if (change === "file-index") Object.assign(files[1]!, {fileIndex: 0});
      if (change === "group") Object.assign(files[0]!, {groupIndex: 1});
      if (change === "role") Object.assign(files[0]!, {role: "checkpoint"});
      if (change === "foreign-key") Object.assign(files[0]!, {key: "workspaces/foreign/artifacts/other"});
      if (change === "boolean-size") Object.assign(files[0]!, {expectedSizeBytes: true});
      if (change === "extra-field") Object.assign(files[0]!, {privatePath: "must-not-be-consumed"});
      if (change === "format") Object.assign(p.candidate.history.candidate, {serializationFormat: "sharded-safetensors"});
      const e = resealTrainingCandidate(f, p); await assert.rejects(f.commit(e, p)); await f.unchanged();
    });
  for (const change of ["task", "scope", "candidate", "manifest", "history", "copy", "path", "unaccepted", "base-version", "duplicate-base"] as const)
    test(`${engine}: training Save refuses ${change} before registration`, async t => {
      const f = await trainingFixture(t, engine, {accepted: change !== "unaccepted"}), p = structuredClone(f.preparation), e = structuredClone(f.effect);
      if (change === "task") Object.assign(e, {taskId: randomUUID()});
      if (change === "scope") Object.assign(e.target.scope, {registeredClientId: randomUUID()});
      if (change === "candidate") Object.assign(p.candidate, {candidateDigest: "sha256:" + "e".repeat(64)});
      if (change === "manifest") Object.assign(p.candidate.retainedFiles, {manifestDigest: "sha256:" + "e".repeat(64)});
      if (change === "history") Object.assign(p.candidate.history.provenance, {recipeDigest: "sha256:" + "e".repeat(64)});
      if (change === "copy") Object.assign(p.storage, {totalBytes: 7});
      if (change === "path") Object.assign(p.storage, {localPath: "https://example.invalid/model"});
      if (change === "base-version") await f.partition.writeDocument("model-registry", "models.json", {models: [{...f.base, updatedAt: "2020-01-01T00:00:00.000Z"}]});
      if (change === "duplicate-base") await f.partition.writeDocument("model-registry", "models.json", {models: [f.base, f.base]});
      const before = await f.rows(); await assert.rejects(f.commit(e, p)); assert.deepEqual(await f.rows(), before);
      assert.deepEqual(await f.partition.listDocuments(TRAINED_SAVES), []); assert.deepEqual(await f.partition.listDocuments(TRAINED_SOURCES), []); f.noEffects();
    });
  test(`${engine}: training Save preserves a foreign deterministic Model and denies another key for the original task`, async t => {
    const f = await trainingFixture(t, engine), id = `model_headless_trained_${sha([f.scope.organizationId, f.scope.workspaceId, f.effect.key]).slice(0, 32)}`;
    await f.registry.registerDownloadedModel({workspaceId: f.scope.workspaceId, modelRecordId: id, displayName: "Preserve ordinary Model", provider: "huggingface", source: "huggingface", artifactForm: "full-model", modelId: "fixture/other"});
    const before = await f.rows(); await assert.rejects(f.commit()); assert.deepEqual(await f.rows(), before);
    const g = await trainingFixture(t, engine); await g.commit(); const key = randomUUID();
    await assert.rejects(g.commit({...g.effect, key}, {...g.preparation, saveId: key})); assert.equal((await g.rows()).length, 2); g.noEffects();
  });
  for (const change of ["model", "deleted-model", "duplicate-model", "receipt", "index", "deleted-receipt", "deleted-index"] as const)
    test(`${engine}: changed ${change} cannot replay a trained Model Save`, async t => {
      const f = await trainingFixture(t, engine), saved = await f.commit();
      if (change === "model") await f.registry.updateModelRecord({workspaceId: f.scope.workspaceId, modelRecordId: saved.reference.modelRecordId, patch: {displayName: "User changed"}});
      else if (change === "deleted-model") await f.registry.deleteModelRecord({workspaceId: f.scope.workspaceId, modelRecordId: saved.reference.modelRecordId});
      else if (change === "duplicate-model") {const rows = await f.rows(); await f.partition.writeDocument("model-registry", "models.json", {models: [...rows, rows[1]]});}
      else {const namespace = change.includes("receipt") ? TRAINED_SAVES : TRAINED_SOURCES, [row] = await f.partition.listDocuments(namespace); assert.ok(row);
        if (change.startsWith("deleted")) assert.ok(await f.partition.deleteDocument(namespace, row.key, row.revision));
        else await f.partition.writeDocument(namespace, row.key, row.value);}
      const before = await f.rows(); await assert.rejects(f.inspect()); await assert.rejects(f.commit()); assert.deepEqual(await f.rows(), before); f.noEffects();
    });
}

test("training Save copies effects and preparation before awaits, refuses active data and non-owning mutation", async t => {
  const f = await trainingFixture(t, "Core"); let hooks = 0;
  const getter = Object.defineProperty({...f.effect}, "name", {enumerable: true, get() {hooks++; assert.fail("No active property.");}});
  assert.throws(() => captureModelTrainingSaveEffect(getter));
  const proxy = new Proxy(f.effect.target.scope, {getPrototypeOf() {hooks++; assert.fail("No Proxy hook.");}});
  assert.throws(() => captureModelTrainingSaveEffect({...f.effect, target: {...f.effect.target, scope: proxy}})); assert.equal(hooks, 0);
  const active = structuredClone(f.preparation); Object.defineProperty(active.storage, "localPath", {enumerable: true, get() {hooks++; assert.fail("No private active property.");}});
  await assert.rejects(f.commit(f.effect, active)); assert.equal(hooks, 0); await f.unchanged();
  await assert.rejects(commitStructuredModelTrainingSave(f.partition, f.directory, f.effect, f.preparation, 10)); await f.unchanged();
  const raw = structuredClone(f.preparation), actual = structuredClone(f.effect); let mutated = false;
  const wrap = (owner: StructuredDocumentStore): StructuredDocumentStore => ({...owner, forOrganization: id => wrap(owner.forOrganization(id)),
    async readDocument(...args) {if (!mutated) {mutated = true; Object.assign(raw.storage, {localPath: "https://example.invalid/changed"}); Object.assign(actual, {name: "Changed"});}
      return owner.readDocument(...args);}});
  const saved = await f.txn(owner => commitStructuredModelTrainingSave(wrap(owner), f.directory, actual, raw, 10));
  const row = (await f.rows()).find(r => r.modelRecordId === saved.reference.modelRecordId)!;
  assert.equal(row.displayName, f.effect.name); assert.equal(row.localPath, f.preparation.storage.localPath); f.noEffects();
});
