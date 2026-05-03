import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";
import { createLocalImageAssetRegistryAdapter } from "../createLocalImageAssetRegistryAdapter";

describe("createLocalImageAssetRegistryAdapter", () => {
  it("persists generated image assets linked to artifact ids", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "image-assets-"));
    const registry = createLocalImageAssetRegistryAdapter({
      filePath: path.join(root, "image-assets.json"),
      now: () => "2026-05-01T00:00:00.000Z",
    });

    await registry.registerImageAsset({
      assetId: "asset-1",
      artifactId: "generated/images/asset-1/x.png",
      source: "generated",
      metadata: { prompt: "cat", engine: "comfyui" },
    });

    expect(await registry.getImageAsset("asset-1")).toMatchObject({
      assetId: "asset-1",
      artifactId: "generated/images/asset-1/x.png",
      source: "generated",
      metadata: {
        createdAt: "2026-05-01T00:00:00.000Z",
        prompt: "cat",
        engine: "comfyui",
      },
    });
  });
});
