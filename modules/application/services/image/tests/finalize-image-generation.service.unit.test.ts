import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { TaskType, type RuntimeTaskRecord } from "../../../../contracts/runtime";
import type { GeneratedImagePersistencePort, ImageAssetRegistryPort } from "../../../ports/image";
import { FinalizeImageGenerationService } from "../finalize-image-generation.service";

function createTask(overrides: Partial<RuntimeTaskRecord> = {}): RuntimeTaskRecord {
  return {
    requestId: "req-1",
    taskType: TaskType.IMAGE_GENERATION,
    status: "succeeded",
    concurrencyClass: "unknown",
    data: { outputs: [{ type: "image", engine: "comfyui", fileName: "out.png", width: 512, height: 768, promptId: "p1", subfolder: "" }] },
    metadata: { request: { prompt: "cat", negativePrompt: "bad", seed: 7, model: "sdxl" } },
    ...overrides,
  };
}

describe("FinalizeImageGenerationService", () => {
  it("returns asset/artifact refs and source generated metadata", async () => {
    const imageAssetRegistry: ImageAssetRegistryPort = { registerImageAsset: testDouble.fn(async () => ({ assetId: "asset-1" })), getImageAsset: testDouble.fn(async () => null) };
    const generatedImagePersistence: GeneratedImagePersistencePort = { persistGeneratedImage: testDouble.fn(async () => ({ artifactId: "generated/images/asset-1/out.png", originalFileName: "out.png" })) };
    const service = new FinalizeImageGenerationService({ imageAssetRegistry, generatedImagePersistence, createAssetId: () => "asset-1", now: () => "2026-05-01T00:00:00.000Z" });
    const result = await service.finalizeCompletedTask(createTask());
    expect(result).toEqual({ assets: [{ assetId: "asset-1", artifactId: "generated/images/asset-1/out.png" }] });
    expect(generatedImagePersistence.persistGeneratedImage).toHaveBeenCalledWith({ output: { type: "image", engine: "comfyui", fileName: "out.png", subfolder: "", promptId: "p1", width: 512, height: 768 }, assetId: "asset-1" });
    expect(imageAssetRegistry.registerImageAsset).toHaveBeenCalledWith({
      assetId: "asset-1",
      artifactId: "generated/images/asset-1/out.png",
      source: "generated",
    });
  });

  it("is idempotent", async () => {
    const imageAssetRegistry: ImageAssetRegistryPort = { registerImageAsset: testDouble.fn(async () => ({ assetId: "asset-1" })), getImageAsset: testDouble.fn(async () => null) };
    const generatedImagePersistence: GeneratedImagePersistencePort = { persistGeneratedImage: testDouble.fn(async () => ({ artifactId: "generated/images/asset-1/out.png", originalFileName: "out.png" })) };
    const service = new FinalizeImageGenerationService({ imageAssetRegistry, generatedImagePersistence });
    const task = createTask();
    await service.finalizeCompletedTask(task);
    await service.finalizeCompletedTask(task);
    expect(generatedImagePersistence.persistGeneratedImage).toHaveBeenCalledTimes(1);
  });
});
