import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { TaskType, type RuntimeTaskRecord } from "../../../../contracts/runtime";
import type { GeneratedImagePersistencePort, ImageAssetRegistryPort } from "../../../ports/image";
import { FinalizeImageGenerationService } from "../finalize-image-generation.service";

function createTask(overrides: Partial<RuntimeTaskRecord> = {}): RuntimeTaskRecord { return { requestId: "req-1", workspaceId: "workspace-a" as never, taskType: TaskType.IMAGE_GENERATION, status: "succeeded", concurrencyClass: "unknown", data: { outputs: [{ type: "image", engine: "comfyui", fileName: "out.png", width: 512, height: 768, promptId: "p1", subfolder: "" }] }, metadata: { request: { prompt: "cat", model: "sdxl" } }, ...overrides }; }

describe("FinalizeImageGenerationService", () => {
  it("returns asset-backed results and registers generated image assets", async () => {
    const imageAssetRegistry: ImageAssetRegistryPort = { registerImageAsset: testDouble.fn(async () => ({ assetId: "asset-1" })), getImageAsset: testDouble.fn(async () => null) };
    const generatedImagePersistence: GeneratedImagePersistencePort = { persistGeneratedImage: testDouble.fn(async () => ({ artifactId: "artifacts/image-1", storageKey: "generated/images/artifacts_image-1.png", mediaType: "image/png", sizeBytes: 123, checksum: { algorithm: "sha256", value: "abc" }, originalFileName: "out.png" })) };
    const service = new FinalizeImageGenerationService({ imageAssetRegistry, generatedImagePersistence, createAssetId: () => "asset-1", now: () => "2026-05-01T00:00:00.000Z" });
    const result = await service.finalizeCompletedTask(createTask());
    expect(result).toEqual({ assets: [{ assetId: "asset-1", artifactId: "artifacts/image-1", storageKey: "generated/images/artifacts_image-1.png", mediaType: "image/png", source: "generated" }] });
    expect(imageAssetRegistry.registerImageAsset.mock.calls[0]?.[0]).toMatchObject({ source: "generated", metadata: { engine: "comfyui", requestId: "req-1", originalFileName: "out.png" } });
  });

  it("is idempotent", async () => {
    const imageAssetRegistry: ImageAssetRegistryPort = { registerImageAsset: testDouble.fn(async () => ({ assetId: "asset-1" })), getImageAsset: testDouble.fn(async () => null) };
    const generatedImagePersistence: GeneratedImagePersistencePort = { persistGeneratedImage: testDouble.fn(async () => ({ artifactId: "artifacts/image-1", storageKey: "generated/images/artifacts_image-1.png", mediaType: "image/png", sizeBytes: 123, checksum: { algorithm: "sha256", value: "abc" }, originalFileName: "out.png" })) };
    const service = new FinalizeImageGenerationService({ imageAssetRegistry, generatedImagePersistence });
    const task = createTask();
    await service.finalizeCompletedTask(task);
    await service.finalizeCompletedTask(task);
    expect(generatedImagePersistence.persistGeneratedImage).toHaveBeenCalledTimes(1);
  });

  it("rejects succeeded tasks with no generated image outputs", async () => {
    const imageAssetRegistry: ImageAssetRegistryPort = { registerImageAsset: testDouble.fn(async () => ({ assetId: "asset-1" })), getImageAsset: testDouble.fn(async () => null) };
    const generatedImagePersistence: GeneratedImagePersistencePort = { persistGeneratedImage: testDouble.fn(async () => ({ artifactId: "artifacts/image-1", storageKey: "generated/images/artifacts_image-1.png", mediaType: "image/png", sizeBytes: 123, checksum: { algorithm: "sha256", value: "abc" }, originalFileName: "out.png" })) };
    const service = new FinalizeImageGenerationService({ imageAssetRegistry, generatedImagePersistence });
    await expect(service.finalizeCompletedTask(createTask({ data: { outputs: [] } }))).rejects.toThrow("at least one generated image output");
    expect(generatedImagePersistence.persistGeneratedImage).not.toHaveBeenCalled();
  });
});
