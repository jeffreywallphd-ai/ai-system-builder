import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test, {type TestContext} from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readModelDownloadSource} from "../../../../contracts/model";
import {isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal, readHeadlessModelTrainingInputsValue} from "../../../../contracts/headless";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../sqlite";
import {createStructuredHeadlessPlanReviewRepository, createStructuredHeadlessStoredPlanReviewRepository, readStructuredApprovedPlan,
  readStructuredHeadlessPlanModelPermission, type BindModelTrainingReviews} from "../createStructuredHeadlessPlanReviewRepository";
import {readModelTrainingReviewBindings} from "../headlessModelTrainingReviewBindings";
import {prepareStructuredHeadlessPlanStep} from "../createStructuredHeadlessPlanStepOperationStore";

const namespace = "headless/system-builder/plan-reviews";
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function fixture(t: TestContext, storage: "Core" | "SQLite" = "Core", mixed = false, ordinaryPrefix = false) {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(join(boundary, "training-bound-review-")));
  const identity = await lstat(directory, {bigint: true});
  let database = storage === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  let root = database?.documents ?? createInMemoryStructuredDocumentStore();
  t.after(async () => {await database?.close(); const now = await lstat(directory, {bigint: true});
    assert.equal(dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert.ok(now.isDirectory() && !now.isSymbolicLink()); assert.equal(now.dev, identity.dev); assert.equal(now.ino, identity.ino);
    await rm(directory, {recursive: true});});
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const scope = {organizationId: createOrganizationId("org.training-review"), workspaceId: createWorkspaceId("workspace.training-review"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const at = "2026-11-21T00:00:00.000Z";
  const training = {operation: "models.train", idempotencyKey: randomUUID(), name: "Private training trial",
    model: {modelRecordId: "model.synthetic", updatedAt: at},
    dataset: {datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64)},
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 2, seed: 0}, validation: {enabled: false}}};
  const steps: unknown[] = [training];
  if (mixed || ordinaryPrefix) steps.unshift({operation: "systems.create", idempotencyKey: randomUUID(), name: "Support system",
    templateId: "reference.secured-data-review@1.0.0"});
  const embedding = {modelRecordId: "model.embedding", modelUpdatedAt: at, modelId: "fixture/embedding", recordDigest: "sha256:" + "e".repeat(64)};
  if (mixed) {
    const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/download", revision: "a".repeat(40),
      format: "transformers-safetensors", license: {kind: "unknown"}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
        path, sizeBytes: 10, integrity: {algorithm: "sha256", digest: "b".repeat(64)}})), totalBytes: 30, excludedFileCount: 0,
      sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
      {provider: "huggingface", modelId: "fixture/download", revision: "a".repeat(40)});
    steps.push({operation: "models.download", idempotencyKey: randomUUID(), name: "Future model files",
      sourceManifest: {source, manifestDigest: "sha256:" + sha(source)}, allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 60},
    {operation: "context.generate-rag", idempotencyKey: randomUUID(), name: "Support context",
      sources: [{kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 3}],
      settings: {kind: "rag-database", chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"],
        modelRecordId: embedding.modelRecordId, modelUpdatedAt: at, device: "cpu", batchSize: 4,
        sourceChecks: {preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false,
          requireConsentMetadata: false, includeSourceAttribution: true}}});
  }
  const proposal = {hostIncarnationId: host, workspaceId: scope.workspaceId, steps};
  const parsed = parseHeadlessBuildPlanProposal(proposal, host, {allowLocalFileSave: false, allowModelTraining: true,
    allowModelDownload: mixed, allowContextRagGeneration: mixed}); assert.ok(parsed.ok);
  const selected = parsed.requests.find(request => request.operation === "models.train"); assert.ok(selected?.operation === "models.train");
  const inputs = readHeadlessModelTrainingInputsValue({workspaceId: scope.workspaceId,
    model: {...training.model, source: "local", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface",
      modelId: "fixture/base", taskTags: ["chat"], serializationFormat: "safetensors"},
    dataset: {datasetId: training.dataset.datasetId, version: {versionId: training.dataset.versionId, versionDigest: training.dataset.versionDigest,
      createdAt: at, totalRows: 10, sourceCount: 1, artifactCount: 4, parentVersionId: null, splitSeed: 0, recipeDigest: "sha256:" + "b".repeat(64),
      quality: {policyFingerprint: "sha256:" + "c".repeat(64), reportFingerprint: "sha256:" + "d".repeat(64)},
      splits: [{role: "train", rowCount: 6}, {role: "validation", rowCount: 2}, {role: "test", rowCount: 2}]}},
    verification: {inputBytes: "not-checked", runtimeReadiness: "not-checked", trainingCompatibility: "not-checked", resourceAdmission: "not-checked",
      licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"}, trainingApproval: "required"}, selected.input); assert.ok(inputs);
  const bindings = [{step: mixed || ordinaryPrefix ? 2 : 1, inputs, proposalDigest: "sha256:" + sha({request: selected, inputs})}];
  const downloads = parsed.requests.flatMap((request, index) => request.operation === "models.download"
    ? [{step: index + 1, manifestDigest: request.input.sourceManifest.manifestDigest}] : []);
  const contexts = mixed ? [{step: 4, model: embedding}] : [];
  const target = {hostIncarnationId: host, scope, fingerprint: sha(parsed.preview)};
  const state = {current: true, allowed: true, sourceCurrent: true as boolean | "stale", now: 1000, binds: 0};
  const query = {target, isCurrent: () => state.current};
  const bind: BindModelTrainingReviews = async (owner, actual, actualRequests) => {
    state.binds++; assert.equal(owner.organizationId, scope.organizationId); assert.deepEqual(actual, target);
    assert.deepEqual(actualRequests, parsed.requests); return bindings;
  };
  function reviews(options: {owner?: StructuredDocumentStore; bind?: BindModelTrainingReviews | false; validation?: false} = {}) {
    return createStructuredHeadlessPlanReviewRepository(options.owner ?? root, async () => state.allowed, () => state.now,
      options.validation === false ? undefined : async () => state.sourceCurrent, false, false, false, false, false, mixed,
      mixed ? async () => contexts : undefined, false, false, mixed ? async () => downloads : undefined, false, false,
      {bind: options.bind === false ? undefined : options.bind ?? bind});
  }
  const actor = {organizationId: scope.organizationId, principalId: scope.principalId, channel: "authenticated-chat" as const,
    isCurrent: query.isCurrent, canDecide: async () => state.allowed};
  const decide = (repository: ReturnType<typeof reviews>, revision: number, decision: {kind: "approve"; mode: "whole-plan"} | {kind: "revoke"}) =>
    new HeadlessBuildPlanReviewUseCase(repository, () => state.now).decide({fingerprint: target.fingerprint, expectedRevision: revision, decision}, host, scope, actor);
  return {get root() {return root;}, get partition() {return root.forOrganization(scope.organizationId);}, scope, host, proposal, parsed,
    target, state, query, bindings, downloads, contexts, reviews, decide, async reopen() {
      assert.ok(database); await database.close(); database = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})});
      root = database.documents;
    }};
}

