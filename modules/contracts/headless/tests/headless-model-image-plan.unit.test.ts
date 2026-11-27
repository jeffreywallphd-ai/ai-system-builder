import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {snapshotBoundedImageGenerationRequest} from "../../image-generation";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId, parseHeadlessReadRequest,
  parseHeadlessBuildPlanProposal, readHeadlessModelImagePlanRequest, readHeadlessModelImageSettings} from "..";

function fixture() {
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const request = {version, operation: "models.generate-image", input: {hostIncarnationId: host,
    workspaceId: createWorkspaceId("workspace.image-intent"), idempotencyKey: randomUUID(), name: "Product image trial",
    model: {modelRecordId: "model.synthetic-image", updatedAt: "2026-11-27T00:00:00.000Z"},
    promptDigest: "sha256:" + "a".repeat(64), negativePromptDigest: "sha256:" + "b".repeat(64),
    settings: {width: 512, height: 512, steps: 20, cfg: 7, seed: 0, numImages: 1,
      denoise: 1, sampler: "dpmpp_2m", scheduler: "normal"}}};
  return {host, request};
}

test("image intent owns frozen model, prompt digests and explicit settings without enabling a public operation", () => {
  const f = fixture(), result = readHeadlessModelImagePlanRequest(f.request, f.host); assert.ok(result.ok);
  assert.deepEqual(result.request, f.request);
  for (const value of [result.request, result.request.input, result.request.input.model, result.request.input.settings])
    assert.ok(Object.isFrozen(value));
  f.request.input.model.updatedAt = "2026-11-28T00:00:00.000Z"; f.request.input.settings.steps = 200;
  assert.equal(result.request.input.model.updatedAt, "2026-11-27T00:00:00.000Z"); assert.equal(result.request.input.settings.steps, 20);
  assert.equal(parseHeadlessReadRequest(result.request, f.host).ok, false);
  assert.equal(parseHeadlessBuildPlanProposal(result.request, f.host).ok, false);
});

test("image intent accepts absent negative prompt and optional engine labels; canonicalizes zero", () => {
  const f = fixture(); delete (f.request.input as Partial<typeof f.request.input>).negativePromptDigest;
  const raw: any = f.request.input.settings; delete raw.denoise; delete raw.sampler; delete raw.scheduler; raw.seed = -0;
  const result = readHeadlessModelImagePlanRequest(f.request, f.host); assert.ok(result.ok);
  assert.equal("negativePromptDigest" in result.request.input, false);
  assert.equal("sampler" in result.request.input.settings, false);
  assert.equal(Object.is(result.request.input.settings.seed, -0), false);
});

test("image syntax shares existing request ceilings and preserves ordinary headed behavior", () => {
  const settings = {width: 4096, height: 4096, steps: 200, cfg: 50, seed: Number.MAX_SAFE_INTEGER, numImages: 8, denoise: 0};
  assert.deepEqual(readHeadlessModelImageSettings(settings), settings);
  assert.ok(readHeadlessModelImageSettings({...settings, width: 64, height: 64, steps: 1, cfg: 0.01, seed: -1, numImages: 1}));
  const ordinary = {prompt: "Synthetic headed request", width: 64, height: 64, engineHints: {runtimeDeviceMode: "cpu"}};
  assert.deepEqual(snapshotBoundedImageGenerationRequest(ordinary), ordinary);
});

for (const [field, values] of Object.entries({width: [63, 4097, 1.5, "64", undefined], height: [0, 4097, null],
  steps: [0, 201, 1.1], cfg: [0, 50.1, Infinity, "7"], seed: [0.1, Number.MAX_SAFE_INTEGER + 1],
  numImages: [0, 9, 1.1], denoise: [-0.1, 1.1, undefined], sampler: ["", "a".repeat(129), "../escape", "https://invalid", " token=synthetic ", null],
  scheduler: ["trailing ", "bad\nlabel", "Bearer synthetic"]})) {
  test(`image settings reject invalid ${field} values without relaxing existing ceilings`, () => {
    for (const value of values) assert.equal(readHeadlessModelImageSettings({...fixture().request.input.settings, [field]: value}), undefined);
  });
}

