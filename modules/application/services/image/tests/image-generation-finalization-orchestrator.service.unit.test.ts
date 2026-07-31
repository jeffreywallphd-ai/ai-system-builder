import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createOrganizationId, type OrganizationRequestContext } from "../../../../contracts/organization";
import { TaskType } from "../../../../contracts/runtime";
import { ImageGenerationFinalizationOrchestratorService } from "../image-generation-finalization-orchestrator.service";

describe("ImageGenerationFinalizationOrchestratorService", () => {
  it("triggers finalization once for succeeded task and returns cached assets on repeat", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", workspaceId: "workspace-a" as never, taskType: TaskType.IMAGE_GENERATION, status: "succeeded", concurrencyClass: "unknown", data: { outputs: [{ type: "image", engine: "comfyui", fileName: "x.png" }] } })) };
    const assets = [{ assetId: "asset-1", artifactId: "artifact-1", storageKey: "generated/images/artifact-1.png", mediaType: "image/png", source: "generated" as const }];
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets })) };
    const orchestrator = new ImageGenerationFinalizationOrchestratorService({ runtimeTaskRegistry, finalizeImageGenerationService } as never);

    const first = await orchestrator.finalizeIfCompleted("r1", "workspace-a");
    const second = await orchestrator.finalizeIfCompleted("r1", "workspace-a");

    expect(finalizeImageGenerationService.finalizeCompletedTask).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ finalized: true, assets });
    expect(second).toEqual({ finalized: true, assets });
  });

  it("partitions managed finalization cache entries by organization", async () => {
    let context: OrganizationRequestContext = {
      organizationId: createOrganizationId("org-a"),
      principalId: "principal-a",
    };
    const runtimeTaskRegistry = {
      getTaskStatus: testDouble.fn(async () => ({
        requestId: "r1",
        workspaceId: "workspace-a" as never,
        taskType: TaskType.IMAGE_GENERATION,
        status: "succeeded",
        concurrencyClass: "unknown",
        data: { outputs: [{ type: "image", engine: "comfyui", fileName: "x.png" }] },
      })),
    };
    let finalization = 0;
    const finalizeImageGenerationService = {
      finalizeCompletedTask: testDouble.fn(async () => {
        finalization += 1;
        return {
          assets: [{
            assetId: `asset-${finalization}`,
            artifactId: `artifact-${finalization}`,
            storageKey: `generated/images/artifact-${finalization}.png`,
            mediaType: "image/png",
            source: "generated" as const,
          }],
        };
      }),
    };
    const orchestrator = new ImageGenerationFinalizationOrchestratorService({
      runtimeTaskRegistry,
      finalizeImageGenerationService,
      organizationContextProvider: { getCurrentOrganizationContext: () => context },
    } as never);

    const first = await orchestrator.finalizeIfCompleted("r1", "workspace-a");
    context = { organizationId: createOrganizationId("org-b"), principalId: "principal-b" };
    const second = await orchestrator.finalizeIfCompleted("r1", "workspace-a");

    expect(finalizeImageGenerationService.finalizeCompletedTask).toHaveBeenCalledTimes(2);
    expect(first.assets?.[0]?.artifactId).toBe("artifact-1");
    expect(second.assets?.[0]?.artifactId).toBe("artifact-2");
  });

  it("does not finalize non-succeeded tasks", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", workspaceId: "workspace-a" as never, taskType: TaskType.IMAGE_GENERATION, status: "running", concurrencyClass: "unknown" })) };
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets: [] })) };
    const orchestrator = new ImageGenerationFinalizationOrchestratorService({ runtimeTaskRegistry, finalizeImageGenerationService } as never);
    await orchestrator.finalizeIfCompleted("r1", "workspace-a");
    expect(finalizeImageGenerationService.finalizeCompletedTask).not.toHaveBeenCalled();
  });

  it("returns already-persisted output asset refs without invoking finalization service", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", workspaceId: "workspace-a" as never, taskType: TaskType.IMAGE_GENERATION, status: "succeeded", concurrencyClass: "unknown", data: { outputs: [{ artifactId: "artifact-1", assetId: "asset-1", storageKey: "generated/images/artifact-1.png", mediaType: "image/png" }] } })) };
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets: [] })) };
    const orchestrator = new ImageGenerationFinalizationOrchestratorService({ runtimeTaskRegistry, finalizeImageGenerationService } as never);

    const result = await orchestrator.finalizeIfCompleted("r1", "workspace-a");

    expect(finalizeImageGenerationService.finalizeCompletedTask).not.toHaveBeenCalled();
    expect(result).toEqual({ finalized: true, assets: [{ assetId: "asset-1", artifactId: "artifact-1", storageKey: "generated/images/artifact-1.png", mediaType: "image/png", source: "generated" }] });
  });

  it("does not report finalized when persisted output refs are incomplete", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", workspaceId: "workspace-a" as never, taskType: TaskType.IMAGE_GENERATION, status: "succeeded", concurrencyClass: "unknown", data: { outputs: [{ artifactId: "artifact-1", assetId: "asset-1" }] } })) };
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets: [] })) };
    const orchestrator = new ImageGenerationFinalizationOrchestratorService({ runtimeTaskRegistry, finalizeImageGenerationService } as never);

    const result = await orchestrator.finalizeIfCompleted("r1", "workspace-a");

    expect(finalizeImageGenerationService.finalizeCompletedTask).not.toHaveBeenCalled();
    expect(result).toEqual({ finalized: false, reason: "completed task did not report artifact-backed generated image outputs" });
  });
});
