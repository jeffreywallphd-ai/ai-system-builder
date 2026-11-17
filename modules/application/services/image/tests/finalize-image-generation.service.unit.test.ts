import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalImageAssetRegistryAdapter } from "../../../../adapters/persistence/image/createLocalImageAssetRegistryAdapter";
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

function retryHarness() {
  const persistGeneratedImage = testDouble.fn(async (input: any) => ({ artifactId: `artifact/${input.output.fileName}`, storageKey: `generated/${input.output.fileName}`, mediaType: "image/png", sizeBytes: 1, checksum: { algorithm: "sha256", value: "abc" }, originalFileName: input.output.fileName }));
  const registerImageAsset = testDouble.fn(async (input: any) => ({ assetId: input.assetId }));
  let organizationId = "org-a";
  const service = new FinalizeImageGenerationService({ generatedImagePersistence: { persistGeneratedImage }, imageAssetRegistry: { registerImageAsset, getImageAsset: async () => null }, organizationContextProvider: { getCurrentOrganizationContext: () => organizationId ? { organizationId, principalId: "principal-a" } : undefined } } as never);
  return { service, persistGeneratedImage, registerImageAsset, setOrganization: (id: string) => { organizationId = id; } };
}

it("serializes concurrent writes and protects retained receipts from caller mutation", async () => {
  const h = retryHarness();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  h.persistGeneratedImage.mockImplementationOnce(async () => { await barrier; return { artifactId: "a", storageKey: "s", mediaType: "image/png", originalFileName: "x.png" }; });
  const first = h.service.finalizeCompletedTask(createTask());
  const second = h.service.finalizeCompletedTask(createTask());
  release();
  const [a, b] = await Promise.all([first, second]);
  a.assets[0]!.artifactId = "changed";
  expect(b.assets[0]!.artifactId).toBe("a");
  expect((await h.service.finalizeCompletedTask(createTask())).assets[0]!.artifactId).toBe("a");
  expect(h.persistGeneratedImage).toHaveBeenCalledTimes(1);
  expect(h.registerImageAsset).toHaveBeenCalledTimes(1);
});

it("retries only unfinished registration after a partial multi-output failure", async () => {
  const h = retryHarness();
  const task = createTask({ data: { outputs: [{ type: "image", engine: "comfyui", fileName: "one.png" }, { type: "image", engine: "comfyui", fileName: "two.png" }] } });
  let attempts = 0;
  h.registerImageAsset.mockImplementation(async (input: any) => { if (++attempts === 2) throw new Error("registration temporarily unavailable"); return { assetId: input.assetId }; });
  await expect(h.service.finalizeCompletedTask(task)).rejects.toThrow("temporarily unavailable");
  const result = await h.service.finalizeCompletedTask(task);
  expect(result.assets.length).toBe(2);
  expect(h.persistGeneratedImage).toHaveBeenCalledTimes(2);
  expect(h.registerImageAsset).toHaveBeenCalledTimes(3);
  expect(h.registerImageAsset.mock.calls[1][0].assetId).toBe(h.registerImageAsset.mock.calls[2][0].assetId);
  await expect(h.service.finalizeCompletedTask(createTask())).rejects.toThrow("changed after finalization");
});

it("validates status and organization before cache reuse and isolates equal request IDs", async () => {
  const h = retryHarness();
  await h.service.finalizeCompletedTask(createTask());
  await expect(h.service.finalizeCompletedTask(createTask({ status: "running" }))).rejects.toThrow("succeeded");
  h.setOrganization("");
  await expect(h.service.finalizeCompletedTask(createTask())).rejects.toThrow("Organization request context");
  h.setOrganization("org-b");
  await h.service.finalizeCompletedTask(createTask());
  await h.service.finalizeCompletedTask(createTask({ workspaceId: "workspace-b" as never }));
  expect(h.persistGeneratedImage).toHaveBeenCalledTimes(3);
});

it("equal request IDs remain distinct in the actual image registry across workspaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "image-finalize-scope-"));
  try {
    const registry = createLocalImageAssetRegistryAdapter({ filePath: join(root, "image-assets.json") });
    const h = retryHarness();
    const service = new FinalizeImageGenerationService({ imageAssetRegistry: registry, generatedImagePersistence: { persistGeneratedImage: h.persistGeneratedImage } });
    const a = await service.finalizeCompletedTask(createTask());
    const b = await service.finalizeCompletedTask(createTask({ workspaceId: "workspace-b" as never }));
    expect(a.assets[0]!.assetId === b.assets[0]!.assetId).toBe(false);
    expect((await registry.getImageAsset("workspace-a" as never, a.assets[0]!.assetId))?.assetId).toBe(a.assets[0]!.assetId);
    expect((await registry.getImageAsset("workspace-b" as never, b.assets[0]!.assetId))?.assetId).toBe(b.assets[0]!.assetId);
  } finally { await rm(root, { recursive: true, force: true }); }
});
