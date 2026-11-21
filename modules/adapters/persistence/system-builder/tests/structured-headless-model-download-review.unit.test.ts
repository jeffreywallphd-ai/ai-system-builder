import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readModelDownloadSource} from "../../../../contracts/model";
import {parseHeadlessBuildPlanProposal, serializeHeadlessMutationInput, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../sqlite";
import {createStructuredHeadlessPlanReviewRepository, createStructuredHeadlessStoredPlanReviewRepository, readStructuredApprovedPlan,
  readStructuredRecordedContextGeneration, type BindModelDownloadReviews} from "../createStructuredHeadlessPlanReviewRepository";
import {readModelDownloadReviewBindings} from "../headlessModelDownloadReviewBindings";
import {prepareStructuredHeadlessPlanStep} from "../createStructuredHeadlessPlanStepOperationStore";

const namespace = "headless/system-builder/plan-reviews";
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function modelStep(id = "fixture/model") {
  const source = readModelDownloadSource({provider: "huggingface", modelId: id, revision: "a".repeat(40),
    format: "transformers-safetensors", license: {kind: "unknown"}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
      path, sizeBytes: 10, integrity: {algorithm: path.endsWith("safetensors") ? "sha256" : "git-blob-sha1",
        digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})), totalBytes: 30, excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId: id, revision: "a".repeat(40)});
  return {operation: "models.download", idempotencyKey: randomUUID(), name: "Support model",
    sourceManifest: {source, manifestDigest: "sha256:" + sha(source)}, allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 1800};
}
const ordinaryStep = () => ({operation: "systems.create", name: "Support system", idempotencyKey: randomUUID(),
  templateId: "reference.secured-data-review@1.0.0"});
const model = {modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-18T00:00:00.000Z",
  modelId: "synthetic/embedding", recordDigest: "sha256:" + "e".repeat(64)};
const ragStep = () => ({operation: "context.generate-rag", idempotencyKey: randomUUID(), name: "Support context",
  sources: [{kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 3}],
  settings: {kind: "rag-database", chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"],
    modelRecordId: model.modelRecordId, modelUpdatedAt: model.modelUpdatedAt, device: "cpu", batchSize: 4,
    sourceChecks: {preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false,
      requireConsentMetadata: false, includeSourceAttribution: true}}});

