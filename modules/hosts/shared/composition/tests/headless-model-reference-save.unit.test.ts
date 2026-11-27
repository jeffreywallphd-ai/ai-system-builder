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
import type {ApprovedModelSourceRegistrationPreparation, ApprovedLocalTrainingSavePreparation,
  ApprovedLocalTrainingSaveSession, ReviewedGeneratedModelControl} from "../../../../application/ports/model";
import {canonicalHeadlessModelTrainingInputs} from "../../../../application/use-cases/model/headless-model-training-plan.use-case";
import {isHeadlessHostIncarnationId, readHeadlessModelDownloadPlanRequest, readHeadlessModelTrainingPlanRequest,
  readHeadlessModelTrainingInputsValue, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {readModelDownloadSource, readModelTrainingExecutionHistory, type ModelInventoryRecord} from "../../../../contracts/model";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {TaskType, type RuntimeTaskRecord} from "../../../../contracts/runtime";
import {composeHeadlessModelReferenceSave, composeHeadlessTrainedModelSave} from "../headlessModelReferenceSave";
import {prepareHeadlessModelTrainingSaveReviews, runPreparedHeadlessTrainedModelSave} from "../headlessModelReferenceSave";
import {createStructuredHeadlessPlanReviewRepository, createStructuredHeadlessStoredPlanReviewRepository,
  readStructuredHeadlessTrainingSavePlanPermission, readStructuredHeadlessPlanModelPermission} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {prepareStructuredHeadlessPlanStep, prepareStructuredHeadlessPlanStepWithModels, prepareStructuredHeadlessPlanStepWithTraining,
  prepareStructuredHeadlessPlanStepWithTrainingSave} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {parseHeadlessBuildPlanProposal, type HeadlessModelTrainingSavePlanRequest} from "../../../../contracts/headless";

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

/** Real metadata transactions/lineage with one controlled App session. No file
 * copy, model execution, accuracy measurement or physical closure is qualified. */
async function orchestratedTrainingFixture(t: TestContext, storage: "Core" | "SQLite") {
  const f = await trainingFixture(t, storage);
  const state = {current: true, allowed: true, sourceCurrent: true, bound: false, bindRequests: 0, writes: 0, fences: 0, discards: 0,
    closed: true, failWrite: false, throwWrite: false, malformedWrite: false, hooks: 0,
    onWrite: undefined as (() => Promise<void>) | undefined,
    onAuthorize: undefined as (() => void) | undefined, preparation: undefined as ApprovedLocalTrainingSavePreparation | undefined,
    changePreparation: undefined as ((p: ApprovedLocalTrainingSavePreparation) => ApprovedLocalTrainingSavePreparation) | undefined};
  let control: ReviewedGeneratedModelControl | undefined, session: ApprovedLocalTrainingSaveSession | undefined;
  const saveConfiguration = (effect = f.effect): Parameters<typeof composeHeadlessTrainedModelSave>[0] => ({documents: f.root, rootDirectory: f.directory, effect,
    isCurrent: () => state.current, now: () => 10,
    fenceSaveOwned: async () => true, // Controlled component fixture; real plan fencing is tested separately.
    authorizeExactSave: async (owner, actual) => {
      assert.equal(owner.organizationId, undefined); assert.equal(owner.runInOwnedTransaction, undefined);
      assert.deepEqual(actual, captureModelTrainingSaveEffect(effect)); state.onAuthorize?.(); return state.allowed;
    }, async bindOriginalTask(actual, capturedControl) {
      state.bindRequests++; assert.deepEqual(actual, captureModelTrainingSaveEffect(effect));
      assert.ok(Object.isFrozen(actual.target.scope)); if (state.bound) return {ok: false, code: "headless.unavailable"};
      state.bound = true; control = capturedControl;
      session = {
        write() {
          assert.equal(this, session); state.writes++;
          if (state.throwWrite) throw new Error("Synthetic unknown synchronous writer outcome");
          if (state.malformedWrite) {
            const p = Promise.reject(new Error("Synthetic malformed writer"));
            Object.defineProperty(p, "constructor", {value: Promise});
            Object.defineProperty(p, "then", {value: () => {state.hooks++; assert.fail("No own writer hook.");}}); return p as never;
          }
          return (async () => {
            await state.onWrite?.();
            if (state.failWrite || state.fences > 0 || !capturedControl.isCurrent() || !await capturedControl.stillAllowed()) throw new Error("Synthetic copy refusal");
            state.preparation = {...structuredClone(f.preparation), saveId: effect.key, name: effect.name};
            return state.changePreparation?.(state.preparation) ?? state.preparation;
          })();
        },
        fence() {assert.equal(this, session); state.fences++;},
        isCurrent() {assert.equal(this, session); return state.sourceCurrent && state.fences === 0;},
        inspect() {assert.equal(this, session); return {phase: "ready", fenced: state.fences > 0, pendingOperations: 0, ioClosed: state.closed};},
        async discard() {assert.equal(this, session); state.discards++; return state.closed && await capturedControl.mayDiscard();},
      };
      return {ok: true, value: session};
    }});
  const compose = (effect = f.effect) => composeHeadlessTrainedModelSave(saveConfiguration(effect));
  return {...f, saveState: state, composeSave: compose, saveConfiguration, saveControl: () => control!, saveSession: () => session!};
}

for (const engine of ["Core", "SQLite"] as const) {
  test(`${engine}: original trained Save composes one copy and atomic Model/receipt then replays read-only`, async t => {
    const f = await orchestratedTrainingFixture(t, engine), owner = f.composeSave();
    const [a, b] = await Promise.all([owner.save(), owner.save()]);
    assert.equal([a, b].filter(r => r?.created).length, 1); assert.equal(f.saveState.writes, 1); assert.equal(f.saveState.bindRequests, 1);
    const replay = await f.composeSave().save(); assert.equal(replay?.created, false);
    assert.equal((await f.rows()).length, 2); assert.equal((await f.partition.listDocuments(TRAINED_SAVES)).length, 1);
    assert.equal((await f.partition.listDocuments(TRAINED_SOURCES)).length, 1); assert.equal(f.saveState.bindRequests, 1);
    assert.equal(await owner.discardUnpublished(), false); assert.equal(f.saveState.discards, 0);
    assert.doesNotMatch(JSON.stringify(replay), /localPath|metadata-only|private|history|files/); f.noEffects();
  });
  test(`${engine}: lost trained Save reply reconciles without a second original copy or mutation`, async t => {
    const f = await orchestratedTrainingFixture(t, engine); f.state.dropReply = true;
    const owner = f.composeSave(), result = await owner.save(); assert.ok(result); assert.equal(result.created, false);
    assert.equal(f.saveState.writes, 1); assert.equal(f.saveState.bindRequests, 1); assert.equal((await f.rows()).length, 2);
    assert.equal(await owner.discardUnpublished(), false); assert.equal(f.saveState.discards, 0); f.noEffects();
  });
  test(`${engine}: final trained source fence rolls back registry and keeps possibly published bytes`, async t => {
    const f = await orchestratedTrainingFixture(t, engine); f.state.beforeCommit = () => {f.saveState.sourceCurrent = false;};
    const owner = f.composeSave(); assert.equal(await owner.save(), undefined); await f.unchanged();
    assert.equal(await owner.discardUnpublished(), false); assert.equal(f.saveState.discards, 0); assert.equal(f.saveState.fences, 1);
  });
  test(`${engine}: expired write consent permits only independent known-unpublished cleanup`, async t => {
    const f = await orchestratedTrainingFixture(t, engine); f.saveState.onWrite = async () => {f.saveState.current = false;};
    const owner = f.composeSave(); assert.equal(await owner.save(), undefined); await f.unchanged();
    assert.equal(f.saveState.discards, 1); assert.equal(await f.saveControl().mayDiscard(), true);
    assert.equal(await owner.discardUnpublished(), true); assert.equal(f.saveState.discards, 1);
  });
  test(`${engine}: unresolved original copy closure prevents cleanup and repeat execution`, async t => {
    const f = await orchestratedTrainingFixture(t, engine); f.saveState.failWrite = true; f.saveState.closed = false;
    const owner = f.composeSave(); assert.equal(await owner.save(), undefined); await f.unchanged();
    assert.equal(f.saveState.discards, 1); assert.equal(await owner.discardUnpublished(), false);
    assert.equal(await owner.save(), undefined); assert.equal(f.saveState.bindRequests, 1); assert.equal(f.saveState.writes, 1);
  });
  test(`${engine}: preparation and original methods are captured before later metadata waits`, async t => {
    const f = await orchestratedTrainingFixture(t, engine);
    f.saveState.onAuthorize = () => {
      if (f.saveState.preparation) {
        Object.assign(f.saveState.preparation.storage, {localPath: "https://example.invalid/changed"});
        f.saveSession().isCurrent = () => assert.fail("No replaced source callback.");
      }
    };
    const saved = await f.composeSave().save(); assert.ok(saved);
    const row = (await f.rows()).find(r => r.modelRecordId === saved.reference.modelRecordId)!;
    assert.equal(row.localPath, f.preparation.storage.localPath); assert.equal(row.displayName, f.effect.name); f.noEffects();
  });
}

for (const variant of ["denied", "foreign-client", "foreign-principal", "foreign-workspace", "foreign-task"] as const)
  test(`trained Save orchestration refuses ${variant} before original binding`, async t => {
    const f = await orchestratedTrainingFixture(t, "Core"); let e = structuredClone(f.effect);
    if (variant === "denied") f.saveState.allowed = false;
    if (variant === "foreign-client") e = {...e, target: {...e.target, scope: {...e.target.scope, registeredClientId: randomUUID()}}};
    if (variant === "foreign-principal") e = {...e, target: {...e.target, scope: {...e.target.scope, principalId: "principal.other"}}};
    if (variant === "foreign-workspace") e = {...e, target: {...e.target, scope: {...e.target.scope, workspaceId: createWorkspaceId("workspace.other")}}};
    if (variant === "foreign-task") e = {...e, taskId: randomUUID()};
    assert.equal(await f.composeSave(e).save(), undefined); assert.equal(f.saveState.bindRequests, 0); await f.unchanged();
  });

test("malformed original write rejection is observed without hooks, cleanup or renewal", async t => {
  const f = await orchestratedTrainingFixture(t, "Core"); f.saveState.malformedWrite = true;
  const owner = f.composeSave(); assert.equal(await owner.save(), undefined); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(await owner.discardUnpublished(), false); assert.equal(await owner.save(), undefined);
  assert.equal(f.saveState.hooks, 0); assert.equal(f.saveState.discards, 0); assert.equal(f.saveState.writes, 1); await f.unchanged();
});

test("a synchronous writer throw supplies no IO closure or cleanup authority", async t => {
  const f = await orchestratedTrainingFixture(t, "Core"); f.saveState.throwWrite = true;
  const owner = f.composeSave(); assert.equal(await owner.save(), undefined);
  assert.equal(await owner.discardUnpublished(), false); assert.equal(f.saveState.discards, 0);
  assert.equal(f.saveState.writes, 1); await f.unchanged();
});

test("forged trained preparation cannot register a Model or earn cleanup after publication issue", async t => {
  const f = await orchestratedTrainingFixture(t, "Core");
  f.saveState.changePreparation = p => ({...p, candidate: {...p.candidate, candidateDigest: "sha256:" + "a".repeat(64)}});
  const owner = f.composeSave(); assert.equal(await owner.save(), undefined); await f.unchanged();
  assert.equal(await owner.discardUnpublished(), false); assert.equal(f.saveState.discards, 0);
});

test("pending original write remains owned through an outward cleanup request", async t => {
  const f = await orchestratedTrainingFixture(t, "Core"); let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), entered = new Promise<void>(resolve => {started = resolve;});
  t.after(release); f.saveState.onWrite = async () => {started(); await gate;};
  const owner = f.composeSave(), saving = owner.save(); await entered;
  assert.deepEqual(await Promise.all([owner.discardUnpublished(), owner.discardUnpublished()]), [false, false]);
  assert.equal(f.saveState.discards, 0); release(); assert.equal(await saving, undefined);
  assert.equal(f.saveState.discards, 1); assert.equal(f.saveState.writes, 1); await f.unchanged();
});

