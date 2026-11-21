import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test, {type TestContext} from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createStructuredHeadlessPlanReviewRepository} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {prepareStructuredHeadlessPlanStep, prepareStructuredHeadlessPlanStepWithModels} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import {readStructuredModelPlanAttemptByPlan} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {ModelDownloadTasksUseCase} from "../../../../application/use-cases/model/model-download-tasks.use-case";
import {OwnedTaskReconcilerService} from "../../../../application/services/runtime/owned-task-reconciler.service";
import type {HeadlessOperationScope} from "../../../../application/ports/system-builder";
import type {ApprovedModelSourceDownloadRequest, ApprovedModelSourceDownloadControl} from "../../../../application/ports/model";
import {readModelDownloadSource} from "../../../../contracts/model";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {parseHeadlessBuildPlanProposal, type HeadlessHostIncarnationId, type HeadlessPlanStepRequest} from "../../../../contracts/headless";
import {TaskType, type RuntimeTaskRecord} from "../../../../contracts/runtime";
import {runPreparedHeadlessModelDownload} from "../headlessModelDownloadExecution";

type Options = {root?: ReturnType<typeof createInMemoryStructuredDocumentStore>; channel?: "app-popup" | "authenticated-chat";
  mode?: "whole-plan" | "each-change"; precedingSystem?: boolean; followingSystem?: boolean};