function fixture(steps: unknown[] = [modelStep()], root = createInMemoryStructuredDocumentStore()) {
  const host = randomUUID() as HeadlessHostIncarnationId;
  const scope = {organizationId: createOrganizationId("organization.model-review"), workspaceId: createWorkspaceId("workspace.model-review"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const proposal = {hostIncarnationId: host, workspaceId: scope.workspaceId, steps};
  const parsed = parseHeadlessBuildPlanProposal(proposal, host, {allowLocalFileSave: false, allowModelDownload: true, allowContextRagGeneration: true});
  assert.ok(parsed.ok);
  const target = {hostIncarnationId: host, scope, fingerprint: sha(parsed.preview)};
  const state = {current: true, permitted: true, sourceCurrent: true, now: 1000, bindings: 0};
  const query = {target, isCurrent: () => state.current};
  const bindings = parsed.requests.flatMap((request, index) => request.operation === "models.download"
    ? [{step: index + 1, manifestDigest: request.input.sourceManifest.manifestDigest}] : []);
  const contextModels = parsed.requests.flatMap((request, index) => request.operation === "context.generate-rag" ? [{step: index + 1, model}] : []);
  const bind: BindModelDownloadReviews = async (owner, actual, requests) => {
    state.bindings++; assert.equal(owner.organizationId, scope.organizationId); assert.deepEqual(actual, target);
    assert.deepEqual(requests, parsed.requests); return bindings;
  };
  const reviews = (options: {root?: StructuredDocumentStore; bind?: BindModelDownloadReviews | false; validation?: false} = {}) =>
    createStructuredHeadlessPlanReviewRepository(options.root ?? root, async () => state.permitted, () => state.now,
      options.validation === false ? undefined : async () => state.sourceCurrent, false, false, false, false, false, true,
      async () => contextModels, false, false, options.bind === false ? undefined : options.bind ?? bind);
  const actor = {organizationId: scope.organizationId, principalId: scope.principalId,
    isCurrent: query.isCurrent, canDecide: async () => state.permitted, channel: "app-popup" as const};
  const approve = async (repository = reviews()) => {
    const result = await new HeadlessBuildPlanReviewUseCase(repository, () => state.now).decide({fingerprint: target.fingerprint,
      expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}, host, scope, actor);
    assert.ok(result.ok); return result;
  };
  return {root, scope, proposal, parsed, target, query, state, bindings, contextModels, reviews, actor, approve,
    partition: root.forOrganization(scope.organizationId)};
}

test("stored Model review opt-in can read and decide private bindings but cannot supply proposal authority", async () => {
  const f = fixture();
  const stored = createStructuredHeadlessStoredPlanReviewRepository(f.root, async () => true, () => f.state.now, true);
  assert.deepEqual(Object.keys(stored).sort(), ["decide", "read"]);
  assert.ok((await f.reviews().propose({...f.query, proposal: f.proposal})).ok);
  assert.equal((await createStructuredHeadlessStoredPlanReviewRepository(f.root, async () => true, () => f.state.now).read(f.query)).ok, false);
  assert.ok((await stored.read(f.query)).ok);
  const approval = await new HeadlessBuildPlanReviewUseCase(stored, () => f.state.now).decide({fingerprint: f.target.fingerprint,
    expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}, f.target.hostIncarnationId, f.scope, f.actor);
  assert.ok(approval.ok);
  const other = fixture();
  const noBinder = createStructuredHeadlessPlanReviewRepository(other.root, async () => true, () => other.state.now,
    async () => true, false, false, false, false, false, false, undefined, false, false, undefined, true);
  assert.equal((await noBinder.propose({...other.query, proposal: other.proposal})).ok, false);
});

test("model metadata claims alone, disabled validation, bad coverage and substituted source digests cannot create a review", async () => {
  for (const variant of ["no-binder", "no-validation", "missing", "empty", "wrong-step", "duplicate", "extra", "wrong-digest", "self-asserted-digest"] as const) {
    const step = modelStep();
    if (variant === "self-asserted-digest") step.sourceManifest.manifestDigest = "sha256:" + "c".repeat(64);
    const f = fixture([step]);
    let rows: unknown = f.bindings;
    if (variant === "missing") rows = undefined;
    if (variant === "empty") rows = [];
    if (variant === "wrong-step") rows = [{...f.bindings[0], step: 2}];
    if (variant === "duplicate") rows = [...f.bindings, ...f.bindings];
    if (variant === "extra") rows = [{...f.bindings[0], providerVerified: true}];
    if (variant === "wrong-digest") rows = [{...f.bindings[0], manifestDigest: "sha256:" + "d".repeat(64)}];
    const repository = f.reviews({bind: variant === "no-binder" ? false : async () => rows as never,
      ...(variant === "no-validation" ? {validation: false} : {})});
    assert.equal((await repository.propose({...f.query, proposal: f.proposal})).ok, false, variant);
    assert.deepEqual(await f.partition.listNamespaces(), [], variant);
  }
});

test("exact ordered model source facts are private, copied and stable across replay and both decision channels", async () => {
  const f = fixture([modelStep(), ordinaryStep(), modelStep("fixture/other-model")]);
  const repository = f.reviews(), proposed = await repository.propose({...f.query, proposal: f.proposal});
  assert.ok(proposed.ok); assert.deepEqual(proposed.snapshot.preview, f.parsed.preview);
  assert.doesNotMatch(JSON.stringify(proposed), /modelDownloads|contextModels/);
  const before = (await f.partition.listDocuments<{version: number; modelDownloads: unknown}>(namespace))[0];
  assert.equal(before.value.version, 3); assert.deepEqual(before.value.modelDownloads, f.bindings);
  const expected = clone(f.bindings);
  f.bindings[0].manifestDigest = "sha256:" + "d".repeat(64);
  assert.deepEqual(await repository.propose({...f.query, proposal: f.proposal}), proposed);
  assert.equal(f.state.bindings, 1, "Replay retains original facts without re-preparation or replacement.");
  await f.approve(repository);
  const revoked = await new HeadlessBuildPlanReviewUseCase(repository, () => f.state.now).decide({fingerprint: f.target.fingerprint,
    expectedRevision: 2, decision: {kind: "revoke"}}, f.target.hostIncarnationId, f.scope, {...f.actor, channel: "authenticated-chat"});
  assert.ok(revoked.ok);
  const after = (await f.partition.listDocuments<{version: number; modelDownloads: unknown; state: {revision: number}}>(namespace))[0];
  assert.equal(after.value.version, 3); assert.equal(after.value.state.revision, 3); assert.deepEqual(after.value.modelDownloads, expected);
  assert.deepEqual(await f.reviews({bind: false}).read(f.query), {ok: false, code: "forbidden"});
  assert.deepEqual(await f.reviews({bind: false}).decide({...f.query, update: state => ({ok: true, state})}), {ok: false, code: "forbidden"});
});

test("private binding decoding rejects active rows and arrays without executing their hooks", () => {
  const f = fixture(); let hooks = 0;
  const getterRow = Object.defineProperty({step: 1}, "manifestDigest", {enumerable: true, get() {hooks++; return f.bindings[0].manifestDigest;}});
  const getterArray = Object.defineProperty([], "0", {enumerable: true, get() {hooks++; return f.bindings[0];}});
  const proxy = new Proxy(f.bindings, {get() {hooks++; throw new Error("Do not call");}, ownKeys() {hooks++; return [];}});
  const proxyRow = new Proxy(f.bindings[0], {getOwnPropertyDescriptor() {hooks++; throw new Error("Do not call");}});
  for (const rows of [getterArray, [getterRow], proxy, [proxyRow], Object.assign([...f.bindings], {extra: true}), Array(1)])
    assert.equal(readModelDownloadReviewBindings(rows, f.parsed.requests), undefined);
  assert.equal(hooks, 0);
  assert.ok(Object.isFrozen(readModelDownloadReviewBindings(f.bindings, f.parsed.requests)));
});

test("owned policy and source validation deny before binding; retirement after binding or at commit leaves no partial records", async () => {
  for (const phase of ["policy", "source", "binder", "commit"] as const) {
    const f = fixture();
    if (phase === "policy") f.state.permitted = false;
    if (phase === "source") f.state.sourceCurrent = false;
    const wrapped: StructuredDocumentStore = {...f.root, runInOwnedTransaction: (visit, fence) => f.root.runInOwnedTransaction!(owner => visit({
      ...owner, forOrganization(organizationId) {
        const partition = owner.forOrganization(organizationId);
        return {...partition, async writeDocument(namespace, key, value, options) {
          const row = await partition.writeDocument(namespace, key, value, options);
          if (phase === "commit" && namespace === "headless/system-builder/plan-approval-list") f.state.current = false;
          return row;
        }};
      },
    }), fence)};
    const result = await f.reviews({root: wrapped, bind: async () => {
      f.state.bindings++; if (phase === "binder") f.state.current = false; return f.bindings;
    }}).propose({...f.query, proposal: f.proposal});
    assert.equal(result.ok, false, phase);
    assert.equal(f.state.bindings, phase === "policy" || phase === "source" ? 0 : 1);
    assert.deepEqual(await f.partition.listNamespaces(), [], phase);
  }
});

test("bindings receive detached exact actor/client/host/plan data and cannot mutate the saved proposal", async () => {
  const f = fixture();
  const result = await f.reviews({bind: async (_partition, target, requests) => {
    assert.deepEqual(target, f.target); assert.deepEqual(requests, f.parsed.requests);
    (target.scope as {principalId: string}).principalId = "changed.actor";
    const request = requests[0]; assert.equal(request.operation, "models.download");
    if (request.operation === "models.download") (request.input as {name: string}).name = "Changed name";
    return f.bindings;
  }}).propose({...f.query, proposal: f.proposal});
  assert.ok(result.ok); assert.deepEqual(result.snapshot.preview, f.parsed.preview);
  assert.equal(f.scope.principalId, "principal.synthetic");
  for (const target of [{...f.target, hostIncarnationId: randomUUID() as HeadlessHostIncarnationId},
    {...f.target, fingerprint: "f".repeat(64)}, ...[{principalId: "another.actor"}, {registeredClientId: randomUUID()},
      {organizationId: createOrganizationId("another.organization")}, {workspaceId: createWorkspaceId("another.workspace")}]
      .map(patch => ({...f.target, scope: {...f.scope, ...patch}}))])
    assert.deepEqual(await f.reviews().read({...f.query, target}), {ok: false, code: "forbidden"});
  f.state.now += 15 * 60 * 1000;
  assert.deepEqual(await f.reviews().read(f.query), {ok: false, code: "expired"});
});

test("version-3 mixed Context/model reviews retain independent RAG witnesses and historic lineage", async () => {
  const f = fixture([modelStep(), ragStep()]), repository = f.reviews();
  assert.ok((await repository.propose({...f.query, proposal: f.proposal})).ok); await f.approve(repository);
  const approved = await f.root.runInOwnedTransaction!(owner => readStructuredApprovedPlan(owner.forOrganization(f.scope.organizationId), f.target, 2, 2), () => {});
  assert.deepEqual(approved?.contextModels, f.contextModels);
  const request = f.parsed.requests[1]; assert.equal(request.operation, "context.generate-rag");
  const recorded = await readStructuredRecordedContextGeneration(f.partition, f.target, 2,
    createHash("sha256").update(serializeHeadlessMutationInput(request)).digest("hex"));
  assert.deepEqual(recorded, {request, embeddingModel: model});
  const stored = (await f.partition.listDocuments<{version: number; contextModels: unknown; modelDownloads: unknown}>(namespace))[0].value;
  assert.equal(stored.version, 3); assert.deepEqual(stored.contextModels, f.contextModels); assert.deepEqual(stored.modelDownloads, f.bindings);
});

test("Model verification cannot replace a missing or mismatched RAG model witness in a mixed proposal", async () => {
  for (const rows of [undefined, [], [{step: 1, model}], [{step: 2, model: {...model, modelRecordId: "another.model"}}]]) {
    const f = fixture([modelStep(), ragStep()]);
    const repository = createStructuredHeadlessPlanReviewRepository(f.root, async () => true, () => f.state.now, async () => true,
      false, false, false, false, false, true, async () => rows as never, false, false, async () => f.bindings);
    assert.equal((await repository.propose({...f.query, proposal: f.proposal})).ok, false);
    assert.deepEqual(await f.partition.listNamespaces(), []);
  }
});

test("a Context binder cannot alter the Model selection, request coverage or exact saved fingerprint of a mixed plan", async () => {
  for (const mutation of ["nested-source", "remove-model", "reorder"] as const) {
    const f = fixture([modelStep(), ragStep()]);
    const repository = createStructuredHeadlessPlanReviewRepository(f.root, async () => true, () => f.state.now, async () => true,
      false, false, false, false, false, true, async (_partition, requests) => {
        const mutable = requests as unknown as Array<{operation: string; input: {sourceManifest?: {manifestDigest: string; source: {license: unknown}}}}>;
        if (mutation === "nested-source") {
          const source = mutable[0].input.sourceManifest!;
          source.source.license = {kind: "provider-declared", identifier: "changed-license"};
          source.manifestDigest = "sha256:" + "f".repeat(64);
        } else if (mutation === "remove-model") mutable.splice(0, 1);
        else mutable.reverse();
        return f.contextModels;
      }, false, false, async (_partition, target, requests) => {
        assert.deepEqual(target, f.target); assert.deepEqual(requests, f.parsed.requests);
        return f.bindings;
      });
    const proposed = await repository.propose({...f.query, proposal: f.proposal});
    assert.ok(proposed.ok, mutation); assert.deepEqual(proposed.snapshot.preview, f.parsed.preview);
    assert.deepEqual(await repository.read(f.query), proposed, "Stored fingerprint and bindings must remain rereadable.");
    const record = (await f.partition.listDocuments<{modelDownloads: unknown; contextModels: unknown}>(namespace))[0].value;
    assert.deepEqual(record.modelDownloads, f.bindings); assert.deepEqual(record.contextModels, f.contextModels);
  }
});

test("stored version/digest/step tampering cannot borrow unbound history or change approved source facts", async () => {
  for (const change of ["version1", "version2", "missing", "changed-digest", "changed-step", "extra-context"] as const) {
    const f = fixture(); assert.ok((await f.reviews().propose({...f.query, proposal: f.proposal})).ok);
    const wrapped: StructuredDocumentStore = {...f.root, runInOwnedTransaction: (visit, fence) => f.root.runInOwnedTransaction!(owner => visit({
      ...owner, forOrganization(organizationId) {
        const partition = owner.forOrganization(organizationId);
        return {...partition, async readDocument<T>(selected: string, key: string) {
          const row = await partition.readDocument<T>(selected, key);
          if (!row || selected !== namespace) return row;
          const value = clone(row.value) as Record<string, unknown>;
          if (change === "version1" || change === "version2") value.version = change === "version1" ? 1 : 2;
          if (change === "missing") delete value.modelDownloads;
          if (change === "changed-digest") value.modelDownloads = [{...f.bindings[0], manifestDigest: "sha256:" + "c".repeat(64)}];
          if (change === "changed-step") value.modelDownloads = [{...f.bindings[0], step: 2}];
          if (change === "extra-context") value.contextModels = [];
          return {...row, value: value as T};
        }};
      },
    }), fence)};
    assert.deepEqual(await f.reviews({root: wrapped}).read(f.query), {ok: false, code: "unconfirmed"}, change);
  }
});

test("a stored Model plan cannot execute even an earlier ordinary system step", async () => {
  const f = fixture([ordinaryStep(), modelStep()]); assert.ok((await f.reviews().propose({...f.query, proposal: f.proposal})).ok);
  await f.approve();
  for (const step of [1, 2]) assert.equal(await prepareStructuredHeadlessPlanStep(f.root, {...f.query, approvalRevision: 2, step},
    async () => true, () => f.state.now), undefined);
  assert.equal((await f.partition.listNamespaces()).some(name => name.includes("system-record") || name.includes("operation-receipt")), false);
});

test("SQLite reopen retains private Model bindings; competing popup/chat approval commits once", async () => {
  const directory = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), "headless-model-review-")));
  const policy = resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory});
  let db: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  try {
    db = await openLocalSqliteDatabase({policy});
    const f = fixture([modelStep()], db.documents), proposed = await f.reviews().propose({...f.query, proposal: f.proposal});
    assert.ok(proposed.ok);
    await db.close(); db = undefined; db = await openLocalSqliteDatabase({policy});
    const repository = f.reviews({root: db.documents});
    assert.deepEqual(await repository.read(f.query), proposed);
    const decisions = new HeadlessBuildPlanReviewUseCase(repository, () => f.state.now);
    const results = await Promise.all(["app-popup", "authenticated-chat"].map(channel => decisions.decide({fingerprint: f.target.fingerprint,
      expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}, f.target.hostIncarnationId, f.scope,
      {...f.actor, channel: channel as "app-popup" | "authenticated-chat"})));
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.ok(results.some(result => !result.ok && result.code === "stale"));
    const record = (await db.documents.forOrganization(f.scope.organizationId).listDocuments<{version: number; modelDownloads: unknown}>(namespace))[0];
    assert.equal(record.value.version, 3); assert.deepEqual(record.value.modelDownloads, f.bindings);
  } finally {await db?.close(); await rm(directory, {recursive: true, force: true});}
});