async function storedTrainingSaveFixture(t: TestContext, engine: "Core" | "SQLite", channel: "app-popup" | "authenticated-chat" = "app-popup",
  mode: "each-change" | "whole-plan" = "each-change") {
  const f = await orchestratedTrainingFixture(t, engine);
  const step = {operation: "models.save-training", idempotencyKey: f.effect.key, name: f.effect.name,
    taskId: f.effect.taskId, candidateDigest: f.effect.candidateDigest};
  const proposal = {hostIncarnationId: f.host, workspaceId: f.scope.workspaceId, steps: [step]};
  const parsed = parseHeadlessBuildPlanProposal(proposal, f.host, {allowLocalFileSave: false, allowModelTrainingSave: true}); assert.ok(parsed.ok);
  const selected = parsed.requests[0]; assert.equal(selected.operation, "models.save-training");
  if (selected.operation !== "models.save-training") assert.fail();
  const target = {hostIncarnationId: f.host, scope: f.scope, fingerprint: sha(parsed.preview)}, query = {target, isCurrent: () => f.saveState.current};
  let reviews = 0;
  const witness = await prepareHeadlessModelTrainingSaveReviews({target, requests: parsed.requests, isCurrent: query.isCurrent,
    stillAllowed: async () => f.saveState.allowed, async reviewOriginalTask(request) {
      reviews++; assert.deepEqual(request, selected); return {ok: true, value: structuredClone(f.preparation.candidate)};
    }}); assert.ok(witness.ok);
  const repository = createStructuredHeadlessPlanReviewRepository(f.root, async () => f.saveState.allowed, () => 10,
    owner => witness.validate(owner, selected), false, false, false, false, false, false, undefined, false, false, undefined,
    false, false, undefined, {allowNew: true});
  const proposed = await repository.propose({...query, proposal}); assert.ok(proposed.ok);
  const stored = createStructuredHeadlessStoredPlanReviewRepository(f.root, async () => f.saveState.allowed, () => 10, false, false, false, true);
  const actor = {organizationId: f.scope.organizationId, principalId: f.scope.principalId, channel,
    isCurrent: query.isCurrent, canDecide: async () => f.saveState.allowed};
  const decide = (expectedRevision: number, decision: {kind: "approve"; mode: "whole-plan"} | {kind: "approve"; mode: "each-change"; step: number} | {kind: "revoke"}) =>
    new HeadlessBuildPlanReviewUseCase(stored, () => 10).decide({fingerprint: target.fingerprint, expectedRevision, decision}, f.host, f.scope, actor);
  const approved = await decide(1, mode === "whole-plan" ? {kind: "approve", mode} : {kind: "approve", mode, step: 1}); assert.ok(approved.ok);
  const stepQuery = {...query, approvalRevision: approved.state.revision, step: 1};
  const authorize: Parameters<typeof prepareStructuredHeadlessPlanStepWithTrainingSave>[2] = async (_owner, scope, request) => {
    assert.deepEqual(scope, f.scope); if (request) assert.deepEqual(request, selected); return f.saveState.allowed;
  };
  const argumentsForStep: Parameters<typeof prepareStructuredHeadlessPlanStepWithTrainingSave> = [f.root, stepQuery, authorize, () => 10,
    "serialized-owner", false, undefined, undefined, undefined, undefined, undefined, undefined, false, false, undefined, true];
  const prepared = await prepareStructuredHeadlessPlanStepWithTrainingSave(...argumentsForStep);
  assert.equal(prepared?.kind, "model-training-save"); if (prepared?.kind !== "model-training-save") assert.fail();
  const request = {version: "aisb-headless-v1" as const, operation: "plan.run-step" as const,
    input: {hostIncarnationId: f.host, workspaceId: f.scope.workspaceId, fingerprint: target.fingerprint, approvalRevision: approved.state.revision, step: 1}};
  const run = (incoming = request) => runPreparedHeadlessTrainedModelSave({documents: f.root, rootDirectory: f.directory, prepared,
    request: incoming, canUse: async () => f.saveState.allowed, bindOriginalTask: f.saveConfiguration(prepared.effect).bindOriginalTask});
  return {...f, target, query, proposal, selected, parsed, witness, repository, stored, decide, prepared, argumentsForStep, request, run,
    reviewCalls: () => reviews};
}