async function fixture(t: TestContext, options: Options = {}) {
  const root = options.root ?? createInMemoryStructuredDocumentStore(), host = randomUUID() as HeadlessHostIncarnationId;
  const scope = {organizationId: createOrganizationId("organization.model-execution"), workspaceId: createWorkspaceId("workspace.model-execution"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const state = {current: true, policy: true, business: true, host: true, now: 1000, starts: 0, resolutions: 0, ordinary: 0, registrations: 0,
    unavailable: false, uncertain: false, loseCallerOnStart: false, loseReply: false};
  const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40),
    format: "transformers-safetensors", license: {kind: "unknown"}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
      path, sizeBytes: 2, integrity: {algorithm: path.endsWith("safetensors") ? "sha256" : "git-blob-sha1",
        digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})), totalBytes: 6, excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40)});
  const digest = "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex");
  const modelStep = {operation: "models.download", idempotencyKey: randomUUID(), name: "Support model",
    sourceManifest: {source, manifestDigest: digest}, allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 1800};
  const ordinaryStep = {operation: "systems.create", idempotencyKey: randomUUID(), name: "Support system", templateId: "reference.secured-data-review@1.0.0"};
  const proposal = {hostIncarnationId: host, workspaceId: scope.workspaceId,
    steps: options.precedingSystem ? [ordinaryStep, modelStep] : options.followingSystem ? [modelStep, ordinaryStep] : [modelStep]};
  const parsed = parseHeadlessBuildPlanProposal(proposal, host, {allowLocalFileSave: false, allowModelDownload: true}); assert.ok(parsed.ok);
  const target = {hostIncarnationId: host, scope, fingerprint: createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex")};
  const step = options.precedingSystem ? 2 : 1, isCurrent = () => state.current;
  const reviews = createStructuredHeadlessPlanReviewRepository(root, async () => state.policy, () => state.now, async () => true,
    false, false, false, false, false, false, undefined, false, false, async () => [{step, manifestDigest: digest}]);
  assert.ok((await reviews.propose({target, proposal, isCurrent})).ok);
  const decisions = new HeadlessBuildPlanReviewUseCase(reviews, () => state.now);
  const actor = {organizationId: scope.organizationId, principalId: scope.principalId,
    channel: options.channel ?? "app-popup" as const, isCurrent, canDecide: async () => state.policy};
  const decision = await decisions.decide({fingerprint: target.fingerprint, expectedRevision: 1,
    decision: options.mode === "each-change" ? {kind: "approve", mode: "each-change", step: 1} : {kind: "approve", mode: "whole-plan"}}, host, scope, actor); assert.ok(decision.ok);
  const query = {target, approvalRevision: 2, step, isCurrent};
  const authorize = async (_owner: unknown, actual: HeadlessOperationScope) => state.policy && JSON.stringify(actual) === JSON.stringify(scope);
  const prepare = async () => {
    const prepared = await prepareStructuredHeadlessPlanStepWithModels(root, query, authorize, () => state.now);
    assert.ok(prepared?.kind === "model-download"); return prepared;
  };
  const reconciler = new OwnedTaskReconcilerService(); t.after(() => reconciler.stopObservation());
  const records = new Map<string, RuntimeTaskRecord>(), controls: ApprovedModelSourceDownloadControl[] = [];
  const useCase = new ModelDownloadTasksUseCase({taskReconciler: reconciler, now: () => "2026-11-21T00:00:00Z",
    runtimeTaskRegistry: {async startTask() {state.ordinary++; throw new Error("Ordinary fallback forbidden.");},
      async getTaskStatus() {throw new Error("Shared-ID discovery forbidden.");}, async listTasks() {throw new Error("Enumeration forbidden.");},
      async cancelTask() {throw new Error("Generic cancellation forbidden.");}},
    modelRegistry: {async registerDownloadedModel() {state.registrations++; throw new Error("Separate save required.");}} as never,
    modelDownloadCompletion: {async readCompletedModelDownload() {throw new Error("Generic completion forbidden.");}},
    approvedModelSourceDownload: {async startApprovedModelSource(input: ApprovedModelSourceDownloadRequest, control: ApprovedModelSourceDownloadControl) {
      state.starts++; controls.push(control);
      assert.equal(input.workspaceId, scope.workspaceId); assert.deepEqual(input.sourceManifest, modelStep.sourceManifest);
      assert.equal(input.maximumDurationSeconds, 1800); assert.deepEqual(input.allowedOrigins, ["https://huggingface.co"]);
      assert.ok(Object.isFrozen(input.sourceManifest.source.files));
      assert.deepEqual(await root.runInOwnedTransaction!(owner => readStructuredModelPlanAttemptByPlan(owner.forOrganization(scope.organizationId),
        scope, host, target.fingerprint, step), () => {}), {kind: "unconfirmed"}, "Issuance is durably committed before the source call.");
      if (state.unavailable) return {kind: "unavailable"};
      if (state.uncertain) throw new Error("Synthetic unknown private start failure.");
      if (state.loseCallerOnStart) state.current = false;
      const record: RuntimeTaskRecord = {requestId: input.requestId, workspaceId: scope.workspaceId, taskType: TaskType.MODEL_DOWNLOAD,
        status: "running", concurrencyClass: "io", updatedAt: "2026-11-21T00:00:00Z"};
      records.set(input.requestId, record);
      return {kind: "accepted", value: {requestId: input.requestId, status: "running"}, task: Object.freeze({requestId: input.requestId,
        workspaceId: scope.workspaceId, modelId: source.modelId, revision: source.revision, manifestDigest: digest,
        read: async () => ({...record}), cancel: async () => ({requestId: input.requestId, status: record.status, cancelled: false}),
        readCompleted: async () => undefined})};
    }} });
  const request: HeadlessPlanStepRequest = {version: "aisb-headless-v1", operation: "plan.run-step", input: {
    hostIncarnationId: host, workspaceId: scope.workspaceId, fingerprint: target.fingerprint, approvalRevision: 2, step}};
  const run = async (prepared: Awaited<ReturnType<typeof prepare>>) => runPreparedHeadlessModelDownload({prepared, request,
    context: scope, canUse: async () => state.current && state.policy, isHostCurrent: () => state.host,
    stillBusinessAllowed: async () => state.business && state.host,
    resolveStart: async () => {state.resolutions++; return useCase.startApprovedSource.bind(useCase);}});
  const attempt = () => root.runInOwnedTransaction!(owner => readStructuredModelPlanAttemptByPlan(owner.forOrganization(scope.organizationId),
    scope, host, target.fingerprint, step), () => {});
  return {root, state, source, digest, scope, target, query, authorize, reviews, decisions, actor, prepare, reconciler, records, controls,
    useCase, request, run, attempt};
}

