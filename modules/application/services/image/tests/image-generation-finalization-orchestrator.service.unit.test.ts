import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { TaskType } from "../../../../contracts/runtime";
import { ImageGenerationFinalizationOrchestratorService } from "../image-generation-finalization-orchestrator.service";

describe("ImageGenerationFinalizationOrchestratorService", () => {
  it("triggers finalization once for succeeded task", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", taskType: TaskType.IMAGE_GENERATION, status: "succeeded", concurrencyClass: "unknown", data: { outputs: [{ type: "image", engine: "comfyui", fileName: "x.png" }] } })) };
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets: [] })) };
    const orchestrator = new ImageGenerationFinalizationOrchestratorService({ runtimeTaskRegistry, finalizeImageGenerationService } as never);

    await orchestrator.finalizeIfCompleted("r1");
    await orchestrator.finalizeIfCompleted("r1");

    expect(finalizeImageGenerationService.finalizeCompletedTask).toHaveBeenCalledTimes(1);
  });

  it("does not finalize non-succeeded tasks", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", taskType: TaskType.IMAGE_GENERATION, status: "running", concurrencyClass: "unknown" })) };
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets: [] })) };
    const orchestrator = new ImageGenerationFinalizationOrchestratorService({ runtimeTaskRegistry, finalizeImageGenerationService } as never);
    await orchestrator.finalizeIfCompleted("r1");
    expect(finalizeImageGenerationService.finalizeCompletedTask).not.toHaveBeenCalled();
  });
});
