import { readFile } from "node:fs/promises";

import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import type { ImageGenerationRequest } from "../../../../contracts/image-generation";
import { TaskType } from "../../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../../ports/runtime";
import { GenerateImageUseCase } from "../generate-image.use-case";

function createRuntimeTaskRegistryFake(): RuntimeTaskRegistryPort {
  return {
    startTask: testDouble.fn(async () => ({ requestId: "img-req-1", status: "queued", metadata: { engine: "comfyui" } })),
    getTaskStatus: testDouble.fn(async () => ({ requestId: "img-req-1", taskType: TaskType.IMAGE_GENERATION, status: "running", concurrencyClass: "unknown" })),
    cancelTask: testDouble.fn(async () => ({ requestId: "img-req-1", status: "cancelled", cancelled: true })),
    listTasks: testDouble.fn(async () => ({ tasks: [] })),
  };
}

describe("GenerateImageUseCase", () => {
  const validRequest: ImageGenerationRequest = { prompt: "cinematic portrait", width: 1024, height: 1024, steps: 28 };

  it("rejects empty prompt", async () => {
    const useCase = new GenerateImageUseCase({ runtimeTaskRegistry: createRuntimeTaskRegistryFake() });
    await expect(useCase.startImageGeneration({ ...validRequest, prompt: "   " })).rejects.toThrow("Image generation requires a non-empty prompt.");
  });



  it("resolves selected model into checkpoint before runtime submission", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = new GenerateImageUseCase({
      runtimeTaskRegistry,
      modelCheckpointResolver: {
        resolveCheckpoint: testDouble.fn(async () => ({ checkpoint: "sdxl.safetensors" })),
      },
    });

    await useCase.startImageGeneration({ ...validRequest, model: "stabilityai/stable-diffusion-xl-base-1.0" });
    expect(runtimeTaskRegistry.startTask).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ model: "sdxl.safetensors" }) }));
  });

  it("passes through already-valid checkpoint filenames", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = new GenerateImageUseCase({
      runtimeTaskRegistry,
      modelCheckpointResolver: { resolveCheckpoint: testDouble.fn(async () => ({ checkpoint: "existing.safetensors" })) },
    });
    await useCase.startImageGeneration({ ...validRequest, model: "existing.safetensors" });
    expect(runtimeTaskRegistry.startTask).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ model: "existing.safetensors" }) }));
  });
  it("read returns runtime task unchanged", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = new GenerateImageUseCase({ runtimeTaskRegistry });
    const result = await useCase.readImageGeneration("img-req-1");
    expect(result).toEqual({ requestId: "img-req-1", taskType: TaskType.IMAGE_GENERATION, status: "running", concurrencyClass: "unknown" });
  });

  it("does not import runtime adapter or HTTP client implementation details", async () => {
    const source = await readFile("modules/application/use-cases/image-generation/generate-image.use-case.ts", "utf-8");
    for (const fragment of ["adapters/runtime/comfyui", "createComfyUi", "ComfyUi", "axios", "fetch("]) {
      expect(source.includes(fragment)).toBe(false);
    }
  });
});
