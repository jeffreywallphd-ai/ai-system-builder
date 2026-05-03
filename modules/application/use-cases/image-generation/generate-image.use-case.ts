import type { ImageGenerationRequest } from "../../../contracts/image-generation";
import {
  TaskType,
  type CancelRuntimeTaskResult,
  type RuntimeTaskRecord,
  type StartRuntimeTaskResult,
} from "../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { ModelCheckpointResolverPort } from "../../ports/model";

import type { ApplicationRequestContext } from "../../ports";

function assertValidPrompt(request: ImageGenerationRequest): void {
  if (typeof request.prompt !== "string" || request.prompt.trim().length === 0) {
    throw new Error("Image generation requires a non-empty prompt.");
  }
}

export class GenerateImageUseCase {
  public constructor(
    private readonly dependencies: {
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      modelCheckpointResolver?: ModelCheckpointResolverPort;
    },
  ) {}

  public async startImageGeneration(
    request: ImageGenerationRequest,
    context?: ApplicationRequestContext,
  ): Promise<StartRuntimeTaskResult> {
    assertValidPrompt(request);

    const resolvedModel = await this.dependencies.modelCheckpointResolver?.resolveCheckpoint({
      selectedModel: request.model,
      taskTag: "text-to-image",
    });
    const payload = resolvedModel?.checkpoint
      ? { ...request, model: resolvedModel.checkpoint }
      : request;

    const result = await this.dependencies.runtimeTaskRegistry.startTask({
      taskType: TaskType.IMAGE_GENERATION,
      payload,
      requestId: context?.requestId,
    });

    return result;
  }

  public async readImageGeneration(requestId: string, _context?: ApplicationRequestContext): Promise<RuntimeTaskRecord> {
    return this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
  }

  public async cancelImageGeneration(requestId: string, _context?: ApplicationRequestContext): Promise<CancelRuntimeTaskResult> {
    return this.dependencies.runtimeTaskRegistry.cancelTask(requestId);
  }
}