for (const storage of ["Core", "SQLite"] as const) {
  test(storage + ": exact bound private training approval persists, stays hidden by default and survives revoke without a task", async t => {
    const f = await fixture(t, storage), repository = f.reviews();
    const proposed = await repository.propose({...f.query, proposal: f.proposal}); assert.ok(proposed.ok);
    assert.equal(proposed.snapshot.preview.version, "aisb-build-plan-preview-v13"); assert.equal(proposed.snapshot.state.status, "pending");
    assert.doesNotMatch(JSON.stringify(proposed), /modelTrainings|sourceCount|proposalDigest|localPath/);
    const before = (await f.partition.listDocuments<{version: number; modelTrainings: unknown}>(namespace))[0];
    assert.equal(before.value.version, 4); assert.deepEqual(before.value.modelTrainings, f.bindings);
    assert.deepEqual(await f.reviews({bind: false}).read(f.query), {ok: false, code: "forbidden"});
    const hidden = createStructuredHeadlessStoredPlanReviewRepository(f.root, async () => true, () => f.state.now);
    assert.deepEqual(await hidden.read(f.query), {ok: false, code: "forbidden"});
    assert.equal(await readStructuredHeadlessPlanModelPermission(f.partition, f.target), undefined);
    for (const patch of [{principalId: "foreign.actor"}, {registeredClientId: randomUUID()},
      {organizationId: createOrganizationId("foreign.org")}, {workspaceId: createWorkspaceId("foreign.workspace")}])
      assert.deepEqual(await repository.read({...f.query, target: {...f.target, scope: {...f.scope, ...patch}}}), {ok: false, code: "forbidden"});
    assert.ok((await f.decide(repository, 1, {kind: "approve", mode: "whole-plan"})).ok);
    const approved = await f.root.runInOwnedTransaction!(owner => readStructuredApprovedPlan(owner.forOrganization(f.scope.organizationId), f.target, 2, 1), () => {});
    assert.deepEqual(approved?.modelTrainings, f.bindings);
    assert.equal(await prepareStructuredHeadlessPlanStep(f.root, {target: f.target, approvalRevision: 2, step: 1, isCurrent: f.query.isCurrent}, async () => true, () => f.state.now), undefined);
    if (storage === "SQLite") await f.reopen();
    const stored = createStructuredHeadlessStoredPlanReviewRepository(f.root, async () => f.state.allowed, () => f.state.now, false, false, true);
    assert.equal("propose" in stored, false); assert.ok((await stored.read(f.query)).ok);
    const revoked = await new HeadlessBuildPlanReviewUseCase(stored, () => f.state.now).decide({fingerprint: f.target.fingerprint,
      expectedRevision: 2, decision: {kind: "revoke"}}, f.host, f.scope, {organizationId: f.scope.organizationId,
      principalId: f.scope.principalId, channel: "app-popup", isCurrent: f.query.isCurrent, canDecide: async () => true});
    assert.ok(revoked.ok); assert.equal(revoked.state.status, "revoked");
    const after = (await f.partition.listDocuments<{version: number; modelTrainings: unknown}>(namespace))[0];
    assert.equal(after.value.version, 4); assert.deepEqual(after.value.modelTrainings, f.bindings);
    f.state.allowed = false; assert.deepEqual(await stored.read(f.query), {ok: false, code: "forbidden"});
    assert.equal((await f.partition.listNamespaces()).some(name => /task|model-registry/.test(name)), false);
  });

  test(storage + ": missing binding/validation, wrong facts and expiry/currentness veto cannot publish a training review", async t => {
    const f = await fixture(t, storage);
    for (const options of [{bind: false as const}, {validation: false as const}])
      assert.deepEqual(await f.reviews(options).propose({...f.query, proposal: f.proposal}), {ok: false, code: "invalid"});
    for (const rows of [undefined, [], [{...f.bindings[0], step: 2}], [{...f.bindings[0], proposalDigest: "sha256:" + "f".repeat(64)}],
      [{...f.bindings[0], inputs: {...f.bindings[0].inputs, trainingApproval: "granted"}}]]) {
      const result = await f.reviews({bind: async () => rows as never}).propose({...f.query, proposal: f.proposal});
      assert.deepEqual(result, {ok: false, code: "forbidden"});
    }
    f.state.sourceCurrent = false; assert.deepEqual(await f.reviews().propose({...f.query, proposal: f.proposal}), {ok: false, code: "forbidden"});
    f.state.sourceCurrent = "stale"; assert.deepEqual(await f.reviews().propose({...f.query, proposal: f.proposal}), {ok: false, code: "stale"});
    f.state.sourceCurrent = true;
    const retired = await f.reviews({bind: async () => {f.state.current = false; return f.bindings;}}).propose({...f.query, proposal: f.proposal});
    assert.deepEqual(retired, {ok: false, code: "forbidden"}); f.state.current = true;
    assert.equal((await f.partition.listDocuments(namespace)).length, 0);
    assert.ok((await f.reviews().propose({...f.query, proposal: f.proposal})).ok);
    f.state.now += 15 * 60 * 1000; assert.deepEqual(await f.reviews().read(f.query), {ok: false, code: "expired"});
  });
}

