import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
});