for (const engine of ["Core", "SQLite"] as const) for (const [channel, mode] of [
  ["app-popup", "each-change"], ["app-popup", "whole-plan"], ["authenticated-chat", "each-change"], ["authenticated-chat", "whole-plan"]] as const)
  test(`${engine}: stored trained Save through ${channel}/${mode} publishes exact Model once with read-only replay`, async t => {
    const f = await storedTrainingSaveFixture(t, engine, channel, mode);
    const records = await f.partition.listDocuments<{version: number}>("headless/system-builder/plan-reviews");
    assert.equal(records.length, 1); assert.equal(records[0].value.version, 5); assert.equal(f.reviewCalls(), 1);
    const defaultStore = createStructuredHeadlessStoredPlanReviewRepository(f.root, async () => true, () => 10);
    const trainingOnly = createStructuredHeadlessStoredPlanReviewRepository(f.root, async () => true, () => 10, false, false, true);
    assert.equal((await defaultStore.read(f.query)).ok, false); assert.equal((await trainingOnly.read(f.query)).ok, false);
    assert.equal(await readStructuredHeadlessPlanModelPermission(f.partition, f.target), undefined);
    const permissions = await readStructuredHeadlessTrainingSavePlanPermission(f.partition, f.target, async () => true);
    assert.equal(permissions?.requiresTrainedResultRead, true); assert.equal(permissions?.requiresTrainingInputs, false);
    assert.equal(permissions?.requiresModelRead, true); assert.equal(permissions?.requiresModelWrite, true);
    const fenceNamespace = "headless/system-builder/plan-execution-fences", before = await f.partition.listDocuments(fenceNamespace);
    assert.equal(await f.root.runInOwnedTransaction!(owner => f.prepared.authorizeSaveOwned(owner, f.prepared.effect), () => {}), true);
    assert.deepEqual(await f.partition.listDocuments(fenceNamespace), before, "Permission checks do not write a fence.");
    const saved = await f.run(); assert.ok(saved.result.ok); assert.ok("operation" in saved.result.value);
    assert.equal(saved.result.value.operation, "models.save-training");
    assert.equal(saved.result.value.kind, "committed"); assert.equal(f.saveState.writes, 1);
    const after = await f.partition.listDocuments(fenceNamespace); assert.notDeepEqual(after, before, "Publication serializes approval changes.");
    const replay = await f.run(); assert.ok(replay.result.ok); assert.equal(replay.result.value.kind, "replayed");
    assert.deepEqual(await f.partition.listDocuments(fenceNamespace), after, "Replay does not mutate the approval fence.");
    assert.equal(f.saveState.bindRequests, 1); assert.equal(f.saveState.writes, 1); assert.equal((await f.rows()).length, 2);
    assert.doesNotMatch(JSON.stringify(saved.result), /localPath|metadata-only|history|files/);
    assert.ok("publishIfCurrent" in saved);
    let publications = 0; assert.equal(await saved.publishIfCurrent(() => {publications++; return true;}), true); assert.equal(publications, 1);
    f.noEffects();
  });

