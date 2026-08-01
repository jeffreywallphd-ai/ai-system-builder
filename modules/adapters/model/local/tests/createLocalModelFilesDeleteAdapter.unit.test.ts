import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";
import { createLocalModelFilesDeleteAdapter } from "../createLocalModelFilesDeleteAdapter";

describe("createLocalModelFilesDeleteAdapter", () => {
  it("deletes the complete Hugging Face cache repository for a model snapshot", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "model-delete-"));
    try {
      const approvedRoot = join(temporaryRoot, "cache");
      const repositoryRoot = join(
        approvedRoot,
        "huggingface",
        "hub",
        "models--org--demo",
      );
      const snapshotRoot = join(repositoryRoot, "snapshots", "revision-1");
      const unrelatedRoot = join(approvedRoot, "unrelated");
      await mkdir(join(repositoryRoot, "blobs"), { recursive: true });
      await mkdir(snapshotRoot, { recursive: true });
      await mkdir(unrelatedRoot, { recursive: true });
      await writeFile(join(repositoryRoot, "blobs", "weights"), "weights");
      await writeFile(join(snapshotRoot, "config.json"), "{}");

      const adapter = createLocalModelFilesDeleteAdapter({
        approvedRoots: async () => [approvedRoot],
      });
      const result = await adapter.deleteLocalModelFiles({
        localPath: snapshotRoot,
      });

      expect(result).toEqual({ deleted: true });
      await expect(access(repositoryRoot)).rejects.toThrow();
      await expect(access(unrelatedRoot)).resolves.toBeUndefined();
      await expect(access(approvedRoot)).resolves.toBeUndefined();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("deletes only the selected checkpoint when discovery records the shared root", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "model-delete-"));
    try {
      const approvedRoot = join(temporaryRoot, "models");
      await mkdir(approvedRoot, { recursive: true });
      await writeFile(join(approvedRoot, "selected.safetensors"), "selected");
      await writeFile(join(approvedRoot, "keep.safetensors"), "keep");

      const adapter = createLocalModelFilesDeleteAdapter({
        approvedRoots: async () => [approvedRoot],
      });
      const result = await adapter.deleteLocalModelFiles({
        localPath: approvedRoot,
        relativeFilePath: "selected.safetensors",
      });

      expect(result).toEqual({ deleted: true });
      await expect(access(join(approvedRoot, "selected.safetensors"))).rejects.toThrow();
      await expect(access(join(approvedRoot, "keep.safetensors"))).resolves.toBeUndefined();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects outside-root, root, and traversal deletion targets without removing them", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "model-delete-"));
    try {
      const approvedRoot = join(temporaryRoot, "approved");
      const outsideRoot = join(temporaryRoot, "outside");
      await mkdir(approvedRoot, { recursive: true });
      await mkdir(outsideRoot, { recursive: true });
      await writeFile(join(outsideRoot, "model.bin"), "outside");

      const adapter = createLocalModelFilesDeleteAdapter({
        approvedRoots: async () => [approvedRoot],
      });

      await expect(adapter.deleteLocalModelFiles({
        localPath: outsideRoot,
      })).rejects.toThrow("outside the approved cache roots");
      await expect(adapter.deleteLocalModelFiles({
        localPath: approvedRoot,
      })).rejects.toThrow("outside the approved cache roots");
      await expect(adapter.deleteLocalModelFiles({
        localPath: approvedRoot,
        relativeFilePath: join("..", "outside", "model.bin"),
      })).rejects.toThrow("escaped its model directory");

      await expect(access(outsideRoot)).resolves.toBeUndefined();
      await expect(access(approvedRoot)).resolves.toBeUndefined();
      await expect(access(join(outsideRoot, "model.bin"))).resolves.toBeUndefined();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
