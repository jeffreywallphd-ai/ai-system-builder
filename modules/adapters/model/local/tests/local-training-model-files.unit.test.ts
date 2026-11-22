import assert from "node:assert/strict";
import {lstat, mkdir, mkdtemp, readdir, realpath, rm, unlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {MAX_LIST_MODEL_FILES} from "../../../../contracts/model";
import {createLocalTrainingModelFilesAdapter} from "../createLocalTrainingModelFilesAdapter";
import {createLocalContextEmbeddingModelFilesAdapter} from "../createLocalContextEmbeddingModelFilesAdapter";

async function fixture(t: TestContext) {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(path.join(boundary, "mf-")));
  const identity = await lstat(directory, {bigint: true});
  t.after(async () => {
    const current = await lstat(directory, {bigint: true});
    assert.equal(path.dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    await rm(directory, {recursive: true});
  });
  const allowed = path.join(directory, "allowed"), outside = path.join(directory, "outside");
  for (const model of [allowed, outside]) {
    await mkdir(model);
    for (const file of ["config.json", "tokenizer.json", "model.safetensors"])
      await writeFile(path.join(model, file), "synthetic presence only; not valid weights or model configuration");
  }
  const roots = [allowed];
  const training = createLocalTrainingModelFilesAdapter({allowedRootDirectories: roots});
  const context = createLocalContextEmbeddingModelFilesAdapter({allowedRootDirectories: roots});
  return {allowed, outside, roots, training, context};
}

test("training reads only the supported configured-root layout without changing files", async t => {
  const f = await fixture(t), before = await readdir(f.allowed);
  const result = await f.training.inspectExistingDirectory(f.allowed);
  assert.deepEqual(result, {localModelReference: f.allowed, layoutProfile: "unsharded-training-safetensors-layout-v1"});
  assert(Object.isFrozen(result)); assert.deepEqual(await readdir(f.allowed), before);
  assert.equal("modelBytes" in result!, false); assert.equal("approved" in result!, false);
});

test("adapter roots refuse training even when full-model files also exist; Context defaults stay intact", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.allowed, "adapter_config.json"), "");
  assert.equal(await f.training.inspectExistingDirectory(f.allowed), undefined);
  assert.deepEqual(await f.context.inspectExistingDirectory(f.allowed), {localModelReference: f.allowed});
});

for (const marker of ["adapter_config.json", "model.safetensors.index.json"])
  test(`a reserved ${marker} directory also refuses training without changing Context`, async t => {
    const f = await fixture(t); await mkdir(path.join(f.allowed, marker));
    assert.equal(await f.training.inspectExistingDirectory(f.allowed), undefined);
    assert.deepEqual(await f.context.inspectExistingDirectory(f.allowed), {localModelReference: f.allowed});
  });

test("the training tokenizer profile does not narrow the existing Context tokenizer choices", async t => {
  const f = await fixture(t);
  await unlink(path.join(f.allowed, "tokenizer.json")); await writeFile(path.join(f.allowed, "vocab.txt"), "synthetic");
  assert.equal(await f.training.inspectExistingDirectory(f.allowed), undefined);
  assert.deepEqual(await f.context.inspectExistingDirectory(f.allowed), {localModelReference: f.allowed});
});

test("pickle-only roots cannot fall back or become installed safe models", async t => {
  const f = await fixture(t);
  await unlink(path.join(f.allowed, "model.safetensors")); await writeFile(path.join(f.allowed, "pytorch_model.bin"), "synthetic");
  assert.equal(await f.training.inspectExistingDirectory(f.allowed), undefined);
  assert.equal(await f.context.inspectExistingDirectory(f.allowed), undefined);
});

test("sharded or ambiguous training layouts are explicitly unavailable", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.allowed, "model.safetensors.index.json"), "{}");
  await writeFile(path.join(f.allowed, "model-00001-of-00001.safetensors"), "synthetic");
  assert.equal(await f.training.inspectExistingDirectory(f.allowed), undefined);
  await unlink(path.join(f.allowed, "model.safetensors"));
  assert.equal(await f.training.inspectExistingDirectory(f.allowed), undefined);
});

test("foreign or malformed references do not escape the configured roots", async t => {
  const f = await fixture(t);
  for (const value of [f.outside, "https://example.test/model", "\\\\example.test\\model", "relative/model", "", "x".repeat(4097), "\0", undefined])
    assert.equal(await f.training.inspectExistingDirectory(value as never), undefined);
  assert.deepEqual(await f.training.inspectExistingDirectory(f.allowed), {localModelReference: f.allowed, layoutProfile: "unsharded-training-safetensors-layout-v1"});
});

test("missing, foreign, excessive or malformed root configuration grants no inspection", async t => {
  const f = await fixture(t);
  for (const roots of [[], [f.outside], ["relative"], ["\\\\example.test\\model"], Array(9).fill(f.allowed)])
    assert.equal(await createLocalTrainingModelFilesAdapter({allowedRootDirectories: roots}).inspectExistingDirectory(f.allowed), undefined);
  assert.equal(await f.training.inspectExistingDirectory(path.join(f.allowed, "missing")), undefined);
  assert.equal((await readdir(f.allowed)).includes("missing"), false);
});

test("caller changes cannot replace the factory's captured approved roots", async t => {
  const f = await fixture(t); f.roots[0] = f.outside;
  assert.equal(await f.training.inspectExistingDirectory(f.outside), undefined);
  assert.deepEqual(await f.training.inspectExistingDirectory(f.allowed), {localModelReference: f.allowed, layoutProfile: "unsharded-training-safetensors-layout-v1"});
});

test("a bounded truncated inventory cannot supply a successful layout observation", async t => {
  const f = await fixture(t);
  for (let index = 0; index <= MAX_LIST_MODEL_FILES; index++) await writeFile(path.join(f.allowed, `extra-${index}.txt`), "x");
  assert.equal(await f.training.inspectExistingDirectory(f.allowed), undefined);
  assert.equal(await f.context.inspectExistingDirectory(f.allowed), undefined);
});
