/** Evaluation/review software only: metrics are controlled, never model scores. */
import assert from "node:assert/strict";
import test, {type TestContext} from "node:test";
import {randomUUID} from "node:crypto";
import type {ApprovedLocalTrainingTask} from "../../../../application/ports/model";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {fixture} from "./headless-model-training-fixture";
import {createOriginalHeadlessTrainingTaskOwner, type OriginalTrainingRunOptions, type OriginalTrainingTaskQuery} from "../headlessModelTrainingTasks";
import {HEADLESS_CONTRACT_VERSION, readHeadlessTrainingCompletionResult, type HeadlessTrainingCompletionRequest} from "../../../../contracts/headless";

const reportFor = (trainedLoss: number, sampleCount = 2) => ({protocol: "fixed-first-32-validation-loss-v1", maximumRows: 32,
  sampleCount, baselineLoss: 1.25, trainedLoss, lossDelta: trainedLoss - 1.25, interpretation: "measurement-only"});
type F = Awaited<ReturnType<typeof fixture>>;
type Book = ReturnType<typeof createOriginalHeadlessTrainingTaskOwner>;
type Completion = Awaited<ReturnType<NonNullable<ApprovedLocalTrainingTask["reviewCompletion"]>>>;
function reviewQuery(f: F, taskId: string) {
  const request: HeadlessTrainingCompletionRequest = {version: HEADLESS_CONTRACT_VERSION, operation: "models.review-training",
    input: {hostIncarnationId: f.host, workspaceId: f.scope.workspaceId, selection: {kind: "task", taskId}}};
  const query: OriginalTrainingTaskQuery = {documents: f.root, hostIncarnationId: f.host, scope: f.scope,
    isCurrent: () => f.state.host, authorize: async () => f.state.allowed && f.state.modelRead, request};
  return {query, request};
}
async function setup(t: TestContext, engine: "Core" | "SQLite", trainedLoss?: number, sampleCount = 2,
  revokeAfterReview = false, captureReview?: (value: Completion) => void) {
  const f = await fixture(t, engine), book = createOriginalHeadlessTrainingTaskOwner();
  const {retainTask: _bookOwnsRetention, ...options} = await f.makeOptions();
  let start = options.resolveStart;
  if (revokeAfterReview || captureReview) {
    const original = await start(); assert.ok(original);
    start = async () => async (...args) => {
      const accepted = await original(...args); if (accepted.kind !== "accepted") return accepted;
      const review = accepted.task.reviewCompletion; assert.ok(review);
      return {...accepted, task: {...accepted.task, async reviewCompletion(control) {
        const value = await Reflect.apply(review, accepted.task, [control]); captureReview?.(value);
        if (revokeAfterReview) f.state.allowed = false; return value;
      }}};
    };
  }
  const result = await book.runPrepared({...options, resolveStart: start} satisfies OriginalTrainingRunOptions);
  assert.ok(result.result.ok);
  const effect = result.result.value;
  assert.ok("operation" in effect && effect.operation === "models.train" && "taskId" in effect.reference);
  assert.ok(typeof effect.reference.taskId === "string"); const taskId = effect.reference.taskId;
  const selected = reviewQuery(f, taskId), report = trainedLoss === undefined ? undefined : reportFor(trainedLoss, sampleCount);
  if (report) {
    f.state.completionComparison = report;
    f.state.completionMetrics = {baseline_validation_loss: report.baselineLoss, trained_validation_loss: report.trainedLoss,
      validation_sample_count: report.sampleCount, validation_loss_delta: report.lossDelta};
  }
  return {f, book, taskId, report, ...selected};
}
async function complete(value: Awaited<ReturnType<typeof setup>>) {
  value.f.state.status = "succeeded";
  const status = await value.book.read({...value.query, request: {...value.request, operation: "models.training-task"}});
  assert.ok(status.ok && status.value.state === "succeeded");
}
async function read(value: {book: Book; query: OriginalTrainingTaskQuery; request: HeadlessTrainingCompletionRequest}) {
  return readHeadlessTrainingCompletionResult(await value.book.readCompletion(value.query), value.request.input);
}

