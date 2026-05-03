import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";
import { createLocalModelCheckpointResolverAdapter } from "../createLocalModelCheckpointResolverAdapter";

async function tempDir(prefix: string) { return mkdtemp(join(tmpdir(), prefix)); }

function registryWith(record: Record<string, unknown>) {
  return { listModels: async () => ({ models: [record] }) } as never;
}

describe("createLocalModelCheckpointResolverAdapter", () => {
  it("resolves by modelId and syncs safetensors into ComfyUI checkpoint directory", async () => {
    const modelDir = await tempDir("model-safe-");
    const comfyDir = await tempDir("comfy-safe-");
    await writeFile(join(modelDir, "model.safetensors"), "x");
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "m1", displayName: "sdxl", modelId: "org/sdxl", localPath: modelDir, provider: "huggingface", source: "huggingface" }), comfyUiCheckpointDirectory: comfyDir });
    await expect(adapter.resolveCheckpoint({ selectedModel: "org/sdxl" })).resolves.toEqual({ checkpoint: "model.safetensors" });
    await expect(readFile(join(comfyDir, "model.safetensors"), "utf8")).resolves.toBe("x");
  });

  it("resolves single ckpt", async () => {
    const modelDir = await tempDir("model-ckpt-");
    await writeFile(join(modelDir, "model.ckpt"), "x");
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "m1", displayName: "sdxl", modelId: "org/sdxl", localPath: modelDir, provider: "huggingface", source: "huggingface" }) });
    await expect(adapter.resolveCheckpoint({ selectedModel: "org/sdxl" })).resolves.toEqual({ checkpoint: "model.ckpt" });
  });

  it("prefers safetensors over ckpt and uses lexical tie-breaker", async () => {
    const modelDir = await tempDir("model-both-");
    await writeFile(join(modelDir, "z.ckpt"), "x");
    await writeFile(join(modelDir, "b.safetensors"), "x");
    await writeFile(join(modelDir, "a.safetensors"), "x");
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "m1", displayName: "sdxl", modelId: "org/sdxl", localPath: modelDir, provider: "huggingface", source: "huggingface" }) });
    await expect(adapter.resolveCheckpoint({ selectedModel: "org/sdxl" })).resolves.toEqual({ checkpoint: "a.safetensors" });
  });

  it("matches inventory record by modelRecordId", async () => {
    const modelDir = await tempDir("model-id-");
    await writeFile(join(modelDir, "model.safetensors"), "x");
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({ modelRecordId: "rec-123", displayName: "sdxl", modelId: "org/sdxl", localPath: modelDir, provider: "huggingface", source: "huggingface" }) });
    await expect(adapter.resolveCheckpoint({ selectedModel: "rec-123" })).resolves.toEqual({ checkpoint: "model.safetensors" });
  });

  it("returns checkpoint filename directly when already valid", async () => {
    const adapter = createLocalModelCheckpointResolverAdapter({ modelRegistry: registryWith({}) });
    await expect(adapter.resolveCheckpoint({ selectedModel: "foo.safetensors" })).resolves.toEqual({ checkpoint: "foo.safetensors" });
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
});
