import { describe, expect, it, testDouble } from "../../../testing/node-test";
import type { ModelRegistryPort } from "../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import { createRuntimeCapabilityStatus } from "../../../contracts/runtime";
import { RuntimeCapabilityUnavailableError } from "../../services/runtime";
import { PublishModelUseCase } from "../model/publish-model.use-case";

function createModelRegistry(): ModelRegistryPort {
  return {
    listModels: testDouble.fn(),
    getModelRecord: testDouble.fn(async () => ({
      modelRecordId: "model-1",
      displayName: "Demo model",
      source: "generated",
      lifecycleStatus: "generated",
      artifactForm: "adapter",
      provider: "huggingface",
      localPath: "/models/demo",
      createdAt: "2026-05-06T00:00:00.000Z",
    })),
    saveModelReference: testDouble.fn(),
    registerDownloadedModel: testDouble.fn(),
    registerGeneratedModel: testDouble.fn(),
    updateModelRecord: testDouble.fn(),
    deleteModelRecord: testDouble.fn(),
  } as ModelRegistryPort;
}

function createRuntimeTaskRegistry(): RuntimeTaskRegistryPort {
  return {
    startTask: testDouble.fn(async () => ({ requestId: "publish-1", status: "queued" })),
    getTaskStatus: testDouble.fn(),
    cancelTask: testDouble.fn(),
    listTasks: testDouble.fn(),
  } as RuntimeTaskRegistryPort;
}

describe("PublishModelUseCase", () => {
  it("rejects model publishing with structured unavailable readiness and does not start a runtime task", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistry();
    const unavailable = createRuntimeCapabilityStatus({
      capabilityId: "model-publishing",
      status: "unavailable",
      summary: "Model publishing runtime execution is not implemented on this host.",
      reason: {
        code: "runtime.model-publishing.not-implemented",
        message: "Model publishing readiness is explicit but unavailable until a runtime task implementation is composed.",
        category: "unavailable",
        retryable: false,
      },
      recommendedActions: ["configure"],
    });
    const useCase = new PublishModelUseCase({
      modelRegistry: createModelRegistry(),
      runtimeTaskRegistry,
      runtimeCapabilityGuard: {
        requireCapabilityReady: testDouble.fn(async () => {
          throw new RuntimeCapabilityUnavailableError(unavailable);
        }),
      },
    });

    let thrown: unknown;
    try {
      await useCase.execute({ workspaceId: "workspace-a" as never, modelRecordId: "model-1", repository: "org/demo" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "unavailable",
      details: {
        capabilityId: "model-publishing",
        status: "unavailable",
        summary: "Model publishing runtime execution is not implemented on this host.",
        reason: { code: "runtime.model-publishing.not-implemented", category: "unavailable" },
        recommendedActions: ["configure"],
      },
    });
    expect(runtimeTaskRegistry.startTask).not.toHaveBeenCalled();
  });
});
