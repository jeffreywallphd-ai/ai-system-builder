import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createOrganizationId, type OrganizationRequestContext } from "../../../../contracts/organization";
import { TaskType } from "../../../../contracts/runtime";
import { ImageGenerationFinalizationOrchestratorService } from "../image-generation-finalization-orchestrator.service";
import { ImageGenerationTaskAuthorityService } from "../image-generation-task-authority.service";

describe("ImageGenerationFinalizationOrchestratorService", () => {
  it("rechecks task authority before delegating repeated completion to the receipt owner", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", workspaceId: "workspace-a" as never, taskType: TaskType.IMAGE_GENERATION, status: "succeeded", concurrencyClass: "unknown", data: { outputs: [{ type: "image", engine: "comfyui", fileName: "x.png" }] } })) };
    const assets = [{ assetId: "asset-1", artifactId: "artifact-1", storageKey: "generated/images/artifact-1.png", mediaType: "image/png", source: "generated" as const }];
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets })) };
    const orchestrator = createOrchestrator({ runtimeTaskRegistry, finalizeImageGenerationService } as never);

    const first = await orchestrator.finalizeIfCompleted("r1", "workspace-a");
    const second = await orchestrator.finalizeIfCompleted("r1", "workspace-a");

    expect(finalizeImageGenerationService.finalizeCompletedTask).toHaveBeenCalledTimes(1);
    expect(runtimeTaskRegistry.getTaskStatus).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ finalized: true, assets });
    expect(second).toEqual({ finalized: true, assets });
  });

  it("denies a foreign organization before reading or reusing a managed completion receipt", async () => {
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
    const taskAuthority = new ImageGenerationTaskAuthorityService({
      organizationContextProvider: { getCurrentOrganizationContext: () => context },
      workspaceRepository: { readWorkspace: async (workspaceId: any) => ({ workspaceId, status: "active" }) } as never,
      workspaceAuthorization: { authorizeWorkspaceOperation: async () => {} },
    });
    (await taskAuthority.reserve("r1", "workspace-a")).accept();
    const orchestrator = createOrchestrator({
      taskAuthority,
      runtimeTaskRegistry,
      finalizeImageGenerationService,
      organizationContextProvider: { getCurrentOrganizationContext: () => context },
    } as never);

    const first = await orchestrator.finalizeIfCompleted("r1", "workspace-a");
    context = { organizationId: createOrganizationId("org-b"), principalId: "principal-b" };
    await expect(orchestrator.finalizeIfCompleted("r1", "workspace-a")).rejects.toThrow();

    expect(finalizeImageGenerationService.finalizeCompletedTask).toHaveBeenCalledTimes(1);
    expect(runtimeTaskRegistry.getTaskStatus).toHaveBeenCalledTimes(1);
    expect(first.assets?.[0]?.artifactId).toBe("artifact-1");
  });

  it("does not finalize non-succeeded tasks", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", workspaceId: "workspace-a" as never, taskType: TaskType.IMAGE_GENERATION, status: "running", concurrencyClass: "unknown" })) };
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets: [] })) };
    const orchestrator = createOrchestrator({ runtimeTaskRegistry, finalizeImageGenerationService } as never);
    await orchestrator.finalizeIfCompleted("r1", "workspace-a");
    expect(finalizeImageGenerationService.finalizeCompletedTask).not.toHaveBeenCalled();
  });

  it("returns already-persisted output asset refs without invoking finalization service", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", workspaceId: "workspace-a" as never, taskType: TaskType.IMAGE_GENERATION, status: "succeeded", concurrencyClass: "unknown", data: { outputs: [{ artifactId: "artifact-1", assetId: "asset-1", storageKey: "generated/images/artifact-1.png", mediaType: "image/png" }] } })) };
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets: [] })) };
    const orchestrator = createOrchestrator({ runtimeTaskRegistry, finalizeImageGenerationService } as never);

    const result = await orchestrator.finalizeIfCompleted("r1", "workspace-a");

    expect(finalizeImageGenerationService.finalizeCompletedTask).not.toHaveBeenCalled();
    expect(result).toEqual({ finalized: true, assets: [{ assetId: "asset-1", artifactId: "artifact-1", storageKey: "generated/images/artifact-1.png", mediaType: "image/png", source: "generated" }] });
  });

  it("does not report finalized when persisted output refs are incomplete", async () => {
    const runtimeTaskRegistry = { getTaskStatus: testDouble.fn(async () => ({ requestId: "r1", workspaceId: "workspace-a" as never, taskType: TaskType.IMAGE_GENERATION, status: "succeeded", concurrencyClass: "unknown", data: { outputs: [{ artifactId: "artifact-1", assetId: "asset-1" }] } })) };
    const finalizeImageGenerationService = { finalizeCompletedTask: testDouble.fn(async () => ({ assets: [] })) };
    const orchestrator = createOrchestrator({ runtimeTaskRegistry, finalizeImageGenerationService } as never);

    const result = await orchestrator.finalizeIfCompleted("r1", "workspace-a");

    expect(finalizeImageGenerationService.finalizeCompletedTask).not.toHaveBeenCalled();
    expect(result).toEqual({ finalized: false, reason: "completed task did not report artifact-backed generated image outputs" });
  });
});

it("coalesces concurrent completion but rechecks a later foreign-workspace task", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let workspaceId = "workspace-a";
  const getTaskStatus = testDouble.fn(async () => ({ requestId: "r1", workspaceId, taskType: TaskType.IMAGE_GENERATION, status: "succeeded", data: { outputs: [{ type: "image", engine: "comfyui", fileName: "x.png" }] } }));
  const finalizeCompletedTask = testDouble.fn(async () => { await barrier; return { assets: [] }; });
  const service = createOrchestrator({ runtimeTaskRegistry: { getTaskStatus }, finalizeImageGenerationService: { finalizeCompletedTask } } as never);
  const first = service.finalizeIfCompleted("r1", "workspace-a");
  const second = service.finalizeIfCompleted("r1", "workspace-a");
  release();
  await Promise.all([first, second]);
  expect(finalizeCompletedTask).toHaveBeenCalledTimes(1);
  workspaceId = "workspace-b";
  expect(await service.finalizeIfCompleted("r1", "workspace-a")).toMatchObject({ finalized: false });
  expect(finalizeCompletedTask).toHaveBeenCalledTimes(1);
});

it("refuses changed artifact-backed completion evidence and malformed array members", async () => {
  let outputs: any[] = [{ artifactId: "a", storageKey: "generated/a.png" }];
  const getTaskStatus = async () => ({ requestId: "r1", workspaceId: "workspace-a", taskType: TaskType.IMAGE_GENERATION, status: "succeeded", data: { outputs } });
  const service = createOrchestrator({ runtimeTaskRegistry: { getTaskStatus }, finalizeImageGenerationService: {} } as never);
  expect(await service.finalizeIfCompleted("r1", "workspace-a")).toMatchObject({ finalized: true });
  outputs = [{ artifactId: "changed", storageKey: "generated/changed.png" }];
  expect(await service.finalizeIfCompleted("r1", "workspace-a")).toMatchObject({ finalized: false, reason: "completed task evidence changed" });
  outputs = [{ artifactId: "a", storageKey: "generated/a.png" }, null];
  expect(await service.finalizeIfCompleted("r1", "workspace-a")).toMatchObject({ finalized: false, reason: "completed task outputs are invalid" });
});

function createOrchestrator(dependencies: any) {
  return new ImageGenerationFinalizationOrchestratorService({ taskAuthority: { assertOwned: async () => {} }, ...dependencies });
}
