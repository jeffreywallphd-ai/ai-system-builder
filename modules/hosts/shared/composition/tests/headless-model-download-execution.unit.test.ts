import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test, {type TestContext} from "node:test";
import {composeDesktopHeadlessReads} from "../../../desktop/composition/composeDesktopHeadlessReads";
import {composeManagedAgentReads} from "../../../server/composition/composeManagedAgentReads";
import {HEADLESS_READ_OPERATIONS, readHeadlessModelTaskRequest, readHeadlessModelTaskValue,
  readHeadlessModelTaskCancellationRequest, readHeadlessModelTaskCancellationValue,
  type HeadlessModelTaskRequest, type HeadlessReadRequest} from "../../../../contracts/headless";
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
import {runOwnedHeadlessModelDownloadTask, runOwnedHeadlessModelDownloadCancellation} from "../headlessModelDownloadTasks";

type Options = {root?: ReturnType<typeof createInMemoryStructuredDocumentStore>; channel?: "app-popup" | "authenticated-chat";
  mode?: "whole-plan" | "each-change"; precedingSystem?: boolean; followingSystem?: boolean};
async function fixture(t: TestContext, options: Options = {}) {
  const root = options.root ?? createInMemoryStructuredDocumentStore(), host = randomUUID() as HeadlessHostIncarnationId;
  const scope = {organizationId: createOrganizationId("organization.model-execution"), workspaceId: createWorkspaceId("workspace.model-execution"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const state = {current: true, policy: true, business: true, host: true, now: 1000, starts: 0, resolutions: 0, ordinary: 0, registrations: 0,
    unavailable: false, uncertain: false, loseCallerOnStart: false, loseReply: false,
    statusReads: 0, cancels: 0, onStatusRead: undefined as (() => Promise<void>) | undefined};
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
        read: async () => {state.statusReads++; await state.onStatusRead?.(); return {...record};},
        cancel: async () => {state.cancels++; return {requestId: input.requestId, status: record.status, cancelled: true};},
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
    const task = await runOwnedHeadlessModelDownloadTask({documents: db.documents, hostIncarnationId: f.target.hostIncarnationId,
      scope: f.scope, selection: {kind: "plan-step", fingerprint: f.target.fingerprint, step: 1}, action: "read",
      isCurrent: () => true, authorize: async () => true, peekOwner: () => f.useCase});
    assert.ok(task.ok, "Reopened metadata may control only the still-retained original task handle.");
    assert.deepEqual(await runOwnedHeadlessModelDownloadTask({documents: db.documents, hostIncarnationId: f.target.hostIncarnationId,
      scope: f.scope, selection: {kind: "plan-step", fingerprint: f.target.fingerprint, step: 1}, action: "read",
      isCurrent: () => true, authorize: async () => true, peekOwner: () => undefined}), {ok: false, code: "headless.unavailable"});
    assert.equal(f.state.starts, 1);
  } finally {await db?.close(); await rm(directory, {recursive: true, force: true});}
});

async function taskControls(t: TestContext) {
  const f = await fixture(t);
  assert.ok((await f.run(await f.prepare())).result.ok);
  const attempt = await f.attempt(); assert.ok(attempt?.kind === "accepted");
  const taskId = attempt.reference.taskId;
  let readsCurrent = true, ownerLookups = 0;
  const base = {documents: f.root, hostIncarnationId: f.target.hostIncarnationId, scope: {...f.scope},
    selection: {kind: "task" as const, taskId}, action: "read" as "read" | "cancel",
    isCurrent: () => readsCurrent, authorize: async (_owner: unknown, scope: HeadlessOperationScope) =>
      f.state.policy && scope.organizationId === f.scope.organizationId && scope.principalId === f.scope.principalId &&
      scope.workspaceId === f.scope.workspaceId && scope.registeredClientId === f.scope.registeredClientId,
    peekOwner: () => {ownerLookups++; return f.useCase;}};
  return {...f, taskId, base, setCurrent: (value: boolean) => {readsCurrent = value;}, ownerLookups: () => ownerLookups};
}

