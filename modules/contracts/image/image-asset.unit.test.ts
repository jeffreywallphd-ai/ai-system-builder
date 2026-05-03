import { describe, expect, it } from "../../testing/node-test";

import type { ImageAsset } from ".";

describe("image asset contract", () => {
  it("defines the expected shape", () => {
    const asset: ImageAsset = {
      assetId: "asset-1",
      artifactId: "artifact-1",
      source: "generated",
      metadata: {
        prompt: "cinematic portrait",
        negativePrompt: "low quality",
        seed: 42,
        model: "sdxl-base",
        engine: "local-runtime",
        workflowTemplateId: "portrait-v1",
        width: 1024,
        height: 1024,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    };

    expect(asset.assetId).toBe("asset-1");
    expect(asset.metadata.createdAt).toBe("2026-04-30T00:00:00.000Z");
  });

  it("allows optional metadata fields to be omitted", () => {
    const asset: ImageAsset = {
      assetId: "asset-2",
      artifactId: "artifact-2",
      source: "uploaded",
      metadata: {
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    };

    expect(asset.source).toBe("uploaded");
    expect(asset.metadata.prompt).toBeUndefined();
  });
});
