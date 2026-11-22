import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal, readHeadlessModelTrainingInputsValue,
  type HeadlessModelTrainingInputsResult} from "../../../../contracts/headless";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import type {PreviewHeadlessModelTrainingInputsUseCase} from "../../../../application/use-cases/model/headless-model-training-inputs.use-case";
import {readModelTrainingReviewBindings} from "../../../../adapters/persistence/system-builder/headlessModelTrainingReviewBindings";
import {prepareHeadlessModelTrainingReviews} from "../headlessModelTrainingReview";

function fixture(two = false) {
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const workspaceId = createWorkspaceId("workspace.training-review-host"), organizationId = createOrganizationId("org.training-review-host");
  const at = "2026-11-21T00:00:00.000Z";
  const step = {operation: "models.train", idempotencyKey: randomUUID(), name: "Support training trial",
    model: {modelRecordId: "model.synthetic", updatedAt: at},
    dataset: {datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64)},
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 2, seed: 0}, validation: {enabled: false}}};
  const proposal = {hostIncarnationId: host, workspaceId, steps: two ? [step, {...step, idempotencyKey: randomUUID(), name: "Second private trial"}] : [step]};
  const parsed = parseHeadlessBuildPlanProposal(proposal, host, {allowLocalFileSave: false, allowModelTraining: true}); assert.ok(parsed.ok);
  const first = parsed.requests[0]; assert.ok(first.operation === "models.train");
  const value = readHeadlessModelTrainingInputsValue({workspaceId, model: {...step.model, source: "local", lifecycleStatus: "downloaded",
    artifactForm: "full-model", provider: "huggingface", modelId: "fixture/base", taskTags: ["chat"], serializationFormat: "safetensors"},
    dataset: {datasetId: step.dataset.datasetId, version: {versionId: step.dataset.versionId, versionDigest: step.dataset.versionDigest,
      createdAt: at, totalRows: 10, sourceCount: 1, artifactCount: 4, parentVersionId: null, splitSeed: 0, recipeDigest: "sha256:" + "b".repeat(64),
      quality: {policyFingerprint: "sha256:" + "c".repeat(64), reportFingerprint: "sha256:" + "d".repeat(64)},
      splits: [{role: "train", rowCount: 6}, {role: "validation", rowCount: 2}, {role: "test", rowCount: 2}]}},
    verification: {inputBytes: "not-checked", runtimeReadiness: "not-checked", trainingCompatibility: "not-checked", resourceAdmission: "not-checked",
      licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"}, trainingApproval: "required"}, first.input); assert.ok(value);
  const target = {hostIncarnationId: host, fingerprint: createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex"),
    scope: {organizationId, workspaceId, principalId: "principal.synthetic", registeredClientId: randomUUID()}};
  const state = {current: true, allowed: true, factories: 0, reads: 0, hook: undefined as (() => void | Promise<void>) | undefined};
  const inputs = {async execute(raw: unknown, authority: Parameters<PreviewHeadlessModelTrainingInputsUseCase["execute"]>[1]): Promise<HeadlessModelTrainingInputsResult> {
    state.reads++; assert.equal(authority.context.organizationId, organizationId); assert.equal(authority.context.workspaceId, workspaceId);
    assert.equal(authority.clientId, target.scope.registeredClientId);
    assert.equal((raw as {operation: string}).operation, "models.preview-training-inputs");
    await state.hook?.(); return {ok: true, operation: "models.preview-training-inputs", value};
  }};
  const options = {target, requests: parsed.requests, isCurrent: () => state.current, stillAllowed: async () => state.allowed,
    async getInputs() {state.factories++; return inputs;}};
  const partition = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  return {host, step, value, target, parsed, inputs, options, partition, state};
}

test("the existing application compiler prepares exact immutable ordered facts before a metadata-only binder", async () => {
  const f = fixture(true), result = await prepareHeadlessModelTrainingReviews(f.options); assert.ok(result.ok);
  assert.equal(f.state.factories, 1); assert.equal(f.state.reads, 2);
  const before = [f.state.factories, f.state.reads];
  const bindings = await result.bind(f.partition, f.target, f.parsed.requests); assert.ok(bindings);
  assert.deepEqual([f.state.factories, f.state.reads], before, "Binding must not reenter metadata/provider/runtime owners.");
  assert.deepEqual(bindings.map(row => row.step), [1, 2]);
  assert.deepEqual(readModelTrainingReviewBindings(bindings, f.parsed.requests), bindings);
  assert.ok(Object.isFrozen(bindings)); assert.ok(Object.isFrozen(bindings[0].inputs.model));
  assert.notEqual(bindings[0].proposalDigest, bindings[1].proposalDigest);
  assert.equal(bindings[0].inputs.verification.inputBytes, "not-checked");
  for (const request of f.parsed.requests) {assert.ok(request.operation === "models.train");
    if (request.operation === "models.train") assert.equal(await result.validate(request), true);}
  assert.deepEqual(await f.partition.listNamespaces(), []);
  assert.equal(await result.bind(f.partition, {...f.target, scope: {...f.target.scope, registeredClientId: randomUUID()}}, f.parsed.requests), undefined);
  assert.equal(await result.bind(createInMemoryStructuredDocumentStore().forOrganization(createOrganizationId("foreign.org")), f.target, f.parsed.requests), undefined);
  f.state.current = false; assert.equal(await result.bind(f.partition, f.target, f.parsed.requests), undefined);
});

test("requests, authority callbacks and the original input reader are captured across every awaited preparation", async () => {
  const f = fixture(true), originalTarget = structuredClone(f.target), originalRequests = structuredClone(f.parsed.requests);
  let replacements = 0;
  f.state.hook = async () => {
    f.step.training.commonParameters.maxSteps = 99;
    (f.parsed.requests[0].input as {name: string}).name = "Changed outside";
    f.options.target.scope.principalId = "changed.actor";
    f.options.getInputs = async () => {replacements++; throw new Error("Replacement must not run.");};
    f.options.stillAllowed = async () => {replacements++; return false;};
    f.inputs.execute = async () => {replacements++; throw new Error("Replacement must not run.");};
    f.state.hook = undefined;
  };
  const result = await prepareHeadlessModelTrainingReviews(f.options); assert.ok(result.ok);
  assert.equal(replacements, 0); assert.equal(f.state.reads, 2);
  assert.ok(await result.bind(f.partition, originalTarget, originalRequests));
  assert.equal(await result.bind(f.partition, f.target, f.parsed.requests), undefined);
});

test("denied, missing, retired and private-error metadata owners cannot create a binding", async () => {
  const denied = fixture(); denied.state.allowed = false;
  assert.deepEqual(await prepareHeadlessModelTrainingReviews(denied.options), {ok: false, code: "headless.forbidden"});
  assert.equal(denied.state.factories, 0); assert.equal(denied.state.reads, 0);
  const missing = fixture();
  assert.deepEqual(await prepareHeadlessModelTrainingReviews({...missing.options, getInputs: async () => undefined}), {ok: false, code: "headless.unavailable"});
  let policyCalls = 0;
  assert.deepEqual(await prepareHeadlessModelTrainingReviews({...missing.options, getInputs: async () => undefined,
    stillAllowed: async () => ++policyCalls === 1}), {ok: false, code: "headless.forbidden"},
  "Withdrawal at the factory handoff takes precedence over reporting reader availability.");
  const retired = fixture(); retired.state.hook = () => {retired.state.current = false;};
  assert.deepEqual(await prepareHeadlessModelTrainingReviews(retired.options), {ok: false, code: "headless.forbidden"});
  const failed = fixture(); failed.inputs.execute = async () => {throw new Error("Synthetic private model path must not escape.");};
  const outcome = await prepareHeadlessModelTrainingReviews(failed.options);
  assert.deepEqual(outcome, {ok: false, code: "headless.unavailable"}); assert.doesNotMatch(JSON.stringify(outcome), /private|path|escape/);
  const stale = fixture(); stale.inputs.execute = async () => ({ok: false, code: "headless.stale"});
  assert.deepEqual(await prepareHeadlessModelTrainingReviews(stale.options), {ok: false, code: "headless.stale"});
});

test("active/hidden/foreign proposal metadata fails before opening the original reader", async () => {
  const f = fixture(); let hooks = 0;
  const active = {...f.target}; Object.defineProperty(active, "scope", {enumerable: true, get() {hooks++; return f.target.scope;}});
  const hidden = {...f.target}; Object.defineProperty(hidden, "approved", {value: true});
  const proxy = new Proxy(f.target, {getPrototypeOf() {hooks++; return Object.prototype;}});
  for (const target of [active, hidden, proxy, {...f.target, scope: {...f.target.scope, workspaceId: createWorkspaceId("foreign.workspace")}}])
    assert.equal((await prepareHeadlessModelTrainingReviews({...f.options, target})).ok, false);
  assert.equal(hooks, 0); assert.equal(f.state.factories, 0); assert.equal(f.state.reads, 0);
});

test("the factory-to-policy handoff cannot replace the returned original reader", async () => {
  const f = fixture(); let policies = 0, replacements = 0;
  const result = await prepareHeadlessModelTrainingReviews({...f.options, stillAllowed: async () => {
    if (++policies === 2) f.inputs.execute = async () => {replacements++; return {ok: true, operation: "models.preview-training-inputs", value: f.value};};
    return true;
  }});
  assert.ok(result.ok); assert.equal(f.state.reads, 1); assert.equal(replacements, 0);
  assert.ok(await result.bind(f.partition, f.target, f.parsed.requests));
});

test("reader capture refuses accessor/proxy hooks and preserves the original class receiver", async () => {
  const f = fixture(); let hooks = 0;
  const active = Object.defineProperty({}, "execute", {get() {hooks++; return f.inputs.execute;}});
  // Async factories inspect "then" while delivering a value. Keep that normal
  // Promise probe inert; count reader-property traps after factory delivery.
  const proxy = new Proxy(f.inputs, {get(target, key, receiver) {
    if (key !== "then") hooks++;
    return Reflect.get(target, key, receiver);
  }});
  for (const owner of [active, proxy])
    assert.deepEqual(await prepareHeadlessModelTrainingReviews({...f.options, getInputs: async () => owner as typeof f.inputs}),
      {ok: false, code: "headless.unavailable"});
  assert.equal(hooks, 0); assert.equal(f.state.reads, 0);
  class Reader {
    readonly marker = "original-reader";
    async execute(...args: Parameters<typeof f.inputs.execute>) {
      assert.equal(this.marker, "original-reader"); return f.inputs.execute(...args);
    }
  }
  for (const property of ["name", "length"]) Object.defineProperty(Reader.prototype.execute, property,
    {configurable: true, get() {hooks++; return property === "name" ? "Synthetic reader" : 2;}});
  const result = await prepareHeadlessModelTrainingReviews({...f.options, getInputs: async () => new Reader()});
  assert.ok(result.ok); assert.equal(f.state.reads, 1); assert.equal(hooks, 0);
});
