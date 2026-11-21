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
  type ModelReferenceSaveEffect} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model/createLocalModelRegistryAdapter";
import {ModelDownloadTasksUseCase} from "../../../../application/use-cases/model/model-download-tasks.use-case";
import {OwnedTaskReconcilerService} from "../../../../application/services/runtime/owned-task-reconciler.service";
import type {ApprovedModelSourceRegistrationPreparation} from "../../../../application/ports/model";
import {isHeadlessHostIncarnationId, readHeadlessModelDownloadPlanRequest, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {readModelDownloadSource, type ModelInventoryRecord} from "../../../../contracts/model";
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
