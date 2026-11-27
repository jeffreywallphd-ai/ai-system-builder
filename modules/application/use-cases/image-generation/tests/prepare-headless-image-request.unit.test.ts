import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId, parseHeadlessReadRequest,
  parseHeadlessBuildPlanProposal} from "../../../../contracts/headless";
import {prepareHeadlessImageRequest, PrepareHeadlessImageModelUseCase} from "../prepare-headless-image-request";
import {ReadHeadlessModelMetadataUseCase} from "../../model/headless-model-metadata.use-case";
import type {ModelInventoryRecord} from "../../../../contracts/model";
import {organizationId, principalId} from "../../dataset-version/tests/headless-dataset-metadata.fixture";

const digest = (text: string) => "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
function fixture(prompt = "  Synthetic café 🌿\n", negativePrompt?: string) {
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const plan = {version, operation: "models.generate-image", input: {hostIncarnationId: host,
    workspaceId: createWorkspaceId("workspace.image-binding"), idempotencyKey: randomUUID(), name: "Image binding",
    model: {modelRecordId: "model.synthetic-image", updatedAt: "2026-11-27T00:00:00.000Z"},
    promptDigest: digest(prompt), ...(negativePrompt === undefined ? {} : {negativePromptDigest: digest(negativePrompt)}),
    settings: {width: 512, height: 512, steps: 20, cfg: 7, seed: 0, numImages: 1}}};
  const raw = {plan, prompt, ...(negativePrompt === undefined ? {} : {negativePrompt})};
  return {host, plan, raw};
}
for (const negative of [undefined, "", "Synthetic exclusions"]) {
  test("transient exact text binds with negative presence " + String(negative), () => {
    const f = fixture(undefined, negative), value = prepareHeadlessImageRequest(f.raw, f.host); assert.ok(value.ok);
    assert.equal(value.prepared.generationRequest.prompt, f.raw.prompt);
    assert.equal(value.prepared.generationRequest.negativePrompt, negative);
    assert.equal(Object.prototype.hasOwnProperty.call(value.prepared.generationRequest, "negativePrompt"), negative !== undefined);
    assert.equal(value.prepared.generationApprovalRequired, true); assert.equal(value.prepared.outputImportApprovalRequired, true);
    assert.equal(value.prepared.modelSelection, "not-checked"); assert.equal(value.prepared.runtimeReadiness, "not-checked");
    assert.ok(Object.isFrozen(value.prepared)); assert.ok(Object.isFrozen(value.prepared.generationRequest));
    f.plan.input.settings.width = 1024; f.raw.prompt = "Replaced";
    assert.equal(value.prepared.plan.input.settings.width, 512); assert.notEqual(value.prepared.generationRequest.prompt, "Replaced");
    assert.doesNotMatch(JSON.stringify(value.prepared.plan), /café|Synthetic exclusions/);
    assert.equal(parseHeadlessReadRequest(f.plan, f.host).ok, false); assert.equal(parseHeadlessBuildPlanProposal(f.plan, f.host).ok, false);
  });
}
test("UTF-8 content, whitespace and normalization changes cannot reuse a planned digest", () => {
  const f = fixture();
  for (const prompt of [f.raw.prompt.trim(), f.raw.prompt.normalize("NFD"), "Other text"])
    assert.deepEqual(prepareHeadlessImageRequest({...f.raw, prompt}, f.host), {ok: false, code: "headless.stale"});
});
test("lone surrogates cannot substitute for replacement characters or distinct malformed text", () => {
  const replacement = fixture("\ufffd", "\ufffd");
  assert.equal(prepareHeadlessImageRequest(replacement.raw, replacement.host).ok, true);
  for (const invalid of ["\ud800", "\ud801", "\udc00", "\udfff", "x\ud800y", "\ud800\ud800\udc00"]) {
    assert.equal(digest("\ud800"), digest("\ufffd"), "Demonstrate the original lossy UTF-8 collision.");
    assert.deepEqual(prepareHeadlessImageRequest({...replacement.raw, prompt: invalid}, replacement.host), {ok: false, code: "headless.invalid-request"});
    assert.deepEqual(prepareHeadlessImageRequest({...replacement.raw, negativePrompt: invalid}, replacement.host), {ok: false, code: "headless.invalid-request"});
    const exact = fixture(invalid); assert.equal(prepareHeadlessImageRequest(exact.raw, exact.host).ok, false);
  }
  const validPair = fixture("\ud800\udc00", "\udbff\udfff");
  assert.equal(prepareHeadlessImageRequest(validPair.raw, validPair.host).ok, true);
});
test("negative prompt content and absent versus empty cannot be substituted", () => {
  const f = fixture("Synthetic", "");
  for (const raw of [{plan: f.plan, prompt: f.raw.prompt}, {...f.raw, negativePrompt: "Changed"}])
    assert.deepEqual(prepareHeadlessImageRequest(raw, f.host), {ok: false, code: "headless.stale"});
  const absent = fixture(); assert.deepEqual(prepareHeadlessImageRequest({...absent.raw, negativePrompt: ""}, absent.host), {ok: false, code: "headless.stale"});
});
test("existing prompt limits admit the boundary and refuse excessive or empty content", () => {
  const f = fixture("é".repeat(10000)); assert.equal(prepareHeadlessImageRequest(f.raw, f.host).ok, true);
  for (const text of ["", "  ", "x".repeat(10001)]) {
    const g = fixture(text); assert.deepEqual(prepareHeadlessImageRequest(g.raw, g.host), {ok: false, code: "headless.invalid-request"});
  }
  const g = fixture("Synthetic", "x".repeat(10001)); assert.equal(prepareHeadlessImageRequest(g.raw, g.host).ok, false);
});
test("unknown capability fields, malformed settings and wrong host do not prepare requests", () => {
  const f = fixture();
  for (const field of ["model", "engineHints", "approval", "path", "execute", "isCurrent"])
    assert.deepEqual(prepareHeadlessImageRequest({...f.raw, [field]: true}, f.host), {ok: false, code: "headless.invalid-request"});
  f.plan.input.settings.numImages = 9; assert.equal(prepareHeadlessImageRequest(f.raw, f.host).ok, false);
  const g = fixture(); assert.deepEqual(prepareHeadlessImageRequest(g.raw, f.host), {ok: false, code: "headless.host-changed"});
});
test("accessors and proxies are rejected without invoking their traps or leaking failures", () => {
  const f = fixture(); let invoked = 0;
  const accessor = {...f.raw}; Object.defineProperty(accessor, "prompt", {enumerable: true, get() {invoked++; throw Error("synthetic private text");}});
  const traps = {get() {invoked++; throw Error("synthetic private text");}, getPrototypeOf() {invoked++; throw Error("synthetic private text");}, ownKeys() {invoked++; throw Error("synthetic private text");}};
  for (const raw of [accessor, new Proxy(f.raw, traps), {...f.raw, plan: new Proxy(f.plan, traps)},
    {...f.raw, plan: {...f.plan, input: new Proxy(f.plan.input, traps)}}, {...f.raw, negativePrompt: undefined}])
    assert.deepEqual(prepareHeadlessImageRequest(raw, f.host), {ok: false, code: "headless.invalid-request"});
  assert.equal(invoked, 0);
});