test("legacy step wrappers refuse an entire trained Save plan even when given the new private flag", async t => {
  const f = await storedTrainingSaveFixture(t, "Core"), args = f.argumentsForStep;
  assert.equal(await prepareStructuredHeadlessPlanStep(...args), undefined);
  assert.equal(await prepareStructuredHeadlessPlanStepWithModels(...args), undefined);
  const withCompiler: typeof args = [...args]; withCompiler[14] = async () => undefined;
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...withCompiler), undefined);
  const noSave: typeof args = [...args]; noSave[15] = false;
  assert.equal(await prepareStructuredHeadlessPlanStepWithTrainingSave(...noSave), undefined);
  assert.equal(f.saveState.writes, 0); await f.unchanged();
});

for (const variant of ["revoked", "stale-revision", "wrong-plan", "wrong-workspace", "transient"] as const)
  test(`stored trained Save refuses ${variant} without starting a copy`, async t => {
    const f = await storedTrainingSaveFixture(t, "Core"); let request = f.request;
    if (variant === "revoked") assert.ok((await f.decide(2, {kind: "revoke"})).ok);
    if (variant === "stale-revision") request = {...request, input: {...request.input, approvalRevision: 1}};
    if (variant === "wrong-plan") request = {...request, input: {...request.input, fingerprint: "a".repeat(64)}};
    if (variant === "wrong-workspace") request = {...request, input: {...request.input, workspaceId: createWorkspaceId("workspace.foreign")}};
    if (variant === "transient") request = {...request, transient: {contextQuery: "synthetic unused text"}} as typeof request;
    assert.equal((await f.run(request)).result.ok, false); assert.equal(f.saveState.bindRequests, 0); assert.equal(f.saveState.writes, 0); await f.unchanged();
  });