test("original task and plan-step controls report finite progress and cancellation acknowledgement without claiming shutdown", async t => {
  const f = await taskControls(t), record = f.records.get(f.taskId)!;
  record.progress = {percent: 25, message: "private provider/path", details: {private: "not for publication"}};
  const read = await runOwnedHeadlessModelDownloadTask(f.base);
  assert.deepEqual(read, {ok: true, value: {workspaceId: f.scope.workspaceId, taskId: f.taskId,
    plan: {fingerprint: f.target.fingerprint, step: 1}, state: "running", percent: 25,
    registration: "requires-separate-approval", runtimeReadiness: "not-checked"}});
  let cancelPolicies = 0;
  const cancelled = await runOwnedHeadlessModelDownloadTask({...f.base, action: "cancel",
    selection: {kind: "plan-step", fingerprint: f.target.fingerprint, step: 1},
    authorize: async (_owner, scope, action) => {assert.equal(action, "cancel"); cancelPolicies++; return scope.principalId === f.scope.principalId;}});
  assert.deepEqual(cancelled, {ok: true, value: {workspaceId: f.scope.workspaceId, taskId: f.taskId,
    plan: {fingerprint: f.target.fingerprint, step: 1}, state: "running", percent: 25, cancellationAccepted: true,
    registration: "requires-separate-approval", runtimeReadiness: "not-checked"}});
  assert.equal(cancelPolicies, 2); assert.equal(f.state.cancels, 1); assert.equal(f.state.starts, 1);
  assert.equal(f.reconciler.status.pending, 1, "A cancellation reply is not receiver/worker settlement.");
  assert.equal(f.state.registrations, 0); assert.equal(f.state.ordinary, 0);
  record.status = "cancelled";
  assert.equal((await runOwnedHeadlessModelDownloadTask(f.base)).ok, true);
  await f.reconciler.reconcileNow(); assert.equal(f.reconciler.status.pending, 0);
});

test("task controls survive expired original approval and closed starting request under fresh reader authority", async t => {
  const f = await taskControls(t);
  f.state.current = false; f.state.now += 15 * 60 * 1000;
  const result = await runOwnedHeadlessModelDownloadTask(f.base); assert.ok(result.ok);
  assert.equal(await f.controls[0].stillAllowed(), true); assert.equal(f.controls[0].isCurrent(), true);
  assert.equal(f.state.starts, 1); assert.equal(f.state.resolutions, 1);
});

test("foreign organization actor client workspace host task and plan selections never touch the Model owner", async t => {
  const f = await taskControls(t), before = f.state.statusReads;
  const acceptPolicy = async () => true;
  const variants = [
    {...f.base, scope: {...f.scope, organizationId: createOrganizationId("org.foreign")}},
    {...f.base, scope: {...f.scope, principalId: "principal.foreign"}},
    {...f.base, scope: {...f.scope, registeredClientId: randomUUID()}},
    {...f.base, scope: {...f.scope, workspaceId: createWorkspaceId("workspace.foreign")}},
    {...f.base, hostIncarnationId: randomUUID()},
    {...f.base, selection: {kind: "task" as const, taskId: randomUUID()}},
    {...f.base, selection: {kind: "plan-step" as const, fingerprint: "f".repeat(64), step: 1}},
    {...f.base, selection: {kind: "plan-step" as const, fingerprint: f.target.fingerprint, step: 2}},
  ];
  for (const variant of variants) assert.deepEqual(await runOwnedHeadlessModelDownloadTask({...variant, authorize: acceptPolicy}),
    {ok: false, code: "headless.forbidden"});
  assert.equal(f.ownerLookups(), 0); assert.equal(f.state.statusReads, before); assert.equal(f.state.cancels, 0);
});

