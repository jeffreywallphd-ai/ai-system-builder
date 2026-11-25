import fileOperations, { lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { after, describe, expect, it } from "../../../../testing/node-test";
import { createLocalModelCheckpointResolverAdapter } from "../createLocalModelCheckpointResolverAdapter";

const ownedDirectories: {path: string; boundary: string; ino: bigint; dev: bigint}[] = [];
async function tempDir(prefix: string) {
  const boundary = await realpath(tmpdir());
  const path = await mkdtemp(join(boundary, prefix));
  const original = await lstat(path, {bigint: true});
  ownedDirectories.push({path, boundary, ino: original.ino, dev: original.dev});
  return path;
}
after(async () => {
  for (const owned of ownedDirectories.reverse()) {
    const current = await lstat(owned.path, {bigint: true});
    if (dirname(owned.path) !== owned.boundary || await realpath(owned.path) !== owned.path ||
        !current.isDirectory() || current.isSymbolicLink() || owned.ino === 0n ||
        current.ino !== owned.ino || current.dev !== owned.dev)
      throw new Error("The checkpoint resolver test no longer owns its fixture root.");
    await rm(owned.path, {recursive: true});
  }
});

function registryWith(record: Record<string, unknown>) {
  return { listModels: async () => ({ models: [record] }) } as never;
}

describe("createLocalModelCheckpointResolverAdapter", () => {
  it("resolves by modelId and syncs safetensors into ComfyUI checkpoint directory", async () => {
    const modelDir = await tempDir("model-safe-");
    const comfyDir = await tempDir("comfy-safe-");
    await writeFile(join(modelDir, "model.safetensors"), "x");
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "m1", displayName: "sdxl", modelId: "org/sdxl", localPath: modelDir, provider: "huggingface", source: "huggingface" }), comfyUiCheckpointDirectory: comfyDir });
    expect(await adapter.resolveCheckpoint({ selectedModel: "org/sdxl" })).toEqual({ checkpoint: "model.safetensors" });
    expect(await readFile(join(comfyDir, "model.safetensors"), "utf8")).toBe("x");
  });

  it("resolves single ckpt", async () => {
    const modelDir = await tempDir("model-ckpt-");
    await writeFile(join(modelDir, "model.ckpt"), "x");
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "m1", displayName: "sdxl", modelId: "org/sdxl", localPath: modelDir, provider: "huggingface", source: "huggingface" }) });
    expect(await adapter.resolveCheckpoint({ selectedModel: "org/sdxl" })).toEqual({ checkpoint: "model.ckpt" });
  });

  it("prefers safetensors over ckpt and uses lexical tie-breaker", async () => {
    const modelDir = await tempDir("model-both-");
    await writeFile(join(modelDir, "z.ckpt"), "x");
    await writeFile(join(modelDir, "b.safetensors"), "x");
    await writeFile(join(modelDir, "a.safetensors"), "x");
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "m1", displayName: "sdxl", modelId: "org/sdxl", localPath: modelDir, provider: "huggingface", source: "huggingface" }) });
    expect(await adapter.resolveCheckpoint({ selectedModel: "org/sdxl" })).toEqual({ checkpoint: "a.safetensors" });
  });

  it("matches inventory record by modelRecordId", async () => {
    const modelDir = await tempDir("model-id-");
    await writeFile(join(modelDir, "model.safetensors"), "x");
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "rec-123", displayName: "sdxl", modelId: "org/sdxl", localPath: modelDir, provider: "huggingface", source: "huggingface" }) });
    expect(await adapter.resolveCheckpoint({ selectedModel: "rec-123" })).toEqual({ checkpoint: "model.safetensors" });
  });

  it("returns checkpoint filename directly when already valid", async () => {
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({}) });
    expect(await adapter.resolveCheckpoint({ selectedModel: "foo.safetensors" })).toEqual({ checkpoint: "foo.safetensors" });
  });

  it("fails for no matching record", async () => {
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: { listModels: async () => ({ models: [] }) } as never });
    await expect(adapter.resolveCheckpoint({ selectedModel: "missing/model" })).rejects.toThrow("No matching downloaded model record");
  });

  it("fails when record has no localPath", async () => {
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "m1", displayName: "sdxl", modelId: "org/sdxl", provider: "huggingface", source: "huggingface" }) });
    await expect(adapter.resolveCheckpoint({ selectedModel: "org/sdxl" })).rejects.toThrow("No local model folder is recorded");
  });

  it("fails when local folder missing", async () => {
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "m1", displayName: "sdxl", modelId: "org/sdxl", localPath: "/no/such/path", provider: "huggingface", source: "huggingface" }) });
    await expect(adapter.resolveCheckpoint({ selectedModel: "org/sdxl" })).rejects.toThrow("Local folder checked");
  });

  it("scans only direct model folder files (storage convention)", async () => {
    const modelDir = await tempDir("model-nested-");
    await mkdir(join(modelDir, "nested"));
    await writeFile(join(modelDir, "nested", "hidden.safetensors"), "x");
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "m1", displayName: "sdxl", modelId: "org/sdxl", localPath: modelDir, provider: "huggingface", source: "huggingface" }) });
    await expect(adapter.resolveCheckpoint({ selectedModel: "org/sdxl" })).rejects.toThrow("not currently usable as a ComfyUI checkpoint");
  });
  it("preserves checkpoints created during copy races and selects the next free suffix", async () => {
    const modelDir = await tempDir("model-race-");
    const comfyDir = await tempDir("comfy-race-");
    await writeFile(join(modelDir, "model.safetensors"), "selected synthetic checkpoint");
    const adapter = createLocalModelCheckpointResolverAdapter({
      modelRegistry: registryWith({modelRecordId: "race-model", localPath: modelDir}),
      comfyUiCheckpointDirectory: comfyDir,
    });
    const copy = fileOperations.copyFile;
    const targets: string[] = [];
    const copyHook = mock.method(fileOperations, "copyFile", async (...args: Parameters<typeof copy>) => {
      const target = args[1];
      if (typeof target !== "string") throw new Error("Expected a synthetic local checkpoint target.");
      targets.push(target);
      if (targets.length <= 2) await writeFile(target, "existing synthetic checkpoint " + targets.length, {flag: "wx"});
      return copy(...args);
    });
    syncBuiltinESMExports();
    try {
      expect(await adapter.resolveCheckpoint({selectedModel: "race-model"})).toEqual({checkpoint: "model-02.safetensors"});
      expect(targets.length).toBe(3);
      expect(await readFile(join(comfyDir, "model.safetensors"), "utf8")).toBe("existing synthetic checkpoint 1");
      expect(await readFile(join(comfyDir, "model-01.safetensors"), "utf8")).toBe("existing synthetic checkpoint 2");
      expect(await readFile(join(comfyDir, "model-02.safetensors"), "utf8")).toBe("selected synthetic checkpoint");
      expect(await readFile(join(modelDir, "model.safetensors"), "utf8")).toBe("selected synthetic checkpoint");
    } finally {copyHook.mock.restore(); syncBuiltinESMExports();}
  });

  it("preserves every racing checkpoint when the existing twenty-copy bound is exhausted", async () => {
    const modelDir = await tempDir("model-bound-");
    const comfyDir = await tempDir("comfy-bound-");
    await writeFile(join(modelDir, "model.safetensors"), "selected synthetic checkpoint");
    const adapter = createLocalModelCheckpointResolverAdapter({
      modelRegistry: registryWith({modelRecordId: "bounded-model", localPath: modelDir}),
      comfyUiCheckpointDirectory: comfyDir,
    });
    const copy = fileOperations.copyFile;
    const targets: string[] = [];
    const copyHook = mock.method(fileOperations, "copyFile", async (...args: Parameters<typeof copy>) => {
      const target = args[1];
      if (typeof target !== "string") throw new Error("Expected a synthetic local checkpoint target.");
      targets.push(target);
      await writeFile(target, "retained synthetic collision " + targets.length, {flag: "wx"});
      return copy(...args);
    });
    syncBuiltinESMExports();
    try {
      await expect(adapter.resolveCheckpoint({selectedModel: "bounded-model"})).rejects.toThrow("after deterministic collision retries");
      expect(targets.length).toBe(20);
      for (let index = 0; index < targets.length; index++)
        expect(await readFile(targets[index], "utf8")).toBe("retained synthetic collision " + (index + 1));
    } finally {copyHook.mock.restore(); syncBuiltinESMExports();}
  });

  it("does not retry ordinary copy failures", async () => {
    const modelDir = await tempDir("model-copy-denied-");
    const comfyDir = await tempDir("comfy-copy-denied-");
    await writeFile(join(modelDir, "model.safetensors"), "selected synthetic checkpoint");
    const adapter = createLocalModelCheckpointResolverAdapter({
      modelRegistry: registryWith({modelRecordId: "denied-model", localPath: modelDir}),
      comfyUiCheckpointDirectory: comfyDir,
    });
    let calls = 0;
    const copyHook = mock.method(fileOperations, "copyFile", async () => {
      calls++;
      throw Object.assign(new Error("synthetic copy permission failure"), {code: "EACCES"});
    });
    syncBuiltinESMExports();
    try {
      await expect(adapter.resolveCheckpoint({selectedModel: "denied-model"})).rejects.toThrow("synthetic copy permission failure");
      expect(calls).toBe(1);
    } finally {copyHook.mock.restore(); syncBuiltinESMExports();}
  });

  it("keeps the existing already-present checkpoint cache behavior", async () => {
    const modelDir = await tempDir("model-present-");
    const comfyDir = await tempDir("comfy-present-");
    await writeFile(join(modelDir, "model.safetensors"), "same synthetic checkpoint");
    await writeFile(join(comfyDir, "model.safetensors"), "same synthetic checkpoint");
    const adapter = createLocalModelCheckpointResolverAdapter({
      modelRegistry: registryWith({modelRecordId: "present-model", localPath: modelDir}),
      comfyUiCheckpointDirectory: comfyDir,
    });
    expect(await adapter.resolveCheckpoint({selectedModel: "present-model"})).toEqual({checkpoint: "model.safetensors"});
    expect(await readFile(join(comfyDir, "model.safetensors"), "utf8")).toBe("same synthetic checkpoint");
  });
});
