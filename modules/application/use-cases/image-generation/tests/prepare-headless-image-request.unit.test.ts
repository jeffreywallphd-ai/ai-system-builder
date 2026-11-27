import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId, parseHeadlessReadRequest,
  parseHeadlessBuildPlanProposal} from "../../../../contracts/headless";
import {prepareHeadlessImageRequest} from "../prepare-headless-image-request";

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