test("stored trained Save loses no reply and performs no second copy or fence mutation", async t => {
  const f = await storedTrainingSaveFixture(t, "SQLite"); f.state.dropReply = true;
  const result = await f.run(); assert.ok(result.result.ok); assert.equal(result.result.value.kind, "replayed");
  const fences = await f.partition.listDocuments("headless/system-builder/plan-execution-fences");
  const again = await f.run(); assert.ok(again.result.ok); assert.equal(f.saveState.bindRequests, 1); assert.equal(f.saveState.writes, 1);
  assert.deepEqual(await f.partition.listDocuments("headless/system-builder/plan-execution-fences"), fences); f.noEffects();
});

test("revoking the separate stored approval during copy prevents publication", async t => {
  const f = await storedTrainingSaveFixture(t, "Core");
  f.saveState.onWrite = async () => {assert.ok((await f.decide(2, {kind: "revoke"})).ok);};
  assert.equal((await f.run()).result.ok, false); assert.equal(f.saveState.writes, 1);
  assert.equal(f.saveState.discards, 1); await f.unchanged();
});

test("trained Save copies its exact run-step frame before later permission waits", async t => {
  const f = await storedTrainingSaveFixture(t, "Core"), request = structuredClone(f.request);
  const result = await runPreparedHeadlessTrainedModelSave({documents: f.root, rootDirectory: f.directory, prepared: f.prepared,
    request, canUse: async () => {request.input.fingerprint = "b".repeat(64); return true;},
    bindOriginalTask: f.saveConfiguration(f.prepared.effect).bindOriginalTask});
  assert.ok(result.result.ok); assert.equal(result.result.value.fingerprint, f.target.fingerprint); assert.equal(f.saveState.writes, 1); f.noEffects();
});