test("current policy is checked before effects and after original observation; withdrawn replies disclose nothing", async t => {
  for (const action of ["read", "cancel"] as const) for (const stage of ["before", "during", "policy"] as const) {
    const f = await taskControls(t), before = f.state.statusReads;
    if (stage === "before") f.setCurrent(false);
    else f.state.onStatusRead = async () => {if (stage === "during") f.setCurrent(false); else f.state.policy = false;};
    const result = await runOwnedHeadlessModelDownloadTask({...f.base, action});
    assert.deepEqual(result, {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.statusReads, before + (stage === "before" ? 0 : 1));
    assert.equal(f.state.cancels, action === "cancel" && stage !== "before" ? 1 : 0);
    assert.equal((await f.attempt())?.kind, "accepted"); assert.equal(f.state.starts, 1);
  }
});

test("caller selections are copied before policy awaits and policy callbacks get frozen original scope", async t => {
  const f = await taskControls(t), scope = {...f.scope}, selection = {...f.base.selection};
  let first = true;
  const result = await runOwnedHeadlessModelDownloadTask({...f.base, scope, selection, authorize: async (_owner, captured) => {
    assert.ok(Object.isFrozen(captured)); assert.equal(captured.principalId, f.scope.principalId);
    if (first) {first = false; scope.principalId = "principal.foreign"; selection.taskId = randomUUID();}
    return true;
  }});
  assert.ok(result.ok); assert.equal(result.value.taskId, f.taskId); assert.equal(f.state.starts, 1);
});

test("missing retained owner and failed observation are unavailable without ordinary fallback or private error text", async t => {
  const f = await taskControls(t), before = f.state.statusReads;
  assert.deepEqual(await runOwnedHeadlessModelDownloadTask({...f.base, peekOwner: () => undefined}), {ok: false, code: "headless.unavailable"});
  assert.equal(f.state.statusReads, before);
  f.state.onStatusRead = async () => {throw new Error("private-token C:/private/model failed");};
  assert.deepEqual(await runOwnedHeadlessModelDownloadTask(f.base), {ok: false, code: "headless.unavailable"});
  assert.equal(f.state.starts, 1); assert.equal(f.state.ordinary, 0); assert.equal(f.state.registrations, 0);
});

test("original observation runs outside metadata transactions and failed-task messages remain private", async t => {
  const f = await taskControls(t), record = f.records.get(f.taskId)!;
  f.state.onStatusRead = async () => {await f.root.runInOwnedTransaction!(async owner => {
    assert.equal(owner.organizationId, undefined);
  }, () => {});};
  record.status = "failed"; record.error = {code: "private-provider-error", message: "C:/private/model secret not for output"};
  assert.deepEqual(await runOwnedHeadlessModelDownloadTask(f.base), {ok: true, value: {workspaceId: f.scope.workspaceId, taskId: f.taskId,
    plan: {fingerprint: f.target.fingerprint, step: 1}, state: "failed", percent: null,
    registration: "requires-separate-approval", runtimeReadiness: "not-checked"}});
});

test("malformed or active owner replies cannot expose data or claim a cancellation", async t => {
  const f = await taskControls(t); let getters = 0;
  const replies: unknown[] = [{activity: {requestId: randomUUID(), workspaceId: f.scope.workspaceId, status: "running"}},
    {activity: {requestId: f.taskId, workspaceId: f.scope.workspaceId, status: "running", progress: {percent: 101}}},
    {get activity() {getters++; return {}; }}, new Proxy({}, {ownKeys() {getters++; return [];}})];
  for (const reply of replies) assert.deepEqual(await runOwnedHeadlessModelDownloadTask({...f.base,
    peekOwner: () => ({readApprovedSource: async () => reply as never, cancelApprovedSource: async () => reply as never})}),
    {ok: false, code: "headless.unavailable"});
  assert.equal(getters, 0);
  const result = await runOwnedHeadlessModelDownloadTask({...f.base, action: "cancel", peekOwner: () => ({
    readApprovedSource: f.useCase.readApprovedSource.bind(f.useCase), cancelApprovedSource: async () => ({activity: {
      requestId: f.taskId, workspaceId: f.scope.workspaceId, status: "running"}, cancelled: "true"}) as never})});
  assert.deepEqual(result, {ok: false, code: "headless.unavailable"}); assert.equal(f.state.cancels, 0);
});

test("unknown and known non-start attempts never become observable task IDs or a new Model start", async t => {
  for (const unknown of [false, true]) {
    const f = await fixture(t); f.state.unavailable = !unknown; f.state.uncertain = unknown;
    assert.equal((await f.run(await f.prepare())).result.ok, false);
    const before = f.state.starts;
    assert.deepEqual(await runOwnedHeadlessModelDownloadTask({documents: f.root, hostIncarnationId: f.target.hostIncarnationId,
      scope: f.scope, selection: {kind: "plan-step", fingerprint: f.target.fingerprint, step: 1}, action: "cancel",
      isCurrent: () => true, authorize: async () => true, peekOwner: () => {assert.fail("An unaccepted attempt has no observable task.");}}),
      {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.starts, before); assert.equal(f.state.statusReads, 0); assert.equal(f.state.cancels, 0);
  }
});

test("source-only owner controls require the original manifest and explicit write authority", async t => {
  const f = await taskControls(t), request = {requestId: f.taskId, workspaceId: f.scope.workspaceId}, before = f.state.statusReads;
  const authority = {organizationId: f.scope.organizationId, principalId: f.scope.principalId};
  await assert.rejects(f.useCase.readApprovedSource(request, "sha256:" + "f".repeat(64), authority));
  await assert.rejects(f.useCase.cancelApprovedSource(request, f.digest, authority));
  await assert.rejects(f.useCase.readApprovedSource(request, f.digest, {...authority, principalId: "principal.foreign"}));
  assert.equal(f.state.statusReads, before); assert.equal(f.state.cancels, 0);
  assert.equal((await f.useCase.readApprovedSource(request, f.digest, authority)).activity.requestId, f.taskId);
});

test("ordinary downloads retain normal behavior but cannot satisfy source-only controls", async () => {
  const taskId = randomUUID(), workspaceId = createWorkspaceId("workspace.ordinary"), authority = {organizationId: "org.ordinary", principalId: "principal.ordinary"};
  let reads = 0, cancels = 0;
  const useCase = new ModelDownloadTasksUseCase({runtimeTaskRegistry: {async startTask() {return {requestId: taskId, status: "queued"};},
    async getTaskStatus() {reads++; return {requestId: taskId, workspaceId, taskType: TaskType.MODEL_DOWNLOAD, concurrencyClass: "io", status: "running", updatedAt: "2026-11-21T00:00:00Z"};},
    async listTasks() {assert.fail("No enumeration.");}, async cancelTask() {cancels++; assert.fail("No generic cancellation.");}},
    modelRegistry: {} as never, modelDownloadCompletion: {} as never});
  await useCase.start({workspaceId, provider: "huggingface", modelId: "fixture/model"}, authority);
  const request = {requestId: taskId, workspaceId};
  await assert.rejects(useCase.readApprovedSource(request, "sha256:" + "a".repeat(64), authority));
  await assert.rejects(useCase.cancelApprovedSource(request, "sha256:" + "a".repeat(64), {...authority, modelWriteAuthorized: true}));
  assert.equal(reads, 0); assert.equal(cancels, 0);
  assert.equal((await useCase.read(request, authority)).activity.status, "running"); assert.equal(reads, 1);
});

test("active or malformed control selections fail before policy or owner callbacks", async t => {
  const f = await taskControls(t); let getterCalls = 0;
  const accessor = {kind: "task", get taskId() {getterCalls++; return f.taskId;}};
  const variants: unknown[] = [accessor, new Proxy(f.base.selection, {getPrototypeOf() {getterCalls++; return Object.prototype;}}),
    {...f.base.selection, extra: "private"}, {kind: "plan-step", fingerprint: f.target.fingerprint, step: 0}];
  for (const selection of variants) assert.deepEqual(await runOwnedHeadlessModelDownloadTask({...f.base, selection: selection as never,
    authorize: async () => {assert.fail("No active selection policy.");}, peekOwner: () => {assert.fail("No active selection owner.");}}),
    {ok: false, code: "headless.forbidden"});
  assert.equal(getterCalls, 0);
});

async function hostTaskReads(t: TestContext, hostKind: "desktop" | "managed", configured = true) {
  const f = await taskControls(t);
  const state = {live: true, allowed: true, planning: true, current: true, readCurrent: true, owner: true, callbacks: 0,
    clientId: f.scope.registeredClientId, onRead: () => {}, fence: (() => true) as () => boolean,
    readFence: (() => true) as () => boolean, onPolicy: undefined as (() => Promise<void>) | undefined,
    replyPlan: undefined as {fingerprint: string; step: number} | undefined, replyWorkspace: undefined as string | undefined};
  state.fence = () => state.current;
  state.readFence = () => state.readCurrent;
  const identity = {organizationId: f.scope.organizationId, principalId: f.scope.principalId};
  const workspace = {workspaceId: f.scope.workspaceId, organizationId: f.scope.organizationId, displayName: "Synthetic",
    status: "active" as const, createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z"};
  const workspaces = {async readWorkspace(id: unknown) {return id === workspace.workspaceId ? workspace : undefined;}};
  const authorization = {async authorizeWorkspaceOperation({requiredScopes}: {requiredScopes: readonly string[]}) {
    assert.deepEqual(requiredScopes, ["workspace:read", "model:read"]);
    await state.onPolicy?.();
    if (!state.allowed) throw new Error("Synthetic policy refusal.");
  }};
  const readModelTask = configured ? async (query: {scope: HeadlessOperationScope;
    selection: HeadlessModelTaskRequest["input"]["selection"]; isCurrent: () => boolean}) => {
    state.callbacks++; state.onRead();
    const result = await runOwnedHeadlessModelDownloadTask({...f.base, ...query, action: "read",
      peekOwner: () => state.owner ? f.useCase : undefined});
    return result.ok ? {...result, value: {...result.value, ...(state.replyPlan ? {plan: state.replyPlan} : {}),
      ...(state.replyWorkspace ? {workspaceId: state.replyWorkspace as never} : {})}} : result;
  } : undefined;
  const noFeatures = () => {assert.fail("Task reads cannot initialize system, Model or runtime features.");};
  const query: HeadlessModelTaskRequest = {version: "aisb-headless-v1", operation: "models.task", input: {
    hostIncarnationId: f.target.hostIncarnationId, workspaceId: f.scope.workspaceId, selection: {kind: "task", taskId: f.taskId}}};
  const read = hostKind === "desktop" ? (() => {
    const handler = composeDesktopHeadlessReads({hostIncarnationId: f.target.hostIncarnationId, identity,
      workspaceRepository: workspaces, authorization, getUseCases: noFeatures, isOpen: () => state.live, readModelTask});
    return (request: HeadlessReadRequest = query) => handler(request, async () => ({...identity, registeredClientId: state.clientId,
      workspaceIds: [f.scope.workspaceId], operations: HEADLESS_READ_OPERATIONS, isCurrent: state.fence, isReadCurrent: state.readFence,
      ...(state.planning ? {planReview: true as const} : {})}));
  })() : (() => {
    const handler = composeManagedAgentReads({hostIncarnationId: f.target.hostIncarnationId, workspaces,
      contexts: {getCurrentOrganizationContext: () => state.live ? identity as never : undefined}, authorization,
      systems: {} as never, readModelTask});
    return (request: HeadlessReadRequest = query) => handler(request, {...identity, registeredClientId: state.clientId,
      purpose: state.planning ? "plan-review" : "agent"}, state.fence);
  })();
  return {...f, state, modelState: f.state, query, read};
}

for (const hostKind of ["desktop", "managed"] as const) {
  test(`${hostKind}: read original accepted task by ID or plan without another start, cancel or registration`, async t => {
    const f = await hostTaskReads(t, hostKind);
    f.state.current = true; f.state.live = true;
    f.records.get(f.taskId)!.progress = {percent: 37.5, message: "private/provider/path", details: {secret: "private"}};
    const expected = {ok: true, operation: "models.task", value: {workspaceId: f.scope.workspaceId, taskId: f.taskId,
      plan: {fingerprint: f.target.fingerprint, step: 1}, state: "running", percent: 37.5,
      registration: "requires-separate-approval", runtimeReadiness: "not-checked"}};
    assert.deepEqual(await f.read(), expected);
    assert.deepEqual(await f.read({...f.query, input: {...f.query.input,
      selection: {kind: "plan-step", fingerprint: f.target.fingerprint, step: 1}}}), expected);
    assert.equal(f.modelState.starts, 1); assert.equal(f.modelState.cancels, 0);
    assert.equal(f.modelState.registrations, 0); assert.equal(f.modelState.ordinary, 0);
    assert.equal(f.records.size, 1); assert.equal(f.reconciler.status.pending, 1);
  });

  test(`${hostKind}: current permission, purpose, client and task ownership fence reads`, async t => {
    for (const deny of ["policy", "purpose", "client", "task", "owner", "request"] as const) {
      const f = await hostTaskReads(t, hostKind);
      if (deny === "policy") f.state.allowed = false;
      if (deny === "purpose") f.state.planning = false;
      if (deny === "client") f.state.clientId = randomUUID();
      if (deny === "owner") f.state.owner = false;
      if (deny === "request") f.state.current = false;
      const result = await f.read(deny === "task" ? {...f.query, input: {...f.query.input,
        selection: {kind: "task", taskId: randomUUID()}}} : f.query);
      assert.deepEqual(result, {ok: false, code: deny === "owner" ? "headless.unavailable" : "headless.forbidden"});
      assert.equal(f.records.size, 1);
    }
  });

  test(`${hostKind}: retired callback cannot be replaced to publish an awaited task reply`, async t => {
    const f = await hostTaskReads(t, hostKind);
    f.state.onRead = () => {f.state.current = false; f.state.fence = () => true;};
    assert.deepEqual(await f.read(), {ok: false, code: "headless.forbidden"});
  });

  test(`${hostKind}: policy or captured lifetime withdrawal during source observation suppresses the reply`, async t => {
    for (const withdraw of ["policy", "lifetime"] as const) {
      const f = await hostTaskReads(t, hostKind);
      let release!: () => void, entered!: () => void;
      const pending = new Promise<void>(resolve => {release = resolve;});
      const started = new Promise<void>(resolve => {entered = resolve;});
      f.modelState.onStatusRead = async () => {entered(); await pending;};
      const reading = f.read();
      await started;
      if (withdraw === "policy") f.state.allowed = false;
      else {f.state.current = false; f.state.fence = () => true;}
      release();
      assert.deepEqual(await reading, {ok: false, code: "headless.forbidden"});
      assert.equal(f.modelState.starts, 1); assert.equal(f.modelState.cancels, 0); assert.equal(f.modelState.registrations, 0);
    }
  });

  test(`${hostKind}: absent retained-owner binding does not advertise or execute task reads`, async t => {
    const f = await hostTaskReads(t, hostKind, false);
    assert.deepEqual(await f.read(), {ok: false, code: "headless.unsupported-operation"});
    const described = await f.read({version: "aisb-headless-v1", operation: "host.describe", input: {}});
    assert.ok(described.ok && described.operation === "host.describe");
    assert.ok(!described.value.operations.includes("models.task")); assert.equal(f.state.callbacks, 0);
  });

  test(`${hostKind}: wrong owner-supplied plan or workspace is rejected rather than replaced by request fields`, async t => {
    for (const displaced of ["fingerprint", "step", "workspace"] as const) {
      const f = await hostTaskReads(t, hostKind);
      if (displaced === "workspace") f.state.replyWorkspace = "workspace.foreign";
      else f.state.replyPlan = {fingerprint: displaced === "fingerprint" ? "b".repeat(64) : f.target.fingerprint,
        step: displaced === "step" ? 2 : 1};
      assert.deepEqual(await f.read({...f.query, input: {...f.query.input,
        selection: {kind: "plan-step", fingerprint: f.target.fingerprint, step: 1}}}), {ok: false, code: "headless.unavailable"});
      assert.equal(f.modelState.starts, 1); assert.equal(f.modelState.registrations, 0);
    }
  });
}

test("Model task codec copies exact passive selectors and rejects malformed, private and foreign replies", () => {
  const host = "00000000-0000-4000-8000-000000000001" as HeadlessHostIncarnationId, taskId = "00000000-0000-4000-8000-000000000002";
  const input = {hostIncarnationId: host, workspaceId: createWorkspaceId("workspace.synthetic"), selection: {kind: "task", taskId}};
  const raw = {version: "aisb-headless-v1", operation: "models.task", input};
  const copied = readHeadlessModelTaskRequest(raw, host); assert.ok(copied.ok);
  input.selection.taskId = randomUUID(); assert.equal(copied.request.input.selection.kind === "task" && copied.request.input.selection.taskId, taskId);
  const value = {workspaceId: input.workspaceId, taskId, state: "unknown", percent: null,
    plan: {fingerprint: "a".repeat(64), step: 1},
    registration: "requires-separate-approval", runtimeReadiness: "not-checked"};
  assert.deepEqual(readHeadlessModelTaskValue(value, copied.request.input), value);
  for (const bad of [{...value, taskId: randomUUID()}, {...value, workspaceId: "foreign"}, {...value, error: "private"},
    {...value, percent: -1}, {...value, percent: Infinity}, {...value, runtimeReadiness: "ready"}, {...value, registration: "saved"}])
    assert.equal(readHeadlessModelTaskValue(bad, copied.request.input), undefined);
  const planned = {...copied.request.input, selection: {kind: "plan-step" as const, fingerprint: "a".repeat(64), step: 1}};
  assert.deepEqual(readHeadlessModelTaskValue(value, planned), value);
  for (const plan of [{fingerprint: "b".repeat(64), step: 1}, {fingerprint: "a".repeat(64), step: 2},
    {fingerprint: "a".repeat(64), step: 1, private: "hidden"}])
    assert.equal(readHeadlessModelTaskValue({...value, plan}, planned), undefined);
  for (const selection of [{kind: "task", taskId, cancel: true}, {kind: "plan-step", fingerprint: "a".repeat(64), step: 0},
    {kind: "plan-step", fingerprint: "a".repeat(64), step: 1, taskId}, {kind: "source", modelId: "fixture/model"}])
    assert.equal(readHeadlessModelTaskRequest({...raw, input: {...raw.input, selection}}, host).ok, false);
});

test("plan-step task replies without owner-supplied lineage cannot be correlated", () => {
  const host = "00000000-0000-4000-8000-000000000001" as HeadlessHostIncarnationId;
  const target = {hostIncarnationId: host, workspaceId: createWorkspaceId("workspace.synthetic"),
    selection: {kind: "plan-step" as const, fingerprint: "a".repeat(64), step: 1}};
  const displaced = {workspaceId: target.workspaceId, taskId: randomUUID(), state: "running", percent: null,
    registration: "requires-separate-approval", runtimeReadiness: "not-checked"};
  assert.equal(readHeadlessModelTaskValue(displaced, target), undefined);
});

test("desktop task read retires during final awaited policy before any retained owner entry", {timeout: 5000}, async t => {
  const f = await hostTaskReads(t, "desktop");
  let release!: () => void, entered!: () => void, policies = 0;
  const held = new Promise<void>(resolve => {release = resolve;});
  const waiting = new Promise<void>(resolve => {entered = resolve;});
  f.state.onPolicy = async () => {if (++policies === 2) {entered(); await held;}};
  const reading = f.read(); await waiting;
  f.state.readCurrent = false; f.state.readFence = () => true;
  release();
  assert.deepEqual(await reading, {ok: false, code: "headless.forbidden"});
  assert.equal(f.state.callbacks, 0); assert.equal(f.modelState.starts, 1);
});

test("desktop task observation requires a strict captured HTTP read-current proof", async t => {
  for (const fence of [undefined, () => false, () => Promise.resolve(true), () => {throw new Error("private");}]) {
    const f = await hostTaskReads(t, "desktop");
    f.state.readFence = fence as never;
    assert.deepEqual(await f.read(), {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.callbacks, 0);
  }
});

test("Model cancellation codecs isolate mutation from reads, copy selectors and keep acknowledgements finite", () => {
  const host = "00000000-0000-4000-8000-000000000001" as HeadlessHostIncarnationId, taskId = randomUUID();
  const request = {version: "aisb-headless-v1", operation: "models.cancel-download", input: {hostIncarnationId: host,
    workspaceId: createWorkspaceId("workspace.synthetic"), selection: {kind: "task", taskId}}};
  const parsed = readHeadlessModelTaskCancellationRequest(request, host); assert.ok(parsed.ok);
  request.input.selection.taskId = randomUUID();
  assert.equal(parsed.request.input.selection.kind === "task" && parsed.request.input.selection.taskId, taskId);
  assert.equal(readHeadlessModelTaskRequest(request, host).ok, false);
  const value = {workspaceId: parsed.request.input.workspaceId, taskId, plan: {fingerprint: "a".repeat(64), step: 1},
    state: "running", percent: null, cancellationAccepted: true, registration: "requires-separate-approval", runtimeReadiness: "not-checked"};
  assert.deepEqual(readHeadlessModelTaskCancellationValue(value, parsed.request.input), value);
  for (const bad of [{...value, cancellationAccepted: "true"}, {...value, cancellationAccepted: undefined},
    {...value, taskId: randomUUID()}, {...value, error: "private/path"}, {...value, registrySaved: true}])
    assert.equal(readHeadlessModelTaskCancellationValue(bad, parsed.request.input), undefined);
  for (const bad of [{...request, operation: "models.task"}, {...request, transient: {command: "private"}},
    {...request, input: {...request.input, selection: {kind: "plan-step", fingerprint: "a".repeat(64), step: 0}}}])
    assert.equal(readHeadlessModelTaskCancellationRequest(bad, host).ok, false);
  let getters = 0;
  assert.equal(readHeadlessModelTaskCancellationRequest({get version() {getters++; return "aisb-headless-v1";}}, host).ok, false);
  assert.equal(getters, 0);
});

test("private cancellation refuses active scope and final policy before any source effect", async t => {
  const f = await taskControls(t), request = {version: "aisb-headless-v1", operation: "models.cancel-download",
    input: {hostIncarnationId: f.target.hostIncarnationId, workspaceId: f.scope.workspaceId, selection: f.base.selection}};
  let getters = 0;
  const active = {...f.scope, get workspaceId() {getters++; return f.scope.workspaceId;}};
  assert.deepEqual(await runOwnedHeadlessModelDownloadCancellation({...f.base, scope: active, request, canUse: async () => true}),
    {ok: false, code: "headless.forbidden"});
  assert.equal(getters, 0); assert.equal(f.state.cancels, 0);
  assert.equal((await runOwnedHeadlessModelDownloadCancellation({...f.base, request, canUse: async () => false})).ok, false);
  assert.equal(f.state.cancels, 0); assert.equal(f.state.starts, 1); assert.equal(f.state.registrations, 0);
});
