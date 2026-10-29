import assert from "node:assert/strict";
import test from "node:test";
import { captureImageGenerationDraft, imageDraftCacheForOwners, ImageGenerationDraftCache, IMAGE_DRAFT_WORKSPACE_LIMIT, type ImageGenerationFormValues } from "../hooks/image-generation-draft-state";

const form = (): ImageGenerationFormValues => ({ prompt: "Synthetic draft", negativePrompt: "", seed: "7", width: "256", height: "256", steps: "1", cfg: "7", denoise: "1", sampler: "euler", scheduler: "normal", model: "model.synthetic", numImages: "1", latentSourceArtifactId: "", faceIdEnabled: false, faceIdArtifactId1: "", faceIdArtifactId2: "", faceIdArtifactId3: "", faceIdIdentityStrength: "0.85", faceIdStructureStrength: "0.75", faceIdNoise: "0.35" });

test("detaches only known form fields, preserves unfinished text, and never stores a caller object", () => {
  const input = form(); input.width = "unfinished";
  const captured = captureImageGenerationDraft(input)!; assert.deepEqual(captured, input); assert.notEqual(captured, input);
  input.prompt = "Changed after capture"; assert.equal(captured.prompt, "Synthetic draft");
  const cache = new ImageGenerationDraftCache(); assert.equal(cache.write("workspace.a", captured), true);
  const read = cache.read("workspace.a")!; read.prompt = "Changed after read"; assert.equal(cache.read("workspace.a")!.prompt, "Synthetic draft");
});

test("rejects extra result/error fields, inherited records, accessors and oversize text without invoking coercion", () => {
  let calls = 0; const accessor = form(); Object.defineProperty(accessor, "prompt", { enumerable: true, get() { calls++; return "must not read"; } });
  for (const value of [null, [], Object.assign(Object.create({ inherited: true }), form()), { ...form(), previewUrl: "synthetic-private-url" }, { ...form(), error: "synthetic-private-error" }, { ...form(), faceIdEnabled: 1 }, { ...form(), prompt: "x".repeat(10_001) }, { ...form(), model: { toString() { calls++; return "must not coerce"; } } }, accessor]) assert.equal(captureImageGenerationDraft(value), undefined);
  assert.equal(calls, 0);
});

test("applies an aggregate UTF8 bound and refuses an uncached edit without reviving stale state", () => {
  const cache = new ImageGenerationDraftCache();cache.write("workspace.a", form());
  const huge = form(); for (const key of Object.keys(huge)) if (key !== "faceIdEnabled") (huge as unknown as Record<string, string>)[key] = "\u4e00".repeat(key === "prompt" || key === "negativePrompt" ? 10_000 : 2048);
  assert.equal(captureImageGenerationDraft(huge) === undefined, true); assert.equal(cache.write("workspace.a", huge), false); assert.equal(cache.read("workspace.a"), undefined);
});

test("isolates canonical workspace identities without string coercion or default-global fallback", () => {
  const cache = new ImageGenerationDraftCache();cache.write("workspace.a", form());
  assert.equal(cache.read("workspace.b"), undefined);
  for (const workspace of [undefined, "", "../outside", "workspace/a", " workspace.a", { toString() { throw Error("must not coerce"); } }]) {
    assert.equal(cache.write(workspace, form()), false); assert.equal(cache.read(workspace), undefined);
  }
  assert.equal(cache.read("workspace.a")!.prompt, "Synthetic draft");
});

test("evicts the least recently read workspace at the fixed eight-workspace limit", () => {
  const cache = new ImageGenerationDraftCache();
  for (let i = 0; i < IMAGE_DRAFT_WORKSPACE_LIMIT; i++) cache.write(`workspace.${i}`, form());
  assert(cache.read("workspace.0"));cache.write("workspace.next", form());
  assert.equal(cache.read("workspace.1"), undefined);assert(cache.read("workspace.0"));assert(cache.read("workspace.next"));
});

test("all three client owners must match; equal-looking names grant no shared draft", () => {
  const a = {}, b = {}, c = {};const first = imageDraftCacheForOwners([a, b, c])!;first.write("workspace.a", form());
  assert.equal(imageDraftCacheForOwners([a, b, c]), first);
  for (const owners of [[{}, b, c], [a, {}, c], [a, b, {}]] as const) assert.equal(imageDraftCacheForOwners(owners)!.read("workspace.a"), undefined);
  assert.equal(imageDraftCacheForOwners([a, b, null] as never), undefined);
});
