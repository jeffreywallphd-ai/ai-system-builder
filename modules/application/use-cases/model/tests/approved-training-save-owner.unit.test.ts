import assert from "node:assert/strict";
import path from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import type {ApprovedLocalTrainingCandidateReview, ApprovedLocalTrainingSaveSession, GeneratedModelStoragePort,
  ReviewedGeneratedModelRequest, ReviewedGeneratedModelStorageSession, ReviewedGeneratedModelControl} from "../../../ports/model";
import {createApprovedTrainingSaveOwner} from "../create-approved-training-save-owner";

const taskId = "11111111-1111-4111-8111-111111111111", saveId = "22222222-2222-4222-8222-222222222222";
const workspaceId = createWorkspaceId("workspace.save"), candidateDigest = "sha256:" + "a".repeat(64);
const request = () => ({saveId, candidateDigest, name: "Reviewed model"});
const control = (): ReviewedGeneratedModelControl => ({isCurrent: () => true, stillAllowed: async () => true, mayDiscard: async () => true});
function fixture() {
  const originalDirectory = path.join(tmpdir(), "synthetic-original-training-source"), copiedDirectory = path.join(tmpdir(), "synthetic-private-training-copy");
  const state = {original: true, permitted: true, reviews: 0, sources: 0, creates: 0, writes: 0, discarded: 0, ioClosed: true, copyFenced: false,
    copyPhase: "bound" as ReturnType<ReviewedGeneratedModelStorageSession["inspect"]>["phase"],
    onReview: undefined as (() => Promise<void>) | undefined, onWrite: undefined as (() => Promise<void>) | undefined,
    onAllowed: undefined as (() => Promise<void>) | undefined};
  const candidate: Extract<ApprovedLocalTrainingCandidateReview, {kind: "ready"}> = {kind: "ready", requestId: taskId, workspaceId, candidateDigest,
    history: {kind: "ready", requestId: taskId, workspaceId, provenance: {modelRecordId: "model.base", modelUpdatedAt: "2026-11-27T00:00:00.000Z",
      datasetId: "dataset.base", versionId: "version.base", versionDigest: candidateDigest, recipeDigest: candidateDigest, proposalDigest: candidateDigest,
      trainingTask: "llm-instruction", method: "full-finetune", trainingInputCount: 1, validationInputCount: 0, inputBytes: 2, recipeBytes: 2},
      candidate: {requestedName: "Original name", artifactForm: "full-model", serializationFormat: "safetensors", recordedSizeBytes: 6}, comparison: {state: "not-recorded"},
      verification: {inputs: "recorded-not-rechecked", retainedFiles: "not-checked", runtimeReadiness: "not-checked", hardware: "not-recorded", outputQuality: "not-evaluated"},
      registration: "requires-separate-approval"},
    retainedFiles: {schema: "training-result-finalized-files-v1", publicationId: "b".repeat(32), totalBytes: 6,
      verification: "sha256-current-local-v1", manifestDigest: candidateDigest,
      files: ["config.json", "model.safetensors", "tokenizer.json"].map((name, fileIndex) => ({fileIndex, groupIndex: 0, name, role: "candidate",
        mediaType: name.endsWith(".json") ? "application/json" : "application/octet-stream", expectedSizeBytes: 2, expectedSha256: candidateDigest,
        key: `workspaces/${workspaceId}/artifacts/training-results/${"b".repeat(32)}/${fileIndex}`}))}};
  let observed: ReviewedGeneratedModelRequest | undefined, copyControl: ReviewedGeneratedModelControl | undefined;
  const createStorage: NonNullable<GeneratedModelStoragePort["createReviewedSession"]> = (r, ctx, c) => {
    state.creates++; observed = r; copyControl = c;
    assert.equal(ctx.requestId, saveId); assert.equal(ctx.workspaceId, workspaceId); assert.equal(ctx.principalId, "principal.synthetic");
    return {storageProfile: "bounded-local-v1", async write() {state.writes++; state.copyPhase = "writing"; state.ioClosed = false;
      try {await state.onWrite?.(); assert.equal(c.isCurrent(), true); assert.equal(await c.stillAllowed(), true);
        state.copyPhase = "ready"; return {storageProfile: "bounded-local-v1", localPath: copiedDirectory, candidateDigest: r.candidateDigest,
          fileCount: r.files.length, totalBytes: r.files.reduce((n, f) => n + f.expectedSizeBytes, 0)};
      } catch (error) {state.copyPhase = "failed"; throw error;} finally {state.ioClosed = true;}},
      fence() {state.copyFenced = true;}, inspect() {return {phase: state.copyPhase, fenced: state.copyFenced, pendingOperations: 0, openFiles: 0,
        ioClosed: state.ioClosed, declaredPayloadBytes: 6, physicalQuotaEnforced: false};},
      async discard() {state.discarded++; if (await c.mayDiscard() !== true) return false; state.copyPhase = "discarded"; return true;}};
  };
  const options = {taskId, context: {organizationId: createOrganizationId("organization.save"), workspaceId, principalId: "principal.synthetic"},
    isOriginalCurrent: () => state.original, stillOriginalAllowed: async () => {await state.onAllowed?.(); return state.permitted;},
    review: async (): Promise<ApprovedLocalTrainingCandidateReview> => {state.reviews++; await state.onReview?.(); return candidate;},
    sourceDirectory: async () => {state.sources++; return originalDirectory;}, createStorage};
  const bind = createApprovedTrainingSaveOwner(options);
  const session = (c = control()) => {const s = bind(request(), c); assert.ok(s); return s;};
  return {state, candidate, options, bind, session, originalDirectory, copiedDirectory, get observed() {return observed;}, get copyControl() {return copyControl;}};
}
function gate() {let release!: () => void; const wait = new Promise<void>(r => {release = r;}); return {wait, release};}