for (const channel of ["app-popup", "authenticated-chat"] as const) for (const mode of ["whole-plan", "each-change"] as const)
test(`${channel}/${mode}: exact approved Model step admits one original source and replays the durable outcome`, async t => {
  const f = await fixture(t, {channel, mode}), prepared = await f.prepare();
  assert.ok(Object.isFrozen(prepared.request.input.sourceManifest.source));
  const result = await f.run(prepared); assert.ok(result.result.ok);
  if (!result.result.ok || !("operation" in result.result.value)) assert.fail();
  assert.equal(result.result.value.operation, "models.download"); assert.equal(result.result.value.kind, "started");
  assert.equal(f.state.starts, 1); assert.equal(f.state.ordinary, 0); assert.equal(f.state.registrations, 0);
  assert.deepEqual(await f.attempt(), {kind: "accepted", reference: result.result.value.reference});
  const replay = await f.run(await f.prepare()); assert.ok(replay.result.ok);
  assert.equal(replay.result.value.kind, "replayed"); assert.equal(f.state.starts, 1); assert.equal(f.state.resolutions, 1);
  assert.ok("publishIfCurrent" in result && result.publishIfCurrent);
  let published = 0; assert.equal(await result.publishIfCurrent(() => {published++; return true;}), true); assert.equal(published, 1);
  assert.equal((await f.useCase.list({workspaceId: f.scope.workspaceId}, f.scope)).activities.length, 1);
});

test("unconfigured legacy preparation and missing/changed approval/policy deny without Model effects", async t => {
  const f = await fixture(t);
  assert.equal(await prepareStructuredHeadlessPlanStep(f.root, f.query, f.authorize, () => f.state.now), undefined);
  assert.equal(await prepareStructuredHeadlessPlanStep(f.root, f.query, f.authorize, () => f.state.now,
    "serialized-owner", false, undefined, undefined, undefined, undefined, undefined, undefined, true), undefined);
  for (const variant of ["approval", "policy", "caller", "expiry"] as const) {
    const f = await fixture(t), prepared = await f.prepare();
    if (variant === "approval") assert.ok((await f.decisions.decide({fingerprint: f.target.fingerprint, expectedRevision: 2,
      decision: {kind: "revoke"}}, f.target.hostIncarnationId, f.scope, f.actor)).ok);
    if (variant === "policy") f.state.policy = false;
    if (variant === "caller") f.state.current = false;
    if (variant === "expiry") f.state.now += 15 * 60 * 1000;
    assert.equal((await f.run(prepared)).result.ok, false); assert.equal(f.state.starts, 0); assert.equal(f.state.resolutions, 0);
    assert.equal(await f.attempt(), undefined);
  }
});

test("the exact Model step cannot skip an earlier ordinary system receipt", async t => {
  const f = await fixture(t, {precedingSystem: true});
  assert.equal(await prepareStructuredHeadlessPlanStepWithModels(f.root, f.query, f.authorize, () => f.state.now), undefined);
  assert.equal(f.state.starts, 0);
});

test("a later ordinary step is available only after the exact preceding Model attempt was accepted", async t => {
  const f = await fixture(t, {followingSystem: true});
  const later = {...f.query, step: 2};
  assert.equal(await prepareStructuredHeadlessPlanStepWithModels(f.root, later, f.authorize, () => f.state.now), undefined);
  assert.ok((await f.run(await f.prepare())).result.ok);
  const prepared = await prepareStructuredHeadlessPlanStepWithModels(f.root, later, f.authorize, () => f.state.now);
  assert.ok(prepared && prepared.kind !== "model-download" && "operations" in prepared);
  assert.equal(prepared.request.operation, "systems.create");
  assert.equal(f.state.starts, 1);
});