test("trained Save retains original owners, prepared methods and effect across permission waits", async t => {
  const f = await storedTrainingSaveFixture(t, "Core"), prepared = {...f.prepared, effect: structuredClone(f.prepared.effect)};
  const originalPublish = prepared.publishIfCurrent, originalExpiry = prepared.expiresAt;
  let replacements = 0, policies = 0;
  const replaced = () => {replacements++; assert.fail("A replacement must not run.");};
  const originalBind = f.saveConfiguration(prepared.effect).bindOriginalTask;
  const options: Parameters<typeof runPreparedHeadlessTrainedModelSave>[0] = {
    documents: f.root, rootDirectory: f.directory, prepared, request: f.request,
    async canUse() {
      assert.equal(this, options); policies++;
      Object.assign(options, {documents: {}, rootDirectory: "https://example.invalid/changed", bindOriginalTask: replaced, canUse: replaced});
      Object.assign(prepared, {effect: {...prepared.effect, name: "Changed", key: randomUUID()}, expiresAt: 1,
        isCurrent: replaced, authorizeSaveOwned: replaced, fenceSaveOwned: replaced, stillAllowed: replaced, publishIfCurrent: replaced});
      return true;
    },
    async bindOriginalTask(...args) {assert.equal(this, options); return originalBind(...args);},
  };
  const result = await runPreparedHeadlessTrainedModelSave(options);
  assert.ok(result.result.ok); assert.equal(result.result.value.expiresAt, originalExpiry);
  assert.equal((await f.rows()).find(row => row.modelRecordId !== f.base.modelRecordId)!.displayName, f.effect.name);
  assert.equal(policies, 2); assert.equal(replacements, 0); assert.equal(f.saveState.bindRequests, 1); assert.equal(f.saveState.writes, 1);
  assert.ok("publishIfCurrent" in result);
  let publications = 0; assert.equal(await result.publishIfCurrent(() => {publications++; return true;}), true);
  assert.equal(publications, 1); assert.notEqual(result.publishIfCurrent, originalPublish); f.noEffects();
});