function modelFixture() {
  const f = fixture(), state = {allowed: true, current: true, reads: 0, onRead: (_count: number) => {}};
  let stored: ModelInventoryRecord | undefined = {workspaceId: f.plan.input.workspaceId,
    modelRecordId: f.plan.input.model.modelRecordId, createdAt: f.plan.input.model.updatedAt,
    updatedAt: f.plan.input.model.updatedAt, source: "local", lifecycleStatus: "downloaded", artifactForm: "checkpoint",
    displayName: "Synthetic saved image model", provider: "huggingface", serializationFormat: "safetensors",
    inferenceMode: "text-to-image", taskTags: ["text-to-image"]};
  const authority = {hostIncarnationId: f.host, context: {organizationId, principalId, workspaceId: f.plan.input.workspaceId},
    isCurrent: () => state.current, stillAllowed: async () => state.allowed};
  const metadata = new ReadHeadlessModelMetadataUseCase({organizationId, models: {
    async readRecordedModel(workspace, id) {
      assert.equal(workspace, f.plan.input.workspaceId); assert.equal(id, f.plan.input.model.modelRecordId);
      state.onRead(++state.reads); return stored;
    }, async listModels() {throw Error("Inventory discovery must not occur.");},
  }});
  return {...f, state, authority, owner: new PrepareHeadlessImageModelUseCase({metadata}),
    model: () => stored!, replace: (value: ModelInventoryRecord | undefined) => {stored = value;}};
}