test("a caller retiring immediately before reservation commit leaves no Model attempt or count", async t => {
  const root = createInMemoryStructuredDocumentStore();
  let retire = () => {}, armed = false;
  const wrapped: typeof root = {...root, runInOwnedTransaction: (visit, fence) => root.runInOwnedTransaction!(async owner => {
    const value = await visit(owner);
    if (armed && (await owner.forOrganization(createOrganizationId("organization.model-execution"))
      .listNamespaces()).includes("headless/models/download-plan-tasks")) retire();
    return value;
  }, fence)};
  const f = await fixture(t, {root: wrapped}), prepared = await f.prepare();
  retire = () => {f.state.current = false;}; armed = true;
  assert.equal(await prepared.reserve(), undefined);
  assert.equal(await f.attempt(), undefined);
  assert.equal((await root.forOrganization(f.scope.organizationId).listNamespaces()).some(name => name.startsWith("headless/models/")), false);
  assert.equal(f.state.starts, 0);
});

test("withdrawal before publication denies the final callback even after a result was produced", async t => {
  const f = await fixture(t), result = await f.run(await f.prepare());
  assert.ok("publishIfCurrent" in result && result.publishIfCurrent);
  f.state.policy = false;
  assert.equal(await result.publishIfCurrent(() => assert.fail("Cannot publish after policy retirement.")), false);
  assert.equal(f.state.starts, 1);
});

test("reservation and issued ACK have current transaction fences, including late policy and deadline denial", async t => {
  for (const variant of ["policy", "expiry"] as const) {
    const f = await fixture(t), prepared = await f.prepare(), realIssue = prepared.issue;
    const replacement = {...prepared, issue: async (...input: Parameters<typeof realIssue>) => {
      if (variant === "policy") f.state.policy = false; else f.state.now += 15 * 60 * 1000;
      return realIssue(...input);
    }};
    const result = await f.run(replacement); assert.equal(result.result.ok, false); assert.equal(f.state.starts, 0);
    assert.deepEqual(await f.attempt(), {kind: variant === "policy" ? "not-started" : "unconfirmed"});
  }
});

test("caller retirement at the final post-ACK policy return prevents actual application dispatch", async t => {
  const f = await fixture(t), prepared = await f.prepare(); let issued = false;
  const realIssue = prepared.issue, realAllowed = prepared.stillAllowed;
  const guarded = {...prepared, async issue(...args: Parameters<typeof realIssue>) {
    const result = await realIssue(...args); issued = result === "issued"; return result;
  }, async stillAllowed() {
    const result = await realAllowed();
    if (issued) f.state.current = false;
    return result;
  }};
  const result = await f.run(guarded);
  assert.equal(result.result.ok, false); assert.equal(issued, true); assert.equal(f.state.starts, 0);
  assert.deepEqual(await f.attempt(), {kind: "not-started"});
});

test("accepted business ownership and outcome recording outlive the withdrawn caller but publication does not", async t => {
  const f = await fixture(t), prepared = await f.prepare(); f.state.loseCallerOnStart = true;
  const result = await f.run(prepared); assert.deepEqual(result.result, {ok: false, code: "headless.forbidden"});
  const attempt = await f.attempt(); assert.ok(attempt?.kind === "accepted");
  assert.equal(f.reconciler.status.pending, 1); assert.equal(f.controls[0].isCurrent(), true);
  f.state.now += 15 * 60 * 1000;
  assert.equal(await f.controls[0].stillAllowed(), true, "Accepted custody is independent of caller/deadline.");
  assert.equal(await prepared.publishIfCurrent(() => assert.fail("No publication after withdrawal.")), false);
  f.state.business = false; assert.equal(await f.controls[0].stillAllowed(), false);
  f.records.get(attempt.reference.taskId)!.status = "succeeded"; await f.reconciler.reconcileNow(); assert.equal(f.reconciler.status.pending, 0);
  assert.equal(f.state.starts, 1);
});