test("binding is inert, detached and single-use; successful handoff preserves original candidate lineage", async () => {
  const f = fixture(), r = request(), c = control(), s = f.bind(r, c); assert.ok(s);
  assert.equal(f.state.reviews, 0); assert.equal(f.state.creates, 0); assert.equal(f.bind(request(), control()), undefined);
  r.name = "Changed"; r.candidateDigest = "sha256:" + "f".repeat(64); c.isCurrent = () => false; c.stillAllowed = async () => false;
  const result = await s.write();
  assert.equal(result.name, "Reviewed model"); assert.equal(result.taskId, taskId); assert.equal(result.candidate.candidateDigest, candidateDigest);
  assert.equal(f.observed?.sourceDirectory, f.originalDirectory); assert.equal(f.observed?.files.length, 3);
  assert.equal(result.storage.localPath, f.copiedDirectory); assert.equal(result.candidate.history.provenance.datasetId, "dataset.base");
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.candidate.history.provenance));
  assert.equal(s.isCurrent(), true); assert.deepEqual(s.inspect(), {phase: "ready", fenced: false, pendingOperations: 0, ioClosed: true});
  await assert.rejects(s.write()); assert.equal(f.state.writes, 1); assert.equal(await s.discard(), true); assert.equal(s.isCurrent(), false);
});

test("closed Save request and controls reject active or extra fields without invoking them", () => {
  const f = fixture(); let calls = 0;
  const active = Object.defineProperty(request(), "name", {enumerable: true, get() {calls++; throw Error("private");}});
  for (const r of [active, {...request(), sourceDirectory: f.originalDirectory}, {...request(), name: "../model"}, {...request(), saveId: "wrong"}])
    assert.equal(f.bind(r, control()), undefined);
  const activeControl = Object.defineProperty(control(), "stillAllowed", {enumerable: true, get() {calls++; throw Error("private");}});
  assert.equal(f.bind(request(), activeControl), undefined); assert.equal(calls, 0); assert.equal(f.state.creates, 0);
});

for (const failure of ["not-ready", "digest", "task", "workspace", "source"] as const) test(`refuses ${failure} before storage binding`, async () => {
  const f = fixture();
  if (failure === "not-ready") f.options.review = async () => ({kind: "not-ready"});
  if (failure === "digest") Object.assign(f.candidate, {candidateDigest: "sha256:" + "f".repeat(64)});
  if (failure === "task") Object.assign(f.candidate, {requestId: saveId});
  if (failure === "workspace") Object.assign(f.candidate, {workspaceId: "other"});
  if (failure === "source") f.options.sourceDirectory = async () => "relative";
  const bind = createApprovedTrainingSaveOwner(f.options), s = bind(request(), control()); assert.ok(s);
  await assert.rejects(s.write()); assert.equal(f.state.creates, 0); assert.equal(s.inspect().ioClosed, true); assert.equal(await s.discard(), true);
});

