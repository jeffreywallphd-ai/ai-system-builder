import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "../../../../testing/node-test";
import { createLocalGeneratedModelStorageAdapter } from "../createLocalGeneratedModelStorageAdapter";

describe("createLocalGeneratedModelStorageAdapter", () => {
  it("stores generated model directories in the Hugging Face hub cache layout", async () => {
    const root = join(tmpdir(), `generated-model-storage-${Date.now()}`);
    const source = join(root, "source");
    const cache = join(root, "hf-cache");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "adapter_config.json"), "{}", "utf8");

    const adapter = createLocalGeneratedModelStorageAdapter({
      env: { HF_HUB_CACHE: cache },
      homeDirectory: root,
    });

    const result = await adapter.storeGeneratedModel({
      sourceDirectory: source,
      outputModelName: "Demo Adapter",
      runId: "train-req-1",
      repository: "org/demo-adapter",
    });

    expect(result.modelId).toBe("org/demo-adapter");
    expect(result.localPath).toBe(join(cache, "models--org--demo-adapter", "snapshots", "train-req-1"));
    expect(await readFile(join(result.localPath, "adapter_config.json"), "utf8")).toBe("{}");
  });
});
