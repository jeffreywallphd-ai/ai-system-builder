import fileOperations, { appendFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mock } from "node:test";

import { describe, expect, it } from "../../../../testing/node-test";
import { createLocalGeneratedModelStorageAdapter } from "../createLocalGeneratedModelStorageAdapter";

async function withOwnedFixture(run: (root: string) => Promise<void>) {
  const boundary = await realpath(tmpdir());
  const root = await mkdtemp(join(boundary, "generated-model-budget-"));
  const original = await lstat(root, { bigint: true });
  try {
    await run(root);
  } finally {
    const current = await lstat(root, { bigint: true });
    if (dirname(root) !== boundary || await realpath(root) !== root || !current.isDirectory()
      || current.isSymbolicLink() || original.ino === 0n || current.ino !== original.ino
      || current.dev !== original.dev) {
      throw new Error("The generated model test no longer owns its fixture root.");
    }
    await rm(root, { recursive: true });
  }
}

describe("createLocalGeneratedModelStorageAdapter", () => {
  it("bounds directories separately from files and keeps a nested snapshot at both limits", async () => {
    await withOwnedFixture(async (root) => {
      const source = join(root, "source");
      const cache = join(root, "cache");
      const first = join(source, "nested");
      await mkdir(first, { recursive: true });
      await mkdir(join(source, "extra-empty"));
      await writeFile(join(first, "model.bin"), "x");
      const adapter = createLocalGeneratedModelStorageAdapter({
        env: { HF_HUB_CACHE: cache }, maximumSourceFiles: 1, maximumSourceBytes: 1,
      });
      const request = { sourceDirectory: source, outputModelName: "Demo", runId: "run-1" };

      await expect(adapter.storeGeneratedModel(request)).rejects.toThrow("exceeds storage limits");
      expect(await readdir(root)).toEqual(["source"]);

      const allowed = createLocalGeneratedModelStorageAdapter({
        env: { HF_HUB_CACHE: cache }, maximumSourceFiles: 2, maximumSourceBytes: 1,
      });
      const saved = await allowed.storeGeneratedModel(request);
      expect(await readFile(join(saved.localPath, "nested", "model.bin"), "utf8")).toBe("x");
      expect(await readdir(join(saved.localPath, "extra-empty"))).toEqual([]);
    });
  });

  it("refuses excessive nesting before creating cache storage", async () => {
    await withOwnedFixture(async (root) => {
      const source = join(root, "s");
      await mkdir(join(source, ...Array<string>(65).fill("d")), { recursive: true });
      const adapter = createLocalGeneratedModelStorageAdapter({ env: { HF_HUB_CACHE: join(root, "cache") } });

      await expect(adapter.storeGeneratedModel({ sourceDirectory: source, outputModelName: "Demo", runId: "run-1" }))
        .rejects.toThrow("exceeds storage limits");
      expect(await readdir(root)).toEqual(["s"]);
    });
  });

  it("rejects nonfinite generated model storage limits", () => {
    for (const option of ["maximumSourceFiles", "maximumSourceBytes"] as const) {
      for (const limit of [NaN, Infinity, -Infinity]) {
        expect(() => createLocalGeneratedModelStorageAdapter({ [option]: limit }))
          .toThrow("storage limits must be finite");
      }
    }
  });

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

  it("copies a file at the exact byte limit alongside an empty file", async () => {
    await withOwnedFixture(async (root) => {
      const source = join(root, "source");
      await mkdir(source);
      const content = Buffer.alloc(300_000, 0xa5);
      await writeFile(join(source, "model.bin"), content);
      await writeFile(join(source, "empty.txt"), "");
      const adapter = createLocalGeneratedModelStorageAdapter({
        env: { HF_HUB_CACHE: join(root, "cache") }, maximumSourceBytes: content.length,
      });

      const result = await adapter.storeGeneratedModel({ sourceDirectory: source, outputModelName: "Demo", runId: "run-1" });
      expect((await readFile(join(result.localPath, "model.bin"))).equals(content)).toBe(true);
      expect((await lstat(join(result.localPath, "empty.txt"))).size).toBe(0);
    });
  });

  it("never reads additional bytes if the open source grows during copying", async () => {
    await withOwnedFixture(async (root) => {
      const source = join(root, "source");
      const cache = join(root, "cache");
      const file = join(source, "model.bin");
      await mkdir(source);
      await writeFile(file, "model");
      const openFile = open;
      const reads: number[] = [];
      const opening = mock.method(fileOperations, "open", async (...args: Parameters<typeof openFile>) => {
        const handle = await openFile(...args);
        if (args[0] === file) {
          const read = handle.read.bind(handle);
          mock.method(handle, "read", async (buffer: Buffer, offset: number, length: number, position: number | null) => {
            reads.push(length);
            await appendFile(file, "extra");
            return read(buffer, offset, length, position);
          });
        }
        return handle;
      });
      syncBuiltinESMExports();
      try {
        const adapter = createLocalGeneratedModelStorageAdapter({ env: { HF_HUB_CACHE: cache }, maximumSourceBytes: 5 });
        await expect(adapter.storeGeneratedModel({ sourceDirectory: source, outputModelName: "Demo", runId: "run-1" }))
          .rejects.toThrow("changed while being staged");
      } finally {
        opening.mock.restore();
        syncBuiltinESMExports();
      }
      expect(reads).toEqual([5]);
      expect(await readFile(file, "utf8")).toBe("modelextra");
      expect(await readdir(join(cache, "models--generated--Demo", "snapshots"))).toEqual([]);
    });
  });

  it("rejects an unexpected source handle before reading or writing model bytes", async () => {
    await withOwnedFixture(async (root) => {
      const source = join(root, "source");
      const cache = join(root, "cache");
      const file = join(source, "model.bin");
      const other = join(root, "other.bin");
      await mkdir(source);
      await writeFile(file, "model");
      await writeFile(other, "other");
      const openFile = open;
      let readAttempts = 0;
      const opening = mock.method(fileOperations, "open", async (...args: Parameters<typeof openFile>) => {
        if (args[0] !== file) return openFile(...args);
        const handle = await openFile(other, args[1]);
        mock.method(handle, "read", () => {
          readAttempts += 1;
          throw new Error("Substituted content must not be read.");
        });
        return handle;
      });
      syncBuiltinESMExports();
      try {
        const adapter = createLocalGeneratedModelStorageAdapter({ env: { HF_HUB_CACHE: cache } });
        await expect(adapter.storeGeneratedModel({ sourceDirectory: source, outputModelName: "Demo", runId: "run-1" }))
          .rejects.toThrow("changed while being staged");
      } finally {
        opening.mock.restore();
        syncBuiltinESMExports();
      }
      expect(readAttempts).toBe(0);
      expect(await readdir(join(cache, "models--generated--Demo", "snapshots"))).toEqual([]);
    });
  });

  it("rejects a linked child of a generated model source before cache creation", async (context) => {
    await withOwnedFixture(async (root) => {
      const source = join(root, "source");
      const outside = join(root, "outside");
      const model = join(outside, "model.bin");
      await mkdir(source);
      await mkdir(outside);
      await writeFile(model, "outside", "utf8");
      try {
        if (process.platform === "win32") {
          await symlink(outside, join(source, "linked"), "junction");
        } else {
          await symlink(model, join(source, "linked.bin"));
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          context.skip("Creating the child link fixture requires local link support.");
          return;
        }
        throw error;
      }
      const adapter = createLocalGeneratedModelStorageAdapter({ env: { HF_HUB_CACHE: join(root, "cache") } });
      await expect(
        adapter.storeGeneratedModel({ sourceDirectory: source, outputModelName: "Demo", runId: "run-1" }),
      ).rejects.toThrow("cannot contain links");
      expect((await readdir(root)).sort()).toEqual(["outside", "source"]);
      expect(await readFile(model, "utf8")).toBe("outside");
    });
  });
});