test("known owning-call non-start is terminal, while unknown source or issue ACK never becomes a retry", async t => {
  for (const variant of ["unavailable", "unknown-start", "unknown-ack"] as const) {
    const f = await fixture(t), prepared = await f.prepare();
    if (variant === "unavailable") f.state.unavailable = true;
    if (variant === "unknown-start") f.state.uncertain = true;
    const original = prepared.issue;
    const selected = variant === "unknown-ack" ? {...prepared, issue: async (...args: Parameters<typeof original>) => {
      assert.equal(await original(...args), "issued"); return "unconfirmed" as const;
    }} : prepared;
    const result = await f.run(selected);
    assert.deepEqual(result.result, {ok: false, code: variant === "unavailable" ? "headless.not-started" : "headless.operation-unconfirmed"});
    assert.deepEqual(await f.attempt(), {kind: variant === "unavailable" ? "not-started" : "unconfirmed"});
    f.state.unavailable = false; f.state.uncertain = false;
    const replay = await f.run(await f.prepare()); assert.equal(replay.result.ok, false);
    assert.equal(f.state.starts, variant === "unknown-ack" ? 0 : 1); assert.equal(f.state.resolutions, 1);
    assert.equal(f.reconciler.status.pending, variant === "unavailable" ? 0 : 1);
  }
});

test("lost acceptance acknowledgement reconciles durable replay without another start", async t => {
  const f = await fixture(t), prepared = await f.prepare(), accept = prepared.accept;
  const result = await f.run({...prepared, async accept(taskId) {assert.equal(await accept(taskId), true); return false;}});
  assert.deepEqual(result.result, {ok: false, code: "headless.operation-unconfirmed"});
  assert.equal((await f.attempt())?.kind, "accepted");
  const replay = await f.run(await f.prepare()); assert.ok(replay.result.ok); assert.equal(replay.result.value.kind, "replayed");
  assert.equal(f.state.starts, 1);
});

test("foreign actor/selection/transient data and retired host cannot enter the original source owner", async t => {
  const f = await fixture(t), prepared = await f.prepare();
  const base = {prepared, request: f.request, context: f.scope, canUse: async () => true, isHostCurrent: () => true,
    stillBusinessAllowed: async () => true, resolveStart: async () => {assert.fail("No source resolution.");}};
  for (const context of [{...f.scope, principalId: "foreign"}, {...f.scope, organizationId: createOrganizationId("foreign.org")},
    {...f.scope, workspaceId: createWorkspaceId("foreign.workspace")}]) assert.equal((await runPreparedHeadlessModelDownload({...base, context})).result.ok, false);
  for (const request of [{...f.request, input: {...f.request.input, step: 2}}, {...f.request, transient: {contextQuery: "private"}}])
    assert.equal((await runPreparedHeadlessModelDownload({...base, request})).result.ok, false);
  assert.equal((await runPreparedHeadlessModelDownload({...base, isHostCurrent: () => false})).result.ok, false);
  assert.equal(await f.attempt(), undefined); assert.equal(f.state.starts, 0);
});

test("accepted Model source result survives actual SQLite reopen and replays without resolving runtime", async t => {
  const directory = await realpath(await mkdtemp(join(await realpath(tmpdir()), "headless-model-execution-")));
  const policy = resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory});
  let db: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  try {
    db = await openLocalSqliteDatabase({policy}); const f = await fixture(t, {root: db.documents});
    const first = await f.run(await f.prepare()); assert.ok(first.result.ok);
    await db.close(); db = undefined; db = await openLocalSqliteDatabase({policy});
    const prepared = await prepareStructuredHeadlessPlanStepWithModels(db.documents, f.query, f.authorize, () => f.state.now);
    assert.ok(prepared?.kind === "model-download");
    const replay = await f.run(prepared); assert.ok(replay.result.ok); assert.equal(replay.result.value.kind, "replayed");
    assert.equal(f.state.resolutions, 1); assert.equal(f.state.starts, 1);
  } finally {await db?.close(); await rm(directory, {recursive: true, force: true});}
});