for (const field of ["width", "height", "steps", "cfg", "seed", "numImages"]) {
  test(`image settings require explicit ${field}`, () => {
    const raw: any = fixture().request.input.settings; delete raw[field];
    assert.equal(readHeadlessModelImageSettings(raw), undefined);
  });
}

for (const field of ["prompt", "negativePrompt", "model", "engineHints", "runtimeDeviceMode", "faceId", "latentSource"]) {
  test(`image intent rejects unapproved settings field ${field}`, () => {
    const f = fixture(); Object.assign(f.request.input.settings, {[field]: "synthetic"});
    assert.equal(readHeadlessModelImagePlanRequest(f.request, f.host).ok, false);
  });
}

for (const variant of ["version", "operation", "host", "workspace", "key", "model", "timestamp", "model-path", "model-extra", "digest",
  "negative-digest", "missing-model", "name", "credential-name", "path-name", "raw-prompt", "path", "approval", "actor", "symbol"] as const) {
  test(`image intent denies ${variant}`, () => {
    const f = fixture(), raw: any = f.request;
    switch (variant) {
      case "version": raw.version = "future"; break;
      case "operation": raw.operation = "models.train"; break;
      case "host": raw.input.hostIncarnationId = "invalid"; break;
      case "workspace": raw.input.workspaceId = ""; break;
      case "key": raw.input.idempotencyKey = "invalid"; break;
      case "model": raw.input.model.modelRecordId = ""; break;
      case "timestamp": raw.input.model.updatedAt = "2026-02-30T00:00:00.000Z"; break;
      case "model-path": raw.input.model.modelRecordId = "C:/synthetic/model"; break;
      case "model-extra": raw.input.model.path = "synthetic"; break;
      case "digest": raw.input.promptDigest = "a".repeat(64); break;
      case "negative-digest": raw.input.negativePromptDigest = undefined; break;
      case "missing-model": delete raw.input.model; break;
      case "name": raw.input.name = "a".repeat(161); break;
      case "credential-name": raw.input.name = "Bearer synthetic-credential"; break;
      case "path-name": raw.input.name = "C:/synthetic"; break;
      case "raw-prompt": raw.input.prompt = "Synthetic private text"; break;
      case "path": raw.input.outputPath = "synthetic"; break;
      case "approval": raw.input.approved = true; break;
      case "actor": raw.input.principalId = "synthetic"; break;
      case "symbol": raw.input[Symbol("hidden")] = true; break;
    }
    assert.equal(readHeadlessModelImagePlanRequest(raw, f.host).ok, false);
  });
}

test("image intent distinguishes a changed valid host and rejects invalid current host", () => {
  const f = fixture(), other = randomUUID(); assert.ok(isHeadlessHostIncarnationId(other));
  assert.deepEqual(readHeadlessModelImagePlanRequest(f.request, other), {ok: false, code: "headless.host-changed"});
  assert.deepEqual(readHeadlessModelImagePlanRequest(f.request, "invalid" as typeof f.host), {ok: false, code: "headless.invalid-request"});
});

test("image intent refuses accessors and cycles without invoking getter code", () => {
  const f = fixture(); let reads = 0;
  Object.defineProperty(f.request.input.model, "updatedAt", {enumerable: true, get() {reads++; return "2026-11-27T00:00:00.000Z";}});
  assert.equal(readHeadlessModelImagePlanRequest(f.request, f.host).ok, false); assert.equal(reads, 0);
  const cyclic: any = fixture(); cyclic.request.input.settings.steps = cyclic.request;
  assert.equal(readHeadlessModelImagePlanRequest(cyclic.request, cyclic.host).ok, false);
});

test("image metadata rejects known credential shapes while ordinary functionality labels remain usable", () => {
  const f = fixture(), token = "sk-proj-" + "x".repeat(32);
  f.request.input.name = token;
  assert.equal(readHeadlessModelImagePlanRequest(f.request, f.host).ok, false);
  assert.equal(readHeadlessModelImageSettings({...f.request.input.settings, sampler: token}), undefined);
  f.request.input.name = "Prompt safety model";
  assert.equal(readHeadlessModelImagePlanRequest(f.request, f.host).ok, true);
});
