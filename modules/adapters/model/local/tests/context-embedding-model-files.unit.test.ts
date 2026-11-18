import assert from "node:assert/strict";
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test from "node:test";
import {createLocalContextEmbeddingModelFilesAdapter} from "../createLocalContextEmbeddingModelFilesAdapter";

test("installed Context model inspection uses configured roots and the unsharded safe-weight layout", async () => {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(temporaryRoot, "context-model-files-")));
  assert.equal(dirname(directory), temporaryRoot);
  try {
    const root = join(directory, "allowed"), outside = join(directory, "outside");
    await mkdir(root); await mkdir(outside);
    for (const target of [root, outside]) {
      await writeFile(join(target, "config.json"), "{}"); await writeFile(join(target, "vocab.txt"), "synthetic");
      await writeFile(join(target, "pytorch_model.bin"), "synthetic unsafe layout");
    }
    const owner = createLocalContextEmbeddingModelFilesAdapter({allowedRootDirectories: [root]});
    assert.equal(await owner.inspectExistingDirectory(root), undefined, "Pickle-only models cannot become an installed safe-weight reference.");
    await writeFile(join(root, "model.safetensors"), "synthetic presence only; loader validation remains separate");
    assert.deepEqual(await owner.inspectExistingDirectory(root), {localModelReference: root});
    assert.equal(await owner.inspectExistingDirectory(outside), undefined);
    assert.equal(await owner.inspectExistingDirectory("https://example.test/model"), undefined);
    assert.equal(await owner.inspectExistingDirectory("\\\\example.test\\model"), undefined);
    assert.equal(await owner.inspectExistingDirectory("relative/model"), undefined);
    const sharded = join(root, "sharded"); await mkdir(sharded);
    await writeFile(join(sharded, "config.json"), "{}"); await writeFile(join(sharded, "vocab.txt"), "synthetic");
    await writeFile(join(sharded, "model.safetensors.index.json"), "{}");
    await writeFile(join(sharded, "model-00001-of-00001.safetensors"), "synthetic");
    assert.equal(await owner.inspectExistingDirectory(sharded), undefined, "Unsupported layouts do not silently fall back.");
  } finally {await rm(directory, {recursive: true, force: true});}
});