test("ordered binding schema refuses forged identities, active fields, extra readiness and changed exact settings", async t => {
  const f = await fixture(t), valid = readModelTrainingReviewBindings(f.bindings, f.parsed.requests); assert.ok(valid);
  assert.ok(Object.isFrozen(valid[0].inputs.dataset.version));
  for (const rows of [[...f.bindings, ...f.bindings], [{...f.bindings[0], extra: true}],
    [{...f.bindings[0], inputs: {...f.bindings[0].inputs, workspaceId: createWorkspaceId("foreign.workspace")}}],
    [{...f.bindings[0], inputs: {...f.bindings[0].inputs, verification: {...f.bindings[0].inputs.verification, inputBytes: "passed"}}}]])
    assert.equal(readModelTrainingReviewBindings(rows, f.parsed.requests), undefined);
  let hooks = 0; const active = {...f.bindings[0]};
  Object.defineProperty(active, "inputs", {enumerable: true, get() {hooks++; return f.bindings[0].inputs;}});
  assert.equal(readModelTrainingReviewBindings([active], f.parsed.requests), undefined); assert.equal(hooks, 0);
  const changed = copy(f.parsed.requests); const request = changed[0]; assert.ok(request.operation === "models.train");
  if (request.operation === "models.train") (request.input.training.commonParameters as {maxSteps: number}).maxSteps = 3;
  assert.equal(readModelTrainingReviewBindings(f.bindings, changed), undefined);
});

