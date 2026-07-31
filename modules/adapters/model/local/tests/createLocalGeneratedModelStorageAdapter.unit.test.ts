import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
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
    expect(result.localPath).toBe(
      join(cache, "models--org--demo-adapter", "snapshots", "train-req-1"),
    );
    expect(
      await readFile(join(result.localPath, "adapter_config.json"), "utf8"),
    ).toBe("{}");
  });

  it("rejects traversal, drive, UNC, separator, and unsafe run identifiers", async () => {
    const root = join(tmpdir(), `generated-model-storage-unsafe-${Date.now()}`);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "model.bin"), "x", "utf8");
    const adapter = createLocalGeneratedModelStorageAdapter({
      env: { HF_HUB_CACHE: join(root, "cache") },
      homeDirectory: root,
    });

    for (const repository of [
      "../model",
      "C:/private/model",
      "\\\\server\\share",
      "org\\model",
      "org/model/extra",
    ]) {
      await expect(
        adapter.storeGeneratedModel({
          sourceDirectory: source,
          outputModelName: "Demo",
          runId: "run-1",
          repository,
        }),
      ).rejects.toThrow("canonical owner/model syntax");
    }
    await expect(
      adapter.storeGeneratedModel({
        sourceDirectory: source,
        outputModelName: "Demo",
        runId: "../run",
        repository: "org/model",
      }),
    ).rejects.toThrow("run identifier is invalid");
  });

  it("rejects oversized generated model source trees", async () => {
    const root = join(tmpdir(), `generated-model-storage-source-${Date.now()}`);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "model.bin"), "outside", "utf8");
    const adapter = createLocalGeneratedModelStorageAdapter({
      env: { HF_HUB_CACHE: join(root, "cache") },
      homeDirectory: root,
      maximumSourceBytes: 4,
    });

    await expect(
      adapter.storeGeneratedModel({
        sourceDirectory: source,
        outputModelName: "Demo",
        runId: "run-1",
        repository: "org/model",
      }),
    ).rejects.toThrow("exceeds storage limits");
  });

  it("rejects linked generated model source trees when links are available", async (context) => {
    const root = join(tmpdir(), `generated-model-storage-link-${Date.now()}`);
    const source = join(root, "source");
    const outside = join(root, "outside.bin");
    await mkdir(source, { recursive: true });
    await writeFile(outside, "outside", "utf8");
    try {
      await symlink(outside, join(source, "linked.bin"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip(
          "This Windows host does not permit creating test symlinks.",
        );
        return;
      }
      throw error;
    }
    const adapter = createLocalGeneratedModelStorageAdapter({
      env: { HF_HUB_CACHE: join(root, "cache") },
      homeDirectory: root,
    });

    await expect(
      adapter.storeGeneratedModel({
        sourceDirectory: source,
        outputModelName: "Demo",
        runId: "run-1",
        repository: "org/model",
      }),
    ).rejects.toThrow("cannot contain links");
  });
});
