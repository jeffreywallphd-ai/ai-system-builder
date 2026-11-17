import assert from "node:assert/strict";
import type { Dir, Stats } from "node:fs";
import fileOperations, { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";
import { mock } from "node:test";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "../../../../testing/node-test";
import { createLocalModelFileListerAdapter } from "../createLocalModelFileListerAdapter";

const cleanupDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("createLocalModelFileListerAdapter", () => {
  it("returns bounded relative file names and sizes", async () => {
    const root = await mkdtemp(join(tmpdir(), "model-files-"));
    cleanupDirectories.push(root);
    const modelDirectory = join(root, "model-1");
    await mkdir(join(modelDirectory, "tokenizer"), { recursive: true });
    await writeFile(join(modelDirectory, "config.json"), "{}", "utf8");
    await writeFile(join(modelDirectory, "tokenizer", "vocab.json"), "1234", "utf8");
    const adapter = createLocalModelFileListerAdapter({ allowedRootDirectories: [root] });

    await expect(adapter.listFiles(modelDirectory)).resolves.toEqual({
      files: [
        { relativePath: "config.json", sizeBytes: 2 },
        { relativePath: "tokenizer/vocab.json", sizeBytes: 4 },
      ],
      truncated: false,
    });
  });

  it("rejects a stored path outside configured model roots", async () => {
    const allowedRoot = await mkdtemp(join(tmpdir(), "model-files-allowed-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "model-files-outside-"));
    cleanupDirectories.push(allowedRoot, outsideRoot);
    const adapter = createLocalModelFileListerAdapter({ allowedRootDirectories: [allowedRoot] });

    await expect(adapter.listFiles(outsideRoot)).rejects.toThrow("outside the configured model roots");
  });

  it("reads only the shared entry allowance and closes the directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "model-files-bounded-"));
    cleanupDirectories.push(root);
    const canonicalRoot = await realpath(root);
    let remaining = 2_001;
    const read = mock.fn(async () => {
      assert.ok(remaining > 0, "The directory reader exceeded its bounded lookahead.");
      return { name: `entry-${remaining--}` };
    });
    const close = mock.fn(async () => undefined);
    const open = mock.method(fileOperations, "opendir", async (directory: string, options: unknown) => {
      assert.equal(directory, canonicalRoot);
      assert.deepEqual(options, { bufferSize: 1 });
      return { read, close } as unknown as Dir;
    });
    const inspect = mock.method(fileOperations, "lstat", async (entry: string) => {
      assert.equal(dirname(entry), canonicalRoot);
      assert.notEqual(basename(entry), "entry-1", "The lookahead must only signal truncation.");
      return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false } as Stats;
    });
    syncBuiltinESMExports();
    try {
      const adapter = createLocalModelFileListerAdapter({ allowedRootDirectories: [root] });
      await expect(adapter.listFiles(root)).resolves.toEqual({ files: [], truncated: true });
      assert.equal(open.mock.callCount(), 1);
      assert.equal(read.mock.callCount(), 2_001);
      assert.equal(inspect.mock.callCount(), 2_000);
      assert.equal(close.mock.callCount(), 1);
    } finally {
      inspect.mock.restore();
      open.mock.restore();
      syncBuiltinESMExports();
    }
  });

  it("shares the entry allowance across a root and its child", async () => {
    const root = await mkdtemp(join(tmpdir(), "model-files-nested-budget-"));
    cleanupDirectories.push(root);
    const canonicalRoot = await realpath(root);
    const child = join(canonicalRoot, "child");
    await mkdir(child);
    let parentIndex = 0;
    const readRoot = mock.fn(async () => {
      if (parentIndex === 1_999) return null;
      const index = parentIndex++;
      return { name: index === 0 ? "child" : "entry-" + index };
    });
    let childIndex = 0;
    const readChild = mock.fn(async () => {
      assert.ok(childIndex < 2, "The child must inherit the last entry allowance.");
      return { name: childIndex++ === 0 ? "candidate" : "lookahead" };
    });
    const closeRoot = mock.fn(async () => undefined);
    const closeChild = mock.fn(async () => undefined);
    const open = mock.method(fileOperations, "opendir", async (directory: string, options: unknown) => {
      assert.deepEqual(options, { bufferSize: 1 });
      assert.ok(directory === canonicalRoot || directory === child);
      return (directory === canonicalRoot ? { read: readRoot, close: closeRoot } : {
        read: readChild, close: closeChild,
      }) as unknown as Dir;
    });
    const inspect = mock.method(fileOperations, "lstat", async (entry: string) => {
      assert.notEqual(entry, join(child, "lookahead"));
      return { isSymbolicLink: () => false, isDirectory: () => entry === child, isFile: () => false } as Stats;
    });
    syncBuiltinESMExports();
    try {
      const adapter = createLocalModelFileListerAdapter({ allowedRootDirectories: [root] });
      await expect(adapter.listFiles(root)).resolves.toEqual({ files: [], truncated: true });
      assert.equal(open.mock.callCount(), 2);
      assert.equal(readRoot.mock.callCount(), 2_000);
      assert.equal(readChild.mock.callCount(), 2);
      assert.equal(inspect.mock.callCount(), 2_000);
      assert.equal(closeRoot.mock.callCount(), 1);
      assert.equal(closeChild.mock.callCount(), 1);
    } finally {
      inspect.mock.restore();
      open.mock.restore();
      syncBuiltinESMExports();
    }
  });

  it("closes a directory when an entry read fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "model-files-read-failure-"));
    cleanupDirectories.push(root);
    const close = mock.fn(async () => undefined);
    const open = mock.method(fileOperations, "opendir", async () => ({
      async read() { throw new Error("Synthetic entry read failure."); },
      close,
    }) as unknown as Dir);
    syncBuiltinESMExports();
    try {
      const adapter = createLocalModelFileListerAdapter({ allowedRootDirectories: [root] });
      await expect(adapter.listFiles(root)).rejects.toThrow("Synthetic entry read failure.");
      assert.equal(close.mock.callCount(), 1);
    } finally {
      open.mock.restore();
      syncBuiltinESMExports();
    }
  });
});