test("each-change approvals preserve bindings across both channels while every legacy step remains denied", async t => {
  const f = await fixture(t, "Core", false, true), repository = f.reviews();
  assert.ok((await repository.propose({...f.query, proposal: f.proposal})).ok);
  const decisions = new HeadlessBuildPlanReviewUseCase(repository, () => f.state.now);
  for (const [index, channel] of ["authenticated-chat", "app-popup"].entries()) {
    const result = await decisions.decide({fingerprint: f.target.fingerprint, expectedRevision: index + 1,
      decision: {kind: "approve", mode: "each-change", step: index + 1}}, f.host, f.scope,
    {organizationId: f.scope.organizationId, principalId: f.scope.principalId, channel: channel as "authenticated-chat" | "app-popup",
      isCurrent: f.query.isCurrent, canDecide: async () => f.state.allowed});
    assert.ok(result.ok); assert.equal(result.state.status, index === 0 ? "pending" : "approved"); assert.equal(result.state.approvedSteps, index + 1);
    assert.equal(await prepareStructuredHeadlessPlanStep(f.root, {target: f.target, approvalRevision: index + 2,
      step: 1, isCurrent: f.query.isCurrent}, async () => true, () => f.state.now), undefined);
  }
  const approved = await f.root.runInOwnedTransaction!(owner => readStructuredApprovedPlan(owner.forOrganization(f.scope.organizationId), f.target, 3, 2), () => {});
  assert.deepEqual(approved?.modelTrainings, f.bindings);
});

test("mixed version4 keeps separate training, Model transfer and RAG witnesses and denies legacy adoption", async t => {
  const f = await fixture(t, "SQLite", true), repository = f.reviews();
  assert.ok((await repository.propose({...f.query, proposal: f.proposal})).ok);
  assert.ok((await f.decide(repository, 1, {kind: "approve", mode: "whole-plan"})).ok);
  const raw = (await f.partition.listDocuments<Record<string, unknown>>(namespace))[0];
  assert.equal(raw.value.version, 4); assert.deepEqual(raw.value.modelTrainings, f.bindings);
  assert.deepEqual(raw.value.modelDownloads, f.downloads); assert.deepEqual(raw.value.contextModels, f.contexts);
  const approved = await f.root.runInOwnedTransaction!(owner => readStructuredApprovedPlan(owner.forOrganization(f.scope.organizationId), f.target, 2, 2), () => {});
  assert.deepEqual(approved?.modelTrainings, f.bindings); assert.deepEqual(approved?.modelDownloads, f.downloads); assert.deepEqual(approved?.contextModels, f.contexts);
  for (const patch of [{version: 1}, {version: 2}, {version: 3}, {version: 99}, {modelTrainings: []}, {modelDownloads: []}, {contextModels: []}]) {
    const current = await f.partition.readDocument(namespace, raw.key); assert.ok(current);
    await f.partition.writeDocument(namespace, raw.key, {...raw.value, ...patch,
      state: {...raw.value.state as Record<string, unknown>, revision: current.revision + 1}}, {expectedRevision: current.revision});
    assert.equal((await repository.read(f.query)).ok, false);
  }
});

test("a binder receives detached target/requests and cannot replace the original approval definition", async t => {
  const f = await fixture(t);
  const result = await f.reviews({bind: async (_owner, target, requests) => {
    (target.scope as {principalId: string}).principalId = "changed.actor";
    (requests[0].input as {name: string}).name = "Changed outside the definition";
    return f.bindings;
  }}).propose({...f.query, proposal: f.proposal});
  assert.ok(result.ok); assert.deepEqual(result.snapshot.preview, f.parsed.preview);
  assert.equal(f.scope.principalId, "principal.synthetic");
  const record = (await f.partition.listDocuments<{modelTrainings: unknown}>(namespace))[0];
  assert.deepEqual(record.value.modelTrainings, f.bindings);
});