for (const authority of ["original", "permission", "save"] as const) test(`refuses lost ${authority} authority before review`, async () => {
  const f = fixture(), c = control(); if (authority === "original") f.state.original = false;
  if (authority === "permission") f.state.permitted = false; if (authority === "save") c.stillAllowed = async () => false;
  const s = f.session(c); await assert.rejects(s.write()); assert.equal(f.state.reviews, 0); assert.equal(f.state.creates, 0);
});

test("an outward fence waits for the original review to return and cannot start copying", async () => {
  const f = fixture(), waiting = gate(), entered = gate(); f.state.onReview = async () => {entered.release(); await waiting.wait;};
  const s = f.session(), attempt = s.write(), rejected = assert.rejects(attempt);
  try {await entered.wait; s.fence(); assert.equal(s.inspect().ioClosed, false); assert.equal(await s.discard(), false);
    waiting.release(); await rejected; assert.equal(f.state.creates, 0); assert.equal(s.inspect().ioClosed, true); assert.equal(await s.discard(), true);
  } finally {waiting.release(); await rejected;}
});

test("the original copy stays owned until it returns after a fence", async () => {
  const f = fixture(), waiting = gate(), entered = gate(); f.state.onWrite = async () => {entered.release(); await waiting.wait;};
  const s = f.session(), attempt = s.write(), rejected = assert.rejects(attempt);
  try {await entered.wait; s.fence(); assert.equal(f.state.copyFenced, true); assert.equal(s.inspect().ioClosed, false);
    assert.equal(await s.discard(), false); waiting.release(); await rejected;
    assert.equal(s.inspect().ioClosed, true); assert.equal(await s.discard(), true); assert.equal(f.state.writes, 1);
  } finally {waiting.release(); await rejected;}
});

test("malformed original asynchronous contracts remain unconfirmed with no IO/cleanup credit", async () => {
  const f = fixture(); f.options.review = (() => ({then() {assert.fail("No thenable assimilation.");}})) as unknown as typeof f.options.review;
  const s = createApprovedTrainingSaveOwner(f.options)(request(), control()); assert.ok(s); await assert.rejects(s.write());
  assert.equal(s.inspect().phase, "unconfirmed"); assert.equal(s.inspect().ioClosed, false); assert.equal(await s.discard(), false);
  assert.equal(f.state.creates, 0); await assert.rejects(s.write());
});

test("copy facts are frozen before the next authority wait and cleanup uses independent no-reference consent", async () => {
  const f = fixture(); let mayDiscard = false; const c = control(); c.mayDiscard = async () => mayDiscard;
  const s = f.session(c), result = await s.write();
  assert.equal(await s.discard(), false); assert.equal(result.candidate.history.registration, "requires-separate-approval");
  f.state.original = false; mayDiscard = true; assert.equal(await s.discard(), true); assert.equal(f.state.writes, 1);
});

test("a queued fence between authorization and review cannot start review", async () => {
  const f = fixture(), c = control(); let s: ApprovedLocalTrainingSaveSession, afterAllowed = false;
  c.stillAllowed = async () => {afterAllowed = true; return true;};
  c.isCurrent = () => {if (afterAllowed) {afterAllowed = false; queueMicrotask(() => s.fence());} return true;};
  s = f.session(c); await assert.rejects(s.write()); assert.equal(f.state.reviews, 0); assert.equal(f.state.creates, 0);
});

test("contradictory writing and closed-IO metadata cannot supply private success or cleanup", async () => {
  const f = fixture(), factory = f.options.createStorage;
  f.options.createStorage = (...args) => {const original = factory(...args); assert.ok(original);
    return {...original, inspect: () => ({phase: "writing", fenced: false, pendingOperations: 0, openFiles: 0,
      ioClosed: true, declaredPayloadBytes: 6, physicalQuotaEnforced: false})};};
  const s = createApprovedTrainingSaveOwner(f.options)(request(), control()); assert.ok(s); await assert.rejects(s.write());
  assert.equal(s.inspect().phase, "unconfirmed"); assert.equal(s.inspect().ioClosed, false); assert.equal(await s.discard(), false);
});