test("saved image selection reuses the original point reader and keeps exact private data immutable", async () => {
  const f = modelFixture(); let privateReads = 0;
  Object.defineProperty(f.model(), "localPath", {get() {privateReads++; throw Error("private path");}});
  const result = await f.owner.execute(f.raw, f.authority); assert.ok(result.ok);
  assert.equal(f.state.reads, 2); assert.equal(privateReads, 0);
  assert.equal(result.prepared.modelSelection, "recorded-only");
  assert.equal(result.prepared.recordedModel.runtimeReadiness, "not-checked");
  assert.equal(result.prepared.recordedModel.supplyVerification, "not-checked");
  assert.equal(result.prepared.generationRequest.model, f.model().modelRecordId);
  assert.equal(result.prepared.generationRequest.prompt, f.raw.prompt);
  assert.equal(result.prepared.generationApprovalRequired, true); assert.equal(result.prepared.outputImportApprovalRequired, true);
  f.model().taskTags!.length = 0; f.raw.prompt = "Replaced text";
  assert.deepEqual(result.prepared.recordedModel.model.taskTags, ["text-to-image"]);
  assert.ok(Object.isFrozen(result.prepared.recordedModel.model.taskTags));
  assert.ok(Object.isFrozen(result.prepared.generationRequest));
  assert.doesNotMatch(JSON.stringify(result.prepared.plan), /café|private path|localPath/);
});

test("stale timestamps and changed metadata cannot select a different saved image model", async () => {
  const stale = modelFixture(); stale.model().updatedAt = "2026-11-26T00:00:00.000Z";
  assert.deepEqual(await stale.owner.execute(stale.raw, stale.authority), {ok: false, code: "headless.stale"});
  const changed = modelFixture(); changed.state.onRead = count => {if (count === 2) changed.model().sizeBytes = 42;};
  assert.deepEqual(await changed.owner.execute(changed.raw, changed.authority), {ok: false, code: "headless.stale"});
});

test("unsupported, foreign and missing saved image records do not become runtime selections", async () => {
  for (const patch of [{lifecycleStatus: "remote-reference"}, {lifecycleStatus: "saved-reference"}, {lifecycleStatus: "invalid"},
    {artifactForm: "adapter"}, {serializationFormat: "pytorch-bin"}, {taskTags: ["chat"]}, {inferenceMode: "chat"},
    {workspaceId: createWorkspaceId("workspace.foreign")}, {modelRecordId: "model.foreign"}] as Partial<ModelInventoryRecord>[]) {
    const f = modelFixture(); f.replace({...f.model(), ...patch});
    assert.deepEqual(await f.owner.execute(f.raw, f.authority), {ok: false, code: "headless.unavailable"});
  }
  const missing = modelFixture(); missing.replace(undefined);
  assert.deepEqual(await missing.owner.execute(missing.raw, missing.authority), {ok: false, code: "headless.unavailable"});
});

test("current model policy and authority identity surround both awaited reads", async () => {
  for (const count of [1, 2]) {
    for (const mutate of ["permission", "host", "actor", "context", "callback"]) {
      const f = modelFixture(); f.state.onRead = value => {
        if (value !== count) return;
        if (mutate === "permission") f.state.allowed = false;
        if (mutate === "host") f.authority.hostIncarnationId = randomUUID() as typeof f.host;
        if (mutate === "actor") f.authority.context.principalId = "foreign-principal" as typeof principalId;
        if (mutate === "context") f.authority.context = {...f.authority.context};
        if (mutate === "callback") f.authority.stillAllowed = async () => true;
      };
      assert.deepEqual(await f.owner.execute(f.raw, f.authority), {ok: false, code: "headless.forbidden"});
    }
  }
  const denied = modelFixture(); denied.state.allowed = false;
  assert.deepEqual(await denied.owner.execute(denied.raw, denied.authority), {ok: false, code: "headless.forbidden"});
  assert.equal(denied.state.reads, 0);
});

test("active authority, hostile metadata and private provider failures return only closed results", async () => {
  const f = modelFixture(); let traps = 0;
  const active = {...f.authority}; Object.defineProperty(active, "context", {get() {traps++; throw Error("private authority");}});
  assert.deepEqual(await f.owner.execute(f.raw, active), {ok: false, code: "headless.unavailable"});
  const proxy = new Proxy(f.authority, {get() {traps++; throw Error("private authority");}});
  assert.deepEqual(await f.owner.execute(f.raw, proxy), {ok: false, code: "headless.unavailable"}); assert.equal(traps, 0);
  f.state.onRead = () => {throw Error("private provider path and credential");};
  assert.deepEqual(await f.owner.execute(f.raw, f.authority), {ok: false, code: "headless.unavailable"});
  const hostile = new PrepareHeadlessImageModelUseCase({metadata: {async execute() {
    return new Proxy({}, {get() {throw Error("private metadata");}}) as never;
  }}});
  assert.deepEqual(await hostile.execute(f.raw, f.authority), {ok: false, code: "headless.unavailable"});
});
