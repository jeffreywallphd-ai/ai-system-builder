import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "../../../../testing/node-test";
import { createLocalImageAssetRegistryAdapter } from "../createLocalImageAssetRegistryAdapter";

describe("createLocalImageAssetRegistryAdapter", () => {
  it("preserves generation metadata fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-reg-"));
    const filePath = path.join(root, "image-assets.json");
    const adapter = createLocalImageAssetRegistryAdapter({ filePath, now: () => "2026-05-01T00:00:00.000Z" });
    await adapter.registerImageAsset({ workspaceId: "workspace-a" as never, assetId: "asset-1", artifactId: "artifacts/x", source: "generated", metadata: { requestId: "req-1", originalFileName: "output_1.png", prompt: "cat", negativePrompt: "dog", seed: 7, model: "sdxl", engine: "comfyui", workflowTemplateId: "wf-1", width: 512, height: 512, createdAt: "2026-05-01T00:00:00.000Z" } });
    const asset = await adapter.getImageAsset("workspace-a" as never, "asset-1");
    assert.equal(asset?.source, "generated");
    assert.deepEqual(asset?.metadata, { requestId: "req-1", originalFileName: "output_1.png", prompt: "cat", negativePrompt: "dog", seed: 7, model: "sdxl", engine: "comfyui", workflowTemplateId: "wf-1", width: 512, height: 512, createdAt: "2026-05-01T00:00:00.000Z" });
  });

  it("isolates image assets by workspace and rejects missing workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-reg-"));
    const adapter = createLocalImageAssetRegistryAdapter({ filePath: path.join(root, "image-assets.json") });
    await expect(adapter.registerImageAsset({ assetId: "missing", artifactId: "a", source: "generated" } as never)).rejects.toThrow(/Workspace id is required/);
    await adapter.registerImageAsset({ workspaceId: "workspace-a" as never, assetId: "asset-a", artifactId: "artifact-a", source: "generated" });
    await adapter.registerImageAsset({ workspaceId: "workspace-b" as never, assetId: "asset-b", artifactId: "artifact-b", source: "uploaded" });
    expect((await adapter.listImageAssetDescriptors({ workspaceId: "workspace-a" as never })).items.map((item) => item.assetId)).toEqual(["asset-a"]);
    assert.equal(await adapter.getImageAsset("workspace-b" as never, "asset-a"), null);
  });

  it("does not auto-migrate legacy global image records into workspace listings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-reg-"));
    const filePath = path.join(root, "image-assets.json");
    await writeFile(filePath, JSON.stringify({ assets: { legacy: { assetId: "legacy", artifactId: "artifact-legacy", source: "generated", metadata: { createdAt: "2026-01-01T00:00:00.000Z" } } } }), "utf8");
    const adapter = createLocalImageAssetRegistryAdapter({ filePath });
    assert.deepEqual((await adapter.listImageAssetDescriptors({ workspaceId: "workspace-a" as never })).items, []);
    assert.equal(await adapter.getImageAsset("workspace-a" as never, "legacy"), null);
  });
});