for (const variant of ["not-ready", "wrong-digest", "foreign-task", "foreign-workspace", "wrong-proposal", "extra", "active"] as const)
  test(`trained Save source review refuses ${variant} without a cached or runtime fallback`, async t => {
    const f = await trainingFixture(t, "Core"), request: HeadlessModelTrainingSavePlanRequest = {version: "aisb-headless-v1", operation: "models.save-training",
      input: {hostIncarnationId: f.host, workspaceId: f.scope.workspaceId, idempotencyKey: f.effect.key, taskId: f.effect.taskId,
        candidateDigest: f.effect.candidateDigest, name: f.effect.name}};
    let calls = 0, hooks = 0;
    const reviewed = await prepareHeadlessModelTrainingSaveReviews({target: f.effect.target, requests: [request], isCurrent: () => true,
      stillAllowed: async () => true, async reviewOriginalTask() {
        calls++; const value = structuredClone(f.preparation.candidate);
        if (variant === "not-ready") return {ok: true, value: {kind: "not-ready"}};
        if (variant === "wrong-digest") Object.assign(value, {candidateDigest: "sha256:" + "a".repeat(64)});
        if (variant === "foreign-task") Object.assign(value, {requestId: randomUUID()});
        if (variant === "foreign-workspace") Object.assign(value, {workspaceId: createWorkspaceId("workspace.other")});
        if (variant === "wrong-proposal") Object.assign(value.history.provenance, {proposalDigest: "sha256:" + "a".repeat(64)});
        if (variant === "extra") Object.assign(value, {rawData: "synthetic forbidden extra"});
        if (variant === "active") Object.defineProperty(value, "candidateDigest", {enumerable: true, get() {hooks++; assert.fail("No active candidate.");}});
        return {ok: true, value};
      }});
    if (variant === "wrong-proposal") {
      assert.ok(reviewed.ok); assert.equal(await reviewed.validate(f.partition, request), false);
    } else assert.equal(reviewed.ok, false);
    assert.equal(calls, 1); assert.equal(hooks, 0); await f.unchanged();
  });

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