for (const engine of ["Core", "SQLite"] as const) {
  for (const [label, trainedLoss, sampleCount] of [["lower", 0.75, 1], ["equal", 1.25, 32], ["higher", 1.5, 2]] as const) {
    test(engine + " original review preserves " + label + " controlled baseline measurement and exact approved lineage", async t => {
      const value = await setup(t, engine, trainedLoss, sampleCount); await complete(value);
      const before = {...value.f.state}, reply = await read(value); assert.ok(reply.ok);
      assert.deepEqual(reply.value.comparison, {state: "recorded", report: value.report});
      const lineage = reply.value.provenance;
      assert.equal(lineage.modelRecordId, value.f.request.input.model.modelRecordId);
      assert.equal(lineage.modelUpdatedAt, value.f.request.input.model.updatedAt);
      assert.equal(lineage.datasetId, value.f.version.datasetId); assert.equal(lineage.versionId, value.f.version.versionId);
      assert.equal(lineage.versionDigest, value.f.version.versionDigest); assert.equal(lineage.proposalDigest, value.f.binding.proposalDigest);
      assert.equal(lineage.recipeDigest, value.f.version.lineage.recipe.digest);
      assert.equal(reply.value.taskId, value.taskId); assert.equal(reply.value.registration, "requires-separate-approval");
      assert.equal(reply.value.verification.outputQuality, "not-evaluated"); assert.equal(reply.value.verification.runtimeReadiness, "not-checked");
      assert.equal(reply.value.verification.hardware, "not-recorded"); assert.equal(reply.value.currentCandidate, undefined);
      assert.doesNotMatch(JSON.stringify(reply), /PRIVATE|empty-model|training-datasets-|training-output-|Synthetic answer/);
      assert.equal(value.f.state.reads, before.reads); assert.equal(value.f.state.starts, 1);
      assert.equal(value.f.state.modelReads, before.modelReads); assert.equal(value.f.state.datasetReads, before.datasetReads);
    });
  }
  test(engine + " no stored comparison or current-file capability remains explicitly unmeasured", async t => {
    const value = await setup(t, engine); await complete(value); const reply = await read(value); assert.ok(reply.ok);
    assert.deepEqual(reply.value.comparison, {state: "not-recorded"});
    const current = {...value.request, input: {...value.request.input, mode: "current-files" as const}};
    const currentResult = readHeadlessTrainingCompletionResult(await value.book.readCompletion({...value.query, request: current}), current.input);
    assert.equal(currentResult.ok, false); assert.equal(value.f.state.starts, 1);
  });
  test(engine + " original cached report is detached from later provider mutations", async t => {
    const value = await setup(t, engine, 0.75); await complete(value);
    value.report!.baselineLoss = 99; value.f.state.completionMetrics!.baseline_validation_loss = 99;
    const reply = await read(value); assert.ok(reply.ok && reply.value.comparison.state === "recorded");
    assert.equal(reply.value.comparison.report.baselineLoss, 1.25); assert.equal(reply.value.comparison.report.lossDelta, -0.5);
  });
  test(engine + " permission withdrawal after original comparison review withholds its response", async t => {
    const value = await setup(t, engine, 0.75, 2, true); await complete(value);
    assert.equal((await read(value)).ok, false); assert.equal(value.f.state.allowed, false); assert.equal(value.f.state.starts, 1);
  });
  test(engine + " original review reply is copied before the next awaited policy can mutate it", async t => {
    let supplied: Completion | undefined;
    const value = await setup(t, engine, 0.75, 2, false, reply => {supplied = reply;}); await complete(value);
    let mutations = 0;
    const query = {...value.query, authorize: async () => {
      if (supplied?.kind === "ready" && supplied.comparison.state === "recorded") {
        Object.assign(supplied.comparison.report, {baselineLoss: 99});
        Object.assign(supplied.provenance, {versionDigest: "sha256:" + "f".repeat(64)}); mutations++;
      }
      return true;
    }};
    const reply = await read({...value, query}); assert.ok(reply.ok && reply.value.comparison.state === "recorded");
    assert.ok(mutations > 0); assert.equal(reply.value.comparison.report.baselineLoss, 1.25);
    assert.equal(reply.value.provenance.versionDigest, value.f.version.versionDigest); assert.equal(value.f.state.starts, 1);
  });
  for (const change of ["delta", "metric", "protocol", "sample-count", "quality-claim"] as const) {
    test(engine + " rejects controlled comparison " + change + " without redispatch or disclosure", async t => {
      const value = await setup(t, engine, 0.75), report = value.report!;
      if (change === "delta") report.lossDelta = 9;
      if (change === "metric") value.f.state.completionMetrics!.trained_validation_loss = 9;
      if (change === "protocol") report.protocol = "unrecognized";
      if (change === "sample-count") report.sampleCount = 33;
      if (change === "quality-claim") Object.assign(report, {qualityPassed: true});
      await complete(value); const reply = await read(value); assert.equal(reply.ok, false);
      assert.doesNotMatch(JSON.stringify(reply), /baselineLoss|PRIVATE|qualityPassed/); assert.equal(value.f.state.starts, 1);
    });
  }
  test(engine + " review input cannot supply metrics, move actors or bypass current ModelRead", async t => {
    const value = await setup(t, engine, 0.75); await complete(value);
    const injected = {...value.request, input: {...value.request.input, comparison: {baselineLoss: 0, trainedLoss: 0}}};
    assert.equal((await value.book.readCompletion({...value.query, request: injected})).ok, false);
    assert.equal((await value.book.readCompletion({...value.query, scope: {...value.query.scope, principalId: "different.actor"}})).ok, false);
    assert.equal((await value.book.readCompletion({...value.query, scope: {...value.query.scope, registeredClientId: randomUUID()}})).ok, false);
    assert.equal((await value.book.readCompletion({...value.query, scope: {...value.query.scope, workspaceId: createWorkspaceId("workspace.other")}})).ok, false);
    assert.equal((await value.book.readCompletion({...value.query, hostIncarnationId: randomUUID()})).ok, false);
    value.f.state.modelRead = false; assert.equal((await read(value)).ok, false);
    assert.equal(value.f.state.starts, 1);
  });
}