if (process.env.AISB_SAVE_PROMISE_REFUSAL_FIXTURE === "one-owned-child") {
  for (const kind of ["factory", "review-own-then", "review-own-constructor", "policy-own-then", "current-own-then", "cleanup-own-then", "inspect", "fence"] as const)
    test(`isolated ${kind} rejection remains observed and unconfirmed`, async () => {
      const f = fixture(), c = control(); let hooks = 0, attempts = 0;
      const rejected = (hook = false) => {
        const p = Promise.reject(new Error("synthetic adapter refusal"));
        if (hook) Object.defineProperty(p, "then", {get() {hooks++; assert.fail("Supplied then must not run.");}});
        return p;
      };
      if (kind === "factory") f.options.createStorage = (() => rejected()) as unknown as typeof f.options.createStorage;
      if (kind === "review-own-then") f.options.review = (() => rejected(true)) as typeof f.options.review;
      if (kind === "review-own-constructor") f.options.review = (() => Object.defineProperty(rejected(), "constructor", {value: Promise})) as typeof f.options.review;
      if (kind === "policy-own-then") c.stillAllowed = (() => rejected(true)) as typeof c.stillAllowed;
      if (kind === "current-own-then") c.isCurrent = (() => rejected(true)) as unknown as typeof c.isCurrent;
      if (kind === "cleanup-own-then") c.mayDiscard = (() => rejected(true)) as typeof c.mayDiscard;
      if (kind === "inspect" || kind === "fence") {
        const factory = f.options.createStorage;
        f.options.createStorage = (...args) => {
          const original = factory(...args); assert.ok(original);
          return {...original, ...(kind === "inspect" ? {inspect: (() => {attempts++; return rejected();}) as unknown as typeof original.inspect}
            : {fence: (() => {attempts++; return rejected();}) as unknown as typeof original.fence})};
        };
      }
      const s = createApprovedTrainingSaveOwner(f.options)(request(), c); assert.ok(s);
      if (kind === "fence") {await s.write(); s.fence(); s.fence(); assert.equal(attempts, 1);}
      else if (kind === "cleanup-own-then") {await s.write(); assert.equal(await s.discard(), false);}
      else await assert.rejects(s.write());
      // No rejection listener is installed. Node's normal policy fails this
      // isolated child if any malformed original native rejection escapes.
      await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
      assert.equal(hooks, 0); assert.equal(s.inspect().phase, "unconfirmed"); assert.equal(s.inspect().ioClosed, false);
      assert.equal(s.isCurrent(), false); assert.equal(await s.discard(), false); await assert.rejects(s.write());
    });
  test("an active constructor is refused without evaluating supplied species hooks", async () => {
    const f = fixture(); let hooks = 0; const p = Promise.resolve(f.candidate);
    Object.defineProperty(p, "constructor", {get() {hooks++; assert.fail("No constructor getter.");}});
    f.options.review = () => p;
    const s = createApprovedTrainingSaveOwner(f.options)(request(), control()); assert.ok(s); await assert.rejects(s.write());
    assert.equal(hooks, 0); assert.equal(s.inspect().ioClosed, false); assert.equal(await s.discard(), false);
  });
} else {
  test("malformed original native rejections are isolated, observed and never supply retirement", () => {
    const env: NodeJS.ProcessEnv = {...process.env, AISB_SAVE_PROMISE_REFUSAL_FIXTURE: "one-owned-child"}; delete env.NODE_TEST_CONTEXT;
    const file = path.resolve("modules/application/use-cases/model/tests/approved-training-save-owner.unit.test.ts");
    const child = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", "--", file],
      {env, cwd: process.cwd(), encoding: "utf8", timeout: 20000, maxBuffer: 256 * 1024, windowsHide: true});
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /# fail 0\b/); assert.match(child.stdout, /# skipped 0\b/);
    for (const kind of ["factory", "review-own-then", "review-own-constructor", "policy-own-then", "current-own-then", "cleanup-own-then", "inspect", "fence"])
      assert.ok(child.stdout.includes(`isolated ${kind} rejection`));
    assert.ok(child.stdout.includes("active constructor is refused"));
  });
}
