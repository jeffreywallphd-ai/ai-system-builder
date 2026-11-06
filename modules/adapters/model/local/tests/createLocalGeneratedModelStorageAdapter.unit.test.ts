import { lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "../../../../testing/node-test";
import { createLocalGeneratedModelStorageAdapter } from "../createLocalGeneratedModelStorageAdapter";

describe("createLocalGeneratedModelStorageAdapter", () => {
  it("preserves observed existing snapshot directories and files instead of replacing them", async () => {
    for (const kind of ["directory", "file"] as const) {
      const root = await mkdtemp(join(tmpdir(), "generated-model-retained-"));
      const source = join(root, "source");
      const cache = join(root, "cache");
      const snapshots = join(cache, "models--org--model", "snapshots");
      const target = join(snapshots, "run-1");
      await mkdir(source); await mkdir(snapshots, { recursive: true });
      await writeFile(join(source, "model.safetensors"), "new synthetic bytes");
      if (kind === "directory") await mkdir(target);
      const retained = kind === "directory" ? join(target, "retained.txt") : target;
      await writeFile(retained, "retained synthetic bytes");
      const adapter = createLocalGeneratedModelStorageAdapter({ env: { HF_HUB_CACHE: cache } });
      await expect(adapter.storeGeneratedModel({ sourceDirectory: source, outputModelName: "Demo", repository: "org/model", runId: "run-1" })).rejects.toThrow("already exists");
      expect(await readFile(retained, "utf8")).toBe("retained synthetic bytes");
      expect((await readdir(snapshots)).filter((name) => name.startsWith(".stage-")).length).toBe(0);
    }
  });

  it("preserves one complete winner when independent publishers collide on this host", async () => {
    const root = await mkdtemp(join(tmpdir(), "generated-model-concurrent-"));
    const cache = join(root, "cache");
    const snapshots = join(cache, "models--org--model", "snapshots");
    await mkdir(snapshots, { recursive: true });
    const sources = [join(root, "first"), join(root, "second")];
    for (const [index, source] of sources.entries()) {
      await mkdir(source); await writeFile(join(source, "model.safetensors"), `synthetic-model-${index}`);
    }
    const results = await Promise.allSettled(sources.map((sourceDirectory) =>
      createLocalGeneratedModelStorageAdapter({ env: { HF_HUB_CACHE: cache } }).storeGeneratedModel({
        sourceDirectory, repository: "org/model", outputModelName: "Demo", runId: "run-1",
      })));
    expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
    const winner = results.findIndex((result) => result.status === "fulfilled");
    expect(await readFile(join(snapshots, "run-1", "model.safetensors"), "utf8")).toBe(`synthetic-model-${winner}`);
    expect((await readdir(snapshots)).filter((name) => name.startsWith(".stage-")).length).toBe(0);
  });

  it("rejects a linked requested source root before following it", async (context) => {
    const root = await mkdtemp(join(tmpdir(), "generated-model-root-link-"));
    const source = join(root, "source"); const linked = join(root, "linked");
    await mkdir(source); await writeFile(join(source, "model.safetensors"), "synthetic source");
    try { await symlink(source, linked, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") { context.skip("Source-root link fixture privilege is unavailable."); return; }
      throw error;
    }
    const adapter = createLocalGeneratedModelStorageAdapter({ env: { HF_HUB_CACHE: join(root, "cache") } });
    await expect(adapter.storeGeneratedModel({ sourceDirectory: linked, outputModelName: "Demo", runId: "run-1" })).rejects.toThrow("real directory");
    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(source, "model.safetensors"), "utf8")).toBe("synthetic source");
  });

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
